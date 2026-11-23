import { useSyncExternalStore } from "react";
import { storage } from "./storage";

/**
 * "Hide my balance": the eye on the menu's wallet chip swaps the number for
 * dots so it isn't on show in public. Saved on this device.
 */
const KEY = "riftn.hideBalance";
const listeners = new Set<() => void>();

let hidden = storage.getBoolean(KEY) ?? false;

export function setBalanceHidden(next: boolean) {
  hidden = next;
  storage.set(KEY, next);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useBalanceHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden, () => hidden);
}

export const HIDDEN_BALANCE = "••••";
