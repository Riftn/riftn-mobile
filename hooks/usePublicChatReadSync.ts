import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getChatReadPosition, type ChatReadPosition } from '../services/dm/dm.api';
import { publicChatUnread, usePublicChatAccount } from './usePublicChatUnread';

/** Same chat id as the room's own read spot. */
const PUBLIC_CHAT_ID = 'live:global';

/**
 * Mounted once (next to the Public Chat alerts). The room opens on the spot
 * saved on the server, shared with the website, so the badge drops whatever
 * was already read there. Without it the row said 97 while the room said 19.
 */
export function usePublicChatReadSync() {
  const account = usePublicChatAccount();
  const startedAt = useMemo(() => Date.now(), [account]);
  const { data, isSuccess, isError } = useQuery({
    queryKey: ['public-chat-badge-read-position', account.toLowerCase()],
    queryFn: () => getChatReadPosition(PUBLIC_CHAT_ID),
    enabled: !!account,
    staleTime: 30_000,
    refetchInterval: 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
  const spot = data as ChatReadPosition | null | undefined;
  useEffect(() => {
    if (!isSuccess && !isError) return;
    const at = spot ? Date.parse(spot.at) : spot;
    publicChatUnread.syncReadPosition(account, at, startedAt);
  }, [account, spot, isSuccess, isError, startedAt]);
}

