/**
 * Badge Museum data for a profile: every milestone step with where the person
 * stands. Worked out on the server from stats it already keeps and cached
 * there for a few minutes. Twin of web's src/hooks/use-milestones.ts.
 *
 * `env.API_URL` already ends in `/api`, so the path here has no prefix.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../libs/api.client";

export type MilestoneKind = "views" | "videos" | "followers" | "likes" | "lives" | "liveHours";

export interface Milestone {
  id: string;
  kind: MilestoneKind;
  goal: number;
  /** Higher is rarer. */
  rarity: number;
  value: number;
  earned: boolean;
}

export interface Milestones {
  address: string;
  milestones: Milestone[];
  /** Up to three earned ids for the profile header, rarest first. */
  top: string[];
  earned: number;
  total: number;
  /**
   * The museum is off (the default until the owner switches it on). Other
   * viewers then get no badges; the owner still gets everything, with this
   * set, so Settings can show it while the profile shows nothing.
   */
  hidden?: boolean;
  updatedAt: string;
}

/** Profile setting in `customs`: `public`, or `hidden` (also when absent). */
export const BADGE_MUSEUM_VISIBILITY_KEY = "badgeMuseumVisibility";

/** Whether the Badge Museum is on this account's profile. Off until switched on. */
export function badgeMuseumIsShown(customs: Record<string, unknown> | null | undefined): boolean {
  return customs?.[BADGE_MUSEUM_VISIBILITY_KEY] === "public";
}

/** Earned badges, rarest first. */
export function earnedByRarity(milestones: Milestone[]): Milestone[] {
  return milestones.filter((m) => m.earned).sort((a, b) => b.rarity - a.rarity);
}

export function useMilestones(address?: string | null) {
  return useQuery({
    queryKey: ["profile-milestones", address?.toLowerCase()],
    queryFn: async (): Promise<Milestones | null> => {
      try {
        const res = await apiClient.get<{ result?: Milestones }>(
          `/users/${encodeURIComponent(String(address))}/milestones`,
          { quiet: true },
        );
        return res?.result ?? null;
      } catch (error) {
        if ((error as { status?: number })?.status === 404) return null;
        throw error;
      }
    },
    enabled: !!address,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}
