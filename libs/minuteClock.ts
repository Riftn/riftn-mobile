/**
 * One shared clock for "5m" / "3h" style labels.
 *
 * A label worked out once when its card mounted stayed exactly as it was for as
 * long as the card did. A phone that left the app open overnight came back to a
 * feed whose top post still said "40m" fifteen hours later. Labels read this
 * clock instead: it moves once a minute while the app is on screen, and at once
 * when the app comes back to the front.
 */
import { useSyncExternalStore } from "react";
import { AppState, type AppStateStatus } from "react-native";

const TICK_MS = 60_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
let appSub: { remove(): void } | null = null;

function tick(): void {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

function startTimer(): void {
  if (!timer) timer = setInterval(tick, TICK_MS);
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function start(): void {
  // Nobody was listening, so `now` may be from long ago.
  now = Date.now();
  if (AppState.currentState !== "background") startTimer();
  if (appSub) return;
  appSub = AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") {
      tick();
      startTimer();
    } else if (status === "background") {
      stopTimer();
    }
  });
}

function stop(): void {
  stopTimer();
  appSub?.remove();
  appSub = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stop();
  };
}

/**
 * `format(now)` kept current. Returns a string, so a component only re-renders
 * when the text it shows actually changes, not on every tick.
 */
export function useClockLabel(format: (nowMs: number) => string): string {
  return useSyncExternalStore(subscribe, () => format(now), () => format(now));
}
