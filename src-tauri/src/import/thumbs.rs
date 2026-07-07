//! Thumbnail generation: decode → EXIF-orient → SIMD resize → lossy WebP.
//!
//! - Formats are gated by (lowercased) extension; content is still sniffed by
//!   `with_guessed_format`, so a mislabelled file decodes by its real format.
//! - Decompression bombs are bounded by `image::Limits` (dimensions + alloc);
//!   oversized files degrade to "imported without thumbnail", never a crash.
//! - Dimensions are recorded *after* EXIF orientation — the frontend masonry
//!   computes layout purely from these numbers, so portrait photos must
//!   report portrait dimensions.
//! - Encoding uses the `webp` crate (lossy, alpha-capable). The `image`
//!   crate's own WebP encoder is lossless-only — 3-5× larger files.

use std::path::Path;

use fast_image_resize::images::Image;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer};
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageReader};

use crate::error::{AppError, AppResult};

/// Long-edge target for generated thumbnails (px).
pub const THUMB_LONG_EDGE: u32 = 512;
/// Lossy WebP quality.
const WEBP_QUALITY: f32 = 80.0;
/// Decode guards: refuse absurd dimensions / allocations up front.
const MAX_DECODE_EDGE: u32 = 20_000;
const MAX_DECODE_ALLOC: u64 = 512 * 1024 * 1024;
/// Hard cap on a zip-embedded preview's *decompressed* bytes — a real preview
/// PNG is well under this, so it only stops a zip-bomb entry (a tiny archive
/// that inflates to GB) from OOM-ing the import batch.
const MAX_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;

/// Bitmap formats decoded by the `image` crate (all pure-Rust decoders).
fn is_bitmap_ext(ext: &str) -> bool {
    matches!(
        ext,
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tif" | "tiff" | "ico"
    )
}

/// Adobe Photoshop documents — thumbnailed from their flattened composite.
fn is_psd_ext(ext: &str) -> bool {
    matches!(ext, "psd" | "psb")
}

/// Zip-container design formats that embed a rendered preview PNG.
fn is_zip_preview_ext(ext: &str) -> bool {
    matches!(ext, "sketch" | "ora" | "kra")
}

/// Extensions we can generate a real thumbnail for, headless in Rust
/// (bitmaps + SVG + PSD composite + zip-embedded previews). Formats the WebView
/// captures on-demand instead (video/PDF/HEIC) are NOT listed here.
pub fn is_thumbable_ext(ext: &str) -> bool {
    is_bitmap_ext(ext) || ext == "svg" || is_psd_ext(ext) || is_zip_preview_ext(ext)
}

/// Result of thumbnailing: oriented source dimensions + extracted color +
/// perceptual fingerprint.
#[derive(Debug, Clone)]
pub struct ThumbOutcome {
    pub width: u32,
    pub height: u32,
    /// Dominant-hue bucket (see [`crate::import::color`]); None if undetermined.
    pub hue: Option<u8>,
    /// JSON array of representative swatch hex strings.
    pub palette: Option<String>,
    /// 64-bit dHash (see [`crate::import::dhash`]), bit-cast for storage.
    pub dhash: Option<i64>,
}

/// Decode `src` (bitmap or SVG), resize to ≤ [`THUMB_LONG_EDGE`], write a
/// WebP to `dest`, and extract the dominant color from the downscaled pixels.
///
/// Any error here is per-file and non-fatal to import — callers downgrade to
/// `has_thumb = false` and keep the asset.
pub fn generate(src: &Path, dest: &Path, ext: &str) -> AppResult<ThumbOutcome> {
    let (width, height, thumb_w, thumb_h, resized) = if ext == "svg" {
        rasterize_svg(src)?
    } else if is_psd_ext(ext) {
        decode_psd(src)?
    } else if is_zip_preview_ext(ext) {
        decode_zip_preview(src, ext)?
    } else {
        decode_bitmap(src)?
    };

    let (hue, palette) = crate::import::color::analyze_rgba(&resized);
    let dhash = crate::import::dhash::compute(&resized, thumb_w, thumb_h).map(|v| v as i64);

    let encoded = webp::Encoder::from_rgba(&resized, thumb_w, thumb_h).encode(WEBP_QUALITY);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, &*encoded)?;

    Ok(ThumbOutcome {
        width,
        height,
        hue,
        palette,
        dhash,
    })
}

/// Encode an already-decoded RGBA frame as an asset's thumbnail — the video
/// cover path (frames are captured by the WebView's own decoder and shipped
/// over IPC). Runs the same resize → color/dhash → WebP steps as `generate`.
pub fn write_from_rgba(rgba: Vec<u8>, w: u32, h: u32, dest: &Path) -> AppResult<ThumbOutcome> {
    if w == 0 || h == 0 || rgba.len() < (w as usize * h as usize * 4) {
        return Err(AppError::Conflict("invalid frame buffer".into()));
    }
    let (thumb_w, thumb_h) = fit_long_edge(w, h, THUMB_LONG_EDGE);
    let resized = if (thumb_w, thumb_h) == (w, h) {
        rgba
    } else {
        resize_rgba(rgba, w, h, thumb_w, thumb_h)?
    };

    let (hue, palette) = crate::import::color::analyze_rgba(&resized);
    let dhash = crate::import::dhash::compute(&resized, thumb_w, thumb_h).map(|v| v as i64);

    let encoded = webp::Encoder::from_rgba(&resized, thumb_w, thumb_h).encode(WEBP_QUALITY);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, &*encoded)?;

    Ok(ThumbOutcome {
        width: w,
        height: h,
        hue,
        palette,
        dhash,
    })
}

/// Bitmap path: decode via `image` (EXIF-oriented, bomb-limited) → RGBA →
/// SIMD downscale. Returns (src_w, src_h, thumb_w, thumb_h, thumb_rgba).
fn decode_bitmap(src: &Path) -> AppResult<(u32, u32, u32, u32, Vec<u8>)> {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_DECODE_EDGE);
    limits.max_image_height = Some(MAX_DECODE_EDGE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);

    let mut reader = ImageReader::open(src)?.with_guessed_format()?;
    reader.limits(limits);

    let mut decoder = reader.into_decoder().map_err(image_err)?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).map_err(image_err)?;
    img.apply_orientation(orientation);

    let (width, height) = (img.width(), img.height());
    let (thumb_w, thumb_h) = fit_long_edge(width, height, THUMB_LONG_EDGE);
    let rgba = img.into_rgba8().into_raw();
    let resized = if (thumb_w, thumb_h) == (width, height) {
        rgba
    } else {
        resize_rgba(rgba, width, height, thumb_w, thumb_h)?
    };
    Ok((width, height, thumb_w, thumb_h, resized))
}

/// SVG path: parse with usvg, render at the thumbnail size with resvg/tiny-skia.
/// Reported dimensions are the SVG's intrinsic size; the raster is already the
/// thumbnail (no separate resize step).
fn rasterize_svg(src: &Path) -> AppResult<(u32, u32, u32, u32, Vec<u8>)> {
    let data = std::fs::read(src)?;
    // Monochrome icon SVGs (Iconify & co.) paint with `currentColor`, which
    // rasterizes to black — invisible on the dark theme. Substitute a neutral
    // gray in the thumbnail render only; the stored asset keeps currentColor.
    let data = substitute_current_color(&data).unwrap_or(data);
    let tree = resvg::usvg::Tree::from_data(&data, &resvg::usvg::Options::default())
        .map_err(|err| AppError::Io(format!("svg parse failed: {err}")))?;

    let size = tree.size();
    let (src_w, src_h) = (size.width().max(1.0), size.height().max(1.0));
    // Vectors scale losslessly — always render AT the thumbnail edge. Icon
    // SVGs often declare a tiny intrinsic size (Iconify defaults to 1em ≈
    // 12px); rasterizing at that size and letting the grid stretch it would
    // be a blurry smudge.
    let scale = THUMB_LONG_EDGE as f32 / src_w.max(src_h);
    let thumb_w = ((src_w * scale).round() as u32).max(1);
    let thumb_h = ((src_h * scale).round() as u32).max(1);

    let mut pixmap = resvg::tiny_skia::Pixmap::new(thumb_w, thumb_h)
        .ok_or_else(|| AppError::Io("svg pixmap alloc failed".into()))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );

    Ok((
        src_w.ceil() as u32,
        src_h.ceil() as u32,
        thumb_w,
        thumb_h,
        pixmap.data().to_vec(),
    ))
}

/// Replace every `currentColor` (CSS keywords are case-INsensitive, so
/// `currentcolor` is equally valid — and usvg falls back to black for it too)
/// with a neutral gray that reads on both themes. Returns `None` when the
/// data contains no occurrence, so callers can keep the original allocation.
fn substitute_current_color(data: &[u8]) -> Option<Vec<u8>> {
    const NEEDLE: &[u8] = b"currentColor";
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    let mut replaced = false;
    while i < data.len() {
        if i + NEEDLE.len() <= data.len() && data[i..i + NEEDLE.len()].eq_ignore_ascii_case(NEEDLE)
        {
            out.extend_from_slice(b"#8f959e");
            i += NEEDLE.len();
            replaced = true;
        } else {
            out.push(data[i]);
            i += 1;
        }
    }
    replaced.then_some(out)
}

/// PSD/PSB path: take the document's flattened composite (the "merged image
/// data" every editor writes) and SIMD downscale like a bitmap. Layers aren't
/// re-blended — the stored composite is authoritative and cheap.
///
/// The `psd` crate PANICS (slice-index overrun) on truncated/malformed files,
/// so parse + composite run inside `catch_unwind`: a bad PSD becomes a per-file
/// error, never a panic that would unwind the whole rayon import batch.
fn decode_psd(src: &Path) -> AppResult<(u32, u32, u32, u32, Vec<u8>)> {
    let data = std::fs::read(src)?;
    let parsed: Result<(u32, u32, Vec<u8>), String> = std::panic::catch_unwind(|| {
        let psd = psd::Psd::from_bytes(&data).map_err(|err| err.to_string())?;
        Ok((psd.width(), psd.height(), psd.rgba()))
    })
    .unwrap_or_else(|_| Err("psd parse panicked".to_string()));
    let (width, height, rgba) =
        parsed.map_err(|err| AppError::Io(format!("psd decode failed: {err}")))?;
    if width == 0 || height == 0 || rgba.len() < (width as usize * height as usize * 4) {
        return Err(AppError::Io("psd has no composite image".into()));
    }
    let (thumb_w, thumb_h) = fit_long_edge(width, height, THUMB_LONG_EDGE);
    let resized = if (thumb_w, thumb_h) == (width, height) {
        rgba
    } else {
        resize_rgba(rgba, width, height, thumb_w, thumb_h)?
    };
    Ok((width, height, thumb_w, thumb_h, resized))
}

/// Zip-container formats (Sketch/ORA/KRA) ship a rendered preview PNG. Pull the
/// first candidate entry that exists and decode it as a bitmap. Reported
/// dimensions are the PREVIEW's — the document's true canvas size isn't cheaply
/// known, and the frontend only needs an aspect ratio for layout.
fn decode_zip_preview(src: &Path, ext: &str) -> AppResult<(u32, u32, u32, u32, Vec<u8>)> {
    let candidates: &[&str] = match ext {
        "sketch" => &["previews/preview.png"],
        "ora" => &["Thumbnails/thumbnail.png", "mergedimage.png"],
        "kra" => &["mergedimage.png", "preview.png"],
        _ => &[],
    };

    let file = std::fs::File::open(src)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|err| AppError::Io(format!("zip open failed: {err}")))?;

    let mut bytes = Vec::new();
    let mut found = false;
    for name in candidates {
        let Ok(entry) = zip.by_name(name) else {
            continue;
        };
        // Skip an entry that DECLARES more than the cap, and read through a
        // `take` so a lying header still can't inflate past it — a zip-bomb
        // preview must never OOM the import batch (declared size is only a hint).
        if entry.size() > MAX_PREVIEW_BYTES {
            continue;
        }
        use std::io::Read;
        bytes.clear();
        entry
            .take(MAX_PREVIEW_BYTES)
            .read_to_end(&mut bytes)
            .map_err(|err| AppError::Io(format!("zip read failed: {err}")))?;
        found = true;
        break;
    }
    if !found {
        return Err(AppError::Io("no embedded preview in container".into()));
    }

    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_DECODE_EDGE);
    limits.max_image_height = Some(MAX_DECODE_EDGE);
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    let mut reader = ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format()?;
    reader.limits(limits);
    let img = reader.decode().map_err(image_err)?;

    let (width, height) = (img.width(), img.height());
    let (thumb_w, thumb_h) = fit_long_edge(width, height, THUMB_LONG_EDGE);
    let rgba = img.into_rgba8().into_raw();
    let resized = if (thumb_w, thumb_h) == (width, height) {
        rgba
    } else {
        resize_rgba(rgba, width, height, thumb_w, thumb_h)?
    };
    Ok((width, height, thumb_w, thumb_h, resized))
}

/// SIMD resize via fast_image_resize (Lanczos3, alpha-aware mul/div).
fn resize_rgba(raw: Vec<u8>, src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> AppResult<Vec<u8>> {
    let src = Image::from_vec_u8(src_w, src_h, raw, PixelType::U8x4).map_err(|err| {
        log::warn!("resize source buffer invalid: {err}");
        AppError::Internal
    })?;
    let mut dst = Image::new(dst_w, dst_h, PixelType::U8x4);
    Resizer::new()
        .resize(
            &src,
            &mut dst,
            &ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3)),
        )
        .map_err(|err| {
            log::warn!("resize failed: {err}");
            AppError::Internal
        })?;
    Ok(dst.into_vec())
}

/// Scale (w, h) so the long edge is ≤ `edge`, never upscaling.
fn fit_long_edge(width: u32, height: u32, edge: u32) -> (u32, u32) {
    let long = width.max(height);
    if long <= edge {
        return (width, height);
    }
    let scale = edge as f64 / long as f64;
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

fn image_err(err: image::ImageError) -> AppError {
    AppError::Io(format!("image decode failed: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_long_edge_downscales_and_never_upscales() {
        assert_eq!(fit_long_edge(4000, 3000, 512), (512, 384));
        assert_eq!(fit_long_edge(3000, 4000, 512), (384, 512));
        assert_eq!(fit_long_edge(400, 300, 512), (400, 300));
        assert_eq!(fit_long_edge(512, 512, 512), (512, 512));
        // Extreme panorama: short edge clamps to ≥ 1.
        assert_eq!(fit_long_edge(50_000_u32.min(20_000), 10, 512).1.max(1), 1);
    }

    #[test]
    fn generate_writes_webp_and_reports_dimensions() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("src.png");
        let dest = tmp.path().join("out/th.webp");

        // 800×600 gradient with alpha.
        let img = image::RgbaImage::from_fn(800, 600, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, 128, 200])
        });
        img.save(&src).expect("write fixture png");

        let outcome = generate(&src, &dest, "png").expect("generate");
        assert_eq!((outcome.width, outcome.height), (800, 600));
        assert!(outcome.hue.is_some());
        assert!(dest.is_file());

        // Round-trip: the written file decodes as a ≤512 long-edge image.
        let thumb = image::open(&dest).expect("decode thumb");
        assert_eq!(thumb.width().max(thumb.height()), 512);
    }

    #[test]
    fn generate_small_image_keeps_size() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("small.png");
        let dest = tmp.path().join("th.webp");
        image::RgbaImage::from_pixel(120, 80, image::Rgba([10, 20, 30, 255]))
            .save(&src)
            .expect("fixture");

        let outcome = generate(&src, &dest, "png").expect("generate");
        assert_eq!((outcome.width, outcome.height), (120, 80));
        let thumb = image::open(&dest).expect("decode thumb");
        assert_eq!((thumb.width(), thumb.height()), (120, 80));
    }

    #[test]
    fn generate_rejects_non_image_bytes() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("fake.png");
        let dest = tmp.path().join("th.webp");
        std::fs::write(&src, b"definitely not an image").expect("fixture");

        assert!(generate(&src, &dest, "png").is_err());
        assert!(!dest.exists());
    }

    #[test]
    fn generate_decodes_tiff() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("scan.tiff");
        let dest = tmp.path().join("th.webp");
        image::RgbaImage::from_fn(300, 200, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, 64, 255])
        })
        .save(&src)
        .expect("write tiff fixture");

        let outcome = generate(&src, &dest, "tiff").expect("generate tiff");
        assert_eq!((outcome.width, outcome.height), (300, 200));
        assert!(dest.is_file());
    }

    #[test]
    fn generate_decodes_zip_embedded_preview() {
        use std::io::Write;
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("design.sketch");
        let dest = tmp.path().join("th.webp");

        // A real .sketch is a zip; embed a preview PNG at the standard path.
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            128,
            96,
            image::Rgba([200, 40, 40, 255]),
        ))
        .write_to(&mut png, image::ImageFormat::Png)
        .expect("encode preview png");

        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut zw = zip::ZipWriter::new(&mut buf);
            zw.start_file(
                "previews/preview.png",
                zip::write::SimpleFileOptions::default(),
            )
            .expect("start entry");
            zw.write_all(png.get_ref()).expect("write entry");
            zw.finish().expect("finish zip");
        }
        std::fs::write(&src, buf.into_inner()).expect("write sketch fixture");

        let outcome = generate(&src, &dest, "sketch").expect("generate sketch");
        assert_eq!((outcome.width, outcome.height), (128, 96));
        assert!(dest.is_file());
    }

    #[test]
    fn generate_rejects_bad_psd() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("broken.psd");
        let dest = tmp.path().join("th.webp");
        std::fs::write(&src, b"8BPS not really a document").expect("fixture");
        assert!(generate(&src, &dest, "psd").is_err());
        assert!(!dest.exists());
    }

    #[test]
    fn generate_rasterizes_svg() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("icon.svg");
        let dest = tmp.path().join("th.webp");
        std::fs::write(
            &src,
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#2244cc"/></svg>"##,
        )
        .expect("fixture");

        let outcome = generate(&src, &dest, "svg").expect("generate svg");
        assert_eq!((outcome.width, outcome.height), (200, 100));
        assert!(dest.is_file());
        assert_eq!(outcome.hue, Some(7)); // #2244cc ≈ 228° → blue slice
    }

    #[test]
    fn generate_upscales_tiny_svg_and_substitutes_current_color() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let src = tmp.path().join("icon.svg");
        let dest = tmp.path().join("th.webp");
        // An Iconify-style icon: tiny 1em intrinsic size, painted with
        // currentColor (which would rasterize black on transparent).
        std::fs::write(
            &src,
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><rect width="24" height="24" fill="currentColor"/></svg>"##,
        )
        .expect("fixture");

        generate(&src, &dest, "svg").expect("generate svg");
        let thumb = image::open(&dest).expect("decode thumb");
        // Rendered at the thumbnail edge (vector upscale), not a 12px smudge…
        assert_eq!(thumb.width().max(thumb.height()), THUMB_LONG_EDGE);
        // …and currentColor became a visible neutral gray, not black.
        let px = thumb.to_rgba8().get_pixel(256, 256).0;
        assert!(
            px[0] > 0x60 && px[0] < 0xc0 && px[3] == 0xff,
            "expected neutral gray, got {px:?}"
        );
    }

    #[test]
    fn substitute_current_color_is_case_insensitive() {
        // CSS keywords are case-insensitive: `currentcolor` is valid too (and
        // usvg would fall back to black for it, defeating the substitution).
        let mixed = br##"<svg><rect fill="currentcolor"/><path stroke="CURRENTCOLOR"/></svg>"##;
        let out = substitute_current_color(mixed).expect("replaced");
        let text = String::from_utf8(out).expect("utf8");
        assert!(!text.to_ascii_lowercase().contains("currentcolor"));
        assert_eq!(text.matches("#8f959e").count(), 2);
        // No occurrence → None, so callers keep the original buffer.
        assert!(substitute_current_color(b"<svg fill=\"#fff\"/>").is_none());
    }
}
