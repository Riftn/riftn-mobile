import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getChatReadPosition, saveChatReadPosition, type ChatReadPosition } from "../services/dm/dm.api";
import { isLaterSpot, type ReadSpot } from "../libs/chatReadPosition";

/** How long a chat waits for its saved spot before opening at the newest line. */
const WAIT_MS = 1500;
/** Saves at most this often while you scroll. */
const SAVE_EVERY_MS = 1200;

const keyFor = (chatId: string | null | undefined) => ["chat-read-position", chatId ?? null] as const;

/**
 * Where you left off in one chat (server-saved, same spot as the website).
 *
 * - `opening` is the spot as it stood when the chat opened. It never moves
 *   while the chat stays open, so the "Unread messages" line stays put.
 * - `ready` turns true once the spot is known (or after a short wait).
 * - `report(id, at)` is called with the newest line on screen; the furthest
 *   one is saved shortly after, and when the app goes to the background.
 */
export function useChatReadPosition(chatId: string | null | undefined) {
  const queryClient = useQueryClient();
  const enabled = !!chatId;
  const query = useQuery({
    queryKey: keyFor(chatId),
    queryFn: () => getChatReadPosition(chatId!),
    enabled,
    refetchOnMount: "always",
    staleTime: 0,
    gcTime: 30 * 60_000,
    retry: 0,
  });

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    if (!enabled) return;
    const timer = setTimeout(() => setTimedOut(true), WAIT_MS);
    return () => clearTimeout(timer);
  }, [enabled, chatId]);

  const fetched = query.isFetchedAfterMount || query.isError;
  const ready = !enabled || fetched || timedOut;

  const openingRef = useRef<{ chatId: string | null | undefined; spot: ReadSpot | null; taken: boolean }>({ chatId, spot: null, taken: false });
  if (openingRef.current.chatId !== chatId) openingRef.current = { chatId, spot: null, taken: false };
  if (!openingRef.current.taken && ready) {
    const data = query.data as ChatReadPosition | null | undefined;
    openingRef.current = { chatId, spot: data ? { messageId: data.messageId, at: data.at } : null, taken: true };
  }

  const furthestRef = useRef<ReadSpot | null>(null);
  const sentRef = useRef<ReadSpot | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatRef = useRef(chatId);

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const id = chatRef.current;
    const spot = furthestRef.current;
    if (!id || !spot || !isLaterSpot(spot, sentRef.current)) return;
    sentRef.current = spot;
    queryClient.setQueryData(keyFor(id), (old: ChatReadPosition | null | undefined) =>
      old && !isLaterSpot(spot, old) ? old : { chatId: id, messageId: spot.messageId, at: spot.at, savedAt: new Date().toISOString() });
    saveChatReadPosition(id, spot.messageId, spot.at).catch(() => {
      if (sentRef.current === spot) sentRef.current = null;
    });
  }, [queryClient]);

  useEffect(() => {
    if (chatRef.current !== chatId) flush();
    chatRef.current = chatId;
    const server = query.data as ChatReadPosition | null | undefined;
    furthestRef.current = server ? { messageId: server.messageId, at: server.at } : null;
    sentRef.current = furthestRef.current;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  useEffect(() => {
    const server = query.data as ChatReadPosition | null | undefined;
    if (!server) return;
    const spot = { messageId: server.messageId, at: server.at };
    if (isLaterSpot(spot, furthestRef.current)) furthestRef.current = spot;
    if (isLaterSpot(spot, sentRef.current)) sentRef.current = spot;
  }, [query.data]);

  const report = useCallback((messageId: string, at: string) => {
    if (!enabled || !messageId || !at) return;
    if (AppState.currentState !== "active") return;
    const spot = { messageId, at };
    if (!isLaterSpot(spot, furthestRef.current)) return;
    furthestRef.current = spot;
    if (!timerRef.current) timerRef.current = setTimeout(flush, SAVE_EVERY_MS);
  }, [enabled, flush]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => { if (state !== "active") flush(); });
    return () => { sub.remove(); flush(); };
  }, [flush]);

  return { opening: openingRef.current.spot, ready, report, enabled };
}
