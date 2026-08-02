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
  // Optional centered label. Absent (not "") when empty, so blank labels
  // never hit the saved document — see commitLabel in Canvas.tsx.
  label?: string;
}

// One of a rectangle's four side-midpoint attachment spots. An arrow endpoint
// "locks" to a spot: the side is stored, but the actual coordinate is always
// derived from the rectangle's current geometry (see boundEndpoint), so a
// bound endpoint tracks the rectangle as it moves and resizes.
export type AnchorSide = "top" | "right" | "bottom" | "left";

export interface Binding {
  elementId: string;
  side: AnchorSide;
}

export interface ArrowElement {
  id: string;
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // Optional centered label. The shaft "breaks" around it while set, and
  // rejoins once cleared. Absent (not "") when empty, so it stays out of the
  // saved document — see commitLabel in Canvas.tsx.
  label?: string;
  // Optional bindings locking each end to a rectangle's side. Absent when the
  // end is free, so unbound arrows stay clean in the saved document. The
  // endpoint coordinates above are kept in sync from the binding by
  // reconcileBindings after any mutation.
  startBinding?: Binding;
  endBinding?: Binding;
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
    case "arrow": {
      if (distToSegment(px, py, el.x1, el.y1, el.x2, el.y2) <= pad) return true;
      // The label sits in the shaft's gap, off the line itself, so also treat
      // its centered box as part of the arrow — clicking the text selects (and
      // double-clicking edits) the arrow.
      if (el.label) {
        const { w, h } = measureText(el.label);
        const cx = (el.x1 + el.x2) / 2;
        const cy = (el.y1 + el.y2) / 2;
        return (
          px >= cx - w / 2 - pad &&
          px <= cx + w / 2 + pad &&
          py >= cy - h / 2 - pad &&
          py <= cy + h / 2 + pad
        );
      }
      return false;
    }
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

// Axis-aligned bounding box of an element. Shared by marquee selection; the
// arrow box spans its endpoints, text its measured extent.
export function elementBounds(el: SceneElement): { x: number; y: number; w: number; h: number } {
  switch (el.type) {
    case "rect":
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case "arrow":
      return {
        x: Math.min(el.x1, el.x2),
        y: Math.min(el.y1, el.y2),
        w: Math.abs(el.x2 - el.x1),
        h: Math.abs(el.y2 - el.y1),
      };
    case "text": {
      const { w, h } = measureText(el.text);
      return { x: el.x, y: el.y, w, h };
    }
  }
}

// Ids of every element whose bounding box overlaps the rectangle given by two
// opposite corners (a drag-to-select marquee). Any intersection counts, so an
// element is caught the moment the box touches it.
export function elementsInBox(
  elements: readonly SceneElement[],
  ax: number,
  ay: number,
  bx: number,
  by: number
): string[] {
  const left = Math.min(ax, bx);
  const right = Math.max(ax, bx);
  const top = Math.min(ay, by);
  const bottom = Math.max(ay, by);
  const ids: string[] = [];
  for (const el of elements) {
    const b = elementBounds(el);
    if (b.x <= right && b.x + b.w >= left && b.y <= bottom && b.y + b.h >= top) {
      ids.push(el.id);
    }
  }
  return ids;
}

// Resize handles for the selected element: a rect exposes its four corners,
// an arrow its two endpoints. Text has none (it's sized by its content).
// This is the single source of truth shared by the renderer (which draws the
// squares) and Canvas hit-testing (which grabs them), so they never drift.
export type HandlePos = "nw" | "ne" | "se" | "sw" | "start" | "end";

export interface Handle {
  pos: HandlePos;
  x: number;
  y: number;
}

// Side length of the drawn handle square, in CSS pixels.
export const HANDLE_SIZE = 8;
// Half-extent of the (larger, invisible) grab target around each handle, so
// they're easy to hit without pixel-perfect aiming.
const HANDLE_GRAB = 9;

export function elementHandles(el: SceneElement): Handle[] {
  switch (el.type) {
    case "rect":
      return [
        { pos: "nw", x: el.x, y: el.y },
        { pos: "ne", x: el.x + el.w, y: el.y },
        { pos: "se", x: el.x + el.w, y: el.y + el.h },
        { pos: "sw", x: el.x, y: el.y + el.h },
      ];
    case "arrow":
      return [
        { pos: "start", x: el.x1, y: el.y1 },
        { pos: "end", x: el.x2, y: el.y2 },
      ];
    case "text":
      return [];
  }
}

// The handle at (px, py) on the given element, or null. Topmost concern is a
// generous square grab box centered on each handle.
export function handleAt(el: SceneElement, px: number, py: number): HandlePos | null {
  for (const h of elementHandles(el)) {
    if (Math.abs(px - h.x) <= HANDLE_GRAB && Math.abs(py - h.y) <= HANDLE_GRAB) {
      return h.pos;
    }
  }
  return null;
}

// --- Arrow-to-rectangle bindings ---------------------------------------------
//
// Each rectangle offers four attachment spots at its side midpoints. An arrow
// endpoint snaps to a spot and lands a small gap outside the edge, so the
// arrowhead/tail stops just short of the outline instead of overlapping it.

// Small clearance kept between a bound endpoint and the rectangle edge.
export const BINDING_GAP = 6;
// How close (px) an endpoint must come to a spot's midpoint to snap onto it.
export const ANCHOR_SNAP_DIST = 20;
// Drawn radius of the attachment spots shown while placing an endpoint.
export const ANCHOR_DOT_R = 4;

export interface Anchor {
  side: AnchorSide;
  x: number;
  y: number;
}

// The four side-midpoint spots of a rectangle, where the binding dots are
// drawn and where endpoints snap. This is the single source of truth shared by
// the renderer (which draws the dots) and Canvas snapping, so they never drift.
export function rectAnchors(rect: RectElement): Anchor[] {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return [
    { side: "top", x: cx, y: rect.y },
    { side: "right", x: rect.x + rect.w, y: cy },
    { side: "bottom", x: cx, y: rect.y + rect.h },
    { side: "left", x: rect.x, y: cy },
  ];
}

// Where a bound endpoint actually lands: the side midpoint pushed out by
// BINDING_GAP along the outward normal.
export function boundEndpoint(rect: RectElement, side: AnchorSide): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  switch (side) {
    case "top":
      return { x: cx, y: rect.y - BINDING_GAP };
    case "right":
      return { x: rect.x + rect.w + BINDING_GAP, y: cy };
    case "bottom":
      return { x: cx, y: rect.y + rect.h + BINDING_GAP };
    case "left":
      return { x: rect.x - BINDING_GAP, y: cy };
  }
}

// The nearest rectangle attachment spot to (px, py) within ANCHOR_SNAP_DIST, or
// null. Distance is measured to the on-edge midpoint (the visible dot the user
// aims at); the returned x/y is the resolved, gapped endpoint to place the
// arrow at.
export function nearestAnchor(
  elements: readonly SceneElement[],
  px: number,
  py: number
): { elementId: string; side: AnchorSide; x: number; y: number } | null {
  let best: { elementId: string; side: AnchorSide; x: number; y: number } | null = null;
  let bestDist = ANCHOR_SNAP_DIST;
  for (const el of elements) {
    if (el.type !== "rect") continue;
    for (const a of rectAnchors(el)) {
      const d = Math.hypot(px - a.x, py - a.y);
      if (d <= bestDist) {
        bestDist = d;
        const p = boundEndpoint(el, a.side);
        best = { elementId: el.id, side: a.side, x: p.x, y: p.y };
      }
    }
  }
  return best;
}

// Snap bound arrow endpoints back onto their rectangles. Called after any
// mutation: a bound endpoint always derives from its rectangle's current
// geometry, and a binding whose rectangle is gone is dropped — the arrow keeps
// its last position. Mutates in place so it composes inside a store produce().
export function reconcileBindings(elements: SceneElement[]): void {
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const el of elements) {
    if (el.type !== "arrow") continue;
    if (el.startBinding) {
      const t = byId.get(el.startBinding.elementId);
      if (t && t.type === "rect") {
        const p = boundEndpoint(t, el.startBinding.side);
        el.x1 = p.x;
        el.y1 = p.y;
      } else {
        el.startBinding = undefined;
      }
    }
    if (el.endBinding) {
      const t = byId.get(el.endBinding.elementId);
      if (t && t.type === "rect") {
        const p = boundEndpoint(t, el.endBinding.side);
        el.x2 = p.x;
        el.y2 = p.y;
      } else {
        el.endBinding = undefined;
      }
    }
  }
}
