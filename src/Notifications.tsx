import { For } from "solid-js";
import { notifications } from "./notification-store";
import "./Notifications.css";

// Stack of transient toasts pinned to the upper-left corner. Purely a view
// over the notifications signal; lifecycle lives in notifications.ts.
export default function Notifications() {
  return (
    <div class="notifications">
      <For each={notifications}>
        {(n) => (
          <div
            class="notification"
            classList={{ leaving: n.leaving, success: n.kind === "success", error: n.kind === "error" }}
          >
            {n.message}
          </div>
        )}
      </For>
    </div>
  );
}
