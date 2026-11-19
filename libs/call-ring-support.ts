import * as Application from 'expo-application';

/**
 * First store build that bundles assets/sounds/call_ring.wav (via the
 * expo-notifications `sounds` list in app.json). Only those builds can play
 * it from a push while the app is closed; older ones keep the default sound.
 */
export const CALL_RINGTONE_MIN_VERSION = '1.20.0';

/** The notification sound name the backend sends for calls. */
export const CALL_RING_SOUND = 'call_ring.wav';

/** Android channel that plays the ringtone for incoming calls. */
export const CALL_RING_CHANNEL = 'calls_ring';

function parts(version: string): number[] {
  return version.split('.').map((part) => parseInt(part, 10) || 0);
}

export function versionAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version) return false;
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}

/** True when the installed binary carries the call ringtone file. */
export function nativeCarriesCallRingtone(
  version: string | null | undefined = Application.nativeApplicationVersion,
): boolean {
  return versionAtLeast(version, CALL_RINGTONE_MIN_VERSION);
}
