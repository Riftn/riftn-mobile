import { apiClient } from "../libs/api.client";

/**
 * App tokens: DHB held as a balance on Riftn instead of on a chain. Everyone
 * opened with the DHB they held and staked at launch; after that only in-app
 * moves change it. Sending one never touches a chain. Mirrors web
 * src/lib/api/dehub/app-tokens.ts.
 */

export interface AppTokensConfig {
  enabled: boolean;
  symbol: string;
  deposits: boolean;
  staking?: boolean;
}

export interface AppTokenPerson {
  address: string;
  username?: string;
  displayName?: string;
  avatarImageUrl?: string;
}

export interface AppTokenEntry {
  kind: "opening" | "send" | "receive" | "spend" | "refund" | "deposit" | "adjust" | "stake" | "unstake";
  /** Signed decimal string: "-12.5" left, "12.5" arrived. */
  amount: string;
  purpose?: string;
  note?: string;
  counterparty?: AppTokenPerson;
  at: string;
}

export interface AppTokensAccount {
  symbol: string;
  balance: string;
  staked?: string;
  entries: AppTokenEntry[];
}

export interface AppTokenPreviewData {
  balance: string;
  fanSiteCredit: string | null;
  credits: Pick<AppTokenEntry, "kind" | "amount" | "counterparty" | "at">[];
}

export function getAppTokenPreview(): Promise<AppTokenPreviewData> {
  return apiClient.get<AppTokenPreviewData>("/app-tokens/preview");
}

export interface AppTokenStakeRequest {
  direction: "stake" | "unstake";
  amount: string;
  key: string;
}

export interface AppTokenStakeResult {
  ok: true;
  balance: string;
  staked: string;
}

export function moveAppTokenStake(input: AppTokenStakeRequest): Promise<AppTokenStakeResult> {
  return apiClient.post("/app-tokens/staking", input);
}

export function getAppTokensConfig(): Promise<AppTokensConfig> {
  return apiClient.fetch<AppTokensConfig>("/app-tokens/config", { isAuthRequired: false, quiet: true });
}

export function getMyAppTokens(): Promise<AppTokensAccount> {
  return apiClient.get<AppTokensAccount>("/app-tokens/me");
}

export function findAppTokenRecipient(to: string): Promise<AppTokenPerson> {
  return apiClient.fetch<AppTokenPerson>("/app-tokens/recipient", { params: { to }, quiet: true });
}

/** `key` is made once per attempt and reused on a retry, so a retry never sends twice. */
export function sendAppTokens(input: {
  to: string; amount: string; key: string; purpose?: string; ref?: string; note?: string;
}): Promise<{ ok: true; balance: string; to: AppTokenPerson }> {
  return apiClient.post("/app-tokens/send", input);
}

/**
 * Tip a post, a comment or a profile from the app balance. The server picks
 * who is paid (post creator, comment author); `to` only counts for a profile
 * tip. Same `key` on a retry, so a tip is never paid twice.
 */
export function tipWithAppTokens(input: {
  tokenId?: string; commentId?: string; to?: string; amount: string; key: string;
}): Promise<{ ok: true; balance: string; amount: string; to: string; receipt: string }> {
  return apiClient.post("/app-tokens/tip", input);
}

/** A DHB number as the exact decimal string the server reads (up to 6 decimals). */
export function toTokenAmount(value: number): string {
  return (Math.floor(value * 1e6) / 1e6).toFixed(6).replace(/\.?0+$/, "");
}

export function newAppTokenKey(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
