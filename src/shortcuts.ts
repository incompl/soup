// The two keyboard-shortcut schemes for picking a tool, and the helpers that
// map a pressed key to a tool (and back, for the toolbar's tooltip). The active
// scheme is a persisted user setting — see settings-store.ts.

import type { Tool } from "./scene";

export type ShortcutScheme = "normal" | "gamer";

// Tools in toolbar order. The number keys 1-4 pick by this position in every
// scheme; the letter keys below line up index-for-index with it.
export const TOOL_ORDER: Tool[] = ["select", "rect", "arrow", "text"];

// Per-scheme letter key for each tool, indexed by TOOL_ORDER.
const LETTER_KEYS: Record<ShortcutScheme, string[]> = {
  // Mnemonic letters — the Excalidraw/Figma/tldraw convention (V=select,
  // R=rect, A=arrow, T=text).
  normal: ["v", "r", "a", "t"],
  // Home-row cluster for a left-hand-on-keyboard, right-hand-on-mouse posture.
  gamer: ["a", "s", "d", "f"],
};

export const SCHEME_LABELS: Record<ShortcutScheme, string> = {
  normal: "Normal",
  gamer: "Gamer",
};

// Resolve a pressed key to the tool it selects under `scheme`, or null. Number
// keys 1-4 pick by toolbar position regardless of scheme.
export function toolForKey(key: string, scheme: ShortcutScheme): Tool | null {
  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= TOOL_ORDER.length) return TOOL_ORDER[n - 1];
  const i = LETTER_KEYS[scheme].indexOf(key);
  return i >= 0 ? TOOL_ORDER[i] : null;
}

// The (upper-cased) letter key shown in the toolbar tooltip for `tool` under
// the active scheme.
export function keyForTool(tool: Tool, scheme: ShortcutScheme): string {
  return LETTER_KEYS[scheme][TOOL_ORDER.indexOf(tool)].toUpperCase();
}
