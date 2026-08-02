/* @refresh reload */
// Entry point for the standalone Settings window (settings.html), a separate
// native window from the main canvas. See Settings.tsx for the content and
// lib.rs (`open_settings_window`) for how the window is created.
import { render } from "solid-js/web";
import Settings from "./Settings";

render(() => <Settings />, document.getElementById("root") as HTMLElement);
