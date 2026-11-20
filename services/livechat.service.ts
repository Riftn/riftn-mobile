import { apiClient } from "../libs/api.client";
import env from "../config/env";
import { getAuthToken } from "../libs/auth.utils";
import { translateCopy as _translateCopy } from '../i18n/copy';

/* ─── Types ─────────────────────────────────────────────────── */

export interface LiveChatUser {
  address: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  isModerator?: boolean;
  isBanned?: boolean;
  followers?: number;
  followings?: number;
  badgeBalance?: number;
  /** Grandfathered tier; most holders' badge comes from this, not the balance. */
  badgeLock?: { tier: string; requirement: number } | null;
  accountCreatedAt?: string;
  /** In a stream's chat: badges earned from that creator, and watch-time / chat milestones. */
  creatorBadges?: ChatCreatorBadge[];
}

/** A badge beside a name in one creator's stream chat. */
export interface ChatCreatorBadge {
  id: string;
  name: string;
  emoji: string;
  kind?: string;
  level?: number;
}

export interface LiveChatMessageReaction {
  [emoji: string]: string[]; // emoji → array of addresses
}

export interface LiveChatReplyTo {
  _id: string;
  id?: string;
  content?: string;
  senderAddress: string;
  senderUsername?: string;
  sender?: LiveChatUser;
  /** Set for a reply to a photo, GIF or voice note, which have no text to quote. */
  messageType?: string;
}

export interface LiveChatMessageData {
  _id: string;
  roomId: string;
  sender?: LiveChatUser;
  senderAddress: string;
  content: string;
  messageType: "text" | "media" | "gif" | "system" | "audio" | "voice";
  systemType?: "announcement" | "milestone";
  audioUrl?: string;
  audioDuration?: number;
  media?: {
    url: string;
    type: "image" | "gif";
    mimeType?: string;
    width?: number;
    height?: number;
    thumbnailUrl?: string;
  }[];
  gif?: {
    provider: "giphy" | "tenor";
    gifId: string;
    url: string;
    previewUrl: string;
    width: number;
    height: number;
  };
  replyTo?: LiveChatReplyTo;
  replyToContent?: string;
  replyToSenderAddress?: string;
  mentions?: { address: string; username?: string }[];
  reactions?: LiveChatMessageReaction;
  isPinned?: boolean;
  pinnedBy?: string;
  pinnedAt?: string;
  isDeleted?: boolean;
  deletedBy?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface LiveChatRoom {
  roomId: string;
  name: string;
  description?: string;
  isActive: boolean;
  messageCount: number;
  lastMessageAt?: string;
  slowMode: boolean;
  slowModeSeconds: number;
  minStakeRequired: number;
  moderators: string[];
  bannedUsers: string[];
  onlineCount?: number;
  pinnedMessages?: LiveChatMessageData[];
}

export interface LiveChatStatusResponse {
  isBanned: boolean;
  isModerator: boolean;
  canChat: boolean;
}

export interface LiveChatMessagesResponse {
  messages: LiveChatMessageData[];
  hasMore: boolean;
  /** Only on a page read around one message: newer lines exist past it. */
  hasNewer?: boolean;
}

/** Someone who has written in the room, as the chat search lists them. */
export interface LiveChatSearchPerson extends LiveChatUser {
  messageCount: number;
}

export interface LiveChatSearchResponse {
  messages: LiveChatMessageData[];
  people: LiveChatSearchPerson[];
  hasMore: boolean;
  /** How many lines match; sent with the first page only. */
  total: number | null;
  signInRequired?: boolean;
}

export interface LiveChatRoomJoinedPayload {
  room: LiveChatRoom;
  messages: LiveChatMessageData[];
  yourUser: LiveChatUser;
  isBanned: boolean;
  canSendMessages: boolean;
  onlineCount?: number;
}

export interface SendMessagePayload {
  content?: string;
  messageType?: "text" | "media" | "gif" | "audio" | "voice";
  audioUrl?: string;
  audioDuration?: number;
  media?: {
    url: string;
    type: "image" | "gif";
    mimeType?: string;
    width?: number;
    height?: number;
    thumbnailUrl?: string;
  }[];
  gif?: {
    provider: "giphy" | "tenor";
    gifId: string;
    url: string;
    previewUrl: string;
    width: number;
    height: number;
  };
  replyTo?: string;
  mentions?: { address: string; username?: string }[];
}

/* ─── REST API ──────────────────────────────────────────────── */

export async function getLiveChatRoom(): Promise<LiveChatRoom> {
  return apiClient.get<LiveChatRoom>("/livechat/room");
}

export async function getLiveChatMessages(params?: {
  before?: string;
  after?: string;
  limit?: number;
  /**
   * The room to page through. Left off, the backend answers with the global
   * platform room, so a stream's chat pulled public messages in under its own
   * as soon as anyone scrolled up.
   */
  roomId?: string;
  /** A message id: the page comes back centred on that line. */
  around?: string;
}): Promise<LiveChatMessagesResponse> {
  const qs = new URLSearchParams();
  if (params?.around) qs.set("around", params.around);
  if (params?.before) qs.set("before", params.before);
  if (params?.after) qs.set("after", params.after);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.roomId) qs.set("roomId", params.roomId);
  const query = qs.toString();
  return apiClient.get<LiveChatMessagesResponse>(
    `/livechat/messages${query ? `?${query}` : ""}`
  );
}

/**
 * Search a room's whole history on the server: by text, by the person who
 * wrote it, or both. Newest first; `before` reads the next page.
 */
export async function searchLiveChat(params: {
  q?: string;
  from?: string;
  before?: string;
  limit?: number;
  roomId?: string;
}): Promise<LiveChatSearchResponse> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.from) qs.set("from", params.from);
  if (params.before) qs.set("before", params.before);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.roomId) qs.set("roomId", params.roomId);
  return apiClient.get<LiveChatSearchResponse>(`/livechat/search?${qs.toString()}`);
}

export async function getLiveChatStatus(): Promise<LiveChatStatusResponse> {
  return apiClient.get<LiveChatStatusResponse>("/livechat/status");
}

export async function getLiveChatOnlineCount(): Promise<{ count: number }> {
  return apiClient.get<{ count: number }>("/livechat/online");
}

/* ─── Mod Actions ───────────────────────────────────────────── */

export async function getLiveChatUserProfile(address: string): Promise<LiveChatUser> {
  return apiClient.get<LiveChatUser>(`/livechat/user/${address}`);
}

export async function banUser(address: string): Promise<void> {
  return apiClient.post("/livechat/mod/ban", { address });
}

export async function unbanUser(address: string): Promise<void> {
  return apiClient.delete(`/livechat/mod/ban/${address}`);
}

export async function pinMessage(messageId: string): Promise<void> {
  return apiClient.post(`/livechat/mod/pin/${messageId}`, {});
}

export async function unpinMessage(messageId: string): Promise<void> {
  return apiClient.delete(`/livechat/mod/pin/${messageId}`);
}

export async function deleteMessage(messageId: string): Promise<void> {
  return apiClient.delete(`/livechat/mod/message/${messageId}`);
}

export async function uploadLiveChatVoice(
  fileUri: string,
  mimeType: string,
  fileName: string
): Promise<{ url: string; duration: number }> {
  const formData = new FormData();
  formData.append("audio", {
    uri: fileUri,
    name: fileName,
    type: mimeType,
  } as any);

  return apiClient.post<{ url: string; duration: number }>(
    "/livechat/upload-voice",
    formData
  );
}

/**
 * Upload an image for public chat.
 *
 * Goes to the same Supabase edge function web uses (`dm-upload-media`, see
 * dehubweb src/lib/api/dehub/dm.ts) rather than the Riftn API: livechat has no
 * upload route of its own for pictures, only for voice, and the bucket the
 * function writes to is what both clients already render from.
 *
 * A plain fetch rather than supabase.functions.invoke because the body is
 * multipart with a React Native file descriptor, and invoke() would set its own
 * content type over the boundary fetch generates.
 *
 * The function accepts jpeg, png, gif and webp up to 10 MB and nothing else —
 * video is rejected there as well as by the chat message type, so a picker that
 * offers it would be offering something no client can post.
 */
export async function uploadLiveChatImage(
  fileUri: string,
  mimeType: string,
  fileName: string,
  walletAddress: string,
): Promise<{ url: string }> {
  const token = await getAuthToken();
  if (!token) throw new Error(_translateCopy("copy.491fc91cd76e", { defaultValue: "Not signed in" }));

  const form = new FormData();
  form.append("file", { uri: fileUri, name: fileName, type: mimeType } as any);

  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/dm-upload-media`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
      "x-wallet-address": walletAddress.toLowerCase(),
      "x-dehub-token": token,
    },
    body: form,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok || !data?.url) {
    throw new Error(data?.error || _translateCopy("copy.6efc5d27f30b", { defaultValue: "Upload failed" }));
  }
  return { url: data.url as string };
}

// ─── A creator's moderation of their own stream chats ─────────────────────────
// The twin of dehubweb src/lib/api/dehub/livechat.ts. Never the platform chat.

/** Time someone out of this creator's stream chats. The creator, their moderators and staff only. */
export async function timeOutInStream(tokenId: string | number, address: string, seconds: number): Promise<void> {
  await apiClient.post(`/livechat/stream/${encodeURIComponent(String(tokenId))}/timeout`, { address: address.toLowerCase(), seconds }, { isAuthRequired: true });
}

/** Ban someone from every stream chat of this creator. */
export async function banFromStreams(tokenId: string | number, address: string): Promise<void> {
  await apiClient.post(`/livechat/stream/${encodeURIComponent(String(tokenId))}/ban`, { address: address.toLowerCase() }, { isAuthRequired: true });
}

export interface StreamModerationSettings {
  slowModeSeconds: number;
  followersOnly: boolean;
  subscribersOnly: boolean;
  bannedWords: string[];
  wordAction: "block" | "timeout";
}

export interface StreamModerationPerson {
  address: string;
  username?: string;
  displayName?: string;
  avatarImageUrl?: string;
}

export interface StreamModerationLogEntry {
  actor: string;
  target: string;
  action: "timeout" | "ban" | "unban" | "moderator-added" | "moderator-removed" | "word-blocked" | "word-timeout";
  seconds?: number;
  word?: string;
  at: string;
}

export interface MyStreamModeration {
  settings: StreamModerationSettings;
  moderators: StreamModerationPerson[];
  banned: StreamModerationPerson[];
  log: StreamModerationLogEntry[];
}

function myModeration(res: any): MyStreamModeration {
  const body = res?.result ?? res?.data ?? res;
  return {
    settings: {
      slowModeSeconds: Number(body?.settings?.slowModeSeconds) || 0,
      followersOnly: !!body?.settings?.followersOnly,
      subscribersOnly: !!body?.settings?.subscribersOnly,
      bannedWords: Array.isArray(body?.settings?.bannedWords) ? body.settings.bannedWords : [],
      wordAction: body?.settings?.wordAction === "timeout" ? "timeout" : "block",
    },
    moderators: Array.isArray(body?.moderators) ? body.moderators : [],
    banned: Array.isArray(body?.banned) ? body.banned : [],
    log: Array.isArray(body?.log) ? body.log : [],
  };
}

export async function getMyStreamModeration(): Promise<MyStreamModeration> {
  return myModeration(await apiClient.get<any>("/livechat/moderation/mine", { isAuthRequired: true }));
}

export async function saveMyStreamModeration(settings: StreamModerationSettings): Promise<MyStreamModeration> {
  return myModeration(await apiClient.put<any>("/livechat/moderation/mine", settings, { isAuthRequired: true }));
}

export async function addStreamModerator(address: string): Promise<MyStreamModeration> {
  return myModeration(await apiClient.post<any>("/livechat/moderation/mine/moderators", { address: address.toLowerCase() }, { isAuthRequired: true }));
}

export async function removeStreamModerator(address: string): Promise<MyStreamModeration> {
  return myModeration(await apiClient.delete<any>(`/livechat/moderation/mine/moderators/${address.toLowerCase()}`, { isAuthRequired: true }));
}

export async function unbanFromStreams(address: string): Promise<MyStreamModeration> {
  return myModeration(await apiClient.delete<any>(`/livechat/moderation/mine/bans/${address.toLowerCase()}`, { isAuthRequired: true }));
}

export interface ChatReactor {
  address: string;
  username?: string | null;
  displayName?: string | null;
  avatarImageUrl?: string | null;
  badgeBalance?: number;
  badgeLock?: { tier: string; requirement: number } | null;
  hideBadgeAndBalance?: boolean;
  /** Every reaction this person left on the line. */
  emojis: string[];
}

export interface ChatReactorsResponse {
  result: boolean;
  /** False for everyone but the person who wrote the line; `data` is then empty by design. */
  canViewLikers: boolean;
  data: ChatReactor[];
  /** People per reaction, across the whole line. */
  reactionCounts?: Record<string, number>;
  /** Everyone who reacted, whatever the emoji filter. */
  peopleCount?: number;
  anonymousBadgeHolderCount?: number;
  pagination?: { page: number; limit: number; totalCount: number; hasMore: boolean };
}

/** Who reacted to one of your own chat lines, newest first. */
export function getChatReactors(params: {
  messageId: string;
  emoji?: string;
  page?: number;
  limit?: number;
}): Promise<ChatReactorsResponse> {
  const qs = new URLSearchParams();
  if (params.emoji) qs.set("emoji", params.emoji);
  qs.set("page", String(params.page ?? 0));
  qs.set("limit", String(params.limit ?? 50));
  return apiClient.get<ChatReactorsResponse>(
    `/livechat/reactors/${encodeURIComponent(params.messageId)}?${qs.toString()}`,
    { isAuthRequired: true },
  );
}

// ── Stream chat bot (a creator's co-host in their own stream chat) ─────────

export type StreamBotPersonality = "chill" | "hype" | "funny" | "formal";
export type StreamBotChattiness = "quiet" | "normal" | "lots";

export interface StreamBotSettings {
  enabled: boolean;
  about: string;
  personality: StreamBotPersonality;
  chattiness: StreamBotChattiness;
  greet: boolean;
  answer: boolean;
  catchUp: boolean;
  wakeQuiet: boolean;
  commandButtons: boolean;
}

export interface StreamBotPublic {
  enabled: boolean;
  commandButtons: boolean;
  commands: Array<{ command: string; name: string }>;
}

export const STREAM_BOT_ABOUT_MAX = 600;

function streamBotSettings(res: any): StreamBotSettings {
  const s = (res?.result ?? res?.data ?? res)?.settings ?? {};
  const one = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  return {
    enabled: !!s.enabled,
    about: typeof s.about === "string" ? s.about : "",
    personality: one(s.personality, ["chill", "hype", "funny", "formal"] as const, "chill"),
    chattiness: one(s.chattiness, ["quiet", "normal", "lots"] as const, "normal"),
    greet: s.greet !== false,
    answer: s.answer !== false,
    catchUp: s.catchUp !== false,
    wakeQuiet: s.wakeQuiet !== false,
    commandButtons: s.commandButtons !== false,
  };
}

export async function getMyStreamBot(): Promise<StreamBotSettings> {
  return streamBotSettings(await apiClient.get<any>("/livechat/stream-bot/mine", { isAuthRequired: true }));
}

export async function saveMyStreamBot(settings: StreamBotSettings): Promise<StreamBotSettings> {
  return streamBotSettings(await apiClient.put<any>("/livechat/stream-bot/mine", { settings }, { isAuthRequired: true }));
}

/** Public: is this stream's bot on, and the creator's !commands for tap buttons above chat. */
export async function getStreamBot(tokenId: string | number): Promise<StreamBotPublic> {
  const res: any = await apiClient.get<any>(`/livechat/stream-bot/stream/${encodeURIComponent(String(tokenId))}`);
  const body = res?.result ?? res?.data ?? res;
  return {
    enabled: !!body?.enabled,
    commandButtons: !!body?.commandButtons,
    commands: Array.isArray(body?.commands)
      ? body.commands
          .filter((c: any) => typeof c?.command === "string" && c.command.startsWith("!"))
          .map((c: any) => ({ command: String(c.command).slice(0, 32), name: String(c.name || "") }))
      : [],
  };
}
