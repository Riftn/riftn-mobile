/**
 * Who posted the photo, what they wrote and the post's action bar, laid over
 * the bottom of the photo viewer (Requests babaeb88). Always on the dark
 * colours: the viewer is a dark room in every theme.
 *
 * Like and Save work in place. Comment, Share, Tip and the profile open on the
 * card underneath, so the viewer closes first; Post info is a page and opens
 * over the viewer.
 */
import React, { memo, useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet, LayoutChangeEvent } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import Avatar from "./Avatar";
import FeedActionBar from "../Home/FeedActionBar";
import { useUser } from "../../context/AuthContext";
import { useSearchFollowState } from "../../hooks/useSearchFollowState";
import type { PhotoViewerPost } from "../../libs/photoViewerPost";

const INK = "hsla(216,100%,99%,1)";
const MUTED = "hsla(220,3%,70%,1)";
const RULE = "hsla(0,0%,100%,0.16)";
const NOT_FOLLOWING = { isFollowing: false, isFollowRequestPending: false };

const FollowPill = memo(({ address }: { address: string }) => {
  const { t } = useTranslation();
  const { isFollowing, isPending, isLoading, toggle } = useSearchFollowState(address, NOT_FOLLOWING);
  // Nothing until the state is known, so a followed account never flashes "Follow".
  if (isLoading) return null;
  const on = isFollowing || isPending;
  const label = isPending ? t("follow.requested") : isFollowing ? t("follow.following") : t("follow.follow");
  return (
    <Pressable
      onPress={() => void toggle().catch(() => {})}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="dark-surface"
      style={({ pressed }) => [styles.followHit, pressed && { opacity: 0.8 }]}
    >
      {/* The fill sits on an inner view: a filled Pressable is repainted
          with the theme's control glass (libs/jsx/controls.js). */}
      <View style={[styles.followPill, on ? styles.followPillOn : styles.followPillOff]}>
        <Text style={[styles.followLabel, { color: on ? INK : "hsla(240,6%,10%,1)" }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
});

function PhotoViewerPostOverlay({
  post,
  bottomInset,
  closeViewer,
  onHeight,
}: {
  post: PhotoViewerPost;
  bottomInset: number;
  closeViewer: () => void;
  onHeight?: (height: number) => void;
}) {
  const user = useUser();
  const signedIn = !!(user?.walletAddress || user?.address);
  const [expanded, setExpanded] = useState(false);

  // Sheets live on the card under the viewer: close, then open them there.
  const thenOnCard = useCallback(
    (action?: () => void) =>
      action
        ? () => {
            closeViewer();
            action();
          }
        : undefined,
    [closeViewer],
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => onHeight?.(e.nativeEvent.layout.height),
    [onHeight],
  );

  const name = post.displayName || post.username || "";
  const showFollow = signedIn && !post.isOwnPost && !!post.address;

  return (
    <View style={styles.wrap} onLayout={onLayout} pointerEvents="box-none">
      <LinearGradient
        colors={["hsla(0,0%,0%,0)", "hsla(0,0%,0%,0.55)", "hsla(0,0%,0%,0.88)"]}
        locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.body, { paddingBottom: bottomInset + 6 }]}>
        <View style={styles.authorRow}>
          <Pressable
            onPress={thenOnCard(post.onUserPress)}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={name}
            style={styles.author}
          >
            <Avatar uri={post.avatarUrl} size={40} name={name} />
            <View style={styles.names}>
              <Text style={styles.displayName} numberOfLines={1}>
                {name}
              </Text>
              {post.username ? (
                <Text style={styles.handle} numberOfLines={1}>
                  @{post.username}
                </Text>
              ) : null}
            </View>
          </Pressable>
          {showFollow ? <FollowPill address={post.address!} /> : null}
        </View>

        {post.caption ? (
          <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="text" style={styles.captionHit}>
            <Text style={styles.caption} numberOfLines={expanded ? 12 : 2}>
              {post.caption}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.rule} />

        <FeedActionBar
          liked={post.liked}
          disliked={post.disliked}
          saved={post.saved}
          reposted={post.reposted}
          likeCount={post.likeCount}
          dislikeCount={post.dislikeCount}
          commentCount={post.commentCount}
          repostCount={post.repostCount}
          shareCount={post.shareCount}
          tipCount={post.tipCount}
          onLike={post.onLike}
          onReact={post.onReact}
          myReaction={post.myReaction}
          reactionCounts={post.reactionCounts}
          onComment={thenOnCard(post.onComment)!}
          onShare={thenOnCard(post.onShare)!}
          onTip={thenOnCard(post.onTip)}
          tokenId={post.tokenId}
          viewerAddress={post.viewerAddress}
          onSave={post.onSave}
          onInfo={post.onInfo}
          onShowReactionInfo={thenOnCard(post.onShowReactionInfo)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
  },
  body: {
    paddingTop: 56,
    paddingHorizontal: 16,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  author: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  names: {
    flex: 1,
    minWidth: 0,
  },
  displayName: {
    color: INK,
    fontSize: 16,
    fontWeight: "600",
  },
  handle: {
    color: MUTED,
    fontSize: 13,
    marginTop: 1,
  },
  followHit: {
    flexShrink: 0,
  },
  followPill: {
    height: 32,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  followPillOff: {
    backgroundColor: "hsla(0,0%,98%,1)",
  },
  followPillOn: {
    backgroundColor: "hsla(0,0%,100%,0.12)",
    borderWidth: 1,
    borderColor: "hsla(0,0%,100%,0.28)",
  },
  followLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  captionHit: {
    marginTop: 12,
  },
  caption: {
    color: INK,
    fontSize: 15,
    lineHeight: 21,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: RULE,
    marginTop: 14,
    marginBottom: 4,
  },
});

export default memo(PhotoViewerPostOverlay);
