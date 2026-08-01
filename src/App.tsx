import Canvas from "./Canvas";
import Notifications from "./Notifications";
import Toolbar from "./Toolbar";
import { initPersistence } from "./persistence";
import "./App.css";

export default function App() {
  initPersistence();

  return (
    <div class="app">
      <div class="titlebar" data-tauri-drag-region />
      <Toolbar />
      <Canvas />
      <Notifications />
    </div>
  );
}
