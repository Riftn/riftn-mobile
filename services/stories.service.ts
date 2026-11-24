/**
 * Moments: a photo (5 s) or a video (up to 60 s) that stays up for 24 hours
 * on the Glass Shelf above the home feed. Same API as web's
 * `lib/api/dehub/stories`. Anyone can watch public moments, signed out too;
 * moments are not posts (no feed, no allowance, no points).
 *
 * A video moment is uploaded first as a composer draft (postType "short"),
 * then shared with its draftVideoId; the server cuts it and the moment turns
 * `ready` a few seconds later.
 */
import { apiClient } from "../libs";
import { xhrUploadFormData } from "../libs/xhr-upload";
import { ResumableUnsupportedError, resumableUploadFile } from "../libs/resumable-upload";

export type StoryAudience = "everyone" | "followers" | "selected" | "except" | "close_friends";
export const STORY_LIFETIMES = [6, 12, 24] as const;
export type StoryLifetime = (typeof STORY_LIFETIMES)[number];

export interface StoryMention {
  address: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Dragged off the picture in the editor: no tap target. */
  hidden?: boolean;
}

export interface StorySong {
  title: string;
  artist?: string;
  audioUrl: string;
  artworkUrl?: string;
  startMs: number;
  source?: string;
}

export interface StoryAuthor {
  address: string;
  username: string | null;
  displayName: string | null;
  avatarImageUrl: string | null;
}

export interface StoryItem {
  id: string;
  address: string;
  type: "photo" | "video";
  status: "processing" | "ready" | "failed";
  mediaUrl: string | null;
  posterUrl: string | null;
  overlayUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number;
  muted: boolean;
  isMature?: boolean;
  caption: string | null;
  remixSourceId?: string | null;
  /** Shared from this post ("Share to Moment"): viewers get "Go to post". */
  postTokenId?: number | null;
  /** Someone else's post shared to this moment: their handle, for the credit. */
  postAuthorName?: string | null;
  shareable?: boolean;
  mentions: StoryMention[];
  song: StorySong | null;
  audience: StoryAudience;
  /** Posted to the author's Close Friends: green ring and star label. */
  closeFriends?: boolean;
  allowReplies: boolean;
  createdAt: string;
  expiresAt: string;
  viewed: boolean;
  liked: boolean;
  /** Public comments (older servers leave it out). */
  commentCount?: number;
  viewCount?: number;
  likeCount?: number;
  replyCount?: number;
  error?: string | null;
  expired?: boolean;
}

export interface ShelfEntry {
  author: StoryAuthor;
  own: boolean;
  following: boolean;
  seen: boolean;
  latestAt: string | null;
  items: StoryItem[];
  /** One of their Moments up for you is a Close Friends one (green ring). */
  closeFriends?: boolean;
}

export interface StoryViewer {
  address: string;
  username: string | null;
  displayName: string | null;
  avatarImageUrl: string | null;
  liked: boolean;
  /** How many times this person watched it (newer servers). */
  plays?: number;
  viewedAt: string;
}

const enc = encodeURIComponent;

export function getStoryShelf(signedIn: boolean, liveHosts: string): Promise<{ shelf: ShelfEntry[]; signedIn: boolean; liveHosts?: string[]; supportsCustomLifetime?: boolean; supportsPhotoDuration?: boolean; supportsCustomAudience?: boolean }> {
  // Signed out still gets public moments; the token is only sent when there is one.
  return apiClient.get("/stories/shelf", {
    isAuthRequired: signedIn,
    quiet: true,
    params: liveHosts ? { liveHosts } : undefined,
  });
}

/** A Moment mark for one face: whether it's all watched, how many are up, and the picture shown on the face. */
export interface MomentPeek {
  state: "unseen" | "seen";
  count: number;
  cover: string | null;
  /** A Close Friends Moment of theirs is up for you: the rim turns green. */
  closeFriends?: boolean;
}

export function getStoryRings(addresses: string[], signedIn: boolean): Promise<{ rings: Record<string, "unseen" | "seen">; peeks?: Record<string, MomentPeek>; closeFriends?: Record<string, true> }> {
  return apiClient.get("/stories/rings", { isAuthRequired: signedIn, quiet: true, params: { addresses: addresses.join(",") } });
}

/** Your Close Friends list: the people who see your Close Friends Moments. */
export function getCloseFriends(): Promise<{ friends: StoryAuthor[] }> {
  return apiClient.get("/stories/close-friends", { quiet: true });
}

/** Replace your Close Friends list (up to 500). Moments already up follow the change. */
export function setCloseFriends(addresses: string[]): Promise<{ friends: StoryAuthor[] }> {
  return apiClient.put("/stories/close-friends", { addresses });
}

export function getUserStories(address: string, signedIn: boolean): Promise<{ author: StoryAuthor | null; items: StoryItem[] }> {
  return apiClient.get(`/stories/user/${enc(address.toLowerCase())}`, { isAuthRequired: signedIn, quiet: true });
}

export function getStory(id: string, signedIn: boolean): Promise<{ author: StoryAuthor | null; item: StoryItem }> {
  return apiClient.get(`/stories/${enc(id)}`, { isAuthRequired: signedIn, quiet: true });
}

export function getStoryArchive(cursor?: string): Promise<{ items: StoryItem[]; next: string | null }> {
  return apiClient.get("/stories/archive", { isAuthRequired: true, quiet: true, params: { cursor } });
}

export function deleteStory(id: string): Promise<{ ok: boolean }> {
  return apiClient.delete(`/stories/${enc(id)}`);
}

export function markStoryViewed(id: string): Promise<unknown> {
  return apiClient.post(`/stories/${enc(id)}/view`, {}, { quiet: true });
}

export function likeStory(id: string, liked: boolean): Promise<{ liked: boolean; likeCount?: number }> {
  return apiClient.post(`/stories/${enc(id)}/like`, { liked });
}

/** Checks a reply is allowed and counts it; the reply itself is a DM. */
export function checkStoryReply(id: string): Promise<{ ok: boolean; to: string }> {
  return apiClient.post(`/stories/${enc(id)}/reply`, {});
}

export function getStoryViewers(id: string, cursor?: string): Promise<{ viewCount: number; playCount?: number; likeCount: number; viewers: StoryViewer[]; next: string | null }> {
  return apiClient.get(`/stories/${enc(id)}/viewers`, cursor ? { params: { cursor } } : undefined);
}

export function reportStory(id: string, reason: string): Promise<unknown> {
  return apiClient.post(`/stories/${enc(id)}/report`, { reason });
}

export interface CreateStoryFields {
  audience: StoryAudience;
  audienceAddresses?: string[];
  expiresInHours?: StoryLifetime;
  photoDurationSeconds?: number;
  allowReplies?: boolean;
  muted?: boolean;
  caption?: string;
  remixSourceId?: string;
  /** One of your own photo or video posts. A video post sends no clip: the server cuts it from the post. */
  postTokenId?: number;
  type?: "photo" | "video";
  mentions?: StoryMention[];
  song?: StorySong | null;
  draftVideoId?: string;
  trimStart?: number;
  trimEnd?: number;
}

type LocalFile = { uri: string; name: string; type: string };

export function createStory(
  fields: CreateStoryFields,
  files: { photo?: LocalFile | null; overlay?: LocalFile | null },
  onProgress?: (fraction: number) => void,
): Promise<StoryItem> {
  const fd = new FormData();
  fd.append("type", fields.type ?? (fields.draftVideoId ? "video" : "photo"));
  fd.append("audience", fields.audience);
  const customAudience = fields.audience === "selected" || fields.audience === "except" || fields.audience === "close_friends";
  if (fields.audience === "selected" || fields.audience === "except") fd.append("audienceAddresses", JSON.stringify(fields.audienceAddresses ?? []));
  if (fields.photoDurationSeconds != null) fd.append("photoDurationSeconds", String(fields.photoDurationSeconds));
  if (fields.expiresInHours != null) fd.append("expiresInHours", String(fields.expiresInHours));
  fd.append("allowReplies", String(fields.allowReplies !== false));
  fd.append("muted", String(!!fields.muted));
  if (fields.caption) fd.append("caption", fields.caption);
  if (fields.remixSourceId) fd.append("remixSourceId", fields.remixSourceId);
  if (fields.postTokenId != null) fd.append("postTokenId", String(fields.postTokenId));
  if (fields.mentions?.length) fd.append("mentions", JSON.stringify(fields.mentions));
  if (fields.song) fd.append("song", JSON.stringify(fields.song));
  if (fields.draftVideoId || (fields.type === "video" && fields.postTokenId != null)) {
    if (fields.draftVideoId) fd.append("draftVideoId", fields.draftVideoId);
    if (fields.trimStart != null) fd.append("trimStart", String(fields.trimStart));
    if (fields.trimEnd != null) fd.append("trimEnd", String(fields.trimEnd));
  }
  // @ts-ignore React Native FormData file shape
  if (files.photo) fd.append("file", files.photo as any);
  // @ts-ignore React Native FormData file shape
  if (files.overlay) fd.append("overlay", files.overlay as any);
  return xhrUploadFormData<StoryItem>({ endpoint: customAudience ? "/stories/custom-audience" : "/stories", formData: fd, onProgress });
}

/** Send a clip as a short draft; resolves with its draft id. */
export async function uploadStoryClip(
  media: { uri: string; name: string; mimeType: string },
  onProgress: (fraction: number) => void,
): Promise<string> {
  let res: any;
  try {
    res = await resumableUploadFile<any>({
      endpoint: "/draft_video/resumable",
      uri: media.uri,
      name: media.name,
      mimeType: media.mimeType,
      metadata: { postType: "short" },
      onProgress,
    });
  } catch (e) {
    if (!(e instanceof ResumableUnsupportedError)) throw e;
    const fd = new FormData();
    fd.append("postType", "short");
    // @ts-ignore React Native FormData file shape
    fd.append("file", { uri: media.uri, name: media.name, type: media.mimeType } as any);
    res = await xhrUploadFormData<any>({ endpoint: "/draft_video", formData: fd, onProgress });
  }
  const draftId = res?.draftId ?? res?.result?.draftId;
  if (!draftId) throw new Error("upload failed");
  return String(draftId);
}

export interface StoryComment {
  id: string;
  text: string;
  createdAt: string;
  author: StoryAuthor;
  canDelete: boolean;
  /** Set on a reply: the comment it sits under. */
  parentId?: string | null;
  /** Written by the moment's owner. */
  isCreator?: boolean;
  /** With `threaded`, a top comment's replies, oldest first. */
  replies?: StoryComment[];
}

export function getStoryComments(id: string, signedIn: boolean, cursor?: string, threaded = false): Promise<{ commentCount: number; allowComments: boolean; comments: StoryComment[]; next: string | null }> {
  const params = { ...(cursor ? { cursor } : {}), ...(threaded ? { threaded: "1" } : {}) };
  return apiClient.get(`/stories/${enc(id)}/comments`, { isAuthRequired: signedIn, quiet: true, ...(Object.keys(params).length ? { params } : {}) });
}

export function addStoryComment(id: string, text: string, parentId?: string): Promise<StoryComment> {
  return apiClient.post(`/stories/${enc(id)}/comments`, parentId ? { text, parentId } : { text });
}

export function deleteStoryComment(id: string, commentId: string): Promise<{ ok: boolean }> {
  return apiClient.delete(`/stories/${enc(id)}/comments/${enc(commentId)}`);
}
