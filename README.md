# soup

A sketching app (in the vein of Excalidraw / Scapple). Currently a minimal
skeleton: rectangle, arrow, and text tools.

## Stack

- **Tauri 2** — desktop shell
- **SolidJS + TypeScript + Vite** — UI, managed with **pnpm**
- **Canvas 2D** — scene rendering (immediate mode, Excalidraw-style)

## Architecture

The scene model lives in TypeScript ([src/scene.ts](src/scene.ts)) as plain
serializable data; the Canvas 2D renderer ([src/renderer.ts](src/renderer.ts))
is a pure function of it. The Rust side is a deliberately thin shell: it grows
only OS-boundary features — screenshots, clipboard images, file dialogs/IO,
and SVG→PDF conversion — exposed as Tauri commands. Exports flow
`scene → SVG (TS) → PDF (Rust)` so the Rust side never needs to understand
the document format.

## Development

```sh
pnpm install
pnpm tauri dev
```

## Shortcuts

- `V`/`1` select, `R`/`2` rectangle, `A`/`3` arrow, `T`/`4` text
- `Delete`/`Backspace` removes the selection; `Escape` deselects
- Text: `Enter` commits, `Shift+Enter` for a new line
