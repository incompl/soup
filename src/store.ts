import { createStore, produce } from "solid-js/store";
import type { SceneElement, Tool } from "./scene";

interface AppState {
  elements: SceneElement[];
  selectedId: string | null;
  tool: Tool;
}

const [state, setState] = createStore<AppState>({
  elements: [],
  selectedId: null,
  tool: "select",
});

export { state };

export function setTool(tool: Tool) {
  setState({ tool, selectedId: null });
}

export function addElement(el: SceneElement) {
  setState(
    produce((s) => {
      s.elements.push(el);
    })
  );
}

export function updateElement(id: string, patch: Partial<SceneElement>) {
  setState(
    produce((s) => {
      const el = s.elements.find((e) => e.id === id);
      if (el) Object.assign(el, patch);
    })
  );
}

export function removeElement(id: string) {
  setState(
    produce((s) => {
      s.elements = s.elements.filter((e) => e.id !== id);
      if (s.selectedId === id) s.selectedId = null;
    })
  );
}

export function select(id: string | null) {
  setState("selectedId", id);
}
