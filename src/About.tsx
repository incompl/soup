// The About window's content, rendered into its own native window (about.html)
// opened from the app menu's "About" item — see `open_about_window` in
// lib.rs. Like the Settings window it fills the window and ⌘W or Escape close
// it. Shows the version, a tagline, and a link out to the site.

import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createResource, onCleanup, onMount } from "solid-js";
import "./About.css";

const SITE = "https://incompl.com";

export default function About() {
  // The real bundle version (0.1.0…), read from Tauri rather than hardcoded.
  const [version] = createResource(() => getVersion().catch(() => ""));

  onMount(() => {
    // Escape closes the window, matching ⌘W. Under `pnpm dev` (plain browser,
    // no Tauri) there's no native window to close, so the call is a no-op.
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") getCurrentWindow().close().catch(() => {});
  }

  return (
    <main class="about">
      <div class="about-title">soup {version()}</div>
      <div class="about-tagline">vibed by the best</div>
      {/* A real anchor for semantics, but open externally so the click doesn't
          navigate this window away from its own content. */}
      <a
        class="about-link"
        href={SITE}
        onClick={(e) => {
          e.preventDefault();
          void openUrl(SITE).catch(() => {});
        }}
      >
        incompl.com
      </a>
    </main>
  );
}
