import { useSyncExternalStore } from "react";

/**
 * Posts marked "Not interested" on this phone since the app opened. Their
 * cards drop out at once; the server keeps them out of later feed pages.
 */
const dismissed = new Set<string>();
const listeners = new Set<() => void>();

export function markNotInterested(tokenId: number | string, on = true): void {
  const key = String(tokenId);
  if (on) dismissed.add(key); else dismissed.delete(key);
  listeners.forEach((l) => l());
}

export function isNotInterested(tokenId: number | string | null | undefined): boolean {
  return tokenId != null && dismissed.has(String(tokenId));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useIsNotInterested(tokenId: number | string | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => isNotInterested(tokenId), () => false);
}
