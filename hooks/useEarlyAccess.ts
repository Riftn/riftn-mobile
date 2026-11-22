/**
 * Early access hooks (mobile)
 * ===========================
 * Twin of web src/hooks/use-early-access.ts. A feature built from a request
 * can ship with a one-day head start for the person who asked for it; see
 * libs/early-access.ts for who sees what.
 */
import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { UserContext } from "../context/AuthContext";
import { isFeatureStatusEditor } from "./useFeatureRequests";
import {
  EARLY_ACCESS_OWNER_WALLETS,
  earlyAccessOpen,
  posterFilter,
  type EarlyAccessRow,
  type EarlyAccessViewer,
} from "../libs/early-access";

/** The signed-in person, or nobody. Safe outside the auth providers. */
export function useEarlyAccessViewer(): EarlyAccessViewer {
  const ctx = useContext(UserContext) as { user?: any } | undefined;
  const user = ctx?.user ?? null;
  const wallet = ((user?.walletAddress || user?.address || null) as string | null)?.toLowerCase() ?? null;
  return {
    wallet,
    username: user?.username ?? null,
    isOwner: isFeatureStatusEditor(wallet) || (!!wallet && EARLY_ACCESS_OWNER_WALLETS.includes(wallet)),
  };
}

/** Whether the signed-in person may see a feature with a poster head start. */
export function useEarlyAccess(requestId: string, openBy: string): boolean {
  const viewer = useEarlyAccessViewer();
  const past = Date.now() >= Date.parse(openBy);
  const { data, isError } = useQuery({
    queryKey: ["feature-early-access", requestId],
    enabled: !past,
    queryFn: async (): Promise<EarlyAccessRow | null> => {
      const { data: row, error } = await supabase
        .from("feature_requests")
        .select("id,author_wallet_address,author_username,status,early_access_until")
        .eq("id", requestId)
        .maybeSingle();
      if (error) throw error;
      return (row as EarlyAccessRow | null) ?? null;
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return earlyAccessOpen(isError ? null : data, viewer, openBy);
}

export interface EarlySupporter {
  shipped: number;
  latestId: string | null;
}

/** Shipped requests by this person: the Early supporter chip's data. */
export function useEarlySupporter(wallet?: string | null, username?: string | null, enabled = true) {
  const filter = wallet ? posterFilter(wallet, username) : null;
  return useQuery({
    queryKey: ["early-supporter", filter],
    enabled: enabled && !!filter,
    queryFn: async (): Promise<EarlySupporter> => {
      const { data, count, error } = await supabase
        .from("feature_requests")
        .select("id", { count: "exact" })
        .in("status", ["shipped", "completed"])
        .or(filter!)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return { shipped: count ?? data?.length ?? 0, latestId: (data?.[0] as { id?: string } | undefined)?.id ?? null };
    },
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
  });
}
