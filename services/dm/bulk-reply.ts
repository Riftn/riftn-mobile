/**
 * One reply sent to several picked chats at once (Messages list, Select).
 * Each DM gets it as its own normal message through the send queue, so it is
 * encrypted where both sides have keys and shows as a bubble in that chat.
 * Group and community chats get it as a normal line in the room.
 */
import { supabase } from "../supabase";
import { withWalletHeader } from "../../libs/supabase-wallet-client";
import { reportCommunityChatMessage } from "../../libs/community-chat-notify";
import { dmSendQueue } from "./dm.send";

export interface BulkSender {
  userId: string;
  address: string;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  badgeBalance?: number | null;
}

export async function sendDmLine(conversationId: string, me: BulkSender, content: string): Promise<void> {
  const tempId = dmSendQueue.sendText({ conversationId, userId: me.userId, address: me.address, content });
  const sent = await dmSendQueue.waitForDelivery(tempId);
  if (!sent) throw new Error("not sent");
}

export async function sendCommunityLine(communityId: string, me: BulkSender, content: string): Promise<void> {
  const wallet = me.address.toLowerCase();
  const { data, error } = await withWalletHeader(
    supabase.from("community_chat_messages").insert({
      community_id: communityId,
      wallet_address: wallet,
      username: me.username || null,
      display_name: me.displayName || null,
      avatar_url: me.avatarUrl || null,
      badge_balance: me.badgeBalance ?? null,
      content,
      message_type: "text",
      image_url: null,
      reply_to_id: null,
      reactions: {},
    } as any).select("id").single(),
    wallet,
  );
  if (error) throw error;
  const id = (data as { id?: string } | null)?.id;
  if (id) void reportCommunityChatMessage(communityId, id, wallet);
}

/** Sends to every target at once; resolves with how many it reached. */
export async function sendToMany(
  dmIds: string[],
  communityIds: string[],
  me: BulkSender,
  content: string,
): Promise<{ ok: number; total: number }> {
  const results = await Promise.allSettled([
    ...dmIds.map((id) => sendDmLine(id, me, content)),
    ...communityIds.map((id) => sendCommunityLine(id, me, content)),
  ]);
  return { ok: results.filter((r) => r.status === "fulfilled").length, total: results.length };
}
