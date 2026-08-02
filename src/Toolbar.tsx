import { For, type Component } from "solid-js";
import type { Tool } from "./scene";
import { setTool, state } from "./store";
import { settings } from "./settings-store";
import { keyForTool } from "./shortcuts";
import RoughIcon from "./RoughIcon";
import IconSelect from "~icons/lucide/mouse-pointer-2";
import IconRect from "~icons/lucide/square";
import IconArrow from "~icons/lucide/move-up-right";
import IconText from "~icons/lucide/type";

interface ToolDef {
  tool: Tool;
  label: string;
  icon: Component;
  // Per-icon sketch override; the finer "text" glyph reads better subtler.
  opts?: { roughness?: number; bowing?: number };
}

const TOOLS: ToolDef[] = [
  { tool: "select", label: "Select", icon: IconSelect },
  { tool: "rect", label: "Rectangle", icon: IconRect },
  { tool: "arrow", label: "Arrow", icon: IconArrow },
  { tool: "text", label: "Text", icon: IconText, opts: { roughness: 0.6, bowing: 0.5 } },
];

export default function Toolbar() {
  return (
    <div class="toolbar">
      <For each={TOOLS}>
        {({ tool, label, icon, opts }) => (
          <button
            classList={{ active: state.tool === tool }}
            onClick={() => setTool(tool)}
            title={`${label} (${keyForTool(tool, settings.shortcutScheme)})`}
            aria-label={label}
          >
            <RoughIcon icon={icon} opts={opts} />
          </button>
        )}
      </For>
    </div>
  );
}
