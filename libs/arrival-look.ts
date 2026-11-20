/**
 * What plays between logging in and the logged-in app
 * (components/auth/SignInHandoff): Trace, Tune in, the Rift (the default),
 * Deck or Glass drop. A per-device choice in Settings → Appearance, same key and
 * values as web's `src/lib/arrival-look.ts`. MMKV with a durable copy, so the
 * choice survives signing out (which is when it plays next).
 */
import { useSyncExternalStore } from 'react';
import { storage } from './storage';
import { mirrorDurable, restoreDurable } from './durable-setting';
import { HAS_SKIA } from './skia';

export const ARRIVAL_LOOKS = ['trace', 'tune', 'rift', 'deck', 'glass'] as const;
export type ArrivalLook = (typeof ARRIVAL_LOOKS)[number];
export const DEFAULT_ARRIVAL_LOOK: ArrivalLook = 'rift';

/** Trace, Tune in, Deck and Glass drop: drawn with Skia (components/auth/ArrivalConcepts). */
export const CONCEPT_LOOKS = ['trace', 'tune', 'deck', 'glass'] as const;
export type ConceptLook = (typeof CONCEPT_LOOKS)[number];

/** From the account landing until the picture stands still. */
export const CONCEPT_REVEAL_MS: Record<ConceptLook, number> = { trace: 700, tune: 900, deck: 640, glass: 830 };
/** When the name comes in under the picture, after the account landed. */
export const CONCEPT_NAME_MS: Record<ConceptLook, number> = { trace: 650, tune: 600, deck: 600, glass: 600 };
/** From the account landing until the picture flies home. */
export const CONCEPT_HOLD_MS = 1300;

export function isConceptLook(look: string): look is ConceptLook {
  return (CONCEPT_LOOKS as readonly string[]).includes(look);
}

/**
 * The looks this install can play. Older binaries have no Skia, so they only
 * offer the Rift, and a pick made elsewhere plays as the Rift there.
 */
export const AVAILABLE_ARRIVAL_LOOKS: readonly ArrivalLook[] = HAS_SKIA
  ? ARRIVAL_LOOKS
  : ARRIVAL_LOOKS.filter((look) => !isConceptLook(look));

/** How long each one's intro plays before it may open on the picture. */
export const ARRIVAL_INTRO_MS: Record<ArrivalLook, number> = {
  trace: 300,
  tune: 280,
  rift: 1100,
  deck: 600,
  glass: 450,
};

const KEY = 'riftn.signin.arrival';
const listeners = new Set<() => void>();

export function isArrivalLook(value: unknown): value is ArrivalLook {
  return typeof value === 'string' && (ARRIVAL_LOOKS as readonly string[]).includes(value);
}

export function getArrivalLook(): ArrivalLook {
  try {
    const saved = storage.getString(KEY);
    return isArrivalLook(saved) && AVAILABLE_ARRIVAL_LOOKS.includes(saved) ? saved : DEFAULT_ARRIVAL_LOOK;
  } catch {
    return DEFAULT_ARRIVAL_LOOK;
  }
}

export function setArrivalLook(look: ArrivalLook): void {
  try {
    storage.set(KEY, look);
  } catch {
    // Storage unavailable; the choice just won't stick.
  }
  mirrorDurable(KEY, look);
  listeners.forEach((listener) => listener());
}

export const arrivalLookRestored = restoreDurable(KEY, 'string', () =>
  listeners.forEach((listener) => listener()),
);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useArrivalLook(): ArrivalLook {
  return useSyncExternalStore(subscribe, getArrivalLook, () => DEFAULT_ARRIVAL_LOOK);
}
