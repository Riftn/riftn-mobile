/**
 * Pulls the account's dragged menu orders (libs/navOrder), and its menu
 * layout (libs/menuLayout), on sign-in, the way
 * useFeedInterestsServerSync does for interests. Server wins; an account that
 * has none yet adopts what this device was arranged into.
 */
import { useEffect } from "react";
import { supabase } from "../services/supabase";
import { withWalletHeader } from "../libs/supabase-wallet-client";
import { useUser } from "../context/AuthContext";
import { saveAccountPrefs } from "../libs/feed-interests";
import { setAppPref } from "./useAppPrefs";
import { MENU_LAYOUT_PREF_KEY, isMenuLayout } from "../libs/menuLayout";
import { MENU_GROUP_MOVES_PREF_KEY, getMenuGroupMoves, sanitiseMenuGroupMoves, writeMenuGroupMoves } from "../libs/menuGroupMoves";
import { NAV_ORDER_PREF_KEYS, getNavOrder, sanitiseNavOrder, writeNavOrder, type NavOrderSurface } from "../libs/navOrder";

const SURFACES: NavOrderSurface[] = ["menu", "bar", "home"];

export function useNavOrderServerSync(): void {
  const user = useUser() as any;
  const wallet = ((user?.walletAddress || user?.address || "") as string).toLowerCase();
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await withWalletHeader(
          supabase.from("user_display_preferences").select("preferences").eq("wallet_address", wallet).maybeSingle(),
          wallet,
        );
        if (cancelled || error) return;
        const prefs = (data as { preferences?: Record<string, unknown> } | null)?.preferences ?? {};
        const adopt: Record<string, string[]> = {};
        for (const surface of SURFACES) {
          const value = prefs[NAV_ORDER_PREF_KEYS[surface]];
          if (Array.isArray(value)) writeNavOrder(surface, sanitiseNavOrder(value));
          else if (getNavOrder(surface).length) adopt[NAV_ORDER_PREF_KEYS[surface]] = getNavOrder(surface);
        }
        // The menu layout set on the phone browser or another phone.
        const layout = prefs[MENU_LAYOUT_PREF_KEY];
        if (isMenuLayout(layout)) setAppPref("menuLayout", layout);
        // Tiles moved to another menu group, on the phone browser or another phone.
        const moves = prefs[MENU_GROUP_MOVES_PREF_KEY];
        if (moves && typeof moves === "object") writeMenuGroupMoves(sanitiseMenuGroupMoves(moves));
        else if (Object.keys(getMenuGroupMoves()).length) (adopt as Record<string, unknown>)[MENU_GROUP_MOVES_PREF_KEY] = getMenuGroupMoves();
        if (Object.keys(adopt).length) await saveAccountPrefs(wallet, adopt);
      } catch {
        /* the device copy stands */
      }
    })();
    return () => { cancelled = true; };
  }, [wallet]);
}
