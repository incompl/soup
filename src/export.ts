// Raster (PNG) and vector (SVG) export of the scene, driven by the File >
// Export menu. Sibling to renderer.ts: it walks the same SceneElement[] and,
// for shapes, drives roughjs's *SVG* generator with the exact same options and
// per-element seeds the canvas renderer uses (see renderer.ts) — so an export
// reproduces the on-screen hand-drawn strokes rather than clean geometry.
//
// SVG is the single drawing path: PNG is just that SVG rasterized onto a
// canvas, so the two formats can never drift. Both backgrounds are transparent.
//
// Like persistence.ts this module is native-only (menu events + dialogs + file
// IO go through Tauri); under a plain `pnpm dev` browser its wiring is a no-op.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { message, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { onCleanup } from "solid-js";
import rough from "roughjs";
import { notify } from "./notification-store";
import { suggestedExportName } from "./persistence";
import {
  arrowOptsFor,
  ARROWHEAD_LEN,
  LABEL_PAD,
  shapeOptsFor,
  STROKE,
} from "./renderer";
import {
  BUNDLED_PRIMARY,
  elementBounds,
  fontFamily,
  FONT_SIZE,
  LINE_HEIGHT,
  measureText,
  type LineStyle,
  type SceneElement,
} from "./scene";
import { ensureFontFaceCss, fontFaceCss } from "./fonts";
import { state } from "./store";

const SVG_NS = "http://www.w3.org/2000/svg";
// Breathing room around the tight content box, also absorbing the arrowhead
// overhang past an arrow's endpoint.
const PADDING = 16;
// PNG is rasterized at 2× so it stays crisp on retina displays and when scaled.
const PNG_SCALE = 2;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

// The box an element actually paints into, including a centered label. Most of
// these match elementBounds; an arrow's label, though, floats at the shaft
// midpoint and can jut past the endpoint box on a short/steep arrow, so fold it
// in to avoid clipping it out of the export.
function contentBounds(el: SceneElement): Box {
  const base = elementBounds(el);
  if (el.type === "arrow" && el.label) {
    const { w, h } = measureText(el.label);
    const cx = (el.x1 + el.x2) / 2;
    const cy = (el.y1 + el.y2) / 2;
    return union(base, { x: cx - w / 2, y: cy - h / 2, w, h });
  }
  return base;
}

// Tight bounding box of the whole scene, grown by PADDING — or null when the
// scene is empty (nothing to export).
function sceneBox(elements: readonly SceneElement[]): Box | null {
  if (!elements.length) return null;
  let box = contentBounds(elements[0]);
  for (let i = 1; i < elements.length; i++) box = union(box, contentBounds(elements[i]));
  return { x: box.x - PADDING, y: box.y - PADDING, w: box.w + PADDING * 2, h: box.h + PADDING * 2 };
}

// --- SVG emission -----------------------------------------------------------

function svgText(
  doc: SVGSVGElement,
  text: string,
  x: number,
  y: number,
  anchor: "start" | "middle",
  // "central" mirrors the canvas textBaseline "middle" used for centered
  // labels; undefined leaves the SVG default (alphabetic) for standalone text.
  baseline?: "central"
): SVGTextElement {
  const node = doc.ownerDocument.createElementNS(SVG_NS, "text");
  node.setAttribute("x", String(x));
  node.setAttribute("y", String(y));
  node.setAttribute("font-family", fontFamily());
  node.setAttribute("font-size", String(FONT_SIZE));
  node.setAttribute("fill", STROKE);
  if (anchor !== "start") node.setAttribute("text-anchor", anchor);
  if (baseline) node.setAttribute("dominant-baseline", baseline);
  node.textContent = text;
  return node;
}

// Emit a centered multi-line label (rect + arrow labels), mirroring
// renderer.ts's drawLabel: the block is vertically centered on (cx, cy).
function appendLabel(doc: SVGSVGElement, into: SVGElement, text: string, cx: number, cy: number) {
  const lines = text.split("\n");
  const top = cy - ((lines.length - 1) * LINE_HEIGHT) / 2;
  lines.forEach((line, i) => {
    into.appendChild(svgText(doc, line, cx, top + i * LINE_HEIGHT, "middle", "central"));
  });
}

// Walk one element into <g>, mirroring renderer.ts's drawElement (minus the
// mid-edit label-suppression, which never applies to an export).
function appendElement(
  doc: SVGSVGElement,
  rc: ReturnType<typeof rough.svg>,
  into: SVGElement,
  el: SceneElement,
  lineStyle: LineStyle
) {
  switch (el.type) {
    case "rect": {
      into.appendChild(rc.rectangle(el.x, el.y, el.w, el.h, shapeOptsFor(lineStyle, el.id)));
      if (el.label) appendLabel(doc, into, el.label, el.x + el.w / 2, el.y + el.h / 2);
      break;
    }
    case "arrow": {
      const opts = arrowOptsFor(lineStyle, el.id);
      const dx = el.x2 - el.x1;
      const dy = el.y2 - el.y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const mx = (el.x1 + el.x2) / 2;
      const my = (el.y1 + el.y2) / 2;
      if (el.label) {
        // Break the shaft around the label, exactly as the canvas does.
        const { w, h } = measureText(el.label);
        const hw = w / 2 + LABEL_PAD;
        const hh = h / 2 + LABEL_PAD;
        const sx = Math.abs(ux) < 1e-6 ? Infinity : hw / Math.abs(ux);
        const sy = Math.abs(uy) < 1e-6 ? Infinity : hh / Math.abs(uy);
        const s = Math.min(sx, sy);
        if (s < len / 2) {
          into.appendChild(rc.line(el.x1, el.y1, mx - ux * s, my - uy * s, opts));
          into.appendChild(rc.line(mx + ux * s, my + uy * s, el.x2, el.y2, opts));
        }
      } else {
        into.appendChild(rc.line(el.x1, el.y1, el.x2, el.y2, opts));
      }
      const angle = Math.atan2(dy, dx);
      for (const side of [-1, 1]) {
        const a = angle + side * (Math.PI / 6);
        into.appendChild(
          rc.line(el.x2, el.y2, el.x2 - ARROWHEAD_LEN * Math.cos(a), el.y2 - ARROWHEAD_LEN * Math.sin(a), opts)
        );
      }
      if (el.label) appendLabel(doc, into, el.label, mx, my);
      break;
    }
    case "text": {
      // Top-left origin, alphabetic baseline — same as drawElement's text case.
      const lines = el.text.split("\n");
      lines.forEach((line, i) => {
        into.appendChild(svgText(doc, line, el.x, el.y + FONT_SIZE + i * LINE_HEIGHT, "start"));
      });
      break;
    }
  }
}

interface BuiltSvg {
  markup: string;
  width: number;
  height: number;
}

// Serialize the scene to a standalone SVG string sized to its content box, or
// null when the scene is empty. Content is translated so the box's top-left
// sits at the origin; the background is left transparent.
function buildSvg(
  elements: readonly SceneElement[],
  lineStyle: LineStyle,
  // A self-contained `@font-face` rule (woff2 base64-inlined) for the document's
  // font, or "" to reference it by name only. Embedded so the SVG renders in the
  // right font when opened elsewhere — and, crucially, when rasterized to PNG via
  // <img>, which can't see the app's loaded faces.
  fontFaces: string
): BuiltSvg | null {
  const box = sceneBox(elements);
  if (!box) return null;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(box.w));
  svg.setAttribute("height", String(box.h));
  svg.setAttribute("viewBox", `0 0 ${box.w} ${box.h}`);

  if (fontFaces) {
    const style = document.createElementNS(SVG_NS, "style");
    style.textContent = fontFaces;
    svg.appendChild(style);
  }

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", `translate(${-box.x} ${-box.y})`);
  svg.appendChild(g);

  const rc = rough.svg(svg);
  for (const el of elements) appendElement(svg, rc, g, el, lineStyle);

  const markup = new XMLSerializer().serializeToString(svg);
  return { markup, width: box.w, height: box.h };
}

export function sceneToSvg(
  elements: readonly SceneElement[],
  lineStyle: LineStyle,
  fontFaces = ""
): string | null {
  return buildSvg(elements, lineStyle, fontFaces)?.markup ?? null;
}

// Rasterize the scene's SVG onto a transparent canvas at PNG_SCALE and encode
// PNG bytes. Null when the scene is empty. Rejects if the SVG can't be decoded.
export async function sceneToPngBytes(
  elements: readonly SceneElement[],
  lineStyle: LineStyle,
  fontFaces = ""
): Promise<Uint8Array | null> {
  const built = buildSvg(elements, lineStyle, fontFaces);
  if (!built) return null;

  const url = URL.createObjectURL(new Blob([built.markup], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not rasterize the drawing."));
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(built.width * PNG_SCALE));
    canvas.height = Math.max(1, Math.round(built.height * PNG_SCALE));
    const ctx = canvas.getContext("2d")!;
    ctx.scale(PNG_SCALE, PNG_SCALE);
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode the PNG.");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

// --- Menu wiring ------------------------------------------------------------

async function reportError(err: unknown): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  await message(`Could not export the drawing.\n\n${detail}`, { title: "soup", kind: "error" });
}

// The embeddable @font-face for the document's current font, ready to inline
// into an export. Awaits the one-time fetch/base64 of the bundled woff2.
async function currentFontFaces(): Promise<string> {
  await ensureFontFaceCss();
  return fontFaceCss(BUNDLED_PRIMARY[state.docSettings.font]);
}

async function exportSvg(): Promise<void> {
  const markup = sceneToSvg(state.elements, state.docSettings.lineStyle, await currentFontFaces());
  if (!markup) {
    notify("Nothing to export.", "info");
    return;
  }
  try {
    const path = await saveDialog({
      filters: [{ name: "SVG image", extensions: ["svg"] }],
      defaultPath: suggestedExportName("svg"),
    });
    if (typeof path !== "string") return; // Cancelled.
    await invoke("write_document", { path, contents: markup });
    notify("Exported!", "success");
  } catch (err) {
    await reportError(err);
  }
}

async function exportPng(): Promise<void> {
  try {
    const bytes = await sceneToPngBytes(
      state.elements,
      state.docSettings.lineStyle,
      await currentFontFaces()
    );
    if (!bytes) {
      notify("Nothing to export.", "info");
      return;
    }
    const path = await saveDialog({
      filters: [{ name: "PNG image", extensions: ["png"] }],
      defaultPath: suggestedExportName("png"),
    });
    if (typeof path !== "string") return; // Cancelled.
    await invoke("write_binary", { path, bytes: Array.from(bytes) });
    notify("Exported!", "success");
  } catch (err) {
    await reportError(err);
  }
}

// Listen for the File > Export menu events. Call once from a component body
// (needs a reactive owner for cleanup); a no-op under plain-browser dev.
export function initExport(): void {
  const unlisten: UnlistenFn[] = [];
  const track = (p: Promise<UnlistenFn>) => p.then((u) => unlisten.push(u)).catch(() => {});
  track(listen("menu:export-png", () => void exportPng()));
  track(listen("menu:export-svg", () => void exportSvg()));
  onCleanup(() => unlisten.forEach((u) => u()));
}
