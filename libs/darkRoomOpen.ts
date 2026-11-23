import { useSyncExternalStore } from "react";

/**
 * Whether a dark room (the live viewer) is the screen on top while the app is
 * on a light theme. The strips under the status bar and the gesture bar belong
 * to the app's root view, not to the screen, so they stay the page colour:
 * white, under the room's white clock. App paints them black while this is on.
 */
let holders = 0;
const listeners = new Set<() => void>();

/** Turns the strips black until the returned release is called. */
export function holdDarkRoom(): () => void {
  holders += 1;
  if (holders === 1) listeners.forEach(listener => listener());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) listeners.forEach(listener => listener());
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useDarkRoomOpen() {
  return useSyncExternalStore(subscribe, () => holders > 0, () => false);
}
