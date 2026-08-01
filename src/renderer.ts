// Canvas 2D renderer: pure function of the scene, no state of its own.
// A future SVG exporter will be a sibling of this file that walks the
// same elements and emits markup instead of draw calls.

import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Options } from "roughjs/bin/core";
import { FONT, FONT_SIZE, LINE_HEIGHT, measureText, type SceneElement } from "./scene";

const STROKE = "#1e1e1e";
const SELECTION = "#f74f4f";
const ARROWHEAD_LEN = 12;
// Clear space kept around a centered label: padding on the rect (nothing
// really needs it there) and the half-gap the arrow shaft leaves for it.
const LABEL_PAD = 6;

// "Medium" sketch level for canvas shapes, matching the toolbar's hand-drawn
// look. seed is set per-element (see elementSeed) so a shape stays stable
// while it's dragged/resized instead of re-randomizing every frame.
const SHAPE_OPTS: Options = {
  stroke: STROKE,
  strokeWidth: 2,
  roughness: 1.1,
  bowing: 1.2,
};

// One RoughCanvas per underlying <canvas>; cheap to reuse across renders.
const roughByCanvas = new WeakMap<HTMLCanvasElement, RoughCanvas>();

function roughFor(ctx: CanvasRenderingContext2D): RoughCanvas {
  let rc = roughByCanvas.get(ctx.canvas);
  if (!rc) {
    rc = rough.canvas(ctx.canvas);
    roughByCanvas.set(ctx.canvas, rc);
  }
  return rc;
}

// Stable small integer seed from an element id, so roughjs draws the same
// jitter for a given shape every frame.
function elementSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 ** 31;
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  elements: readonly SceneElement[],
  selectedId: string | null,
  width: number,
  height: number,
  dpr: number,
  // Element whose label is being edited in the DOM textarea right now, plus
  // the live text in that textarea. While editing, the canvas skips painting
  // the label (the textarea shows it) but still breaks the arrow shaft around
  // the live text, so the shaft never runs through what you're typing.
  editingLabelId: string | null = null,
  editingLabelText = ""
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const rc = roughFor(ctx);
  for (const el of elements) {
    drawElement(ctx, rc, el, el.id === editingLabelId ? editingLabelText : null);
  }

  const selected = selectedId && elements.find((e) => e.id === selectedId);
  if (selected) drawSelection(ctx, selected);
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  el: SceneElement,
  // null when not being edited; otherwise the live textarea text (possibly
  // "") to break around instead of the committed label, which the DOM editor
  // is painting on top.
  editingText: string | null
) {
  const editing = editingText !== null;
  switch (el.type) {
    case "rect": {
      rc.rectangle(el.x, el.y, el.w, el.h, { ...SHAPE_OPTS, seed: elementSeed(el.id) });
      if (!editing && el.label) {
        drawLabel(ctx, el.label, el.x + el.w / 2, el.y + el.h / 2);
      }
      break;
    }
    case "arrow": {
      const opts = { ...SHAPE_OPTS, seed: elementSeed(el.id) };
      // Break around the live text while editing, else the committed label.
      const breakText = editing ? editingText : el.label;
      const dx = el.x2 - el.x1;
      const dy = el.y2 - el.y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const mx = (el.x1 + el.x2) / 2;
      const my = (el.y1 + el.y2) / 2;
      if (breakText) {
        // Leave a gap centered on the midpoint just big enough to clear the
        // label's box, then draw the two shaft segments on either side. When
        // the label spans the whole arrow, draw no shaft at all.
        const { w, h } = measureText(breakText);
        const hw = w / 2 + LABEL_PAD;
        const hh = h / 2 + LABEL_PAD;
        const sx = Math.abs(ux) < 1e-6 ? Infinity : hw / Math.abs(ux);
        const sy = Math.abs(uy) < 1e-6 ? Infinity : hh / Math.abs(uy);
        const s = Math.min(sx, sy);
        if (s < len / 2) {
          rc.line(el.x1, el.y1, mx - ux * s, my - uy * s, opts);
          rc.line(mx + ux * s, my + uy * s, el.x2, el.y2, opts);
        }
      } else {
        rc.line(el.x1, el.y1, el.x2, el.y2, opts);
      }
      const angle = Math.atan2(dy, dx);
      for (const side of [-1, 1]) {
        const a = angle + side * (Math.PI / 6);
        rc.line(el.x2, el.y2, el.x2 - ARROWHEAD_LEN * Math.cos(a), el.y2 - ARROWHEAD_LEN * Math.sin(a), opts);
      }
      // The DOM editor paints the label while editing; only draw it otherwise.
      if (!editing && el.label) drawLabel(ctx, el.label, mx, my);
      break;
    }
    case "text": {
      // Text stays crisp — no roughjs.
      ctx.strokeStyle = STROKE;
      ctx.fillStyle = STROKE;
      ctx.font = FONT;
      ctx.textBaseline = "alphabetic";
      const lines = el.text.split("\n");
      lines.forEach((line, i) => {
        ctx.fillText(line, el.x, el.y + FONT_SIZE + i * LINE_HEIGHT);
      });
      break;
    }
  }
}

// Multi-line text centered on (cx, cy). Resets the shared alignment state
// afterward so the standalone-text branch (top-left, alphabetic) is unaffected.
function drawLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number) {
  ctx.fillStyle = STROKE;
  ctx.font = FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = text.split("\n");
  const top = cy - ((lines.length - 1) * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, top + i * LINE_HEIGHT);
  });
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawSelection(ctx: CanvasRenderingContext2D, el: SceneElement) {
  let x: number, y: number, w: number, h: number;
  switch (el.type) {
    case "rect":
      ({ x, y, w, h } = el);
      break;
    case "arrow":
      x = Math.min(el.x1, el.x2);
      y = Math.min(el.y1, el.y2);
      w = Math.abs(el.x2 - el.x1);
      h = Math.abs(el.y2 - el.y1);
      break;
    case "text": {
      const size = measureText(el.text);
      ({ x, y } = el);
      ({ w, h } = size);
      break;
    }
  }
  const pad = 6;
  ctx.strokeStyle = SELECTION;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  ctx.setLineDash([]);
}
