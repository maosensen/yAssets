mod commands;
mod error;
mod state;

use state::AppState;
use tauri_specta::{collect_commands, Builder};

/// Single source of truth for the typed IPC surface. Used to build the runtime
/// invoke handler *and* to export `src/lib/bindings.ts` (see the
/// `export_bindings` test, wired into `pnpm check:bindings`). Add new commands
/// here and they flow to both the handler and the generated TypeScript.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::greet,
        commands::uptime_ms,
        commands::list_dir
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
            .plugin(tauri_plugin_window_state::Builder::new().build());
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
        .invoke_handler(specta.invoke_handler())
        .setup(|app| {
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
