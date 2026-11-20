/**
 * Shared state for the sign-in hand-off (components/auth/SignInHandoff).
 *
 * The waiting frame lives inside the sign-in screen or sheet, which is gone
 * by the time the account has landed; the arrival lives at the app root and
 * outlives it. This is the little they need to tell each other.
 */
import type { View } from 'react-native';
import type { RefObject } from 'react';
import { getBadgeUrlFor } from './misc';

let waitingUntil = 0;

/** The waiting frame is on screen now (called while it is mounted and as it leaves). */
export function noteSignInWaiting(): void {
  waitingUntil = Date.now();
}

let arrivalUntil = 0;

/** The arrival is about to play for about `ms` (SignInArrival). */
export function noteArrivalPlaying(ms: number): void {
  arrivalUntil = Date.now() + ms;
}

/**
 * True while a log-in arrival is on screen. The app mounts under it after a
 * log-in from the sign-in page, and the bottom bar must already be settled
 * there: its slide-up under the flying picture read as the bar flashing.
 */
export function arrivalPlaying(): boolean {
  return Date.now() < arrivalUntil;
}

/** True when the waiting frame was on screen within the last `ms`. */
export function signInWasWaiting(ms: number): boolean {
  return Date.now() - waitingUntil < ms;
}

/**
 * The account a log-in just produced, straight from the log-in response, so
 * the arrival can show its picture without waiting for the profile refetch
 * that follows. Only log-ins note one: a new account picking its username is
 * a sign-up, and gets no arrival.
 */
export type ArrivingAccount = {
  avatarImageUrl: string | null;
  name: string;
  /** The staking badge drawn after the name, as on the profile (an image asset). */
  badge?: number;
  at: number;
};
let arriving: ArrivingAccount | null = null;
const arrivingListeners = new Set<() => void>();

export function noteSignInAccount(user: ({ avatarImageUrl?: string | null; displayName?: string | null; username?: string | null } & Record<string, any>) | null | undefined): void {
  if (!user) return;
  arriving = {
    avatarImageUrl: user.avatarImageUrl || null,
    name: user.displayName || user.username || '',
    badge: user.hideBadgeAndBalance ? undefined : getBadgeUrlFor(user),
    at: Date.now(),
  };
  arrivingListeners.forEach((l) => l());
}

/** The noted account if it is younger than `ms`; taking it clears it. */
export function takeArrivingAccount(ms: number): ArrivingAccount | null {
  const a = arriving;
  arriving = null;
  return a && Date.now() - a.at < ms ? a : null;
}

export function peekArrivingAccount(ms: number): ArrivingAccount | null {
  return arriving && Date.now() - arriving.at < ms ? arriving : null;
}

export function subscribeArrivingAccount(listener: () => void): () => void {
  arrivingListeners.add(listener);
  return () => { arrivingListeners.delete(listener); };
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
