// Thin shell by design: the scene model and editor live in the frontend.
// This side grows only OS-boundary features (screenshots, clipboard
// images, file dialogs/IO, SVG -> PDF conversion), exposed as commands.

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder, Wry,
};

// A `.soup` path the app was asked to open by the OS (double-click / "Open
// With") before the frontend was listening. The frontend drains it on
// startup via `take_pending_open`; see also the `Opened` handler in `run`.
#[derive(Default)]
struct PendingOpen(Mutex<Option<String>>);

// Handle to the "Open Recent" submenu so `set_recent_files` can rebuild it at
// runtime as the frontend's recent-files list (localStorage) changes.
struct RecentMenu(Submenu<Wry>);

// Read a document's text. The path always comes from a native dialog or an OS
// open request, so IO stays here on the OS boundary rather than via fs plugin.
#[tauri::command]
fn read_document(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// Write a document's text to a dialog-chosen path.
#[tauri::command]
fn write_document(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

// Hand the frontend any file the app was launched to open, once and only once.
#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Option<String> {
    state.0.lock().unwrap().take()
}

// Path to the persisted user-preferences file, under the OS per-app config dir
// (macOS: ~/Library/Application Support/<bundle-id>/; Linux: ~/.config/<app>/;
// Windows: %APPDATA%\<app>\). Unlike `.soup` documents (dialog-chosen paths),
// settings live at a fixed, app-owned location — so a plain file here, inspectable
// and durable, rather than webview localStorage which WebKit can silently evict.
fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

// Read the settings file, or None on first run (file not yet written). A missing
// file is a normal state, not an error; other IO failures propagate.
#[tauri::command]
fn read_settings(app: AppHandle) -> Result<Option<String>, String> {
    match std::fs::read_to_string(settings_path(&app)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

// Write the settings file, creating the config dir on first save.
#[tauri::command]
fn write_settings(app: AppHandle, contents: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

// Rebuild the Open Recent submenu from the frontend's list. Menu mutation must
// happen on the main thread, so hop there. Item ids carry the full path
// (`recent:<path>`); the click is routed back to the frontend in `on_menu_event`.
#[tauri::command]
fn set_recent_files(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let recent = handle.state::<RecentMenu>().0.clone();
        let _ = rebuild_recent(&handle, &recent, &paths);
    })
    .map_err(|e| e.to_string())
}

fn rebuild_recent<R: Runtime>(
    app: &AppHandle<R>,
    recent: &Submenu<R>,
    paths: &[String],
) -> tauri::Result<()> {
    for item in recent.items()? {
        recent.remove(&item)?;
    }
    if paths.is_empty() {
        let empty = MenuItem::with_id(app, "recent-empty", "No Recent Files", false, None::<&str>)?;
        return recent.append(&empty);
    }
    for path in paths {
        let label = path.rsplit(['/', '\\']).next().unwrap_or(path);
        let item = MenuItem::with_id(app, format!("recent:{path}"), label, true, None::<&str>)?;
        recent.append(&item)?;
    }
    recent.append(&PredefinedMenuItem::separator(app)?)?;
    let clear = MenuItem::with_id(app, "recent-clear", "Clear Menu", true, None::<&str>)?;
    recent.append(&clear)
}

// Build the native menu bar. File items carry ids + accelerators and are
// handled by emitting an event to the frontend, which owns the scene and does
// the actual serialize/parse. App/Edit use predefined items so the text editor
// gets working cut/copy/paste and the window keeps ⌘Q etc. Returns the Open
// Recent submenu so it can be stashed for later rebuilds.
fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<(Menu<R>, Submenu<R>)> {
    let new = MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?;
    let open = MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?;
    let recent = Submenu::with_id(app, "open-recent", "Open Recent", true)?;
    rebuild_recent(app, &recent, &[])?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(app, "save-as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new,
            &open,
            &recent,
            &PredefinedMenuItem::separator(app)?,
            &save,
            &save_as,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    // App-menu "Settings…" (Cmd/Ctrl+,) opens the native Settings window.
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;

    let app_menu = Submenu::with_items(
        app,
        "soup",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // Undo/redo and cut/copy/paste/select-all are custom (not predefined) so
    // their events reach the frontend, which owns the scene: the accelerators
    // act on the selected *elements* (and the scene history), falling back to
    // native text editing when a label/text editor is focused (see edit-menu.ts).
    let undo = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
    let redo = MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;
    let cut = MenuItem::with_id(app, "cut", "Cut", true, Some("CmdOrCtrl+X"))?;
    let copy = MenuItem::with_id(app, "copy", "Copy", true, Some("CmdOrCtrl+C"))?;
    let paste = MenuItem::with_id(app, "paste", "Paste", true, Some("CmdOrCtrl+V"))?;
    let select_all = MenuItem::with_id(app, "select-all", "Select All", true, Some("CmdOrCtrl+A"))?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo,
            &redo,
            &PredefinedMenuItem::separator(app)?,
            &cut,
            &copy,
            &paste,
            &select_all,
        ],
    )?;

    let menu = Menu::with_items(app, &[&app_menu, &file, &edit])?;
    Ok((menu, recent))
}

// Open the Settings window, or just focus it if it's already open. Its content
// is the frontend's settings.html, shown in its own native window (with a normal
// title bar, unlike the main window's overlay chrome) rather than as an in-canvas
// overlay.
fn open_settings_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window("settings") {
        win.show()?;
        win.set_focus()?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
        .title("Settings")
        .inner_size(360.0, 300.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .center()
        .build()?;
    Ok(())
}

// Buffer a `.soup` path for the frontend to open, and nudge it in case it's
// already running (warm open). Called for both OS `Opened` events and argv.
fn queue_open<R: Runtime>(app: &AppHandle<R>, path: String) {
    *app.state::<PendingOpen>().0.lock().unwrap() = Some(path);
    let _ = app.emit("soup:pending-file", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpen::default())
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            take_pending_open,
            set_recent_files,
            read_settings,
            write_settings
        ])
        .setup(|app| {
            let handle = app.handle();
            let (menu, recent) = build_menu(handle)?;
            app.set_menu(menu)?;
            app.manage(RecentMenu(recent));
            // Windows/Linux deliver the launched file as an argument; macOS
            // uses the `Opened` event handled in `run` instead.
            if let Some(path) = std::env::args().skip(1).find(|a| a.ends_with(".soup")) {
                queue_open(handle, path);
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            match id {
                "settings" => {
                    if let Err(e) = open_settings_window(app) {
                        eprintln!("failed to open settings window: {e}");
                    }
                }
                "new" => drop(app.emit("menu:new", ())),
                "open" => drop(app.emit("menu:open", ())),
                "save" => drop(app.emit("menu:save", ())),
                "save-as" => drop(app.emit("menu:save-as", ())),
                "recent-clear" => drop(app.emit("menu:clear-recent", ())),
                "undo" => drop(app.emit("menu:undo", ())),
                "redo" => drop(app.emit("menu:redo", ())),
                "cut" => drop(app.emit("menu:cut", ())),
                "copy" => drop(app.emit("menu:copy", ())),
                "paste" => drop(app.emit("menu:paste", ())),
                "select-all" => drop(app.emit("menu:select-all", ())),
                _ if id.starts_with("recent:") => {
                    drop(app.emit("menu:open-path", id["recent:".len()..].to_string()));
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        // macOS delivers double-click / "Open With" as an Apple Event, surfaced
        // here — including when the app is already running.
        if let RunEvent::Opened { urls } = event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    queue_open(app, path.to_string_lossy().into_owned());
                }
            }
        }
    });
}
