// Routes the Edit menu's clipboard/selection actions to the right place.
//
// The native menu items (see the Rust `build_menu`) carry Cmd/Ctrl accelerators
// and emit `menu:*` events. Those accelerators are swallowed by the menu before
// the webview sees them, so this module owns *both* paths:
//   - Tauri: `menu:*` events (menu click or accelerator).
//   - Plain browser dev (no native menu): a window keydown fallback.
//
// Every action first checks whether a text field is focused. If so it defers to
// native text editing (a label/text editor is open); otherwise it acts on the
// scene's selected elements.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { copySelection, cutSelection, paste } from "./clipboard";
import { redo, selectAll, undo } from "./store";

type EditAction = "copy" | "cut" | "paste" | "select-all" | "undo" | "redo";

function focusedTextField(): HTMLTextAreaElement | HTMLInputElement | null {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement ? el : null;
}

// Perform an action on the canvas selection.
function runOnCanvas(action: EditAction) {
  switch (action) {
    case "copy":
      copySelection();
      break;
    case "cut":
      cutSelection();
      break;
    case "paste":
      paste();
      break;
    case "select-all":
      selectAll();
      break;
    case "undo":
      undo();
      break;
    case "redo":
      redo();
      break;
  }
}

// Perform an action on a focused text field. The menu ate the accelerator, so
// the textarea's own copy/cut/paste/select-all won't fire on their own —
// re-issue them here.
function runOnTextField(action: EditAction, field: HTMLTextAreaElement | HTMLInputElement) {
  if (action === "select-all") {
    field.select();
  } else {
    // execCommand is deprecated on the web but remains the reliable way to
    // drive the focused editable's clipboard (and its native undo/redo) inside
    // the Tauri webview.
    document.execCommand(action);
  }
}

// The menu path: fires for both a menu click and its accelerator, regardless of
// what's focused, so it must handle the text-field case itself.
function dispatch(action: EditAction) {
  const field = focusedTextField();
  if (field) runOnTextField(action, field);
  else runOnCanvas(action);
}

// The keydown path only runs in plain-browser dev (no native menu to intercept
// the accelerator). When a text field is focused we leave the event alone so
// the browser's built-in editing handles it.
function acceleratorAction(e: KeyboardEvent): EditAction | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case "c":
      return "copy";
    case "x":
      return "cut";
    case "v":
      return "paste";
    case "a":
      return "select-all";
    case "z":
      // Cmd/Ctrl+Z undoes; Shift adds redo (the mac convention).
      return e.shiftKey ? "redo" : "undo";
    case "y":
      // Windows/Linux redo.
      return e.shiftKey ? null : "redo";
    default:
      return null;
  }
}

function onKeyDown(e: KeyboardEvent) {
  const action = acceleratorAction(e);
  if (!action) return;
  if (focusedTextField()) return; // Let the browser edit text natively.
  e.preventDefault();
  runOnCanvas(action);
}

// Wire up both paths. Returns a cleanup that removes them; call once from a
// component with a reactive owner (see Canvas).
export function initEditMenu(): () => void {
  window.addEventListener("keydown", onKeyDown);

  const unlisten: UnlistenFn[] = [];
  const actions: EditAction[] = ["copy", "cut", "paste", "select-all", "undo", "redo"];
  for (const action of actions) {
    // No Tauri backend under `pnpm dev` — listen() rejects; ignore it there.
    listen(`menu:${action}`, () => dispatch(action))
      .then((u) => unlisten.push(u))
      .catch(() => {});
  }

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    unlisten.forEach((u) => u());
  };
}
