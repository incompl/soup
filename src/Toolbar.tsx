import { For } from "solid-js";
import type { Tool } from "./scene";
import { setTool, state } from "./store";

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "V" },
  { tool: "rect", label: "Rectangle", key: "R" },
  { tool: "arrow", label: "Arrow", key: "A" },
  { tool: "text", label: "Text", key: "T" },
];

export default function Toolbar() {
  return (
    <div class="toolbar">
      <For each={TOOLS}>
        {({ tool, label, key }) => (
          <button
            classList={{ active: state.tool === tool }}
            onClick={() => setTool(tool)}
            title={`${label} (${key})`}
          >
            {label}
          </button>
        )}
      </For>
    </div>
  );
}
