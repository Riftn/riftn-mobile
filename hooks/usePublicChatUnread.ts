import { useSyncExternalStore } from 'react';
import { useAuthState, useUser } from '../context/AuthContext';
import { storage } from '../libs/storage';
import { createPublicChatUnreadStore } from '../libs/public-chat-unread-store';

export const publicChatUnread = createPublicChatUnreadStore({
  read: (key) => storage.getString(key),
  write: (key, value) => storage.set(key, value),
});

export function usePublicChatAccount() {
  const user = useUser();
  const { isSignedIn } = useAuthState();
  return isSignedIn ? user?.walletAddress || user?.address || '' : '';
}

export function usePublicChatUnreadCount() {
  const account = usePublicChatAccount();
  return useSyncExternalStore(
    publicChatUnread.subscribe,
    () => publicChatUnread.hasSynced(account) ? publicChatUnread.count(account) : 0,
    () => 0,
  );
}
