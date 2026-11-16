/**
 * Shared state for the sign-in hand-off (components/auth/SignInHandoff).
 *
 * The waiting frame lives inside the sign-in screen or sheet, which is gone
 * by the time the account has landed; the arrival lives at the app root and
 * outlives it. This is the little they need to tell each other.
 */
import type { View } from 'react-native';
import type { RefObject } from 'react';

let waitingUntil = 0;

/** The waiting frame is on screen now (called while it is mounted and as it leaves). */
export function noteSignInWaiting(): void {
  waitingUntil = Date.now();
}

/** True when the waiting frame was on screen within the last `ms`. */
export function signInWasWaiting(ms: number): boolean {
  return Date.now() - waitingUntil < ms;
}

let ownAvatar: RefObject<View | null> | null = null;

/** The signed-in account's own picture on screen (the home header's). */
export function registerOwnAvatar(ref: RefObject<View | null>): () => void {
  ownAvatar = ref;
  return () => { if (ownAvatar === ref) ownAvatar = null; };
}

export function measureOwnAvatar(): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const node = ownAvatar?.current;
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    let settled = false;
    const done = (v: { x: number; y: number; width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    setTimeout(() => done(null), 250);
    try {
      node.measureInWindow((x, y, width, height) => {
        done(width > 8 && height > 8 ? { x, y, width, height } : null);
      });
    } catch {
      done(null);
    }
  });
}
