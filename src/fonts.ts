// Bundled OFL fonts (Kalam / Lora / Nunito), the three document "Font" choices.
// Bundling rather than relying on system fonts means a drawing looks identical
// on every machine — at the cost of the fonts loading asynchronously, which this
// module manages on two fronts:
//
//   1. Measurement. The app measures text synchronously (hit-testing, element
//      bounds, the arrow-label shaft break — see scene.ts). Until a face loads,
//      the canvas falls back to a system font and measures wrong. We register
//      the faces up front and flip `fontsReady` when they finish, which the
//      canvas render effect reads to repaint with correct metrics.
//   2. Export. An SVG rasterized via <img> (for PNG) or opened elsewhere can't
//      see the app's loaded faces, so `fontFaceCss` hands the exporter a
//      self-contained `@font-face` with the woff2 base64-embedded.
//
// The woff2 files are imported as URLs so Vite fingerprints and bundles them.

import { createSignal } from "solid-js";
import loraUrl from "./fonts/lora-latin-400.woff2";
import shantellUrl from "./fonts/shantell-sans-latin-400.woff2";
import interUrl from "./fonts/inter-latin-400.woff2";

interface BundledFont {
  family: string;
  url: string;
  // Attribution for the Acknowledgements dialog: the OFL copyright line and the
  // font's home. Kept beside the file so the credits can't drift from what ships.
  copyright: string;
  homepage: string;
}

const BUNDLED: readonly BundledFont[] = [
  {
    family: "Shantell Sans",
    url: shantellUrl,
    copyright: "© 2022 The Shantell Sans Project Authors",
    homepage: "https://github.com/arrowtype/shantell-sans",
  },
  {
    family: "Lora",
    url: loraUrl,
    copyright: "© 2011 The Lora Project Authors",
    homepage: "https://github.com/cyrealtype/Lora-Cyrillic",
  },
  {
    family: "Inter",
    url: interUrl,
    copyright: "© 2016 The Inter Project Authors",
    homepage: "https://github.com/rsms/inter",
  },
];

// The bundled fonts' attribution, for the Acknowledgements dialog. All are
// licensed under the SIL Open Font License 1.1.
export interface FontCredit {
  family: string;
  copyright: string;
  homepage: string;
}

export const FONT_CREDITS: readonly FontCredit[] = BUNDLED.map(
  ({ family, copyright, homepage }) => ({ family, copyright, homepage })
);

// Flips true once every bundled face has finished loading (or failed). The
// canvas render effect reads it so text repaints with the real font's metrics
// instead of the momentary fallback's.
const [fontsReady, setFontsReady] = createSignal(false);
export { fontsReady };

let started = false;

// Register the bundled faces with the document so both the canvas (measurement +
// drawing) and the DOM text editors can use them, then signal readiness for a
// repaint. Idempotent; a no-op where the Font Loading API is unavailable.
export function initFonts(): void {
  if (started) return;
  started = true;
  if (typeof document === "undefined" || !("fonts" in document)) {
    setFontsReady(true);
    return;
  }
  for (const { family, url } of BUNDLED) {
    const face = new FontFace(family, `url(${url})`);
    document.fonts.add(face);
    // Nudge the load; `document.fonts.ready` below waits on all of them.
    void face.load().catch(() => {});
  }
  document.fonts.ready.then(() => setFontsReady(true)).catch(() => setFontsReady(true));
}

// --- SVG-embeddable @font-face ----------------------------------------------

// family -> a self-contained `@font-face` rule with the woff2 base64-inlined.
const faceCssCache = new Map<string, string>();

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  // Chunked to stay clear of the argument-count limit on String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Fetch + base64-encode every bundled woff2 once, caching the `@font-face` rule.
// Called before an export so `fontFaceCss` can resolve synchronously.
export async function ensureFontFaceCss(): Promise<void> {
  await Promise.all(
    BUNDLED.map(async ({ family, url }) => {
      if (faceCssCache.has(family)) return;
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const b64 = toBase64(buf);
        faceCssCache.set(
          family,
          `@font-face{font-family:"${family}";font-style:normal;font-weight:400;` +
            `src:url(data:font/woff2;base64,${b64}) format("woff2");}`
        );
      } catch {
        faceCssCache.set(family, ""); // Give up on this one; text falls back.
      }
    })
  );
}

// The embeddable `@font-face` rule for a family, or "" if not yet cached (call
// ensureFontFaceCss first). Unknown families (none, currently) yield "".
export function fontFaceCss(family: string): string {
  return faceCssCache.get(family) ?? "";
}
