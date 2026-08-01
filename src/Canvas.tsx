import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { FONT, LINE_HEIGHT, newId, elementAt, type SceneElement } from "./scene";
import { renderScene } from "./renderer";
import { addElement, removeElement, select, setTool, state, updateElement } from "./store";

interface DragState {
  id: string;
  startX: number;
  startY: number;
  // Snapshot of the element at drag start, for move deltas.
  original: SceneElement;
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
  });

  createEffect(() => {
    const { w, h, dpr } = size();
    const ctx = canvasEl.getContext("2d");
    if (!ctx || w === 0) return;
    renderScene(ctx, state.elements, state.selectedId, w, h, dpr, labelEdit()?.id ?? null, labelText());
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    switch (e.key) {
      case "v":
      case "1":
        setTool("select");
        break;
      case "r":
      case "2":
        setTool("rect");
        break;
      case "a":
      case "3":
        setTool("arrow");
        break;
      case "t":
      case "4":
        setTool("text");
        break;
      case "Delete":
      case "Backspace":
        if (state.selectedId) removeElement(state.selectedId);
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
        const hit = elementAt(state.elements, x, y);
        select(hit?.id ?? null);
        if (hit) drag = { id: hit.id, startX: x, startY: y, original: { ...hit } };
        break;
      }
      case "rect": {
        const el: SceneElement = { id: newId(), type: "rect", x, y, w: 0, h: 0 };
        addElement(el);
        drag = { id: el.id, startX: x, startY: y, original: el };
        break;
      }
      case "arrow": {
        const el: SceneElement = { id: newId(), type: "arrow", x1: x, y1: y, x2: x, y2: y };
        addElement(el);
        drag = { id: el.id, startX: x, startY: y, original: el };
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

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const { x, y } = predictPointer(e);
    applyDrag(x, y);
  }

  function applyDrag(x: number, y: number) {
    if (!drag) return;
    const { original } = drag;

    if (state.tool === "select") {
      // Don't let the element move past the left edge or up under the
      // titlebar, where it would become unselectable.
      const dx = Math.max(x - drag.startX, -elementLeft(original));
      const dy = Math.max(y - drag.startY, TITLEBAR_HEIGHT - elementTop(original));
      switch (original.type) {
        case "rect":
        case "text":
          updateElement(drag.id, { x: original.x + dx, y: original.y + dy });
          break;
        case "arrow":
          updateElement(drag.id, {
            x1: original.x1 + dx,
            y1: original.y1 + dy,
            x2: original.x2 + dx,
            y2: original.y2 + dy,
          });
          break;
      }
    } else if (original.type === "rect") {
      updateElement(drag.id, {
        x: Math.min(drag.startX, x),
        y: Math.min(drag.startY, y),
        w: Math.abs(x - drag.startX),
        h: Math.abs(y - drag.startY),
      });
    } else if (original.type === "arrow") {
      updateElement(drag.id, { x2: x, y2: y });
    }
  }

  function onPointerUp() {
    if (!drag) return;
    // Settle at the last true pointer position, dropping any prediction.
    if (lastSample) applyDrag(lastSample.x, lastSample.y);
    const el = state.elements.find((e) => e.id === drag!.id);
    if (el && state.tool !== "select") {
      // Discard degenerate shapes from a click without a drag.
      const tooSmall =
        (el.type === "rect" && el.w < 4 && el.h < 4) ||
        (el.type === "arrow" && Math.hypot(el.x2 - el.x1, el.y2 - el.y1) < 4);
      if (tooSmall) {
        removeElement(el.id);
      } else {
        setTool("select");
        select(el.id);
      }
    }
    drag = null;
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
