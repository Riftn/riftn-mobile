import { useCallback, useMemo, useRef } from "react";
import { useAuthActions, useUser } from "../context/AuthContext";
import { AuthService } from "../services/auth.service";
import { getAccount } from "../services/user.service";
import { createLogger } from "../libs/logger";
import { PROFILE_VIEW_DEFAULT_KEY, type ProfileViewModeState, type ProfileViewMode } from "../libs/profileViewMode";

const logger = createLogger("SaveOwnProfileView");
const pending = new Map<string, Promise<void>>();


/**
 * On your own profile the grid/list toggle is your choice, so keep it: save it
 * as your profile layout (customs.defaultProfileView, the same setting as
 * Settings > Profile posts layout) so it is still there after the app restarts.
 * On other profiles the reader's selection is stored on this device.
 */
export function useSaveOwnProfileView(state: ProfileViewModeState, isOwn: boolean): ProfileViewModeState {
  const user = useUser() as any;
  const { patchUser } = useAuthActions();
  const userRef = useRef(user);
  userRef.current = user;

  const setMode = useCallback((next: ProfileViewMode) => {
    state.setMode(next);
    if (!isOwn) return;
    const me = userRef.current;
    const address = (me?.walletAddress || me?.address)?.toLowerCase();
    if (!address) return;
    const previous = pending.get(address);
    const saved = me?.customs?.[PROFILE_VIEW_DEFAULT_KEY] === "list" ? "list" : "grid";
    if (!previous && saved === next) return;

    // A second tap can restore the cached default while the first write is in
    // flight. Queue it after that write even when the profile has been reopened.
    const isCurrent = () => pending.get(address) === write &&
      (userRef.current?.walletAddress || userRef.current?.address)?.toLowerCase() === address;
    const write: Promise<void> = (previous ?? Promise.resolve()).then(async () => {
      if (!isCurrent()) return;
      let base: Record<string, unknown> = me?.customs ?? {};
      try {
        const res: any = await getAccount(me?.username || address);
        const core = res?.data?.result || res?.result;
        if (core?.customs && typeof core.customs === "object") base = core.customs;
      } catch { /* use the cached copy */ }
      if (!isCurrent()) return;
      const merged = { ...base, [PROFILE_VIEW_DEFAULT_KEY]: next };
      await AuthService.updateProfile({ customs: JSON.stringify(merged) });
      if (isCurrent()) await patchUser({ customs: merged as Record<string, string> } as any);
    }).catch(error => {
      logger.warn("Saving profile layout failed", error);
    }).finally(() => {
      if (pending.get(address) === write) pending.delete(address);
    });
    pending.set(address, write);
  }, [state, isOwn, patchUser]);

  return useMemo(() => ({ mode: state.mode, setMode }), [state.mode, setMode]);
}
