import { useQuery } from "@tanstack/react-query";
import { IS_APP_STORE_BUILD } from "../config/storefront";
import { useAuthState, useUser } from "../context/AuthContext";
import { getAppTokenPreview, getAppTokensConfig, getMyAppTokens } from "../services/app-tokens.service";

export const APP_TOKENS_QUERY_KEY = "app-tokens-me";

/**
 * Whether app tokens are switched on. The server decides, for web and the app
 * at once, except in the App Store build: an in-app balance people send and
 * spend is an in-app currency, which there would have to be sold through
 * Apple (App Store 3.1.1), so a server switch can't turn it on.
 */
export function useAppTokensConfig(enabled = true) {
  return useQuery({
    queryKey: ["app-tokens-config"],
    queryFn: getAppTokensConfig,
    staleTime: 5 * 60_000,
    retry: false,
    enabled: enabled && !IS_APP_STORE_BUILD,
  });
}

export function useAppTokensEnabled(): boolean {
  return useAppTokensConfig().data?.enabled === true && !IS_APP_STORE_BUILD;
}

/** The signed-in account's app-token balance and latest movements. */
export function useAppTokens(enabled = true) {
  const { isSignedIn } = useAuthState();
  const user = useUser();
  const address = user?.walletAddress || user?.address;
  return useQuery({
    queryKey: [APP_TOKENS_QUERY_KEY, address?.toLowerCase() ?? null],
    queryFn: getMyAppTokens,
    enabled: enabled && isSignedIn && !!address,
    staleTime: 15_000,
    retry: false,
  });
}

export function useAppTokenPreview(open: boolean) {
  const { isSignedIn } = useAuthState();
  const user = useUser();
  const address = (user?.walletAddress || user?.address)?.toLowerCase();
  return useQuery({
    queryKey: ["app-token-preview", address],
    queryFn: getAppTokenPreview,
    enabled: open && isSignedIn && !!address,
    staleTime: 15_000,
    retry: false,
  });
}
