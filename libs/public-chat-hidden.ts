/**
 * Public Chat "Delete for me"
 * ===========================
 * Lines you removed from your own view of Public Chat. Everyone else still
 * sees them. Kept on this device per account (newest 500).
 *
 * "Delete for everyone" (your own line, or any line if you moderate the room)
 * goes over the socket and takes it down for the whole room.
 *
 * Same key names as web's src/lib/public-chat-hidden.ts.
 *
 * @module libs/public-chat-hidden
 */
import { useCallback, useSyncExternalStore } from "react";

import { storage } from "./storage";

const KEY_PREFIX = "riftn.publicChat.hidden.";
const MAX = 500;
const EMPTY: ReadonlySet<string> = new Set();

const cache = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

const keyFor = (account: string) => KEY_PREFIX + account.toLowerCase();

export function readHiddenLines(account: string | null | undefined): ReadonlySet<string> {
  if (!account) return EMPTY;
  const key = keyFor(account);
  const hit = cache.get(key);
  if (hit) return hit;
  let ids: string[] = [];
  try {
    const raw = storage.getString(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    /* a bad value: nothing hidden */
  }
  const set = new Set(ids);
  cache.set(key, set);
  return set;
}

export function hideLineForMe(account: string | null | undefined, messageId: string): void {
  if (!account || !messageId) return;
  const key = keyFor(account);
  const next = [...readHiddenLines(account)].filter((id) => id !== messageId);
  next.push(messageId);
  const kept = next.slice(-MAX);
  cache.set(key, new Set(kept));
  try {
    storage.set(key, JSON.stringify(kept));
  } catch {
    /* still hidden until the app closes */
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The lines this account hid, live. */
export function useHiddenLines(account: string | null | undefined): ReadonlySet<string> {
  const read = useCallback(() => readHiddenLines(account), [account]);
  return useSyncExternalStore(subscribe, read, read);
}
