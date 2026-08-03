// Canvas 2D renderer: pure function of the scene, no state of its own.
// Its sibling src/export.ts walks the same elements and emits SVG markup
// instead of draw calls, sharing the options and seeds exported below so the
// two stay in lockstep.

import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Options } from "roughjs/bin/core";
import {
  ANCHOR_DOT_R,
  BADGE_SIZE,
  elementAnchors,
  elementHandles,
  fontString,
  FONT_SIZE,
  HANDLE_SIZE,
  lineHeightFor,
  measureText,
  selectionBadges,
  type AnchorPos,
  type Badge,
  type LineStyle,
  type SceneElement,
} from "./scene";

// Shared with the SVG exporter (src/export.ts): it walks the same elements and
// drives roughjs's SVG generator with these exact opts and seeds, so an export
// matches the on-screen strokes pixel-for-pixel. Keep them the single source of
// truth rather than re-deriving the look on the export side.
export const STROKE = "#1e1e1e";
const SELECTION = "#f74f4f";
export const ARROWHEAD_LEN = 12;
// Clear space kept around a centered label: padding on the rect (nothing
// really needs it there) and the half-gap the arrow shaft leaves for it.
export const LABEL_PAD = 6;

// "Medium" sketch level for canvas shapes, matching the toolbar's hand-drawn
// look. seed is set per-element (see elementSeed) so a shape stays stable
// while it's dragged/resized instead of re-randomizing every frame.
export const SHAPE_OPTS: Options = {
  stroke: STROKE,
  strokeWidth: 2,
  roughness: 1.1,
  bowing: 1.2,
};

// Arrows read badly with the full sketch treatment: roughjs's default
// multi-stroke draws each line twice, and over a long straight shaft the two
// passes visibly splay into a wedge, while bowing curves it. Keep a faint
// hand-drawn wobble but disable the second stroke and the bowing so shafts stay
// single and straight. The arrowhead shares these opts so it stays consistent.
export const ARROW_OPTS: Options = {
  ...SHAPE_OPTS,
  roughness: 0.8,
  bowing: 0,
  disableMultiStroke: true,
};

// The document's "Line Style" setting picks between the hand-drawn look above
// and a clean one: roughness 0 (no jitter) with the sketch-only flourishes
// (bowing, the doubled stroke) switched off, so shapes and shafts draw as
// straight, single geometry. Shared by the canvas renderer and the SVG export
// (via the opts helpers below) so the two never diverge.
const CLEAN_OVERRIDES: Options = { roughness: 0, bowing: 0, disableMultiStroke: true };

// Per-element rough options for a shape, folding in the line style and the
// element's stable seed. The single source of truth for both draw paths.
export function shapeOptsFor(lineStyle: LineStyle, id: string, color?: string): Options {
  const base = lineStyle === "clean" ? { ...SHAPE_OPTS, ...CLEAN_OVERRIDES } : SHAPE_OPTS;
  return { ...base, stroke: color ?? STROKE, seed: elementSeed(id) };
}

export function arrowOptsFor(lineStyle: LineStyle, id: string, color?: string): Options {
  const base = lineStyle === "clean" ? { ...ARROW_OPTS, ...CLEAN_OVERRIDES } : ARROW_OPTS;
  return { ...base, stroke: color ?? STROKE, seed: elementSeed(id) };
}

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
// jitter for a given shape every frame — and so the SVG/PNG export reproduces
// that exact jitter instead of a fresh random one.
export function elementSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 2 ** 31;
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  elements: readonly SceneElement[],
  selectedIds: readonly string[],
  width: number,
  height: number,
  dpr: number,
  // The document's line style ("rough"/"clean"), applied to every shape/arrow.
  lineStyle: LineStyle,
  // Element whose label is being edited in the DOM textarea right now, plus
  // the live text in that textarea. While editing, the canvas skips painting
  // the label (the textarea shows it) but still breaks the arrow shaft around
  // the live text, so the shaft never runs through what you're typing.
  editingLabelId: string | null = null,
  editingLabelText = "",
  // While an arrow endpoint is being placed (drawn or re-dragged), every
  // bindable element shows its attachment spots so the user can see where the
  // endpoint will lock; activeAnchor is the one it would currently snap to.
  showAnchors = false,
  activeAnchor: ({ elementId: string } & AnchorPos) | null = null,
  // The drag-to-select marquee, given as two opposite corners, or null when no
  // marquee drag is in progress.
  marquee: { x0: number; y0: number; x1: number; y1: number } | null = null,
  // Text element being edited in a DOM textarea right now; skip painting it so
  // the canvas text doesn't ghost behind the editor.
  editingTextId: string | null = null
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const rc = roughFor(ctx);
  for (const el of elements) {
    if (el.id === editingTextId) continue;
    drawElement(ctx, rc, el, lineStyle, el.id === editingLabelId ? editingLabelText : null);
  }

  // Outline every selected element; only show resize handles when exactly one
  // is selected (dragging a corner/endpoint is a single-element gesture — a
  // multi-selection just moves as a group).
  const selected = elements.filter((e) => selectedIds.includes(e.id) && e.id !== editingTextId);
  for (const el of selected) drawSelection(ctx, el, selected.length === 1);

  // Property badges ride above the whole selection's box (one element or many),
  // so they're drawn once here rather than per element. The swatch shows the
  // primary (first) selected element's ink.
  if (selected.length) {
    const swatch = selected[0].color ?? STROKE;
    const ids = selected.map((e) => e.id);
    for (const bd of selectionBadges(elements, ids)) drawBadge(ctx, bd, swatch);
  }

  if (showAnchors) drawAnchors(ctx, elements, activeAnchor);

  if (marquee) drawMarquee(ctx, marquee);
}

// The drag-to-select marquee: a faint fill with a dashed outline in the
// selection color, matching the per-element selection rectangles.
function drawMarquee(
  ctx: CanvasRenderingContext2D,
  m: { x0: number; y0: number; x1: number; y1: number }
) {
  const x = Math.min(m.x0, m.x1);
  const y = Math.min(m.y0, m.y1);
  const w = Math.abs(m.x1 - m.x0);
  const h = Math.abs(m.y1 - m.y0);
  ctx.fillStyle = "rgba(247, 79, 79, 0.08)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = SELECTION;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

// The attachment spots on every bindable element: hollow dots around the
// perimeter, with the one about to bind drawn filled and a touch larger. A
// spot's quarter positions are hidden on short edges to cut clutter; a hidden
// quarter appears only while it's the active (about-to-bind) spot, so aiming at
// one on a small element reveals just that spot rather than the whole set.
function drawAnchors(
  ctx: CanvasRenderingContext2D,
  elements: readonly SceneElement[],
  active: ({ elementId: string } & AnchorPos) | null
) {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = SELECTION;
  for (const el of elements) {
    for (const a of elementAnchors(el)) {
      const isActive =
        !!active && active.elementId === el.id && active.nx === a.nx && active.ny === a.ny;
      if (!a.visible && !isActive) continue;
      ctx.beginPath();
      ctx.arc(a.x, a.y, isActive ? ANCHOR_DOT_R + 2 : ANCHOR_DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? SELECTION : "#ffffff";
      ctx.fill();
      ctx.stroke();
    }
  }
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  rc: RoughCanvas,
  el: SceneElement,
  lineStyle: LineStyle,
  // null when not being edited; otherwise the live textarea text (possibly
  // "") to break around instead of the committed label, which the DOM editor
  // is painting on top.
  editingText: string | null
) {
  const editing = editingText !== null;
  const size = el.fontSize ?? FONT_SIZE;
  const ink = el.color ?? STROKE;
  switch (el.type) {
    case "rect": {
      rc.rectangle(el.x, el.y, el.w, el.h, shapeOptsFor(lineStyle, el.id, el.color));
      if (!editing && el.label) {
        drawLabel(ctx, el.label, el.x + el.w / 2, el.y + el.h / 2, size, ink);
      }
      break;
    }
    case "arrow": {
      const opts = arrowOptsFor(lineStyle, el.id, el.color);
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
        const { w, h } = measureText(breakText, size);
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
      // Heads default to end-only when the flags are absent (the classic look).
      if (el.endHead !== false) drawArrowhead(rc, el.x2, el.y2, dx, dy, opts);
      if (el.startHead) drawArrowhead(rc, el.x1, el.y1, -dx, -dy, opts);
      // The DOM editor paints the label while editing; only draw it otherwise.
      if (!editing && el.label) drawLabel(ctx, el.label, mx, my, size, ink);
      break;
    }
    case "text": {
      // Text stays crisp — no roughjs.
      ctx.fillStyle = ink;
      ctx.font = fontString(size);
      ctx.textBaseline = "alphabetic";
      const lh = lineHeightFor(size);
      const lines = el.text.split("\n");
      lines.forEach((line, i) => {
        ctx.fillText(line, el.x, el.y + size + i * lh);
      });
      break;
    }
  }
}

// One arrowhead: the two barbs at (tipX, tipY), opening back along the shaft
// direction (dx, dy). Pass the reversed direction for a tail head. Shares the
// element's rough opts so head and shaft match.
function drawArrowhead(
  rc: RoughCanvas,
  tipX: number,
  tipY: number,
  dx: number,
  dy: number,
  opts: Options
) {
  const angle = Math.atan2(dy, dx);
  for (const side of [-1, 1]) {
    const a = angle + side * (Math.PI / 6);
    rc.line(tipX, tipY, tipX - ARROWHEAD_LEN * Math.cos(a), tipY - ARROWHEAD_LEN * Math.sin(a), opts);
  }
}

// Multi-line text centered on (cx, cy). Resets the shared alignment state
// afterward so the standalone-text branch (top-left, alphabetic) is unaffected.
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  size: number,
  color: string
) {
  ctx.fillStyle = color;
  ctx.font = fontString(size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lh = lineHeightFor(size);
  const lines = text.split("\n");
  const top = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, cx, top + i * lh);
  });
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawSelection(ctx: CanvasRenderingContext2D, el: SceneElement, withHandles: boolean) {
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
      const box = measureText(el.text, el.fontSize);
      ({ x, y } = el);
      ({ w, h } = box);
      break;
    }
  }
  const pad = 6;
  ctx.strokeStyle = SELECTION;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  ctx.setLineDash([]);

  if (!withHandles) return;

  // Resize handles: small white squares with a colored outline, centered on
  // each corner (rect) or endpoint (arrow). Text elements return none.
  const s = HANDLE_SIZE;
  ctx.lineWidth = 1.5;
  for (const hnd of elementHandles(el)) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(hnd.x - s / 2, hnd.y - s / 2, s, s);
    ctx.strokeStyle = SELECTION;
    ctx.strokeRect(hnd.x - s / 2, hnd.y - s / 2, s, s);
  }
}

// A property badge: a small rounded square with a colored outline, holding
// either an "A" glyph (font) or a filled swatch of the element's ink (color).
function drawBadge(ctx: CanvasRenderingContext2D, bd: Badge, ink: string) {
  const s = BADGE_SIZE;
  const x = bd.x - s / 2;
  const y = bd.y - s / 2;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = SELECTION;
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x, y, s, s, 3);
  ctx.fill();
  ctx.stroke();
  if (bd.kind === "font") {
    ctx.fillStyle = STROKE;
    ctx.font = "bold 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    // Center the glyph's actual ink box (not the em box) on the badge center:
    // place the baseline so the cap-height "A" sits truly centered.
    const m = ctx.measureText("A");
    const inkCenter = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText("A", bd.x, bd.y + inkCenter);
    ctx.textAlign = "start";
  } else {
    // Inner swatch of the current ink.
    ctx.fillStyle = ink;
    roundRect(ctx, x + 3.5, y + 3.5, s - 7, s - 7, 2);
    ctx.fill();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
