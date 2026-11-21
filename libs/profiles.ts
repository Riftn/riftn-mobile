/**
 * Profiles on this device.
 * ========================
 * Mobile port of dehubweb's src/lib/profiles.ts. One install can hold several
 * Riftn accounts. The registry lives in AsyncStorage (`@dehub_profiles_v1`) and
 * keeps each account's public identity plus a snapshot of the session keys it
 * had the last time it was active, so switching back is silent instead of a
 * fresh login.
 *
 * The snapshot has to be taken while a session is still the LIVE one — the
 * backend rotates refresh tokens on use, so a stash written at login time holds
 * a refresh token the next background refresh will invalidate (and reuse of a
 * rotated token revokes the whole family server-side). Listeners re-snapshot on
 * every successful token refresh, which keeps the stored copy perpetually fresh
 * and means the value left behind when an account goes inactive was never
 * handed to a rotation since.
 *
 * Private keys are NOT part of a snapshot: local wallet keys already live
 * per-address in SecureStore (@/libs/wallets.local), and switching locks the
 * signing provider away so each profile starts sealed and unlocks on demand.
 */
import { clearFallbackKeys, resilientAsyncStorage } from "./storage-full";
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  AUTH_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  TOKEN_EXPIRES_AT_KEY,
  AUTH_METHOD_KEY,
  AUTH_METHOD_ADDR_KEY,
  SUPABASE_UID_KEY,
} from './auth.utils';
import { clearAllEngagement } from './engagementCache';
import { clearLinkCopyFloors } from './link-copy-floors';
import { clearUnlockedTokens } from './unlocked-tokens';
import { clearBlockedAuthors } from './blocked-authors';
import { queryClient } from '../config/queryClient';
import { translateCopy as _translateCopy } from '../i18n/copy';
import {
  getProfileAllowance,
  MAX_PROFILES_CEILING,
  type ProfileAllowance,
} from './profileLimits';

export const PROFILES_STORAGE_KEY = '@dehub_profiles_v1';
export const PROFILES_CHANGED_EVENT = 'dehub:profiles-changed';

/**
 * Thrown instead of quietly making room. The caller decides how to say it —
 * the allowance carries the tier that would lift the limit, so the message can
 * name it rather than stating a bare number.
 */
export class ProfileLimitReachedError extends Error {
  readonly allowance: ProfileAllowance;

  constructor(allowance: ProfileAllowance) {
    super(_translateCopy('copy.2c3583161a5f', { defaultValue: 'You can keep {{value1}} profiles on this device', value1: allowance.maxProfiles }));
    this.name = 'ProfileLimitReachedError';
    this.allowance = allowance;
  }
}

/** Everything a session owns in SecureStore. Stashed and restored as a set. */
const SESSION_KEYS = [
  AUTH_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  TOKEN_EXPIRES_AT_KEY,
  'auth_user',
  AUTH_METHOD_KEY,
  AUTH_METHOD_ADDR_KEY,
  SUPABASE_UID_KEY,
] as const;

/** True mid-switch so tracking never snapshots half-written keys. */
let switchGuarded = false;

export interface StoredProfileSession {
  /** The live values of SESSION_KEYS at snapshot time (missing keys omitted). */
  tokens: Record<string, string>;
  /** supabase-js session at snapshot time, when one exists. */
  supabase?: { storageKey: string; access_token: string; refresh_token: string };
}

export interface StoredProfile {
  /** Supabase uid when known, else `addr:<address>` for wallet-only accounts. */
  id: string;
  uid: string | null;
  address: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  addedAt: number;
  lastActiveAt: number;
  /**
   * Staking balance at the last save, so the device's allowance can be priced
   * without a network call. Null when it has never been seen — that profile
   * simply contributes no tier, exactly as web treats a missing balance.
   */
  badgeBalance: number | string | null;
  badgeLock?: { tier: string; requirement: number } | null;
  hideBadgeAndBalance?: boolean;
  /** Null once the session is gone — switching to it asks for sign-in again. */
  session: StoredProfileSession | null;
}

interface CachedUser {
  id?: string | number;
  _id?: string;
  displayName?: string;
  username?: string;
  avatarImageUrl?: string;
  address?: string;
  /** Staking balance, kept so the device allowance can be priced offline. */
  badgeBalance?: number | string | null;
  badgeLock?: StoredProfile['badgeLock'];
  hideBadgeAndBalance?: boolean;
}

function profileName(value: unknown, user: CachedUser | null): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  if (!label || /^0x[\da-f]{6,}$/i.test(label) || label === String(user?.id ?? user?._id ?? '')) return null;
  return label;
}

function emitChanged() {
  try {
    // React Native has no DOM events; listeners subscribe via subscribeProfilesChanged().
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {}
    });
  } catch {}
}

type ProfilesListener = () => void;
const listeners: ProfilesListener[] = [];

export function subscribeProfilesChanged(fn: ProfilesListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/**
 * Saved sessions hold the same tokens the live session keeps in SecureStore,
 * so they are kept there too. The registry in AsyncStorage only lists which
 * fields a profile has sealed; each value is its own SecureStore item.
 */
interface SealedSession {
  sealed: string[];
  supabaseKey?: string;
}

const sealedKey = (id: string, field: string) =>
  `ps_${id.replace(/[^A-Za-z0-9._-]/g, '_')}_${field.replace(/[^A-Za-z0-9._-]/g, '_')}`;

function isSealed(session: unknown): session is SealedSession {
  return !!session && Array.isArray((session as SealedSession).sealed);
}

async function sealedFields(profile: { id: string; session: unknown }): Promise<string[]> {
  if (!isSealed(profile.session)) return [];
  const fields = [...profile.session.sealed];
  if (profile.session.supabaseKey) fields.push('sb_access', 'sb_refresh');
  return fields.map((f) => sealedKey(profile.id, f));
}

async function unseal(raw: any): Promise<StoredProfile> {
  if (!isSealed(raw?.session)) return raw as StoredProfile;
  const sealed = raw.session as SealedSession;
  const tokens: Record<string, string> = {};
  for (const field of sealed.sealed) {
    const value = await SecureStore.getItemAsync(sealedKey(raw.id, field)).catch(() => null);
    if (value !== null) tokens[field] = value;
  }
  let supabase: StoredProfileSession['supabase'];
  if (sealed.supabaseKey) {
    const access = await SecureStore.getItemAsync(sealedKey(raw.id, 'sb_access')).catch(() => null);
    const refresh = await SecureStore.getItemAsync(sealedKey(raw.id, 'sb_refresh')).catch(() => null);
    if (access && refresh) supabase = { storageKey: sealed.supabaseKey, access_token: access, refresh_token: refresh };
  }
  const session = Object.keys(tokens).length || supabase ? { tokens, ...(supabase ? { supabase } : {}) } : null;
  return { ...raw, session } as StoredProfile;
}

async function readRaw(): Promise<any[]> {
  try {
    const raw = await AsyncStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readStore(): Promise<StoredProfile[]> {
  const raw = await readRaw();
  const profiles = await Promise.all(raw.map(unseal));
  // A registry written before sessions were sealed still carries them inline.
  if (raw.some((p) => p?.session && !isSealed(p.session))) await persist(profiles);
  return profiles;
}

/** Writes the registry, sealing every session into SecureStore. */
async function persist(profiles: StoredProfile[]): Promise<void> {
  const before = await readRaw();
  const registry: any[] = [];
  const keep = new Set<string>();
  for (const profile of profiles) {
    const session = profile.session;
    if (!session) {
      registry.push({ ...profile, session: null });
      continue;
    }
    const sealed: SealedSession = { sealed: Object.keys(session.tokens || {}) };
    for (const [field, value] of Object.entries(session.tokens || {})) {
      const key = sealedKey(profile.id, field);
      await SecureStore.setItemAsync(key, value);
      keep.add(key);
    }
    if (session.supabase) {
      sealed.supabaseKey = session.supabase.storageKey;
      await SecureStore.setItemAsync(sealedKey(profile.id, 'sb_access'), session.supabase.access_token);
      await SecureStore.setItemAsync(sealedKey(profile.id, 'sb_refresh'), session.supabase.refresh_token);
      keep.add(sealedKey(profile.id, 'sb_access'));
      keep.add(sealedKey(profile.id, 'sb_refresh'));
    }
    registry.push({ ...profile, session: sealed });
  }
  await AsyncStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(registry));
  for (const old of before) {
    for (const key of await sealedFields(old)) {
      if (!keep.has(key)) await SecureStore.deleteItemAsync(key).catch(() => undefined);
    }
  }
}

async function writeStore(profiles: StoredProfile[]): Promise<void> {
  try {
    await persist(profiles);
  } catch {}
  emitChanged();
}

/** Who the live session keys belong to right now, or null signed-out. */
export async function currentIdentity(): Promise<{
  id: string;
  uid: string | null;
  address: string;
} | null> {
  try {
    let address = await SecureStore.getItemAsync(AUTH_METHOD_ADDR_KEY);
    if (!address) {
      const rawUser = await SecureStore.getItemAsync('auth_user');
      if (rawUser) {
        try {
          address = (JSON.parse(rawUser) as CachedUser).address ?? null;
        } catch {}
      }
    }
    if (!address) return null;
    const uid = await SecureStore.getItemAsync(SUPABASE_UID_KEY);
    return { id: uid ?? `addr:${address.toLowerCase()}`, uid, address };
  } catch {
    return null;
  }
}

export async function currentProfileId(): Promise<string | null> {
  return (await currentIdentity())?.id ?? null;
}

export async function listProfiles(): Promise<StoredProfile[]> {
  return withoutStaleDuplicates(await readStore()).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export async function getProfile(id: string): Promise<StoredProfile | null> {
  return (await readStore()).find((p) => p.id === id) ?? null;
}

export async function removeProfile(id: string): Promise<void> {
  await writeStore((await readStore()).filter((p) => p.id !== id));
}

/**
 * Drop saved rows for an address this device no longer signs in as. A wallet
 * reset moves the Riftn profile to a new smart account, and the old address's
 * row would otherwise sit beside the new one as a second copy of the same
 * person.
 */
export async function removeProfilesForAddress(address: string, keepId?: string | null): Promise<void> {
  const target = address.toLowerCase();
  const profiles = await readStore();
  const kept = profiles.filter((p) => p.id === keepId || p.address.toLowerCase() !== target);
  if (kept.length !== profiles.length) await writeStore(kept);
}

/**
 * One row per Riftn account. Usernames are unique, so two rows sharing one are
 * the same person under an old and a new address (a wallet reset before
 * removeProfilesForAddress existed). The most recently added row is the
 * address the account lives on now.
 */
function withoutStaleDuplicates(profiles: StoredProfile[]): StoredProfile[] {
  const newest = new Map<string, StoredProfile>();
  for (const p of profiles) {
    const key = p.username?.toLowerCase();
    if (!key) continue;
    const seen = newest.get(key);
    if (!seen || p.addedAt > seen.addedAt) newest.set(key, p);
  }
  return profiles.filter((p) => {
    const key = p.username?.toLowerCase();
    return !key || newest.get(key) === p;
  });
}

/** The Supabase client persists its session under one of these keys. */
const SB_KEY_PATTERN = /^sb-.+-auth-token$/;

async function readSupabaseSession(): Promise<StoredProfileSession['supabase']> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    for (const key of keys) {
      if (!SB_KEY_PATTERN.test(key)) continue;
      const raw = await AsyncStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (parsed?.access_token && parsed?.refresh_token) {
        return {
          storageKey: key,
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token,
        };
      }
    }
  } catch {}
  return undefined;
}

/**
 * Snapshot whatever account the live localStorage keys belong to.
 *
 * `adopt` false (tracking): refreshes an EXISTING registry entry only — a
 * one-off login that never went through "Add profile" never joins the list.
 * `adopt` true: creates the entry if missing — reserved for the Add profile
 * flow and explicit switches, where the user said they want this account here.
 *
 * No-op signed out, or while a profile switch has keys in flight.
 */
async function snapshotSession(adopt: boolean): Promise<void> {
  if (switchGuarded) return;
  const identity = await currentIdentity();
  const token = await SecureStore.getItemAsync(AUTH_TOKEN_KEY);
  // A half-established flow (cleared wallet, no token yet) is not a profile.
  if (!identity || !token) return;

  let profiles = await readStore();
  let existingIndex = profiles.findIndex((p) => p.id === identity.id);
  if (!adopt && existingIndex < 0) return;

  let user: CachedUser | null = null;
  const tokens: Record<string, string> = {};
  try {
    const rawUser = await SecureStore.getItemAsync('auth_user');
    if (rawUser) user = JSON.parse(rawUser) as CachedUser;
    for (const key of SESSION_KEYS) {
      const value = await SecureStore.getItemAsync(key);
      if (value !== null) tokens[key] = value;
    }
  } catch {}

  // A switch can start while this was reading (a token refresh fires a
  // snapshot, then the switch writes the next account's keys). Filing what was
  // read here under the outgoing account would hand it the incoming one's
  // tokens, so drop the snapshot if a switch began or the live account moved.
  if (switchGuarded) return;
  const stillLive = await currentIdentity();
  if (!stillLive || stillLive.id !== identity.id) return;

  const now = Date.now();
  const existing = existingIndex >= 0 ? profiles[existingIndex] : null;

  const entry: StoredProfile = {
    id: identity.id,
    uid: identity.uid,
    address: identity.address,
    name: profileName(user?.displayName, user) ?? profileName(existing?.name, user),
    username: profileName(user?.username, user) ?? profileName(existing?.username, user),
    avatarUrl: user?.avatarImageUrl ?? existing?.avatarUrl ?? null,
    addedAt: existing?.addedAt ?? now,
    lastActiveAt: now,
    badgeBalance: user?.badgeBalance ?? existing?.badgeBalance ?? null,
    badgeLock: user?.badgeLock,
    hideBadgeAndBalance: user?.hideBadgeAndBalance ?? existing?.hideBadgeAndBalance,
    session: {
      tokens,
      supabase: await readSupabaseSession(),
    },
  };

  // The live session is the account's current address; any other row under
  // the same username is the address it was rotated away from.
  const username = entry.username?.toLowerCase();
  if (username) {
    profiles = profiles.filter((p) => p.id === entry.id || p.username?.toLowerCase() !== username);
    existingIndex = profiles.findIndex((p) => p.id === entry.id);
  }

  if (existingIndex >= 0) {
    // Already saved — updating a profile in place can never exceed the limit.
    profiles[existingIndex] = entry;
    await writeStore(profiles);
    return;
  }

  // A NEW profile is refused at the limit rather than making room for itself.
  //
  // This used to evict the least-recently-active saved profile, silently, with
  // no prompt — so signing into a ninth account deleted an eighth one off the
  // device, taking its stored session with it. On an app where a lost wallet is
  // a lost ACCOUNT, that is not a cache eviction. Web made the same list
  // tier-priced and explicitly dropped the eviction; this is the app half.
  //
  // The allowance comes from the best tier already on the device, so switching
  // to a fresh alt cannot lower the limit below the number already saved.
  const allowance = getProfileAllowance([
    ...profiles.map((p) => ({ badgeBalance: p.badgeBalance, username: p.username })),
    { badgeBalance: entry.badgeBalance, username: entry.username },
  ]);

  if (profiles.length >= Math.min(allowance.maxProfiles, MAX_PROFILES_CEILING)) {
    throw new ProfileLimitReachedError(allowance);
  }

  profiles.push(entry);
  await writeStore(profiles);
}

/** Refresh the live account's registry copy, creating nothing. */
export function snapshotCurrentSession(): Promise<void> {
  return snapshotSession(false);
}

/** Record the live account as an explicitly added profile. */
export function adoptCurrentProfile(): Promise<void> {
  return snapshotSession(true);
}

/**
 * Save whatever account is live right now, because a login is about to take
 * the session keys away from it.
 *
 * The same write as `adoptCurrentProfile`, separated because the reason
 * differs and the reason is the argument for it: an explicit Add profile tap
 * adopts up front, but every OTHER way a session gets displaced — signing in
 * as somebody else from the ordinary sheet, connecting a second wallet, which
 * on this app signs you in AS that wallet — used to tear the outgoing account
 * down with nothing left behind. That account was never signed out
 * server-side; the phone had simply forgotten how to get back to it, which is
 * what "logging into a second account logs me out of the first" actually was.
 *
 * Never throws. `ProfileLimitReachedError` is a real answer for an Add profile
 * tap, which can still be stopped; here the displacement is already happening
 * and refusing to record it would only make the loss quieter.
 */
export async function preserveOutgoingProfile(): Promise<boolean> {
  try {
    await snapshotSession(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge refreshed session tokens into a profile's stored stash without
 * touching the live keys. Written for the moment a background refresh for one
 * account lands after another account took over the live keys: the rotated
 * pair is still valid, and filing it here is what keeps that profile's chain
 * alive — a stash left holding a refresh token the server already rotated gets
 * its whole family revoked on reuse.
 */
export async function mergeTokensIntoStoredProfile(
  owner: { address: string; uid: string | null },
  tokens: Record<string, string>,
): Promise<void> {
  const id = owner.uid ?? `addr:${owner.address.toLowerCase()}`;
  const profiles = await readStore();
  const entry = profiles.find((p) => p.id === id);
  if (!entry?.session) return;
  Object.assign(entry.session.tokens, tokens);
  await writeStore(profiles);
}

/**
 * The server refused this profile's stored session for good. Forget the stash
 * but keep the row: a saved account whose tokens are dead restores nothing, and
 * offering it under "Continue as" only bounces the person straight back to the
 * sign-in sheet every time they pick it.
 */
export async function dropStoredProfileSession(
  owner: { address: string; uid: string | null },
): Promise<void> {
  const address = owner.address.toLowerCase();
  const id = owner.uid ?? `addr:${address}`;
  const profiles = await readStore();
  let changed = false;
  for (const entry of profiles) {
    if (!entry.session) continue;
    if (entry.id !== id && entry.address?.toLowerCase() !== address) continue;
    entry.session = null;
    changed = true;
  }
  if (changed) await writeStore(profiles);
}

/**
 * A new login is about to overwrite the session keys with the incoming
 * account's identity. Give the outgoing account one final snapshot, then clear
 * every key it owned so the two identities can never blend — a stale
 * auth_supabase_uid makes the next refresh treat the new account as linked to
 * the old one, and the single-slot signing provider must be rebuilt regardless.
 */
export async function stageIncomingIdentity(preserveSupabaseUserId?: string): Promise<void> {
  // Preserve, not just snapshot. A snapshot only refreshes a row that is
  // already in the registry, so an account that had never been through Add
  // profile was taken apart here leaving nothing to switch back to — the
  // displaced account really was gone. Saving it makes a second login
  // additive, which is the whole promise of the profile list.
  await preserveOutgoingProfile();
  // Arm the same bookkeeping an explicit Add profile tap arms, unless one is
  // already in flight: the completed login then adopts the INCOMING account
  // too (see useAuthSession's tail), so the device ends up holding both
  // however the second login started, and an abandoned attempt can put the
  // displaced account back.
  markDisplacedAccount(await currentProfileId());
  switchGuarded = true;
  try {
    for (const key of SESSION_KEYS) {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {}
    }
    try {
      const keys = await AsyncStorage.getAllKeys();
      const doomed: string[] = [];
      for (const key of keys.filter((k) => SB_KEY_PATTERN.test(k))) {
        // A verified exchange may correct the profile address while keeping
        // the same Google identity. Preserve only that incoming session.
        if (preserveSupabaseUserId) {
          try {
            const raw = await AsyncStorage.getItem(key);
            if (raw && JSON.parse(raw)?.user?.id === preserveSupabaseUserId) continue;
          } catch {}
        }
        doomed.push(key);
      }
      if (doomed.length) await AsyncStorage.multiRemove(doomed);
    } catch {}
    clearFallbackKeys((key, raw) => {
      if (!SB_KEY_PATTERN.test(key)) return false;
      if (!preserveSupabaseUserId) return true;
      try {
        return JSON.parse(raw)?.user?.id !== preserveSupabaseUserId;
      } catch {
        return true;
      }
    });
    // Per-account caches die with the displaced session — engagement overlays,
    // link-copy floors, PPV unlocks and viewer-shaped query caches would all
    // otherwise paint the outgoing account's state for the incoming one.
    try {
      clearAllEngagement();
    } catch {}
    try {
      clearLinkCopyFloors();
    } catch {}
    try {
      clearUnlockedTokens();
    } catch {}
    try {
      clearBlockedAuthors();
    } catch {}
    try {
      queryClient.clear();
    } catch {}
  } finally {
    switchGuarded = false;
  }
}

/** True when live session keys exist and belong to someone other than `address`. */
export async function displacesAnotherAccount(address: string): Promise<boolean> {
  const identity = await currentIdentity();
  if (!identity) return false;
  return identity.address.toLowerCase() !== address.toLowerCase();
}

// ── Add-profile attempt tracking ────────────────────────────────────────────
// Mirrors dehubweb's addProfilePrevIdRef. Opening "Add profile" records who
// was live and adopts them into the list; a completed login consumes the
// attempt and adopts the NEW account; an abandoned one can restore whoever was
// displaced. Module-scoped because the attempt spans screens, not components.

let addProfileAttemptFrom: string | null | undefined;

/** Record the live account as the fallback for an Add profile attempt. */
export async function beginAddProfileAttempt(): Promise<void> {
  addProfileAttemptFrom = await currentProfileId();
  await adoptCurrentProfile();
}

/**
 * Same bookkeeping, for a displacement nobody started from the Add profile
 * button — connecting a second wallet, or signing in as someone else from the
 * ordinary sheet. Both are "add a profile" as far as the device is concerned;
 * only the entry point differs, and the entry point is not what should decide
 * whether the previous account survives.
 *
 * Never overwrites an attempt already in flight — that one knows who it
 * displaced first, and it is the one with UI waiting on it.
 */
export function markDisplacedAccount(prevId: string | null): void {
  if (addProfileAttemptFrom !== undefined) return;
  addProfileAttemptFrom = prevId;
}

export function addProfileAttemptActive(): boolean {
  return addProfileAttemptFrom !== undefined && addProfileAttemptFrom !== null;
}

/** Consume the attempt; returns who was live when it started, if any. */
export function consumeAddProfileAttempt(): string | null | undefined {
  const value = addProfileAttemptFrom;
  addProfileAttemptFrom = undefined;
  return value;
}

/**
 * Restore the account an abandoned Add profile attempt displaced, if it was
 * indeed displaced. Returns the restored snapshot's supabase tokens for
 * re-seating, or null when nothing needed restoring.
 */
export async function restoreDisplacedProfileIfAny(): Promise<{
  supabase: StoredProfileSession['supabase'];
} | null> {
  const attemptedFrom = consumeAddProfileAttempt();
  if (attemptedFrom === undefined || attemptedFrom === null) return null;
  const current = await currentIdentity();
  if (!current || current.id === attemptedFrom) return null;
  const entry = await getProfile(attemptedFrom);
  switchGuarded = true;
  try {
    await applyStash(entry?.session ?? null);
  } finally {
    switchGuarded = false;
  }
  return { supabase: entry?.session?.supabase ?? undefined };
}

/**
 * Write a session stash into place: everything the outgoing account owned is
 * wiped first — key material never crosses identities, and a half-swap must
 * never be what an authed request reads off disk.
 */
async function applyStash(session: StoredProfileSession | null): Promise<void> {
  for (const key of SESSION_KEYS) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {}
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const doomed = keys.filter((k) => SB_KEY_PATTERN.test(k));
    if (doomed.length) await AsyncStorage.multiRemove(doomed);
  } catch {}
  clearFallbackKeys((key) => SB_KEY_PATTERN.test(key));
  try {
    clearAllEngagement();
  } catch {}
  try {
    clearLinkCopyFloors();
  } catch {}
  try {
    clearUnlockedTokens();
  } catch {}
  try {
    clearBlockedAuthors();
  } catch {}
  try {
    queryClient.clear();
  } catch {}
  if (session) {
    for (const [key, value] of Object.entries(session.tokens)) {
      try {
        await SecureStore.setItemAsync(key, value);
      } catch {}
    }
    if (session.supabase) {
      try {
        await resilientAsyncStorage.setItem(
          session.supabase.storageKey,
          JSON.stringify({
            access_token: session.supabase.access_token,
            refresh_token: session.supabase.refresh_token,
          }),
        );
      } catch {}
    }
  }
}

export interface ProfileSwitchPlan {
  id: string;
  uid: string | null;
  address: string;
  supabase: { access_token: string; refresh_token: string } | null;
  userJson: string | null;
}

/**
 * Stage a switch to another saved profile: snapshot the outgoing account one
 * last time, then write the target's session keys into place. Returns what the
 * caller needs to finish (re-seat Supabase, rehydrate app state); null when the
 * target has no usable stored session, in which case disk is untouched.
 */
export async function beginProfileSwitch(id: string): Promise<ProfileSwitchPlan | null> {
  const entry = await getProfile(id);
  if (!entry?.session) return null;

  await snapshotCurrentSession();
  const outgoing = await currentIdentity();

  switchGuarded = true;
  try {
    await applyStash(entry.session);
  } catch {
    // Put the outgoing account's just-refreshed snapshot back — disk must end
    // up describing exactly one whole identity.
    try {
      const prev = outgoing ? await getProfile(outgoing.id) : null;
      await applyStash(prev?.session ?? null);
    } catch {}
    switchGuarded = false;
    return null;
  }

  return {
    id: entry.id,
    uid: entry.uid,
    address: entry.address,
    supabase: entry.session.supabase
      ? {
          access_token: entry.session.supabase.access_token,
          refresh_token: entry.session.supabase.refresh_token,
        }
      : null,
    userJson: entry.session.tokens['auth_user'] ?? null,
  };
}

/**
 * Back out of a staged switch whose restore failed. Puts the account that was
 * live before beginProfileSwitch back on disk; when there was none, every
 * staged key is wiped. No-op when nothing was staged.
 */
export async function abortProfileSwitch(prevId: string | null): Promise<void> {
  if (!switchGuarded) return;
  try {
    const prev = prevId ? await getProfile(prevId) : null;
    await applyStash(prev?.session ?? null);
  } finally {
    switchGuarded = false;
  }
}

/**
 * Finish a staged switch successfully: release the snapshot guard (there is no
 * page reload on mobile to do it for us) and record the incoming account as
 * explicitly active. Callers must end every staged switch with either this or
 * abortProfileSwitch — a guard left set would silently stop all tracking.
 */
export async function completeProfileSwitch(id: string): Promise<void> {
  switchGuarded = false;
  // Picking a saved account settles any Add profile attempt still open: the
  // account it would restore is the one just switched away from on purpose.
  // Left open, the next dismissal of the sign-in sheet put that account's keys
  // back on disk under the one on screen, and the app reopened as it.
  consumeAddProfileAttempt();
  const profiles = await readStore();
  const entry = profiles.find((p) => p.id === id);
  if (entry) {
    entry.lastActiveAt = Date.now();
    await writeStore(profiles);
  }
}
