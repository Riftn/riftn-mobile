import { useTranslation as _useCopy } from 'react-i18next';
import BadgeArtwork from "../common/BadgeArtwork";
import { useSheetClosed } from '../../hooks/useSheetClosed';
/**
 * Comment Likers Sheet
 * ====================
 * Who liked a comment. Opened by tapping the like button on your OWN comment —
 * the server refuses self-likes, so for the author that button is the door to
 * this list instead, matching web.
 *
 * AUTHOR-ONLY, ON BOTH SIDES
 * The server is the gate that counts: /comment-likers answers everyone but the
 * comment's author with `canViewLikers: false` and an empty list. An empty
 * `data` is therefore ambiguous on its own — read `canViewLikers` before
 * deciding nobody liked it.
 *
 * Same glass chrome as ReactionInfoSheet so the two read as one family.
 */

import React, { memo, useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  StyleSheet,
  Platform,
} from "react-native";
import SmartImage from "../common/SmartImage";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import { getCommentLikers, type CommentLiker } from "../../services/nft.service";
import { getChatReactors } from "../../services/livechat.service";
import { getAccountSummaries } from "../../services/user.service";
import { InlineEmoji } from "../common/EmojiText";
import { getAvatarUrl, getBadgeUrlFor, getBadgeHoverOpticalStyle as getBadgeOpticalStyle } from "../../libs/misc";
import { truncate } from "../../libs/strings.util";
import { useTranslation } from "react-i18next";
import { SHEET_GLASS_FILL, SHEET_GLASS_BORDER } from "../../theme/sheetGlass";
import { SheetGlassFill } from "../ui/SheetGlass";
import SheetBackdrop, { useSheetBackdrop } from "../ui/SheetBackdrop";

import { formatCount } from '../../libs/format-count';
const SHEET_FRACTION = 0.6;
const PAGE_LIMIT = 50;

interface CommentLikersSheetProps {
  visible: boolean;
  onClose: () => void;
  commentId: number | string | null;
  /** Where the likers come from; post comments read the Riftn API. */
  loadPage?: typeof getCommentLikers;
  /** Chat lines carry several reactions: swaps the heading and copy, and adds one filter per reaction. */
  chatMessageId?: string | null;
  /**
   * DMs: the line already carries every address per emoji, so the names come
   * from one batch account lookup instead of a server list.
   */
  localReactions?: Record<string, string[]> | null;
}

type Person = CommentLiker & { emojis?: string[] };

const PersonRow: React.FC<{ item: Person; onPress: (address: string) => void }> = memo(
  ({ item, onPress }) => {
    const displayName = item.displayName || item.username || truncate(item.address, 12, "..");
    const badgeImg = item.hideBadgeAndBalance ? undefined : getBadgeUrlFor(item);
    const handlePress = useCallback(() => onPress(item.address), [onPress, item.address]);

    return (
      <Pressable
        onPress={handlePress}
        style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10 }}
      >
        <Avatar uri={getAvatarUrl(item.avatarImageUrl || "")} size={38} name={displayName} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Text style={{ color: "#F9FBFF", fontWeight: "600", fontSize: 14, flexShrink: 1 }} numberOfLines={1}>
              {displayName}
            </Text>
            {badgeImg ? (
              <BadgeArtwork
                source={badgeImg}
                style={getBadgeOpticalStyle(badgeImg, 14, 0, 20)}
                contentFit="contain"
              />
            ) : null}
          </View>
          {!!item.username && (
            <Text style={{ color: "#8B8D90", fontSize: 13, marginTop: 1 }} numberOfLines={1}>
              @{item.username}
            </Text>
          )}
        </View>
        {item.emojis?.length ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 8 }}>
            {item.emojis.map((emoji) => (
              <InlineEmoji key={emoji} value={emoji} size={18} />
            ))}
          </View>
        ) : (
          <Icon name="ChevronRight" size={16} color="#6F7174" />
        )}
      </Pressable>
    );
  },
);

const CommentLikersSheetComponent: React.FC<CommentLikersSheetProps> = ({
  visible,
  onClose,
  commentId,
  loadPage,
  chatMessageId,
  localReactions,
}) => {
  const forChat = chatMessageId != null || !!localReactions;
  const { t: _copy } = _useCopy();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { showUserProfile } = useUserProfileSheet();
  const { height: screenHeight } = useWindowDimensions();
  const SHEET_HEIGHT = screenHeight * SHEET_FRACTION;
  const translateY = useSharedValue(SHEET_HEIGHT);
  const backdropOpacity = useSharedValue(0);
  // Android blurs the page behind live and re-samples it on every window
  // draw, so a sheet that scrolls (or plays GIFs) paid for it each frame.
  // A plain scrim there, as the comments sheet and page drawers already use.
  const backdrop = useSheetBackdrop(Platform.OS !== "android");
  const [isFullyClosed, setIsFullyClosed] = useSheetClosed(visible);

  const [people, setPeople] = useState<Person[]>([]);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [totalCount, setTotalCount] = useState(0);
  const [anonymousCount, setAnonymousCount] = useState(0);
  const [canView, setCanView] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const fetchPage = useCallback(
    async (pageNum: number) => {
      if (commentId == null && chatMessageId == null && !localReactions) return;
      if (pageNum === 0) setLoading(true);
      else setLoadingMore(true);
      try {
        if (localReactions) {
          const entries = Object.entries(localReactions).filter(([, who]) => (who?.length ?? 0) > 0);
          const byAddress = new Map<string, string[]>();
          for (const [key, who] of entries) {
            for (let i = who.length - 1; i >= 0; i--) {
              const a = who[i].toLowerCase();
              const list = byAddress.get(a) ?? [];
              if (!list.includes(key)) list.push(key);
              byAddress.set(a, list);
            }
          }
          const counts: Record<string, number> = {};
          entries.forEach(([key, who]) => { counts[key] = who.length; });
          const names = new Map((await getAccountSummaries([...byAddress.keys()])).map((a) => [a.address.toLowerCase(), a]));
          const rows = [...byAddress.entries()]
            .filter(([, emojis]) => !emoji || emojis.includes(emoji))
            .map(([address, emojis]) => {
              const info = names.get(address);
              return {
                address,
                username: info?.username ?? undefined,
                displayName: info?.displayName ?? undefined,
                avatarImageUrl: info?.avatarImageUrl ?? undefined,
                badgeBalance: info?.badgeBalance ?? undefined,
                emojis,
              } as Person;
            });
          setReactionCounts(counts);
          setCanView(true);
          setTotalCount(byAddress.size);
          setAnonymousCount(0);
          setPeople(rows);
          setPage(0);
          setHasMore(false);
          return;
        }
        const chat = chatMessageId != null
          ? await getChatReactors({ messageId: chatMessageId, emoji: emoji ?? undefined, page: pageNum, limit: PAGE_LIMIT })
          : null;
        const res = chat ?? await (loadPage ?? getCommentLikers)({ commentId: commentId!, page: pageNum, limit: PAGE_LIMIT });
        if (chat && pageNum === 0) setReactionCounts(chat.reactionCounts ?? {});
        setCanView(res.canViewLikers !== false);
        setTotalCount(chat?.peopleCount ?? res.pagination?.totalCount ?? res.data.length);
        if (pageNum === 0) setAnonymousCount(res.anonymousBadgeHolderCount ?? 0);
        setPeople((prev) => (pageNum === 0 ? res.data : [...prev, ...res.data]));
        setPage(pageNum);
        setHasMore(!!res.pagination?.hasMore);
      } catch (e) {
        console.error("[CommentLikersSheet] fetch error:", e);
        if (pageNum === 0) setPeople([]);
        setHasMore(false);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [commentId, loadPage, chatMessageId, emoji, localReactions],
  );

  // A new line starts on "All"; a filter tap reloads the open sheet in place.
  useEffect(() => { setEmoji(null); setReactionCounts({}); }, [chatMessageId, localReactions]);

  useEffect(() => {
    if (visible) {
      setIsFullyClosed(false);
      fetchPage(0);
      translateY.value = withTiming(0, { duration: 300, easing: Easing.out(Easing.cubic) });
      backdropOpacity.value = withTiming(1, { duration: 250 });
    } else if (translateY.value >= SHEET_HEIGHT - 1) {
      // Its own swipe or close button already slid it off: drop the window now.
      backdropOpacity.value = 0;
      setIsFullyClosed(true);
    } else {
      // Closed from outside (a pick, a send): slide it away before the window goes.
      translateY.value = withTiming(
        SHEET_HEIGHT,
        { duration: 220, easing: Easing.in(Easing.cubic) },
        () => {
          runOnJS(setIsFullyClosed)(true);
        },
      );
      backdropOpacity.value = withTiming(0, { duration: 180 });
    }
    // fetchPage is stable per commentId; re-running on every render would
    // refetch the list underneath the reader. SHEET_HEIGHT stays out for the
    // same reason: a split-screen or fold resize must not refetch an open sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, translateY, backdropOpacity, fetchPage]);

  const closeSheet = useCallback(() => {
    translateY.value = withTiming(
      SHEET_HEIGHT,
      { duration: 220, easing: Easing.in(Easing.cubic) },
      () => {
        runOnJS(onClose)();
      },
    );
    backdropOpacity.value = withTiming(0, { duration: 180 });
  }, [translateY, backdropOpacity, onClose, SHEET_HEIGHT]);

  const gesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 100 || e.velocityY > 500) {
        runOnJS(closeSheet)();
      } else {
        translateY.value = withTiming(0, { duration: 200, easing: Easing.out(Easing.cubic) });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  const handlePersonPress = useCallback(
    (address: string) => {
      closeSheet();
      showUserProfile(address);
    },
    [closeSheet, showUserProfile],
  );

  const filterKeys = Object.keys(reactionCounts).filter((key) => reactionCounts[key] > 0);

  if (!visible && isFullyClosed) return null;

  return (
    <Modal visible={visible || (Platform.OS === "android" && !isFullyClosed)} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={closeSheet}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <SheetBackdrop backdrop={backdrop} />
          <Pressable style={{ flex: 1 }} onPress={closeSheet} />
        </Animated.View>

        <Animated.View
          style={[glassStyles.sheet, { height: SHEET_HEIGHT, paddingBottom: insets.bottom }, sheetStyle]}
        >
          <SheetGlassFill backdropBlurred={backdrop.blurred} style={[StyleSheet.absoluteFill, glassStyles.overlay]} />

          <GestureDetector gesture={gesture}>
            <Animated.View className="items-center py-2.5">
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" }} />
              <Text style={{ color: "#F9FBFF", fontSize: 15, fontWeight: "600", marginTop: 8 }}>{forChat ? t("reactionInfo.title") : _copy("copy.1aa9573705bf", { defaultValue: "Comment likes" })}{totalCount > 0 && <Text style={{ color: "#8B8D90", fontWeight: "400" }}> · {formatCount(totalCount)}</Text>}
              </Text>
            </Animated.View>
          </GestureDetector>

          {forChat && canView && filterKeys.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
              <Pressable onPress={() => setEmoji(null)} style={[glassStyles.filter, emoji === null && glassStyles.filterOn]}>
                <Text style={{ color: "#F9FBFF", fontSize: 13 }}>{t("filters.all")}</Text>
                <Text style={glassStyles.filterCount}>{formatCount(totalCount)}</Text>
              </Pressable>
              {filterKeys.map((key) => (
                <Pressable key={key} onPress={() => setEmoji(key)} style={[glassStyles.filter, emoji === key && glassStyles.filterOn]}>
                  <InlineEmoji value={key} size={15} />
                  <Text style={glassStyles.filterCount}>{reactionCounts[key]}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {loading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color="#8B8D90" />
            </View>
          ) : !canView ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
              <Text style={{ color: "#6F7174", fontSize: 14, textAlign: "center" }}>
                {forChat ? t("reactionInfo.privateTitle") : t("comments.likersAuthorOnly")}
              </Text>
            </View>
          ) : people.length === 0 && anonymousCount === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: "#6F7174", fontSize: 14 }}>{forChat ? t("reactionInfo.empty") : t("comments.noLikesYet")}</Text>
            </View>
          ) : (
            <FlatList
              data={people}
              keyExtractor={(item, index) => `${item.address}-${index}`}
              renderItem={({ item }) => <PersonRow item={item} onPress={handlePersonPress} />}
              ListHeaderComponent={anonymousCount > 0 ? (
                <View style={glassStyles.anonymousRow}>
                  <Icon name="EyeOff" size={16} color="#A1A1AA" />
                  <Text style={{ color: "#D4D4D8", fontSize: 13, marginLeft: 8 }}>
                    {formatCount(anonymousCount)} {anonymousCount === 1 ? _copy("copy.cab2644828bc", { defaultValue: "like" }) : _copy("copy.b0aa8a6c35b4", { defaultValue: "likes" })}{_copy("copy.57383cdc46dd", { defaultValue: " from anonymous badge " })}{anonymousCount === 1 ? _copy("copy.6e45386daeb0", { defaultValue: "holder" }) : _copy("copy.b550c1397de2", { defaultValue: "holders" })}
                  </Text>
                </View>
              ) : null}
              onEndReached={() => {
                if (hasMore && !loadingMore && !loading) fetchPage(page + 1);
              }}
              onEndReachedThreshold={0.4}
              ListFooterComponent={
                loadingMore ? (
                  <View style={{ paddingVertical: 16 }}>
                    <ActivityIndicator color="#8B8D90" />
                  </View>
                ) : null
              }
              contentContainerStyle={{ paddingBottom: 24 }}
            />
          )}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const glassStyles = StyleSheet.create({
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  },
  overlay: {
    backgroundColor: SHEET_GLASS_FILL,
    borderTopWidth: 1,
    borderColor: SHEET_GLASS_BORDER,
  },
  filter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  filterOn: {
    backgroundColor: "rgba(255,255,255,0.15)",
    borderColor: "rgba(255,255,255,0.30)",
  },
  filterCount: { color: "#8B8D90", fontSize: 13, fontVariant: ["tabular-nums"] },
  anonymousRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
});

export const CommentLikersSheet = memo(CommentLikersSheetComponent);
export default CommentLikersSheet;
