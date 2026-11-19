import { useCallback, useMemo, useRef } from "react";
import { useAuthActions, useUser } from "../context/AuthContext";
import { AuthService } from "../services/auth.service";
import { getAccount } from "../services/user.service";
import { createLogger } from "../libs/logger";
import { PROFILE_VIEW_DEFAULT_KEY, type ProfileViewModeState, type ProfileViewMode } from "../libs/profileViewMode";

const logger = createLogger("SaveOwnProfileView");

/**
 * On your own profile the grid/list toggle is your choice, so keep it: save it
 * as your profile layout (customs.defaultProfileView, the same setting as
 * Settings > Profile posts layout) so it is still there after the app restarts.
 * On anyone else's profile the toggle stays a flip for this app session.
 */
export function useSaveOwnProfileView(state: ProfileViewModeState, isOwn: boolean): ProfileViewModeState {
  const user = useUser() as any;
  const { patchUser } = useAuthActions();
  const userRef = useRef(user);
  userRef.current = user;
  const seq = useRef(0);

  const setMode = useCallback((next: ProfileViewMode) => {
    state.setMode(next);
    if (!isOwn) return;
    const me = userRef.current;
    if (!me) return;
    const saved = me?.customs?.[PROFILE_VIEW_DEFAULT_KEY] === "list" ? "list" : "grid";
    if (saved === next) return;
    const mine = ++seq.current;
    void (async () => {
      // Merge into the account's latest customs, not a cached copy, so a
      // setting saved on another device is never written back over.
      let base: Record<string, unknown> = me?.customs ?? {};
      try {
        const res: any = await getAccount(me?.username || me?.walletAddress || me?.address);
        const core = res?.data?.result || res?.result;
        if (core?.customs && typeof core.customs === "object") base = core.customs;
      } catch { /* use the cached copy */ }
      if (mine !== seq.current) return;
      const merged = { ...base, [PROFILE_VIEW_DEFAULT_KEY]: next };
      try {
        await AuthService.updateProfile({ customs: JSON.stringify(merged) });
        patchUser({ customs: merged as Record<string, string> } as any).catch(() => {});
      } catch (error) {
        logger.warn("Saving profile layout failed", error);
      }
    })();
  }, [state, isOwn, patchUser]);

  return useMemo(() => ({ mode: state.mode, setMode }), [state.mode, setMode]);
}
