/* @refresh reload */
// Entry point for the standalone About window (about.html), a separate native
// window from the main canvas. See About.tsx for the content and lib.rs
// (`open_about_window`) for how the window is created.
import { render } from "solid-js/web";
import About from "./About";

render(() => <About />, document.getElementById("root") as HTMLElement);
