/**
 * "Catch me up" in group, channel and community chats (same as web).
 * ==================================================================
 * Asks the Riftn API (backend community-recap.service.ts) for a private recap
 * of the chat: main topics, decisions and announcements, links shared and
 * everything that mentions or replies to you. It lands in your DMs from
 * @assistant. Nothing is posted in the group.
 */
import { apiClient } from "./api.client";
import { ensureWalletSession } from "./wallet-session";

export type CatchUpPeriod = "24h" | "3d" | "unread";

export interface CatchUpResult {
  sent: boolean;
  count: number;
  window: string;
  conversationId?: string;
}

/** A typed "catch me up" (or "catch me up on the last 3 days"): never posted, sent as a recap request. */
export function isCatchUpCommand(text: string): boolean {
  return /^\s*\/?catch\s*me\s*up\b/i.test(text) && text.trim().length <= 80;
}

export async function requestCatchUp(input: {
  communityId: string;
  walletAddress: string;
  period?: CatchUpPeriod;
  text?: string;
  lang?: string;
}): Promise<CatchUpResult> {
  const session = await ensureWalletSession(input.walletAddress.toLowerCase());
  if (!session) throw new Error("no session");
  const result = await apiClient.post<CatchUpResult>(
    "/community-chat/recap",
    {
      communityId: input.communityId,
      walletSession: session.token,
      ...(input.text ? { text: input.text } : { period: input.period ?? "24h" }),
      tzOffset: new Date().getTimezoneOffset(),
      ...(input.lang ? { lang: input.lang } : {}),
    },
    { isAuthRequired: true, timeoutMs: 60_000 },
  );
  return {
    sent: !!result?.sent,
    count: Number(result?.count) || 0,
    window: String(result?.window || ""),
    conversationId: result?.conversationId,
  };
}
