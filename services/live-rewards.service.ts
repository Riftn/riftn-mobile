import { apiClient } from "../libs";

/**
 * Channel points on the stream API: a creator's rewards, a viewer's balance
 * with that creator, redeeming, and the creator's queue. Points come from
 * watching (a point a minute) and paid gifts; they have no money value and
 * cannot be bought, moved or cashed out.
 */

export const MAX_REWARDS = 12;
export const REWARD_TITLE_MAX = 60;
export const REWARD_TEXT_MAX = 200;
export const REWARD_COST_MAX = 1_000_000;

export interface LiveReward {
  id: string;
  title: string;
  cost: number;
  needsText: boolean;
  enabled: boolean;
}

export interface PointsBalance {
  creator: string;
  live: boolean;
  earned: number;
  spent: number;
  balance: number;
}

export interface Redemption {
  id: string;
  rewardId: string;
  title: string;
  cost: number;
  text: string;
  status: "pending" | "done" | "refunded";
  createdAt: string;
  viewer: { address: string; username?: string; displayName?: string; avatarImageUrl?: string };
}

const body = (res: any) => res?.result ?? res?.data ?? res;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function parseReward(raw: any): LiveReward | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.title !== "string") return null;
  return { id: raw.id, title: raw.title, cost: Math.max(0, Math.round(num(raw.cost))), needsText: !!raw.needsText, enabled: raw.enabled !== false };
}

const rewardList = (raw: any): LiveReward[] =>
  (Array.isArray(raw?.rewards) ? raw.rewards : []).map(parseReward).filter(Boolean) as LiveReward[];

export function parseRedemption(raw: any): Redemption | null {
  if (!raw || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    rewardId: String(raw.rewardId || ""),
    title: String(raw.title || ""),
    cost: num(raw.cost),
    text: String(raw.text || ""),
    status: raw.status === "done" || raw.status === "refunded" ? raw.status : "pending",
    createdAt: String(raw.createdAt || new Date().toISOString()),
    viewer: {
      address: String(raw.viewer?.address || ""),
      username: raw.viewer?.username || undefined,
      displayName: raw.viewer?.displayName || undefined,
      avatarImageUrl: raw.viewer?.avatarImageUrl || undefined,
    },
  };
}

function parseRecentRedemptions(value: unknown): Pick<Redemption, 'id' | 'title'>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(r => r && typeof r.id === 'string' && typeof r.title === 'string');
}

const streamPath = (streamId: string) => `/live-overlay/stream/${encodeURIComponent(streamId)}`;

export async function getStreamRewards(streamId: string) {
  const res = body(await apiClient.get<any>(`${streamPath(streamId)}/rewards`, { isAuthRequired: false }));
  return { creator: String(res?.creator || ""), live: !!res?.live, rewards: rewardList(res), recentRedemptions: parseRecentRedemptions(res?.recentRedemptions) };
}

export async function getMyStreamPoints(streamId: string): Promise<PointsBalance> {
  const res = body(await apiClient.get<any>(`${streamPath(streamId)}/points/me`, { isAuthRequired: true }));
  return { creator: String(res?.creator || ""), live: !!res?.live, earned: num(res?.earned), spent: num(res?.spent), balance: num(res?.balance) };
}

export async function redeemReward(streamId: string, rewardId: string, text?: string): Promise<{ redemption: Redemption | null; balance: number }> {
  const res = body(
    await apiClient.post<any>(`${streamPath(streamId)}/rewards/redeem`, { rewardId, ...(text ? { text } : {}) }, { isAuthRequired: true }),
  );
  return { redemption: parseRedemption(res?.redemption), balance: num(res?.balance) };
}

export async function getMyRewards(): Promise<LiveReward[]> {
  return rewardList(body(await apiClient.get<any>("/live-overlay/mine/rewards", { isAuthRequired: true })));
}

export async function saveMyRewards(rewards: LiveReward[]): Promise<LiveReward[]> {
  return rewardList(body(await apiClient.put<any>("/live-overlay/mine/rewards", { rewards }, { isAuthRequired: true })));
}

export async function getMyRedemptions(): Promise<Redemption[]> {
  const res = body(await apiClient.get<any>("/live-overlay/mine/redemptions", { isAuthRequired: true }));
  return (Array.isArray(res?.redemptions) ? res.redemptions : []).map(parseRedemption).filter(Boolean) as Redemption[];
}

export async function settleRedemption(id: string, action: "done" | "refund"): Promise<Redemption | null> {
  const res = body(await apiClient.post<any>(`/live-overlay/mine/redemptions/${encodeURIComponent(id)}/${action}`, {}, { isAuthRequired: true }));
  return parseRedemption(res?.redemption);
}

/** The server's reason for a refused redeem, as a copy key. */
export function redeemErrorKey(err: unknown): string {
  const message = String((err as Error)?.message || "");
  if (/not enough points/i.test(message)) return "livePoints.notEnough";
  if (/while the stream is live/i.test(message)) return "livePoints.notLive";
  if (/few seconds/i.test(message)) return "livePoints.tooFast";
  if (/no longer available/i.test(message)) return "livePoints.gone";
  if (/add a message/i.test(message)) return "livePoints.needsText";
  return "livePoints.redeemFailed";
}

/** 1240 -> "1.2K" for the small button; the sheet shows the full number. */
export function compactPoints(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
