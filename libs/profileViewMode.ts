/**
 * Profile view mode: the All tab shows posts as a grid of tiles or as the
 * full post list.
 *
 * The profile's owner picks which one visitors start on (Settings > Profile
 * posts layout, saved in the account's public `customs.defaultProfileView`,
 * the same key web uses). A visitor can still flip the toolbar toggle; the
 * flip holds for that profile until the app is closed, then the owner's
 * choice applies again.
 *
 * The profile tabs provide the mode through ProfileViewModeContext so the
 * toolbar toggle and the tab that draws the posts agree. Without a provider
 * both fall back to one shared in-memory mode.
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

export type ProfileViewMode = "grid" | "list";

/** Key in the account's `customs` blob. Absent means grid. */
export const PROFILE_VIEW_DEFAULT_KEY = "defaultProfileView";

export function parseProfileViewDefault(raw: unknown): ProfileViewMode {
  return raw === "list" ? "list" : "grid";
}

/** Reads the owner's choice off an account record (`customs` may be absent). */
export function getProfileViewDefault(account: unknown): ProfileViewMode {
  const customs = (account as { customs?: Record<string, unknown> } | null | undefined)?.customs;
  return parseProfileViewDefault(customs?.[PROFILE_VIEW_DEFAULT_KEY]);
}

/**
 * How the reader wants every profile they open to start: each owner's own
 * choice (default), or always grid, or always list. Saved in the reader's own
 * `customs.profileViewOthers` (same key as web).
 */
export type ProfileViewReaderPref = "owner" | ProfileViewMode;
export const PROFILE_VIEW_READER_KEY = "profileViewOthers";

export function parseProfileViewReaderPref(raw: unknown): ProfileViewReaderPref {
  return raw === "grid" || raw === "list" ? raw : "owner";
}

export function getProfileViewReaderPref(account: unknown): ProfileViewReaderPref {
  const customs = (account as { customs?: Record<string, unknown> } | null | undefined)?.customs;
  return parseProfileViewReaderPref(customs?.[PROFILE_VIEW_READER_KEY]);
}

/** The view a profile opens in for this reader. Your own profile always uses your own default. */
export function startingProfileView(ownerDefault: ProfileViewMode, readerPref: ProfileViewReaderPref, isOwnProfile: boolean): ProfileViewMode {
  return isOwnProfile || readerPref === "owner" ? ownerDefault : readerPref;
}

const listeners = new Set<() => void>();
let flips: Record<string, ProfileViewMode> = {};

function emit(): void {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot(): Record<string, ProfileViewMode> {
  return flips;
}

/** Key used when no profile provides its own. */
const LOOSE_KEY = "__loose__";

/** Drop the flip for a profile, so its owner's default shows again. */
export function clearProfileViewFlip(profileKey: string | null | undefined): void {
  if (!profileKey) return;
  const key = profileKey.toLowerCase();
  if (!(key in flips)) return;
  const { [key]: _dropped, ...rest } = flips;
  flips = rest;
  emit();
}

export interface ProfileViewModeState {
  mode: ProfileViewMode;
  setMode: (mode: ProfileViewMode) => void;
}

/**
 * The view for one profile: the visitor's flip if they made one, else the
 * owner's saved default.
 */
export function useProfileViewState(profileKey: string | null | undefined, ownerDefault: ProfileViewMode): ProfileViewModeState {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  const key = profileKey ? profileKey.toLowerCase() : LOOSE_KEY;
  const mode = all[key] ?? ownerDefault;
  const setMode = useCallback((next: ProfileViewMode) => {
    flips = { ...flips, [key]: next };
    emit();
  }, [key]);
  return useMemo(() => ({ mode, setMode }), [mode, setMode]);
}

export const ProfileViewModeContext = createContext<ProfileViewModeState | null>(null);

function useResolved(): ProfileViewModeState {
  const provided = useContext(ProfileViewModeContext);
  const loose = useProfileViewState(null, "grid");
  return provided ?? loose;
}

export function useProfileViewMode(): ProfileViewMode {
  return useResolved().mode;
}

export function useSetProfileViewMode(): (mode: ProfileViewMode) => void {
  return useResolved().setMode;
}
