import { createStore, produce, unwrap } from "solid-js/store";
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

// --- Undo / redo -------------------------------------------------------------
//
// History is a pair of stacks of whole-scene snapshots (elements + selection).
// A snapshot is a deep clone, so restoring one can't alias live store data.
//
// One user action = one undo step. Discrete mutations (delete, cut, paste, new
// text, label commit) each record themselves. Gestures that write many times —
// a drag's per-pointermove updates, a text edit's per-keystroke writes — instead
// bracket themselves with beginHistory()/commitHistory(): the baseline is
// snapshotted once at the start, per-mutation recording is suppressed in
// between, and a single entry is sealed at the end (and only if the scene
// actually changed, so a click that draws nothing leaves no dead step).

interface Snapshot {
  elements: SceneElement[];
  selectedIds: string[];
}

const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
// The pre-gesture scene while a gesture is open; null otherwise. Its presence
// both marks a gesture in progress (suppressing per-mutation recording) and
// holds the state a commit would push.
let gestureBaseline: Snapshot | null = null;
// Cap the depth so a long session can't grow history without bound.
const HISTORY_LIMIT = 100;

function snapshot(): Snapshot {
  return {
    elements: structuredClone(unwrap(state.elements)) as SceneElement[],
    selectedIds: [...state.selectedIds],
  };
}

// Push the current scene as a restore point, before an undoable change — unless
// a gesture is open, in which case its commit owns the single entry. Clears the
// redo stack: a fresh edit forks history.
function record() {
  if (gestureBaseline) return;
  undoStack.push(snapshot());
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

function elementsChanged(a: SceneElement[], b: SceneElement[]): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

function restore(s: Snapshot) {
  setState(
    produce((st) => {
      // Clone out of the stack so future undos/redos of the same entry stay
      // independent of the now-live objects.
      st.elements = structuredClone(s.elements);
      st.selectedIds = [...s.selectedIds];
      st.dirty = true;
    })
  );
}

// Open a gesture: remember the scene as it stands so the whole gesture collapses
// to one undo step. Idempotent — a gesture that re-enters keeps the earliest
// baseline.
export function beginHistory() {
  if (!gestureBaseline) gestureBaseline = snapshot();
}

// Seal an open gesture into a single undo entry, if it changed the scene.
// A no-op when no gesture is open, or when nothing actually changed.
export function commitHistory() {
  const base = gestureBaseline;
  gestureBaseline = null;
  if (!base) return;
  if (!elementsChanged(base.elements, unwrap(state.elements) as SceneElement[])) return;
  undoStack.push(base);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

export function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(snapshot());
  restore(prev);
}

export function redo() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snapshot());
  restore(next);
}

export function setTool(tool: Tool) {
  setState({ tool, selectedIds: [] });
}

export function addElement(el: SceneElement) {
  record();
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
  record();
  setState(
    produce((s) => {
      s.elements.push(...els);
      reconcileBindings(s.elements);
      s.dirty = true;
    })
  );
}

export function updateElement(id: string, patch: Partial<SceneElement>) {
  record();
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
  record();
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
  record();
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
  // A freshly loaded (or new) document is a fresh history: you can't undo back
  // into the previous document.
  undoStack.length = 0;
  redoStack.length = 0;
  gestureBaseline = null;
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
