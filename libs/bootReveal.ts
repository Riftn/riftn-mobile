/**
 * Flips to true the moment the boot preloader starts to lift (App.tsx →
 * beginReveal).
 *
 * Surfaces that mount underneath the preloader read this to suppress their
 * one-shot entrance choreography: played while covered, it finishes unseen
 * and the user catches only its tail end as movement right on top of the
 * reveal — exactly what the covered mount exists to prevent. Remounts later
 * in the session (auth stack replace, sign-out/in) happen after the flag is
 * set and keep their entrance.
 */
import { useSyncExternalStore } from "react";
import { settleMinimalLaunch } from "./minimalBootGuard";

export let bootRevealed = false;

export function markBootRevealed(): void {
  bootRevealed = true;
  // The app made it on screen, so this launch's theme is known good.
  settleMinimalLaunch();
}

/**
 * True once the launch cover's lift animation is running on the native side
 * (or the cover is gone). Until then JavaScript still has to measure the dock
 * target and start that animation, so work nobody can see yet (the feed's
 * off-screen rows) waits for this instead of holding the logo up.
 */
let launchMotionStarted = false;
const motionListeners = new Set<() => void>();

export function markLaunchMotionStarted(): void {
  if (launchMotionStarted) return;
  launchMotionStarted = true;
  motionListeners.forEach(listener => listener());
}

const subscribeMotion = (listener: () => void) => {
  motionListeners.add(listener);
  return () => { motionListeners.delete(listener); };
};
const readMotion = () => launchMotionStarted;

export function useLaunchMotionStarted(): boolean {
  return useSyncExternalStore(subscribeMotion, readMotion, readMotion);
}

export function __resetLaunchMotionForTests(): void {
  launchMotionStarted = false;
  motionListeners.clear();
}
