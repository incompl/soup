import { createStore, produce } from "solid-js/store";
import type { SceneElement, Tool } from "./scene";

interface AppState {
  elements: SceneElement[];
  selectedId: string | null;
  tool: Tool;
  // Unsaved-changes flag: set by any element mutation, cleared on save/load.
  // The document persistence layer (persistence.ts) reads it to drive the
  // title bar's dirty marker and the "discard changes?" prompt.
  dirty: boolean;
}

const [state, setState] = createStore<AppState>({
  elements: [],
  selectedId: null,
  tool: "select",
  dirty: false,
});

export { state };

export function setTool(tool: Tool) {
  setState({ tool, selectedId: null });
}

export function addElement(el: SceneElement) {
  setState(
    produce((s) => {
      s.elements.push(el);
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
        s.dirty = true;
      }
    })
  );
}

export function removeElement(id: string) {
  setState(
    produce((s) => {
      s.elements = s.elements.filter((e) => e.id !== id);
      if (s.selectedId === id) s.selectedId = null;
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
      s.selectedId = null;
      s.dirty = false;
    })
  );
}

// Clear the dirty flag after a successful save without touching elements.
export function markSaved() {
  setState("dirty", false);
}

export function select(id: string | null) {
  setState("selectedId", id);
}
