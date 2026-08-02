import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { FONT, LINE_HEIGHT, newId, elementAt, elementsInBox, handleAt, nearestAnchor, type AnchorSide, type HandlePos, type SceneElement } from "./scene";
import { renderScene } from "./renderer";
import { initEditMenu } from "./edit-menu";
import { settings } from "./settings-store";
import { toolForKey } from "./shortcuts";
import {
  addElement,
  removeElements,
  select,
  selectMany,
  setTool,
  state,
  toggleSelect,
  updateElement,
  updateElements,
} from "./store";

interface DragState {
  startX: number;
  startY: number;
  // Snapshots of every element taking part in the drag, taken at drag start so
  // move deltas are computed from a fixed origin. A move carries the whole
  // selection (group move); a resize or a fresh draw carries a single element.
  originals: SceneElement[];
  // Set when the drag started on a resize handle: the (single) element is being
  // reshaped (corner/endpoint follows the pointer) rather than moved.
  handle?: HandlePos;
  // Set when the press landed on an element already part of a multi-selection.
  // The mouse-down keeps the whole selection (so a group drag can start), but a
  // plain click — down then up without a real drag — collapses to just this one
  // on pointer-up, matching Figma/Sketch/Illustrator/etc.
  collapseId?: string;
}

interface TextDraft {
  x: number;
  y: number;
}

// Editing the centered label of an existing rect/arrow (double-click). The
// center + initial text are snapshotted at open; the element doesn't move
// while its editor is up.
interface LabelEdit {
  id: string;
  cx: number;
  cy: number;
  initial: string;
}

// Center point of a labelable element, where its label editor is anchored.
function elementCenter(el: SceneElement): { cx: number; cy: number } {
  switch (el.type) {
    case "rect":
      return { cx: el.x + el.w / 2, cy: el.y + el.h / 2 };
    case "arrow":
      return { cx: (el.x1 + el.x2) / 2, cy: (el.y1 + el.y2) / 2 };
    case "text":
      return { cx: el.x, cy: el.y };
  }
}

// Pointer prediction: extrapolate the cursor one frame ahead by its
// smoothed velocity to offset the event->present pipeline latency
// (~2-3 frames between the OS cursor and canvas content). Clamped so
// direction changes don't visibly overshoot. Toggle with "p" to A/B.
const PREDICT_MS = 16;
const PREDICT_MAX_PX = 12;
const VELOCITY_BLEND = 0.4;

// A pointer that travels less than this between down and up counts as a click,
// not a drag — the slack absorbs the tiny jitter of a physical press.
const CLICK_SLOP_PX = 4;

// The draggable ".titlebar" strip (see App.css) sits above the canvas and
// swallows pointer events in the top band. An element moved entirely under
// it can never be clicked again, so clamp moves to keep an element's top at
// or below this edge, leaving it fully selectable.
const TITLEBAR_HEIGHT = 28;

// Topmost y of an element, used to clamp how far up it can be moved.
function elementTop(el: SceneElement): number {
  switch (el.type) {
    case "rect":
    case "text":
      return el.y;
    case "arrow":
      return Math.min(el.y1, el.y2);
  }
}

// Patch that translates an element by (dx, dy), shaped to its type. Used to
// move each member of a selection by the same delta in one store update.
function movePatch(el: SceneElement, dx: number, dy: number): Partial<SceneElement> {
  switch (el.type) {
    case "rect":
    case "text":
      return { x: el.x + dx, y: el.y + dy };
    case "arrow":
      return { x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
  }
}

// Leftmost x of an element. An element moved past the left window edge is
// stranded off-canvas with no way to reveal it, so moves clamp to keep this
// at or right of x = 0.
function elementLeft(el: SceneElement): number {
  switch (el.type) {
    case "rect":
    case "text":
      return el.x;
    case "arrow":
      return Math.min(el.x1, el.x2);
  }
}

// Reshape a rectangle by dragging one corner handle to (px, py), deriving the
// result from the drag-start snapshot so the opposite corner stays pinned for
// the whole gesture (crossing it just flips the rect naturally). Arrow
// endpoints are placed separately (see placeArrowEndpoint) since they can bind.
function resizeElement(id: string, original: SceneElement, handle: HandlePos, px: number, py: number) {
  if (original.type !== "rect") return;
  let left = original.x;
  let right = original.x + original.w;
  let top = original.y;
  let bottom = original.y + original.h;
  if (handle.includes("w")) left = px;
  if (handle.includes("e")) right = px;
  if (handle.includes("n")) top = py;
  if (handle.includes("s")) bottom = py;
  updateElement(id, {
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    w: Math.abs(right - left),
    h: Math.abs(bottom - top),
  });
}

interface PointerSample {
  x: number;
  y: number;
  t: number;
  vx: number;
  vy: number;
}

export default function Canvas() {
  let canvasEl!: HTMLCanvasElement;
  let containerEl!: HTMLDivElement;
  let textareaEl: HTMLTextAreaElement | undefined;
  let labelEl: HTMLTextAreaElement | undefined;

  const [size, setSize] = createSignal({ w: 0, h: 0, dpr: 1 });
  const [textDraft, setTextDraft] = createSignal<TextDraft | null>(null);
  const [labelEdit, setLabelEdit] = createSignal<LabelEdit | null>(null);
  // Live text in the label editor, so the render effect can break the arrow
  // shaft around what's being typed (not just the committed label).
  const [labelText, setLabelText] = createSignal("");
  // While an arrow endpoint is being placed (a new arrow drawn, or an existing
  // end re-dragged), rectangles reveal their attachment spots and activeAnchor
  // tracks the spot the endpoint would lock onto right now.
  const [placingEnd, setPlacingEnd] = createSignal(false);
  const [activeAnchor, setActiveAnchor] = createSignal<{ elementId: string; side: AnchorSide } | null>(null);
  // The in-progress drag-to-select marquee: a fixed start corner (x0, y0) and
  // the moving corner (x1, y1), plus the selection to union with (non-empty
  // only for a shift-drag, which adds to what was already selected). Null when
  // no marquee is being dragged.
  const [marquee, setMarquee] = createSignal<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
    base: string[];
  } | null>(null);

  let drag: DragState | null = null;
  let lastSample: PointerSample | null = null;

  onMount(() => {
    const observer = new ResizeObserver(() => {
      const rect = containerEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvasEl.width = Math.round(rect.width * dpr);
      canvasEl.height = Math.round(rect.height * dpr);
      setSize({ w: rect.width, h: rect.height, dpr });
    });
    observer.observe(containerEl);
    onCleanup(() => observer.disconnect());

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));

    // Copy/cut/paste/select-all, from either the native Edit menu or their
    // keyboard shortcuts.
    onCleanup(initEditMenu());
  });

  createEffect(() => {
    const { w, h, dpr } = size();
    const ctx = canvasEl.getContext("2d");
    if (!ctx || w === 0) return;
    renderScene(
      ctx,
      state.elements,
      state.selectedIds,
      w,
      h,
      dpr,
      labelEdit()?.id ?? null,
      labelText(),
      // Reveal attachment spots while placing an endpoint, and also whenever the
      // arrow tool is active so the initial click can start bound to a spot.
      placingEnd() || state.tool === "arrow",
      activeAnchor(),
      marquee()
    );
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    // Tool shortcuts depend on the active scheme (normal letters vs. home-row);
    // number keys 1-4 work in either. See shortcuts.ts.
    const tool = toolForKey(e.key, settings.shortcutScheme);
    if (tool) {
      setTool(tool);
      return;
    }
    switch (e.key) {
      case "Delete":
      case "Backspace":
        if (state.selectedIds.length) removeElements(state.selectedIds);
        break;
      case "Escape":
        select(null);
        break;
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (textDraft()) return; // Textarea blur handles the commit.
    // A click that reaches the canvas is outside the label editor (clicks
    // inside it hit the textarea — see .label-editor's stacking). Commit the
    // label, then let this click do its normal thing: select, draw, deselect.
    if (labelEdit()) commitLabel();
    canvasEl.setPointerCapture(e.pointerId);
    const { offsetX: x, offsetY: y } = e;
    lastSample = { x, y, t: e.timeStamp, vx: 0, vy: 0 };

    switch (state.tool) {
      case "select": {
        // Resize handles belong to a lone selection; grabbing one takes
        // priority over selecting/moving whatever is underneath it.
        const solo =
          state.selectedIds.length === 1
            ? state.elements.find((el) => el.id === state.selectedIds[0])
            : undefined;
        const grabbed = solo ? handleAt(solo, x, y) : null;
        if (solo && grabbed) {
          drag = { originals: [{ ...solo }], startX: x, startY: y, handle: grabbed };
          // Re-dragging an arrow endpoint can re-bind it, so light up the spots.
          if (solo.type === "arrow" && (grabbed === "start" || grabbed === "end")) {
            setPlacingEnd(true);
          }
          break;
        }
        const hit = elementAt(state.elements, x, y);
        // Pressing empty space starts a drag-to-select marquee. A plain drag
        // replaces the selection; a shift-drag adds to it (base = current
        // selection). A press without a drag falls through to a plain click:
        // clear on plain, keep on shift (both handled by the live update below,
        // which selects nothing extra when the box is empty).
        if (!hit) {
          setMarquee({ x0: x, y0: y, x1: x, y1: y, base: e.shiftKey ? [...state.selectedIds] : [] });
          if (!e.shiftKey) select(null);
          break;
        }
        // Shift-click extends the selection without moving anything.
        if (e.shiftKey) {
          toggleSelect(hit.id);
          break;
        }
        // Clicking an already-selected element keeps the (possibly multi)
        // selection so it can be dragged as a group; anything else replaces it.
        // For a click that lands inside a multi-selection, defer collapsing to
        // this one element until pointer-up (see collapseId), so the mouse-down
        // can still begin a group drag.
        const alreadySelected = state.selectedIds.includes(hit.id);
        if (!alreadySelected) {
          select(hit.id);
        }
        const originals = state.selectedIds
          .map((id) => state.elements.find((el) => el.id === id))
          .filter((el): el is SceneElement => !!el)
          .map((el) => ({ ...el }));
        drag = {
          originals,
          startX: x,
          startY: y,
          collapseId: alreadySelected && state.selectedIds.length > 1 ? hit.id : undefined,
        };
        break;
      }
      case "rect": {
        const el: SceneElement = { id: newId(), type: "rect", x, y, w: 0, h: 0 };
        addElement(el);
        drag = { originals: [el], startX: x, startY: y };
        break;
      }
      case "arrow": {
        // A new arrow can start bound: if the press lands on a spot, anchor its
        // tail there, otherwise start free at the pointer.
        const spot = nearestAnchor(state.elements, x, y);
        setPlacingEnd(true);
        setActiveAnchor(spot ? { elementId: spot.elementId, side: spot.side } : null);
        const el: SceneElement = {
          id: newId(),
          type: "arrow",
          x1: spot ? spot.x : x,
          y1: spot ? spot.y : y,
          x2: spot ? spot.x : x,
          y2: spot ? spot.y : y,
          startBinding: spot ? { elementId: spot.elementId, side: spot.side } : undefined,
        };
        addElement(el);
        drag = { originals: [el], startX: x, startY: y };
        break;
      }
      case "text":
        // Keep the browser's default focus change from blurring the
        // textarea the moment it appears.
        e.preventDefault();
        setTextDraft({ x, y });
        requestAnimationFrame(() => textareaEl?.focus());
        break;
    }
  }

  function predictPointer(e: PointerEvent): { x: number; y: number } {
    const { offsetX: x, offsetY: y } = e;
    const prev = lastSample;
    const t = e.timeStamp;
    const dt = prev ? t - prev.t : 0;
    if (!prev || dt <= 0) {
      lastSample = { x, y, t, vx: 0, vy: 0 };
      return { x, y };
    }
    const vx = prev.vx + ((x - prev.x) / dt - prev.vx) * VELOCITY_BLEND;
    const vy = prev.vy + ((y - prev.y) / dt - prev.vy) * VELOCITY_BLEND;
    lastSample = { x, y, t, vx, vy };
    let px = vx * PREDICT_MS;
    let py = vy * PREDICT_MS;
    const len = Math.hypot(px, py);
    if (len > PREDICT_MAX_PX) {
      px *= PREDICT_MAX_PX / len;
      py *= PREDICT_MAX_PX / len;
    }
    return { x: x + px, y: y + py };
  }

  // Place an arrow endpoint at (px, py), snapping to a rectangle attachment
  // spot when one is in range: bound → coordinates come from the spot and the
  // binding is recorded; free → coordinates follow the pointer and any existing
  // binding is cleared. Also updates the active-spot highlight shown while
  // placing. Shared by drawing a new arrow and re-dragging an existing end.
  function placeArrowEndpoint(id: string, which: "start" | "end", px: number, py: number) {
    const spot = nearestAnchor(state.elements, px, py);
    setActiveAnchor(spot ? { elementId: spot.elementId, side: spot.side } : null);
    if (which === "start") {
      updateElement(
        id,
        spot
          ? { x1: spot.x, y1: spot.y, startBinding: { elementId: spot.elementId, side: spot.side } }
          : { x1: px, y1: py, startBinding: undefined }
      );
    } else {
      updateElement(
        id,
        spot
          ? { x2: spot.x, y2: spot.y, endBinding: { elementId: spot.elementId, side: spot.side } }
          : { x2: px, y2: py, endBinding: undefined }
      );
    }
  }

  // Cursor to show when hovering a resize handle, so it reads as grabbable.
  const HANDLE_CURSOR: Record<HandlePos, string> = {
    nw: "nwse-resize",
    se: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    start: "move",
    end: "move",
  };

  function onPointerMove(e: PointerEvent) {
    const m = marquee();
    if (m) {
      // Grow the box to the pointer and reselect live, so elements light up as
      // the marquee sweeps over them. Union with the pre-drag selection for a
      // shift-drag; replace it otherwise (base is empty).
      const { offsetX: x, offsetY: y } = e;
      setMarquee({ ...m, x1: x, y1: y });
      const inBox = elementsInBox(state.elements, m.x0, m.y0, x, y);
      selectMany([...new Set([...m.base, ...inBox])]);
      return;
    }
    if (!drag) {
      // Not dragging: reflect whether the pointer is over a resize handle of
      // the selected element with a matching cursor.
      if (state.tool === "select") {
        // Handles only appear for a lone selection, so that's the only case a
        // resize cursor applies.
        const solo =
          state.selectedIds.length === 1
            ? state.elements.find((el) => el.id === state.selectedIds[0])
            : undefined;
        const over = solo ? handleAt(solo, e.offsetX, e.offsetY) : null;
        canvasEl.style.cursor = over ? HANDLE_CURSOR[over] : "";
      } else if (state.tool === "arrow") {
        // Preview which spot the initial click would start bound to.
        const spot = nearestAnchor(state.elements, e.offsetX, e.offsetY);
        setActiveAnchor(spot ? { elementId: spot.elementId, side: spot.side } : null);
      }
      return;
    }
    const { x, y } = predictPointer(e);
    applyDrag(x, y);
  }

  function applyDrag(x: number, y: number) {
    if (!drag) return;
    const { originals } = drag;

    if (drag.handle) {
      // Resize/endpoint drags are always a single element.
      const original = originals[0];
      // Keep the reshaped point out of the left margin and the titlebar band,
      // matching the move clamps, so a corner/endpoint can't be stranded.
      const px = Math.max(x, 0);
      const py = Math.max(y, TITLEBAR_HEIGHT);
      // An arrow endpoint may snap onto (or off) a rectangle spot as it moves;
      // rect corners just resize.
      if (original.type === "arrow" && (drag.handle === "start" || drag.handle === "end")) {
        placeArrowEndpoint(original.id, drag.handle, px, py);
      } else {
        resizeElement(original.id, original, drag.handle, px, py);
      }
      return;
    }

    if (state.tool === "select") {
      // Move the whole selection by one delta. Clamp against the group's own
      // leftmost/topmost member so nothing in it crosses the left edge or slips
      // under the titlebar, where it would become unselectable.
      const groupLeft = Math.min(...originals.map(elementLeft));
      const groupTop = Math.min(...originals.map(elementTop));
      const dx = Math.max(x - drag.startX, -groupLeft);
      const dy = Math.max(y - drag.startY, TITLEBAR_HEIGHT - groupTop);
      updateElements(originals.map((el) => ({ id: el.id, patch: movePatch(el, dx, dy) })));
    } else if (originals[0].type === "rect") {
      updateElement(originals[0].id, {
        x: Math.min(drag.startX, x),
        y: Math.min(drag.startY, y),
        w: Math.abs(x - drag.startX),
        h: Math.abs(y - drag.startY),
      });
    } else if (originals[0].type === "arrow") {
      // The head follows the pointer and may lock onto a rectangle spot.
      placeArrowEndpoint(originals[0].id, "end", x, y);
    }
  }

  function onPointerUp() {
    // A marquee owns the whole gesture: selection was applied live during the
    // move, so dropping it just ends the marquee.
    if (marquee()) {
      setMarquee(null);
      return;
    }
    if (!drag) return;
    // Settle at the last true pointer position, dropping any prediction.
    if (lastSample) applyDrag(lastSample.x, lastSample.y);
    // A plain click inside a multi-selection (no real drag) collapses to the
    // one element pressed. A drag past the slop is a group move, so keep it.
    if (drag.collapseId && lastSample) {
      const moved = Math.hypot(lastSample.x - drag.startX, lastSample.y - drag.startY) > CLICK_SLOP_PX;
      if (!moved) select(drag.collapseId);
    }
    const el = state.elements.find((e) => e.id === drag!.originals[0].id);
    if (el && state.tool !== "select") {
      // Discard degenerate shapes from a click without a drag.
      const tooSmall =
        (el.type === "rect" && el.w < 4 && el.h < 4) ||
        (el.type === "arrow" && Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 4);
      if (tooSmall) {
        removeElements([el.id]);
      } else {
        setTool("select");
        select(el.id);
      }
    }
    drag = null;
    // Stop showing attachment spots once the endpoint is dropped.
    setPlacingEnd(false);
    setActiveAnchor(null);
  }

  // Double-click a rect or arrow to edit its centered label. (Text elements
  // are edited by their own tool; arrows/rects otherwise have no text.)
  function onDblClick(e: MouseEvent) {
    const hit = elementAt(state.elements, e.offsetX, e.offsetY);
    if (!hit || (hit.type !== "rect" && hit.type !== "arrow")) return;
    drag = null; // The dbl-click's pointer events may have armed a drag.
    select(hit.id);
    const { cx, cy } = elementCenter(hit);
    setLabelText(hit.label ?? "");
    setLabelEdit({ id: hit.id, cx, cy, initial: hit.label ?? "" });
    requestAnimationFrame(() => {
      if (!labelEl) return;
      labelEl.value = hit.label ?? "";
      autosizeLabel();
      labelEl.focus();
      labelEl.select();
    });
  }

  // Track the live text (so the arrow break follows it) and grow the editor to
  // fit its content so it stays centered on the shape.
  function onLabelInput() {
    setLabelText(labelEl?.value ?? "");
    autosizeLabel();
  }

  function autosizeLabel() {
    const ta = labelEl;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.width = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
    ta.style.width = `${ta.scrollWidth}px`;
  }

  function commitLabel() {
    const edit = labelEdit();
    if (!edit) return;
    const text = labelEl?.value.trim() ?? "";
    // Store undefined (not "") for an empty label so it drops out of the
    // saved document and the arrow shaft rejoins.
    updateElement(edit.id, { label: text || undefined });
    setLabelEdit(null);
  }

  function onLabelKeyDown(e: KeyboardEvent) {
    // Enter inserts a line break (native textarea behavior); the label commits
    // on blur / click-away. Escape discards, leaving the label as it was.
    if (e.key === "Escape") setLabelEdit(null);
  }

  function commitText() {
    const draft = textDraft();
    if (!draft) return;
    const text = textareaEl?.value.trimEnd() ?? "";
    if (text) {
      const el: SceneElement = { id: newId(), type: "text", x: draft.x, y: draft.y, text };
      addElement(el);
      setTool("select");
      select(el.id);
    }
    setTextDraft(null);
  }

  function onTextKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitText();
    } else if (e.key === "Escape") {
      if (textareaEl) textareaEl.value = "";
      setTextDraft(null);
    }
  }

  return (
    <div
      ref={containerEl}
      class="canvas-container"
      data-tool={state.tool}
    >
      <svg class="coffee-stain" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          {/* Turbulence + displacement roughens the otherwise-smooth ring
              into an organic, uneven coffee edge. */}
          <filter id="coffee-rough">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="5.5" />
          </filter>
        </defs>
        <g filter="url(#coffee-rough)">
          <path
            fill="none"
            stroke="#5a3a24"
            stroke-width="3.5"
            stroke-opacity="0.75"
            d="M49 20c17-1 30 5 30 25s-11 33-29 33-30-13-30-31c0-16 10-24 21-26"
          />
        </g>
      </svg>
      <canvas
        ref={canvasEl}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDblClick={onDblClick}
      />
      <Show when={textDraft()}>
        {(draft) => (
          <textarea
            ref={textareaEl}
            class="text-editor"
            style={{
              left: `${draft().x}px`,
              top: `${draft().y}px`,
              font: FONT,
              "line-height": `${LINE_HEIGHT}px`,
            }}
            onKeyDown={onTextKeyDown}
            onBlur={commitText}
          />
        )}
      </Show>
      <Show when={labelEdit()}>
        {(edit) => (
          <textarea
            ref={labelEl}
            class="label-editor"
            rows={1}
            style={{
              left: `${edit().cx}px`,
              top: `${edit().cy}px`,
              font: FONT,
              "line-height": `${LINE_HEIGHT}px`,
            }}
            onInput={onLabelInput}
            onKeyDown={onLabelKeyDown}
            onBlur={commitLabel}
          />
        )}
      </Show>
    </div>
  );
}
