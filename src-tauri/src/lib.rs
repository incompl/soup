// Thin shell by design: the scene model and editor live in the frontend.
// This side grows only OS-boundary features (screenshots, clipboard
// images, file dialogs/IO, SVG -> PDF conversion), exposed as commands.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
