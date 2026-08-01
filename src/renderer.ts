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
  dpr: number
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const rc = roughFor(ctx);
  for (const el of elements) {
    drawElement(ctx, rc, el);
  }

  const selected = selectedId && elements.find((e) => e.id === selectedId);
  if (selected) drawSelection(ctx, selected);
}

function drawElement(ctx: CanvasRenderingContext2D, rc: RoughCanvas, el: SceneElement) {
  switch (el.type) {
    case "rect":
      rc.rectangle(el.x, el.y, el.w, el.h, { ...SHAPE_OPTS, seed: elementSeed(el.id) });
      break;
    case "arrow": {
      const opts = { ...SHAPE_OPTS, seed: elementSeed(el.id) };
      rc.line(el.x1, el.y1, el.x2, el.y2, opts);
      const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
      for (const side of [-1, 1]) {
        const a = angle + side * (Math.PI / 6);
        rc.line(el.x2, el.y2, el.x2 - ARROWHEAD_LEN * Math.cos(a), el.y2 - ARROWHEAD_LEN * Math.sin(a), opts);
      }
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
