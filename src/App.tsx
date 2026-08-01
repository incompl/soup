import Canvas from "./Canvas";
import Toolbar from "./Toolbar";
import "./App.css";

export default function App() {
  return (
    <div class="app">
      <div class="titlebar" data-tauri-drag-region />
      <Toolbar />
      <Canvas />
    </div>
  );
}
