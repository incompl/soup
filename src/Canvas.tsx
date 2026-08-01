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

export default function Canvas() {
  let canvasEl!: HTMLCanvasElement;
  let containerEl!: HTMLDivElement;
  let textareaEl: HTMLTextAreaElement | undefined;

  const [size, setSize] = createSignal({ w: 0, h: 0, dpr: 1 });
  const [textDraft, setTextDraft] = createSignal<TextDraft | null>(null);

  let drag: DragState | null = null;

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
    renderScene(ctx, state.elements, state.selectedId, w, h, dpr);
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
    canvasEl.setPointerCapture(e.pointerId);
    const { offsetX: x, offsetY: y } = e;

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

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const { offsetX: x, offsetY: y } = e;
    const { original } = drag;

    if (state.tool === "select") {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
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
      <canvas
        ref={canvasEl}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
    </div>
  );
}
