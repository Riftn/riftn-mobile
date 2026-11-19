import { useSyncExternalStore } from 'react';
/**
 * Video playback preferences — mobile counterpart of web's
 * `src/lib/video-preferences.ts`, down to the storage key and the shape of the
 * blob, so a value written by one client means the same thing on the other.
 *
 * The point of it is the per-channel rate. Set 1.5× on someone who talks
 * slowly and it stays 1.5× for them next time, while everyone else keeps
 * playing at normal speed. A speed picked on one creator's video never
 * follows the viewer onto anyone else's.
 *
 * AsyncStorage is async and a player has to pick its rate the frame it mounts,
 * so reads come from an in-memory cache that is warmed once at startup. Before
 * that warm lands the getters return the defaults, which is the same answer a
 * first-run device would give anyway.
 *
 * Device-local here. Web pushes the same map to the account preference blob
 * so its own devices agree; mobile has no display-preferences sync to ride, so
 * these rates stay on the phone until it does.
 *
 * @module libs/video-preferences
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

/** Web's localStorage key, verbatim. */
const STORAGE_KEY = "video-preferences";

export interface VideoPreferences {
  playbackRate: number;
  isLooping: boolean;
  volume: number;
  /** Lowercased creator address → the rate chosen while watching them. */
  ratesByCreator: Record<string, number>;
  /**
   * 3 once the stale per-creator speeds are cleared. Blobs before 2 carried
   * one speed everywhere; blobs before 3 still hold creator speeds pinned by
   * the old button, which pinned on every tap.
   */
  rateScope?: number;
  /**
   * 3 = loop is off unless the viewer turned it on, so a short moves on to
   * the next one when it ends. Scope 2 briefly turned loop on for everyone;
   * blobs before 3 go back to off once, and a choice after that is kept.
   * Same as web.
   */
  loopScope?: number;
}

const RATE_SCOPE = 3;
const LOOP_SCOPE = 3;

const DEFAULTS: VideoPreferences = {
  playbackRate: 1,
  // Off: a short ends and the next one plays. The loop button turns it on.
  isLooping: false,
  volume: 0.8,
  ratesByCreator: {},
  rateScope: RATE_SCOPE,
  loopScope: LOOP_SCOPE,
};

let cached: VideoPreferences = { ...DEFAULTS, ratesByCreator: {} };
const volumeListeners = new Set<() => void>();
const loopListeners = new Set<() => void>();
let pendingLoopChoice: boolean | undefined;
let warmed = false;
let warming: Promise<void> | null = null;

function normaliseCreator(creatorId?: string | null): string | null {
  const key = (creatorId ?? "").trim().toLowerCase();
  return key || null;
}

function sanitise(stored: any): VideoPreferences {
  const base = stored && typeof stored === "object" ? stored : {};
  const current = base.rateScope === RATE_SCOPE;
  return {
    ...DEFAULTS,
    ...base,
    // The old speed button pinned every tap on the creator being watched and
    // moved every other video too, so people found whole profiles (often their
    // own) stuck at 2x. Blobs written before this go back to normal speed
    // once, creator speeds included.
    playbackRate: current && base.playbackRate > 0 ? base.playbackRate : DEFAULTS.playbackRate,
    rateScope: RATE_SCOPE,
    isLooping: base.loopScope === LOOP_SCOPE ? base.isLooping === true : false,
    loopScope: LOOP_SCOPE,
    // Spreading alone would carry through a null or an array left by an older
    // blob, and every lookup after that would throw.
    ratesByCreator:
      current &&
      base.ratesByCreator &&
      !Array.isArray(base.ratesByCreator) &&
      typeof base.ratesByCreator === "object"
        ? base.ratesByCreator
        : {},
  };
}

/**
 * Load the blob into memory. Safe to call repeatedly — the first call does the
 * read and everyone after it awaits the same promise.
 */
export function warmVideoPreferences(): Promise<void> {
  if (warmed) return Promise.resolve();
  if (warming) return warming;
  warming = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (raw) {
        cached = sanitise(JSON.parse(raw));
        if (pendingLoopChoice !== undefined) {
          cached.isLooping = pendingLoopChoice;
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached)).catch(() => {});
        }
        volumeListeners.forEach(fn => fn());
        loopListeners.forEach(fn => fn());
      }
    })
    .catch(() => {
      // A blob that will not parse is not worth a crash on app open; the
      // defaults stand and the next write replaces it.
    })
    .finally(() => {
      warmed = true;
      pendingLoopChoice = undefined;
      warming = null;
    });
  return warming;
}

function save(next: VideoPreferences) {
  const changed = cached.volume !== next.volume;
  const loopChanged = cached.isLooping !== next.isLooping;
  cached = next;
  if (changed) volumeListeners.forEach(fn => fn());
  if (loopChanged) loopListeners.forEach(fn => fn());
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
}

/**
 * Set the playback rate. With the creator whose video is playing, the rate is
 * remembered for them alone and every other video keeps its own speed. With
 * no creator it becomes the general rate.
 */
export function setPlaybackRate(rate: number, creatorId?: string | null) {
  const key = normaliseCreator(creatorId);
  save(key
    ? { ...cached, ratesByCreator: { ...cached.ratesByCreator, [key]: rate } }
    : { ...cached, playbackRate: rate });
}

/** The rate to start a creator's video at — theirs if pinned, else the general one. */
export function getPlaybackRateFor(creatorId?: string | null): number {
  const key = normaliseCreator(creatorId);
  const pinned = key ? cached.ratesByCreator[key] : undefined;
  return typeof pinned === "number" && pinned > 0 ? pinned : cached.playbackRate;
}

/** How many channels have a pinned rate — drives the settings row's count. */
export function getCreatorPlaybackRateCount(): number {
  return Object.keys(cached.ratesByCreator).length;
}

/** Forget every per-channel rate. The global rate is left alone. */
export function clearCreatorPlaybackRates() {
  save({ ...cached, ratesByCreator: {} });
}

export function getIsLooping(): boolean {
  return cached.isLooping === true;
}

/** Remember replay across videos and app restarts. */
export function setIsLooping(looping: boolean) {
  if (!warmed) pendingLoopChoice = looping;
  save({ ...cached, isLooping: looping });
}

const subscribeLoop = (fn: () => void) => { loopListeners.add(fn); return () => loopListeners.delete(fn); };
export const useMediaLooping = () => useSyncExternalStore(subscribeLoop, getIsLooping, () => false);

/** The level a video starts at, 0 → 1. Shared with web through the blob. */
export function getVolume(): number {
  const v = cached.volume;
  return typeof v === "number" && v >= 0 && v <= 1 ? v : DEFAULTS.volume;
}

/** Remember a level the viewer set by holding the speaker and dragging. */
export function setVolume(volume: number) {
  save({ ...cached, volume: Math.max(0, Math.min(1, volume)) });
}

/** The whole map, for a data export to carry. */
export function getCreatorPlaybackRates(): Record<string, number> {
  return { ...cached.ratesByCreator };
}

/**
 * Replace the map wholesale — what an import applies. Rates are validated on
 * the way in: a file is a text file, and a zero or a string here would leave
 * every video on that channel unplayable until the setting was reset.
 */
export function setCreatorPlaybackRates(rates: Record<string, number>) {
  const clean: Record<string, number> = {};
  for (const [creator, rate] of Object.entries(rates ?? {})) {
    const key = normaliseCreator(creator);
    if (key && typeof rate === "number" && rate > 0) clean[key] = rate;
  }
  save({ ...cached, ratesByCreator: clean });
}

const subscribeVolume = (fn: () => void) => { volumeListeners.add(fn); return () => volumeListeners.delete(fn); };
export const useMediaVolume = () => useSyncExternalStore(subscribeVolume, getVolume, () => DEFAULTS.volume);
