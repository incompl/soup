// Native "Document" menu wiring: the Line Style and Font submenus (see
// build_document_menu in lib.rs) drive the per-document look. This mirrors the
// two-way sync the Open Recent menu uses — menu clicks come in as events and
// update the store; store changes are pushed back out to keep the menu's
// checkmarks in step.
//
// Like persistence.ts/export.ts this module is native-only: under a plain
// `pnpm dev` browser (no Tauri) its listeners and invoke never resolve, so it
// degrades to a no-op and the Document menu simply isn't there.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { createEffect, onCleanup } from "solid-js";
import type { DocFont, LineStyle } from "./scene";
import { setDocFont, setLineStyle, state } from "./store";

// Wire the Document menu events and mirror the store's settings onto the menu's
// checkmarks. Call once from a component body (needs a reactive owner for the
// effect + cleanup).
export function initDocMenu(): void {
  const unlisten: UnlistenFn[] = [];
  const track = (p: Promise<UnlistenFn>) =>
    p.then((u) => unlisten.push(u)).catch(() => {}); // No backend in browser dev.

  // Re-assert the store's settings onto the menu's checkmarks. A CheckMenuItem
  // toggles its own tick when clicked (before its event even fires), so after
  // every click we must push the authoritative state back — including when the
  // click chose the already-active option (a no-op for the store, but the menu
  // still flipped the checkmark and needs correcting).
  const sync = () => {
    const { lineStyle, font } = state.docSettings;
    void invoke("set_document_settings", { lineStyle, font }).catch(() => {});
  };

  track(
    listen<LineStyle>("menu:set-line-style", (e) => {
      setLineStyle(e.payload);
      sync();
    })
  );
  track(
    listen<DocFont>("menu:set-font", (e) => {
      setDocFont(e.payload);
      sync();
    })
  );
  onCleanup(() => unlisten.forEach((u) => u()));

  // Also mirror the store onto the menu whenever the settings change from any
  // source — in particular when a loaded document replaces them (setScene) — so
  // the checkmarks always match the open document.
  createEffect(sync);
}
