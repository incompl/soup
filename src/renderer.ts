// Canvas 2D renderer: pure function of the scene, no state of its own.
// A future SVG exporter will be a sibling of this file that walks the
// same elements and emits markup instead of draw calls.

import { FONT, FONT_SIZE, LINE_HEIGHT, measureText, type SceneElement } from "./scene";

const STROKE = "#1e1e1e";
const SELECTION = "#4f8ef7";
const ARROWHEAD_LEN = 12;

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

  for (const el of elements) {
    drawElement(ctx, el);
  }

  const selected = selectedId && elements.find((e) => e.id === selectedId);
  if (selected) drawSelection(ctx, selected);
}

function drawElement(ctx: CanvasRenderingContext2D, el: SceneElement) {
  ctx.strokeStyle = STROKE;
  ctx.fillStyle = STROKE;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (el.type) {
    case "rect":
      ctx.strokeRect(el.x, el.y, el.w, el.h);
      break;
    case "arrow": {
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
      for (const side of [-1, 1]) {
        const a = angle + side * (Math.PI / 6);
        ctx.moveTo(el.x2, el.y2);
        ctx.lineTo(el.x2 - ARROWHEAD_LEN * Math.cos(a), el.y2 - ARROWHEAD_LEN * Math.sin(a));
      }
      ctx.stroke();
      break;
    }
    case "text": {
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
