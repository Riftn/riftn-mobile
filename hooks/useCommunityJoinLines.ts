import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";
import { withWalletHeader } from "../libs/supabase-wallet-client";
import { getAccountSummaries, type AccountSummary } from "../services/user.service";

/**
 * "Name joined" lines for a group chat. Nothing is written to the chat table:
 * the lines come from community_members, so channels (where members can't
 * post) and slow mode don't get in the way, and old joins never fill the feed.
 */
export interface JoinLine {
  wallet: string;
  name: string;
  joinedAt: string;
}

const LIMIT = 30;
const REFRESH_MS = 60_000;

export function useCommunityJoinLines(
  communityId: string | undefined,
  viewer: string | undefined,
  enabled: boolean,
): JoinLine[] {
  const [lines, setLines] = useState<JoinLine[]>([]);

  useEffect(() => {
    if (!communityId || !enabled) return;
    let cancelled = false;

    const load = async () => {
      try {
        const { data, error } = await withWalletHeader(
          supabase
            .from("community_members")
            .select("wallet_address, role, joined_at")
            .eq("community_id", communityId)
            .eq("status", "active")
            .neq("role", "owner")
            .order("joined_at", { ascending: false })
            .limit(LIMIT),
          viewer as any,
        );
        if (error || !data || cancelled) return;
        const rows = (data as { wallet_address: string; joined_at: string }[]).filter((r) => r.wallet_address && r.joined_at);
        const people: AccountSummary[] = await getAccountSummaries(rows.map((r) => r.wallet_address)).catch(() => []);
        if (cancelled) return;
        const byAddress = new Map<string, AccountSummary>(people.map((p) => [p.address?.toLowerCase() ?? "", p]));
        setLines(
          rows.map((r) => {
            const p = byAddress.get(r.wallet_address.toLowerCase());
            return {
              wallet: r.wallet_address.toLowerCase(),
              name: p?.displayName || p?.username || `${r.wallet_address.slice(0, 6)}…${r.wallet_address.slice(-4)}`,
              joinedAt: r.joined_at,
            };
          }),
        );
      } catch {
        // A missing line is harmless; the chat itself still works.
      }
    };

    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    const chan = supabase
      .channel(`community-joins-${communityId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "community_members", filter: `community_id=eq.${communityId}` },
        () => void load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(timer);
      void supabase.removeChannel(chan);
    };
  }, [communityId, viewer, enabled]);

  return lines;
}
