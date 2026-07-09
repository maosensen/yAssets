mod commands;
mod db;
mod error;
mod events;
mod import;
mod library;
mod link;
mod media_protocol;
mod sources;
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
            commands::assets::list_asset_ids,
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
            commands::watched_folders::list_watched_folders,
            commands::watched_folders::add_watched_folder,
            commands::watched_folders::set_watched_folder_enabled,
            commands::watched_folders::remove_watched_folder,
            commands::maintenance::get_maintenance_report,
            commands::maintenance::vacuum_database,
            commands::maintenance::verify_integrity,
            commands::maintenance::clean_orphans,
            commands::export::export_assets,
            commands::sources::search_source,
            commands::sources::import_source_items,
            commands::url::clipboard_url,
            commands::url::import_url,
            commands::url::open_link_window
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

            // Native application menu (macOS only). Windows/Linux keep the
            // in-window sidebar switcher menu, which carries the same actions — a
            // native menu bar there would clash with the custom titlebar. Custom
            // items emit `menu://<id>` to the webview (handled by the
            // use-menu-actions hook); the Edit submenu is required so
            // copy/paste/select-all keep working, which setting a custom app menu
            // would otherwise drop.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{
                    MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
                };
                use tauri::Emitter;

                let handle = app.handle();
                let preferences = MenuItemBuilder::with_id("preferences", "Preferences…")
                    .accelerator("CmdOrCtrl+,")
                    .build(handle)?;
                // Give hide/quit explicit text — the predefined defaults use the
                // lowercase executable name ("yassets"), not the product name.
                let hide = PredefinedMenuItem::hide(handle, Some("Hide yAssets"))?;
                let quit = PredefinedMenuItem::quit(handle, Some("Quit yAssets"))?;
                let app_menu = SubmenuBuilder::new(handle, "yAssets")
                    .text("about", "About yAssets")
                    .text("check-updates", "Check for Updates…")
                    .text("changelog", "What's New")
                    .separator()
                    .item(&preferences)
                    .separator()
                    .services()
                    .separator()
                    .item(&hide)
                    .hide_others()
                    .show_all()
                    .separator()
                    .item(&quit)
                    .build()?;
                let edit_menu = SubmenuBuilder::new(handle, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                let window_menu = SubmenuBuilder::new(handle, "Window")
                    .minimize()
                    .maximize()
                    .separator()
                    .close_window()
                    .build()?;
                let menu = MenuBuilder::new(handle)
                    .items(&[&app_menu, &edit_menu, &window_menu])
                    .build()?;
                app.set_menu(menu)?;
                app.on_menu_event(move |app, event| {
                    let id = event.id().as_ref();
                    if matches!(id, "about" | "preferences" | "check-updates" | "changelog") {
                        let _ = app.emit(&format!("menu://{id}"), ());
                    }
                });
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
