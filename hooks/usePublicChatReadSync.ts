import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getChatReadPosition, type ChatReadPosition } from '../services/dm/dm.api';
import { publicChatUnread, usePublicChatAccount } from './usePublicChatUnread';

/** Same chat id and query key as the room's own read spot (useChatReadPosition). */
const PUBLIC_CHAT_ID = 'live:global';

/**
 * Mounted once (next to the Public Chat alerts). The room opens on the spot
 * saved on the server, shared with the website, so the badge drops whatever
 * was already read there. Without it the row said 97 while the room said 19.
 */
export function usePublicChatReadSync() {
  const account = usePublicChatAccount();
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

