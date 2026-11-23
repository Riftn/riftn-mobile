import { useEffect, useSyncExternalStore } from "react";
import { subscribe as watchState } from "valtio";
import { getStoryRings, type MomentPeek } from "../services/stories.service";
import { storiesState } from "../store/stories.store";

/**
 * Who has a Moment up, for the mark on their face in chats and on profiles
 * (same as web's hooks/use-moment-peek).
 *
 * Every face on screen asks for its own address; the asks are gathered for a
 * moment and sent as one request (up to 100 at a time). Answers are kept for a
 * minute, and dropped for the people just watched when the viewer closes, so
 * the mark turns grey at once.
 */
const FRESH_MS = 60_000;
const BATCH = 100;

type Entry = { peek: MomentPeek | null; at: number };
const cache = new Map<string, Entry>();
const wanted = new Set<string>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let viewerKey: string | null = null;

function emit() {
  listeners.forEach((l) => l());
}

async function flush() {
  timer = null;
  const all = [...wanted].filter((a) => !inflight.has(a));
  wanted.clear();
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const key = viewerKey;
    batch.forEach((a) => inflight.add(a));
    try {
      const { rings = {}, peeks = {} } = (await getStoryRings(batch, !!key)) ?? ({} as never);
      if (key !== viewerKey) continue;
      const at = Date.now();
      for (const a of batch) {
        const peek = peeks[a] ?? (rings[a] ? { state: rings[a], count: 1, cover: null } : null);
        cache.set(a, { peek, at });
      }
    } catch {
      // Try again in about 15 s rather than on every render.
      const at = Date.now() - FRESH_MS + 15_000;
      for (const a of batch) if (!cache.has(a)) cache.set(a, { peek: null, at });
    } finally {
      batch.forEach((a) => inflight.delete(a));
    }
    emit();
  }
}

function ask(address: string) {
  if (inflight.has(address)) return;
  const entry = cache.get(address);
  if (entry && Date.now() - entry.at < FRESH_MS) return;
  wanted.add(address);
  if (timer === null) timer = setTimeout(() => void flush(), 40);
}

/** Forget these people's marks (or everyone's) so the faces on screen ask again. */
export function refreshMomentPeeks(addresses?: string[]) {
  if (addresses) addresses.forEach((a) => cache.delete(a.toLowerCase()));
  else cache.clear();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Closing the viewer: the people in it may be watched now. A Moment of your
// own finishing its upload shows on your face.
let lastViewer = storiesState.viewer;
let lastPending = storiesState.pending;
watchState(storiesState, () => {
  const viewer = storiesState.viewer;
  const pending = storiesState.pending;
  if (lastViewer && !viewer) refreshMomentPeeks(lastViewer.entries.map((e) => e.author.address));
  if (lastPending && !pending) refreshMomentPeeks();
  lastViewer = viewer;
  lastPending = pending;
});

// Marks older than a minute are asked for again while their faces are on screen.
setInterval(() => {
  if (!listeners.size) return;
  const stale = Date.now() - FRESH_MS;
  let changed = false;
  cache.forEach((entry, address) => {
    if (entry.at < stale) {
      cache.delete(address);
      changed = true;
    }
  });
  if (changed) emit();
}, FRESH_MS);

/**
 * The Moment mark for this person's face, or null when they have none up.
 * `viewer` is the signed-in wallet (lowercase) or null.
 */
export function useMomentPeek(address: string | null | undefined, viewer: string | null): MomentPeek | null {
  if (viewer !== viewerKey) {
    viewerKey = viewer;
    cache.clear();
  }
  const key = address ? address.toLowerCase() : null;
  const entry = useSyncExternalStore(subscribe, () => (key ? cache.get(key) : undefined), () => undefined);
  useEffect(() => {
    if (key && key.startsWith("0x")) ask(key);
  }, [key, entry, viewer]);
  return entry?.peek ?? null;
}
