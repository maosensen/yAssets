//! yt-dlp subsystem — platform-video downloads for the Collect API.
//!
//! Streamed platform video (Twitter/X, TikTok, bilibili, …) is HLS/DASH with
//! signed URLs; a browser extension can't read those bytes. The proven answer
//! (Eagle's video plugin, every downloader) is yt-dlp run by the desktop app.
//!
//! Design decisions:
//! - **Binary is managed, not bundled**: downloaded on demand from the yt-dlp
//!   GitHub release into `<app-data>/tools/`, verified against the release's
//!   `SHA2-256SUMS` before install (transfer integrity — both artifacts ride
//!   the same TLS channel, so this is not a signature check), and installed
//!   via temp-file + rename so a failed update never clobbers a working binary.
//! - **No ffmpeg (yet)**: format selection is `b[ext=mp4]/b` — the best
//!   *single, pre-muxed* file. Covers Twitter/TikTok-class sources; merged
//!   high-res (YouTube DASH) is a later milestone that brings ffmpeg.
//! - **The URL is untrusted**: https-only public hosts (checked by the
//!   caller), passed after `--` so it can never be parsed as an option, with
//!   `--no-playlist` and a hard `--max-filesize`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::error::{AppError, AppResult};

const LATEST_BASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";
/// The macOS binary is ~35 MB; anything wildly larger is not yt-dlp.
const MAX_BINARY_BYTES: u64 = 200 * 1024 * 1024;
const MAX_SUMS_BYTES: u64 = 1024 * 1024;
/// Whole-download budget for one video.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);
/// yt-dlp-side cap — UI demo clips are far smaller; this only stops abuse.
const MAX_FILESIZE_ARG: &str = "500m";

/// Release asset name for this platform.
fn asset_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

/// Where the managed tools live: `<app-data>/tools/`.
pub fn tools_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(|err| {
        log::error!("app data dir unavailable: {err}");
        AppError::Internal
    })?;
    Ok(dir.join("tools"))
}

pub fn binary_path(tools_dir: &Path) -> PathBuf {
    tools_dir.join(binary_name())
}

/// `yt-dlp --version` output (a release date like `2026.06.30`), or None when
/// the binary is missing or won't run.
///
/// Runs on a blocking thread with `std::process` — the rest of the app spawns
/// subprocesses this way. `tokio::process` needs the runtime's signal (SIGCHLD)
/// driver to reap children, which isn't reliably present on Tauri's async
/// runtime, so `.output().await` there can hang forever instead of returning.
pub async fn installed_version(tools_dir: &Path) -> Option<String> {
    let bin = binary_path(tools_dir);
    if !bin.is_file() {
        return None;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let out = std::process::Command::new(&bin)
            .arg("--version")
            .output()
            .map_err(|err| log::warn!("yt-dlp --version failed to spawn: {err}"))
            .ok()?;
        if !out.status.success() {
            log::warn!(
                "yt-dlp --version exited {}: {}",
                out.status,
                String::from_utf8_lossy(&out.stderr).trim()
            );
            return None;
        }
        let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!version.is_empty()).then_some(version)
    })
    .await
    .ok()
    .flatten()
}

/// Download the latest yt-dlp, verify its checksum, and install it.
/// Returns the installed version. Also serves as "update".
pub async fn install(tools_dir: &Path) -> AppResult<String> {
    let client = download_client()?;
    let bytes = fetch_capped(
        &client,
        &format!("{LATEST_BASE}/{}", asset_name()),
        MAX_BINARY_BYTES,
    )
    .await?;
    let sums = fetch_capped(
        &client,
        &format!("{LATEST_BASE}/SHA2-256SUMS"),
        MAX_SUMS_BYTES,
    )
    .await?;
    let expected =
        expected_sha256(&String::from_utf8_lossy(&sums), asset_name()).ok_or_else(|| {
            AppError::Network("release checksum list is missing this platform's entry".into())
        })?;
    verify_sha256(&bytes, &expected)?;
    install_from_bytes(&bytes, tools_dir)?;
    installed_version(tools_dir)
        .await
        .ok_or_else(|| AppError::Io("yt-dlp installed but does not run".into()))
}

/// Dedicated client: unlike the app-wide one, GitHub's release downloads
/// need redirect following. Still https-only.
fn download_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("yAssets/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|err| {
            log::error!("failed to build download client: {err}");
            AppError::Internal
        })
}

async fn fetch_capped(client: &reqwest::Client, url: &str, max: u64) -> AppResult<Vec<u8>> {
    let mut resp = client.get(url).send().await?.error_for_status()?;
    if resp.content_length().is_some_and(|len| len > max) {
        return Err(AppError::Network("download larger than expected".into()));
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await? {
        if buf.len() as u64 + chunk.len() as u64 > max {
            return Err(AppError::Network("download larger than expected".into()));
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// Find `asset`'s hash in a `SHA2-256SUMS` file (`<hash>  <name>` lines).
fn expected_sha256(sums: &str, asset: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?;
        (name.trim_start_matches('*') == asset).then(|| hash.to_ascii_lowercase())
    })
}

fn verify_sha256(bytes: &[u8], expected: &str) -> AppResult<()> {
    let digest = Sha256::digest(bytes);
    let actual: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    if actual == expected {
        Ok(())
    } else {
        Err(AppError::Network(
            "yt-dlp download failed checksum verification".into(),
        ))
    }
}

/// Write + chmod + rename into place. The rename is what guarantees a failed
/// download never replaces a working binary.
fn install_from_bytes(bytes: &[u8], tools_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(tools_dir)?;
    let staged = tools_dir.join(format!("{}.download", binary_name()));
    std::fs::write(&staged, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
    }
    // Windows can't replace a RUNNING executable in place, but it can rename
    // it aside (the classic updater trick). Harmless elsewhere.
    let dest = binary_path(tools_dir);
    let old = tools_dir.join(format!("{}.old", binary_name()));
    if dest.exists() {
        let _ = std::fs::remove_file(&old);
        let _ = std::fs::rename(&dest, &old);
    }
    std::fs::rename(&staged, &dest)?;
    let _ = std::fs::remove_file(&old);
    // Belt-and-braces: our own download shouldn't be quarantined, but a
    // stray attribute would EACCES every run (Eagle's plugin hit this).
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(binary_path(tools_dir))
            .output();
    }
    Ok(())
}

/// Download `url`'s video into `dest_dir` (fresh, caller-owned) and return
/// the produced file's path.
///
/// Runs on a blocking thread with `std::process` (see `installed_version` for
/// why not `tokio::process`). Cancellation/timeout is handled by polling
/// `try_wait` against a deadline and killing the child — no signal driver
/// needed.
pub async fn download_video(tools_dir: &Path, url: &str, dest_dir: &Path) -> AppResult<PathBuf> {
    let bin = binary_path(tools_dir);
    if !bin.is_file() {
        return Err(AppError::NotFound("yt-dlp is not installed".into()));
    }
    std::fs::create_dir_all(dest_dir)?;

    let url = url.to_string();
    let template = output_template(dest_dir);
    let dest = dest_dir.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = std::process::Command::new(&bin)
            .arg("--no-playlist")
            .args(["-f", "b[ext=mp4]/b"])
            .args(["--max-filesize", MAX_FILESIZE_ARG])
            .args(["--socket-timeout", "30"])
            .arg("--no-progress")
            .arg("-o")
            .arg(&template)
            .arg("--")
            .arg(&url)
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|err| AppError::Io(format!("failed to run yt-dlp: {err}")))?;

        let deadline = std::time::Instant::now() + DOWNLOAD_TIMEOUT;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    if std::time::Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(AppError::Network("video download timed out".into()));
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(err) => {
                    let _ = child.kill();
                    return Err(AppError::Io(format!("yt-dlp wait failed: {err}")));
                }
            }
        };

        if !status.success() {
            let mut stderr = Vec::new();
            if let Some(mut pipe) = child.stderr.take() {
                use std::io::Read;
                let _ = pipe.read_to_end(&mut stderr);
            }
            return Err(AppError::Network(summarize_stderr(&stderr)));
        }
        newest_file(&dest)?.ok_or_else(|| {
            // --max-filesize makes yt-dlp SKIP oversize videos and exit 0 — an
            // empty dir on success usually means exactly that.
            AppError::Network("no downloadable file — the video may exceed the 500 MB limit".into())
        })
    })
    .await
    .map_err(|err| {
        log::error!("video download task panicked: {err}");
        AppError::Internal
    })?
}

/// yt-dlp `-o` template: the filename part uses template sequences, so any
/// literal `%` in the directory path must be escaped (`%%`) or it would be
/// parsed as a sequence too.
fn output_template(dest_dir: &Path) -> String {
    let dir = dest_dir.to_string_lossy().replace('%', "%%");
    format!(
        "{dir}{}%(title).120B [%(id)s].%(ext)s",
        std::path::MAIN_SEPARATOR
    )
}

/// yt-dlp's last `ERROR:` line is its actual diagnosis — surface that,
/// capped to toast length.
fn summarize_stderr(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let line = text
        .lines()
        .rev()
        .find(|line| line.contains("ERROR"))
        .unwrap_or("")
        .trim();
    let summary: String = line.chars().take(300).collect();
    if summary.is_empty() {
        "video download failed".to_string()
    } else {
        summary
    }
}

/// The most recently modified real file in `dir` (skipping yt-dlp partials).
fn newest_file(dir: &Path) -> AppResult<Option<PathBuf>> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path
            .extension()
            .is_some_and(|ext| ext == "part" || ext == "ytdl")
        {
            continue;
        }
        let modified = entry
            .metadata()?
            .modified()
            .unwrap_or(std::time::UNIX_EPOCH);
        if best.as_ref().is_none_or(|(t, _)| modified >= *t) {
            best = Some((modified, path));
        }
    }
    Ok(best.map(|(_, path)| path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_list_parsing_matches_the_asset() {
        let sums = "\
0123abc  yt-dlp\n\
deadBEEF00  yt-dlp_macos\n\
ffff  *yt-dlp.exe\n";
        assert_eq!(
            expected_sha256(sums, "yt-dlp_macos").as_deref(),
            Some("deadbeef00")
        );
        // BSD-style `*name` marker is tolerated.
        assert_eq!(expected_sha256(sums, "yt-dlp.exe").as_deref(), Some("ffff"));
        assert_eq!(expected_sha256(sums, "nope"), None);
    }

    #[test]
    fn sha256_verification_accepts_and_rejects() {
        // sha256("abc")
        let expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert!(verify_sha256(b"abc", expected).is_ok());
        assert!(verify_sha256(b"abd", expected).is_err());
    }

    #[test]
    fn install_from_bytes_stages_then_renames() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let tools = tmp.path().join("tools");
        install_from_bytes(b"#!/bin/sh\necho hi\n", &tools).expect("install");
        let bin = binary_path(&tools);
        assert!(bin.is_file());
        // No staging leftover.
        assert!(!tools.join(format!("{}.download", binary_name())).exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&bin).expect("meta").permissions().mode();
            assert_eq!(mode & 0o111, 0o111, "binary must be executable");
        }
    }

    #[test]
    fn stderr_summary_prefers_the_last_error_line() {
        let stderr = b"[twitter] fetching\nWARNING: something\nERROR: Unsupported URL: https://x\n";
        assert_eq!(
            summarize_stderr(stderr),
            "ERROR: Unsupported URL: https://x"
        );
        assert_eq!(summarize_stderr(b""), "video download failed");
    }

    #[test]
    fn newest_file_skips_partials() {
        let tmp = tempfile::tempdir().expect("tempdir");
        std::fs::write(tmp.path().join("clip.mp4"), b"v").expect("write");
        std::fs::write(tmp.path().join("clip.mp4.part"), b"p").expect("write");
        let found = newest_file(tmp.path()).expect("scan").expect("file");
        assert_eq!(found.file_name().unwrap(), "clip.mp4");
    }
}
