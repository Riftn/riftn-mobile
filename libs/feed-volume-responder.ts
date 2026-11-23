import { useRef } from "react";
import { PanResponder, type PanResponderCallbacks, type PanResponderInstance } from "react-native";

/** How long a finger has to sit on the speaker before a drag means volume. */
export const VOLUME_HOLD_MS = 220;
/** Vertical travel, in points, that covers the whole 0 → 1 range. */
export const VOLUME_TRAVEL_PX = 140;
/** Movement under this is a tap, not a drag. */
const SLOP = 6;

export interface FeedVolumeResponderOptions {
  /** Called when the hold lands. Return the volume to drag from. */
  onHoldStart: () => number;
  /** A new level, already clamped to 0 → 1. */
  onVolume: (volume: number) => void;
  /** A press that never became a hold or a drag: the old mute toggle. */
  onTap: () => void;
  /** Finger lifted or the gesture was taken away. */
  onEnd: () => void;
  /** Open a mixer only after the held finger lifts, never on cancellation. */
  onHoldRelease?: () => void;
}

/**
 * Press-and-hold the speaker, then drag: up is louder, down is quieter.
 *
 * The phone's volume keys move the whole device, which is not what someone
 * wants when one video is loud and everything else is fine. This is the video's
 * own level, and it has to share the button with the mute toggle and share the
 * vertical axis with the feed's own scrolling — hence the hold. Until it lands,
 * the gesture is given up on request, so a flick that happens to start on the
 * speaker still scrolls the feed instead of silently changing the volume.
 */
export function feedVolumeResponder(opts: FeedVolumeResponderOptions): PanResponderCallbacks {
  let holding = false;
  let moved = false;
  let startVolume = 1;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const finish = () => {
    clearTimer();
    if (holding) {
      holding = false;
      opts.onEnd();
    }
  };

  return {
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => holding,
    onPanResponderGrant: () => {
      holding = false;
      moved = false;
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        // A finger that already travelled is scrolling the feed, not holding.
        if (moved) return;
        holding = true;
        startVolume = opts.onHoldStart();
      }, VOLUME_HOLD_MS);
    },
    onPanResponderMove: (_event, gesture) => {
      if (Math.hypot(gesture.dx, gesture.dy) > SLOP) moved = true;
      if (!holding) {
        if (moved) clearTimer();
        return;
      }
      // dy grows downward, and down is quieter.
      const next = startVolume - gesture.dy / VOLUME_TRAVEL_PX;
      opts.onVolume(Math.max(0, Math.min(1, next)));
    },
    // Only once the hold has landed is this gesture worth taking off the feed.
    onPanResponderTerminationRequest: () => !holding,
    onShouldBlockNativeResponder: () => holding,
    onPanResponderRelease: (_event, gesture) => {
      const wasHolding = holding;
      finish();
      if (wasHolding) opts.onHoldRelease?.();
      if (!wasHolding && Math.hypot(gesture.dx, gesture.dy) <= SLOP) opts.onTap();
    },
    onPanResponderTerminate: finish,
  };
}

/**
 * One responder for the life of the button. Hitting the bottom mutes and
 * leaving it unmutes, which changes the callers' callbacks; rebuilding the
 * responder then would swap in a fresh one mid-drag that has not seen the
 * hold, so the drag froze at either end. The latest callbacks are read
 * through a ref instead.
 */
export function useFeedVolumeResponder(opts: FeedVolumeResponderOptions): PanResponderInstance {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const responderRef = useRef<PanResponderInstance | null>(null);
  if (!responderRef.current) {
    responderRef.current = PanResponder.create(
      feedVolumeResponder({
        onHoldStart: () => optsRef.current.onHoldStart(),
        onVolume: (v) => optsRef.current.onVolume(v),
        onTap: () => optsRef.current.onTap(),
        onEnd: () => optsRef.current.onEnd(),
        onHoldRelease: () => optsRef.current.onHoldRelease?.(),
      }),
    );
  }
  return responderRef.current;
}
