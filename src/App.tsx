import Canvas from "./Canvas";
import Notifications from "./Notifications";
import Toolbar from "./Toolbar";
import { initPersistence } from "./persistence";
import { initExport } from "./export";
import { initDocMenu } from "./doc-menu";
import { initFonts } from "./fonts";
import { initAcknowledgements } from "./acknowledgements";
import "./App.css";

export default function App() {
  initFonts();
  initPersistence();
  initExport();
  initDocMenu();
  initAcknowledgements();

  return (
    <div class="app">
      <div class="titlebar" data-tauri-drag-region />
      <Toolbar />
      <Canvas />
      <Notifications />
    </div>
  );
}
