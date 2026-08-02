import Canvas from "./Canvas";
import Notifications from "./Notifications";
import Toolbar from "./Toolbar";
import { initPersistence } from "./persistence";
import { initExport } from "./export";
import "./App.css";

export default function App() {
  initPersistence();
  initExport();

  return (
    <div class="app">
      <div class="titlebar" data-tauri-drag-region />
      <Toolbar />
      <Canvas />
      <Notifications />
    </div>
  );
}
