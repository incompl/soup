// The app menu's "Acknowledgements…" item: a native dialog crediting the
// bundled open-source fonts and their license. Not required by the OFL (the
// license texts already ship in src/fonts), just a courtesy nod.
//
// Native-only, like persistence.ts/export.ts: the menu event and dialog go
// through Tauri, so under a plain `pnpm dev` browser this is a no-op.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/plugin-dialog";
import { onCleanup } from "solid-js";
import { FONT_CREDITS } from "./fonts";

function acknowledgementsText(): string {
  const credits = FONT_CREDITS.map((c) => `• ${c.family} — ${c.copyright}\n  ${c.homepage}`).join(
    "\n\n"
  );
  return (
    "soup bundles these open-source fonts, licensed under the " +
    "SIL Open Font License 1.1:\n\n" +
    credits +
    "\n\nThe full license texts are included with the app."
  );
}

// Wire the "Acknowledgements…" menu event to a native dialog. Call once from a
// component body (needs a reactive owner for cleanup).
export function initAcknowledgements(): void {
  const unlisten: UnlistenFn[] = [];
  listen("menu:acknowledgements", () =>
    message(acknowledgementsText(), { title: "Acknowledgements" }).catch(() => {})
  )
    .then((u) => unlisten.push(u))
    .catch(() => {}); // No backend in browser dev.
  onCleanup(() => unlisten.forEach((u) => u()));
}
