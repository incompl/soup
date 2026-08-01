# soup

SolidJS + Tauri drawing app. Vite frontend in `src/`.

## Package manager

Use **pnpm** (`pnpm add`, `pnpm install`). `node_modules` is a pnpm store — running `npm install` crashes its resolver.

## Run & preview

```sh
pnpm dev            # Vite dev server on :1420 (or `pnpm tauri dev` for the native shell)
```

To eyeball a canvas render without drawing by hand: serve a throwaway `*.html` at the repo root that imports the real `/src/renderer.ts` and calls `renderScene` with canned elements, then screenshot it headless:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --force-device-scale-factor=2 --virtual-time-budget=2000 \
  --default-background-color=00000000 --screenshot=out.png --window-size=640,360 \
  "http://localhost:1420/verify.html"
```

Delete the temp HTML afterward.
