import { useSyncExternalStore } from "react";
import { storage } from "./storage";

/**
 * "Blur Moment previews": other people's Moment tiles on Home stay blurred
 * until you open them (Requests e7dde08b / ce574e81). Off by default. Saved
 * on this device.
 */
const KEY = "riftn.blurMomentPreviews";
const listeners = new Set<() => void>();

let blurred = storage.getBoolean(KEY) ?? false;

export function setMomentPreviewsBlurred(next: boolean) {
  blurred = next;
  storage.set(KEY, next);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useMomentPreviewsBlurred(): boolean {
  return useSyncExternalStore(subscribe, () => blurred, () => blurred);
}
