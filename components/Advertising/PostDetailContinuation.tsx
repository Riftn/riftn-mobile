import { useTranslation as _useCopy } from 'react-i18next';
import React, { startTransition, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import FeedCard from "../Home/FeedCard";
import { useServedAds } from "../../hooks/useAdServing";
import { getUnifiedFeed, type UnifiedFeedItem } from "../../services/feed.unified.service";
import { getNFT } from "../../services/nft.service";
import SponsoredAdCard from "./SponsoredAdCard";
import { useAppTheme } from "../../context/ThemeContext";
import { MINIMAL_HAIRLINE, MINIMAL_INSET, MINIMAL_TAB_LINE } from "../../theme/minimal";
import {
  ProfileFeedOriginContext,
  profileFeedParams,
  useProvidedProfileFeed,
  type ProfileFeedOrigin,
} from "../../libs/profileFeedOrigin";
import { ALWAYS_OPEN, type DrawGate } from "../../libs/drawGate";

const HOUSE_AD_POST_ID = "2008";
const POSTS_PER_PAGE = 6;
const PROFILE_POSTS_PER_PAGE = 10;
/** Posts drawn as soon as the list arrives; the rest follow one at a time. */
const FIRST_POSTS = 1;
/** Gap between two posts being drawn, so taps and scrolls get a turn. */
const NEXT_POST_AFTER_MS = 50;
/** Pages read while looking for the opened post in its profile list. */
const MAX_SEARCH_PAGES = 5;

interface PostDetailContinuationProps {
  currentPostId: string;
  /**
   * Opened from a profile tab: continue through that tab's list, after this
   * post, instead of the latest posts everywhere.
   */
  profileFeed?: ProfileFeedOrigin | null;
  /**
   * When set, more posts load by themselves: the list bumps this as the reader
   * nears the end, and the "Load more" button goes away.
   */
  loadMoreSignal?: number;
  /**
   * When given, a card past the first is drawn only while the gate is open:
   * the posts far below the screen wait until the reader scrolls toward them.
   */
  drawGate?: DrawGate;
}

/** Ad first, then an explicitly paginated continuation of recent posts. */
function PostDetailContinuation({ currentPostId, profileFeed, loadMoreSignal, drawGate = ALWAYS_OPEN }: PostDetailContinuationProps) {
  const { t: _copy } = _useCopy();
  const { t } = useTranslation();
  const { isMinimal } = useAppTheme();
  const { data: servedAds = [], isLoading: servedAdLoading } = useServedAds("related", { count: 1 });
  const servedAd = servedAds[0] ?? null;

  const { data: houseAdResponse, isLoading: houseAdLoading } = useQuery({
    queryKey: ["post-detail-house-ad", HOUSE_AD_POST_ID],
    queryFn: () => getNFT(HOUSE_AD_POST_ID),
    staleTime: 30 * 60 * 1000,
    enabled: !servedAd,
  });

  const houseAd = useMemo(() => {
    const response = houseAdResponse as any;
    return (response?.result ?? response ?? null) as UnifiedFeedItem | null;
  }, [houseAdResponse]);

  // A post that turns out not to be in the profile list (a pinned post from
  // another creator, say) falls back to the latest posts.
  const [profileMiss, setProfileMiss] = useState(false);
  const fromProfile = !!profileFeed && !profileMiss;
  const feedSource = useProvidedProfileFeed(fromProfile ? profileFeed ?? null : null);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: postsLoading,
  } = useInfiniteQuery({
    queryKey: fromProfile ? ["post-detail-profile-feed", currentPostId, profileFeed] : ["post-detail-more-posts", currentPostId],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fromProfile && profileFeed
      ? getUnifiedFeed(profileFeedParams(profileFeed, pageParam, PROFILE_POSTS_PER_PAGE))
      : getUnifiedFeed({
        page: pageParam,
        limit: POSTS_PER_PAGE,
        sortBy: "createdAt",
        sortOrder: "desc",
        status: "all",
      }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
    staleTime: 5 * 60 * 1000,
  });

  const autoLoad = loadMoreSignal !== undefined;

  const loaded = useMemo(() => data?.pages.flatMap((page) => page.result) ?? [], [data]);
  const profileIndex = useMemo(
    () => (fromProfile ? loaded.findIndex((post) => String(post.tokenId ?? post.id ?? "") === currentPostId) : -1),
    [fromProfile, loaded, currentPostId],
  );
  // The opened post can sit past the first pages: read on until it turns up.
  const searched = useRef(0);
  const searching = fromProfile && !!data && profileIndex < 0;
  useEffect(() => {
    if (!searching || isFetchingNextPage) return;
    if (hasNextPage && searched.current < MAX_SEARCH_PAGES) {
      searched.current += 1;
      void fetchNextPage();
    } else {
      setProfileMiss(true);
    }
  }, [searching, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const posts = useMemo(() => {
    const seen = new Set<string>();
    if (fromProfile && profileIndex < 0) return [];
    const source = fromProfile ? loaded.slice(profileIndex + 1) : loaded;
    return source.filter((post) => {
      const id = String(post.tokenId ?? post.id ?? "");
      if (!id || id === currentPostId || id === HOUSE_AD_POST_ID || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [currentPostId, loaded, fromProfile, profileIndex]);

  // These posts sit below the fold. Drawn together they held the page still
  // for a moment right after it opened, so they come in one at a time, and
  // only as far ahead of the reader as the gate allows.
  const [drawn, setDrawn] = useState(FIRST_POSTS);
  const drawing = drawn < posts.length;
  const gateOpen = useSyncExternalStore(drawGate.subscribe, drawGate.get, drawGate.get);
  useEffect(() => {
    if (!drawing || !gateOpen) return;
    const timer = setTimeout(() => startTransition(() => setDrawn((n) => n + 1)), NEXT_POST_AFTER_MS);
    return () => clearTimeout(timer);
  }, [drawing, drawn, gateOpen]);

  useEffect(() => {
    // A list still being drawn is short, which reads as "near the end"; the
    // list asks again once it has its full height.
    if (!loadMoreSignal || !hasNextPage || isFetchingNextPage || drawing) return;
    void fetchNextPage();
    // Only a new signal asks for a page; the fetch state just gates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMoreSignal]);

  return (
    <ProfileFeedOriginContext.Provider value={feedSource}>
    <View
      className="border-t border-theme-neutrals-800 pt-5"
      style={isMinimal ? { borderTopColor: MINIMAL_HAIRLINE } : undefined}
    >
      {/* Minimal: no side padding here — the ad lays itself out as a full-width
          feed row with its own 16pt text inset, like a minimal FeedCard. */}
      <View className={isMinimal ? undefined : "px-4"}>
        {fromProfile ? null : servedAd ? (
          <SponsoredAdCard ad={servedAd} />
        ) : houseAd ? (
          <View className={isMinimal ? undefined : "rounded-2xl border border-theme-neutrals-700 bg-theme-neutrals-800/50 p-3"}>
            <View
              className="mb-2 flex-row items-center justify-between"
              style={isMinimal ? { paddingHorizontal: MINIMAL_INSET } : undefined}
            >
              <Text className="text-xs text-theme-neutrals-400">{t("ads.sponsored")}</Text>
              <View className="rounded bg-yellow-500 px-1.5 py-0.5">
                <Text className="text-xs font-bold text-black">{_copy("copy.c7bf4bbdbcd8", { defaultValue: "AD" })}</Text>
              </View>
            </View>
            <FeedCard item={houseAd} isAutoplayActive={false} />
          </View>
        ) : servedAdLoading || houseAdLoading ? (
          <View
            className="h-48 items-center justify-center rounded-2xl bg-theme-neutrals-800/50"
            style={isMinimal ? { backgroundColor: "rgba(255,255,255,0.04)" } : undefined}
          >
            <ActivityIndicator color="#A1A1AA" />
          </View>
        ) : null}
      </View>

      <Text className="px-4 pb-1 pt-7 text-sm font-semibold text-theme-neutrals-100">
        {t("ads.morePosts")}
      </Text>

      {/* These render in the detail list's footer with no viewability tracking,
          so none of them may autoplay: a video here would start below the fold
          and take playback focus from the post being viewed. Tap to play. */}
      {posts.slice(0, drawn).map((post) => (
        // Minimal: FeedCards draw their own hairline, so no vertical gap between them.
        <View key={String(post.tokenId ?? post.id)} className={isMinimal ? "px-4" : "px-4 py-2"}>
          <FeedCard item={post} isAutoplayActive={false} />
        </View>
      ))}

      {(postsLoading || searching) && posts.length === 0 && (
        <View className="items-center py-8">
          <ActivityIndicator color="#A1A1AA" />
        </View>
      )}

      {autoLoad && isFetchingNextPage && (
        <View className="items-center py-6">
          <ActivityIndicator color="#A1A1AA" />
        </View>
      )}

      {hasNextPage && !autoLoad && !drawing && (
        <TouchableOpacity
          onPress={() => void fetchNextPage()}
          disabled={isFetchingNextPage}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t("ads.loadMorePosts")}
          className={isMinimal
            ? "mx-4 my-4 items-center border py-3"
            : "mx-4 my-4 items-center rounded-xl border border-theme-neutrals-700 bg-theme-neutrals-800/60 py-3"}
          style={isMinimal ? { borderColor: MINIMAL_TAB_LINE } : undefined}
        >
          {isFetchingNextPage ? (
            <ActivityIndicator size="small" color="#E4E4E7" />
          ) : (
            <Text className="text-sm font-medium text-theme-neutrals-100">{t("ads.loadMorePosts")}</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
    </ProfileFeedOriginContext.Provider>
  );
}

export default React.memo(PostDetailContinuation);
