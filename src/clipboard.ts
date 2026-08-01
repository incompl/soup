// Copy / cut / paste of scene elements. The clipboard is an in-app buffer of
// serialized elements — the app owns the data model, and the native Edit menu's
// clipboard items only ever act on focused text fields (see edit-menu.ts), so
// there's nothing to hand off to the OS clipboard here.

import { newId, type ArrowElement, type SceneElement } from "./scene";
import { addElements, removeElements, selectMany, state } from "./store";

// Deep-cloned snapshots of the last copied/cut elements. JSON round-trips keep
// them detached from the live store and drop any `undefined` optionals, matching
// how documents are serialized.
let clipboard: SceneElement[] = [];

// Each paste lands this far down-right of the source, so a pasted copy doesn't
// hide exactly on top of its original and repeated pastes cascade.
const PASTE_OFFSET = 16;

function clone(els: readonly SceneElement[]): SceneElement[] {
  return JSON.parse(JSON.stringify(els)) as SceneElement[];
}

function selectedElements(): SceneElement[] {
  return state.elements.filter((el) => state.selectedIds.includes(el.id));
}

export function copySelection() {
  const els = selectedElements();
  if (els.length) clipboard = clone(els);
}

export function cutSelection() {
  const els = selectedElements();
  if (!els.length) return;
  clipboard = clone(els);
  removeElements(els.map((el) => el.id));
}

export function hasClipboard(): boolean {
  return clipboard.length > 0;
}

// Translate an element by (dx, dy), remapping arrow bindings onto the pasted
// copies. A binding to a rectangle that was also copied points at that copy;
// one to a rectangle left behind is dropped, so the pasted arrow keeps its
// offset geometry instead of snapping back to the original rectangle.
function pasteClone(el: SceneElement, dx: number, dy: number, idMap: Map<string, string>): SceneElement {
  const copy = { ...el, id: idMap.get(el.id)! };
  switch (copy.type) {
    case "rect":
    case "text":
      copy.x += dx;
      copy.y += dy;
      break;
    case "arrow": {
      copy.x1 += dx;
      copy.y1 += dy;
      copy.x2 += dx;
      copy.y2 += dy;
      remapBinding(copy, "startBinding", idMap);
      remapBinding(copy, "endBinding", idMap);
      break;
    }
  }
  return copy;
}

function remapBinding(arrow: ArrowElement, key: "startBinding" | "endBinding", idMap: Map<string, string>) {
  const binding = arrow[key];
  if (!binding) return;
  const mapped = idMap.get(binding.elementId);
  arrow[key] = mapped ? { ...binding, elementId: mapped } : undefined;
}

export function paste() {
  if (!clipboard.length) return;
  // Fresh ids for the copies, mapped from the source ids so bindings can be
  // rewired to point within the pasted set.
  const idMap = new Map(clipboard.map((el) => [el.id, newId()]));
  const copies = clipboard.map((el) => pasteClone(el, PASTE_OFFSET, PASTE_OFFSET, idMap));
  addElements(copies);
  selectMany(copies.map((el) => el.id));
  // Cascade the next paste further out from these copies.
  clipboard = clone(copies);
}
