import React, { memo, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import SmartImage from "./SmartImage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import { ScreenNames } from "../../navigation/ScreenNames";
import { quotedPostViewerParams } from "../../navigation/quotedPostViewerParams";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import { getAvatarUrl, getImageUrl, getImageUrlApiSimple, buildFeedImageUrls, getAudioUrl, getBadgeUrlFor, buildCdnPath } from "../../libs/misc";
import { cdnImage, cdnImageSource } from "../../libs/cdnImage";
import { hintedImageRatio } from "../../libs/image-size-hints";
import { isHoldGated, isSubscriberGated } from "../../libs/content-gate";
import { useTokenUnlocked } from "../../libs/unlocked-tokens";
import { formatCount } from "../../libs/format-count";
import { truncate } from "../../libs/strings.util";
import { getNFT, revokeQuote } from "../../services/nft.service";
import { useAuth } from "../../context/AuthContext";
import { toastError, toastSuccess } from "../../libs/toast";
import FeedCardHeader from "../Home/FeedCardHeader";
import FeedGatePreview from "../Home/FeedGatePreview";
import AudioPostPlayer from "../Home/AudioPostPlayer";
import { useAppTheme } from "../../context/ThemeContext";
import { MINIMAL_TAB_LINE } from "../../theme/minimal";

// Minimal theme: a quote is not a box. It keeps no border or fill and is
// marked instead by a 2pt rule down its left edge, the way web draws it.
const MINIMAL_QUOTE_CLASS = "mt-3 pl-3 border-l-2 overflow-hidden";
const MINIMAL_QUOTE_STYLE = { borderLeftColor: MINIMAL_TAB_LINE } as const;

interface QuotedPostEmbedProps {
  /** Full quoted post object from the API (may be null/undefined if unavailable) */
  quotedPost?: any;
  /** Token ID of the quoted post (fallback when quotedPost is null) */
  quotedTokenId?: number | string | null;
  /**
   * The quoted author took their post back out of this quote. The API stops
   * sending it inline, so without this the fallback fetch below would put it
   * straight back.
   */
  revoked?: boolean;
  /** The quote this embed sits in. Given, the quoted author sees Remove. */
  quoteTokenId?: number | string;
}

const QuotedPostEmbed: React.FC<QuotedPostEmbedProps> = memo(
  (props) => {
    const { t } = useTranslation();
    const navigation = useNavigation<any>();
    const { hideUserProfile } = useUserProfileSheet();
    const { isMinimal, skin } = useAppTheme();

    // `quotedTokenId` was documented as "fallback when quotedPost is null" but
    // was only ever used for navigation — it was never actually fetched, so
    // any post whose feed/list response omitted the inline `quotedPost`
    // (leaving only the id) always fell straight to "This post is
    // unavailable" with no author, image, or text. Fetch it here instead.
    // Only when quotedPost is missing entirely — a quotedPost explicitly
    // marked `unavailable: true` is the backend telling us it's really gone
    // (deleted/blocked), and re-fetching that would just waste a request.
    const [fetchedPost, setFetchedPost] = useState<any>(null);
    const [isFetching, setIsFetching] = useState(false);
    const [fetchFailed, setFetchFailed] = useState(false);

    const { user } = useAuth();
    const [removed, setRemoved] = useState(false);
    const [removing, setRemoving] = useState(false);
    // Thumbnails that failed to load. The next candidate takes over, and with
    // none left the box is dropped instead of staying an empty grey slab.
    const [failedThumbs, setFailedThumbs] = useState<string[]>([]);
    const [photoWidth, setPhotoWidth] = useState(0);
    const [loadedPhoto, setLoadedPhoto] = useState<{ url: string; ratio: number }>();
    const isRemoved = !!props.revoked || removed;

    const inlinePost = props.quotedPost;
    const needsFetch = !isRemoved && !inlinePost && !fetchedPost && !fetchFailed;
    const fetchTokenId = props.quotedTokenId ?? undefined;

    useEffect(() => {
      if (!needsFetch || !fetchTokenId) return;
      let cancelled = false;
      setIsFetching(true);
      getNFT(fetchTokenId)
        .then((res: any) => {
          if (cancelled) return;
          const post = res?.result;
          if (post) setFetchedPost(post);
          else setFetchFailed(true);
        })
        .catch(() => {
          if (!cancelled) setFetchFailed(true);
        })
        .finally(() => {
          if (!cancelled) setIsFetching(false);
        });
      return () => {
        cancelled = true;
      };
    }, [needsFetch, fetchTokenId]);

    const quotedPost = inlinePost || fetchedPost;
    const quotedTokenId = props.quotedTokenId;
    const tokenUnlocked = useTokenUnlocked(quotedPost?.tokenId ?? quotedPost?.id ?? quotedTokenId);
    const isAvailable = !!quotedPost && !(quotedPost as any).unavailable;

    const handlePress = useCallback(() => {
      const targetTokenId = quotedPost?.tokenId ?? quotedPost?.id ?? quotedTokenId;
      if (!targetTokenId) return;

      hideUserProfile();
      const viewerParams = isAvailable ? quotedPostViewerParams(quotedPost, targetTokenId) : null;
      if (viewerParams) {
        navigation.navigate(ScreenNames.ShortsViewer, viewerParams);
        return;
      }
      navigation.navigate(ScreenNames.PostResolver, { tokenId: String(targetTokenId) });
    }, [navigation, quotedPost, quotedTokenId, hideUserProfile, isAvailable]);

    const viewer = (user?.address || user?.walletAddress || "").toLowerCase();
    const isQuotedAuthor =
      !!viewer && !!props.quoteTokenId &&
      (quotedPost?.minter || quotedPost?.minterUser?.address || "").toLowerCase() === viewer;

    const handleRemove = useCallback(async () => {
      if (!props.quoteTokenId || removing) return;
      setRemoving(true);
      try {
        await revokeQuote(props.quoteTokenId);
        setRemoved(true);
        toastSuccess(t("quotePolicy.removedToast"));
      } catch {
        toastError(t("quotePolicy.removeFailed"));
      } finally {
        setRemoving(false);
      }
    }, [props.quoteTokenId, removing, t]);

    if (isRemoved) {
      return (
        <View
          className={isMinimal ? `${MINIMAL_QUOTE_CLASS} py-1` : "mt-3 rounded-xl border border-theme-neutrals-800 bg-theme-neutrals-800/30 p-3"}
          style={isMinimal ? MINIMAL_QUOTE_STYLE : skin?.material === 'glass' ? skin.card : undefined}
        >
          <Text className="text-theme-neutrals-500 text-sm">{t("quotePolicy.removed")}</Text>
        </View>
      );
    }

    if (!isAvailable && isFetching) {
      return (
        <View
          className={isMinimal ? `${MINIMAL_QUOTE_CLASS} py-1` : "mt-3 rounded-xl border border-theme-neutrals-800 bg-theme-neutrals-800/30 p-3"}
          style={isMinimal ? MINIMAL_QUOTE_STYLE : skin?.material === 'glass' ? skin.card : undefined}
        >
          <View className="flex-row items-center gap-2">
            <ActivityIndicator size="small" color="#666" />
            <Text className="text-theme-neutrals-500 text-sm">{t("feedCard.loadingQuoted")}</Text>
          </View>
        </View>
      );
    }

    if (!isAvailable) {
      return (
        <View
          className={isMinimal ? `${MINIMAL_QUOTE_CLASS} py-1` : "mt-3 rounded-xl border border-theme-neutrals-800 bg-theme-neutrals-800/30 p-3"}
          style={isMinimal ? MINIMAL_QUOTE_STYLE : skin?.material === 'glass' ? skin.card : undefined}
        >
          <View className="flex-row items-center gap-2">
            <Ionicons name="alert-circle-outline" size={16} color="#6F7174" />
            <Text className="text-theme-neutrals-500 text-sm">
              {t("profile.replyThread.postUnavailable")}
            </Text>
          </View>
        </View>
      );
    }

    const minterUser = quotedPost.minterUser;
    const displayName =
      minterUser?.displayName ||
      minterUser?.username ||
      quotedPost.minterDisplayName ||
      quotedPost.minterUsername ||
      truncate(quotedPost.minter || "", 10, "..");
    const username =
      minterUser?.username || quotedPost.minterUsername;
    const avatarUrl = getAvatarUrl(
      minterUser?.avatarImageUrl || quotedPost.minterAvatarUrl || ""
    );
    const badgeImage = minterUser?.hideBadgeAndBalance
      ? null
      : getBadgeUrlFor(minterUser || quotedPost);
    const text = quotedPost.description || quotedPost.name || quotedPost.title || "";

    const postType = quotedPost.postType;
    const isLivePost = postType === "live";
    const isAudioPost = postType === "feed-audio" || postType === "audio";
    const isVideoPost = !isAudioPost && (postType === "video" || postType === "feed-video" || quotedPost.media_type === "video" || !!quotedPost.videoUrl);
    const imageUrls: string[] = Array.isArray(quotedPost.imageUrls) ? quotedPost.imageUrls.filter(Boolean) : [];
    const photoPath = quotedPost.articleImageUrl || imageUrls[0];
    const isPhoto = !isLivePost && !isAudioPost && !isVideoPost && !!(photoPath || quotedPost.imageUrl);
    const streamInfo = quotedPost.streamInfo;
    const isPPV = !!(quotedPost.is_ppv || streamInfo?.isPayPerView);
    const isHoldLocked = isHoldGated(quotedPost.is_locked || streamInfo?.isLockContent, quotedPost.locked_price ?? streamInfo?.lockAmount ?? streamInfo?.lockContentAmount);
    const canBypassGating = !!(quotedPost.isOwner || quotedPost.isUnlocked || tokenUnlocked);
    const gated = ((isPPV || isHoldLocked) && !canBypassGating) || isSubscriberGated(quotedPost.plansDetails, canBypassGating);
    const showPhoto = isPhoto && !gated;

    // A live's cover is stored at images/{tokenId}.{ext}, where web reads it.
    // The API's imageUrl names the stream's own frame under live/thumbnails/
    // instead, and getImageUrl kept only that file name and put it under
    // images/, a file that does not exist: the quote showed an empty grey box.
    const liveThumbnails = (): string[] => {
      const raw: string = quotedPost.imageUrl || quotedPost.thumbnailUrl || "";
      const id = quotedPost.tokenId ?? quotedPost.id ?? quotedTokenId;
      const ext = (raw.split("?")[0].split(".").pop() || "").toLowerCase();
      const cover = raw.startsWith("http") || raw.startsWith("images/")
        ? raw
        : id != null ? `images/${id}.${/^[a-z0-9]{2,5}$/.test(ext) ? ext : "jpg"}` : "";
      // Then the stream's own frame, for a live set up without a cover.
      const frame: string = quotedPost.stream?.thumbnail || (raw.startsWith("live/") ? raw : "");
      const urls = [cover, frame]
        .filter(Boolean)
        .map((path) => cdnImage(path.startsWith("http") ? path : buildCdnPath(path)!, { width: gated ? 96 : 480 }));
      return Array.from(new Set(urls));
    };

    const posterPath = quotedPost.thumbnail_url || quotedPost.thumbnailUrl;
    const photoUrl = photoPath ? buildFeedImageUrls([photoPath])[0] : getImageUrl(quotedPost.imageUrl || "");
    const photoSource = cdnImageSource(photoUrl);
    const hintedRatio = hintedImageRatio(photoSource);
    const photoRatio = hintedRatio ?? (loadedPhoto && loadedPhoto.url === photoSource ? loadedPhoto.ratio : 1);
    const fittedPhotoWidth = hintedRatio ? Math.min(photoWidth, 420 * hintedRatio) : photoWidth;
    const preferredPhoto = showPhoto ? cdnImage(photoSource, { width: fittedPhotoWidth, quality: 88 }) : cdnImage(photoSource, { width: 96 });
    const legacyPhoto = showPhoto && postType === "feed-images" && imageUrls[0] && !/^https?:/i.test(imageUrls[0])
      ? getImageUrlApiSimple(imageUrls[0]) : undefined;
    const posterWidth = gated ? 96 : 480;
    const posterUrl = quotedPost.thumbnail_url && !/^https?:/i.test(quotedPost.thumbnail_url)
      ? cdnImage(buildCdnPath(quotedPost.thumbnail_url), { width: posterWidth })
      : getImageUrl(posterPath || quotedPost.imageUrl || "", posterWidth);
    const fallbackPosterUrl = getImageUrl(quotedPost.imageUrl || quotedPost.thumbnailUrl || "", posterWidth);
    const thumbnailCandidates = isLivePost ? liveThumbnails() : isPhoto ? [preferredPhoto, legacyPhoto] : [posterUrl, fallbackPosterUrl];
    const thumbnailUrl = thumbnailCandidates.find((url) => url && !failedThumbs.includes(url));
    const waitingForPhotoWidth = showPhoto && photoWidth === 0;

    return (
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.7}
        className={isMinimal ? MINIMAL_QUOTE_CLASS : "mt-3 rounded-2xl border border-theme-neutrals-700 bg-theme-neutrals-800/30 overflow-hidden"}
        style={isMinimal ? MINIMAL_QUOTE_STYLE : skin?.material === 'glass' ? skin.card : undefined}
      >
        {/* Content */}
        {/* Minimal: the rule's pl-3 already insets the text, so only vertical padding here. */}
        <View className={isMinimal ? "pt-2 pb-1" : "p-3"}>
          {!!quotedPost.articleBody && <Text className="text-white/60 text-xs font-semibold uppercase mb-1">{t("articles.label")}</Text>}
          {/* Creator row: the same header a normal post uses (avatar, name,
              badge, handle on its own line), minus the post controls. */}
          <FeedCardHeader
            avatarUrl={avatarUrl}
            displayName={displayName}
            username={username}
            address={minterUser?.address || quotedPost.minter}
            badgeImage={badgeImage}
            onUserPress={handlePress}
          />

          {/* Text excerpt */}
          {text.length > 0 && (
            <Text className="text-theme-neutrals-100 text-base leading-6" numberOfLines={6}>
              {text}
            </Text>
          )}

          {isQuotedAuthor && (
            <TouchableOpacity
              onPress={handleRemove}
              disabled={removing}
              accessibilityRole="button"
              className="self-start mt-2 rounded-full border border-white/15 px-3 py-1"
              style={{ opacity: removing ? 0.5 : 1 }}
            >
              <Text className="text-theme-neutrals-300 text-xs">{t("quotePolicy.remove")}</Text>
            </TouchableOpacity>
          )}
        </View>

        {isAudioPost && !!quotedPost.audioUrl && (
          <View className={isMinimal ? "pb-1" : "px-3 pb-3"}>
            <AudioPostPlayer
              audioUrl={getAudioUrl(quotedPost.audioUrl)}
              duration={quotedPost.audioDuration || 0}
              tokenId={quotedPost.tokenId || quotedPost.id || quotedTokenId || 0}
              title={quotedPost.name || quotedPost.title || t("audioPost.untitled")}
              artist={displayName || t("feedCard.dehubCreator")}
              artworkUrl={avatarUrl || undefined}
              compact
            />
          </View>
        )}

        {!isAudioPost && (thumbnailUrl || gated) && (
          <View
            className="w-full bg-theme-neutrals-800/40"
            style={{ aspectRatio: showPhoto ? photoRatio : 16 / 9, maxHeight: showPhoto ? 420 : 240 }}
            onLayout={showPhoto ? ({ nativeEvent }) => setPhotoWidth(nativeEvent.layout.width) : undefined}
          >
            {gated ? (
              <>
                <FeedGatePreview uri={thumbnailUrl} priority="normal" />
                <View className="absolute inset-0 items-center justify-center gap-1 bg-black/40 dark-surface">
                  <Ionicons name="lock-closed" size={19} color="#fff" />
                  <Text className="text-white text-xs font-semibold">{isPPV ? t("drawers.ppvTitle") : t("drawers.gatedTitle")}</Text>
                </View>
              </>
            ) : thumbnailUrl && !waitingForPhotoWidth && (
              <SmartImage
                source={{ uri: thumbnailUrl }}
                recyclingKey={thumbnailUrl}
                style={{ width: "100%", height: "100%" }}
                contentFit={showPhoto ? "contain" : "cover"}
                onLoad={showPhoto && !hintedRatio ? ({ source }) => {
                  if (source.width && source.height) setLoadedPhoto({ url: photoSource, ratio: source.width / source.height });
                } : undefined}
                onError={() => setFailedThumbs((failed) => failed.includes(thumbnailUrl) ? failed : [...failed, thumbnailUrl])}
              />
            )}
            {!gated && (isVideoPost || isLivePost) && (
              <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
                <View className="w-10 h-10 items-center justify-center rounded-full bg-black/60">
                  <Ionicons name="play" size={18} color="#fff" />
                </View>
              </View>
            )}
            {showPhoto && imageUrls.length > 1 && (
              <View className="absolute top-2 right-2 flex-row items-center gap-1 rounded-lg bg-black/60 px-2 py-1 dark-surface">
                <Ionicons name="images-outline" size={14} color="#fff" />
                <Text className="text-white text-xs font-medium">{formatCount(imageUrls.length)}</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  }
);

QuotedPostEmbed.displayName = "QuotedPostEmbed";

export default QuotedPostEmbed;
