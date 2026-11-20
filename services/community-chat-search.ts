/**
 * Search inside a group, channel or community chat, in the page shape the
 * shared chat search (components/LiveChat/LiveChatSearch) reads. Same query
 * as web's src/lib/community-chat-search.ts: the table is read under the
 * reader's own row-level access, so a private chat stays members-only.
 */
import { supabase } from "./supabase";
import { withWalletHeader } from "../libs/supabase-wallet-client";
import type { LiveChatSearchResponse } from "./livechat.service";

const PAGE = 30;
/** How far back the "people in this chat" list looks. */
const PEOPLE_WINDOW = 1000;

interface Row {
  id: string;
  wallet_address: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  content: string;
  message_type: string;
  image_url: string | null;
  created_at: string;
}

/** Older-page cursor: the time of the last result, by its id. */
const cursorAt = new Map<string, string>();

const likeEscape = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

export function peopleFromRows(rows: Pick<Row, "wallet_address" | "username" | "display_name" | "avatar_url">[], q = "") {
  const by = new Map<string, { address: string; username?: string; displayName?: string; avatarUrl?: string; messageCount: number }>();
  for (const r of rows) {
    const address = r.wallet_address?.toLowerCase();
    if (!address) continue;
    const p = by.get(address);
    if (p) { p.messageCount += 1; continue; }
    by.set(address, {
      address,
      username: r.username || undefined,
      displayName: r.display_name || undefined,
      avatarUrl: r.avatar_url || undefined,
      messageCount: 1,
    });
  }
  const needle = q.trim().toLowerCase().replace(/^@/, "");
  return [...by.values()]
    .filter((p) => !needle || [p.username, p.displayName].some((v) => v?.toLowerCase().includes(needle)))
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 50);
}

export async function searchCommunityChat(
  communityId: string,
  params: { q?: string; from?: string; before?: string },
  walletAddress: string | null | undefined,
): Promise<LiveChatSearchResponse> {
  const q = (params.q ?? "").trim();
  let query = (supabase as any)
    .from("community_chat_messages")
    .select("id,wallet_address,username,display_name,avatar_url,content,message_type,image_url,created_at", { count: params.before ? undefined : "exact" })
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE + 1);
  if (q) query = query.ilike("content", `%${likeEscape(q)}%`);
  if (params.from) query = query.eq("wallet_address", params.from.toLowerCase());
  const at = params.before ? cursorAt.get(params.before) : undefined;
  if (params.before && at) query = query.lt("created_at", at);

  const peopleQuery = !params.before && !params.from
    ? withWalletHeader(
        (supabase as any)
          .from("community_chat_messages")
          .select("wallet_address,username,display_name,avatar_url")
          .eq("community_id", communityId)
          .order("created_at", { ascending: false })
          .limit(PEOPLE_WINDOW),
        walletAddress ?? null,
      )
    : null;

  const [{ data, error, count }, peopleRes] = await Promise.all([
    withWalletHeader(query, walletAddress ?? null),
    peopleQuery ?? Promise.resolve(null),
  ]);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, PAGE);
  for (const r of page) cursorAt.set(r.id, r.created_at);
  return {
    messages: page.map((r) => ({
      _id: r.id,
      id: r.id,
      content: r.content || "",
      messageType: r.message_type,
      imageUrl: r.image_url || undefined,
      senderAddress: r.wallet_address,
      sender: {
        address: r.wallet_address,
        username: r.username || undefined,
        displayName: r.display_name || undefined,
        avatarUrl: r.avatar_url || undefined,
      },
      createdAt: r.created_at,
    })),
    people: peopleRes && !peopleRes.error ? peopleFromRows((peopleRes.data ?? []) as Row[], q) : [],
    hasMore: rows.length > PAGE,
    total: typeof count === "number" ? count : null,
  } as unknown as LiveChatSearchResponse;
}
