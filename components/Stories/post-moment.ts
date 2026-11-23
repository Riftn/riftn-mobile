/**
 * "Share to Moment": turn one of your own posts into what the moment editor
 * starts from. Photos are saved to the phone first (so text and stickers can
 * be drawn into them); videos play from the CDN and the server cuts the
 * moment from the post's own file. Same rules as web's post-moment.
 */
import * as FileSystem from "expo-file-system/legacy";
import { getNFT } from "../../services/nft.service";
import { buildCdnPath } from "../../libs/misc";

export interface PostMomentMedia {
  kind: "photo" | "video";
  uri: string;
  mimeType: string;
  width: number;
  height: number;
  duration: number;
  postTokenId: number;
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

/** Whether a post's menu should offer "Share to Moment" (the owner's public photo or video post). */
export function canShareToMoment(post: any): boolean {
  if (!post || isGatedPost(post) || post.isPPV || post.isLocked) return false;
  const type = String(post.postType || "");
  return VIDEO_TYPES.has(type) || (PHOTO_TYPES.has(type) && (post.imageUrls?.length > 0 || !!post.imageUrl));
}

const mediaUrl = (path: string) => (/^https?:\/\//i.test(path) ? path : buildCdnPath(
  path.replace(/^\/+/, "").replace(/^streams\/video\/(\d+)$/, "videos/$1").replace(/^(videos\/\d+)$/, "$1.mp4"),
));

export async function loadPostMoment(tokenId: number): Promise<PostMomentMedia> {
  const post: any = await getNFT(tokenId).then((r) => r.result).catch(() => null);
  if (!post) throw new PostMomentError("load");
  if (isGatedPost(post)) throw new PostMomentError("gated");
  const type = String(post.postType || "");
  const w = Number(post.videoInfo?.w) || 1080;
  const h = Number(post.videoInfo?.h) || 1920;
  if (VIDEO_TYPES.has(type) && post.videoUrl) {
    const uri = mediaUrl(String(post.videoUrl));
    if (!uri) throw new PostMomentError("load");
    const duration = Number(post.videoDuration);
    return { kind: "video", uri, mimeType: "video/mp4", width: w, height: h, duration: Number.isFinite(duration) && duration > 0 ? duration : 0, postTokenId: tokenId };
  }
  const image = (Array.isArray(post.imageUrls) && post.imageUrls[0]) || (PHOTO_TYPES.has(type) ? post.imageUrl : null);
  if (PHOTO_TYPES.has(type) && image) {
    const src = mediaUrl(String(image));
    if (!src) throw new PostMomentError("load");
    const ext = (/\.(png|webp|jpe?g|gif)(\?|$)/i.exec(src)?.[1] || "jpg").toLowerCase();
    const local = `${FileSystem.cacheDirectory}moment-post-${tokenId}-${Date.now()}.${ext}`;
    const dl = await FileSystem.downloadAsync(src, local).catch(() => null);
    if (!dl || dl.status >= 400) throw new PostMomentError("load");
    const size = await new Promise<{ width: number; height: number }>((resolve) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Image } = require("react-native") as typeof import("react-native");
      Image.getSize(dl.uri, (width, height) => resolve({ width, height }), () => resolve({ width: 1080, height: 1350 }));
    });
    return { kind: "photo", uri: dl.uri, mimeType: ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg", ...size, duration: 0, postTokenId: tokenId };
  }
  throw new PostMomentError("kind");
}
