// Scene model: plain serializable data with no rendering or DOM concerns.
// This is the single source of truth. Save/load and picture export (SVG/PNG)
// all serialize from these types, so keep them JSON-friendly.

export type Tool = "select" | "rect" | "arrow" | "text";

// Optional look shared by every element type. All absent at their defaults so a
// plain shape stays clean in the saved document (see how `label`/bindings are
// kept out too): color absent ⇒ STROKE ink, fontSize absent ⇒ FONT_SIZE.
export interface ElementStyle {
  // The element's ink: rect/arrow stroke (and arrowheads) + its own label; a
  // text element's fill. Absent ⇒ the default STROKE.
  color?: string;
  // Size of this element's text/label in px. Absent ⇒ FONT_SIZE.
  fontSize?: number;
}

export interface RectElement extends ElementStyle {
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

// A spot on an element's perimeter, given as normalized coordinates within its
// box: each of nx/ny is one of {0, .25, .5, .75, 1}, with at least one pinned to
// 0 or 1 so the point sits on an edge. This covers the 4 corners, the 4 side
// midpoints, and the 8 quarter points between them — 16 spots in all. An arrow
// endpoint "locks" to a spot: the position is stored, but the actual coordinate
// is always derived from the target's current geometry (see boundEndpoint), so
// a bound endpoint tracks the target as it moves and resizes.
export interface AnchorPos {
  nx: number;
  ny: number;
}

export interface Binding {
  elementId: string;
  nx: number;
  ny: number;
}

export interface ArrowElement extends ElementStyle {
  id: string;
  type: "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  // Which ends carry an arrowhead. Absent ⇒ the classic single head at the end
  // (start=false, end=true). Toggled per-end by clicking an endpoint handle
  // without dragging it (see Canvas onPointerUp).
  startHead?: boolean;
  endHead?: boolean;
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

export interface TextElement extends ElementStyle {
  id: string;
  type: "text";
  x: number;
  y: number;
  text: string;
}

export type SceneElement = RectElement | ArrowElement | TextElement;

export const FONT_SIZE = 16;
export const LINE_HEIGHT = 22;

// --- Document settings -------------------------------------------------------
//
// Per-document (not per-app) preferences, saved inside the `.soup` file rather
// than the global app settings — a drawing carries its own look. Set from the
// native Document menu (see lib.rs / doc-menu.ts). Two knobs so far:
//   - lineStyle: "rough" hand-drawn strokes (roughjs) vs. "clean" straight ones.
//   - font: which web-safe family text and labels render in.

export type LineStyle = "rough" | "clean";
export type DocFont = "sketch" | "serif" | "sans";

export interface DocSettings {
  lineStyle: LineStyle;
  font: DocFont;
}

export const DEFAULT_DOC_SETTINGS: DocSettings = { lineStyle: "rough", font: "sketch" };

// The bundled OFL face backing each choice (loaded in fonts.ts). Named
// separately from the stacks below so font loading and SVG-embed can address the
// exact family, while the stacks keep a generic fallback for the brief window
// before the woff2 finishes loading.
export const BUNDLED_PRIMARY: Record<DocFont, string> = {
  sketch: "Shantell Sans",
  serif: "Lora",
  sans: "Inter",
};

// Font-family stacks per choice: the bundled face first, then a same-genre
// fallback used only until that face loads (see fonts.ts).
export const FONT_FAMILIES: Record<DocFont, string> = {
  sketch: '"Shantell Sans", cursive',
  serif: '"Lora", Georgia, "Times New Roman", serif',
  sans: '"Inter", ui-sans-serif, system-ui, sans-serif',
};

// The family the current document measures and draws with. A document setting,
// not a constant: the whole app renders one scene at a time, so the active font
// lives here as module state and setActiveFont keeps it in step with the store
// (on load and on a Font-menu change). measureText, the renderer, the text
// editors, and the SVG export all read it, so measurement and drawing never
// drift. Starts at the default (sketch) so first paint matches a fresh document.
let activeFontFamily = FONT_FAMILIES[DEFAULT_DOC_SETTINGS.font];

export function setActiveFont(font: DocFont): void {
  activeFontFamily = FONT_FAMILIES[font];
}

// The active family alone (SVG export wants font-family separately from size).
export function fontFamily(): string {
  return activeFontFamily;
}

// The active font as a CSS/canvas `font` shorthand at the given size (defaulting
// to the base FONT_SIZE), in the document's active family.
export function fontString(size: number = FONT_SIZE): string {
  return `${size}px ${activeFontFamily}`;
}

// Line height for a given font size, keeping the base LINE_HEIGHT/FONT_SIZE
// ratio so resized text keeps the same leading proportion.
export function lineHeightFor(size: number = FONT_SIZE): number {
  return size * (LINE_HEIGHT / FONT_SIZE);
}

export function newId(): string {
  return crypto.randomUUID();
}

const measureCtx = document.createElement("canvas").getContext("2d")!;

export function measureText(text: string, size: number = FONT_SIZE): { w: number; h: number } {
  measureCtx.font = fontString(size);
  const lines = text.split("\n");
  let w = 0;
  for (const line of lines) {
    w = Math.max(w, measureCtx.measureText(line).width);
  }
  return { w, h: lines.length * lineHeightFor(size) };
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
        const { w, h } = measureText(el.label, el.fontSize);
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
      const { w, h } = measureText(el.text, el.fontSize);
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
      const { w, h } = measureText(el.text, el.fontSize);
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

// --- Property badges ---------------------------------------------------------
//
// Two tiny controls that ride above a selection's top-right corner (one element
// or a whole multi-selection), kept about handle-sized so they barely add to the
// box's footprint:
//   - "font": drag to scale the text size, or click for a preset menu.
//   - "color": drag over the ink grid, or click to open it.
// A change applies to every selected element. Like elementHandles/handleAt, this
// is the single source of truth shared by the renderer (which draws them) and
// Canvas hit-testing (which grabs them).

export type BadgeKind = "font" | "color";

export interface Badge {
  kind: BadgeKind;
  // Center of the drawn badge, in scene pixels.
  x: number;
  y: number;
}

// Drawn side length of a badge square, and the half-extent of its (larger,
// invisible) grab target.
export const BADGE_SIZE = 16;
const BADGE_GAP = 5;
const BADGE_GRAB = BADGE_SIZE / 2 + 3;
// Clearance from the selection box's top edge (drawn `pad`=6 outside the bounds)
// up to the badge centers.
const BADGE_MARGIN = 3;

// Whether an element has text whose size the font badge would control: a text
// element with content, or a rect/arrow carrying a label.
function hasText(el: SceneElement): boolean {
  return el.type === "text" ? el.text.length > 0 : !!el.label;
}

// Badge positions above a box's top-right corner. Color is always offered and
// sits rightmost; the font badge (only when `showFont`) sits to its left.
function badgesForBox(box: { x: number; y: number; w: number; h: number }, showFont: boolean): Badge[] {
  const pad = 6; // matches drawSelection's outset
  const cy = box.y - pad - BADGE_SIZE / 2 - BADGE_MARGIN;
  const colorX = box.x + box.w + pad - BADGE_SIZE / 2;
  const badges: Badge[] = [];
  if (showFont) badges.push({ kind: "font", x: colorX - BADGE_SIZE - BADGE_GAP, y: cy });
  badges.push({ kind: "color", x: colorX, y: cy });
  return badges;
}

// Union of the given elements' bounding boxes, or null when there are none.
export function unionBounds(
  els: readonly SceneElement[]
): { x: number; y: number; w: number; h: number } | null {
  let box: { x: number; y: number; w: number; h: number } | null = null;
  for (const el of els) {
    const b = elementBounds(el);
    if (!box) {
      box = { ...b };
    } else {
      const x = Math.min(box.x, b.x);
      const y = Math.min(box.y, b.y);
      box = { x, y, w: Math.max(box.x + box.w, b.x + b.w) - x, h: Math.max(box.y + box.h, b.y + b.h) - y };
    }
  }
  return box;
}

// The property badges for a selection (one element or many): positioned above
// its combined bounding box, with the font badge shown when any selected element
// has text to size. Empty when nothing is selected.
export function selectionBadges(elements: readonly SceneElement[], ids: readonly string[]): Badge[] {
  const sel = elements.filter((e) => ids.includes(e.id));
  const box = unionBounds(sel);
  if (!box) return [];
  return badgesForBox(box, sel.some(hasText));
}

// The selection badge at (px, py), or null.
export function selectionBadgeAt(
  elements: readonly SceneElement[],
  ids: readonly string[],
  px: number,
  py: number
): BadgeKind | null {
  for (const bd of selectionBadges(elements, ids)) {
    if (Math.abs(px - bd.x) <= BADGE_GRAB && Math.abs(py - bd.y) <= BADGE_GRAB) return bd.kind;
  }
  return null;
}

// Curated ink tones for the color grid — muted, drawing-friendly colors (incl.
// the app's coffee brown) rather than a raw spectrum. The default STROKE ink
// leads, so returning to it is one click. Laid out INK_GRID_COLS per row.
export const INK_COLORS: readonly string[] = [
  "#1e1e1e", "#4a4a4a", "#808080", "#b3b3b3", "#5a3a24",
  "#c0392b", "#e67e22", "#d4a017", "#6a8f3c", "#2e8b7f",
  "#2e6f9e", "#3f51b5", "#7e57c2", "#b0578d", "#8d6e63",
];
export const INK_GRID_COLS = 5;

// Preset text sizes for the font badge's quick menu.
export const FONT_PRESETS: readonly { label: string; size: number }[] = [
  { label: "S", size: 12 },
  { label: "M", size: 16 },
  { label: "L", size: 24 },
  { label: "XL", size: 40 },
];

// Bounds a dragged/typed font size to a sane range.
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 96;
export function clampFontSize(size: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(size)));
}

// --- Arrow-to-element bindings -----------------------------------------------
//
// Any element with a rectangular footprint (rectangles and text) offers sixteen
// attachment spots around its perimeter (corners, side midpoints, and the
// quarter points between them). An arrow endpoint snaps to a spot and lands a
// small gap outside the edge, so the arrowhead/tail stops just short of the
// outline instead of overlapping it.

// Small clearance kept between a bound endpoint and the rectangle edge.
export const BINDING_GAP = 6;
// How close (px) an endpoint must come to a spot's midpoint to snap onto it.
export const ANCHOR_SNAP_DIST = 20;
// Drawn radius of the attachment spots shown while placing an endpoint.
export const ANCHOR_DOT_R = 4;
// Shortest edge length (px) that still fits the two quarter spots between a
// corner and the side midpoint without them looking cramped. Below this, an
// edge shows only its corners and midpoint; the quarter spots on that edge stay
// hidden (though still bindable). At this length the spots sit a quarter of the
// edge apart, ~14px, comfortably clear of one another.
export const QUARTER_ANCHOR_MIN_EDGE = 56;
// Shortest edge length (px) at which a quarter spot exists at all. The spots sit
// a quarter-edge apart, so below 8·ANCHOR_DOT_R that spacing is under a dot
// diameter and they'd overlap their neighbors. Under this, an edge's quarter
// spots don't exist as targets — not drawn, not snappable even when hovered
// (though an arrow already bound to one still holds, since bindings resolve from
// the stored position, not this list).
export const QUARTER_ANCHOR_MIN_FIT = 8 * ANCHOR_DOT_R;

export interface Anchor {
  nx: number;
  ny: number;
  x: number;
  y: number;
  // Whether this spot is drawn / freely snappable at the element's current
  // size. Quarter spots go invisible on a short edge to cut clutter; corners
  // and midpoints are always visible. Invisible spots still exist as binding
  // targets — an arrow already attached to one stays attached, and aiming at one
  // reveals just that spot (it becomes the active anchor). Quarter spots with no
  // room at all (see QUARTER_ANCHOR_MIN_FIT) are omitted from the list instead.
  visible: boolean;
}

// The 16 perimeter spots as normalized positions, walked clockwise from the
// top-left corner so the ordering is stable. Shared by every bindable element.
const ANCHOR_POSITIONS: readonly AnchorPos[] = (() => {
  const steps = [0, 0.25, 0.5, 0.75];
  const pts: AnchorPos[] = [];
  for (const t of steps) pts.push({ nx: t, ny: 0 }); // top edge, left→right
  for (const t of steps) pts.push({ nx: 1, ny: t }); // right edge, top→bottom
  for (const t of steps) pts.push({ nx: 1 - t, ny: 1 }); // bottom edge, right→left
  for (const t of steps) pts.push({ nx: 0, ny: 1 - t }); // left edge, bottom→top
  return pts;
})();

// The rectangular footprint an element exposes anchors on, or null for elements
// that can't be bound to (arrows). Rectangles use their own box; text uses its
// measured extent from its top-left origin.
export function anchorBox(el: SceneElement): { x: number; y: number; w: number; h: number } | null {
  switch (el.type) {
    case "rect":
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case "text": {
      const { w, h } = measureText(el.text, el.fontSize);
      return { x: el.x, y: el.y, w, h };
    }
    case "arrow":
      return null;
  }
}

// The edge length that governs a quarter spot: its width for a spot on a
// horizontal edge (nx at 0.25/0.75), its height for one on a vertical edge (ny
// at 0.25/0.75). Null for corners and midpoints, which never depend on size.
function quarterEdge(p: AnchorPos, w: number, h: number): number | null {
  if (p.nx === 0.25 || p.nx === 0.75) return w;
  if (p.ny === 0.25 || p.ny === 0.75) return h;
  return null;
}

// The perimeter spots of an element, where the binding dots are drawn and where
// endpoints snap; empty for elements that can't be bound to. This is the single
// source of truth shared by the renderer (which draws the dots) and Canvas
// snapping, so they never drift. Quarter spots with no room at all are left out
// entirely; those merely cramped are included but flagged not-visible.
export function elementAnchors(el: SceneElement): Anchor[] {
  const box = anchorBox(el);
  if (!box) return [];
  const out: Anchor[] = [];
  for (const p of ANCHOR_POSITIONS) {
    const edge = quarterEdge(p, box.w, box.h);
    if (edge !== null && edge < QUARTER_ANCHOR_MIN_FIT) continue;
    out.push({
      nx: p.nx,
      ny: p.ny,
      x: box.x + p.nx * box.w,
      y: box.y + p.ny * box.h,
      visible: edge === null || edge >= QUARTER_ANCHOR_MIN_EDGE,
    });
  }
  return out;
}

// Where a bound endpoint actually lands: the target's perimeter spot pushed out
// by BINDING_GAP along the outward normal (diagonal at corners). Null when the
// target can't be bound to (arrow, or a missing element), so callers can drop
// the binding.
export function boundEndpoint(el: SceneElement, pos: AnchorPos): { x: number; y: number } | null {
  const box = anchorBox(el);
  if (!box) return null;
  const x = box.x + pos.nx * box.w;
  const y = box.y + pos.ny * box.h;
  const ox = pos.nx === 0 ? -1 : pos.nx === 1 ? 1 : 0;
  const oy = pos.ny === 0 ? -1 : pos.ny === 1 ? 1 : 0;
  const len = Math.hypot(ox, oy) || 1;
  return { x: x + (ox / len) * BINDING_GAP, y: y + (oy / len) * BINDING_GAP };
}

// The nearest element attachment spot to (px, py) within ANCHOR_SNAP_DIST, or
// null. Distance is measured to the on-edge midpoint (the visible dot the user
// aims at); the returned x/y is the resolved, gapped endpoint to place the
// arrow at. Only spots the user can actually see snap: an element's hidden
// quarter spots stay out of reach unless it's the hovered element, which
// reveals them.
export function nearestAnchor(
  elements: readonly SceneElement[],
  px: number,
  py: number,
  hoveredId: string | null = null
): { elementId: string; nx: number; ny: number; x: number; y: number } | null {
  let best: { elementId: string; nx: number; ny: number; x: number; y: number } | null = null;
  let bestDist = ANCHOR_SNAP_DIST;
  for (const el of elements) {
    for (const a of elementAnchors(el)) {
      if (!a.visible && el.id !== hoveredId) continue;
      const d = Math.hypot(px - a.x, py - a.y);
      if (d <= bestDist) {
        bestDist = d;
        const p = boundEndpoint(el, a)!;
        best = { elementId: el.id, nx: a.nx, ny: a.ny, x: p.x, y: p.y };
      }
    }
  }
  return best;
}

// The topmost bindable element the pointer is over, counting a margin of
// ANCHOR_SNAP_DIST around its footprint so its perimeter spots (which sit just
// outside the edge) count as hovered too. Used to reveal an element's hidden
// quarter spots while placing an arrow. Null when the pointer is over nothing
// bindable.
export function hoveredAnchorElement(
  elements: readonly SceneElement[],
  px: number,
  py: number
): string | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const box = anchorBox(elements[i]);
    if (!box) continue;
    if (
      px >= box.x - ANCHOR_SNAP_DIST &&
      px <= box.x + box.w + ANCHOR_SNAP_DIST &&
      py >= box.y - ANCHOR_SNAP_DIST &&
      py <= box.y + box.h + ANCHOR_SNAP_DIST
    ) {
      return elements[i].id;
    }
  }
  return null;
}

// Snap bound arrow endpoints back onto their targets. Called after any
// mutation: a bound endpoint always derives from its target's current geometry,
// and a binding whose target is gone (or no longer bindable) is dropped — the
// arrow keeps its last position. Mutates in place so it composes inside a store
// produce().
export function reconcileBindings(elements: SceneElement[]): void {
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const el of elements) {
    if (el.type !== "arrow") continue;
    if (el.startBinding) {
      const t = byId.get(el.startBinding.elementId);
      const p = t ? boundEndpoint(t, el.startBinding) : null;
      if (p) {
        el.x1 = p.x;
        el.y1 = p.y;
      } else {
        el.startBinding = undefined;
      }
    }
    if (el.endBinding) {
      const t = byId.get(el.endBinding.elementId);
      const p = t ? boundEndpoint(t, el.endBinding) : null;
      if (p) {
        el.x2 = p.x;
        el.y2 = p.y;
      } else {
        el.endBinding = undefined;
      }
    }
  }
}
