/**
 * How the Riftn logo and headline look on the sign-in screen: Tube TV (the
 * default), VHS tape, LED wall, Hologram, Neon glow, 3D or Flat. A per-device choice in Settings →
 * Appearance, same key and values as web's `src/lib/login-look.ts`. MMKV
 * because the sign-in screen reads it while it renders, with a durable copy
 * so the choice survives signing out and app updates.
 */
import { useSyncExternalStore } from 'react';
import { storage } from './storage';
import { mirrorDurable, restoreDurable } from './durable-setting';

export const LOGIN_LOOKS = ['tube', 'vhs', 'led', 'holo', 'neon', '3d', 'flat'] as const;
export type LoginLook = (typeof LOGIN_LOOKS)[number];
export const DEFAULT_LOGIN_LOOK: LoginLook = 'tube';

const KEY = 'riftn.login.look';
const listeners = new Set<() => void>();

export function isLoginLook(value: unknown): value is LoginLook {
  return typeof value === 'string' && (LOGIN_LOOKS as readonly string[]).includes(value);
}

export function getLoginLook(): LoginLook {
  try {
    const saved = storage.getString(KEY);
    return isLoginLook(saved) ? saved : DEFAULT_LOGIN_LOOK;
  } catch {
    return DEFAULT_LOGIN_LOOK;
  }
}

export function setLoginLook(look: LoginLook): void {
  try {
    storage.set(KEY, look);
  } catch {
    // Storage unavailable; the choice just won't stick.
  }
  mirrorDurable(KEY, look);
  listeners.forEach((listener) => listener());
}

export const loginLookRestored = restoreDurable(KEY, 'string', () =>
  listeners.forEach((listener) => listener()),
);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLoginLook(): LoginLook {
  return useSyncExternalStore(subscribe, getLoginLook, () => DEFAULT_LOGIN_LOOK);
}
