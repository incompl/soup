import { createStore, produce } from "solid-js/store";
import { reconcileBindings, type SceneElement, type Tool } from "./scene";

interface AppState {
  elements: SceneElement[];
  // Ids of the currently selected elements. Empty when nothing is selected;
  // a single id for the common case; several for a multi-selection built by
  // shift-clicking or Select All. Order is not meaningful.
  selectedIds: string[];
  tool: Tool;
  // Unsaved-changes flag: set by any element mutation, cleared on save/load.
  // The document persistence layer (persistence.ts) reads it to drive the
  // title bar's dirty marker and the "discard changes?" prompt.
  dirty: boolean;
}

const [state, setState] = createStore<AppState>({
  elements: [],
  selectedIds: [],
  tool: "select",
  dirty: false,
});

export { state };

export function setTool(tool: Tool) {
  setState({ tool, selectedIds: [] });
}

export function addElement(el: SceneElement) {
  setState(
    produce((s) => {
      s.elements.push(el);
      s.dirty = true;
    })
  );
}

// Append several elements at once (e.g. a paste), reconciling bindings a single
// time so pasted arrows resolve against their pasted rectangles.
export function addElements(els: SceneElement[]) {
  if (!els.length) return;
  setState(
    produce((s) => {
      s.elements.push(...els);
      reconcileBindings(s.elements);
      s.dirty = true;
    })
  );
}

export function updateElement(id: string, patch: Partial<SceneElement>) {
  setState(
    produce((s) => {
      const el = s.elements.find((e) => e.id === id);
      if (el) {
        Object.assign(el, patch);
        // Moving/resizing a rectangle drags its bound arrow endpoints along;
        // editing an arrow endpoint's binding snaps it into place.
        reconcileBindings(s.elements);
        s.dirty = true;
      }
    })
  );
}

// Apply several patches in one pass, reconciling bindings once at the end. Used
// to move a whole multi-selection together so bound arrows resolve against the
// rectangles' final positions, not intermediate ones.
export function updateElements(patches: { id: string; patch: Partial<SceneElement> }[]) {
  if (!patches.length) return;
  setState(
    produce((s) => {
      for (const { id, patch } of patches) {
        const el = s.elements.find((e) => e.id === id);
        if (el) Object.assign(el, patch);
      }
      reconcileBindings(s.elements);
      s.dirty = true;
    })
  );
}

export function removeElement(id: string) {
  removeElements([id]);
}

// Remove several elements at once (Delete on a multi-selection, or the delete
// half of a Cut). Selection drops the removed ids; dangling bindings are cleaned
// up by reconcileBindings.
export function removeElements(ids: string[]) {
  if (!ids.length) return;
  const drop = new Set(ids);
  setState(
    produce((s) => {
      s.elements = s.elements.filter((e) => !drop.has(e.id));
      s.selectedIds = s.selectedIds.filter((id) => !drop.has(id));
      // Arrows bound to a removed rectangle keep their position but drop the
      // now-dangling binding.
      reconcileBindings(s.elements);
      s.dirty = true;
    })
  );
}

// Replace the whole scene, e.g. after opening a file or starting a new
// document. Resets selection and clears the dirty flag since the store now
// matches what's on disk (or a fresh empty document).
export function setScene(elements: SceneElement[]) {
  setState(
    produce((s) => {
      s.elements = elements;
      s.selectedIds = [];
      // Normalize any bound endpoints against their rectangles (and drop
      // dangling bindings) as the freshly loaded document comes in.
      reconcileBindings(s.elements);
      s.dirty = false;
    })
  );
}

// Clear the dirty flag after a successful save without touching elements.
export function markSaved() {
  setState("dirty", false);
}

// Select exactly one element, or clear the selection with null. The common case
// for a plain click.
export function select(id: string | null) {
  setState("selectedIds", id ? [id] : []);
}

// Replace the selection with a specific set of ids (e.g. selecting freshly
// pasted elements).
export function selectMany(ids: string[]) {
  setState("selectedIds", [...ids]);
}

// Add or remove an element from the selection, for shift-clicking.
export function toggleSelect(id: string) {
  setState("selectedIds", (ids) =>
    ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]
  );
}

// Select every element in the scene (Select All).
export function selectAll() {
  setState("selectedIds", state.elements.map((e) => e.id));
}
