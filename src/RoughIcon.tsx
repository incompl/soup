import { onMount, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import rough from "roughjs";
import type { Options } from "roughjs/bin/core";

// Roughen the primitives of an already-rendered icon <svg> in place: each
// path/line/rect/circle/polyline is replaced by its roughjs equivalent, giving
// clean Lucide (or any unplugin-icons) glyphs a hand-drawn edge that matches
// the app's coffee-stain aesthetic. Colour flows through `currentColor`, so the
// toolbar button's own colour still drives active/hover states.
// "Light" sketch level: clearly hand-drawn but every glyph stays legible.
// Per-icon overrides (e.g. a subtler pass for the finer "text" glyph) merge
// over this via RoughIcon's `opts` prop.
const ROUGH_OPTS: Options = {
  stroke: "currentColor",
  fill: "none",
  strokeWidth: 1.4,
  roughness: 0.9,
  bowing: 1,
  // Fixed seed so an icon draws identically on every render instead of
  // wiggling on each reactive update.
  seed: 1,
};

function parsePoints(raw: string | null): [number, number][] {
  if (!raw) return [];
  const nums = raw.trim().split(/[\s,]+/).map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

function num(el: Element, attr: string): number {
  return Number(el.getAttribute(attr) ?? 0);
}

function roughenSvg(svg: SVGSVGElement, opts: Options) {
  const rc = rough.svg(svg);
  // Snapshot children first: we mutate the tree as we go.
  const originals = Array.from(svg.children);
  for (const el of originals) {
    let node: SVGGElement | null = null;
    switch (el.tagName.toLowerCase()) {
      case "path": {
        const d = el.getAttribute("d");
        if (d) node = rc.path(d, opts);
        break;
      }
      case "line":
        node = rc.line(num(el, "x1"), num(el, "y1"), num(el, "x2"), num(el, "y2"), opts);
        break;
      case "rect":
        node = rc.rectangle(num(el, "x"), num(el, "y"), num(el, "width"), num(el, "height"), opts);
        break;
      case "circle":
        node = rc.circle(num(el, "cx"), num(el, "cy"), 2 * num(el, "r"), opts);
        break;
      case "ellipse":
        node = rc.ellipse(num(el, "cx"), num(el, "cy"), 2 * num(el, "rx"), 2 * num(el, "ry"), opts);
        break;
      case "polyline":
        node = rc.linearPath(parsePoints(el.getAttribute("points")), opts);
        break;
      case "polygon":
        node = rc.polygon(parsePoints(el.getAttribute("points")), opts);
        break;
    }
    if (node) svg.replaceChild(node, el);
    else el.remove(); // Unsupported primitive (e.g. <defs>): drop it.
  }
  // The rough nodes carry their own stroke; clear inherited stroke styling so
  // nothing double-draws with a smooth line underneath.
  svg.removeAttribute("stroke-width");
}

export default function RoughIcon(props: { icon: Component; opts?: Partial<Options> }) {
  let holder!: HTMLSpanElement;
  onMount(() => {
    const svg = holder.querySelector("svg");
    if (svg) roughenSvg(svg as SVGSVGElement, { ...ROUGH_OPTS, ...props.opts });
  });
  return (
    <span ref={holder} class="rough-icon">
      <Dynamic component={props.icon} />
    </span>
  );
}
