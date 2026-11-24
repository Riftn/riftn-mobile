import { apiClient } from "../libs";

/** A post of yours still waiting for its time (GET /api/scheduled_posts). */
export interface ScheduledPost {
  tokenId: number;
  name?: string;
  description?: string;
  postType?: string;
  imageUrl?: string;
  imageUrls?: string[];
  scheduledAt: string;
}

export async function getMyScheduledPosts(): Promise<ScheduledPost[]> {
  const res = await apiClient.get<{ result: ScheduledPost[] }>("/scheduled_posts", { isAuthRequired: true });
  return res?.result || [];
}

/** Move a scheduled post, or pass "now" to publish it within a minute. */
export async function moveScheduledPost(tokenId: number, at: Date | "now"): Promise<void> {
  await apiClient.patch(`/scheduled_posts/${tokenId}`, { scheduledAt: at === "now" ? "now" : at.toISOString() }, { isAuthRequired: true });
}

export async function moveScheduledLive(streamId: string, at: Date): Promise<void> {
  await apiClient.patch(`/scheduled_posts/live/${encodeURIComponent(streamId)}`, { scheduledAt: at.toISOString() }, { isAuthRequired: true });
}

export interface FansOnline {
  /** 7 x 24, UTC, Sunday first: distinct people watching in each hour. */
  grid: number[][];
  /** "everyone" when the account had too few active followers to go on. */
  basis: "followers" | "everyone";
  followers: number;
  days: number;
}

export async function getFansOnline(): Promise<FansOnline | null> {
  const res = await apiClient.get<{ result: FansOnline }>("/scheduled_posts/fans_online", { isAuthRequired: true });
  return res?.result ?? null;
}

/** "Space my posts": the saved gap and when a post made now would go out. */
export interface PostSpacing {
  /** Saved gap in minutes; 0 is off. */
  gapMinutes: number;
  /** When a post made now goes out; null is straight away. */
  nextAt: string | null;
  /** Posts still waiting to go out. */
  waiting: number;
}

/** The gaps the server accepts, in minutes. */
export const SPACING_CHOICES = [30, 60, 180, 360, 1440] as const;

export async function getPostSpacing(): Promise<PostSpacing> {
  const res = await apiClient.get<{ result: PostSpacing }>("/scheduled_posts/spacing", { isAuthRequired: true });
  return res?.result ?? { gapMinutes: 0, nextAt: null, waiting: 0 };
}

export async function savePostSpacing(gapMinutes: number): Promise<PostSpacing> {
  const res = await apiClient.put<{ result: PostSpacing }>("/scheduled_posts/spacing", { gapMinutes }, { isAuthRequired: true });
  return res?.result ?? { gapMinutes, nextAt: null, waiting: 0 };
}
