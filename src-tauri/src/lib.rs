mod commands;
mod db;
mod error;
mod events;
mod import;
mod library;
mod media_protocol;
mod state;

use state::AppState;
use tauri_specta::{collect_commands, collect_events, Builder};

/// Single source of truth for the typed IPC surface. Used to build the runtime
/// invoke handler *and* to export `src/lib/bindings.ts` (see the
/// `export_bindings` test, wired into `pnpm check:bindings`). Add new commands
/// and events here and they flow to both the runtime and the generated
/// TypeScript (`commands.*` / `events.*`).
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::library::create_library,
            commands::library::open_library,
            commands::library::close_library,
            commands::library::reopen_last_library,
            commands::library::get_current_library,
            commands::library::list_recent_libraries,
            commands::library::remove_recent_library,
            commands::library::get_library_stats,
            commands::import::import_paths,
            commands::import::cancel_import,
            commands::import::import_clipboard,
            commands::assets::list_assets,
            commands::assets::get_asset,
            commands::assets::update_asset,
            commands::assets::set_assets_rating,
            commands::assets::reveal_asset,
            commands::assets::list_cover_candidates,
            commands::assets::set_video_thumbnail,
            commands::assets::set_captured_thumbnail,
            commands::assets::backfill_missing_thumbnails,
            commands::assets::find_similar_assets,
            commands::duplicates::scan_duplicates,
            commands::smart_folders::list_smart_folders,
            commands::smart_folders::create_smart_folder,
            commands::smart_folders::update_smart_folder,
            commands::smart_folders::delete_smart_folder,
            commands::folders::list_folders,
            commands::folders::get_folder_stats,
            commands::folders::folders_for_assets,
            commands::folders::create_folder,
            commands::folders::rename_folder,
            commands::folders::set_folder_description,
            commands::folders::move_folder,
            commands::folders::delete_folder,
            commands::folders::add_assets_to_folder,
            commands::folders::remove_assets_from_folder,
            commands::trash::trash_assets,
            commands::trash::restore_assets,
            commands::trash::delete_assets_forever,
            commands::trash::empty_trash,
            commands::tags::list_tags,
            commands::tags::create_tag,
            commands::tags::update_tag,
            commands::tags::delete_tag,
            commands::tags::add_tags_to_assets,
            commands::tags::remove_tags_from_assets,
            commands::export::export_assets
        ])
        .events(collect_events![
            events::ImportProgress,
            events::ImportFinished
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta = specta_builder();

    // Regenerate the TS bindings on every debug run so they never drift locally.
    #[cfg(debug_assertions)]
    specta
        .export(
            specta_typescript::Typescript::default(),
            "../src/lib/bindings.ts",
        )
        .expect("failed to export typescript bindings");

    let mut builder = tauri::Builder::default();

    // `single-instance` MUST be the first plugin registered, and is desktop-only.
    // The callback fires in the already-running instance when a second launch is
    // attempted — focus the existing window instead of spawning a new process.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            }))
            .plugin(tauri_plugin_window_state::Builder::new().build())
            // Self-update: signed artifacts from GitHub Releases (see
            // .github/workflows/release.yml); `process` powers the relaunch.
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        // Library media (thumbnails / originals) is served over this custom
        // protocol by id — the WebView never sees absolute filesystem paths.
        .register_asynchronous_uri_scheme_protocol("yasset", media_protocol::handler)
        .invoke_handler(specta.invoke_handler())
        .setup(move |app| {
            // Wire the typed event channels declared in `specta_builder()`.
            specta.mount_events(app);

            // The window starts hidden (`visible: false` in tauri.conf.json) so the
            // window-state plugin can restore size/position before the first paint —
            // this avoids the resize/reposition flicker on launch. Show it once ready.
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::specta_builder;

    /// Regenerates `src/lib/bindings.ts` from the command signatures. CI runs
    /// `pnpm check:bindings` (this test + `git diff --exit-code`) so a changed
    /// Rust signature whose bindings weren't regenerated fails the pipeline
    /// instead of the user's machine.
    #[test]
    fn export_bindings() {
        specta_builder()
            .export(
                specta_typescript::Typescript::default(),
                "../src/lib/bindings.ts",
            )
            .expect("failed to export typescript bindings");
    }
}
