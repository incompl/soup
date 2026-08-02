# soup

A simple desktop diagramming app.

I made this for myself but you're welcome to use it.

## Philosophy

The main feature is that it has very few features. High polish, high completeness, no distractions, no bloat.

## Stack

- **Tauri 2** — desktop shell
- **SolidJS + TypeScript + Vite** — UI
- **Canvas 2D** — scene rendering

## Architecture

The scene model lives in TypeScript ([src/scene.ts](src/scene.ts)) as plain
serializable data; the Canvas 2D renderer ([src/renderer.ts](src/renderer.ts))
is a pure function of it. The Rust side is a deliberately thin shell: it grows
only OS-boundary features — screenshots, clipboard images, file dialogs/IO,
and SVG→PDF conversion — exposed as Tauri commands. Exports flow
`scene → SVG (TS) → PDF (Rust)` so the Rust side never needs to understand
the document format.

## Install

No prebuilt releases - build it yourself. Requires [Rust](https://www.rust-lang.org/tools/install), [Node](https://nodejs.org/), and [pnpm](https://pnpm.io/).

```sh
pnpm install
pnpm tauri build
```

On macOS the dmg auto-opens. Drag Soup into Applications and you're good to go.