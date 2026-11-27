/**
 * Prepare a linked post for the Moment editor. Photos and stream covers can
 * be edited as pictures. Video Moments are cut from the original by the server.
 */
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "react-native";
import { getNFT } from "../../services/nft.service";
import { buildCdnPath, storedAvatarSources } from "../../libs/misc";
import { hasStreamEnded, isStreamLive } from "../../libs/live-status";
import { WEBSITE_LINK } from "../../config/links";

export interface PostMomentMedia {
  kind: "photo" | "video";
  uri: string;
  mimeType: string;
  width: number;
  height: number;
  duration: number;
  postTokenId: number;
  details: PostMomentDetails;
}

export interface PostMomentDetails {
  authorName?: string;
  avatarUrl?: string;
  title?: string;
  description?: string;
}

function firstText(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && !!value.trim())?.trim();
}

function postDetails(post: Record<string, any>): PostMomentDetails {
  const user = post.minterUser;
  const { uri } = storedAvatarSources(firstText(user?.avatarImageUrl, post.minterAvatarUrl), firstText(post.minter, user?.address), 28);
  const stream = post.postType === "live" ? post.stream : undefined;
  const title = firstText(stream?.title, post.title, post.name);
  const description = firstText(stream?.description, post.description);
  return {
    authorName: firstText(user?.displayName, post.minterDisplayName, post.minterUsername, user?.username, post.mintername),
    avatarUrl: uri ?? undefined,
    title,
    description: description === title ? undefined : description,
  };
}

export async function getPostMomentDetails(tokenId: number, signedIn: boolean): Promise<PostMomentDetails | null> {
  const { result: post } = await getNFT(tokenId, { allowAnonymous: !signedIn });
  if (!canShareToMoment(post) || post.isHidden || post.isDeleted || post.justMe || post.mediaPrivate) return null;
  return postDetails(post);
}

export class PostMomentError extends Error {
  constructor(public reason: "gated" | "kind" | "load") {
    super(reason);
  }
}

const PHOTO_TYPES = new Set(["feed-images", "image"]);
const VIDEO_TYPES = new Set(["video", "short"]);

/** Paid, held, subscriber-only and followers-only posts can't go on a public moment. */
export function isGatedPost(post: any): boolean {
  const info = (post?.streamInfo || {}) as Record<string, unknown>;
  const amount = Number(info.lockAmount ?? info.lockContentAmount);
  return !!info.isPayPerView
    || (!!info.isLockContent && Number.isFinite(amount) && amount > 0)
    || (Array.isArray(post?.plans) && post.plans.length > 0)
    || (!!post?.visibility && post.visibility !== "public");
}

/** Whether a public post's menu should offer "Share to Moment". */
export function canShareToMoment(post: any): boolean {
  if (!post || isGatedPost(post) || post.isPPV || post.isLocked) return false;
  const type = String(post.postType || "");
  if (type === "live") {
    const stream = post.stream;
    return !post.isHidden && !post.justMe && !post.mediaPrivate && !isGatedPost(stream)
      && (isStreamLive(stream) || hasStreamEnded(stream));
  }
  return VIDEO_TYPES.has(type) || (PHOTO_TYPES.has(type) && (post.imageUrls?.length > 0 || !!post.imageUrl));
}

const mediaUrl = (path: string) => (/^https?:\/\//i.test(path) ? path : buildCdnPath(
  path.replace(/^\/+/, "").replace(/^streams\/video\/(\d+)$/, "videos/$1").replace(/^(videos\/\d+)$/, "$1.mp4"),
));

export async function loadPostMoment(tokenId: number): Promise<PostMomentMedia> {
  const post: any = await getNFT(tokenId).then((r) => r.result).catch(() => null);
  if (!post) throw new PostMomentError("load");
  if (isGatedPost(post)) throw new PostMomentError("gated");
  const details = postDetails(post);
  const type = String(post.postType || "");
  if (type === "live") {
    if (!isStreamLive(post.stream) && !hasStreamEnded(post.stream)) throw new PostMomentError("load");
    if (!canShareToMoment(post)) throw new PostMomentError("gated");
    const cover = post.stream?.thumbnail || post.imageUrl;
    for (const src of [cover && mediaUrl(cover), `${WEBSITE_LINK}/og/live-studio.jpg`]) {
      if (!src) continue;
      const image = await downloadMomentPhoto(src, tokenId);
      if (image?.size) return { ...image.media, ...image.size, details };
    }
    throw new PostMomentError("load");
  }
  const w = Number(post.videoInfo?.w) || 1080;
  const h = Number(post.videoInfo?.h) || 1920;
  if (VIDEO_TYPES.has(type) && post.videoUrl) {
    const uri = mediaUrl(String(post.videoUrl));
    if (!uri) throw new PostMomentError("load");
    const duration = Number(post.videoDuration);
    return { kind: "video", uri, mimeType: "video/mp4", width: w, height: h, duration: Number.isFinite(duration) && duration > 0 ? duration : 0, postTokenId: tokenId, details };
  }
  // Photo posts' files live under feed-images/{filename}; the API's nfts/images/... path 403s.
  const listed = Array.isArray(post.imageUrls) && typeof post.imageUrls[0] === "string" ? String(post.imageUrls[0]) : "";
  const image = listed
    ? (/^https?:\/\//i.test(listed) ? listed : `feed-images/${listed.split("/").pop()}`)
    : PHOTO_TYPES.has(type) && post.imageUrl ? String(post.imageUrl) : "";
  if (PHOTO_TYPES.has(type) && image) {
    const src = mediaUrl(image);
    if (!src) throw new PostMomentError("load");
    const result = await downloadMomentPhoto(src, tokenId);
    if (!result) throw new PostMomentError("load");
    return { ...result.media, ...(result.size ?? { width: 1080, height: 1350 }), details };
  }
  throw new PostMomentError("kind");
}

async function downloadMomentPhoto(src: string, tokenId: number) {
  const ext = (/\.(png|webp|jpe?g|gif)(\?|$)/i.exec(src)?.[1] || "jpg").toLowerCase();
  const local = `${FileSystem.cacheDirectory}moment-post-${tokenId}-${Date.now()}.${ext}`;
  const dl = await FileSystem.downloadAsync(src, local).catch(() => null);
  if (!dl || dl.status >= 400) return null;
  const size = await new Promise<{ width: number; height: number } | null>((resolve) => {
    Image.getSize(dl.uri, (width, height) => resolve({ width, height }), () => resolve(null));
  });
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { media: { kind: "photo" as const, uri: dl.uri, mimeType, duration: 0, postTokenId: tokenId }, size };
}
