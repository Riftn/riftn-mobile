import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAuthActions, useUser } from "../context/AuthContext";
import { toastError } from "../libs";
import type { ProfileViewMode, ProfileViewModeState, ProfileViewReaderPref } from "../libs/profileViewMode";
import { AuthService } from "../services/auth.service";

type LayoutUpdate = { defaultProfileView?: ProfileViewMode; profileViewOthers: ProfileViewReaderPref };
const pending = new Map<string, Promise<void>>();

export function useProfileViewWriter() {
  const user = useUser();
  const address = (user?.walletAddress || user?.address)?.toLowerCase();
  const activeAddress = useRef(address);
  activeAddress.current = address;
  const { patchUser } = useAuthActions();

  return useCallback(async (update: LayoutUpdate) => {
    if (!address) throw new Error("Profile layout requires a signed-in account");
    const previous = pending.get(address);
    const write = (previous?.catch(() => {}) ?? Promise.resolve()).then(async () => {
      if (activeAddress.current !== address) return;
      await AuthService.updateProfile(update);
      await patchUser(current => (current?.walletAddress || current?.address)?.toLowerCase() === address ? update : {});
    });
    pending.set(address, write);
    try {
      await write;
    } finally {
      if (pending.get(address) === write) pending.delete(address);
    }
  }, [address, patchUser]);
}

/** Toolbar choices use the same account settings as the layout pickers. */
export function useSaveProfileView(state: ProfileViewModeState, isOwn: boolean): ProfileViewModeState {
  const user = useUser();
  const { t } = useTranslation();
  const saveLayout = useProfileViewWriter();
  const { mode, setMode: setLocalMode } = state;
  const setMode = useCallback((next: ProfileViewMode) => {
    if (!user?.walletAddress && !user?.address) {
      setLocalMode(next);
      return;
    }
    const updates = isOwn ? { defaultProfileView: next, profileViewOthers: next } : { profileViewOthers: next };
    void saveLayout(updates).catch(error => toastError(error, t("settings.failedUpdateSetting")));
  }, [isOwn, saveLayout, setLocalMode, t, user?.address, user?.walletAddress]);
  return useMemo(() => ({ mode, setMode }), [mode, setMode]);
}
