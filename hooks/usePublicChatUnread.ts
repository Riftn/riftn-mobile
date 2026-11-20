import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthState, useUser } from '../context/AuthContext';
import { storage } from '../libs/storage';
import { createPublicChatUnreadStore } from '../libs/public-chat-unread-store';
import { getChatReadPosition, type ChatReadPosition } from '../services/dm/dm.api';

export const publicChatUnread = createPublicChatUnreadStore({
  read: (key) => storage.getString(key),
  write: (key, value) => storage.set(key, value),
});

/** Same chat id and query key as the room's own read spot (useChatReadPosition). */
const PUBLIC_CHAT_ID = 'live:global';

function useAccount() {
  const user = useUser();
  const { isSignedIn } = useAuthState();
  return isSignedIn ? user?.walletAddress || user?.address || '' : '';
}

/**
 * Mounted once (next to the Public Chat alerts). The room opens on the spot
 * saved on the server, shared with the website, so the badge drops whatever
 * was already read there. Without it the row said 97 while the room said 19.
 */
export function usePublicChatReadSync() {
  const account = useAccount();
  const { data } = useQuery({
    queryKey: ['chat-read-position', PUBLIC_CHAT_ID],
    queryFn: () => getChatReadPosition(PUBLIC_CHAT_ID),
    enabled: !!account,
    staleTime: 30_000,
    refetchInterval: 60_000,
    gcTime: 30 * 60_000,
    retry: 0,
  });
  const spotAt = Date.parse((data as ChatReadPosition | null | undefined)?.at || '');
  useEffect(() => {
    if (account && Number.isFinite(spotAt)) publicChatUnread.catchUp(account, spotAt);
  }, [account, spotAt]);
}

export function usePublicChatUnreadCount() {
  const account = useAccount();
  return useSyncExternalStore(publicChatUnread.subscribe, () => publicChatUnread.count(account), () => 0);
}
