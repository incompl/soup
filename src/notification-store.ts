// Lightweight, transient notifications ("toasts") shown in the upper-left
// corner — a "Saved!" confirmation, an error, or any other brief message.
//
// A notification appears instantly, holds for a moment, then fades out on its
// own. Callers just fire-and-forget `notify(...)`; the lifecycle (hold →
// fade → removal) is managed here so the UI component stays declarative.

import { createStore, produce } from "solid-js/store";

export type NotificationKind = "info" | "success" | "error";

export interface Notification {
  id: number;
  message: string;
  kind: NotificationKind;
  // Flipped on when the hold time elapses so the view can transition to
  // transparent; the entry is dropped once the fade finishes.
  leaving: boolean;
}

// A notification barely holds before it starts fading, then drifts out over a
// long, slow alpha fade. The fade duration must match the CSS transition.
const HOLD_MS = 250;
const FADE_MS = 500;

// A store (not a plain signal) so `leaving` can be flipped in place: the view's
// <For> keeps the same DOM node, so toggling the class actually transitions.
// Replacing the object instead would re-mount the node and skip the fade.
const [notifications, setNotifications] = createStore<Notification[]>([]);

export { notifications };

let nextId = 1;

export function notify(message: string, kind: NotificationKind = "info"): void {
  const id = nextId++;
  // Newest first, so the freshest toast is pinned to the corner and any older,
  // still-fading ones slide below it rather than pushing it out of place.
  setNotifications(produce((list) => list.unshift({ id, message, kind, leaving: false })));

  // Start the fade after the hold, then remove once it's finished.
  setTimeout(() => {
    setNotifications((n) => n.id === id, "leaving", true);
    setTimeout(() => {
      setNotifications(produce((list) => {
        const i = list.findIndex((n) => n.id === id);
        if (i >= 0) list.splice(i, 1);
      }));
    }, FADE_MS);
  }, HOLD_MS);
}
