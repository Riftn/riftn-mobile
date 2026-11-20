/**
 * Newest line and unread number for each group, channel and community chat in
 * the Messages list, like a private chat row (same as web's
 * use-room-chat-summaries). Two small reads per chat, refreshed every 30
 * seconds while the list is on screen.
 */
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { withWalletHeader } from "../libs/supabase-wallet-client";
import { storage } from "../libs/storage";
import { createRoomReadStore, type RoomLastLine } from "../libs/room-chat-read";
import { getLiveChatMessages } from "../services/livechat.service";
import { useIsScreenFocused } from "./useFocusedInterval";
import { publicChatUnread } from "./usePublicChatUnread";

export const roomRead = createRoomReadStore({
  read: (key) => storage.getString(key),
  write: (key, value) => storage.set(key, value),
});

export interface RoomSummary {
  last: RoomLastLine | null;
  unread: number;
}

const LINE_FIELDS = "id,content,message_type,image_url,wallet_address,username,display_name,created_at";

async function readSummary(roomId: string, wallet: string): Promise<RoomSummary> {
  const { data } = await withWalletHeader(
    (supabase as any).from("community_chat_messages").select(LINE_FIELDS)
      .eq("community_id", roomId).order("created_at", { ascending: false }).limit(1),
    wallet,
  );
  const last = (Array.isArray(data) ? data[0] : null) as RoomLastLine | null;
  const lastAt = last ? Date.parse(last.created_at) : NaN;
  const readAt = roomRead.get(wallet, roomId);
  if (readAt == null) {
    roomRead.seed(wallet, roomId, Number.isFinite(lastAt) ? lastAt : Date.now());
    return { last, unread: 0 };
  }
  if (!Number.isFinite(lastAt) || lastAt <= readAt) return { last, unread: 0 };
  const { count } = await withWalletHeader(
    (supabase as any).from("community_chat_messages").select("id", { count: "exact", head: true })
      .eq("community_id", roomId).gt("created_at", new Date(readAt).toISOString())
      .neq("wallet_address", wallet),
    wallet,
  );
  return { last, unread: count ?? 0 };
}

export function useRoomChatSummaries(roomIds: string[], walletAddress: string | null | undefined) {
  const wallet = (walletAddress || "").toLowerCase();
  const ids = [...new Set(roomIds)].sort();
  const focused = useIsScreenFocused();
  // Re-render when a chat is read so its number clears straight away.
  useSyncExternalStore(roomRead.subscribe, roomRead.version, () => 0);
  const { data } = useQuery({
    queryKey: ["room-chat-summaries", wallet, ids.join(",")],
    enabled: !!wallet && ids.length > 0,
    staleTime: 15_000,
    refetchInterval: focused ? 30_000 : false,
    queryFn: async () => {
      const out: Record<string, RoomSummary> = {};
      const results = await Promise.allSettled(ids.slice(0, 60).map((id) => readSummary(id, wallet)));
      results.forEach((r, i) => { if (r.status === "fulfilled") out[ids[i]] = r.value; });
      return out;
    },
  });
  const out: Record<string, RoomSummary> = {};
  for (const [id, summary] of Object.entries(data ?? {})) {
    const readAt = roomRead.get(wallet, id);
    const lastAt = summary.last ? Date.parse(summary.last.created_at) : NaN;
    out[id] = readAt != null && Number.isFinite(lastAt) && lastAt <= readAt ? { ...summary, unread: 0 } : summary;
  }
  return out;
}

/** Mark a group chat read while it is on screen (and once more on the way out). */
export function useRoomChatReading(roomId: string | undefined, walletAddress: string | null | undefined, active: boolean) {
  useEffect(() => {
    const wallet = (walletAddress || "").toLowerCase();
    if (!active || !roomId || !wallet) return;
    roomRead.markRead(wallet, roomId);
    const timer = setInterval(() => roomRead.markRead(wallet, roomId), 10_000);
    return () => {
      clearInterval(timer);
      roomRead.markRead(wallet, roomId);
    };
  }, [roomId, walletAddress, active]);
}

/** The newest line in General Chat, for its row in the Messages list. */
export function usePublicChatLastLine(enabled: boolean): RoomLastLine | null {
  const focused = useIsScreenFocused();
  const { data, refetch } = useQuery({
    queryKey: ["public-chat-last-line"],
    enabled,
    staleTime: 15_000,
    refetchInterval: focused ? 30_000 : false,
    queryFn: async () => {
      const page = await getLiveChatMessages({ limit: 10 });
      const newest = (page?.messages ?? [])
        .filter((m: any) => m && m.messageType !== "system" && !m.isDeleted)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
      if (!newest) return null;
      return {
        content: newest.content,
        message_type: newest.audioUrl || newest.messageType === "voice" ? "audio" : newest.gif ? "gif" : newest.messageType,
        image_url: newest.media?.[0]?.url ?? (newest.media?.length ? "media" : null),
        wallet_address: newest.sender?.address || newest.senderAddress || null,
        username: newest.sender?.username || null,
        display_name: newest.sender?.displayName || null,
        created_at: newest.createdAt,
      } as RoomLastLine;
    },
  });
  // The 30 second timer stops while the app is in the background or another
  // screen is on top, and nothing asked again on the way back, so the row kept
  // showing your own last line long after others had written. Ask again when
  // the list comes back into view, when the app comes back, and shortly after
  // the room socket reports a new line.
  useEffect(() => {
    if (enabled && focused) void refetch();
  }, [enabled, focused, refetch]);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void refetch(); }, 1500);
    };
    const off = publicChatUnread.subscribe(soon);
    const app = AppState.addEventListener("change", (s) => { if (s === "active") soon(); });
    return () => {
      off();
      app.remove();
      if (timer) clearTimeout(timer);
    };
  }, [enabled, refetch]);
  return data ?? null;
}
