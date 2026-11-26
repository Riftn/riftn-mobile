import { useEffect, useRef } from "react";
import { isTokenExpired } from "../libs/auth.utils";
import { tokenRefreshManager } from "../libs/token-refresh";
import { markLaunchPhase } from "../libs/launchTiming";

const BOOT_REFRESH_RETRY_MS = 30_000;

type BootDeps<User> = {
  hasInternet?: boolean | null;
  getAuthUser: <T>() => Promise<T | null>;
  getAuthToken: () => Promise<string | null>;
  hasSeenAuth: () => Promise<boolean>;
  setUser: (u: any) => void;
  setIsSignedIn: (v: boolean) => void;
  setIsFirstTimeUser: (v: boolean) => void;
  setIsBootLoading: (v: boolean) => void;
  ensureProvider: () => Promise<void>;
  reconcileProfile?: () => Promise<boolean>;
  canRestoreCachedProfile?: (user: User, token: string) => Promise<boolean>;
  refreshCachedProfile?: (user: User, token: string) => Promise<unknown>;
  log: { warn: (...a: any[]) => void; error: (...a: any[]) => void; info?: (...a: any[]) => void };
};

export function useAuthBoot<User>({
  hasInternet,
  getAuthUser,
  getAuthToken,
  hasSeenAuth,
  setUser,
  setIsSignedIn,
  setIsFirstTimeUser,
  setIsBootLoading,
  ensureProvider,
  reconcileProfile,
  canRestoreCachedProfile,
  refreshCachedProfile,
  log,
}: BootDeps<User>) {
  const connection = useRef({ hasInternet, reconnects: 0 });
  const retryBootRefresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    const reconnected = connection.current.hasInternet === false && hasInternet === true;
    if (hasInternet != null) connection.current.hasInternet = hasInternet;
    if (reconnected) {
      connection.current.reconnects++;
      const retry = retryBootRefresh.current;
      if (retry) retry();
      else void tokenRefreshManager.ensureFreshToken().catch(error => log.warn('auth:reconnect:failed', error));
    }
  }, [hasInternet, log]);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const refreshCachedSession = async (userData: User, token: string): Promise<void> => {
      if (!active || refreshing) return;
      clearTimeout(retryTimer);
      refreshing = true;
      const reconnects = connection.current.reconnects;
      const retry = () => {
        void refreshCachedSession(userData, token).catch(error => log.warn('boot:refresh-failed', error));
      };
      try {
        if (await getAuthToken() !== token || !active) {
          retryBootRefresh.current = null;
          return;
        }
        retryBootRefresh.current = retry;
        if (connection.current.hasInternet === false) return;

        markLaunchPhase('authRefreshStarted');
        const newToken = await tokenRefreshManager.attemptRefresh();
        const storedToken = await getAuthToken();
        if (!active) return;
        if (newToken && storedToken === newToken) {
          retryBootRefresh.current = null;
          setUser(userData);
          setIsSignedIn(true);
          ensureProvider().catch(error => log.warn('boot:ensureProvider:failed', error));
        } else if (storedToken !== token) {
          // Logout, revocation or a different account took over during refresh.
          retryBootRefresh.current = null;
        }
      } finally {
        refreshing = false;
        if (active && retryBootRefresh.current === retry && connection.current.hasInternet !== false) {
          // Recovery can arrive during a request, or NetInfo may see no link
          // change at all when the API is slow or unavailable.
          if (connection.current.reconnects !== reconnects) retry();
          else retryTimer = setTimeout(retry, BOOT_REFRESH_RETRY_MS);
        }
      }
    };

    const loadAuthState = async () => {
      markLaunchPhase('authStarted');
      try {
        const [userData, token, seenAuth] = await Promise.all([
          getAuthUser<User>(),
          getAuthToken(),
          hasSeenAuth(),
        ]);
        markLaunchPhase('authStorageReady');
        
        if (seenAuth) setIsFirstTimeUser(false);
        const verifiedCache = !!(userData && token && await canRestoreCachedProfile?.(userData, token));
        markLaunchPhase('authCacheChecked');
        if (userData && token && verifiedCache && !isTokenExpired(token)) {
          setUser(userData);
          setIsSignedIn(true);
          setIsBootLoading(false);
          // The marker authorizes cached presentation only; APIs and signing
          // keep their existing live-token and wallet-unlock checks.
          refreshCachedProfile?.(userData, token).catch(e => log.warn('boot:background-refresh:failed', e));
          ensureProvider().catch(e => log.warn('boot:ensureProvider:failed', e));
          return;
        }
        if (userData && verifiedCache) {
          setUser(userData);
          setIsBootLoading(false);
          // Keep protected actions signed out until the expired token refreshes.
        }
        // Replace a cached owner-wallet profile with the verified social profile.
        if (userData && token && !verifiedCache) {
          markLaunchPhase('authReconcileStarted');
          const reconciled = await reconcileProfile?.();
          markLaunchPhase('authReconcileReady');
          if (reconciled) return;
        }

        if (userData && token) {
          // Validate token expiration before restoring session
          if (isTokenExpired(token)) {
            await refreshCachedSession(userData, token);
          } else {
            // Token is valid, restore session
            setUser(userData);
            setIsSignedIn(true);
            ensureProvider().catch((e) => {
              log.warn("boot:ensureProvider:failed", e);
            });
          }
        }
        
        if (seenAuth) setIsFirstTimeUser(false);
      } catch (e) {
        log.error("boot:loadAuthState:error", e);
      } finally {
        markLaunchPhase('authReady');
        setIsBootLoading(false);
      }
    };
    loadAuthState();
    return () => {
      active = false;
      clearTimeout(retryTimer);
      retryBootRefresh.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount - all functions are stable refs
}
