/**
 * Shared state for the sign-in hand-off (components/auth/SignInHandoff).
 *
 * The waiting frame lives inside the sign-in screen or sheet, which is gone
 * by the time the account has landed; the arrival lives at the app root and
 * outlives it. This is the little they need to tell each other.
 */
import type { View } from 'react-native';
import { useEffect, useSyncExternalStore, type RefObject } from 'react';
import { getBadgeUrlFor } from './misc';

let waitingUntil = 0;
let waitingSince = 0;

/** The waiting frame is on screen now (called while it is mounted and as it leaves). */
export function noteSignInWaiting(): void {
  waitingUntil = Date.now();
}

/** The waiting frame inside a sheet went on screen (its spin started then). */
export function noteSignInWaitStarted(): void {
  waitingSince = Date.now();
}

/** When the sheet's waiting frame went on screen. */
export function signInWaitStartedAt(): number {
  return waitingSince;
}

/**
 * The sign-in page asks the app root to draw the wait (SignInArrival), so the
 * veil and the rift are one thing from the tap until the picture has flown
 * home: the page under them is swapped for the app midway, and a wait drawn
 * inside the page went with it.
 */
let rootWait = false;
const rootWaitListeners = new Set<() => void>();

export function setRootSignInWait(on: boolean): void {
  if (rootWait === on) return;
  rootWait = on;
  rootWaitListeners.forEach((l) => l());
}

export function rootSignInWaiting(): boolean {
  return rootWait;
}

export function subscribeRootSignInWait(listener: () => void): () => void {
  rootWaitListeners.add(listener);
  return () => { rootWaitListeners.delete(listener); };
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

type OwnAvatarTarget = { ref: RefObject<View | null>; radius: number };
const ownAvatars = new Set<OwnAvatarTarget>();

/**
 * The signed-in account's own picture on screen: the home header's, and the
 * profile page's while it is the page in front. `radius` is its corner, so the
 * flying picture lands on the same curve.
 */
export function registerOwnAvatar(ref: RefObject<View | null>, radius = 8): () => void {
  const target = { ref, radius };
  ownAvatars.add(target);
  return () => { ownAvatars.delete(target); };
}

export type OwnAvatarRect = { x: number; y: number; width: number; height: number; radius: number };

export function measureInWindowSoon(node: View | null | undefined): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    let settled = false;
    const done = (v: { x: number; y: number; width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    setTimeout(() => done(null), 250);
    try {
      node.measureInWindow((x, y, width, height) => done({ x, y, width, height }));
    } catch {
      done(null);
    }
  });
}

/**
 * Where the picture should fly: the biggest own picture on screen (the
 * profile page's beats the header's). The page under the arrival can still be
 * mounting, so it is looked for again for a moment before giving up.
 */
export async function measureOwnAvatar(screen: { width: number; height: number }, waitMs = 700): Promise<OwnAvatarRect | null> {
  const until = Date.now() + waitMs;
  for (;;) {
    const found = await Promise.all([...ownAvatars].map(async (t) => {
      const r = await measureInWindowSoon(t.ref.current);
      return r ? { ...r, radius: t.radius } : null;
    }));
    let best: OwnAvatarRect | null = null;
    for (const r of found) {
      if (!r || r.width < 16 || r.height < 16) continue;
      if (r.x + r.width < 0 || r.y + r.height < 0 || r.x > screen.width || r.y > screen.height) continue;
      if (!best || r.width * r.height > best.width * best.height) best = r;
    }
    if (best || Date.now() >= until) return best;
    await new Promise((res) => setTimeout(res, 100));
  }
}

/**
 * The page's own picture hides while the arrival's copy flies into its place,
 * and shows the moment it lands: one picture arriving, never two.
 */
let ownAvatarHidden = false;
const hiddenListeners = new Set<() => void>();

export function setOwnAvatarHidden(on: boolean): void {
  if (ownAvatarHidden === on) return;
  ownAvatarHidden = on;
  hiddenListeners.forEach((l) => l());
}

function subscribeOwnAvatarHidden(listener: () => void): () => void {
  hiddenListeners.add(listener);
  return () => { hiddenListeners.delete(listener); };
}

/** Register a picture as a landing spot while `active`; true while it should hide. */
export function useOwnAvatarTarget(ref: RefObject<View | null>, radius: number, active = true): boolean {
  useEffect(() => (active ? registerOwnAvatar(ref, radius) : undefined), [ref, radius, active]);
  const hidden = useSyncExternalStore(subscribeOwnAvatarHidden, () => ownAvatarHidden);
  return active && hidden;
}
