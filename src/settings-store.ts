// User preferences that persist across sessions, independent of any open
// document. Stored as a JSON file in the OS per-app config dir, via the Rust
// read_settings/write_settings commands — inspectable, backup-able, and immune
// to the webview localStorage eviction that can silently drop web-stored state.
//
// The disk read is async, so the store starts at defaults and hydrates when the
// file lands. That's invisible in practice: the only consumer (the tool
// shortcut scheme) is read when a key is pressed or a tooltip shown, long after
// startup. Under `pnpm dev` there's no backend, so it simply stays at defaults.
//
// The Settings UI lives in its own native window (settings.html), so the main
// canvas window and the settings window each hold a separate copy of this store.
// A change made in one is broadcast to the other over the `settings:changed`
// event so preferences (e.g. the shortcut scheme) take effect live, without a
// reload or restart.

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { createStore } from "solid-js/store";
import type { ShortcutScheme } from "./shortcuts";

interface Settings {
  shortcutScheme: ShortcutScheme;
}

const DEFAULTS: Settings = {
  shortcutScheme: "gamer",
};

const [settings, setSettings] = createStore<Settings>({ ...DEFAULTS });

export { settings };

// Coerce a parsed-from-disk value into a valid scheme, dropping anything stale
// or malformed back to the default.
function coerceScheme(value: unknown): ShortcutScheme {
  return value === "gamer" || value === "normal" ? value : DEFAULTS.shortcutScheme;
}

// Flipped true once the initial disk read resolves. Until then we don't persist
// (nothing meaningful to save yet); `touched` guards the rare case where the
// user changes a setting before that read lands.
let hydrated = false;
let touched = false;

function persist(): void {
  // Fire-and-forget: a failed write (e.g. no backend under `pnpm dev`) just
  // means the preference lives for this session only.
  void invoke("write_settings", { contents: JSON.stringify(settings) }).catch(() => {});
}

async function hydrate(): Promise<void> {
  try {
    const raw = await invoke<string | null>("read_settings");
    // Don't let a late-landing read clobber a change the user already made.
    if (raw && !touched) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      setSettings("shortcutScheme", coerceScheme(saved.shortcutScheme));
    }
  } catch {
    // No backend (browser dev) or an unreadable/corrupt file: keep defaults.
  } finally {
    hydrated = true;
    if (touched) persist(); // Flush a change that beat the initial read.
  }
}

void hydrate();

// A change in the other window: apply it to the local store only — no persist,
// no re-emit — so the two windows stay in sync without an echo loop.
listen<Settings>("settings:changed", (e) => {
  setSettings("shortcutScheme", coerceScheme(e.payload.shortcutScheme));
}).catch(() => {}); // No backend under `pnpm dev`.

export function setShortcutScheme(scheme: ShortcutScheme): void {
  setSettings("shortcutScheme", scheme);
  touched = true;
  if (hydrated) persist();
  // Push the change to the other window (see `settings:changed` listener above).
  void emit("settings:changed", { ...settings }).catch(() => {});
}
