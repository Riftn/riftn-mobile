import { useSyncExternalStore } from 'react';
import env from './env';
import type { createAppKit } from '@reown/appkit-ethers5-react-native';
type Kit = ReturnType<typeof createAppKit>;
export const isWalletConnectAvailable = !!env.REOWN_PROJECT_ID;
const listeners = new Set<() => void>();
let pending: Promise<Kit | undefined> | undefined;
export function getAppKitInstance(): Kit | undefined {
  return (globalThis as any).__REOWN_APPKIT_INSTANCE__;
}
export function ensureAppKit(): Promise<Kit | undefined> {
  if (getAppKitInstance()) return Promise.resolve(getAppKitInstance());
  if (!pending) pending = import('./reown.runtime').then(m => {
    const kit = m.getAppKitInstance();
    if (!kit) throw new Error('Wallet connection is unavailable');
    listeners.forEach(fn => fn());
    return kit;
  }).catch(error => { pending = undefined; throw error; });
  return pending;
}
export function useAppKitReady(): boolean {
  return useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => !!getAppKitInstance());
}

// Who draws the wallet picker. AppKit's picker is drawn inline (react-native-
// modal with coverScreen: false), so it only shows above what sits under it
// in the same view tree. The app-wide host lives next to the navigator, which
// covers every normal page. On iPhone, a page opened as a native modal (the
// sign-in page from "Log in") is presented by UIKit above the whole root
// view, so a picker drawn by the app-wide host opened BEHIND it: Connect
// Wallet looked like it did nothing. Such a page claims the picker while it is
// up and draws it itself; the newest claim wins, the app-wide host draws it
// when nobody has claimed it.
const hostOwners: symbol[] = [];
const hostListeners = new Set<() => void>();
function notifyHosts() { hostListeners.forEach(fn => fn()); }
export function claimWalletPickerHost(owner: symbol): () => void {
  hostOwners.push(owner);
  notifyHosts();
  return () => {
    const index = hostOwners.lastIndexOf(owner);
    if (index >= 0) hostOwners.splice(index, 1);
    notifyHosts();
  };
}
export function useWalletPickerOwner(): symbol | null {
  return useSyncExternalStore(
    fn => { hostListeners.add(fn); return () => { hostListeners.delete(fn); }; },
    () => hostOwners[hostOwners.length - 1] ?? null,
  );
}
