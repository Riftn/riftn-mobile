/**
 * The post behind an open photo viewer.
 *
 * The viewer is its own screen, pushed over the card that opened it, so the
 * card's state (reaction, saved, counts) and its handlers have to reach it
 * some other way than props. The card registers a getter under a key it
 * hands the viewer in the route params; every render of the card pings the
 * key, and the viewer re-reads the getter. Nothing is built or sent while no
 * viewer is listening, so a feed full of cards pays one Map write each.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { PostReaction, ReactionCounts } from "./reactions";

export interface PhotoViewerPost {
  tokenId: number | string;
  avatarUrl?: string;
  displayName: string;
  username?: string;
  address?: string;
  isOwnPost: boolean;
  caption: string;
  liked: boolean;
  disliked: boolean;
  saved: boolean;
  reposted: boolean;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  repostCount: number;
  shareCount?: number;
  tipCount: number;
  myReaction: PostReaction | null;
  reactionCounts: ReactionCounts | null;
  viewerAddress?: string | null;
  /** Work in place, over the photo. */
  onLike: () => void;
  onReact: (reaction: PostReaction) => void;
  onSave: () => void;
  onInfo: () => void;
  /** Open a sheet on the card, so the viewer closes first. */
  onComment: () => void;
  onShare: () => void;
  onTip?: () => void;
  onShowReactionInfo?: () => void;
  onUserPress: () => void;
}

type Host = { get: () => PhotoViewerPost | null; version: number; listeners: Set<() => void> };

const hosts = new Map<string, Host>();
let seq = 0;

/** A key unique to one card instance (the same post can show twice). */
export function nextPhotoViewerKey(): string {
  seq += 1;
  return `pv${seq}`;
}

export function registerPhotoViewerHost(key: string, get: () => PhotoViewerPost | null): () => void {
  const host: Host = hosts.get(key) ?? { get, version: 0, listeners: new Set() };
  host.get = get;
  hosts.set(key, host);
  return () => {
    const cur = hosts.get(key);
    if (cur !== host) return;
    // A viewer still open keeps the last state it read; the handlers it holds
    // belong to a card that is gone, so the bar goes with it.
    cur.get = () => null;
    cur.version += 1;
    cur.listeners.forEach((l) => l());
    if (cur.listeners.size === 0) hosts.delete(key);
  };
}

/** Called after each render of the card. Free when no viewer listens. */
export function pingPhotoViewerHost(key: string) {
  const host = hosts.get(key);
  if (!host || host.listeners.size === 0) return;
  host.version += 1;
  host.listeners.forEach((l) => l());
}

export function usePhotoViewerPost(key: string | undefined): PhotoViewerPost | null {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!key) return () => {};
      let host = hosts.get(key);
      if (!host) {
        host = { get: () => null, version: 0, listeners: new Set() };
        hosts.set(key, host);
      }
      const h = host;
      h.listeners.add(cb);
      return () => {
        h.listeners.delete(cb);
      };
    },
    [key],
  );
  const version = useSyncExternalStore(
    subscribe,
    () => (key ? hosts.get(key)?.version ?? -1 : -1),
    () => -1,
  );
  void version;
  return key ? hosts.get(key)?.get() ?? null : null;
}
