import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { View, Text, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { useProfilePins } from '../../hooks/usePinnedPosts';
import InfiniteFeed, { type InfiniteFeedRenderItemInfo } from '../Feed/InfiniteFeed';
import { getUnifiedFeed, type FeedPostType, type FeedRange, type FeedSortBy, type UnifiedFeedItem } from '../../services/feed.unified.service';
import { getNFT, type GetNFTsResponse, type GetNFTsResult } from '../../services/nft.service';
import { useAuthState } from '../../context/AuthContext';
import { useUser } from '../../context/AuthContext';
import { getMyPosts } from '../../services/user.service';
import ProfileEmptyState from './ProfileEmptyState';
import ProfileGridTile, { gridTileKind } from './ProfileGridTile';
import { useNavigation } from '@react-navigation/native';
import { ScreenNames } from '../../navigation/ScreenNames';
import { seedPostDetail, warmRequest } from '../../libs/navPrefetch';
import { noteProfileFeedOpen, useProvidedProfileFeed } from '../../libs/profileFeedOrigin';
import { useProfilePostBg } from './PostBackground';
import { postBgToken } from '../../libs/postBackgrounds';
import FeedCard from '../Home/FeedCard';
import type { PostLookRow } from '../common/PostOptionsMenu';
import FeedCardSkeleton from '../Feed/FeedCardSkeleton';
import Icon from '../ui/Icon';
import { isReelSlide } from '../../libs/profileReel';
import { useProfileViewMode } from '../../libs/profileViewMode';
import { GridDragHost } from './GridDrag';
import { loadArrangeRows } from './ProfileArrangeSheet';
import { moveInOrder, postsBefore } from '../../libs/profileGridMove';
import { saveProfileOrder } from '../../services/profile-order.service';
import { toastError, toastSuccess } from '../../libs/toast';

const PAGE_SIZE = 10;
const tokenOf = (item: UnifiedFeedItem | undefined) => Number(item?.tokenId ?? item?.id);

// One recycle pool per tile kind: photo, video, text and song tiles draw different trees.
const gridItemTypeOf = (item: any) => gridTileKind(item as UnifiedFeedItem);

interface FeedRouteProps {
  /** Channel toolbar state, threaded to the API rather than applied on screen. */
  sortBy?: FeedSortBy;
  sortOrder?: "asc" | "desc";
  search?: string;
  category?: string;
  range?: FeedRange;
  postType?: FeedPostType;
  isPPV?: boolean;
  hasBounty?: boolean;
  isLocked?: boolean;
  address?: string;
  listRef?: React.RefObject<import("react-native").FlatList<any> | null>;
  /** Profile header rendered as the scrollable list header (banner, info, tabs). */
  listHeader?: React.ReactNode;
  onBeforeNavigate?: () => void;
  /** Either a plain callback, or a Reanimated worklet scroll handler (InfiniteFeed accepts both). */
  onScroll?: ((event: NativeSyntheticEvent<NativeScrollEvent>) => void) | any;
  scrollEnabled?: boolean;
  /** The creator has saved their own order of posts. */
  hasCustomOrder?: boolean;
  /** A drag on the grid saved a new order. */
  onOrderSaved?: (custom: boolean) => void;
}

/**
 * Profile "All" tab — every piece of the user's own content (text, images,
 * videos, audio), matching the web profile's home feed. Uses the unified feed
 * with no postType filter (the `feed-all` postType returns nothing for a
 * minter-scoped query).
 */
/** Two rows of empty tiles while the first page loads. */
function GridSkeleton() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 1 }}>
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={{ width: '33.333%', aspectRatio: 3 / 4, padding: 1 }}>
          <View className="flex-1 rounded-[3px] bg-white/5" />
        </View>
      ))}
    </View>
  );
}

const FeedRoute: React.FC<FeedRouteProps> = ({
  address,
  listRef,
  listHeader,
  onBeforeNavigate,
  onScroll,
  scrollEnabled = true,
  sortBy,
  sortOrder,
  search,
  category,
  range,
  postType,
  isPPV,
  hasBounty,
  isLocked,
  hasCustomOrder = false,
  onOrderSaved,
}) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isSignedIn } = useAuthState();
  const user = useUser() as any;
  const ownAddress = user?.walletAddress || user?.address;
  const isOwnProfile = !!(
    address && ownAddress && address.toLowerCase() === ownAddress.toLowerCase()
  );

  const isDefaultView =
    (sortBy ?? 'createdAt') === 'createdAt' &&
    (sortOrder ?? 'desc') === 'desc' &&
    !search && !category && !range && !postType &&
    !isPPV && !hasBounty && !isLocked;

  // Pinned posts sit at the top of All, newest pin first, like a pinned post
  // anywhere else. A sorted or filtered view is a search, so they stay out.
  const { data: pins } = useProfilePins(address);
  const pinnedPosts = isDefaultView ? (pins || []) : [];
  const navigation = useNavigation<any>();
  // A post opened here continues into the rest of this list on its page.
  const feedSource = useProvidedProfileFeed(address ? {
    minter: address, postType, sortBy, sortOrder, search, category, range, isPPV, hasBounty, isLocked,
  } : null);

  // A tile opens the profile reel: this creator's posts one by one, full
  // screen, from the tapped one (libs/profileReel). Likes, comments and share
  // ride along on every slide; a still slide links on to its post page.
  const postBg = useProfilePostBg();
  // Holding somebody else's tile opens that post's full menu. A card for it
  // is mounted out of sight and shows only the menu and its sheets.
  // Your own text post or article adds its look picker as a row of the menu.
  const [held, setHeld] = useState<{ item: UnifiedFeedItem; look?: PostLookRow } | null>(null);
  const holdTile = useCallback((item: UnifiedFeedItem, look?: PostLookRow) => setHeld({ item, look }), []);
  const heldMenu = useMemo(() => ({ onDone: () => setHeld(null), look: held?.look }), [held]);
  const heldTile = held?.item ?? null;
  const heldHost = heldTile ? (
    <View key={String(heldTile.tokenId ?? heldTile.id)} pointerEvents="none" style={{ position: 'absolute', left: -10000, top: 0, width: 360, opacity: 0 }}>
      <FeedCard item={heldTile} isVisible={false} isAutoplayActive={false} menuHost={heldMenu} />
    </View>
  ) : null;

  const openTile = useCallback((item: UnifiedFeedItem, _kind?: unknown, images?: string[]) => {
    const tokenId = item.tokenId ?? item.id;
    if (tokenId == null) return;
    onBeforeNavigate?.();
    seedPostDetail(tokenId, item);
    warmRequest(`nft:${tokenId}`, () => getNFT(tokenId as any));
    const origin = noteProfileFeedOpen(feedSource, tokenId);
    // A live stream, or a post with nothing the reel can draw, opens its own
    // page: the reel would show a black slide that looks like a dead tap.
    if (!origin || !isReelSlide(item as any)) {
      navigation.navigate(ScreenNames.FeedDetail, { postId: String(tokenId) });
      return;
    }
    navigation.navigate(ScreenNames.ShortsViewer, {
      initialIndex: 0,
      initialItems: [item],
      initialThumbnail: images?.[0],
      feedParams: { profileFeed: origin, fromId: String(tokenId), reel: true, reelBgId: postBgToken(postBg) },
    });
  }, [navigation, onBeforeNavigate, feedSource, postBg]);

  const viewMode = useProfileViewMode();
  const isList = viewMode === 'list';

  const cacheKey = useMemo(() => [
    "profile-feed-all",
    address ?? "",
    sortBy ?? "createdAt",
    sortOrder ?? "desc",
    search ?? "",
    category ?? "",
    range ?? "",
    postType ?? "all",
    isPPV ? "ppv" : "",
    hasBounty ? "bounty" : "",
    isLocked ? "locked" : "",
  ], [address, sortBy, sortOrder, search, category, range, postType, isPPV, hasBounty, isLocked]);

  // Your own grid, showing the order a drag would change (your saved order, or
  // newest first before one is saved): each tile carries a grip to move it by.
  const plainView = !search && !category && !range && (!postType || postType === 'all') && !isPPV && !hasBounty && !isLocked;
  // The All tab passes postType "all", which is no filter at all.
  const newestFirst = (sortBy ?? 'createdAt') === 'createdAt' && (sortOrder ?? 'desc') === 'desc';
  const canArrange = isOwnProfile && !isList && !!address && plainView
    && (sortBy === 'custom' || (newestFirst && !hasCustomOrder));
  const [holding, setHolding] = useState(false);
  const [saving, setSaving] = useState(false);
  // What each place in the grid holds, as the list last drew it.
  const placed = useRef<(UnifiedFeedItem | undefined)[]>([]);
  const getCount = useCallback(() => placed.current.length, []);
  // A new sort or search is a new list: forget the old places.
  useMemo(() => { placed.current = []; }, [cacheKey]);
  const dropTile = useCallback(async (from: number, to: number) => {
    const moved = tokenOf(placed.current[from]);
    if (!address || !Number.isFinite(moved)) return;
    const before = postsBefore(placed.current, from, to).map(tokenOf).filter(Number.isFinite);
    const queryKey = ["infinite-feed", ...cacheKey, PAGE_SIZE];
    const previous = queryClient.getQueryData(queryKey);
    // Show it in its new place at once; the saved order follows.
    queryClient.setQueryData(queryKey, (old: any) => {
      if (!old?.pages) return old;
      const flat: any[] = old.pages.flatMap((page: any) => page.result || []);
      const at = flat.findIndex((row) => tokenOf(row) === moved);
      if (at < 0) return old;
      const [row] = flat.splice(at, 1);
      const anchor = before.length ? flat.findIndex((other) => tokenOf(other) === before[0]) : -1;
      flat.splice(anchor + 1, 0, row);
      let cursor = 0;
      return {
        ...old,
        pages: old.pages.map((page: any) => {
          const size = (page.result || []).length;
          const result = flat.slice(cursor, cursor + size);
          cursor += size;
          return { ...page, result };
        }),
      };
    });
    setSaving(true);
    try {
      const rows = await loadArrangeRows(address);
      const next = moveInOrder(rows.map((row) => row.tokenId), moved, before);
      if (!next) throw new Error("post not in the saved order");
      await saveProfileOrder(next);
      onOrderSaved?.(true);
      void queryClient.invalidateQueries({ queryKey: ["infinite-feed"] });
      toastSuccess(t("profile.arrange.saved", "Your order is saved"));
    } catch {
      queryClient.setQueryData(queryKey, previous);
      toastError(t("profile.arrange.saveFailed", "Could not save your order. Please try again."));
    } finally {
      setSaving(false);
    }
  }, [address, cacheKey, queryClient, onOrderSaved, t]);

  // Pinned posts lead the grid as their own row of tiles, wearing a Pinned chip.
  // In the list they lead as full cards under a small Pinned line.
  const header = pinnedPosts.length && isList ? (
    <>
      {listHeader}
      {pinnedPosts.map((item) => (
        <View key={`pinned-${item.tokenId}`} className="px-2">
          <View className="flex-row items-center gap-1.5 px-2 pt-2 pb-1">
            <Icon name="Pin" size={14} color="#9CA3AF" />
            <Text className="text-xs text-theme-neutrals-400">{t("profile.tabPinned", "Pinned")}</Text>
          </View>
          <FeedCard
            item={item as UnifiedFeedItem}
            isVisible
            isAutoplayActive={false}
            onBeforeNavigate={onBeforeNavigate}
          />
        </View>
      ))}
    </>
  ) : pinnedPosts.length ? (
    <>
      {listHeader}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 1 }}>
        {pinnedPosts.map((item) => (
          <View key={`pinned-${item.tokenId}`} style={{ width: '33.333%' }}>
            <ProfileGridTile item={item as UnifiedFeedItem} pinned isVisible onPress={openTile} ownerHold={isOwnProfile} onHold={holdTile} />
          </View>
        ))}
      </View>
    </>
  ) : listHeader;

  const fetchPage = useCallback(
    async (page: number, limit: number): Promise<GetNFTsResponse> => {
      if (!address) return { result: [] };
      const isDefaultView =
        (sortBy ?? 'createdAt') === 'createdAt' &&
        (sortOrder ?? 'desc') === 'desc' &&
        !search && !category && !range && !postType &&
        !isPPV && !hasBounty && !isLocked;
      // The public feed correctly withholds future posts. On the creator's
      // own unfiltered profile use the authenticated list, which includes
      // scheduled posts so a successful schedule never appears to vanish.
      if (isOwnProfile && isDefaultView) {
        return getMyPosts({ page, unit: limit });
      }
      const res = await getUnifiedFeed({
        minter: address,
        sortBy: sortBy ?? 'createdAt',
        sortOrder: sortOrder ?? 'desc',
        search: search || undefined,
        category: category || undefined,
        range,
        // Sent only for a type the deployed API already knows: an unrecognised
        // postType is answered with an unfiltered feed rather than an error.
        postType: postType && postType !== 'all' ? postType : undefined,
        // Only ever true — `false` would exclude free posts rather than widen.
        isPPV: isPPV || undefined,
        hasBounty: hasBounty || undefined,
        isLocked: isLocked || undefined,
        // 'all' resolves to minted+signed server-side; 'minted' alone hides
        // off-chain (mint-opt-out) posts from their own author's profile.
        status: 'all',
        page: page + 1, // /feed uses 1-indexed pages
        limit,
      });
      return { result: res.result as unknown as GetNFTsResult[] };
    },
    [address, sortBy, sortOrder, search, category, range, postType, isPPV, hasBounty, isLocked, isOwnProfile],
  );

  // Stable identity: InfiniteFeed's own renderItem useCallback lists this in
  // its deps, so a fresh arrow per render invalidated it and re-rendered every
  // cell in the window on any re-render of this route.
  const renderItem = useCallback(
    ({ item, index, isVisible }: InfiniteFeedRenderItemInfo) => {
      placed.current[index] = item as UnifiedFeedItem;
      return <ProfileGridTile item={item as UnifiedFeedItem} isVisible={isVisible} onPress={openTile} ownerHold={isOwnProfile} index={index} onHold={holdTile} />;
    },
    [openTile, isOwnProfile],
  );
  // isVisible must be forwarded or FeedCard falls back to its own `true`
  // default and every windowed row attaches a video player.
  const renderListItem = useCallback(
    ({ item, isVisible, isAutoplayActive }: InfiniteFeedRenderItemInfo) => (
      <View className="px-2">
        <FeedCard
          item={item as UnifiedFeedItem}
          isVisible={isVisible}
          isAutoplayActive={isAutoplayActive}
          onBeforeNavigate={onBeforeNavigate}
        />
      </View>
    ),
    [onBeforeNavigate],
  );

  return (
    <GridDragHost enabled={canArrange && !saving} getCount={getCount} onDrop={dropTile} onHoldChange={setHolding}>
      <InfiniteFeed
        // Grid and list lay rows out differently (3 columns vs 1): a fresh
        // list for each, reading the same cached pages.
        key={viewMode}
        listRef={listRef}
        insideNavigatorScreen={false}
        // Everything fetchPage closes over has to be in here: InfiniteFeed
        // reads fetchPage through a ref, so a key that omits the toolbar state
        // keeps serving the first sort/search/filter the tab was ever opened
        // with.
        cacheKey={cacheKey}
        fetchPage={fetchPage}
        // 10 fill the first screen; the next page waits until the visitor
        // scrolls within about half a screen of the end.
        pageSize={PAGE_SIZE}
        endReachedThreshold={0.6}
        isSignedIn={isSignedIn}
        contentContainerStyle={{ paddingBottom: 80, paddingTop: 0, paddingHorizontal: isList ? 0 : 1 }}
        numColumns={isList ? undefined : 3}
        gridItemType={isList ? undefined : gridItemTypeOf}
        enableBackToTop={false}
        headerComponent={header}
        loadingComponent={isList ? <View className="px-2"><FeedCardSkeleton count={3} /></View> : <GridSkeleton />}
        onScroll={onScroll}
        scrollEnabled={scrollEnabled && !holding}
        emptyComponent={(
          <ProfileEmptyState
            kind="home"
            title={t("profile.noPostsYet")}
            subtitle={t("profile.noPostsYetSub")}
          />
        )}
        renderItem={isList ? renderListItem : renderItem}
      />
      {heldHost}
    </GridDragHost>
  );
};

export default FeedRoute;
