import { useEffect, useRef } from "react";
import { addVolumeKeyListener } from "../modules/media-bridge";
import { setMutedState } from "./videoMutedState";
import { getVolume, setVolume } from "./video-preferences";
import { visualActivity } from "./visualActivity";

/**
 * Pressing the phone's volume-up key unmutes the video on screen, the way
 * every other video app behaves. Before this the press only raised the
 * system volume while the player stayed muted, so nothing was heard.
 *
 * One native subscription for the whole app; each mounted player registers
 * a handler that unmutes itself if it is the one playing. The shared mute
 * choice is cleared as well, so the next video starts with sound and the
 * surfaces that read it (Shorts) follow straight away.
 */
const handlers = new Set<() => void>();
let unsubscribe: (() => void) | null = null;

function onVolumeUp() {
  // Let the system change output volume without unmuting an obscured video.
  if (visualActivity.isStoryViewerOpen()) return;
  console.log("[volume-keys] volume up");
  setMutedState(false);
  // A video's own level dragged to the bottom is a mute too (the speaker
  // shows muted at level 0), and players follow this level as it changes.
  try { if (getVolume() === 0) setVolume(0.8); } catch {}
  handlers.forEach((fn) => {
    try { fn(); } catch {}
  });
}

function retain(fn: () => void): () => void {
  handlers.add(fn);
  if (!unsubscribe) {
    unsubscribe = addVolumeKeyListener((direction) => {
      if (direction === "up") onVolumeUp();
    });
  }
  return () => {
    handlers.delete(fn);
    if (handlers.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

/** Calls `unmute` when volume up is pressed, while the component is mounted. */
export function useVolumeUpUnmute(unmute: () => void, enabled = true): void {
  const ref = useRef(unmute);
  ref.current = unmute;
  useEffect(() => {
    if (!enabled) return;
    return retain(() => ref.current());
  }, [enabled]);
}

/** Keeps the listener alive app-wide so Shorts and any player on screen hear it. */
export function useVolumeUpUnmuteRoot(): void {
  useEffect(() => retain(() => {}), []);
}
