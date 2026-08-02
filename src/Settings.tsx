// The Settings window's content, rendered into its own native window
// (settings.html) opened from the app menu's "Settings…" item (⌘,) — see
// `open_settings_window` in lib.rs. Not a modal overlay: it fills the window,
// and ⌘W or Escape close it. Currently exposes one preference: the
// keyboard-shortcut scheme for the tools.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { For, onCleanup, onMount } from "solid-js";
import { setShortcutScheme, settings } from "./settings-store";
import { keyForTool, SCHEME_LABELS, TOOL_ORDER, type ShortcutScheme } from "./shortcuts";
import "./Settings.css";

const SCHEMES: ShortcutScheme[] = ["normal", "gamer"];

const TOOL_LABELS: Record<(typeof TOOL_ORDER)[number], string> = {
  select: "Select",
  rect: "Rectangle",
  arrow: "Arrow",
  text: "Text",
};

export default function Settings() {
  onMount(() => {
    // Escape closes the window, matching ⌘W. Under `pnpm dev` (plain browser,
    // no Tauri) there's no native window to close, so the call is a no-op.
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") getCurrentWindow().close().catch(() => {});
  }

  const scheme = () => settings.shortcutScheme;

  return (
    <main class="settings">
      <div class="settings-row">
        <label for="shortcut-scheme">Keyboard shortcuts</label>
        <select
          id="shortcut-scheme"
          value={scheme()}
          onChange={(e) => setShortcutScheme(e.currentTarget.value as ShortcutScheme)}
        >
          <For each={SCHEMES}>{(s) => <option value={s}>{SCHEME_LABELS[s]}</option>}</For>
        </select>
      </div>

      {/* Show the letter each tool binds to under the chosen scheme; the
          number keys 1-4 work in every scheme. */}
      <ul class="settings-keymap">
        <For each={TOOL_ORDER}>
          {(tool, i) => (
            <li>
              <span>{TOOL_LABELS[tool]}</span>
              <kbd>{keyForTool(tool, scheme())}</kbd>
              <span class="settings-keymap-alt">or {i() + 1}</span>
            </li>
          )}
        </For>
      </ul>
    </main>
  );
}
