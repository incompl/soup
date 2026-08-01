// Scene model: plain serializable data with no rendering or DOM concerns.
// This is the single source of truth. Future features (save/load, SVG
// export, PDF export via the Rust side) serialize from these types, so
// keep them JSON-friendly.

export type Tool = "select" | "rect" | "arrow" | "text";

export interface RectElement {
  id: string;
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ArrowElement {
  id: string;
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TextElement {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
}

export type SceneElement = RectElement | ArrowElement | TextElement;

export const FONT_SIZE = 16;
export const LINE_HEIGHT = 22;
export const FONT = `${FONT_SIZE}px ui-sans-serif, system-ui, sans-serif`;

export function newId(): string {
  return crypto.randomUUID();
}

const measureCtx = document.createElement("canvas").getContext("2d")!;

export function measureText(text: string): { w: number; h: number } {
  measureCtx.font = FONT;
  const lines = text.split("\n");
  let w = 0;
  for (const line of lines) {
    w = Math.max(w, measureCtx.measureText(line).width);
  }
  return { w, h: lines.length * LINE_HEIGHT };
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTest(el: SceneElement, px: number, py: number): boolean {
  const pad = 6;
  switch (el.type) {
    case "rect":
      return (
        px >= el.x - pad && px <= el.x + el.w + pad && py >= el.y - pad && py <= el.y + el.h + pad
      );
    case "arrow":
      return distToSegment(px, py, el.x1, el.y1, el.x2, el.y2) <= pad;
    case "text": {
      const { w, h } = measureText(el.text);
      return px >= el.x - pad && px <= el.x + w + pad && py >= el.y - pad && py <= el.y + h + pad;
    }
  }
}

export function elementAt(elements: readonly SceneElement[], px: number, py: number): SceneElement | null {
  // Topmost first.
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTest(elements[i], px, py)) return elements[i];
  }
  return null;
}
