// Native save/open for the `.soup` document format, driven by the File menu,
// plus OS "Open With"/double-click and an Open Recent list.
//
// The native format is a small, versioned JSON envelope around the scene's
// SceneElement[] (the app's single source of truth) — lossless and editable,
// unlike the SVG/PNG/PDF *export* targets which flatten it. The `version`
// field is here so the shape can migrate as elements gain properties.
//
// This whole module is native-only: menu events, dialogs, and file IO all go
// through Tauri. Under a plain `pnpm dev` browser it degrades to a no-op.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { notify } from "./notification-store";
import type { SceneElement } from "./scene";
import { markSaved, setScene, state } from "./store";

const DOC_TYPE = "soup";
const DOC_VERSION = 1;
const EXTENSION = "soup";
const FILTERS = [{ name: "Soup drawing", extensions: [EXTENSION] }];

const RECENTS_KEY = "soup.recentFiles";
const RECENTS_MAX = 10;

interface SoupDocument {
  type: typeof DOC_TYPE;
  version: number;
  elements: SceneElement[];
}

// Path of the file backing the current document, or null for an untitled
// (never-saved) one. Drives Save-vs-Save-As and the window title.
const [currentPath, setCurrentPath] = createSignal<string | null>(null);

// Most-recent-first list of absolute paths, mirrored to localStorage and to
// the native Open Recent submenu.
const [recentFiles, setRecentFiles] = createSignal<string[]>(loadRecents());

// Pretty-printed so `.soup` files stay human-diffable and git-friendly.
function serialize(): string {
  const doc: SoupDocument = {
    type: DOC_TYPE,
    version: DOC_VERSION,
    elements: state.elements,
  };
  return JSON.stringify(doc, null, 2);
}

function parse(text: string): SceneElement[] {
  const doc = JSON.parse(text) as Partial<SoupDocument>;
  if (doc?.type !== DOC_TYPE || !Array.isArray(doc.elements)) {
    throw new Error("Not a soup document.");
  }
  return doc.elements as SceneElement[];
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

// A default filename for an export ("Diagram.png"), derived from the open
// document so an exported PNG/SVG sits next to its `.soup` source with a
// matching stem. Falls back to "Untitled" for a never-saved document.
export function suggestedExportName(ext: string): string {
  const path = currentPath();
  const stem = path ? baseName(path).replace(/\.soup$/i, "") : "Untitled";
  return `${stem}.${ext}`;
}

// --- Recent files -----------------------------------------------------------

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

// Persist the list to localStorage and push it to the native menu.
function saveRecents(list: string[]): void {
  setRecentFiles(list);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    // Ignore quota/availability errors — recents are a convenience.
  }
  void invoke("set_recent_files", { paths: list }).catch(() => {});
}

function addRecent(path: string): void {
  saveRecents([path, ...recentFiles().filter((p) => p !== path)].slice(0, RECENTS_MAX));
}

function removeRecent(path: string): void {
  saveRecents(recentFiles().filter((p) => p !== path));
}

function clearRecents(): void {
  saveRecents([]);
}

// --- Dialogs & errors -------------------------------------------------------

// Guard destructive actions (New / Open) behind a prompt when there are
// unsaved changes. Returns true if it's safe to proceed.
async function confirmDiscard(): Promise<boolean> {
  if (!state.dirty) return true;
  return ask("Discard unsaved changes to the current drawing?", {
    title: "Unsaved changes",
    kind: "warning",
  });
}

async function reportError(action: string, err: unknown): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  await message(`Could not ${action}.\n\n${detail}`, { title: "soup", kind: "error" });
}

// --- Document operations ----------------------------------------------------

// Read + load a known path into the store, updating recents. Throws on IO or
// parse failure so callers can report/clean up.
async function loadFromPath(path: string): Promise<void> {
  const elements = parse(await invoke<string>("read_document", { path }));
  setScene(elements);
  setCurrentPath(path);
  addRecent(path);
}

export async function newDocument(): Promise<void> {
  if (!(await confirmDiscard())) return;
  setScene([]);
  setCurrentPath(null);
}

export async function openDocument(): Promise<void> {
  if (!(await confirmDiscard())) return;
  try {
    const path = await openDialog({ multiple: false, directory: false, filters: FILTERS });
    if (typeof path !== "string") return; // Cancelled.
    await loadFromPath(path);
  } catch (err) {
    await reportError("open the drawing", err);
  }
}

// Open a specific path (Open Recent, or an OS "Open With"/double-click).
export async function openPath(path: string): Promise<void> {
  if (currentPath() === path && !state.dirty) return; // Already open, nothing to lose.
  if (!(await confirmDiscard())) return;
  try {
    await loadFromPath(path);
  } catch (err) {
    // A recent file that's since been moved/deleted shouldn't linger.
    removeRecent(path);
    await reportError("open the drawing", err);
  }
}

export async function saveDocument(): Promise<boolean> {
  const path = currentPath();
  if (!path) return saveDocumentAs();
  try {
    await invoke("write_document", { path, contents: serialize() });
    markSaved();
    addRecent(path);
    notify("Saved!", "success");
    return true;
  } catch (err) {
    await reportError("save the drawing", err);
    return false;
  }
}

export async function saveDocumentAs(): Promise<boolean> {
  try {
    const path = await saveDialog({
      filters: FILTERS,
      defaultPath: currentPath() ?? `Untitled.${EXTENSION}`,
    });
    if (typeof path !== "string") return false; // Cancelled.
    await invoke("write_document", { path, contents: serialize() });
    setCurrentPath(path);
    markSaved();
    addRecent(path);
    notify("Saved!", "success");
    return true;
  } catch (err) {
    await reportError("save the drawing", err);
    return false;
  }
}

// Open whatever file the app was launched with (buffered on the Rust side).
async function loadPendingFile(): Promise<void> {
  try {
    const path = await invoke<string | null>("take_pending_open");
    if (path) await openPath(path);
  } catch {
    // No Tauri backend, or nothing pending.
  }
}

// --- Wiring -----------------------------------------------------------------

// Wire up menu events and the reactive window title. Call once from a
// component body (needs a reactive owner for the effect + cleanup).
export function initPersistence(): void {
  // Reflect the current file name and dirty state in the title bar. Reads of
  // currentPath()/state.dirty happen before the first await, so they're
  // tracked. setTitle throws outside Tauri; ignore it in the browser.
  createEffect(() => {
    const name = currentPath() ? baseName(currentPath()!) : "Untitled";
    const title = `${state.dirty ? "• " : ""}${name} — soup`;
    getCurrentWindow().setTitle(title).catch(() => {});
  });

  const unlisten: UnlistenFn[] = [];
  const track = (p: Promise<UnlistenFn>) =>
    p.then((u) => unlisten.push(u)).catch(() => {}); // No backend in browser dev.

  track(listen("menu:new", () => void newDocument()));
  track(listen("menu:open", () => void openDocument()));
  track(listen("menu:save", () => void saveDocument()));
  track(listen("menu:save-as", () => void saveDocumentAs()));
  track(listen<string>("menu:open-path", (e) => void openPath(e.payload)));
  track(listen("menu:clear-recent", () => clearRecents()));
  track(listen("soup:pending-file", () => void loadPendingFile()));
  onCleanup(() => unlisten.forEach((u) => u()));

  // Seed the native Open Recent menu from storage, and open any file the app
  // was launched with (double-click / "Open With").
  void invoke("set_recent_files", { paths: recentFiles() }).catch(() => {});
  void loadPendingFile();
}
