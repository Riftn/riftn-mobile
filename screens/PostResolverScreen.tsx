/**
 * PostResolverScreen
 *
 * Lightweight screen used by deep links (dehub.io/app/post/:tokenId).
 * We don't know from the URL alone whether a tokenId is a video or a feed post,
 * so this screen fetches the metadata, checks `postType`, and immediately
 * replaces itself in the stack with the correct destination screen.
 */
import React, { useEffect, useCallback } from "react";
import { View } from "react-native";
import { DeHubLoader } from "../components/DeHubLoader";
import { CommonActions, useRoute, useNavigation } from "@react-navigation/native";
import { ScreenNames } from "../navigation/ScreenNames";
import { getNFT, resolveArticleSlug, resolveNewPost } from "../services/nft.service";
import { canOpenPostVideoViewer, postVideoViewerParams } from "../navigation/postVideoViewerParams";
import { seedPostDetail } from "../libs/navPrefetch";
import { resolveClip } from "../services/remix-links.service";
import { createLogger } from "../libs/logger";
import { toastError } from "../libs/toast";
import { useTranslation } from "react-i18next";

const logger = createLogger("PostResolver");

const PostResolverScreen: React.FC = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const tokenId: string | undefined =
    route.params?.tokenId ?? route.params?.postId ?? route.params?.id;
  /** dehub.io/newpost/:n — an off-chain post's own slug, resolved via the API. */
  const newPostId: string | undefined = route.params?.newPostId;
  /** dehub.io/clip/:n — a posted live clip; opens its Short, or the stream. */
  const clipId: string | undefined = route.params?.clipId;
  const commentId: string | undefined =
    route.params?.commentId ?? route.params?.c ?? route.params?.comment;

  // A link that cannot be opened returns to the screen it was tapped on (a
  // chat, a profile), not all the way to Home. Replacing the resolver with a
  // second Root mounted the whole tab tree twice, so a cold-start link with
  // nothing behind it still lands on the one Root.
  const goHome = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace(ScreenNames.Root);
  }, [navigation]);

  /**
   * The post page, and for a playable video the Shorts viewer on top of it,
   * the same player a feed tap opens. Back (or closing the viewer) lands on
   * the post page, and Back again on whatever was under the link (Home for a
   * link that started the app). A link to a comment keeps the post page, which
   * is where that comment is.
   */
  const openPost = useCallback(async (target: string, focusComment?: string) => {
    if (focusComment) {
      navigation.replace(ScreenNames.FeedDetail, { tokenId: target, commentId: focusComment });
      return;
    }
    let post: any = null;
    try {
      const res = await getNFT(target);
      post = (res as any)?.result ?? res ?? null;
    } catch {
      post = null;
    }
    if (post && typeof post === "object") seedPostDetail(target, post);
    const isVideo = post?.postType === "video" || post?.postType === "short";
    if (!isVideo || !canOpenPostVideoViewer(post)) {
      navigation.replace(ScreenNames.FeedDetail, { tokenId: target });
      return;
    }
    logger.info("Opening shared video in the Shorts viewer", { tokenId: target });
    // One step, so the post page is always the screen under the viewer.
    navigation.dispatch((state: any) => {
      const below = state.routes.slice(0, state.index);
      const routes = [
        ...below,
        { name: ScreenNames.FeedDetail, params: { tokenId: target } },
        { name: ScreenNames.ShortsViewer, params: postVideoViewerParams(post, target) },
      ];
      return CommonActions.reset({ index: routes.length - 1, routes });
    });
  }, [navigation]);

  const resolve = useCallback(async () => {
    // The slug carries no tokenId, and everything downstream keys on one.
    // Resolving also survives the post minting later, since the server keeps
    // the mapping — the link never dies.
    if (!tokenId && clipId) {
      const clip = await resolveClip(clipId);
      const target = clip?.postTokenId ?? clip?.streamTokenId;
      if (target != null) {
        await openPost(String(target));
      } else {
        toastError(t("common.postNotFound"));
        goHome();
      }
      return;
    }

    if (!tokenId && newPostId) {
      logger.info("Resolving /newpost slug", { newPostId });
      const resolved = await resolveNewPost(newPostId);
      if (resolved) {
        await openPost(String(resolved.tokenId), commentId);
      } else {
        logger.warn("Slug did not resolve — going home", { newPostId });
        // Say why the link landed on Home instead of the post it promised.
        toastError(t("common.postNotFound"));
        goHome();
      }
      return;
    }

    // An article's readable link, /app/post/<title-slug>: resolve it first.
    if (tokenId && !/^\d+$/.test(tokenId) && !/^[a-f\d]{24}$/i.test(tokenId) && /[a-z]/i.test(tokenId)) {
      const resolved = await resolveArticleSlug(tokenId);
      if (resolved) {
        navigation.replace(ScreenNames.FeedDetail, { tokenId: String(resolved.tokenId), commentId });
      } else {
        logger.warn("Article slug did not resolve — going home", { tokenId });
        toastError(t("common.postNotFound"));
        goHome();
      }
      return;
    }

    if (!tokenId) {
      logger.warn("No tokenId — going home");
      toastError(t("common.postNotFound"));
      goHome();
      return;
    }

    logger.info("Resolving to FeedDetail", { tokenId });
    await openPost(tokenId, commentId);
  }, [tokenId, newPostId, clipId, commentId, navigation, goHome, t, openPost]);

  useEffect(() => {
    resolve();
  }, [resolve]);

  return (
    <View className="flex-1 bg-theme-background items-center justify-center">
      <DeHubLoader size={56} />
    </View>
  );
};

export default PostResolverScreen;
