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

export type StoryAudience = "everyone" | "followers";

export interface StoryMention {
  address: string;
  x: number;
  y: number;
  w: number;
  h: number;
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
  caption: string | null;
  mentions: StoryMention[];
  song: StorySong | null;
  audience: StoryAudience;
  allowReplies: boolean;
  createdAt: string;
  expiresAt: string;
  viewed: boolean;
  liked: boolean;
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
}

export interface StoryViewer {
  address: string;
  username: string | null;
  displayName: string | null;
  avatarImageUrl: string | null;
  liked: boolean;
  viewedAt: string;
}

const enc = encodeURIComponent;

export function getStoryShelf(signedIn: boolean): Promise<{ shelf: ShelfEntry[]; signedIn: boolean }> {
  // Signed out still gets public moments; the token is only sent when there is one.
  return apiClient.get("/stories/shelf", { isAuthRequired: signedIn, quiet: true });
}

export function getStory(id: string, signedIn: boolean): Promise<{ author: StoryAuthor | null; item: StoryItem }> {
  return apiClient.get(`/stories/${enc(id)}`, { isAuthRequired: signedIn, quiet: true });
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

export function getStoryViewers(id: string, cursor?: string): Promise<{ viewCount: number; likeCount: number; viewers: StoryViewer[]; next: string | null }> {
  return apiClient.get(`/stories/${enc(id)}/viewers`, cursor ? { params: { cursor } } : undefined);
}

export function reportStory(id: string, reason: string): Promise<unknown> {
  return apiClient.post(`/stories/${enc(id)}/report`, { reason });
}

export interface CreateStoryFields {
  audience: StoryAudience;
  allowReplies?: boolean;
  muted?: boolean;
  caption?: string;
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
  fd.append("type", fields.draftVideoId ? "video" : "photo");
  fd.append("audience", fields.audience);
  fd.append("allowReplies", String(fields.allowReplies !== false));
  fd.append("muted", String(!!fields.muted));
  if (fields.caption) fd.append("caption", fields.caption);
  if (fields.mentions?.length) fd.append("mentions", JSON.stringify(fields.mentions));
  if (fields.song) fd.append("song", JSON.stringify(fields.song));
  if (fields.draftVideoId) {
    fd.append("draftVideoId", fields.draftVideoId);
    if (fields.trimStart != null) fd.append("trimStart", String(fields.trimStart));
    if (fields.trimEnd != null) fd.append("trimEnd", String(fields.trimEnd));
  }
  // @ts-ignore React Native FormData file shape
  if (files.photo) fd.append("file", files.photo as any);
  // @ts-ignore React Native FormData file shape
  if (files.overlay) fd.append("overlay", files.overlay as any);
  return xhrUploadFormData<StoryItem>({ endpoint: "/stories", formData: fd, onProgress });
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
