/**
 * Collector features on minted posts: editions, owner-only extras, auctions,
 * the weekly drop and market stats. Same API as the web (riftn-backend src/collect).
 */
import env from "../config/env";
import { apiClient } from "../libs/api.client";
import { getAuthToken } from "../libs/auth.utils";

export interface RoyaltySplit { address: string; bps: number }

export interface EditionInfo {
  supply: number;
  royalties: RoyaltySplit[];
  royaltyBps: number;
  hasUnlockable: boolean;
  minted: boolean;
  creator: string | null;
  chainId: number | null;
  /** Made in the NFT market's Create tab, not a post. */
  nftOnly?: boolean;
}

export const DEFAULT_EDITION_SUPPLY = 1000;
export const MAX_EDITION_SUPPLY = 1_000_000_000;
export const MAX_ROYALTY_TOTAL_BPS = 1000;

export interface UnlockableFile {
  id: string;
  name: string;
  kind: "image" | "video" | "audio" | "file";
  size: number;
  mimeType: string;
  url: string | null;
}

export interface Unlockable {
  has: boolean;
  isCreator: boolean;
  canOpen: boolean;
  summary: { files: number; kinds: string[]; hasText: boolean };
  text: string | null;
  files: UnlockableFile[];
}

export interface ProfileLite { username: string | null; displayName: string | null; avatarImageUrl: string | null }

export interface Auction {
  id: string;
  chainId: number;
  contract: string;
  tokenId: string;
  amount: string;
  seller: string;
  currency: string;
  currencySymbol: string;
  currencyDecimals: number;
  startPrice: string;
  startsAt: string;
  endsAt: string;
  status: "live" | "ended" | "sold" | "cancelled";
  buyNowOrderHash: string | null;
  winner: string | null;
  soldPrice: string | null;
  nftName: string | null;
  nftImage: string | null;
  sellerProfile?: ProfileLite | null;
  bidCount?: number;
  topBid?: string | null;
  topBidder?: string | null;
  minimumBid?: string;
}

export interface AuctionBid {
  orderHash: string;
  maker: string;
  price: string;
  createdAt: string;
  endTime: string;
  makerProfile: ProfileLite | null;
}

export interface DropItem {
  tokenId: number;
  chainId: number;
  contract: string | null;
  name: string;
  image: string | null;
  creator: string | null;
  creatorProfile: ProfileLite | null;
  supply: number;
  minted: boolean;
  note: string | null;
  floor: { price: string; currencySymbol: string; currencyDecimals: number; orderHash: string } | null;
  auctionId: string | null;
}

export interface Drop {
  number: number;
  title: string;
  startsAt: string;
  endsAt: string;
  curated?: boolean;
  nextDropAt?: string;
  items: DropItem[];
}

export interface MarketStats {
  sales: number;
  volume: { symbol: string; amount: number }[];
  activeListings: number;
  liveAuctions: number;
  minted: number;
  collectors: number;
  topSellers: { address: string; profile: ProfileLite | null; sales: number }[];
}

const open = { isAuthRequired: false, quiet: true } as const;
const authed = { isAuthRequired: true } as const;

/** Signed in, the server can tell creators and owners apart. */
async function asViewer() {
  const token = await getAuthToken().catch(() => null);
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  return { ...open, headers };
}

/** An NFT you made in the market's Create tab. */
export interface Creation {
  tokenId: number;
  chainId: number;
  contract: string | null;
  name: string;
  image: string | null;
  postType: string | null;
  minted: boolean;
  /** Sent to the chain, waiting for it to land. */
  minting: boolean;
  supply: number;
  royaltyBps: number;
  createdAt: string | null;
}

export const collect = {
  creations: () => apiClient.fetch<{ items: Creation[] }>("/collect/creations", authed),
  editions: (tokenIds: (string | number)[]) =>
    apiClient.fetch<{ items: Record<string, EditionInfo> }>("/collect/editions", {
      ...open,
      params: { tokenIds: [...new Set(tokenIds.map(String))].slice(0, 100).join(",") },
    }),
  unlockable: async (tokenId: string | number) => apiClient.fetch<Unlockable>(`/collect/unlockable/${tokenId}`, await asViewer()),
  saveText: (tokenId: string | number, text: string) =>
    apiClient.fetch<Unlockable>(`/collect/unlockable/${tokenId}`, { ...authed, method: "PUT", body: { text } }),
  removeFile: (tokenId: string | number, fileId: string) =>
    apiClient.fetch<Unlockable>(`/collect/unlockable/${tokenId}/files/${fileId}`, { ...authed, method: "DELETE" }),
  auctions: (params: Record<string, string | number | undefined> = {}) =>
    apiClient.fetch<{ items: Auction[] }>("/market/auctions", { ...open, params }),
  auctionForNft: (chainId: number, contract: string, tokenId: string) =>
    apiClient.fetch<{ auction: Auction | null; bids: AuctionBid[] }>(`/market/auctions/nft/${chainId}/${contract.toLowerCase()}/${tokenId}`, open),
  startAuction: (body: {
    chainId: number; contract: string; tokenId: string; amount?: string; currency: string; startPrice: string;
    durationHours: number; nftName?: string | null; nftImage?: string | null;
  }) => apiClient.fetch<{ auction: Auction }>("/market/auctions", { ...authed, method: "POST", body }),
  cancelAuction: (id: string) => apiClient.fetch<{ auction: Auction }>(`/market/auctions/${id}/cancel`, { ...authed, method: "POST", body: {} }),
  bidPosted: (id: string, orderHash: string) =>
    apiClient.fetch<{ ok: boolean }>(`/market/auctions/${id}/bid`, { ...authed, method: "POST", body: { orderHash } }),
  settle: (id: string, orderHash: string) =>
    apiClient.fetch<{ auction: Auction }>(`/market/auctions/${id}/settle`, { ...authed, method: "POST", body: { orderHash } }),
  currentDrop: () => apiClient.fetch<Drop>("/market/drops/current", open),
  applyToDrop: (tokenId: number) =>
    apiClient.fetch<{ application: { tokenId: number; status: string } }>("/market/drops/apply", { ...authed, method: "POST", body: { tokenId, note: "" } }),
  myApplications: () =>
    apiClient.fetch<{ items: { tokenId: number; status: "pending" | "accepted" | "declined" }[] }>("/market/drops/applications/mine", { ...authed, quiet: true }),
  stats: () => apiClient.fetch<MarketStats>("/market/stats", open),
};

/** Creator adds a file owners can download (100 MB max). */
export async function uploadUnlockableFile(tokenId: string | number, file: { uri: string; name: string; mimeType?: string | null }): Promise<Unlockable> {
  const token = await getAuthToken();
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType || "application/octet-stream" } as unknown as Blob);
  const base = env.API_URL || "https://api.dehub.io/api";
  const res = await fetch(`${base}/collect/unlockable/${tokenId}/files`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || body?.message || `Upload failed (${res.status})`);
  return body as Unlockable;
}

/** "5%" or "2.5%" from basis points. */
export function bpsLabel(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}

/** "2d 4h", "3h 12m", "4m 09s": time left. */
export function timeLeft(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}
