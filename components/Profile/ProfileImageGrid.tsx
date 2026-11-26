import React, { memo, useCallback, useMemo, useState } from "react";
import { View, TouchableOpacity, StyleSheet, useWindowDimensions, type LayoutChangeEvent, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { Image } from "expo-image";
import FeedCard from "../Home/FeedCard";
import { useTranslation } from "react-i18next";
import { useFeedCardVisibility } from "../../hooks/useFeedCardVisibility";
import { useProfileViewMode } from "../../libs/profileViewMode";
import type { UnifiedFeedItem as ImagePost } from "../../services/feed.unified.service";
import Icon from "../ui/Icon";
import { getImageUrlApiSimple } from "../../libs/misc";
import { useAppTheme } from "../../context/ThemeContext";
import { useCinematicPhone } from "../../hooks/useCinematicPhone";
import { TAB_BAR_CONTENT_INSET } from "../../navigation/tabBarLayout";
import { PaneAnimatedFlatList } from "./profilePaneScroll";
import { hintedImageRatio } from "../../libs/image-size-hints";
import { profilePhotoRows } from "../../libs/profile-photo-rows";

const imagePath = (post: ImagePost) => post.imageUrls?.[0] || post.imageUrl || post.thumbnailUrl || "";

interface ProfileImageGridProps {
  images: ImagePost[];
  listRef?: React.RefObject<import("react-native").FlatList<any> | null>;
  onImagePress?: (index: number) => void;
  onBeforeNavigate?: () => void;
  scrollEnabled?: boolean;
  /** Either a plain callback, or a Reanimated worklet scroll handler. */
  onScroll?: ((e: NativeSyntheticEvent<NativeScrollEvent>) => void) | any;
  ListHeaderComponent?: React.ReactElement | null;
}

const ImageTile = memo(function ImageTile({ post, width, height, radius, placeholder, onPress }: {
  post: ImagePost;
  width: number;
  height: number;
  radius: number;
  placeholder: string;
  onPress?: () => void;
}) {
  const { t } = useTranslation();
  const path = imagePath(post);
  const uri = path ? getImageUrlApiSimple(path) : "";
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={post.mediaDescriptions?.[0] || post.description || t("profileImage.view")}
      disabled={!onPress}
      onPress={onPress}
      style={{ width, height, borderRadius: radius, overflow: "hidden", backgroundColor: placeholder }}
    >
      <Image
        source={uri || undefined}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        recyclingKey={uri}
        cachePolicy="memory-disk"
        transition={150}
      />
      {(post.imageUrls?.length ?? 0) > 1 && (
        <View style={s.multiIcon}>
          <Icon name="Copy" size={14} color="#fff" />
        </View>
      )}
    </TouchableOpacity>
  );
});

const ProfileImageGrid: React.FC<ProfileImageGridProps> = ({ images, listRef, onImagePress, onBeforeNavigate, scrollEnabled = true, onScroll, ListHeaderComponent }) => {
  const viewMode = useProfileViewMode();
  const { theme, isMinimal, colors } = useAppTheme();
  const cinematicPhone = useCinematicPhone();
  const cinematic = cinematicPhone && !!ListHeaderComponent;
  const { width: screenWidth } = useWindowDimensions();
  const [layoutWidth, setLayoutWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => setLayoutWidth(event.nativeEvent.layout.width), []);
  const gridWidth = layoutWidth || screenWidth;
  const adaptive = theme !== "system" && !isMinimal;
  const padding = cinematic || isMinimal ? 0 : 8;
  const gap = isMinimal ? 1 : adaptive ? 8 : 2;
  const radius = adaptive && !cinematicPhone ? 12 : 0;

  const rows = useMemo(() => {
    let offset = 0;
    return profilePhotoRows(images.map(post => hintedImageRatio(imagePath(post))), adaptive)
      .map(({ start, count, tracks }) => {
        const width = Math.max(0, gridWidth - 2 * padding - (tracks.length - 1) * gap);
        const height = width / tracks.reduce((total, track) => total + track, 0);
        const row = { start, count, tracks, height, offset };
        offset += height + gap;
        return row;
      });
  }, [images, adaptive, gridWidth, padding, gap]);
  const imageKey = useCallback((item: ImagePost, index: number) => String(item.tokenId ?? item.id ?? index), []);
  const visibility = useFeedCardVisibility(imageKey as (item: unknown, index: number) => string);

  const renderRow = useCallback(
    ({ item: row }: { item: (typeof rows)[number] }) => (
      <View style={[s.row, { gap, marginBottom: gap }]}>
        {images.slice(row.start, row.start + row.count).map((post, column) => {
          const index = row.start + column;
          return (
            <ImageTile
              key={imageKey(post, index)}
              post={post}
              width={row.height * row.tracks[column]}
              height={row.height}
              placeholder={colors.card}
              radius={radius}
              onPress={onImagePress ? () => onImagePress(index) : undefined}
            />
          );
        })}
      </View>
    ),
    [images, imageKey, gap, colors.card, radius, onImagePress],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: rows[index].height + gap, offset: rows[index].offset, index }),
    [rows, gap],
  );

  if (images.length === 0) return ListHeaderComponent ?? null;

  if (viewMode === "list") {
    return (
      <PaneAnimatedFlatList
        key="image-list"
        ref={listRef}
        data={images}
        keyExtractor={imageKey}
        viewabilityConfig={visibility.viewabilityConfig}
        onViewableItemsChanged={visibility.onViewableItemsChanged}
        extraData={visibility.visibilityExtraData}
        renderItem={({ item, index }) => (
          <View className="px-2">
            <FeedCard
              item={item}
              cinematic={cinematic}
              isVisible={visibility.isItemVisible(imageKey(item, index))}
              isAutoplayActive={false}
              onBeforeNavigate={onBeforeNavigate}
            />
          </View>
        )}
        ListHeaderComponent={ListHeaderComponent}
        contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_INSET }}
        scrollEnabled={scrollEnabled}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      />
    );
  }

  return (
    <PaneAnimatedFlatList
      ref={listRef}
      data={rows}
      keyExtractor={(row: (typeof rows)[number]) => String(row.start)}
      renderItem={renderRow}
      // A variable-height header isn't included in the row offsets.
      getItemLayout={ListHeaderComponent ? undefined : getItemLayout}
      onLayout={onLayout}
      contentContainerStyle={{ paddingHorizontal: padding, paddingBottom: TAB_BAR_CONTENT_INSET }}
      showsVerticalScrollIndicator={false}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={5}
      removeClippedSubviews={false}
      scrollEnabled={scrollEnabled}
      onScroll={onScroll}
      ListHeaderComponent={ListHeaderComponent}
      scrollEventThrottle={16}
    />
  );
};

const s = StyleSheet.create({
  row: { flexDirection: "row" },
  multiIcon: { position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.4)", borderRadius: 6, padding: 3 },
});

export default memo(ProfileImageGrid);
