import { tokenLabel } from '../libs/token-label';
import { usePurchaseOfferVisible } from "../config/storefront";
import { useCommentCount } from '../libs/comment-count-store';
import RemixCredits from "../components/Post/RemixCredits";
import { useTranslation as _useCopy } from 'react-i18next';
import { useVideoDownload } from "../context/VideoDownloadContext";
import { soundWindowCorrection } from "../libs/soundWindow";
import { isHoldGated, cheapestSubscriberQuote, formatSubscriberTokens } from "../libs/content-gate";
import { useStreamAccessInfo } from "../libs/validators.util";
import { DIGITAL_PURCHASES_ENABLED, MATURE_CONTENT_ENABLED } from "../config/storefront";
import { useBackPress } from "../hooks/useBackPress";
import { fetchVideoAccess, isVideoAccessExpiring, useVideoAccess, videoNeedsAccess } from "../libs/video-access";
import { usePostVideoPlayer } from '../hooks/usePostVideoPlayer';
import { postMediaIsTransferring, preparePostMediaNavigation } from '../libs/post-media-session';
import { optionalSkia } from '../libs/skia';
import { toStoryboard } from '../libs/storyboard';
import StoryboardPreview from '../components/VideoPlayerCore/StoryboardPreview';
import { takeFullscreenClosedUpright } from '../libs/turned-fullscreen';
import * as ScreenOrientation from 'expo-screen-orientation';
import { closeInAppVideoMini, finishInAppMiniRestore, getInAppVideoMini, openInAppVideoMini, subscribeInAppVideoMini } from '../libs/in-app-video-mini';
import { containedPicture } from '../libs/live-overlay/layout';
import { videoQuarterTurn } from '../libs/video-display-aspect';
import { startsOnVideoPicture, commitsVideoMinimize, minimizeDrag, draggedPictureRect, pictureBoxTranslate } from '../libs/video-minimize-gesture';
import { settlesSwipeBack, swipeBackProgress, SWIPE_BACK_SPRING } from '../libs/swipe-back';
import { useOwnEdgeSwipe } from '../hooks/useSwipeBack';
import { commitsDismiss, heldRate, holdSideAt, seekSideAt, HOLD_BASE_RATE, REWIND_TICK_MS, SEEK_JUMP_SECONDS } from '../libs/video-hold-gestures';
import { usePlaybackRecovery } from '../hooks/usePlaybackRecovery';
import { markHlsFailed, useHlsFallback } from '../libs/hls-fallback';
import { PersistentVideoView } from '../components/common/PersistentVideoView';
import { isPictureInPicturePlayer, canStartVideo, subscribePictureInPicture, getPictureInPicturePlayer } from '../libs/pictureInPicture';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFeedPlaybackAllowed, useFeedSurfaceActive } from "../libs/visualActivity";
/**
 * Shorts Viewer — full-screen vertical carousel.
 *
 * The chrome mirrors the web viewer (dehubweb
 * src/components/app/cards/ShortsViewer.tsx): a horizontal action row spread
 * across the bottom of the frame in feed-card order — views · tip ·
 * share · comments · like (👎 lives in its hold tray), with like at the far
 * right for thumb reach — and the
 * creator row + caption stacked above it. Back sits top-left; playback speed,
 * mute and the options menu top-right. Bookmark and the moderation actions live
 * in that menu rather than on the row, as on web.
 *
 * What web puts a fill behind is exactly the four top buttons, and nothing
 * else: the action row is bare icons with a text shadow over the bottom scrim.
 * This screen used to draw a glass slab under that row too, which is what made
 * it read as a different app. The action row's five cells are still equal flex
 * shares rather than `space-between` over content-sized children, so the icons
 * hold a fixed grid no matter how wide the counts under them get, with the two
 * end cells aligned outwards so the row still spans edge to edge.
 *
 * Every margin is a flat EDGE with no safe-area inset added — see the EDGE
 * comment; the navigator already sits inside a SafeAreaView.
 *
 * Two gestures clear and restore the chrome, both ported from web: swipe down
 * over the bottom stack to clear it, swipe up in that area to bring it back.
 * A tap in the middle band also restores it; other video taps pause/play.
 * Holding the middle of the frame still hides it for a screenshot for as long
 * as the finger is down. See HIDE_SWIPE_MIN / RESTORE_ZONE_TOP.
 *
 * Engagement goes through the shared overlay (libs/engagementCache) instead of
 * local state, so a like cast here is the same like the feed card shows — the
 * mobile equivalent of web's vote cache.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  useWindowDimensions,
  Pressable,
  StatusBar,
  StyleSheet,
  ViewToken,
  LayoutChangeEvent,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Animated,
  ActivityIndicator,
  StyleProp,
  ViewStyle,
  Platform,
  AccessibilityInfo,
  Easing,
  PanResponder,
  AppState,
  Keyboard,
} from "react-native";
import useKeyboard from "../hooks/useKeyboard";
import { knownVideoAspect, rememberVideoAspect } from "../hooks/useMediaAspect";
import Reanimated, { cancelAnimation, FadeIn, FadeOut, ZoomIn, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { GestureType, NativeGesture } from "react-native-gesture-handler";
import { useRoute, useNavigation } from "@react-navigation/native";
import { VideoView, useVideoPlayer } from "expo-video";
import { downloadGalleryImage } from "../libs/downloadGalleryImage";
import { galleryIndex } from "../libs/media-presentation";
import { cdnImageSource } from "../libs/cdnImage";
import { isShortsPhoto, shortsPhotoMedia } from "../libs/shortsPhotos";
import { ShortsPhotoPager } from "../components/Post/ShortsPhotoPager";
import { useAppTheme } from "../context/ThemeContext";
import { LIGHT_PAGE_FILL } from "../theme/colors";
import { useSettledVideoSource } from "../hooks/useSettledVideoSource";
import { useSettledPagerIndex } from "../hooks/useSettledPagerIndex";
import PictureInPictureButton from "../components/common/PictureInPictureButton";
import { configureForBackgroundPlayback, releaseBackgroundPlayback } from "../libs/audioSession";
import { setPlayerProp } from "../libs/playerProps";
import { setThemeBackdropVisible } from "../libs/themeBackdrop";
import { FEED_BUFFER_OPTIONS } from "../libs/videoBuffering";
import { useScrubGesture } from "../hooks/useScrubGesture";
import { useDataSaver } from "../hooks/useDataSaver";
import { isLowEndDevice } from "../libs/deviceTier";
import { useFeedVolumeResponder } from "../libs/feed-volume-responder";
import { getVolume, setVolume as persistVolume, getIsLooping, setIsLooping as persistLooping, useMediaLooping, getPlaybackRateFor, setPlaybackRate as persistPlaybackRate } from "../libs/video-preferences";
import { getCachedMuted, setMutedState, useMediaMuted } from "../libs/videoMutedState";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import BlurSafeImage from "../components/common/BlurSafeImage";
import Icon from "../components/ui/Icon";
import { DistributeIcon } from "../components/ui/DistributeIcon";
import { useAppPrefs } from "../hooks/useAppPrefs";
import type { IconName } from "../components/ui/Icon";
import {
  ChromeFill,
  ChromeTouchTarget,
  CHROME_HIT_SLOP,
  CHROME_SIZE,
  COUNT_COLOR,
  EDGE,
  ICON_COLOR,
  TEXT_SHADOW,
} from "../components/common/ViewerChrome";
import { CommentBottomSheet } from "../components/Comments";
import { useUser, useAuthActions, useAuthState } from "../context/AuthContext";
import { useEngagementWeight } from "../hooks/useEngagementWeight";
import { appliedEngagementWeight } from "../libs/engagement-weight";
import { useUserProfileSheet } from "../context/UserProfileSheetContext";
import {
  getVideoUrl,
  getPlaybackUrl,
  getShortsThumbnailUrl,
  resolveThumbnail,
  DEFAULT_BANNER_SENTINEL,
  getAvatarUrl,
  getBadgeUrlFor,
  getBadgeOpticalStyle,
  formatCompactNumber,
  toastError,
  toastSuccess,
  toastInfo,
  copyToClipboard,
} from "../libs";
import { voteOnNFT, reactToNFT, getNFT } from "../services/nft.service";
import ReactionPicker from "../components/Home/ReactionPicker";
import ReactionInfoSheet from "../components/Home/ReactionInfoSheet";
import ShareSheet from "../components/Home/ShareSheet";
import ShareToDmSheet from "../components/DM/ShareToDmSheet";
import PostOptionsMenu from "../components/common/PostOptionsMenu";
import BoostSheet from "../components/common/BoostSheet";
import { useSuperpowers } from "../hooks/useSuperpowers";
import Avatar from "../components/common/Avatar";
import BadgeArtwork from "../components/common/BadgeArtwork";
import TranslateButton from "../components/ui/TranslateButton";
import { useTranslation } from "../hooks/useTranslation";
import {
  applyReactionDelta,
  isPositiveReaction,
  reactionForTap,
  reactionMeta,
  resolveLeadReaction,
  resolveThumbReaction,
  resolveThumbCount,
  type PostReaction,
} from "../libs/reactions";
import { ReactionEmoji } from "../components/Home/ReactionEmoji";
import { ThumbNodIf } from "../components/Home/ThumbNod";
import {
  applyEngagement,
  engagementKeyOf,
  isFailedResponse,
  revertEngagement,
  useEngagement,
} from "../libs/engagementCache";
import {
  usePostLinkCopyCount,
  useLinkCopyFloor,
  useTrackPostLinkCopy,
} from "../libs/link-copy-count";
import { savePost } from "../services/feed.service";
import { toggleRepost } from "../services/repost.service";
import { getShortsFeed, getUnifiedFeed } from "../services/feed.unified.service";
import { createBrainrotSource } from "../libs/brainrotFeed";
import { shortsFeedFetchers } from "../navigation/warmShortsFeed";
import { postWarmKey, seedPostDetail, warmRequest } from "../libs/navPrefetch";
import { isContentWarningSeen, markContentWarningSeen } from "../libs/contentWarningSeen";
import MatureContentGate from "../components/Home/MatureContentGate";
import { useKidsModeLock } from "../hooks/useKidsModeLock";
import WarningShortSlide from "../components/Shorts/WarningShortSlide";
import { profileFeedParams } from "../libs/profileFeedOrigin";
import { canOpenPostVideoViewer } from "../navigation/postVideoViewerParams";
import type { UnifiedFeedItem } from "../services/feed.unified.service";
import { ScreenNames } from "../navigation/ScreenNames";
import { useQuery } from "@tanstack/react-query";
import { getLiveVideos } from "../services/live.service";
import { interleaveLive, isLiveSlide, isVerticalFeedLive, LIVE_SLIDE_EVERY, LIVE_SLIDE_MAX, toLiveSlide } from "../libs/live-shorts";
import { isAuthorBlocked, useBlockedAuthorsVersion } from "../libs/blocked-authors";
import LiveShortSlide from "../components/Shorts/LiveShortSlide";
import ReelStillSlide from "../components/Shorts/ReelStillSlide";
import { isReelSlide, isReelVideo, reelStillOf } from "../libs/profileReel";
import { ShareLinks } from "../navigation/linking.config";
import { requestAudioFocus, releaseAudioFocus } from "../libs/audioFocus";
import { requestFeedVideoFocus, releaseFeedVideoFocus } from "../libs/feedVideoFocus";
import {
  continuesTapGesture,
  TAP_GESTURE_WINDOW_MS,
  TAP_LIKE_ANIMATION_MS,
  TAP_LOVE_ANIMATION_MS,
  TAP_REACTION_RESOLUTION_MS,
} from "../libs/tap-gesture";
import { MEDIA_TAP_SLOP_PX } from "../libs/media-gesture";
import { blockQuickActions } from "../libs/quickActions";
import GlassTipSheet from "../components/Tip/GlassTipSheet";
import { resolveViewCount } from "../libs/numbers.util";
import { useTranslation as useCopy } from "react-i18next";
import { hideDislikedPost, restoreDislikedPost } from "../libs/disliked-posts-store";
import { trackPlayerWatchTime } from "../libs/watch-time";
import { useVideoSoundtrack } from "../hooks/useVideoSoundtrack";
import { parseSoundtrack } from "../libs/parseSoundtrack";
import { applyVideoVolume } from "../libs/dub-mix";



/** Same ladder the web viewer cycles through on its speed button. */
const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const;
const formatRate = (rate: number) => `${rate}x`;

/**
 * Frame margin, chrome button size and fill, icon and count colours, the text
 * shadow and the ChromeFill glass all live in components/common/ViewerChrome
 * now, shared with the live viewer so the two fullscreen surfaces cannot
 * drift apart again. The reasoning behind each number is in that file.
 */

/**
 * Swipe down over the bottom stack to clear the chrome, then swipe up in the
 * lower area to bring it back. Both directions use the same 40px threshold.
 *
 * RN and the DOM differ in the one way that matters here. On web the overlay
 * is `pointer-events-auto` above the carousel's drag layer, so a drag that
 * begins on the caption never reaches it. In RN a cell's child does not
 * shield the paging FlatList, so the same drag would page to the previous
 * short *and* clear the chrome.
 *
 * Winning that race takes gesture-handler, not RN's own responder system.
 * A JS responder cannot get there in time: Android's ScrollView intercepts at
 * the 8dp touch slop and `notifyNativeGestureStarted` then stops delivering
 * touches to JS entirely, and on iOS RCTScrollView cancels the JS touch
 * stream when its pan recognizer begins. So the claim is a manually-activated
 * `Gesture.Pan`, deciding on the UI thread the same way ImageFeedDrawer's
 * `contentPan` does, and declaring `blocksExternalGesture` against the pager
 * so the list has to wait for this gesture to fail before it scrolls.
 *
 * Because the relation makes the pager *wait*, there is no race left to win
 * and the thresholds can be comfortable rather than hair-trigger. The cost is
 * that the pager is held for as long as this gesture stays undecided, so the
 * direction has to be resolved quickly and released the moment it is not a
 * downward drag — hence a small RELEASE threshold against a larger CLAIM one.
 * Get that wrong and the whole bottom stack becomes a paging dead zone.
 *
 * HIDE_SWIPE_MIN stays at web's 40 as the commit threshold: a drag shorter
 * than that simply does nothing and the chrome stays put.
 */
const HIDE_SWIPE_MIN = 40;
/** Downward travel that makes the drag ours. Above a tap's incidental drift. */
const DRAG_CLAIM_MIN = 16;
/** Travel in any other direction that hands the drag straight back to the pager. */
const DRAG_RELEASE_MIN = 6;
const RESTORE_ZONE_TOP = 0.61; // 30% -> 24% of the frame (20% smaller).
const RESTORE_ZONE_BOTTOM = 0.85;
// The play/pause target: the middle third of the frame on both axes, as web.
// A tap outside it hides or shows the buttons instead.
const PAUSE_ZONE_START = 1 / 3;
const PAUSE_ZONE_END = 2 / 3;
// Swipe back: a drag right pulls the viewer off to the right,
// following the finger, and leaves it on release if it is on its way out
// (libs/swipe-back).
// The back drag starts anywhere on the clip, like the page-wide back drag on
// every other screen. It claims after 20pt sideways, so the photo pager
// (15pt) still turns photos and a vertical flick (12pt) still pages.
/** The player's button row along the bottom, and the scrubber row above it. */
const TOOLS_HEIGHT = CHROME_SIZE;
const SCRUB_HEIGHT = 44;
const EDGE_BACK_CLAIM = 20;
const EDGE_BACK_FAIL_Y = 12;
// iPhone too: the viewer is a transparent modal, which has no sideways pop
// of its own, so without this a Short could only be left with the Back button.
const EDGE_BACK_ENABLED = true;
/** Corner radius of the in-app mini player the drag-down lands in. */
const MINI_RADIUS = 10;
/** A clip at least this much wider than tall leaves the screen empty above and below it. */
const WIDE_CLIP_ASPECT = 1.2;
const CLEAN_STAGE_INSET = 12;
const CLEAN_STAGE_RADIUS = 16;
const PINCH_MAX_SCALE = 4;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { KeepDarkScope } = require('../libs/jsx/tone') as { KeepDarkScope: React.FC<{ children: React.ReactNode }> };
const WideVideoFill = optionalSkia(() => (require('../components/Home/WideVideoFill') as typeof import('../components/Home/WideVideoFill')).default);
/** The settle after letting go of a drag down that did not leave. */
const DISMISS_SPRING = { damping: 26, stiffness: 320, mass: 0.8 };
const DISMISS_OUT_MS = 200;

/**
 * How long a short plays untouched before the chrome clears itself.
 *
 * The swipe-down above is a deliberate act, and almost nobody discovers it —
 * so a short played straight through kept its caption, avatar and action row
 * over the frame for its whole run. This is the same clear, reached by doing
 * nothing: long enough to read who posted it, short enough that the video is
 * unobstructed for most of its length.
 *
 * Any tap brings it back (and re-arms this), as does pausing, expanding the
 * caption, or opening any sheet — see `autoHidden`. Unlike the swipe it never
 * carries to the next short, because the timer restarts with each one.
 */
const AUTO_HIDE_MS = 3000;

/** Small, upward-weighted satellites for the Love bloom. */
const LOVE_BLOOM = [
  { x: -14, y: -54, size: 14 },
  { x: -44, y: -30, size: 10 },
  { x: 38, y: -34, size: 11 },
  { x: -50, y: 2, size: 8 },
  { x: 46, y: 4, size: 9 },
] as const;

interface ActionButtonProps {
  icon: IconName;
  /** Drawn in place of the icon (the optional Distribute share glyph). */
  iconNode?: React.ReactNode;
  /** Renders in place of the icon — used to show a reaction emoji. */
  /** The reaction whose emoji replaces the icon. */
  glyph?: PostReaction;
  /** The glyph is the viewer's own reaction, so it plays its animation. */
  glyphAnimated?: boolean;
  /** With glyphAnimated, whether it is moving right now (false holds a frame). */
  glyphPlaying?: boolean;
  /** The icon is your own 👍 / 👎: it nods once every 5 seconds. */
  nod?: "up" | "down";
  active?: boolean;
  label?: string;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  /** Overrides the stretch-to-fill cell. Only the like button needs it — see below. */
  style?: StyleProp<ViewStyle>;
  /** The pager, so a tap while it is still settling from a swipe still presses. */
  pagerGesture?: ReturnType<typeof Gesture.Native>;
}

/**
 * One button on the bottom bar. Icon and count sit side by side, matching the
 * feed card's bar (FeedActionBar) and the web viewer's row.
 *
 * The button IS the cell: it stretches to fill an equal share of the bar, so
 * the icons sit on a fixed grid. The row used to be `space-between` over
 * content-sized children, which let a count growing from "9" to "12.4K" shove
 * every icon beside it sideways.
 */
const ActionButton: React.FC<ActionButtonProps> = ({
  icon,
  iconNode,
  glyph,
  glyphAnimated,
  glyphPlaying = true,
  nod,
  active,
  label,
  onPress,
  onLongPress,
  accessibilityLabel,
  style,
  pagerGesture,
}) => {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(() => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.3, duration: 100, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 220, useNativeDriver: true }),
    ]).start();
    onPress();
  }, [onPress, scale]);

  /**
   * Gesture-handler rather than a Pressable. Right after a swipe the pager is
   * still settling, and the touch that lands on a button there also reaches
   * the pager, which takes it to stop the glide; that cancelled a Pressable,
   * so like, share and comments needed a second tap. These recognizers run
   * alongside the pager instead of losing to it.
   */
  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .maxDistance(MEDIA_TAP_SLOP_PX)
      .runOnJS(true)
      .onEnd((_event, success) => { if (success) handlePress(); });
    if (pagerGesture) tap.simultaneousWithExternalGesture(pagerGesture);
    if (!onLongPress) return tap;
    // Matches the web tray's 400ms hold so the gesture feels the same on both.
    const hold = Gesture.LongPress()
      .minDuration(400)
      .maxDistance(MEDIA_TAP_SLOP_PX)
      .runOnJS(true)
      .onStart(() => onLongPress());
    if (pagerGesture) hold.simultaneousWithExternalGesture(pagerGesture);
    return Gesture.Exclusive(hold, tap);
  }, [handlePress, onLongPress, pagerGesture]);

  return (
    <GestureDetector gesture={gesture}>
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={onLongPress ? [{ name: "activate" }, { name: "longpress" }] : [{ name: "activate" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "longpress") onLongPress?.();
        else handlePress();
      }}
      collapsable={false}
      // No hitSlop: the cell carries `minHeight: 44` and an equal share of the
      // row's width (~56pt), so it already clears the 44pt minimum on its own,
      // and slop here would make adjacent cells overlap and steal each other's
      // taps. If that minHeight ever goes, this needs slop instead.
      style={style ?? styles.actionCell}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {iconNode ? iconNode : glyph ? (
          <ReactionEmoji reaction={glyph} animate={glyphAnimated} playing={glyphPlaying} size={22} textStyle={styles.actionGlyph} />
        ) : (
          <ThumbNodIf nod={nod} playing={glyphPlaying}>
            {/* Web's `w-5 h-5`. */}
            <Icon
              name={icon}
              size={20}
              color={ICON_COLOR}
              strokeWidth={1.8}
              fill={active ? ICON_COLOR : "none"}
            />
          </ThumbNodIf>
        )}
      </Animated.View>
      {label !== undefined && (
        <Text style={styles.actionCount} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
    </GestureDetector>
  );
};

/**
 * What the pager can ask of a short while a drag is under way, without a
 * re-render: start it silently as it slides in, stop it if the drag turns
 * back, and move the sound across once the release is carrying the pager on.
 */
interface ShortPeek {
  start: () => void;
  stop: (rewind: boolean) => void;
  /** The peeking short takes the viewer's sound setting. */
  hear: () => void;
  /** The short being left goes quiet (true) or gets its sound back (false). */
  silence: (quiet: boolean) => void;
}

/** Same as the pager's keyExtractor, so both sides name a short the same way. */
const peekKeyOf = (item: UnifiedFeedItem) => String(item.tokenId ?? item.id ?? "");

/** Pager travel (points) before the short it is heading for starts playing. */
const PEEK_START_PT = 8;

/** How long the pager must be still, finger off, before it is put back on a short. */
const PAGER_RESNAP_QUIET_MS = 220;

interface ShortItemProps {
  item: UnifiedFeedItem;
  /** Lets the pager start this short silently while it is dragged in. */
  registerPeek?: (key: string, peek: ShortPeek | null) => void;
  thumbnailOverride?: string;
  isActive: boolean;
  isNearby: boolean;
  activeVideoRef: React.RefObject<VideoView | null>;
  itemHeight: number;
  viewportHeight: number;
  miniReveal: SharedValue<number>;
  /** How far the whole viewer is pulled right by the edge back, in points. */
  backDrag: SharedValue<number>;
  /** Set once a released edge back is on its way out. */
  backLeaving: SharedValue<boolean>;
  /** The page has slid fully off; the viewer pops its route. */
  onSwipeBackSettled: () => void;
  /** How far the whole viewer is dragged down on the first short. */
  dismissY: SharedValue<number>;
  /** The first short, where a drag down leaves instead of paging back. */
  isFirst: boolean;
  /** A hold is speeding or rewinding, so the pager must not move under it. */
  onHoldActiveChange: (active: boolean) => void;
  captureViewerState: () => NonNullable<import('../libs/in-app-video-mini').InAppVideoMini['restoreParams']>;
  /** Viewer-level, so mute, volume and speed carry across shorts as they do on web. */
  isMuted: boolean;
  /** 0 → 1, held-and-dragged on the speaker in the top chrome. */
  volume: number;
  playbackRate: number;
  /**
   * The pager's own gesture, so the swipe-down can declare that the list must
   * wait on it rather than race it. See hidePan.
   */
  pagerGesture: NativeGesture;
  /**
   * Reports the hide-the-chrome state up to the screen, so the top bar and its
   * scrim disappear with the bottom stack. They live outside this component
   * and used to stay on screen through a "hide the chrome" gesture.
   */
  onChromeVisibilityChange: (visible: boolean) => void;
  /** Whether the buttons take taps: true while they are only auto-faded. */
  onChromeLiveChange: (live: boolean) => void;
  /** Bumped when a screen-level button is pressed, to bring faded chrome back. */
  chromeRevealTick: number;
  /** Bumped when the top bar's full screen button is pressed. */
  fullscreenTick: number;
  /** Whether the short being watched is a wide clip, and on the plain stage, for the top bar's buttons. */
  onWideChange: (wide: boolean, clean: boolean) => void;
  onCommentsVisibilityChange: (visible: boolean) => void;
  /**
   * The viewer's options menu is open over this short. Its native sheet takes
   * Android window focus, which would otherwise pause the video underneath.
   */
  optionsMenuOpen?: boolean;
  /** Profile reel: the creator's post background, behind text posts. */
  reelBgId?: string | null;
  /** The playing short reached its end with loop off: the viewer moves on. */
  onPlayToEnd?: (endedId: string) => void;
}

const ShortItem = React.memo<ShortItemProps>(({ item, registerPeek, thumbnailOverride, isActive: activeItem, isNearby, activeVideoRef, itemHeight, viewportHeight, miniReveal, backDrag, backLeaving, onSwipeBackSettled, dismissY, isFirst, onHoldActiveChange, captureViewerState, isMuted, volume, playbackRate, pagerGesture, onChromeVisibilityChange, onChromeLiveChange, chromeRevealTick, fullscreenTick, onWideChange, onCommentsVisibilityChange, optionsMenuOpen = false, reelBgId, onPlayToEnd }) => {
  const showPurchaseOffer = usePurchaseOfferVisible();
  const { shareIconStyle } = useAppPrefs();
  const { t: _copy } = _useCopy();
  const feedPlaybackAllowed = useFeedPlaybackAllowed();
  const surfaceActive = useFeedSurfaceActive();
  // Keep playing under the options menu, and until focus has settled back
  // after it closes, so dismissing it does not blip a pause either.
  const [menuHold, setMenuHold] = useState(false);
  useEffect(() => {
    if (optionsMenuOpen) setMenuHold(true);
    else if (feedPlaybackAllowed) setMenuHold(false);
  }, [optionsMenuOpen, feedPlaybackAllowed]);
  const playbackAllowed = feedPlaybackAllowed || ((optionsMenuOpen || menuHold) && surfaceActive);
  const pipPlayer = React.useSyncExternalStore(subscribePictureInPicture, getPictureInPicturePlayer, getPictureInPicturePlayer);
  const tokenId = item.tokenId ?? item.id;
  // Profile reel: a post that is not a video or a photo (text, comic, article,
  // a paid post) is a still slide; nothing plays under it.
  const reelStill = useMemo(() => reelStillOf(item as any), [item]);
  const photoMedia = useMemo(() => (reelStill ? undefined : shortsPhotoMedia(item, true)), [item, reelStill]);
  const noVideo = !!photoMedia || !!reelStill;
  // Photo slides sit on a plain theme backdrop: white in System Light, black otherwise.
  const appTheme = useAppTheme();
  const photoBackdrop = appTheme.isLight ? LIGHT_PAGE_FILL : "#000";
  // A gated short's file is private: an entitled viewer plays a signed URL,
  // anyone else is refused one and keeps the poster.
  const viewer = useUser();
  const signedShort = !noVideo && videoNeedsAccess(item);
  const shortAccess = useVideoAccess(tokenId, signedShort, viewer?.walletAddress || viewer?.address);
  // A locked clip the viewer cannot play said nothing: just its poster, and a
  // tap did nothing. Name the lock and open the way in, as the feed card does.
  const gate = useStreamAccessInfo(signedShort ? (item as any) : null)?.streamStatus;
  const subLocked = signedShort && !!gate?.isLockedWithSubscription;
  const otherLocked = signedShort && !subLocked && (!!gate?.isLockedWithPPV || !!gate?.isLockedWithLockContent);
  const showLockCard = (subLocked || otherLocked) && !shortAccess.data?.url;
  // Otherwise the same string FeedCard plays, so a card opened into the
  // viewer keeps its player: the HLS ladder when the post has one, else the MP4.
  const playbackUrl = useHlsFallback(() => getPlaybackUrl({ tokenId, hlsUrl: item.hlsUrl }));
  const photoSongUrl = photoMedia?.soundtrackUrl;
  const videoUrl = reelStill ? undefined : photoMedia ? photoMedia.soundtrackUrl : (signedShort ? shortAccess.data?.url : playbackUrl) || undefined;
  const miniEntry = React.useSyncExternalStore(subscribeInAppVideoMini, getInAppVideoMini, getInAppVideoMini);
  const { player, session: videoSession, ownsPlayer, active: ownsVideo } = usePostVideoPlayer(videoUrl, (p) => {
    // Shorts pause when the app is left; only a PiP window keeps them going.
    p.staysActiveInBackground = false;
    p.showNowPlayingNotification = false;
    p.loop = getIsLooping();
    p.muted = isMuted;
    p.bufferOptions = FEED_BUFFER_OPTIONS;
  }, true, !!miniEntry?.restoring && miniEntry.url === videoUrl);
  const ownsPlayerRef = useRef(ownsPlayer);
  ownsPlayerRef.current = ownsPlayer;
  // A video short's song plays with it (a photo short plays its song as the "video").
  const videoSongUrl = useMemo(() => (noVideo ? undefined : parseSoundtrack((item as any).description)?.url), [noVideo, item]);
  useVideoSoundtrack(videoUrl ? player : null, videoSongUrl);
  const isActive = (activeItem && playbackAllowed) || pipPlayer === player;
  // Live window size, not a module-level snapshot: on iPad the pager cells
  // and tap zones were sized for the launch orientation.
  const { t } = useCopy();
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const navigation = useNavigation<any>();
  // A still slide or lock card links on to the post page. Hand it this slide's
  // post to paint at once and start its fetch now, like a feed card does,
  // instead of a blank page that waits for the request to leave after the push.
  const openPostPage = useCallback(() => {
    if (tokenId == null) return;
    seedPostDetail(tokenId, item);
    warmRequest(postWarmKey(tokenId), () => getNFT(tokenId));
    navigation.navigate(ScreenNames.FeedDetail, { postId: String(tokenId) });
  }, [navigation, tokenId, item]);
  const frameRef = useRef<View>(null);
  // Only the drag-to-minimize gesture reads this; at rest the picture fills
  // the frame and contentFit="contain" letterboxes it.
  const [intrinsicSize, setIntrinsicSize] = useState({ width: 0, height: 0 });
  const rotationProbeUrl = videoUrl && /\.m3u8(\?|$)/i.test(videoUrl) ? getVideoUrl(tokenId) : videoUrl;
  useEffect(() => {
    let cancelled = false;
    setIntrinsicSize({ width: 0, height: 0 });
    const take = (size?: { width: number; height: number }) => {
      if (!size || !(size.width > 0) || !(size.height > 0)) return;
      const { width, height } = size;
      // Native track sizes (and the HLS ladder) omit the MP4 display matrix,
      // so a phone-shot portrait clip reports a landscape size.
      if (width > height && rotationProbeUrl) {
        void videoQuarterTurn(rotationProbeUrl).then(rotated => {
          if (!cancelled) setIntrinsicSize(rotated ? { width: height, height: width } : { width, height });
        });
        return;
      }
      setIntrinsicSize({ width, height });
    };
    try { take(player.videoTrack?.size); } catch {}
    let subs: { remove(): void }[] = [];
    try {
      subs = [
        player.addListener('videoTrackChange', event => take(event.videoTrack?.size)),
        player.addListener('sourceLoad', event => take(event.availableVideoTracks?.[0]?.size)),
      ];
    } catch {}
    return () => { cancelled = true; subs.forEach(sub => { try { sub.remove(); } catch {} }); };
  }, [player, rotationProbeUrl]);
  const miniDragY = useSharedValue(0);
  const miniStart = useSharedValue({ x: 0, y: 0 });
  const miniHandingOff = useSharedValue(false);
  // The picture left behind once the mini player has taken the decoder.
  const miniHandoffFade = useSharedValue(1);
  const backGrab = useSharedValue(0);
  const user = useUser();
  const { requireAuth } = useAuthActions();
  const { showUserProfile } = useUserProfileSheet();

  const isLooping = useMediaLooping();
  useEffect(() => { try { player.loop = !!photoMedia || isLooping; } catch {} }, [player, photoMedia, isLooping]);
  // Loop off (the default): the short that ends moves the viewer on to the next one.
  // Not while the person is typing or reading (comments, a DM or tip note, the
  // opened caption, the keyboard up): it plays again instead, and the next end
  // checks again, so the viewer carries on by itself once they are done.
  const engagedRef = useRef(false);
  useEffect(() => {
    if (!player || !isActive || photoMedia || !onPlayToEnd) return;
    const sub = player.addListener("playToEnd", () => {
      if (getIsLooping() || !ownsPlayerRef.current() || !navigation.isFocused()) return;
      if (engagedRef.current || Keyboard.isVisible()) {
        try { player.currentTime = 0; player.play(); } catch {}
        return;
      }
      onPlayToEnd(String(tokenId));
    });
    return () => sub.remove();
  }, [player, isActive, photoMedia, onPlayToEnd, navigation, tokenId]);
  // Watch time for the creator's stats. A photo short's soundtrack is not a watch.
  useEffect(() => trackPlayerWatchTime(player, noVideo ? null : tokenId), [player, noVideo, tokenId]);
  const itemThumbnail = item.postType === 'short' ? getShortsThumbnailUrl(tokenId) : resolveThumbnail(item);
  const thumbnail = photoMedia?.thumbnail || thumbnailOverride || (itemThumbnail === DEFAULT_BANNER_SENTINEL ? undefined : itemThumbnail);
  // Android draws a TextureView video inside the app's own frame, so every
  // video frame redrew and re-uploaded the whole screen: measured on a Galaxy
  // S24+, a short playing untouched was 98% late frames and taps landed a
  // second or two behind. A SurfaceView hands frames straight to the
  // compositor. Only a clip not known to be wide gets one: those can never be
  // dragged into the mini player (landscape only), which needs the texture to
  // clip and scale with the finger. Picked once per player, since the surface
  // type cannot change on a mounted view.
  const directSurface = useMemo(() => {
    if (Platform.OS !== "android" || (Platform.Version as number) < 29) return false;
    // Only the player's own measurement counts: poster shapes were off
    // (square and wide posters on clips that play fine on a surface), which
    // left every swiped-to short on the texture. A clip the player has
    // already shown to be properly wide keeps the texture for the mini
    // player drag; it learns that on first play (remembered below).
    const aspect = knownVideoAspect(tokenId);
    return aspect == null || aspect < 1.2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);
  const minterAddress = item.minter || item.minterUser?.address || "";

  // `getAvatarUrl` answers the literal string "default-avatar" — not a URI —
  // when a creator has none, and it routes real URLs through the CDN image
  // transform, which 404s outright if the zone setting is ever off. Both used
  // to go straight into a bare expo-image with no background and no onError,
  // so the slot painted nothing at all over the video. Guarding the sentinel
  // and handing the rest to the shared Avatar is what every other surface in
  // the app does (FeedCardHeader, CommentItem, ProfileHeader…), and it brings
  // the initial-letter fallback web draws in AvatarFallback with it.
  const avatarUrl = (() => {
    const resolved = getAvatarUrl(item.minterUser?.avatarImageUrl || item.minterAvatarUrl, 48);
    return resolved && resolved !== "default-avatar" ? resolved : undefined;
  })();
  const username = item.minterUser?.username || item.minterUsername || "";
  const subQuote = subLocked && DIGITAL_PURCHASES_ENABLED ? cheapestSubscriberQuote((item as any).plansDetails) : undefined;
  // The creator's badge after their name, the same lookup FeedCard uses.
  const badgeImg = item.minterUser?.hideBadgeAndBalance ? undefined : getBadgeUrlFor(item.minterUser || item);
  // Five deep and ending somewhere visible, matching FeedCard — the chain
  // stopped at `username` here, so a row that came back with only an address
  // rendered an empty name and, because the handle is conditional, no author
  // line whatever.
  const displayName =
    item.minterUser?.displayName ||
    item.minterDisplayName ||
    username ||
    (minterAddress ? `${minterAddress.slice(0, 6)}…${minterAddress.slice(-4)}` : "") ||
    t("copy.b764cdc0eab7", { defaultValue: "Unknown" });
  // The title carries the caption in practice: UploadScreen puts the composer
  // body into `name` and leaves `description` empty unless the author fills in
  // a separate one, so almost every live short has text here and nothing in
  // `description`. Rendering only the description shows no text at all on most
  // shorts, which is why both are drawn here (and now on web too).
  //
  // Trimmed before the emptiness test as well as the "untitled" one: a
  // whitespace-only name passes a bare truthiness check and draws a blank line
  // above the caption.
  const title = (() => {
    // A text post's words are the slide itself; no caption repeats them.
    if (reelStill && reelStill.kind !== "comic") return "";
    const raw = (item.name || item.title || "").trim();
    return raw.toLowerCase() === "untitled" ? "" : raw;
  })();
  // A description that only repeats the title is a second copy of the same
  // line — and a second translation request for text already going out.
  const rawDescription = reelStill && reelStill.kind !== "comic" ? "" : (photoMedia?.description ?? item.description ?? "").trim();
  const description = rawDescription !== title ? rawDescription : "";

  // Auto-translate the caption, the same way the feed card does.
  //
  // Shorts were the one place a reader's own language stopped at the feed: the
  // card under the thumbnail came back translated, and opening it handed the
  // original straight back.
  const translationTexts = useMemo(
    () => ({ title, description }),
    [title, description],
  );
  const {
    isTranslated,
    translatedTexts,
    isLoading: translating,
    handleTranslate,
    handleShowOriginal,
    shouldShow: showTranslate,
  } = useTranslation(translationTexts, item.detectedLanguage, true, true);
  const shownTitle = (isTranslated ? translatedTexts.title : title) || "";
  const shownDescription = (isTranslated ? translatedTexts.description : description) || "";

  const userAddress = user?.address || user?.walletAddress || "";
  // What one reaction from this viewer counts for — their badge multiplier.
  const voteWeight = useEngagementWeight();
  // Who reacted what is the author's to see, so the ⓘ in the tray only exists
  // on your own shorts (the API withholds the list from everyone else too).
  const isOwnShort = !!(
    userAddress && minterAddress && userAddress.toLowerCase() === minterAddress.toLowerCase()
  );
  // Only a public post can be reposted, quoted or embedded — see FeedCard.
  const isPublicShort = !(item as any).visibility || (item as any).visibility === "public";

  // Shared overlay — every surface showing this post reads the same numbers.
  const engagementKey = engagementKeyOf(item);
  const {
    isLiked: liked,
    isDisliked: disliked,
    isReposted: reposted,
    likeCount,
    dislikeCount,
    repostCount,
    myReaction,
    reactionCounts,
  } = useEngagement(item);

  // Share counter = reposts + link copies. The floor is the copies made this
  // session; taking max() rather than adding a delta is what stops a copy
  // being counted twice once the refetched server total already contains it.
  const { data: linkCopyCount = 0 } = usePostLinkCopyCount(tokenId);
  const linkCopyFloor = useLinkCopyFloor(tokenId);
  const shareCount = repostCount + Math.max(linkCopyCount, linkCopyFloor);
  const trackLinkCopy = useTrackPostLinkCopy();

  // One tray per thumb: every positive face on the thumbs-up, the downvote on
  // the thumbs-down — which no longer opens a tray at all, holding one option.
  // One state rather than two booleans, so only one can be open, and
  // `pickerOpen` below keeps reading as "a tray is up" for the chrome
  // auto-hide, which does not care which.
  const [openTray, setOpenTray] = useState<"positive" | null>(null);
  const pickerOpen = openTray !== null;
  const [showReactionInfo, setShowReactionInfo] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const { height: keyboardHeight } = useKeyboard();
  // Android resizes the screen; iOS overlays the keyboard.
  const keyboardOffset = showComments
    ? Math.max(0, itemHeight - viewportHeight) + (Platform.OS === "ios" ? keyboardHeight : 0)
    : 0;
  // Comments take 75%: at half height the sheet held barely two comments.
  const splitHeight = Math.max(0, itemHeight - keyboardOffset) * 0.75;
  // The comments sheet's slide offset, shared so the player shrinks and grows
  // in the same frames the sheet moves — opening, closing and following a
  // drag — instead of snapping to half height before the sheet has arrived
  // and back to full only after it has gone.
  const commentsSlide = useSharedValue(itemHeight);
  const playerStyle = useAnimatedStyle(() => {
    const shown = Math.min(splitHeight, Math.max(0, splitHeight - commentsSlide.value));
    return { height: Math.max(0, itemHeight - (shown > 0 ? keyboardOffset : 0) - shown) };
  }, [itemHeight, splitHeight, keyboardOffset]);
  // A wide clip leaves the screen above and below it empty. What goes there
  // follows the theme: a plain stage with the video as a rounded card on
  // System, the picture's reflection on Osaka and Glass, and the picture's
  // own colours carried outward on every other theme.
  const wideClip = !noVideo && intrinsicSize.height > 0 && intrinsicSize.width / intrinsicSize.height >= WIDE_CLIP_ASPECT;
  const wideStage = !wideClip ? null
    : appTheme.theme === 'system' || appTheme.theme === 'minimal' ? 'clean' as const
    : appTheme.theme === 'osaka' || appTheme.theme === 'glass' ? 'floor' as const
    : 'glow' as const;
  const cleanStage = wideStage === 'clean';
  const storyboard = useMemo(() => toStoryboard(item.storyboard), [item.storyboard]);
  const restPicture = useMemo(
    () => containedPicture(SCREEN_WIDTH, itemHeight, intrinsicSize.width, intrinsicSize.height),
    [SCREEN_WIDTH, itemHeight, intrinsicSize],
  );
  // Two fingers zoom into the picture while they are down; it settles back
  // when they lift.
  const pinchScale = useSharedValue(1);
  const pinchX = useSharedValue(0);
  const pinchY = useSharedValue(0);
  const pinching = useSharedValue(false);
  const pinchFrom = useSharedValue({ x: 0, y: 0 });
  /**
   * At rest the picture box is the whole frame; the video view inside it is
   * boxed by videoBoxStyle from the rotation-corrected shape.
   *
   * While it is dragged down into the mini player it is boxed to the picture
   * itself. The frame carries a black fill (and the video surface its own
   * black letterbox) the full height of the screen. Scaled down with the
   * video while the viewer's backdrop fades out, those showed as solid bands
   * above and below the picture until the mini player covered them. Only a
   * landscape clip with a known size can be dragged, and at the moment the
   * box switches the backdrop is still black behind it, so the switch itself
   * draws nothing.
   */
  const pictureStyle = useAnimatedStyle(() => {
    const shown = Math.min(splitHeight, Math.max(0, splitHeight - commentsSlide.value));
    const frameHeight = Math.max(0, itemHeight - (shown > 0 ? keyboardOffset : 0) - shown);
    const drag = minimizeDrag(miniDragY.value, SCREEN_WIDTH, itemHeight);
    const picture = containedPicture(SCREEN_WIDTH, frameHeight, intrinsicSize.width, intrinsicSize.height);
    const boxed = (drag.translateY > 0 || miniHandingOff.value) && intrinsicSize.width > 0 && picture.width > 0;
    if (!boxed) {
      return {
        position: 'absolute', left: 0, top: 0, width: SCREEN_WIDTH, height: frameHeight,
        overflow: 'visible', borderRadius: 0, opacity: 1,
        transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }],
      };
    }
    const move = pictureBoxTranslate(SCREEN_WIDTH, frameHeight, picture, drag);
    return {
      position: 'absolute', left: picture.left, top: picture.top, width: picture.width, height: picture.height,
      overflow: 'hidden',
      // Rounds into the mini player's corners as it shrinks toward it.
      borderRadius: (MINI_RADIUS * drag.amount) / Math.max(0.01, drag.scale),
      opacity: miniHandoffFade.value,
      transform: [{ translateX: move.translateX }, { translateY: move.translateY }, { scale: drag.scale }],
    };
  }, [SCREEN_WIDTH, itemHeight, splitHeight, keyboardOffset, intrinsicSize]);
  /** The full frame inside the picture box, so the video stays where it was. */
  const pictureContentStyle = useAnimatedStyle(() => {
    const shown = Math.min(splitHeight, Math.max(0, splitHeight - commentsSlide.value));
    const frameHeight = Math.max(0, itemHeight - (shown > 0 ? keyboardOffset : 0) - shown);
    const picture = containedPicture(SCREEN_WIDTH, frameHeight, intrinsicSize.width, intrinsicSize.height);
    const boxed = (miniDragY.value > 0 || miniHandingOff.value) && intrinsicSize.width > 0 && picture.width > 0;
    return {
      position: 'absolute', width: SCREEN_WIDTH, height: frameHeight,
      left: boxed ? -picture.left : 0, top: boxed ? -picture.top : 0,
    };
  }, [SCREEN_WIDTH, itemHeight, splitHeight, keyboardOffset, intrinsicSize]);
  /**
   * The video view sits in the picture rect, not the whole frame. A clip
   * stored sideways with a rotate flag reports its stored wide size to the
   * native view, which squashed the upright picture into a 16:9 box. Sized
   * from the corrected shape and told to fill, it draws at its true aspect,
   * and any gap around it shows the blurred backdrop instead of a hard black
   * edge running through the buttons.
   */
  const videoBoxStyle = useAnimatedStyle(() => {
    const shown = Math.min(splitHeight, Math.max(0, splitHeight - commentsSlide.value));
    const frameHeight = Math.max(0, itemHeight - (shown > 0 ? keyboardOffset : 0) - shown);
    const picture = containedPicture(SCREEN_WIDTH, frameHeight, intrinsicSize.width, intrinsicSize.height);
    // The rounded card is for the full frame at rest: it squares off for the
    // comments split and for the drag into the mini player.
    const card = cleanStage && shown <= 0 && miniDragY.value <= 0 && !miniHandingOff.value && picture.width > CLEAN_STAGE_INSET * 4;
    const fit = card ? (picture.width - CLEAN_STAGE_INSET * 2) / picture.width : 1;
    return {
      position: 'absolute', left: picture.left, top: picture.top, width: picture.width, height: picture.height,
      overflow: card ? 'hidden' : 'visible',
      borderRadius: card ? CLEAN_STAGE_RADIUS / fit : 0,
      transform: [{ translateX: pinchX.value }, { translateY: pinchY.value }, { scale: fit * pinchScale.value }],
    };
  }, [SCREEN_WIDTH, itemHeight, splitHeight, keyboardOffset, intrinsicSize, cleanStage]);
  const pictureKnown = intrinsicSize.width > 0 && intrinsicSize.height > 0;
  // A tiny poster is enough to blur, and cheap to decode for every row.
  const backdropSource = item.postType === 'short' ? getShortsThumbnailUrl(tokenId, 120) : thumbnail;
  const miniChromeStyle = useAnimatedStyle(() => ({ opacity: 1 - miniReveal.value }));
  // A parked offset is only "gone" relative to the size it was parked at; if
  // the item grows while comments are shut, push it clear so it can't read as
  // a sliver of open sheet. The sheet re-seats it at its own height on open.
  useEffect(() => {
    if (!showComments) commentsSlide.value = Number.MAX_SAFE_INTEGER;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemHeight]);

  useEffect(() => {
    if (!isActive) return;
    onCommentsVisibilityChange(showComments);
    return () => onCommentsVisibilityChange(false);
  }, [isActive, showComments, onCommentsVisibilityChange]);
  const [showTipModal, setShowTipModal] = useState(false);
  const [showShareSheet, setShowShareSheet] = useState(false);
  const [showShareToDm, setShowShareToDm] = useState(false);
  const { isSignedIn: viewerSignedIn } = useAuthState();
  const [isPlaying, setIsPlaying] = useState(true);
  const [isPausedByUser, setIsPausedByUser] = useState(false);
  const pausedByUserRef = useRef(isPausedByUser);
  pausedByUserRef.current = isPausedByUser;
  const itemNavigation = useNavigation();
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  useEffect(() => {
    if (!ownsVideo) setFirstFrameRendered(false);
  }, [ownsVideo]);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  engagedRef.current = showComments || showShareToDm || showTipModal || captionExpanded;
  const [screenshotMode, setScreenshotMode] = useState(false);
  /** A hold on the right: the rate it plays at until let go (or unlocked). */
  const [holdRate, setHoldRate] = useState<number | null>(null);
  /** A hold on the left: how many times normal speed it runs backwards. */
  const [rewindRate, setRewindRate] = useState<number | null>(null);
  /** Dragged down during the hold, so it keeps going after the finger lifts. */
  const holdLockedRef = useRef(false);
  const lockedHoldRef = useRef<"speed" | "rewind" | null>(null);
  const [seekFlash, setSeekFlash] = useState<{ side: -1 | 1; total: number; run: number } | null>(null);
  const seekFlashOpacity = useRef(new Animated.Value(0)).current;
  /** Side and running total of a double-tap jump, so more taps keep adding. */
  const seekRunRef = useRef<{ side: -1 | 1; total: number } | null>(null);
  /** Swipe-down-to-clear, web's `overlaysHidden`. Separate from screenshotMode
   *  (a hold) because the two are different ways into the same state and only
   *  the swipe one survives the finger coming off the glass. */
  const [overlaysHidden, setOverlaysHidden] = useState(false);
  /** The same clear, reached by playing untouched for AUTO_HIDE_MS. Kept apart
   *  from `overlaysHidden` so a tap can undo it without also undoing a swipe
   *  the viewer meant, and so it can re-arm itself while a swipe must not. */
  const [autoHidden, setAutoHidden] = useState(false);

  /** Faded rather than unmounted, so the chrome does not re-layout on the way
   *  back in — web animates the same 250ms easeOut opacity. */
  const chromeOpacity = useRef(new Animated.Value(1)).current;
  /** Touch origin for the swipe-down, read on the UI thread by hidePan. */
  const panStart = useSharedValue({ x: 0, y: 0 });
  const overlayHeight = useSharedValue(0);
  const restorePanStart = useSharedValue({ x: 0, y: 0 });

  // Keep the playback clock out of layout and Fabric commits while paging.
  const progress = useRef(new Animated.Value(0)).current;
  const trackWidth = Math.max(1, SCREEN_WIDTH - EDGE * 2);
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0, duration: 0, useNativeDriver: true, isInteraction: false,
    }).start();
    return () => progress.stopAnimation();
  }, [progress]);
  const durationRef = useRef(0);
  const [scrubbing, setScrubbing] = useState(false);
  /** Where the finger is while scrubbing, for the frame preview above it. */
  const [scrubRatio, setScrubRatio] = useState(0);
  /** Read by the time listener, which is subscribed once per player. */
  const scrubbingRef = useRef(false);

  // Double-tap Like / triple-tap Love gesture and animation.
  const lastTapRef = useRef(0);
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The first tap pauses/resumes immediately. If tap two arrives, put that
   *  reversible toggle back before resolving Like/Love. */
  const singleTapToggledPlaybackRef = useRef(false);
  /** Chrome state from before a single tap hid/showed the buttons, so tap two
   *  of a double tap (a like) can put it back. */
  const singleTapChromeRef = useRef<{ overlaysHidden: boolean; autoHidden: boolean } | null>(null);
  const tapAnimProgress = useRef(new Animated.Value(0)).current;
  const [tapAnimReaction, setTapAnimReaction] = useState<"like" | "love" | null>(null);
  const [tapAnimPos, setTapAnimPos] = useState({ x: 0, y: 0 });
  const [tapAnimRun, setTapAnimRun] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const longPressActiveRef = useRef(false);
  const activeLongPressKindRef = useRef<"speed" | "rewind" | "screenshot" | null>(null);
  const wasPlayingBeforeLongPress = useRef(true);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const resetTapSequence = useCallback(() => {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = null;
    tapCountRef.current = 0;
    lastTapRef.current = 0;
    singleTapToggledPlaybackRef.current = false;
    singleTapChromeRef.current = null;
    seekRunRef.current = null;
  }, []);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
      resetTapSequence();
      tapAnimProgress.stopAnimation();
    };
  }, [resetTapSequence, tapAnimProgress]);

  // Native play events can arrive after the pager has moved. Every path that
  // can start playback reads this ref so a recycled/inactive cell cannot bring
  // back audio from the short that just left the screen.
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  /** Playing ahead of becoming active because the pager is dragging it in. */
  const peekingRef = useRef(false);
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  // FlatList also retains its initial cells after they leave the window.
  // Keep those players empty, and let neighbours buffer only after settling.
  const { liteMode } = useDataSaver();
  const playerSource = miniEntry?.player === player || isActive || (isNearby && !liteMode) ? videoUrl || null : null;
  // The shorts either side keep their picture mounted too, so the decoder is
  // set up and their first frame is already on screen before the swipe lands.
  // Mounting the view only once a short became active cost a surface, a codec
  // and a first decode after every swipe: the pause on each new short. Lite
  // mode and low-end phones keep the old one-view behaviour for memory.
  const warmView = isNearby && !liteMode && !isLowEndDevice();
  const viewMounted = !!player && ownsVideo && !noVideo && (isActive || warmView);
  useEffect(() => {
    if (!viewMounted) setFirstFrameRendered(false);
  }, [viewMounted]);
  // The poster sits over the video until the native view says a frame is up,
  // and it says so once per view. A view that stayed mounted while its short
  // was set aside (swiped to a neighbour, a sheet or Control Center over the
  // app) already has its frame and never says it again, so the short played
  // on under its own poster: a still picture with the sound and progress bar
  // running, through pause, play and seeking. If the clock is moving while the
  // poster is still up, the picture is there: show it.
  useEffect(() => {
    if (!viewMounted || !isActive || firstFrameRendered) return;
    let startAt: number | null = null;
    const timer = setInterval(() => {
      let at = 0;
      let playing = false;
      try { at = player.currentTime ?? 0; playing = player.playing; } catch { return; }
      if (!playing) { startAt = null; return; }
      if (startAt == null) { startAt = at; return; }
      if (Math.abs(at - startAt) < 0.75) return;
      clearInterval(timer);
      setFirstFrameRendered(true);
      require('../libs/errorReporter').reportError('ShortsViewer', ['poster lifted without first frame event'], {
        level: 'info', metadata: { postId: tokenId },
      });
    }, 400);
    return () => clearInterval(timer);
  }, [viewMounted, isActive, firstFrameRendered, player, tokenId]);
  const { recovery, phase: playbackPhase } = usePlaybackRecovery(player, videoUrl, {
    component: 'ShortsViewer', postId: tokenId, lateStallHandover: true,
    allowed: () => ownsPlayerRef.current() && (isActiveRef.current && itemNavigation.isFocused() || isPictureInPicturePlayer(player)) && canStartVideo(player),
  });
  // A lapsed signature fails like a broken file; fetch a fresh one.
  const refetchShortAccess = shortAccess.refetch;
  useEffect(() => {
    if (playbackPhase === 'failed' && shortAccess.data?.private && isVideoAccessExpiring(shortAccess.data)) void refetchShortAccess();
  }, [playbackPhase, shortAccess.data, refetchShortAccess]);
  // A ladder that will not play is retired for the session. videoUrl then
  // resolves to the MP4, and the isActive effect below starts its player.
  useEffect(() => {
    if (playbackPhase === 'failed') markHlsFailed(videoUrl);
  }, [playbackPhase, videoUrl]);
  const stopPlayback = useCallback(() => {
    if (!ownsPlayerRef.current() || postMediaIsTransferring(videoSession) || isPictureInPicturePlayer(player)) return;
    recovery.stop();
    try {
      player.pause();
      // "Now playing" is not dropped here: doing it on every swipe switched
      // the phone's audio session to mixing and back as the next short
      // started (libs/backgroundVideoAudio lets it go once things are quiet).
      setPlayerProp(player, "staysActiveInBackground", false);
      // A short the pager silenced on its way out gets the viewer's setting back.
      setPlayerProp(player, "muted", isMutedRef.current);
    } catch {}
    setIsPlaying(false);
  }, [player, recovery, videoSession]);

  const playIfActive = useCallback(() => {
    if (!ownsPlayerRef.current()) return false;
    if (!videoUrl) return false;
    if ((!isActiveRef.current && !isPictureInPicturePlayer(player)) || !canStartVideo(player)) {
      stopPlayback();
      return false;
    }
    try {
      videoSession.userPaused = false;
      recovery.start();
      setIsPlaying(true);
      return true;
    } catch {
      return false;
    }
  }, [player, stopPlayback, recovery, videoUrl, videoSession]);

  useSettledVideoSource(player, isPictureInPicturePlayer(player) ? videoUrl || null : playerSource, isActive, () => {
    if (recovery.wanted && !pausedByUserRef.current && itemNavigation.isFocused()) playIfActive();
  }, () => recovery.fail('source-rejected'), videoSession);

  useEffect(() => {
    if (!player || !ownsPlayerRef.current()) return;
    try {
      // Reading throws on a released player; the writes below only happen
      // when the value changes (see libs/playerProps).
      void player.playing;
      setPlayerProp(player, "staysActiveInBackground", isPictureInPicturePlayer(player));
      if (isPictureInPicturePlayer(player)) setPlayerProp(player, "showNowPlayingNotification", true);
    } catch {
      // Released between close and reopen: nothing to play on this one.
      return;
    }
    if (isActive) {
      // Dragged in already playing (silently): carry on from where it is,
      // with the viewer's sound setting.
      peekingRef.current = false;
      setPlayerProp(player, "muted", isMutedRef.current);
      // The same callback identity must be used for request and release. The
      // old anonymous callbacks could never release either global focus slot.
      requestFeedVideoFocus(stopPlayback);
      requestAudioFocus(stopPlayback);
      if (miniEntry?.restoring && miniEntry.player === player && !player.playing) {
        setIsPlaying(false);
        setIsPausedByUser(true);
      } else {
        // A short opened while another video floats in the mini player is a
        // new choice of what to watch: the mini player gives way. It used to
        // keep the only right to play, so the new short opened on a still
        // frame until a second tap (Requests board). Its own hand-off (this
        // player) and a mini player being restored are left alone.
        const floating = getInAppVideoMini();
        if (floating && floating.player !== player && !floating.restoring && !floating.onReady
          && itemNavigation.isFocused()) closeInAppVideoMini();
        playIfActive();
        setIsPausedByUser(false);
      }
    } else {
      if (!peekingRef.current) stopPlayback();
      setIsPausedByUser(false);
    }
    return () => {
      // Becoming the active short is no reason to stop the peek it is playing.
      if (!isActive && peekingRef.current) return;
      stopPlayback();
      releaseFeedVideoFocus(stopPlayback);
      releaseAudioFocus(stopPlayback);
    };
  }, [isActive, player, playIfActive, stopPlayback, itemNavigation]);

  // The pager's handle on this short while a drag is under way. Everything
  // here acts on the player directly: a drag frame must not re-render.
  const peekReadyRef = useRef(false);
  peekReadyRef.current = viewMounted && warmView && !noVideo && !!videoUrl;
  useEffect(() => {
    if (!registerPeek || noVideo) return;
    const key = peekKeyOf(item);
    const quiet = (fn: () => void) => { try { fn(); } catch {} };
    registerPeek(key, {
      start: () => {
        if (peekingRef.current || isActiveRef.current || !peekReadyRef.current) return;
        if (!ownsPlayerRef.current() || !canStartVideo(player)) return;
        quiet(() => {
          // Only a loaded player: play() before its source lands would start
          // it later, off screen.
          if (player.status !== "readyToPlay" || player.playing) return;
          peekingRef.current = true;
          setPlayerProp(player, "muted", true);
          player.play();
        });
      },
      stop: (rewind) => {
        if (!peekingRef.current) return;
        peekingRef.current = false;
        if (isActiveRef.current) return;
        quiet(() => {
          player.pause();
          // The next short starts from the top when it is reached for real;
          // one swiped back to keeps its spot.
          if (rewind) player.currentTime = 0;
          setPlayerProp(player, "muted", isMutedRef.current);
        });
      },
      hear: () => {
        if (peekingRef.current) setPlayerProp(player, "muted", isMutedRef.current);
      },
      silence: (on) => {
        if (isActiveRef.current) setPlayerProp(player, "muted", on || isMutedRef.current);
      },
    });
    return () => registerPeek(key, null);
  }, [registerPeek, noVideo, item, player]);
  useEffect(() => () => {
    if (!peekingRef.current) return;
    peekingRef.current = false;
    try { player.pause(); } catch {}
  }, [player]);

  // The system pauses every player when the app goes to the background (lock
  // screen, another app, a notification) and nothing started it again, so the
  // short sat frozen on a frame until it was swiped away. Coming back resumes
  // the short being watched unless the viewer had paused it.
  useEffect(() => {
    if (!isActive) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || pausedByUserRef.current || !itemNavigation.isFocused()) return;
      try { if (!player.playing) playIfActive(); } catch {}
    });
    return () => sub.remove();
  }, [isActive, player, playIfActive, itemNavigation]);

  /**
   * The timeline clock. Only the short being watched runs one: expo-video's
   * Android time-update timer re-posts itself on the main looper and is not
   * stopped by release, so leaving it on for the preloaded neighbours would
   * leave a 4 Hz native timer per short behind for the life of the session.
   */
  useEffect(() => {
    if (!isActive) return;
    // A drag on the bar that was cut short by the swipe away (the gesture is
    // switched off under the finger) never said it had ended, and the bar
    // then ignored the clock for good.
    scrubbingRef.current = false;
    setScrubbing(false);
    try { player.timeUpdateEventInterval = 0.25; } catch {}
    let heardAt = 0;
    const show = (currentTime: number) => {
      const total = player.duration;
      if (total > 0) durationRef.current = total;
      // A drag owns the bar until the finger lifts; the clock would otherwise
      // yank it back to wherever playback still is.
      if (scrubbingRef.current || !(total > 0)) return;
      // A photo short plays the part of the song its poster picked.
      const jump = photoSongUrl ? soundWindowCorrection(photoSongUrl, currentTime ?? 0) : null;
      if (jump != null) { try { player.currentTime = jump; } catch {} return; }
      progress.setValue(Math.max(0, Math.min(1, (currentTime ?? 0) / total)));
    };
    const sub = player.addListener("timeUpdate", ({ currentTime }: any) => {
      heardAt = Date.now();
      show(currentTime);
    });
    // The bar must not depend on the player's ticks alone: a short reached
    // while it was already playing (dragged in) could run with none arriving,
    // its bar parked at the start under a moving picture. Read the clock
    // directly whenever the ticks go quiet.
    const fallback = setInterval(() => {
      if (Date.now() - heardAt < 600) return;
      try { if (player.playing) show(player.currentTime); } catch {}
    }, 300);
    return () => {
      sub.remove();
      clearInterval(fallback);
      try { player.timeUpdateEventInterval = 0; } catch {}
    };
  }, [isActive, player, progress, photoSongUrl]);

  const handleScrubStart = useCallback(() => {
    scrubbingRef.current = true;
    setScrubbing(true);
    // Scrubbing is attention, not neglect: whatever cleared the chrome, the
    // viewer is clearly looking at this short.
    setAutoHidden(false);
  }, []);

  const handleScrub = useCallback((ratio: number) => {
    progress.setValue(ratio);
    setScrubRatio(ratio);
  }, [progress]);

  const handleScrubCommit = useCallback((ratio: number) => {
    progress.setValue(ratio);
    const total = durationRef.current;
    if (total > 0) {
      try { player.currentTime = ratio * total; } catch {}
    }
    scrubbingRef.current = false;
    setScrubbing(false);
  }, [player, progress]);

  const handleScrubCancel = useCallback(() => {
    scrubbingRef.current = false;
    setScrubbing(false);
  }, []);

  // The pager is a vertical list and the scrub is sideways, but a drag that
  // starts with any downward slant would otherwise turn into a page flick
  // half way along the bar.
  // The swipe back takes any rightward drag, and the scrubber's left end sits
  // where that drag starts, so a seek begun there turned into leaving. The
  // scrub outranks both copies of it.
  const edgeBackMediaRef = useRef<GestureType | undefined>(undefined);
  const edgeBackStackRef = useRef<GestureType | undefined>(undefined);
  const scrubBlocks = useMemo(() => [pagerGesture, edgeBackMediaRef, edgeBackStackRef], [pagerGesture]);

  const { onLayout: onScrubTrackLayout, gesture: scrubGesture, touchGuard: scrubTouchGuard } = useScrubGesture({
    onScrubStart: handleScrubStart,
    onScrub: handleScrub,
    onCommit: handleScrubCommit,
    onCancel: handleScrubCancel,
    enabled: isActive,
    // A deliberate target at the foot of the screen, so it takes the touch
    // straight away instead of waiting for travel.
    immediate: true,
    // It also lies where a thumb starts its swipe to the next short.
    yieldsVertical: true,
    blocks: scrubBlocks,
  });

  const scrubFillStyle = {
    transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-trackWidth, 0] }) }],
  };
  const scrubThumbStyle = {
    transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, trackWidth] }) }],
  };

  useEffect(() => {
    const sub = player.addListener("playingChange", ({ isPlaying: playing }) => {
      if (!ownsPlayerRef.current()) return;
      // iOS may finish an earlier native play request after the pager's pause.
      // Immediately reject that stale start instead of trusting event order.
      if (playing && ((!isActiveRef.current && !peekingRef.current && !isPictureInPicturePlayer(player)) || !canStartVideo(player))) {
        stopPlayback();
        return;
      }
      setIsPlaying(playing);
    });
    return () => sub.remove();
  }, [player, stopPlayback]);

  // A screen pushed over the viewer (quote, comments, a profile) keeps this
  // item mounted, and freezeOnBlur stops it re-rendering, so the effect above
  // never sees a change and the short keeps looping underneath. The
  // navigation emitter fires regardless of freeze, so pause on blur there and
  // resume on focus if this is still the active, unpaused item.
  useEffect(() => {
    if (!player) return;
    const onBlur = () => {
      if (!ownsPlayerRef.current() || postMediaIsTransferring(videoSession) || isPictureInPicturePlayer(player)) return;
      recovery.stop();
      try { player.pause(); } catch {}
    };
    const onFocus = () => {
      if (!isActive || isPausedByUser) return;
      playIfActive();
    };
    const unsubBlur = itemNavigation.addListener("blur", onBlur);
    const unsubFocus = itemNavigation.addListener("focus", onFocus);
    return () => {
      unsubBlur();
      unsubFocus();
    };
  }, [itemNavigation, player, isActive, isPausedByUser, playIfActive, recovery]);

  useEffect(() => {
    if (!player) return;
    setPlayerProp(player, "muted", isMuted);
  }, [player, isMuted]);

  useEffect(() => {
    if (!player) return;
    try { applyVideoVolume(player, volume); } catch {}
  }, [player, volume]);

  // Hold-on-the-right temporarily overrides the chosen rate; releasing drops
  // back to it rather than hardcoding 1x.
  useEffect(() => {
    if (!player) return;
    // Only the short being watched, and only while it plays: on iOS setting
    // the rate starts a paused player, so writing it on every preloaded
    // neighbour as it mounted set them all playing off screen (sound
    // included) until the pager noticed and paused them again. play() picks
    // the last rate back up, and this runs again when playback starts.
    if (!isActive || !isPlaying) return;
    try { if (!player.playing) return; } catch { return; }
    setPlayerProp(player, "playbackRate", holdRate ?? playbackRate);
  }, [player, playbackRate, holdRate, isActive, isPlaying]);

  // Players cannot run backwards, so a rewind pauses and steps the clock back.
  useEffect(() => {
    if (!player || rewindRate === null) return;
    recovery.stop();
    try { player.pause(); } catch {}
    const timer = setInterval(() => {
      try { player.currentTime = Math.max(0, (player.currentTime ?? 0) - rewindRate * REWIND_TICK_MS / 1000); } catch {}
    }, REWIND_TICK_MS);
    return () => clearInterval(timer);
  }, [player, rewindRate, recovery]);

  const togglePlayPauseRef = useRef(() => {});
  // keep ref current so timeout closures always call latest
  togglePlayPauseRef.current = () => {
    if (!player || longPressActiveRef.current) return;
    if (isPlayingRef.current) {
      videoSession.userPaused = true;
      recovery.stop();
      player.pause();
      setIsPlaying(false);
      setIsPausedByUser(true);
    } else {
      if (playIfActive()) setIsPausedByUser(false);
    }
  };

  /**
   * Cast, switch or toggle off a reaction on the current short.
   *
   * Counts track POLARITY, so swapping like → love moves neither — only
   * `reactionCounts`. See components/Home/FeedCard.tsx for the full reasoning.
   */
  const voteInFlightRef = useRef(false);
  const handleReaction = useCallback((reaction: PostReaction) => {
    if (tokenId == null) return;
    // One vote at a time — same double-tap guard as FeedCard.
    if (voteInFlightRef.current) return;
    requireAuth(() => {
      // Auth can defer callbacks; recheck when the authorized action runs.
      if (voteInFlightRef.current) return;
      voteInFlightRef.current = true;
      const wasLiked = liked;
      const wasDisliked = disliked;
      const wasReaction = myReaction;
      const wasCounts = reactionCounts;
      const wasLikeCount = likeCount;
      const wasDislikeCount = dislikeCount;

      const isRemoving = wasReaction === reaction;
      const next: PostReaction | null = isRemoving ? null : reaction;

      const wasPositive = wasReaction ? isPositiveReaction(wasReaction) : false;
      const wasNegative = wasReaction ? !wasPositive : false;
      const nextPositive = next ? isPositiveReaction(next) : false;
      const nextNegative = next ? !nextPositive : false;

      // Weighted by the viewer's badge, the same as FeedCard — one reaction,
      // counted for what their tier makes it worth.
      const countsAt = (weight: number) => {
        let nextLikeCount = wasLikeCount;
        let nextDislikeCount = wasDislikeCount;
        if (wasPositive && !nextPositive) nextLikeCount = Math.max(0, nextLikeCount - weight);
        if (!wasPositive && nextPositive) nextLikeCount += weight;
        // A dislike always shows as one, whatever badge cast it.
        if (wasNegative && !nextNegative) nextDislikeCount = Math.max(0, nextDislikeCount - 1);
        if (!wasNegative && nextNegative) nextDislikeCount += 1;
        return {
          isLiked: nextPositive,
          isDisliked: nextNegative,
          myReaction: next,
          likeCount: nextLikeCount,
          dislikeCount: nextDislikeCount,
          reactionCounts: applyReactionDelta(wasCounts, wasReaction, next, weight),
        };
      };

      applyEngagement(engagementKey, countsAt(voteWeight));
      // A disliked short leaves this viewer's feeds; undoing it brings it back.
      if (nextNegative && !wasNegative) hideDislikedPost(tokenId);
      else if (wasNegative && !nextNegative) restoreDislikedPost(tokenId);

      const rollback = () => {
        if (nextNegative && !wasNegative) restoreDislikedPost(tokenId);
        else if (wasNegative && !nextNegative) hideDislikedPost(tokenId);
        // Restore only the fields this handler owns, so a concurrent save or
        // repost that succeeded is not undone.
        revertEngagement(engagementKey, {
          isLiked: wasLiked,
          isDisliked: wasDisliked,
          myReaction: wasReaction,
          likeCount: wasLikeCount,
          dislikeCount: wasDislikeCount,
          reactionCounts: wasCounts,
        });
        toastError(t("feedCard.reactionFailed"));
      };

      const request =
        reaction === "like" || reaction === "dislike"
          ? voteOnNFT({ streamTokenId: tokenId, vote: reaction === "like", account: userAddress })
          : reactToNFT({ streamTokenId: tokenId, reaction });

      // A 200 carrying `{ error }` resolves rather than throwing, so `.catch`
      // alone would record a failed vote as successful.
      request
        .then((res: any) => {
          if (isFailedResponse(res)) {
            rollback();
            return;
          }
          // Settle on the weight the server applied. An API that sends none is
          // left alone — absent means "older build", not "counted once".
          const raw = res?.weight ?? res?.result?.weight;
          if (typeof raw === "number") {
            const applied = appliedEngagementWeight(raw);
            if (applied !== voteWeight) applyEngagement(engagementKey, countsAt(applied));
          }
        })
        .catch(rollback)
        .finally(() => {
          voteInFlightRef.current = false;
        });
    });
  }, [liked, disliked, myReaction, reactionCounts, likeCount, dislikeCount, engagementKey, tokenId, userAddress, requireAuth, voteWeight]);

  /**
   * Tapping a thumb casts whichever reaction it is WEARING — a short leading
   * with 🔥 reacts 🔥, not a 👍 the viewer never picked — and re-sending a
   * reaction you already hold is what toggles it off.
   */
  const togglePolarity = useCallback((positive: boolean) => {
    handleReaction(reactionForTap(positive, myReaction, reactionCounts));
  }, [handleReaction, myReaction, reactionCounts]);

  const handleLike = useCallback(() => togglePolarity(true), [togglePolarity]);

  /**
   * The one glyph the thumb wears — and, on a tap, the reaction it casts or
   * takes back. Your own 👎 shows here: there is no thumbs-down any more.
   */
  const leadReaction = resolveLeadReaction(reactionCounts, myReaction);
  const thumbReaction = resolveThumbReaction(reactionCounts, myReaction) ?? undefined;
  const thumbCount = resolveThumbCount(likeCount, dislikeCount, thumbReaction);
  // A 👍 or 👎 stays the plain thumb icon (turned down for a 👎), filled and
  // nodding when it is your own; any other reaction shows as its emoji.
  const thumbDown = thumbReaction === "dislike";
  const thumbGlyph = thumbDown ? undefined : thumbReaction;
  const thumbMine = thumbDown ? disliked || myReaction === "dislike" : liked;

  const handleTip = useCallback(() => {
    if (!minterAddress) return;
    requireAuth(() => { setShowTipModal(true); });
  }, [minterAddress, requireAuth]);

  const handleComment = useCallback(() => {
    setShowComments(true);
  }, []);

  const handleUserPress = useCallback(() => {
    const id = username || item.minter || "";
    if (id) showUserProfile(id);
  }, [username, item.minter, showUserProfile]);

  const handleRepost = useCallback((next: boolean) => {
    if (tokenId == null) return;
    const run = () => {
      const wasReposted = reposted;
      const prevCount = repostCount;
      applyEngagement(engagementKey, {
        isReposted: next,
        repostCount: next ? prevCount + 1 : Math.max(0, prevCount - 1),
      });
      if (next) toastSuccess(t("toasts.reposted"));
      const rollback = () => {
        revertEngagement(engagementKey, { isReposted: wasReposted, repostCount: prevCount });
        toastError(next ? t("copy.7527dc6722fc", { defaultValue: "Failed to repost" }) : t("copy.06f3a3e5ca20", { defaultValue: "Failed to remove repost" }));
      };
      toggleRepost(Number(tokenId))
        .then((res) => {
          if (isFailedResponse(res)) {
            rollback();
            return;
          }
          // Server flag wins. Its own repostCount is not adopted — see the note
          // in FeedCard.handleUndoRepost about quotes being folded into it.
          if (typeof res?.reposted === "boolean" && res.reposted !== next) {
            applyEngagement(engagementKey, { isReposted: res.reposted, repostCount: prevCount });
          }
        })
        .catch(rollback);
    };
    // Signed in, flip on the tap: requireAuth's session check goes to the
    // network first, and the API client refreshes the token anyway.
    if (viewerSignedIn) run();
    else requireAuth(run);
  }, [tokenId, reposted, repostCount, engagementKey, requireAuth, t, viewerSignedIn]);

  const handleQuote = useCallback(() => {
    const go = () => {
      navigation.navigate(ScreenNames.Upload, {
        quotedTokenId: tokenId,
        quotedPost: item as any,
      });
    };
    if (viewerSignedIn) go();
    else requireAuth(go);
  }, [navigation, tokenId, item, requireAuth, viewerSignedIn]);

  const handleCopyLink = useCallback(() => {
    if (tokenId == null) return;
    // A post with a readable slug shares as /app/post/<slug>.
    const slug = typeof (item as any)?.articleSlug === "string" ? (item as any).articleSlug : "";
    copyToClipboard(ShareLinks.post(slug || String(tokenId)));
    toastSuccess(t("postOptions.linkCopied"));
    // A copy is a share: it counts once per actor per post, next to reposts.
    trackLinkCopy(tokenId, userAddress, linkCopyCount);
  }, [tokenId, item, trackLinkCopy, userAddress, linkCopyCount]);

  const commentCount = useCommentCount(tokenId, item.commentCount ?? 0);
  const tipCount = (item as any).totalTips || (item as any).tips || 0;
  // Signed-out viewers are already folded into totalViews by the API.
  const views = resolveViewCount(item);

  const showTapReactionAnimation = useCallback((
    reaction: "like" | "love",
    x: number,
    y: number,
  ) => {
    if (reduceMotion) return;
    setTapAnimReaction(reaction);
    setTapAnimPos({ x: x - 32, y: y - 32 });
    setTapAnimRun((run) => run + 1);
  }, [reduceMotion]);

  // Start only after the burst has mounted. Starting a native-driver animation
  // in the same callback that first rendered its Animated.View left Android
  // with no attached native node, so the Like/Love state changed but no glyph
  // ever painted over the video.
  useEffect(() => {
    if (!tapAnimReaction || tapAnimRun === 0) return;
    tapAnimProgress.stopAnimation();
    tapAnimProgress.setValue(0);
    const animation = Animated.timing(tapAnimProgress, {
      toValue: 1,
      duration: tapAnimReaction === "love" ? TAP_LOVE_ANIMATION_MS : TAP_LIKE_ANIMATION_MS,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) setTapAnimReaction(null);
    });
    return () => animation.stop();
  }, [tapAnimReaction, tapAnimRun, tapAnimProgress]);

  const commitTapReaction = useCallback((
    reaction: "like" | "love",
  ) => {
    // Tap gestures add or upgrade, never toggle an existing reaction off.
    if (myReaction === reaction) return;
    if (reaction === "like" && liked) return;
    handleReaction(reaction);
  }, [handleReaction, liked, myReaction]);

  /**
   * Swipe down over the bottom stack to clear the chrome — web's
   * `handleOverlayGestureTouch*`. See the HIDE_SWIPE_MIN block above for why
   * this is a gesture-handler Pan and not a PanResponder.
   *
   * Manual activation, and never on touch-down, so the buttons underneath keep
   * their taps: the gesture only claims once the finger has clearly travelled
   * downwards.
   *
   * Unlike ImageFeedDrawer's contentPan — which stays in BEGAN on a
   * non-matching move and lets the native scroll take it — this one must fail
   * explicitly, because `blocksExternalGesture` holds the pager for exactly as
   * long as this gesture is undecided. Sitting in BEGAN would leave the pager
   * waiting until the finger lifted, and the bottom stack, which is where a
   * thumb rests, would stop paging altogether.
   */
  const hidePan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isActive && !showComments && !overlaysHidden && !autoHidden)
        .manualActivation(true)
        .onTouchesDown((e, state) => {
          "worklet";
          const touch = e.allTouches[0];
          if (!touch || e.numberOfTouches !== 1 || touch.y < overlayHeight.value * 0.2) {
            state.fail();
            return;
          }
          panStart.value = { x: e.allTouches[0]?.x ?? 0, y: e.allTouches[0]?.y ?? 0 };
        })
        .onTouchesMove((e, state) => {
          "worklet";
          const t = e.allTouches[0];
          if (!t || e.numberOfTouches !== 1) { state.fail(); return; }
          const dy = t.y - panStart.value.y;
          const dx = Math.abs(t.x - panStart.value.x);
          // Anything that is not a downward drag belongs to the pager — hand
          // it back at once rather than making it wait on us.
          if (dy < -DRAG_RELEASE_MIN || dx > Math.abs(dy) + DRAG_RELEASE_MIN) {
            state.fail();
            return;
          }
          if (dy > DRAG_CLAIM_MIN && dy > dx) state.activate();
        })
        .onEnd((e, success) => {
          "worklet";
          // `onEnd` also runs for a cancelled gesture; only a real release
          // should clear the chrome.
          if (!success) return;
          if (e.translationY > HIDE_SWIPE_MIN && e.translationY > Math.abs(e.translationX)) {
            runOnJS(setOverlaysHidden)(true);
          }
        })
        // Makes the pager wait on this gesture instead of racing it. Without
        // it the list still wins on iOS, where a handler living inside the
        // scroll view cannot disable it on its own.
        //
        // It has to be the pager's *gesture*, never the FlatList's ref.
        // `convertToHandlerTag` resolves a relation by reading `.handlerTag`
        // off the target and answers -1 for anything without one, which
        // `extractValidHandlerTags` then filters out — so a plain RN
        // component ref is discarded in silence and the relation never
        // reaches native. Same reasoning as useHorizontalScrollGuard in
        // context/PagerGestureContext.tsx.
        .blocksExternalGesture(pagerGesture),
    [panStart, pagerGesture, overlayHeight, isActive, showComments, overlaysHidden, autoHidden],
  );

  /** Ends a hold's speed-up or rewind, including one left locked on. */
  const stopHold = useCallback((kind: "speed" | "rewind" | "screenshot" | null) => {
    holdLockedRef.current = false;
    lockedHoldRef.current = null;
    if (kind === "speed") setHoldRate(null);
    if (kind === "rewind") {
      setRewindRate(null);
      if (wasPlayingBeforeLongPress.current) playIfActive();
    }
  }, [playIfActive]);

  // Swiping on to another short drops a locked speed-up or rewind.
  useEffect(() => {
    if (isActive || !lockedHoldRef.current) return;
    stopHold(lockedHoldRef.current);
  }, [isActive, stopHold]);

  /** Double tap on the left or right: jump back or forward, more taps add more. */
  const jumpBy = useCallback((side: -1 | 1) => {
    const run = seekRunRef.current?.side === side ? seekRunRef.current : { side, total: 0 };
    run.total += SEEK_JUMP_SECONDS;
    seekRunRef.current = run;
    try {
      const total = durationRef.current || (player as any)?.duration || 0;
      const next = (player.currentTime ?? 0) + side * SEEK_JUMP_SECONDS;
      player.currentTime = Math.max(0, total > 0 ? Math.min(total - 0.25, next) : next);
    } catch {}
    setSeekFlash({ side, total: run.total, run: Date.now() });
    seekFlashOpacity.stopAnimation();
    seekFlashOpacity.setValue(1);
    Animated.timing(seekFlashOpacity, { toValue: 0, duration: 500, delay: 300, useNativeDriver: true }).start();
  }, [player, seekFlashOpacity]);

  const endSeekRunLater = useCallback(() => {
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      tapCountRef.current = 0;
      lastTapRef.current = 0;
      seekRunRef.current = null;
    }, TAP_GESTURE_WINDOW_MS);
  }, []);

  // Arbitrate before the native pager claims the upward flick. This remains
  // on the video while the caption is hidden, so there is always a way back.
  const restorePan = useMemo(() => Gesture.Pan()
    .enabled(isActive && !showComments && !screenshotMode && overlaysHidden)
    .manualActivation(true)
    .onTouchesDown((e, state) => {
      "worklet";
      const touch = e.allTouches[0];
      if (e.numberOfTouches !== 1 || !touch || touch.y <= itemHeight * RESTORE_ZONE_TOP || touch.y >= itemHeight * RESTORE_ZONE_BOTTOM) {
        state.fail();
        return;
      }
      restorePanStart.value = { x: touch.x, y: touch.y };
    })
    .onTouchesMove((e, state) => {
      "worklet";
      const touch = e.allTouches[0];
      if (!touch || e.numberOfTouches !== 1) {
        state.fail();
        return;
      }
      const dy = touch.y - restorePanStart.value.y;
      const dx = Math.abs(touch.x - restorePanStart.value.x);
      if (dy > DRAG_RELEASE_MIN || dx > Math.abs(dy) + DRAG_RELEASE_MIN) {
        state.fail();
        return;
      }
      if (dy < -DRAG_CLAIM_MIN && -dy > dx) state.activate();
    })
    .onEnd((e, success) => {
      "worklet";
      if (success && e.translationY < -HIDE_SWIPE_MIN && -e.translationY > Math.abs(e.translationX)) {
        runOnJS(setOverlaysHidden)(false);
        runOnJS(setAutoHidden)(false);
        runOnJS(resetTapSequence)();
      }
    })
    .simultaneousWithExternalGesture(pagerGesture),
  [isActive, showComments, screenshotMode, overlaysHidden, autoHidden, itemHeight,
    restorePanStart, pagerGesture, resetTapSequence]);

  // Resolve the complete tap gesture before casting: double = Like, triple = Love.
  // On the left and right thirds a double tap jumps 10s instead.
  const handleScreenTap = useCallback((pageX: number, pageY: number) => {
    if (longPressActiveRef.current) return;
    // A tap while a speed-up or rewind is locked on only turns it off.
    if (lockedHoldRef.current) {
      stopHold(lockedHoldRef.current);
      resetTapSequence();
      return;
    }
    // A tap that dismisses the reaction tray is not also a play/pause.
    if (pickerOpen) {
      resetTapSequence();
      setOpenTray(null);
      return;
    }
    // The centre third plays/pauses. Anywhere else on the video clears every
    // button for an immersive view, and the next tap there brings them back.
    const inPauseZone =
      pageX >= SCREEN_WIDTH * PAUSE_ZONE_START && pageX <= SCREEN_WIDTH * PAUSE_ZONE_END &&
      pageY >= itemHeight * PAUSE_ZONE_START && pageY <= itemHeight * PAUSE_ZONE_END;
    const now = Date.now();
    const continuesGesture = continuesTapGesture(lastTapRef.current, now);

    if (!continuesGesture || tapCountRef.current === 0) {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      lastTapRef.current = now;
      tapCountRef.current = 1;
      // Both actions are reversible, so they happen on finger-up instead of
      // making a normal tap feel broken for the whole double-tap window. Tap
      // two below silently reverses this before showing the reaction.
      if (inPauseZone) {
        // The auto-clear was not asked for, so a pause tap also undoes it.
        if (autoHidden) setAutoHidden(false);
        singleTapToggledPlaybackRef.current = true;
        singleTapChromeRef.current = null;
        togglePlayPauseRef.current();
      } else {
        singleTapToggledPlaybackRef.current = false;
        singleTapChromeRef.current = { overlaysHidden, autoHidden };
        const hide = !(overlaysHidden || autoHidden);
        setOverlaysHidden(hide);
        setAutoHidden(false);
        if (hide) setCaptionExpanded(false);
      }
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        if (tapCountRef.current !== 1) return;
        tapCountRef.current = 0;
        lastTapRef.current = 0;
        singleTapToggledPlaybackRef.current = false;
        singleTapChromeRef.current = null;
      }, TAP_GESTURE_WINDOW_MS);
      return;
    }

    lastTapRef.current = now;
    if (tapCountRef.current === 1) {
      tapCountRef.current = 2;
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      if (singleTapToggledPlaybackRef.current) {
        singleTapToggledPlaybackRef.current = false;
        togglePlayPauseRef.current();
      }
      const chromeBefore = singleTapChromeRef.current;
      if (chromeBefore) {
        singleTapChromeRef.current = null;
        setOverlaysHidden(chromeBefore.overlaysHidden);
        setAutoHidden(chromeBefore.autoHidden);
      }
      const side = seekSideAt(pageX, SCREEN_WIDTH);
      if (side !== 0) {
        jumpBy(side);
        endSeekRunLater();
        return;
      }
      // Feedback stays immediate. Only the request waits long enough for a
      // third tap to upgrade it, so the gesture never feels swallowed.
      showTapReactionAnimation("like", pageX, pageY);
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        if (tapCountRef.current !== 2) return;
        tapCountRef.current = 0;
        lastTapRef.current = 0;
        commitTapReaction("like");
      }, TAP_REACTION_RESOLUTION_MS);
      return;
    }

    // Further taps during a jump keep jumping, toward the side tapped.
    if (seekRunRef.current) {
      jumpBy(seekSideAt(pageX, SCREEN_WIDTH) || seekRunRef.current.side);
      endSeekRunLater();
      return;
    }

    // Tap three cancels the pending Like request and replaces its thumb with a
    // single Love bloom. The animation state is shared, so nothing layers.
    resetTapSequence();
    showTapReactionAnimation("love", pageX, pageY);
    commitTapReaction("love");
  }, [commitTapReaction, pickerOpen, overlaysHidden, autoHidden, resetTapSequence, showTapReactionAnimation, itemHeight, stopHold, jumpBy, endSeekRunLater]);

  // Long press — left rewinds, right speeds up, the middle clears the screen.
  const handleLongPressIn = useCallback((locationX: number) => {
    // The viewer owns this hold, so the page menu stands down.
    blockQuickActions();
    resetTapSequence();
    if (lockedHoldRef.current) stopHold(lockedHoldRef.current);
    longPressActiveRef.current = true;
    holdLockedRef.current = false;
    const side = holdSideAt(locationX, SCREEN_WIDTH);

    if (side === "forward") {
      activeLongPressKindRef.current = "speed";
      setHoldRate(HOLD_BASE_RATE);
      onHoldActiveChange(true);
    } else if (side === "rewind") {
      activeLongPressKindRef.current = "rewind";
      wasPlayingBeforeLongPress.current = isPlayingRef.current;
      setRewindRate(HOLD_BASE_RATE);
      onHoldActiveChange(true);
    } else {
      // Middle → screenshot mode: pause + hide UI
      activeLongPressKindRef.current = "screenshot";
      wasPlayingBeforeLongPress.current = isPlayingRef.current;
      setScreenshotMode(true);
      if (player) {
        recovery.stop();
        try { player.pause(); } catch {}
      }
    }
  }, [player, resetTapSequence, recovery, stopHold, onHoldActiveChange]);

  /** Dragging down during a speed hold locks it on, faster the further it goes. */
  const handleHoldMove = useCallback((dragDown: number) => {
    const kind = activeLongPressKindRef.current;
    if (kind !== "speed" && kind !== "rewind") return;
    const { rate, locked } = heldRate(dragDown);
    holdLockedRef.current = locked;
    if (kind === "speed") setHoldRate(rate);
    else setRewindRate(rate);
  }, []);

  const handleLongPressOut = useCallback(() => {
    longPressActiveRef.current = false;
    const kind = activeLongPressKindRef.current;
    activeLongPressKindRef.current = null;
    if (kind === null) return;
    onHoldActiveChange(false);

    if ((kind === "speed" || kind === "rewind") && holdLockedRef.current) {
      lockedHoldRef.current = kind;
      return;
    }
    // Clearing the override restores the viewer's chosen rate via the effect above.
    if (kind === "speed" || kind === "rewind") stopHold(kind);

    if (kind === "screenshot") {
      setScreenshotMode(false);
      if (wasPlayingBeforeLongPress.current) playIfActive();
    }
  }, [playIfActive, stopHold, onHoldActiveChange]);

  /**
   * Native recognizers arbitrate with the FlatList's own native scroll gesture.
   * RN Pressable used to resolve some short vertical flicks as `onPress` after
   * the pager had already moved, pausing the clip and starving the second and
   * third taps before the Like/Love ladder could see them. Both recognizers
   * fail at the same 10px boundary used by feed cards, leaving the pager alone.
   */
  const chromeVisible = !showComments && !screenshotMode && !overlaysHidden && !autoHidden;
  /**
   * The auto-clear only fades the buttons. They keep taking taps, so Back,
   * mute or like work on the first tap instead of first fetching the chrome
   * back; a tap on the video itself still brings it back as before. Only a
   * deliberate clear (swipe down, screenshot mode, a sheet) switches them off.
   */
  const chromeLive = !showComments && !screenshotMode && !overlaysHidden;

  /**
   * The strip the top buttons sit in, which the video must not take touches in
   * while they are showing.
   *
   * Gesture-handler hit-tests a view's real bounds, but the buttons' 44pt
   * reach comes from RN hitSlop, which only the JS responder honours. A tap
   * on the edge of Back therefore reached this screen's Tap as well, and when
   * a native gesture activates it cancels the JS responder: the Pressable
   * never saw its press, and the tap hid the buttons instead of going back.
   */
  const insets = useSafeAreaInsets();
  const topChromeBand = insets.top + EDGE + CHROME_SIZE + CHROME_HIT_SLOP.bottom + 4;

  const leaveViewer = useCallback(() => {
    if (navigation.isFocused()) navigation.goBack();
  }, [navigation]);

  /**
   * Swipe back by dragging right. The viewer is a transparent modal, so iOS
   * gives it no sideways pop, and Android only has the system gesture, which
   * button-navigation phones lack.
   * Sideways travel only: a vertical move fails it at once and the pager (or
   * the drag down into the mini player) keeps the flick, and it never claims a
   * tap. One per detector, since a gesture object can only be attached once.
   *
   * The whole viewer follows the finger on the UI thread, uncovering the
   * screen it was opened from, and on release springs either off to the right
   * (then pops) or back, carrying the flick's speed. A touch the system takes
   * back mid-drag ends unsuccessful and springs home rather than stranding
   * the page part-way.
   */
  const makeEdgeBack = useCallback((ref: React.MutableRefObject<GestureType | undefined>) => Gesture.Pan()
    .withRef(ref)
    .enabled(EDGE_BACK_ENABLED && isActive && !showComments && !screenshotMode)
    .activeOffsetX(EDGE_BACK_CLAIM)
    .failOffsetX(-EDGE_BACK_FAIL_Y)
    .failOffsetY([-EDGE_BACK_FAIL_Y, EDGE_BACK_FAIL_Y])
    .maxPointers(1)
    .onStart(() => {
      'worklet';
      if (backLeaving.value) return;
      // Caught again while springing home: carry on from where it is.
      cancelAnimation(backDrag);
      backGrab.value = backDrag.value;
    })
    .onUpdate((event) => {
      'worklet';
      if (!backLeaving.value) backDrag.value = Math.max(0, backGrab.value + event.translationX);
    })
    .onEnd((event, success) => {
      'worklet';
      if (backLeaving.value) return;
      if (success && settlesSwipeBack(backDrag.value, event.velocityX, SCREEN_WIDTH)) {
        backLeaving.value = true;
        backDrag.value = withSpring(SCREEN_WIDTH, { ...SWIPE_BACK_SPRING, velocity: event.velocityX }, () => {
          runOnJS(onSwipeBackSettled)();
        });
      } else {
        backDrag.value = withSpring(0, { ...SWIPE_BACK_SPRING, velocity: event.velocityX });
      }
    }), [isActive, showComments, screenshotMode, backDrag, backGrab, backLeaving, SCREEN_WIDTH, onSwipeBackSettled]);

  const minimizeFromDrag = useCallback(() => {
    const cancel = () => {
      miniHandingOff.value = false;
      miniHandoffFade.value = 1;
      miniDragY.value = withTiming(0, { duration: 180 });
      miniReveal.value = withTiming(0, { duration: 180 });
      if (navigation.isFocused()) onChromeVisibilityChange(chromeVisible);
    };
    if (!videoUrl || !ownsPlayerRef.current() || !frameRef.current) { cancel(); return; }
    // The frame is never transformed, so its window position is exact; where
    // the picture sits inside it comes from the same math that draws it.
    frameRef.current.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0 || !navigation.isFocused() || !ownsPlayerRef.current()) { cancel(); return; }
      const picture = containedPicture(width, height, intrinsicSize.width, intrinsicSize.height);
      const drawn = draggedPictureRect(width, height, picture, minimizeDrag(miniDragY.value, width, itemHeight));
      const opened = openInAppVideoMini({
        player, session: videoSession, url: videoUrl, item,
        restoreParams: captureViewerState(),
        thumbnail: typeof thumbnail === 'string' ? thumbnail : undefined,
        initialRect: { x: x + drawn.left, y: y + drawn.top, width: drawn.width, height: drawn.height },
        onCancel: cancel,
        onReady: () => { if (navigation.isFocused()) navigation.goBack(); },
      });
      if (!opened) { cancel(); return; }
      // The mini player now sits exactly over the picture and carries on from
      // there. What is left behind (the rest of the backdrop, and this picture,
      // which has just handed over its decoder) fades, so the route pops from
      // an empty screen instead of a dark one.
      miniReveal.value = withTiming(1, { duration: 160 });
      miniHandoffFade.value = withTiming(0, { duration: 120 });
    });
  }, [player, videoSession, videoUrl, item, thumbnail, navigation, miniHandingOff, miniHandoffFade, miniDragY, miniReveal, captureViewerState, onChromeVisibilityChange, chromeVisible, intrinsicSize, itemHeight]);

  // Remembered so a landscape clip opens on the texture (and can be dragged
  // into the mini player) the next time it comes round.
  useEffect(() => {
    if (intrinsicSize.width > 0 && intrinsicSize.height > 0) rememberVideoAspect(tokenId, intrinsicSize.width / intrinsicSize.height);
  }, [intrinsicSize, tokenId]);

  // The viewer's own reaction plays when the short comes up or the reaction
  // changes, then holds its frame. Left looping, its animated image was
  // re-uploaded every other frame for as long as the short played: on a
  // Galaxy S24+ that alone kept a still short about half late frames.
  const [glyphLive, setGlyphLive] = useState(false);
  useEffect(() => {
    if (!isActive) { setGlyphLive(false); return; }
    setGlyphLive(true);
    const timer = setTimeout(() => setGlyphLive(false), 3000);
    return () => clearTimeout(timer);
  }, [isActive, myReaction]);

  // Only the first short: on any other, a drag down is the swipe back to the
  // short before it, and taking it for a minimize dropped the viewer into the
  // mini player mid-swipe (Requests board). Picture in picture stays on its
  // button for those.
  const canMinimize = isFirst && isActive && ownsVideo && !pipPlayer && !noVideo && !showComments && !screenshotMode && !captionExpanded
    && !directSurface && intrinsicSize.width > 0 && intrinsicSize.height > 0 && intrinsicSize.width >= intrinsicSize.height;
  const minimizePan = useMemo(() => Gesture.Pan()
    .enabled(canMinimize)
    .manualActivation(true)
    .onTouchesDown((event, state) => {
      'worklet';
      const touch = event.allTouches[0];
      const picture = containedPicture(SCREEN_WIDTH, itemHeight, intrinsicSize.width, intrinsicSize.height);
      if (event.numberOfTouches !== 1 || !touch || touch.y < topChromeBand
        || !startsOnVideoPicture(touch.x, touch.y, picture)) { state.fail(); return; }
      miniStart.value = { x: touch.x, y: touch.y };
      miniHandingOff.value = false;
    })
    .onTouchesMove((event, state) => {
      'worklet';
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { state.fail(); return; }
      const dx = touch.x - miniStart.value.x;
      const dy = touch.y - miniStart.value.y;
      if (dy < -DRAG_RELEASE_MIN || Math.abs(dx) > Math.abs(dy) + DRAG_RELEASE_MIN) { state.fail(); return; }
      if (dy > DRAG_CLAIM_MIN && dy > Math.abs(dx)) state.activate();
    })
    .onStart(() => { 'worklet'; runOnJS(resetTapSequence)(); runOnJS(onChromeVisibilityChange)(false); })
    .onUpdate(event => {
      'worklet';
      miniDragY.value = Math.max(0, event.translationY);
      miniReveal.value = Math.min(1, miniDragY.value / Math.max(1, itemHeight * 0.35));
    })
    .onEnd((event, success) => {
      'worklet';
      if (success && commitsVideoMinimize(event.translationX, event.translationY)) {
        miniHandingOff.value = true;
        runOnJS(minimizeFromDrag)();
      }
    })
    .onFinalize(() => {
      'worklet';
      if (miniHandingOff.value) return;
      miniDragY.value = withTiming(0, { duration: 180 });
      miniReveal.value = withTiming(0, { duration: 180 });
      runOnJS(onChromeVisibilityChange)(chromeVisible);
    })
    .blocksExternalGesture(pagerGesture),
  [canMinimize, intrinsicSize, SCREEN_WIDTH,
    itemHeight, topChromeBand, miniStart, miniHandingOff, miniDragY, miniReveal, minimizeFromDrag,
    onChromeVisibilityChange, chromeVisible, pagerGesture, resetTapSequence]);

  /**
   * Drag the first short down to leave, the opposite of swiping on to the
   * next one. The viewer follows the finger, springs back if let go early, and
   * leaves past a third of the screen or on a fling. A wide or square picture
   * keeps its drag-to-minimize; a drag beside it still leaves. The caption
   * stack keeps its own swipe down, which clears the buttons.
   */
  const dismissStart = useSharedValue({ x: 0, y: 0 });
  const dismissPan = useMemo(() => Gesture.Pan()
    .enabled(isFirst && isActive && !showComments && !screenshotMode && !captionExpanded && !pipPlayer)
    .manualActivation(true)
    .onTouchesDown((event, state) => {
      'worklet';
      const touch = event.allTouches[0];
      if (event.numberOfTouches !== 1 || !touch) { state.fail(); return; }
      if (touch.y < topChromeBand) { state.fail(); return; }
      const picture = containedPicture(SCREEN_WIDTH, itemHeight, intrinsicSize.width, intrinsicSize.height);
      if (canMinimize && startsOnVideoPicture(touch.x, touch.y, picture)) { state.fail(); return; }
      dismissStart.value = { x: touch.x, y: touch.y };
    })
    .onTouchesMove((event, state) => {
      'worklet';
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches !== 1) { state.fail(); return; }
      const dx = touch.x - dismissStart.value.x;
      const dy = touch.y - dismissStart.value.y;
      if (dy < -DRAG_RELEASE_MIN || Math.abs(dx) > Math.abs(dy) + DRAG_RELEASE_MIN) { state.fail(); return; }
      if (dy > DRAG_CLAIM_MIN && dy > Math.abs(dx)) state.activate();
    })
    .onStart(() => { 'worklet'; runOnJS(resetTapSequence)(); })
    .onUpdate(event => {
      'worklet';
      dismissY.value = Math.max(0, event.translationY - DRAG_CLAIM_MIN);
    })
    .onEnd((event, success) => {
      'worklet';
      if (success && commitsDismiss(dismissY.value, event.velocityY, itemHeight)) {
        dismissY.value = withTiming(itemHeight, { duration: DISMISS_OUT_MS }, done => { if (done) runOnJS(leaveViewer)(); });
      } else {
        dismissY.value = withSpring(0, DISMISS_SPRING);
      }
    })
    .blocksExternalGesture(pagerGesture),
  [isFirst, isActive, showComments, screenshotMode, captionExpanded, pipPlayer, topChromeBand, SCREEN_WIDTH, itemHeight,
    intrinsicSize, canMinimize, dismissStart, dismissY, leaveViewer, resetTapSequence, pagerGesture]);

  // The pager stands still while two fingers are on the picture, and the tap
  // that ends a pinch is not a tap on the video.
  const pinchedAt = useRef(0);
  const markPinch = useCallback((active: boolean) => {
    pinchedAt.current = Date.now();
    onHoldActiveChange(active);
  }, [onHoldActiveChange]);
  const pinch = useMemo(() => Gesture.Pinch()
    .enabled(isActive && !noVideo && !showComments && !screenshotMode)
    .simultaneousWithExternalGesture(pagerGesture)
    .onStart((event) => {
      'worklet';
      pinching.value = true;
      pinchFrom.value = { x: event.focalX, y: event.focalY };
      runOnJS(markPinch)(true);
    })
    .onUpdate((event) => {
      'worklet';
      if (!pinching.value) return;
      const scale = Math.min(PINCH_MAX_SCALE, Math.max(1, event.scale));
      const from = pinchFrom.value;
      // The point between the fingers stays under them, and the picture can
      // be carried around while it is held.
      pinchScale.value = scale;
      pinchX.value = (from.x - SCREEN_WIDTH / 2) * (1 - scale) + (event.focalX - from.x);
      pinchY.value = (from.y - itemHeight / 2) * (1 - scale) + (event.focalY - from.y);
    })
    .onFinalize(() => {
      'worklet';
      if (!pinching.value) return;
      pinching.value = false;
      pinchScale.value = withTiming(1, { duration: 220 });
      pinchX.value = withTiming(0, { duration: 220 });
      pinchY.value = withTiming(0, { duration: 220 });
      runOnJS(markPinch)(false);
    }),
  [isActive, noVideo, showComments, screenshotMode, pagerGesture, SCREEN_WIDTH, itemHeight, markPinch, pinching, pinchFrom, pinchScale, pinchX, pinchY]);

  const screenGesture = useMemo(() => {
    const mediaHitSlop = { top: chromeLive ? -topChromeBand : 0 };
    const tap = Gesture.Tap()
      .maxDistance(MEDIA_TAP_SLOP_PX)
      .hitSlop(mediaHitSlop)
      .simultaneousWithExternalGesture(pagerGesture)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (success && Date.now() - pinchedAt.current > 350) handleScreenTap(event.x, event.y);
      });
    // A hold that keeps tracking the finger, so a drag down during it can lock
    // the speed. Moving before the hold lands fails it, leaving swipes alone.
    const hold = Gesture.Pan()
      .activateAfterLongPress(400)
      .maxPointers(1)
      .hitSlop(mediaHitSlop)
      .simultaneousWithExternalGesture(pagerGesture)
      .runOnJS(true)
      .onStart((event) => handleLongPressIn(event.x))
      .onUpdate((event) => handleHoldMove(event.translationY))
      .onFinalize(() => handleLongPressOut());
    return Gesture.Simultaneous(pinch, Gesture.Race(makeEdgeBack(edgeBackMediaRef), minimizePan, dismissPan, restorePan, hold, tap));
  }, [handleLongPressIn, handleHoldMove, handleLongPressOut, handleScreenTap, pagerGesture, minimizePan, dismissPan, restorePan, makeEdgeBack, chromeLive, topChromeBand, pinch]);

  const bottomStackGesture = useMemo(() => Gesture.Race(makeEdgeBack(edgeBackStackRef), hidePan), [makeEdgeBack, hidePan]);

  // The avatar and name open the creator's profile through gesture-handler
  // rather than a Pressable. On Android the stack above (and the video's own
  // tap under it) run their own hit test, and a JS-responder press there was
  // lost, so the tap did nothing. A native Tap on the row itself always wins.
  const creatorTap = useMemo(() => Gesture.Tap()
    .maxDistance(MEDIA_TAP_SLOP_PX)
    .simultaneousWithExternalGesture(pagerGesture)
    .runOnJS(true)
    .onEnd((_event, success) => {
      if (success) handleUserPress();
    }), [handleUserPress, pagerGesture]);

  // Swiping to another short brings the chrome back with it, so a cleared
  // frame never carries over to the next one. The picture is left alone: a
  // neighbour keeps its view (and its frame) mounted, and that view only
  // reports its first frame once (see the poster check above).
  useEffect(() => {
    if (isActive) return;
    resetTapSequence();
    tapAnimProgress.stopAnimation();
    setTapAnimReaction(null);
    setOverlaysHidden(false);
    setAutoHidden(false);
    setCaptionExpanded(false);
  }, [isActive, resetTapSequence, tapAnimProgress]);

  /**
   * Clear the chrome once the short has played untouched for AUTO_HIDE_MS.
   *
   * Every condition here is a reason the viewer is *reading* rather than
   * watching, and each one both blocks the timer and restarts it when it
   * lifts: paused, caption open, a sheet up, the reaction tray out, or the
   * chrome already cleared some other way.
   */
  useEffect(() => {
    if (
      !isActive ||
      !isPlaying ||
      autoHidden ||
      overlaysHidden ||
      screenshotMode ||
      captionExpanded ||
      showComments ||
      showTipModal ||
      showShareSheet ||
      showShareToDm ||
      pickerOpen
    ) {
      return;
    }
    const timer = setTimeout(() => setAutoHidden(true), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [
    isActive, isPlaying, autoHidden, overlaysHidden, screenshotMode,
    captionExpanded, showComments, showTipModal, showShareSheet, showShareToDm, pickerOpen,
  ]);

  // Pausing is a request to look at the frame, not to keep it clear — whatever
  // stopped playback (a tap, a sheet, losing focus) puts the chrome back.
  useEffect(() => {
    if (!isPlaying) setAutoHidden(false);
  }, [isPlaying]);

  useEffect(() => {
    Animated.timing(chromeOpacity, {
      toValue: chromeVisible ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [chromeVisible, chromeOpacity]);

  // Only the short being watched drives the screen-level chrome, and the
  // cleanup puts it back — otherwise swiping away mid-hold would strand the
  // top bar hidden.
  useEffect(() => {
    if (!isActive) return;
    onChromeVisibilityChange(chromeVisible);
    return () => onChromeVisibilityChange(true);
  }, [isActive, chromeVisible, onChromeVisibilityChange]);

  useEffect(() => {
    if (!isActive) return;
    onChromeLiveChange(chromeLive);
    return () => onChromeLiveChange(true);
  }, [isActive, chromeLive, onChromeLiveChange]);

  // A top-bar button pressed while the chrome was faded brings it back.
  useEffect(() => {
    if (isActive && chromeRevealTick > 0) setAutoHidden(false);
  }, [chromeRevealTick, isActive]);

  useEffect(() => {
    if (!activeItem) return;
    onWideChange(wideClip, cleanStage);
    return () => onWideChange(false, false);
  }, [activeItem, wideClip, cleanStage, onWideChange]);

  // Full screen is the wide player turned sideways, carrying on with the
  // same player from the same moment.
  const handingToFullscreen = useRef(false);
  const openFullscreen = useCallback((turned = false) => {
    if (!videoUrl || noVideo || !navigation.isFocused() || handingToFullscreen.current) return;
    let startTime = 0;
    try { startTime = player.currentTime ?? 0; } catch {}
    handingToFullscreen.current = true;
    preparePostMediaNavigation(videoUrl);
    navigation.navigate(ScreenNames.FullscreenVideo, {
      videoUrl,
      downloadUrl: signedShort ? undefined : getVideoUrl(tokenId),
      startTime,
      isMuted,
      thumbnail: typeof thumbnail === 'string' ? thumbnail : undefined,
      tokenId,
      isSignedIn: !!(viewer?.walletAddress || viewer?.address),
      storyboard: item.storyboard,
      landscape: true,
      turned,
    });
  }, [videoUrl, noVideo, navigation, player, signedShort, tokenId, isMuted, thumbnail, viewer, item.storyboard]);

  // Turning the phone sideways on a wide clip plays it full screen. The app
  // is held upright everywhere else, so the turn is only followed while a
  // wide clip is the one being watched.
  const openFullscreenRef = useRef(openFullscreen);
  openFullscreenRef.current = openFullscreen;
  const turnArmed = useRef(true);
  const [turnTick, setTurnTick] = useState(0);
  useEffect(() => {
    if (!activeItem) turnArmed.current = true;
  }, [activeItem]);
  useEffect(() => navigation.addListener('focus', () => {
    if (!handingToFullscreen.current) return;
    handingToFullscreen.current = false;
    // Closed by Back with the phone still sideways: following the turn again
    // now would reopen it, so this clip waits until it is swiped back to.
    turnArmed.current = takeFullscreenClosedUpright();
    setTurnTick((n) => n + 1);
  }), [navigation]);
  const followTurn = activeItem && isActive && wideClip && !showComments && !pipPlayer;
  useEffect(() => {
    if (!followTurn || !turnArmed.current) return;
    let sub: { remove(): void } | null = null;
    try {
      ScreenOrientation.unlockAsync().catch(() => {});
      sub = ScreenOrientation.addOrientationChangeListener((event) => {
        const now = event.orientationInfo.orientation;
        if (now === ScreenOrientation.Orientation.LANDSCAPE_LEFT || now === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) {
          openFullscreenRef.current(true);
        }
      });
    } catch {}
    return () => {
      try { sub?.remove(); } catch {}
      // Full screen takes the turn over from here; anything else goes back upright.
      if (!handingToFullscreen.current) ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, [followTurn, turnTick]);
  const fullscreenSeen = useRef(fullscreenTick);
  useEffect(() => {
    if (fullscreenSeen.current === fullscreenTick) return;
    fullscreenSeen.current = fullscreenTick;
    if (activeItem) openFullscreen();
  }, [fullscreenTick, activeItem, openFullscreen]);

  return (
    <View ref={frameRef} collapsable={false} style={{ width: SCREEN_WIDTH, height: itemHeight }}>
      <GestureDetector gesture={screenGesture}>
        <Reanimated.View
          style={[styles.playerFrame, showComments && { backgroundColor: "#000" }, cleanStage ? { backgroundColor: "#000" } : photoMedia && { backgroundColor: photoBackdrop }, playerStyle]}
        >
        <Reanimated.View style={pictureStyle}>
        <Reanimated.View style={pictureContentStyle}>
        {/* A clip that doesn't fill the screen sits on a blurred, dimmed copy
            of its own poster, so its edges blend out rather than cutting a
            hard line across the caption and action row. */}
        {!surfaceActive || !isNearby ? null : cleanStage ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]} pointerEvents="none" />
        ) : wideStage && WideVideoFill && !showComments ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]} pointerEvents="none">
            <WideVideoFill
              look={wideStage}
              width={SCREEN_WIDTH}
              height={itemHeight}
              picture={restPicture}
              poster={typeof thumbnail === 'string' ? thumbnail : undefined}
              storyboard={storyboard}
              player={player}
              live={isActive && isPlaying}
            />
          </View>
        ) : !noVideo && backdropSource ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <BlurSafeImage source={backdropSource} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} transition={0} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.35)" }]} />
          </View>
        ) : null}
        {/* useVideoPlayer never returns null, so a thumbnail-instead-of-player
            branch could never render and the short was a black frame until its
            first frame (or forever on a load failure). Draw the thumbnail under
            the VideoView and drop it once a frame has painted. */}
        {noVideo ? null : thumbnail && !firstFrameRendered ? (
          directSurface ? null : pictureKnown
            // Sits where the video will, so it does not jump when the first frame lands.
            ? <Reanimated.View style={videoBoxStyle} pointerEvents="none"><Image source={thumbnail} style={StyleSheet.absoluteFill} contentFit="cover" pointerEvents="none" /></Reanimated.View>
            : <Image source={thumbnail} style={StyleSheet.absoluteFill} contentFit="contain" pointerEvents="none" />
        ) : pictureKnown && backdropSource ? null : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }]} pointerEvents="none" />
        )}
        {/* Leaving the app from Shorts never starts PiP; the PiP button still does. */}
        {viewMounted ? (
          <Reanimated.View style={videoBoxStyle} pointerEvents="none">
            <PersistentVideoView
              ref={isActive ? activeVideoRef : undefined}
              allowsPictureInPicture
              startsPictureInPictureAutomatically={false}
              player={player}
              style={[StyleSheet.absoluteFill, { opacity: firstFrameRendered ? 1 : 0 }]}
              contentFit={pictureKnown ? "fill" : "contain"}
              nativeControls={false}
              key={directSurface ? "surface" : "texture"}
              surfaceType={directSurface ? "surfaceView" : "textureView"}
              pointerEvents="none"
              onFirstFrameRender={() => { setFirstFrameRendered(true); if (isActiveRef.current) recovery.progress(); finishInAppMiniRestore(player); }}
            />
          </Reanimated.View>
        ) : null}
        {/* A SurfaceView shows through everything drawn under it, so its
            poster has to sit on top until the first frame is up. */}
        {directSurface && !noVideo && thumbnail && !firstFrameRendered ? (
          pictureKnown
            ? <Reanimated.View style={videoBoxStyle} pointerEvents="none"><Image source={thumbnail} style={StyleSheet.absoluteFill} contentFit="cover" pointerEvents="none" /></Reanimated.View>
            : <Image source={thumbnail} style={StyleSheet.absoluteFill} contentFit="contain" pointerEvents="none" />
        ) : null}
        </Reanimated.View>
        </Reanimated.View>
        {reelStill && (
          <ReelStillSlide
            still={reelStill}
            width={SCREEN_WIDTH}
            height={itemHeight}
            isActive={isActive}
            bgId={reelBgId}
            onOpenPost={openPostPage}
          />
        )}
        {photoMedia && <ShortsPhotoPager images={photoMedia.imageUrls} galleryKey={String(tokenId)} width={SCREEN_WIDTH} pagerGesture={pagerGesture} />}
        {showLockCard && (
          <ReelLockCard
            subscribers={subLocked}
            line={subLocked
              ? (subQuote ? `${t("feedCard.subscribeFrom")} ${formatSubscriberTokens(subQuote.tokens)} ${tokenLabel()}` : username ? t("feedCard.subscribeTo", { name: username }) : t("feedCard.subscribeToCreator"))
              : undefined}
            onPress={subLocked
              ? () => { const id = username || minterAddress; if (id) showUserProfile(id); }
              : openPostPage}
          />
        )}
        {playbackPhase === 'failed' && isActive && <Pressable accessibilityRole="button"
          accessibilityLabel={t('common.retry')} style={{ position: 'absolute', top: 140, alignSelf: 'center', minHeight: 44, justifyContent: 'center', borderRadius: 22, paddingHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.7)' }}
          onPress={() => {
            setIsPausedByUser(false);
            playIfActive();
          }}><Text style={{ color: '#fff' }}>{t('common.retry')}</Text></Pressable>}
        </Reanimated.View>
      </GestureDetector>

      {tapAnimReaction && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: tapAnimPos.x,
            top: tapAnimPos.y,
            width: 64,
            height: 64,
            zIndex: 100,
          }}
        >
          <Animated.View
            style={{
              position: "absolute",
              width: 64,
              height: 64,
              alignItems: "center",
              justifyContent: "center",
              opacity: tapAnimProgress.interpolate({
                inputRange: [0, 0.18, 0.68, 1],
                // The overlay is mounted in response to the tap. Beginning at
                // zero let the video compositor consume its entrance before a
                // visible frame reached the screen.
                outputRange: [1, 1, 0.96, 0],
              }),
              transform: [
                {
                  translateY: tapAnimProgress.interpolate({
                    inputRange: [0, 0.2, 0.68, 1],
                    outputRange: [6, 0, -2, -12],
                  }),
                },
                {
                  scale: tapAnimProgress.interpolate({
                    inputRange: [0, 0.2, 0.42, 1],
                    outputRange: [0.76, 1.08, 1, 0.92],
                  }),
                },
              ],
            }}
          >
            <Icon
              name={tapAnimReaction === "love" ? "Heart" : "ThumbsUp"}
              size={tapAnimReaction === "love" ? 72 : 64}
              color={tapAnimReaction === "love" ? "#F43F5E" : "#0EA5E9"}
              fill={tapAnimReaction === "love" ? "#F43F5E" : "#0EA5E9"}
            />
          </Animated.View>

          {tapAnimReaction === "love" && LOVE_BLOOM.map((spark, index) => (
            <Animated.View
              key={index}
              style={{
                position: "absolute",
                left: 32 - spark.size / 2,
                top: 32 - spark.size / 2,
                opacity: tapAnimProgress.interpolate({
                  inputRange: [0, 0.16, 0.72, 1],
                  outputRange: [0, 0.9, 0.72, 0],
                }),
                transform: [
                  {
                    translateX: tapAnimProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, spark.x],
                    }),
                  },
                  {
                    translateY: tapAnimProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, spark.y],
                    }),
                  },
                  {
                    scale: tapAnimProgress.interpolate({
                      inputRange: [0, 0.24, 1],
                      outputRange: [0.55, 1, 0.7],
                    }),
                  },
                ],
              }}
            >
              <Icon name="Heart" size={spark.size} color="#FB7185" fill="#FB7185" />
            </Animated.View>
          ))}
        </View>
      )}

      {/* A hold's speed-up shows nothing: the picture speeding up is the
          feedback. A double-tap jump shows a soft count on its side. */}
      {seekFlash && (
        <Animated.View
          key={seekFlash.run}
          pointerEvents="none"
          style={[styles.seekFlash, seekFlash.side < 0 ? { left: SCREEN_WIDTH * 0.1 } : { right: SCREEN_WIDTH * 0.1 }, { top: itemHeight / 2 - 16, opacity: seekFlashOpacity }]}
        >
          <Text style={styles.seekFlashText}>{seekFlash.side < 0 ? "−" : "+"}{seekFlash.total}s</Text>
        </Animated.View>
      )}

      {!!videoUrl && isActive && isPausedByUser && !showComments && !screenshotMode && (
        <View style={styles.pauseOverlay} pointerEvents="none">
          <Icon name="Play" size={64} color="rgba(255,255,255,0.7)" />
        </View>
      )}

      {/* The timeline, in its own row between the action row and the player's
          buttons. Along the floor of the screen it sat inside the strip iOS
          keeps for its home gesture, so a drag there switched apps instead of
          seeking. Up here it is a finger tall, and grows a glass lens. */}
      <Animated.View
        style={[styles.scrubTrack, { opacity: videoUrl ? chromeOpacity : 0 }]}
        pointerEvents={videoUrl && chromeVisible && isActive ? "auto" : "none"}
      >
        {/* Drawn over the picture or the always-dark stage, so it keeps its
            white in System Light. */}
        <KeepDarkScope>
        <GestureDetector gesture={scrubGesture}>
          <View
            style={styles.scrubHitArea}
            onLayout={onScrubTrackLayout}
            {...scrubTouchGuard}
            accessibilityRole="adjustable"
          >
            <View style={[styles.scrubLine, scrubbing && styles.scrubLineActive]}>
              <Animated.View
                style={[styles.scrubFill, scrubbing && styles.scrubFillActive, scrubFillStyle]}
              />
            </View>
            <Animated.View style={[styles.scrubThumbSlot, scrubThumbStyle]} pointerEvents="none">
              {scrubbing ? (
                // The lens: the line under the finger, drawn larger inside glass.
                <Reanimated.View entering={ZoomIn.duration(160)} style={styles.scrubLens}>
                  <View style={styles.scrubLensLine}>
                    <View style={styles.scrubLensPlayed} />
                  </View>
                  <LinearGradient
                    colors={["rgba(255,255,255,0.5)", "rgba(255,255,255,0)", "rgba(255,255,255,0.14)"]}
                    locations={[0, 0.45, 1]}
                    style={StyleSheet.absoluteFill}
                  />
                </Reanimated.View>
              ) : (
                <View style={styles.scrubThumb} />
              )}
            </Animated.View>
          </View>
        </GestureDetector>
        </KeepDarkScope>
        {/* The frame under the finger, with its time, floated over the lens.
            Without a storyboard it is just the time. */}
        <View style={styles.scrubPreviewLayer} pointerEvents="none">
          <StoryboardPreview
            storyboard={storyboard}
            fraction={scrubRatio}
            duration={durationRef.current || player.duration || 0}
            trackWidth={trackWidth}
            visible={scrubbing}
            bottom={SCRUB_HEIGHT / 2 + 24}
            timeOnly
          />
        </View>
      </Animated.View>

      {/* Faded, not unmounted: the swipe-down clear and the restore tap both
          animate this, and keeping it mounted means nothing re-lays-out on the
          way back. pointerEvents goes with it so a cleared frame cannot be
          tapped through an invisible avatar. */}
      <Reanimated.View style={[StyleSheet.absoluteFill, miniChromeStyle]} pointerEvents="box-none">
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: chromeOpacity }]}
        pointerEvents={chromeLive ? "box-none" : "none"}
        // A button pressed while faded also brings the rest of the chrome back.
        onTouchStart={autoHidden ? () => setAutoHidden(false) : undefined}
      >
        {/* An open caption dims the video so it reads properly, as on web. A
            tap on the dimmed video closes it again. */}
        {captionExpanded && (
          <Reanimated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}
            style={[StyleSheet.absoluteFill, styles.captionDim]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setCaptionExpanded(false)}
              accessibilityRole="button"
              accessibilityLabel={_copy("copy.4fdd3b6201a2", { defaultValue: "less" })}
            />
          </Reanimated.View>
        )}

        {/* Legibility gradient behind the bottom stack, as on web. */}
        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.85)"]}
          style={styles.bottomGradient}
          pointerEvents="none"
        />

        {/* Creator info + caption, with the action row as the bottommost
            element.

            The stack takes touches rather than being box-none, which is both
            what web does (`pointer-events-auto` on its caption and action row,
            `none` only on the wrapper) and what the swipe-down needs. On
            Android gesture-handler runs its own hit test, and under BOX_NONE
            it records a view's handlers only if some descendant was itself a
            valid target — background-less Views never are, and an Icon is SVG
            rather than child Views, so the handler would only ever be reached
            through the text leaves. Empty pixels between the icons, which is
            most of the row, would silently not start the gesture.

            The trade is explicit: these pixels can start the swipe or fall
            through to the video, not both. Web makes the same one. */}
        <GestureDetector gesture={bottomStackGesture}>
          <View
            onLayout={(e) => {
              const height = e.nativeEvent.layout.height;
              overlayHeight.value = height;
            }}
            style={[
              styles.bottomStack,
              // A slide with nothing to play has no scrubber row to clear.
              !videoUrl && { bottom: EDGE + TOOLS_HEIGHT + 12 },
            ]}
          >
            <View style={styles.captionBlock}>
              <GestureDetector gesture={creatorTap}>
              <View
                style={styles.creatorRow}
                accessible
                accessibilityRole="button"
                accessibilityLabel={displayName}
                onAccessibilityTap={handleUserPress}
              >
                {/* The shared Avatar, not a bare expo-image: it guards the
                    "default-avatar" sentinel, falls back to the initial on a
                    load error, and carries a recyclingKey so a reused cell never
                    shows the previous creator's face. Web's equivalent is the
                    Avatar/AvatarFallback pair at w-12 h-12 rounded-xl. */}
                <Avatar
                  uri={avatarUrl}
                  name={displayName}
                  // An animated avatar decoded every frame on each mounted
                  // short; only the one being watched plays it.
                  animate={isActive}
                  size={48}
                  style={styles.avatar}
                />
                <View style={styles.creatorText}>
                  <View style={styles.creatorNameRow}>
                    <Text numberOfLines={1} style={[styles.creatorName, styles.creatorNameText]}>
                      {displayName}
                    </Text>
                    {badgeImg ? (
                      <BadgeArtwork
                        source={badgeImg}
                        style={[getBadgeOpticalStyle(badgeImg, 16, 0, 20), { marginLeft: 4 }]}
                        resizeMode="contain"
                        fadeDuration={0}
                      />
                    ) : null}
                  </View>
                  {username ? (
                    <Text numberOfLines={1} style={styles.creatorHandle}>
                      @{username}
                    </Text>
                  ) : null}
                </View>
              </View>
              </GestureDetector>

              {photoMedia?.sound ? <Text numberOfLines={1} style={styles.captionBody}>♫ {photoMedia.sound}</Text> : null}
              {shownTitle || shownDescription ? (
                <Pressable onPress={() => setCaptionExpanded((p) => !p)} hitSlop={8}>
                  {shownTitle ? (
                    <Text
                      numberOfLines={captionExpanded ? undefined : 1}
                      style={styles.captionTitle}
                    >
                      {shownTitle}
                    </Text>
                  ) : null}
                  {shownDescription ? (
                    <Text
                      numberOfLines={captionExpanded ? undefined : 2}
                      style={styles.captionBody}
                    >
                      {shownDescription}
                    </Text>
                  ) : null}
                  {/* Web shows the affordance on a long description; the title
                      is clamped to one line here, so a long one earns it too —
                      otherwise a clamped caption offers no hint it opens. */}
                  {shownDescription.length > 80 || shownTitle.length > 40 ? (
                    <Text style={styles.captionMore}>
                      {captionExpanded ? _copy("copy.4fdd3b6201a2", { defaultValue: "less" }) : _copy("copy.187897ce0afc", { defaultValue: "more" })}
                    </Text>
                  ) : null}
                </Pressable>
              ) : null}
              {/* The way back to the original. Sits under the caption rather
                  than in the metadata row the feed card puts it in — this
                  overlay has no metadata row, and the action row below is a
                  fixed five-cell grid with no spare cell to give it. */}
              {showTranslate ? (
                <View style={styles.captionTranslate}>
                  <TranslateButton
                    isTranslated={isTranslated}
                    isLoading={translating}
                    detectedLanguage={item.detectedLanguage}
                    onTranslate={handleTranslate}
                    onShowOriginal={handleShowOriginal}
                    inline
                  />
                </View>
              ) : null}
              {/* "Duet with @x", "3 reactions" and the rest, as web's Shorts viewer. */}
              <RemixCredits tokenId={tokenId} overlay enabled={!noVideo && isActive} />
            </View>

            {/* Action row — bare icons over the scrim, no slab. Web draws this
                as `flex items-center justify-between` with nothing behind it;
                the glass tray that used to sit here is what made the viewer read
                as a different app from the web one.

                The cells are still equal flex shares rather than
                `justify-between` over content-sized children, because a count
                growing from "9" to "12.4K" shoved every icon beside it sideways.
                The first and last cell align to their outer edges, so the row
                still starts and ends flush with the caption above it exactly as
                web's does. */}
            {/* The frame preview floats over this row while scrubbing, as on web. */}
            <View testID="shorts-actions" className="dark-surface" style={[styles.actionBar, scrubbing && { opacity: 0 }]}>
              {/* Views — a readout, not a button, as on web. */}
              <View style={[styles.actionCell, styles.actionCellFirst]}>
                <Icon name="Eye" size={20} color={ICON_COLOR} strokeWidth={1.8} />
                <Text style={styles.actionCount} numberOfLines={1}>
                  {formatCompactNumber(views)}
                </Text>
              </View>

              {showPurchaseOffer && (
              <ActionButton
                icon="Gem"
                label={formatCompactNumber(tipCount)}
                onPress={handleTip}
                pagerGesture={pagerGesture}
                accessibilityLabel={t("comments.tip")}
              />
              )}

              {/* Share — carries the repost count, and opens the share sheet. */}
              <ActionButton
                icon="Share2"
                iconNode={shareIconStyle === "distribute" ? <DistributeIcon size={20} color={ICON_COLOR} strokeWidth={reposted ? 2.6 : 1.8} /> : undefined}
                active={reposted}
                label={formatCompactNumber(shareCount)}
                onPress={() => setShowShareSheet(true)}
                pagerGesture={pagerGesture}
                accessibilityLabel={t("postOptions.share")}
              />

              <ActionButton
                icon="MessageSquare"
                label={formatCompactNumber(commentCount)}
                onPress={handleComment}
                pagerGesture={pagerGesture}
                accessibilityLabel={t("settings.comments")}
              />

              {/* Reactions — tap to like/unlike, hold for the tray of every
                  reaction, 👎 last (there is no separate thumbs-down).
                  The outer view is the cell; the inner one is the tray's
                  positioning context and stays button-sized, so the tray anchors
                  to the thumb rather than to the whole cell. The tray keeps
                  itself inside the screen from there. */}
              <View style={[styles.actionCell, styles.actionCellLast]}>
                <View style={{ position: "relative" }}>
                  <ReactionPicker
                    open={openTray === "positive"}
                    current={myReaction}
                    counts={reactionCounts}
                    onSelect={(reaction) => { setOpenTray(null); handleReaction(reaction); }}
                    onClose={() => setOpenTray(null)}
                    align="right"
                    onShowInfo={
                      isOwnShort && tokenId != null
                        ? () => { setOpenTray(null); setShowReactionInfo(true); }
                        : undefined
                    }
                  />
                  <ActionButton
                    style={styles.actionInline}
                    icon={thumbDown ? "ThumbsDown" : "ThumbsUp"}
                    glyph={thumbGlyph}
                    glyphAnimated={!!thumbGlyph && thumbGlyph === myReaction}
                    glyphPlaying={glyphLive}
                    nod={thumbMine ? (thumbDown ? "down" : "up") : undefined}
                    active={thumbMine}
                    label={formatCompactNumber(thumbCount)}
                    onPress={() => { if (openTray === "positive") { setOpenTray(null); return; } handleLike(); }}
                    onLongPress={() => setOpenTray("positive")}
                pagerGesture={pagerGesture}
                    accessibilityLabel={
                      myReaction
                        ? _copy("copy.a3156ed263d2", { defaultValue: "{{value1}} — hold to change your reaction", value1: reactionMeta(myReaction).label })
                        : _copy("copy.12b91b0ac5dd", { defaultValue: "{{value1}} — hold to react", value1: reactionMeta(leadReaction ?? "like").label })
                    }
                  />
                </View>
              </View>
            </View>
          </View>
        </GestureDetector>
      </Animated.View>
      </Reanimated.View>

      {showShareSheet && tokenId != null && (
        <ShareSheet
          visible={showShareSheet}
          onClose={() => setShowShareSheet(false)}
          isReposted={reposted}
          onRepost={() => handleRepost(true)}
          onUndoRepost={() => handleRepost(false)}
          onQuote={handleQuote}
          canQuote={isPublicShort && ((item as any).quotePolicy !== "nobody" || isOwnShort)}
          canRepost={isPublicShort}
          onCopyLink={handleCopyLink}
          // As on a feed post: send this short straight into a conversation.
          onSendToDm={viewerSignedIn && isPublicShort ? () => setShowShareToDm(true) : undefined}
          embedTokenId={isPublicShort ? tokenId : undefined}
        />
      )}

      {showShareToDm && tokenId != null && (
        <ShareToDmSheet
          visible={showShareToDm}
          onClose={() => setShowShareToDm(false)}
          {...(typeof (item as any)?.articleSlug === "string" && (item as any).articleSlug
            ? { url: ShareLinks.post((item as any).articleSlug) }
            : { tokenId })}
          postTitle={title || undefined}
        />
      )}

      {tokenId != null && (
        <CommentBottomSheet
          visible={showComments}
          inlineHeight={splitHeight}
          bottomOffset={keyboardOffset}
          slideOffset={commentsSlide}
          onClose={() => setShowComments(false)}
          tokenId={tokenId}
          commentsDisabled={!!(item as any).commentsDisabled}
          replyPolicy={(item as any).replyPolicy}
          forKids={!!(item as any).forKids}
          postCreator={{ address: minterAddress, displayName, username }}
          placeholder={t("comments.shortsPlaceholder", { defaultValue: "Say something..." })}
        />
      )}

      {showReactionInfo && tokenId != null && (
        <ReactionInfoSheet
          visible={showReactionInfo}
          onClose={() => setShowReactionInfo(false)}
          tokenId={tokenId}
        />
      )}

      {minterAddress ? (
        <GlassTipSheet
          visible={showTipModal}
          onClose={() => setShowTipModal(false)}
          toAddress={minterAddress}
          tokenId={Number(tokenId) || 0}
          recipientName={displayName}
          tipContext="content"
        />
      ) : null}
    </View>
  );
});

const ShortsViewerScreen = () => {
  const { t: _copy } = _useCopy();
  const downloadVideo = useVideoDownload();
  const mediaInsets = useSafeAreaInsets();
  const { t } = useCopy();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const user = useUser();
  const { requireAuth } = useAuthActions();
  const kidsMode = useKidsModeLock();
  const {
    initialIndex = 0,
    initialItems = [],
    initialThumbnail,
    initialPage,
    feedParams = {},
  } = (route?.params as any) || {};

  // When entering from FeedCard with a single item, start at page 0
  // so the first loadMore fetches page 1 (the full first page of shorts).
  const isFromFeed = initialItems.length <= 1;

  const [items, setItems] = useState<UnifiedFeedItem[]>(initialItems);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  // The sound session is set up once for the viewer, not once per short.
  // Redoing it as each short landed re-routed the phone's audio under a clip
  // that was already playing, which froze it for a beat on every swipe.
  const viewerPlaybackAllowed = useFeedPlaybackAllowed();
  useEffect(() => {
    if (!viewerPlaybackAllowed) return;
    configureForBackgroundPlayback().catch(() => {});
    return () => { releaseBackgroundPlayback().catch(() => {}); };
  }, [viewerPlaybackAllowed]);
  // The viewer is opaque black, so a live theme scene behind it (a WebGL
  // page under the navigator) was drawing every frame for nobody. Pause it
  // while the viewer is in front; it carries on from where it was.
  useEffect(() => {
    const hide = () => setThemeBackdropVisible(false);
    const show = () => setThemeBackdropVisible(true);
    if (navigation.isFocused?.()) hide();
    const offFocus = navigation.addListener("focus", hide);
    const offBlur = navigation.addListener("blur", show);
    return () => { offFocus(); offBlur(); show(); };
  }, [navigation]);
  const [page, setPage] = useState(initialPage ?? (isFromFeed ? 0 : 1));
  const viewerRestore = useRef({ initialIndex: activeIndex, initialItems: items, initialPage: page, feedParams });
  viewerRestore.current = { initialIndex: activeIndex, initialItems: items, initialPage: page, feedParams };
  const captureViewerState = useCallback(() => viewerRestore.current, []);

  // Lives among the shorts, as on web: on the main Shorts feed only (not a
  // profile, a search or Following), open and safe streams, one slide in six.
  // Placed once, after the short the viewer opened on, so nothing under the
  // viewer moves; later pages are shorts only.
  const liveSlidesAllowed = !feedParams.minter && !feedParams.profileFeed && !feedParams.search && !feedParams.followingOnly && !feedParams.brainrot
    && !initialItems.some((it: any) => isLiveSlide(it));
  const { data: liveRows } = useQuery({
    queryKey: ["dehub-live-streams", 200, "recent"],
    queryFn: () => getLiveVideos({ unit: 200, sortMode: "recent" }),
    enabled: liveSlidesAllowed,
    staleTime: 60_000,
    retry: false,
  });
  const liveSlidesPlaced = useRef(false);
  useEffect(() => {
    if (!liveSlidesAllowed || liveSlidesPlaced.current || !liveRows) return;
    const rows: any[] = Array.isArray(liveRows) ? liveRows : Array.isArray((liveRows as any)?.result) ? (liveRows as any).result : [];
    const slides = rows.filter(isVerticalFeedLive).slice(0, LIVE_SLIDE_MAX).map(toLiveSlide);
    if (!slides.length) { liveSlidesPlaced.current = true; return; }
    if (items.length < activeIndex + LIVE_SLIDE_EVERY + 1) return;
    liveSlidesPlaced.current = true;
    setItems((prev) => interleaveLive(prev, slides, activeIndex) as UnifiedFeedItem[]);
  }, [liveSlidesAllowed, liveRows, items.length, activeIndex]);
  const endReachedRef = useRef(false);
  // A profile tab's list starts with the posts before the tapped one; skip
  // those until it turns up.
  const profilePastRef = useRef(false);
  const loadFailedAt = useRef(0);
  const [loadRetry, setLoadRetry] = useState(0);
  const fetchingRef = useRef(false);
  const shuffleSeedRef = useRef<string | undefined>(feedParams.shuffleSeed);
  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const [containerHeight, setContainerHeight] = useState(SCREEN_HEIGHT);
  const miniReveal = useSharedValue(0);
  // A drag down on the first short pulls the whole viewer off the bottom.
  const dismissY = useSharedValue(0);
  const [holdActive, setHoldActive] = useState(false);
  const viewerBackdrop = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(miniReveal.value, 0.7 * Math.min(1, dismissY.value / Math.max(1, SCREEN_HEIGHT))),
  }), [SCREEN_HEIGHT]);
  // The edge back (see makeEdgeBack in ShortItem). This screen draws its own,
  // so the screen-wide release-to-go-back one stands down.
  useOwnEdgeSwipe(EDGE_BACK_ENABLED);
  const backDrag = useSharedValue(0);
  const backLeaving = useSharedValue(false);
  const backPageStyle = useAnimatedStyle(() => {
    const down = Math.min(1, dismissY.value / Math.max(1, SCREEN_HEIGHT));
    return {
      transform: [{ translateX: backDrag.value }, { translateY: dismissY.value }, { scale: 1 - down * 0.08 }],
      borderRadius: Math.min(28, down * 160),
      overflow: 'hidden',
    };
  }, [SCREEN_HEIGHT]);
  // The viewer is a transparent modal, so the screen it was opened from is
  // already underneath. It shows through dimmed and brightens as the page
  // leaves, as under the iOS pop.
  const backScrimStyle = useAnimatedStyle(() => ({
    opacity: backDrag.value > 0 ? 0.3 * (1 - swipeBackProgress(backDrag.value, SCREEN_WIDTH)) : 0,
  }));
  const backReturnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (backReturnTimer.current) clearTimeout(backReturnTimer.current); }, []);
  const onSwipeBackSettled = useCallback(() => {
    if (backReturnTimer.current) return;
    if (navigation.isFocused() && navigation.canGoBack()) navigation.goBack();
    // A refused removal (an OS picture-in-picture window holds the route) must
    // not leave the page parked off screen.
    backReturnTimer.current = setTimeout(() => {
      backReturnTimer.current = null;
      if (!navigation.isFocused()) return;
      backLeaving.value = false;
      backDrag.value = withSpring(0, SWIPE_BACK_SPRING);
    }, 700);
  }, [navigation, backDrag, backLeaving]);
  const [hasMeasuredViewport, setHasMeasuredViewport] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(SCREEN_HEIGHT);
  const [noMoreShorts, setNoMoreShorts] = useState(false);
  // True until the first page resolves when the viewer opened without items.
  const [initialLoading, setInitialLoading] = useState(initialItems.length === 0);

  // Opened by swiping up out of a fullscreen video: the feed is the brainrot
  // mix (libs/brainrotFeed) rather than one sorted list. Created once, so the
  // clips it has already dealt never move.
  const { isSignedIn } = useAuthState();
  const brainrotRef = useRef<ReturnType<typeof createBrainrotSource<UnifiedFeedItem>> | null>(null);
  if (feedParams.brainrot && !brainrotRef.current) {
    // Joins the lists a video card already started loading (warmShortsFeed),
    // so the next clips are usually here before the first swipe.
    brainrotRef.current = createBrainrotSource<UnifiedFeedItem>({
      seed: Date.now() % 2147483647,
      fromId: feedParams.fromId,
      ...shortsFeedFetchers(isSignedIn),
    });
  }

  // Viewer-level playback chrome — mute and speed persist across shorts, as on
  // web, rather than resetting with every slide.
  const isMuted = useMediaMuted();
  // The phone's volume keys move everything at once. Holding the speaker and
  // dragging sets this short's own level, and it is remembered the same way
  // the playback rate is. Same gesture as the feed player.
  const [volume, setVolume] = useState(() => getVolume());
  const [volumeAdjusting, setVolumeAdjusting] = useState(false);
  const volumeRef = useRef(volume);

  const applyVolume = useCallback((next: number) => {
    const level = Math.max(0, Math.min(1, next));
    volumeRef.current = level;
    setVolume(level);
    persistVolume(level);
    setMutedState(level === 0);
  }, []);

  const volumePanResponder = useFeedVolumeResponder({
    onHoldStart: () => {
      setVolumeAdjusting(true);
      return isMuted ? 0 : volumeRef.current;
    },
    onVolume: applyVolume,
    onTap: () => setMutedState(!getCachedMuted()),
    onEnd: () => setVolumeAdjusting(false),
  });
  const [playbackRate, setPlaybackRate] = useState<number>(() => getPlaybackRateFor(initialItems[initialIndex]?.minter || initialItems[initialIndex]?.minterUser?.address));
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showBoost, setShowBoost] = useState(false);
  // Clearing a short's chrome — by holding the middle of it, or by the
  // swipe-down — is reported up so the top bar goes with it.
  const [chromeVisible, setChromeVisible] = useState(true);
  const [chromeLive, setChromeLive] = useState(true);
  const [chromeRevealTick, setChromeRevealTick] = useState(0);
  const revealChrome = useCallback(() => setChromeRevealTick((n) => n + 1), []);
  const [fullscreenTick, setFullscreenTick] = useState(0);
  // For the loop switch in the options menu.
  const isLoopingNow = useMediaLooping();
  const [activeWide, setActiveWide] = useState(false);
  const [activeClean, setActiveClean] = useState(false);
  const handleWideChange = useCallback((wide: boolean, clean: boolean) => {
    setActiveWide(wide);
    setActiveClean(clean);
  }, []);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const topChromeOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(topChromeOpacity, {
      toValue: chromeVisible ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [chromeVisible, topChromeOpacity]);

  // Follow / visibility overrides keyed by creator address and token, so an
  // action taken in the options menu sticks while the viewer stays open.
  const [followOverrides, setFollowOverrides] = useState<Record<string, boolean>>({});
  const [hiddenOverrides, setHiddenOverrides] = useState<Record<string, boolean>>({});

  const activeItem = items[activeIndex];
  const activeTokenId = activeItem?.tokenId ?? activeItem?.id;
  const activeEngagement = useEngagement(activeItem);
  const activeMinter = activeItem?.minter || activeItem?.minterUser?.address || "";
  const activeUsername = activeItem?.minterUser?.username || activeItem?.minterUsername || "";
  const activeDisplayName =
    activeItem?.minterUser?.displayName ||
    activeItem?.minterDisplayName ||
    activeUsername ||
    (activeMinter ? `${activeMinter.slice(0, 6)}…${activeMinter.slice(-4)}` : "");
  const userAddress = user?.address || user?.walletAddress || "";
  const isOwnerOfActive = !!(
    (activeItem as any)?.isOwner ||
    (userAddress && activeMinter && userAddress.toLowerCase() === activeMinter.toLowerCase())
  );
  // Boost, as on the feed card: the owner boosts their own post, and anyone
  // holding Deep Current can gift one to somebody else's.
  const { data: superpowerStatus } = useSuperpowers();
  const canGiftBoost = !!superpowerStatus?.powers.some(
    p => p.key === 'deep_current' && p.unlocked && p.available,
  );
  const canBoostActive = DIGITAL_PURCHASES_ENABLED && isSignedIn && activeTokenId != null && !!activeItem && !isLiveSlide(activeItem);
  const activeIsFollowing =
    followOverrides[activeMinter.toLowerCase()] ?? !!(activeItem as any)?.isFollowing;
  const activeIsHidden =
    hiddenOverrides[String(activeTokenId)] ?? !!(activeItem as any)?.isHidden;

  const handleContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h <= 0) return;
    // Full screen turns the whole window sideways while this screen waits
    // underneath it. Its pages keep their upright size, so the pager is on
    // the same short when the viewer comes back.
    if (e.nativeEvent.layout.width > h) return;
    setHasMeasuredViewport(true);
    setViewportHeight(h);
    // Keep pager offsets stable while Android resizes for the reply keyboard.
    // Only the active short's split area should shrink, not every list item.
    if (!commentsVisible) setContainerHeight(h);
  }, [commentsVisible]);

  /**
   * Fill in a caller that handed us only a tokenId.
   *
   * NotificationScreen navigates here with `[{ tokenId, postType: 'short' }]`
   * and nothing else (NotificationScreen.tsx:744-753). The video still plays,
   * because its URL is derived from the tokenId alone — but the avatar, the
   * creator name, the title, the description and every count come from the
   * payload, so that short renders as a playing video with no author and no
   * text at all. `loadMore` only ever appends, so nothing else ever fixes it:
   * swipe once and the fetched shorts are complete, which is why it looks
   * intermittent.
   *
   * Hydrating here rather than in the caller covers every future thin caller
   * too. The existing fields win over the fetched ones so anything the caller
   * did know stays authoritative.
   */
  useEffect(() => {
    const seed = items[0];
    if (!seed || items.length !== 1) return;
    if (seed.minterUser || seed.minterAvatarUrl || seed.name) return;
    const id = seed.tokenId ?? seed.id;
    if (id == null) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await getNFT(id);
        const payload = (res?.result || res) as any;
        if (cancelled || !payload || typeof payload !== "object") return;
        setItems((prev) =>
          prev.map((it, i) =>
            i === 0
              ? {
                  ...payload,
                  // `/nft_info/:id` answers `mintername`, not `minterUsername`
                  // — without this the username fallback rung is dead on a
                  // hydrated item.
                  minterUsername: payload.minterUsername || payload.mintername,
                  ...it,
                }
              : it,
          ),
        );
      } catch {
        // The video still plays; leaving the husk beats blanking the screen.
      }
    })();
    return () => {
      cancelled = true;
    };
    // Once, on mount — a later append must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = useCallback(async () => {
    if (endReachedRef.current || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      if (brainrotRef.current) {
        const { items: next, done } = await brainrotRef.current.next();
        if (done) {
          endReachedRef.current = true;
          setNoMoreShorts(true);
        }
        setItems((prev) => {
          const existingIds = new Set(prev.map((i) => String(i.tokenId ?? i.id)));
          const unique = next.filter((i) => !existingIds.has(String(i.tokenId ?? i.id)));
          return unique.length ? [...prev, ...unique] : prev;
        });
        return;
      }
      // Opened from a profile tab: that tab's videos, in its order, after the
      // one tapped.
      if (feedParams.profileFeed) {
        let nextPage = page;
        for (let attempt = 0; attempt < 4; attempt++) {
          nextPage += 1;
          const res = await getUnifiedFeed(profileFeedParams(feedParams.profileFeed, nextPage, 20));
          let batch: UnifiedFeedItem[] = res.result || [];
          if (!profilePastRef.current) {
            const at = batch.findIndex((i) => String(i.tokenId ?? i.id) === String(feedParams.fromId));
            if (at >= 0) profilePastRef.current = true;
            batch = at >= 0 ? batch.slice(at + 1) : [];
          }
          const known = new Set(itemsRef.current.map((i) => String(i.tokenId ?? i.id)));
          // The reel takes every kind of post; the Shorts continuation only videos.
          // Older videos carry no postType at all, so a video file counts too.
          const unique = batch.filter((i) => (feedParams.reel ? isReelSlide(i as any) : isReelVideo(i as any) && i.postType !== "short" && canOpenPostVideoViewer(i as any)) && !known.has(String(i.tokenId ?? i.id)));
          if (unique.length) {
            itemsRef.current = [...itemsRef.current, ...unique];
            setItems((prev) => {
              const existingIds = new Set(prev.map((i) => String(i.tokenId ?? i.id)));
              const fresh = unique.filter((i) => !existingIds.has(String(i.tokenId ?? i.id)));
              return fresh.length ? [...prev, ...fresh] : prev;
            });
          }
          // Out of pages, or the tapped video never turned up in the first few.
          if (!res.pagination?.hasMore || (!profilePastRef.current && nextPage >= 5)) {
            endReachedRef.current = true;
            setNoMoreShorts(true);
            break;
          }
          if (unique.length) break;
        }
        setPage(nextPage);
        return;
      }
      // A page can bring nothing new (everything on it is already playing,
      // e.g. the Home row's shorts sit at the top of the same ranking). The
      // list's content then never changes, onEndReached never fires again and
      // the viewer just stopped. Keep paging until something new arrives.
      let nextPage = page;
      for (let attempt = 0; attempt < 4; attempt++) {
        nextPage += 1;
        // Opened from the Shorts search: keep paging through the matches.
        const res: { result: UnifiedFeedItem[]; pagination?: { hasMore?: boolean }; shuffleSeed?: string } = feedParams.search
          ? await getUnifiedFeed({ ...feedParams, page: nextPage, limit: 20 })
          : await getShortsFeed({
            page: nextPage,
            limit: 20,
            sortBy: feedParams.sortBy || "createdAt" as const,
            shuffleSeed: shuffleSeedRef.current,
            category: feedParams.category,
            minter: feedParams.minter,
            followingOnly: feedParams.followingOnly,
          });
        const newItems = res.result || [];

        if (res.shuffleSeed && !shuffleSeedRef.current) {
          shuffleSeedRef.current = res.shuffleSeed;
        }

        const known = new Set(itemsRef.current.map((i) => String(i.tokenId ?? i.id)));
        // Deduplicate by tokenId/id to avoid showing the same short twice
        const unique = newItems.filter((i) => !known.has(String(i.tokenId ?? i.id)));
        if (unique.length) {
          itemsRef.current = [...itemsRef.current, ...unique];
          setItems((prev) => {
            const existingIds = new Set(prev.map((i) => String(i.tokenId ?? i.id)));
            const fresh = unique.filter((i) => !existingIds.has(String(i.tokenId ?? i.id)));
            return fresh.length ? [...prev, ...fresh] : prev;
          });
        }
        if (!res.pagination?.hasMore) {
          endReachedRef.current = true;
          setNoMoreShorts(true);
          break;
        }
        if (unique.length) break;
      }
      setPage(nextPage);
    } catch (_err) {
      // A failed page used to be silent and final: nothing changed, so the
      // list never asked again. Try again shortly.
      loadFailedAt.current = Date.now();
      setLoadRetry((n) => n + 1);
    } finally {
      fetchingRef.current = false;
      setInitialLoading(false);
    }
  }, [page, feedParams]);

  // Ask by position too, not only from onEndReached: that fires once per
  // content size, so a failed or empty page left the viewer stuck at the end.
  useEffect(() => {
    if (endReachedRef.current || items.length === 0 || activeIndex < items.length - 4) return;
    const wait = loadFailedAt.current ? Math.max(0, 3000 - (Date.now() - loadFailedAt.current)) : 0;
    const timer = setTimeout(() => { loadMore(); }, wait);
    return () => clearTimeout(timer);
  }, [activeIndex, items.length, loadMore, page, loadRetry]);

  // The brainrot feed opens empty: start dealing at once rather than waiting
  // for the list to measure itself and ask. Any other viewer opened with
  // nothing does the same: an empty list never reaches its end, so it never
  // asked, and the viewer sat on its loading wheel.
  useEffect(() => {
    if (brainrotRef.current || initialItems.length === 0) loadMore();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);
  // Android Back closes the viewer. Left to the navigator, a press it could
  // not act on fell through to the system and closed the whole app (reported
  // on a locked clip opened from a profile).
  const handleHardwareBack = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate(ScreenNames.Root as never);
  }, [navigation]);
  useBackPress(handleHardwareBack);

  // The speed shown is the creator's own: swiping onto someone else picks up
  // theirs, and a tap here is remembered for them, the same as the full
  // player. Before, a tap only lasted until the viewer closed, so a creator
  // pinned at 2x elsewhere came back at 2x every time.
  useEffect(() => {
    if (activeMinter) setPlaybackRate(getPlaybackRateFor(activeMinter));
  }, [activeMinter]);

  const handleCycleSpeed = useCallback(() => {
    const idx = PLAYBACK_RATES.indexOf(playbackRate as any);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    setPlaybackRate(next);
    persistPlaybackRate(next, activeMinter || null);
  }, [playbackRate, activeMinter]);

  /** Bookmark lives in the options menu here, as it does on web. */
  const handleToggleSave = useCallback(() => {
    if (activeTokenId == null) return;
    requireAuth(() => {
      const key = engagementKeyOf(activeItem);
      const wasSaved = activeEngagement.isSaved;
      applyEngagement(key, { isSaved: !wasSaved });
      const rollback = () => {
        revertEngagement(key, { isSaved: wasSaved });
        toastError(t("feedCard.saveFailed"));
      };
      savePost(Number(activeTokenId), userAddress)
        .then((res) => {
          if (isFailedResponse(res)) {
            rollback();
            return;
          }
          toastSuccess(wasSaved ? t("copy.d92d932c8687", { defaultValue: "Removed from saved" }) : t("copy.b5c120b316c2", { defaultValue: "Saved" }));
        })
        .catch(rollback);
    });
  }, [activeItem, activeTokenId, activeEngagement.isSaved, userAddress, requireAuth, t]);

  const handleFollowChange = useCallback((following: boolean) => {
    if (!activeMinter) return;
    setFollowOverrides((prev) => ({ ...prev, [activeMinter.toLowerCase()]: following }));
  }, [activeMinter]);

  const handleVisibilityChange = useCallback((hidden: boolean) => {
    setHiddenOverrides((prev) => ({ ...prev, [String(activeTokenId)]: hidden }));
  }, [activeTokenId]);

  const handleEditSuccess = useCallback((data: { name?: string; description?: string; category?: string[] }) => {
    setItems((prev) => prev.map((it) => (
      (it.tokenId ?? it.id) === activeTokenId
        ? {
            ...it,
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.category !== undefined ? { category: data.category } : {}),
          }
        : it
    )));
  }, [activeTokenId]);

  const handleDeleteSuccess = useCallback(() => {
    setShowOptionsMenu(false);
    setItems((prev) => {
      const next = prev.filter((it) => (it.tokenId ?? it.id) !== activeTokenId);
      if (next.length === 0) navigation.goBack();
      return next;
    });
    setActiveIndex((i) => Math.max(0, i - 1));
  }, [activeTokenId, navigation]);

  // Blocking someone — from the options menu or from their profile — takes
  // every short of theirs out of the pager at once, the way a delete does.
  const blockedVersion = useBlockedAuthorsVersion();
  useEffect(() => {
    if (!blockedVersion) return;
    const prev = itemsRef.current;
    const next = prev.filter((it) => isLiveSlide(it) || !isAuthorBlocked(it.minterUser?.address || it.minter || it.owner));
    if (next.length === prev.length) return;
    setShowOptionsMenu(false);
    if (next.length === 0) { navigation.goBack(); return; }
    setItems(next);
    setActiveIndex((i) => Math.min(i, next.length - 1));
  }, [blockedVersion, navigation]);

  /**
   * The short a drag is heading for plays (silently) while it slides in, so
   * it is already moving when it lands instead of starting from a still once
   * the pager settles. The sound moves across as soon as the release is
   * carrying the pager on to it. All of it goes through each short's handle,
   * never through state: the pager's frames must not re-render the list.
   */
  const peekHandles = useRef(new Map<string, ShortPeek>()).current;
  const registerPeek = useCallback((key: string, handle: ShortPeek | null) => {
    if (handle) peekHandles.set(key, handle);
    else peekHandles.delete(key);
  }, [peekHandles]);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;
  const pagerPhase = useRef<"idle" | "drag" | "momentum">("idle");
  const peekRef = useRef<{ index: number; key: string; heard: boolean; lastDelta: number } | null>(null);
  const peekKeyAt = useCallback((index: number) => {
    const item = itemsRef.current[index];
    return item && !isLiveSlide(item) ? peekKeyOf(item) : null;
  }, []);
  const stopPeek = useCallback(() => {
    const peek = peekRef.current;
    peekRef.current = null;
    if (!peek) return;
    const active = activeIndexRef.current;
    peekHandles.get(peek.key)?.stop(peek.index > active);
    if (peek.heard) {
      const current = peekKeyAt(active);
      if (current) peekHandles.get(current)?.silence(false);
    }
  }, [peekHandles, peekKeyAt]);
  const updatePeek = useCallback((offset: number) => {
    const height = containerHeight;
    if (!(height > 0) || pagerPhase.current === "idle") return;
    const active = activeIndexRef.current;
    const delta = offset - active * height;
    const dir = delta > PEEK_START_PT ? 1 : delta < -PEEK_START_PT ? -1 : 0;
    if (!dir) { stopPeek(); return; }
    const index = active + dir;
    if (peekRef.current && peekRef.current.index !== index) stopPeek();
    const key = peekKeyAt(index);
    if (!key) return;
    if (!peekRef.current) peekRef.current = { index, key, heard: false, lastDelta: delta };
    const peek = peekRef.current;
    const handle = peekHandles.get(key);
    // Idempotent; tried again on each frame in case its source lands mid-drag.
    if (!peek.heard) handle?.start();
    if (pagerPhase.current === "momentum" && !peek.heard && Math.abs(delta) > Math.abs(peek.lastDelta)) {
      peek.heard = true;
      handle?.hear();
      const current = peekKeyAt(active);
      if (current) peekHandles.get(current)?.silence(true);
    }
    peek.lastDelta = delta;
  }, [containerHeight, peekHandles, peekKeyAt, stopPeek]);
  const commitPage = useCallback((index: number) => {
    pagerPhase.current = "idle";
    // Landing on the peeking short: it becomes active and simply keeps going.
    if (peekRef.current?.index === index) peekRef.current = null;
    else stopPeek();
    setActiveIndex(index);
  }, [stopPeek]);
  useEffect(() => stopPeek, [stopPeek]);

  const { begin: beginPaging, momentum: momentumPaging, endDrag: endPagingDrag, settle: settlePaging, candidate: pagerCandidate, observe: observePaging } = useSettledPagerIndex(commitPage, containerHeight, items.length);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      pagerCandidate(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 120 }).current;

  const listRef = useRef<FlatList>(null);
  /**
   * The pager, as something a gesture relation can actually name.
   *
   * A relation resolves through `.handlerTag`, which only gesture-handler's
   * own objects and its wrapped components carry — a bare FlatList ref
   * resolves to -1 and is dropped without a warning. Wrapping the list in a
   * Native gesture gives each short's swipe-down a real handler to block, so
   * the pager waits for that gesture to fail instead of racing it. Same shape
   * as useHorizontalScrollGuard in context/PagerGestureContext.tsx, from the
   * other side of the relation.
   */
  const resnapRef = useRef<() => void>(() => {});
  const pagerTouchedRef = useRef(false);
  const pagerGesture = useMemo(() => Gesture.Native()
    .runOnJS(true)
    .onBegin(() => { pagerTouchedRef.current = true; })
    // Also runs when another gesture (a hold, a swipe-back) takes the touch
    // over mid-swipe: exactly the case that leaves the pager between shorts.
    .onFinalize(() => { pagerTouchedRef.current = false; resnapRef.current(); }), []);

  const renderFooter = useCallback(() => {
    if (!noMoreShorts || items.length === 0) return null;
    return (
      <View
        style={{
          width: SCREEN_WIDTH,
          height: containerHeight * 0.4,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="Film" size={48} color="rgba(255,255,255,0.3)" />
        <Text className="text-white/50 text-sm mt-3 font-medium">
          {t("player.allCaughtUp")}
        </Text>
        <Text className="text-white/60 text-xs mt-1">
          {t("player.checkBackForShorts")}
        </Text>
      </View>
    );
  }, [noMoreShorts, items.length, containerHeight, t]);

  const renderEmpty = useCallback(() => {
    if (initialLoading) return null;
    return (
      <View
        style={{
          width: SCREEN_WIDTH,
          height: containerHeight,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="Film" size={48} color="rgba(255,255,255,0.3)" />
        <Text className="text-white/50 text-sm mt-3 font-medium">
          {t("player.allCaughtUp")}
        </Text>
        <Text className="text-white/60 text-xs mt-1">
          {t("player.checkBackForShorts")}
        </Text>
      </View>
    );
  }, [initialLoading, containerHeight, t]);

  const footerReturnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelFooterReturn = useCallback(() => {
    if (footerReturnTimer.current) clearTimeout(footerReturnTimer.current);
    footerReturnTimer.current = null;
  }, []);
  useEffect(() => cancelFooterReturn, [cancelFooterReturn]);

  const handleScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    cancelFooterReturn();
    settlePaging(e.nativeEvent.contentOffset.y);
    if (!noMoreShorts || !listRef.current || items.length === 0) return;
    // Only snap back if user scrolled past the last real item (into footer)
    const offsetY = e.nativeEvent.contentOffset.y;
    const lastItemEnd = items.length * containerHeight;
    if (offsetY < lastItemEnd) return;

    const lastIndex = items.length - 1;
    footerReturnTimer.current = setTimeout(() => {
      footerReturnTimer.current = null;
      listRef.current?.scrollToOffset({
        offset: lastIndex * containerHeight,
        animated: true,
      });
    }, 1500);
  }, [noMoreShorts, items.length, containerHeight, t, settlePaging, cancelFooterReturn]);

  /**
   * Put the pager back on a whole short once it has come to rest between two.
   *
   * Android only snaps a paging list on a clean finger-up. A swipe that
   * another gesture took over (holding for 2x, the swipe-back, the dismiss
   * drag), or that froze when the hold turned scrolling off, gets a cancel
   * instead, and the list stays wherever the finger was: half of one short,
   * half of the next, with no momentum or end event to commit either.
   */
  const pagerOffsetRef = useRef(0);
  const resnapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentsVisibleRef = useRef(commentsVisible);
  commentsVisibleRef.current = commentsVisible;
  const resnapPager = useCallback(() => {
    if (resnapTimer.current) clearTimeout(resnapTimer.current);
    resnapTimer.current = setTimeout(() => {
      resnapTimer.current = null;
      if (pagerTouchedRef.current || commentsVisibleRef.current) return;
      const height = containerHeight;
      const count = items.length;
      if (!(height > 0) || count === 0) return;
      const offset = pagerOffsetRef.current;
      // Past the last short is the footer, which handleScrollEnd returns from.
      if (offset > (count - 1) * height + 1) return;
      const index = Math.max(0, Math.min(count - 1, Math.round(offset / height)));
      if (Math.abs(offset - index * height) <= 1) return;
      listRef.current?.scrollToOffset({ offset: index * height, animated: true });
      settlePaging(index * height);
    }, PAGER_RESNAP_QUIET_MS);
  }, [containerHeight, items.length, settlePaging]);
  resnapRef.current = resnapPager;

  // A short ended with loop off: page on to the next one, as a swipe would.
  // Not while comments or the options menu are open over it.
  const showOptionsMenuRef = useRef(showOptionsMenu);
  showOptionsMenuRef.current = showOptionsMenu;
  const handlePlayToEnd = useCallback((endedId: string) => {
    const active = itemsRef.current[activeIndexRef.current];
    if (!active || String(active.tokenId ?? active.id) !== endedId) return;
    if (commentsVisibleRef.current || showOptionsMenuRef.current || pagerTouchedRef.current || getIsLooping()) return;
    const next = activeIndexRef.current + 1;
    const height = containerHeight;
    if (!(height > 0) || next >= itemsRef.current.length) return;
    listRef.current?.scrollToOffset({ offset: next * height, animated: true });
    settlePaging(next * height);
  }, [containerHeight, settlePaging]);
  useEffect(() => () => { if (resnapTimer.current) clearTimeout(resnapTimer.current); }, []);
  // A hold or the comments sheet turned scrolling off; the pager may be mid-way.
  useEffect(() => {
    if (!holdActive && !commentsVisible) resnapPager();
  }, [holdActive, commentsVisible, resnapPager]);

  const activeVideoRef = useRef<VideoView>(null);

  // Warned clips wait behind their warning until the person opens it; one
  // already opened on a card plays straight away.
  const [revealedWarnings, setRevealedWarnings] = useState<ReadonlySet<string>>(() => new Set());
  const revealWarning = useCallback((id: string) => {
    markContentWarningSeen(id);
    setRevealedWarnings((prev) => new Set(prev).add(id));
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: UnifiedFeedItem; index: number }) => {
      if (isLiveSlide(item)) return <LiveShortSlide slide={item} isActive={index === activeIndex} height={containerHeight} />;
      if (item.contentRating === "mature") {
        const postId = item.tokenId ?? item.id;
        return (
          <View className="dark-surface" style={[styles.matureSlide, { height: containerHeight }]}>
            <MatureContentGate
              actionLabel={t("reel.openPost")}
              canReveal={MATURE_CONTENT_ENABLED && !kidsMode && postId != null}
              onReveal={() => navigation.navigate(ScreenNames.FeedDetail, { postId: String(postId) })}
            />
          </View>
        );
      }
      const warning = String((item as any).spoilerText ?? "").trim();
      const id = String(item.tokenId ?? item.id ?? "");
      if (warning && !revealedWarnings.has(id) && !isContentWarningSeen(id)) {
        const still = (item as any).postType === "short" ? getShortsThumbnailUrl(item.tokenId) : resolveThumbnail(item);
        return (
          <WarningShortSlide
            text={warning}
            thumbnail={still && still !== DEFAULT_BANNER_SENTINEL ? still : undefined}
            height={containerHeight}
            onReveal={() => revealWarning(id)}
          />
        );
      }
      return (
      <ShortItem
        item={item}
        registerPeek={registerPeek}
        thumbnailOverride={index === initialIndex ? initialThumbnail : undefined}
        isActive={index === activeIndex}
        isNearby={Math.abs(index - activeIndex) <= 1}
        activeVideoRef={activeVideoRef}
        itemHeight={containerHeight}
        viewportHeight={viewportHeight}
        miniReveal={miniReveal}
        backDrag={backDrag}
        backLeaving={backLeaving}
        onSwipeBackSettled={onSwipeBackSettled}
        dismissY={dismissY}
        isFirst={index === 0}
        onHoldActiveChange={setHoldActive}
        captureViewerState={captureViewerState}
        isMuted={isMuted}
        volume={volume}
        playbackRate={playbackRate}
        pagerGesture={pagerGesture}
        onChromeVisibilityChange={setChromeVisible}
        onChromeLiveChange={setChromeLive}
        chromeRevealTick={index === activeIndex ? chromeRevealTick : 0}
        fullscreenTick={fullscreenTick}
        onWideChange={handleWideChange}
        onCommentsVisibilityChange={setCommentsVisible}
        optionsMenuOpen={index === activeIndex && showOptionsMenu}
        reelBgId={feedParams.reelBgId}
        onPlayToEnd={index === activeIndex ? handlePlayToEnd : undefined}
      />
      );
    },
    [kidsMode, navigation, t, activeIndex, showOptionsMenu, containerHeight, viewportHeight, miniReveal, backDrag, backLeaving, onSwipeBackSettled, dismissY, captureViewerState, isMuted, volume, playbackRate, pagerGesture, setChromeVisible, chromeRevealTick, fullscreenTick, handleWideChange, initialIndex, initialThumbnail, feedParams.reelBgId, revealedWarnings, revealWarning, registerPeek, handlePlayToEnd],
  );

  const keyExtractor = useCallback(
    (item: UnifiedFeedItem, index: number) => String(item.tokenId ?? item.id ?? index),
    [],
  );

  const getItemLayout = useCallback((_: any, index: number) => ({
    length: containerHeight,
    offset: containerHeight * index,
    index,
  }), [containerHeight]);

  return (
    <View style={styles.container}>
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }, backScrimStyle]} />
      <Reanimated.View style={[styles.container, backPageStyle]} onLayout={handleContainerLayout}>
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000000' }, viewerBackdrop]} />
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Keep the tapped picture visible while native layout establishes the
          pager's exact viewport. Its geometry still waits for measurement. */}
      {!hasMeasuredViewport && initialThumbnail && initialItems[initialIndex] && initialItems[initialIndex].contentRating !== "mature" ? <Image
        source={{ uri: initialThumbnail }} style={StyleSheet.absoluteFill}
        contentFit="contain" transition={0} pointerEvents="none"
      /> : null}

      {/* The Native gesture is what makes the pager nameable in a relation —
          see pagerGesture. It wraps the list without changing how it scrolls. */}
      {hasMeasuredViewport && <GestureDetector gesture={pagerGesture}>
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          pagingEnabled
          scrollEnabled={!commentsVisible && !holdActive}
          horizontal={false}
          showsVerticalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          onMomentumScrollEnd={handleScrollEnd}
          onScrollBeginDrag={() => { cancelFooterReturn(); pagerPhase.current = "drag"; beginPaging(); }}
          onMomentumScrollBegin={() => { pagerPhase.current = "momentum"; momentumPaging(); }}
          onScrollEndDrag={(e) => endPagingDrag(e.nativeEvent.contentOffset.y)}
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            pagerOffsetRef.current = y;
            observePaging(y);
            updatePeek(y);
            if (!pagerTouchedRef.current) resnapPager();
          }}
          scrollEventThrottle={32}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          removeClippedSubviews={false}
          windowSize={3}
          maxToRenderPerBatch={2}
          initialNumToRender={3}
          getItemLayout={getItemLayout}
        />
      </GestureDetector>}

      {/* Fixed header overlay – back left, playback chrome right (as on web).
          box-none so only the buttons themselves take touches; the rest of the
          strip stays with the video underneath. Every button is the same 40pt
          square in the black/50 fill of the picture-in-picture button; the speed
          pill only differs in width, and keeps the height so the group reads as
          one row.

          It fades on the same 250ms curve as the bottom stack rather than
          unmounting, so clearing the chrome is one movement across the whole
          frame instead of a pop at the top and a fade at the bottom. */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: topChromeOpacity }]}
        pointerEvents={chromeLive ? "box-none" : "none"}
        onTouchStart={chromeVisible ? undefined : revealChrome}
      >
        {/* Mirror of the bottom scrim — the top buttons had nothing behind
            them, so they washed out over a bright first frame. Its height is
            a constant now for the same reason the bar's padding is: the
            device inset was already spent by the root SafeAreaView. */}
        <LinearGradient
          colors={["rgba(0,0,0,0.55)", "transparent"]}
          style={styles.topGradient}
          pointerEvents="none"
        />

        <View className="dark-surface" style={[styles.topBar, { paddingTop: mediaInsets.top + EDGE }]} pointerEvents="box-none">
          <ChromeTouchTarget>
            <Pressable className="dark-surface" onPress={handleBack} hitSlop={CHROME_HIT_SLOP} style={styles.topButton} accessibilityLabel={t("profile.back")}>
              <ChromeFill top />
              {/* The cut Back arrow at the 20pt every other glyph on this row
                  uses, starting with picture-in-picture. */}
              <Icon name="ArrowLeft" size={20} color="#fff" />
            </Pressable>
          </ChromeTouchTarget>

        </View>

        {/* The player's buttons, on the bottom row under the scrubber. */}
        {!isLiveSlide(activeItem) && activeItem?.contentRating !== "mature" && <View className="dark-surface" style={styles.toolsBar} pointerEvents="box-none">
          {/* These two stay on every post so the row never reshuffles
              between slides; where one cannot work it says so. */}
          <ChromeTouchTarget><PictureInPictureButton videoRef={activeVideoRef} size={CHROME_SIZE} unavailable={items[activeIndex]?.postType === "feed-images"} /></ChromeTouchTarget>
          <ChromeTouchTarget>
            <Pressable
              onPress={handleCycleSpeed}
              className="dark-surface"
              hitSlop={CHROME_HIT_SLOP}
              style={[styles.topButton, styles.speedButton]}
              accessibilityLabel={t("player.playbackSpeed")}
            >
              <ChromeFill top />
              <Text style={styles.speedButtonText}>{formatRate(playbackRate)}</Text>
            </Pressable>
          </ChromeTouchTarget>
          <ChromeTouchTarget>
            <Pressable
              onPress={() => { if (activeWide) setFullscreenTick((n) => n + 1); else toastInfo(t("player.notAvailableForPost")); }}
              className="dark-surface"
              hitSlop={CHROME_HIT_SLOP}
              style={styles.topButton}
              accessibilityLabel={t("player.enterFullscreen")}
            >
              <ChromeFill top />
              <Icon name="Maximize2" size={20} color="#fff" />
            </Pressable>
          </ChromeTouchTarget>

          <View>
            <ChromeTouchTarget>
              <View
                style={styles.topButton}
                hitSlop={CHROME_HIT_SLOP}
                accessibilityLabel={isMuted ? _copy("copy.ce4ee4efc5e3", { defaultValue: "Unmute" }) : _copy("copy.8dd6857baf02", { defaultValue: "Mute" })}
                {...volumePanResponder.panHandlers}
              >
                <ChromeFill top />
                <Icon name={isMuted ? "VolumeX" : "Volume2"} size={20} color="#fff" />
              </View>
            </ChromeTouchTarget>
            {volumeAdjusting && (
              <View style={styles.volumeTrack} pointerEvents="none">
                <ChromeFill top />
                <View style={styles.volumeTrackInner}>
                  <View
                    style={[
                      styles.volumeFill,
                      { height: `${Math.round((isMuted ? 0 : volume) * 100)}%` },
                    ]}
                  />
                </View>
              </View>
            )}
          </View>

          {/* The owner's Boost bolt, beside options as on the feed card. */}
          {canBoostActive && isOwnerOfActive && (
            <ChromeTouchTarget>
              <Pressable
                onPress={() => setShowBoost(true)}
                className="dark-surface"
                style={styles.topButton}
                hitSlop={CHROME_HIT_SLOP}
                accessibilityLabel={t("feedCard.boostPost")}
                testID="viewer-boost"
              >
                <ChromeFill top />
                <Icon name="Zap" size={20} color="#fff" />
              </Pressable>
            </ChromeTouchTarget>
          )}
          <ChromeTouchTarget>
            <Pressable
              onPress={() => setShowOptionsMenu(true)}
              className="dark-surface"
              style={styles.topButton}
              hitSlop={CHROME_HIT_SLOP}
              accessibilityLabel={t("player.moreOptions")}
            >
              <ChromeFill top />
              <Icon name="Ellipsis" size={20} color="#fff" />
            </Pressable>
          </ChromeTouchTarget>
        </View>}
      </Animated.View>

      {/* Initial-load spinner — the first page is still in flight. */}
      {initialLoading && items.length === 0 && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { alignItems: "center", justifyContent: "center" },
          ]}
          pointerEvents="none"
        >
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}

      {/* Options menu — bookmark, follow, report, block and the owner actions,
          matching the web viewer's options drawer. */}
      {showOptionsMenu && !!activeItem && !isLiveSlide(activeItem) && activeItem.contentRating !== "mature" && (
        <PostOptionsMenu
          visible={showOptionsMenu}
          onClose={() => setShowOptionsMenu(false)}
          tokenId={activeTokenId}
          isOwner={isOwnerOfActive}
          post={activeItem}
          canReplaceVideo={isOwnerOfActive}
          isHidden={activeIsHidden}
          player={!activeItem.imageUrls?.length && activeItem.postType !== "feed-images" ? {
            looping: isLoopingNow,
            onToggleLoop: () => persistLooping(!getIsLooping()),
            speedLabel: formatRate(playbackRate),
            onCycleSpeed: handleCycleSpeed,
            muted: isMuted,
            onToggleMute: () => setMutedState(!getCachedMuted()),
            onPictureInPicture: () => { activeVideoRef.current?.startPictureInPicture().catch(() => {}); },
            onFullscreen: activeWide ? () => setFullscreenTick((n) => n + 1) : undefined,
          } : undefined}
          creatorDisplayName={activeDisplayName}
          creatorIdentifier={activeMinter || activeUsername || ""}
          isFollowing={activeIsFollowing}
          currentTitle={activeItem.name || activeItem.title || ""}
          currentDescription={activeItem.description || ""}
          currentCategories={activeItem.category || []}
          currentShopLinks={(activeItem as any).shopLinks}
          isSaved={activeEngagement.isSaved}
          canCast={!activeItem.imageUrls?.length && activeItem.postType !== "live" &&
            (isOwnerOfActive || activeItem.isUnlocked || (!activeItem.streamInfo?.isPayPerView && !isHoldGated(activeItem.streamInfo?.isLockContent, activeItem.streamInfo?.lockContentAmount)))}
          onDownloadImage={activeItem.postType === "feed-images" && !activeItem.spoilerText && !(activeItem as any).is_w2e && !reelStillOf(activeItem) && isShortsPhoto(activeItem, true)
            ? () => {
                const media = shortsPhotoMedia(activeItem, true);
                if (media) void downloadGalleryImage(media.imageUrls, String(activeTokenId));
              }
            : undefined}
          copyMedia={activeItem.postType === "feed-images" && !activeItem.spoilerText && !(activeItem as any).is_w2e && !reelStillOf(activeItem) && isShortsPhoto(activeItem, true)
            ? { kind: "image", url: () => {
                const urls = shortsPhotoMedia(activeItem, true)?.imageUrls ?? [];
                const url = urls[Math.min(galleryIndex(String(activeTokenId)), urls.length - 1)];
                return url ? cdnImageSource(url) : null;
              } }
            : activeItem.postType === "short" && !activeItem.imageUrls?.length && !videoNeedsAccess(activeItem) && !activeIsHidden &&
              !(activeItem as any).spoilerText && !(activeItem as { contentRating?: string }).contentRating?.includes("mature")
              ? { kind: "video", url: () => getVideoUrl(activeTokenId) }
              : undefined}
          onDownloadVideo={activeItem.postType === "short" && !activeItem.imageUrls?.length &&
            (isOwnerOfActive || activeItem.isUnlocked || (!activeItem.streamInfo?.isPayPerView && !isHoldGated(activeItem.streamInfo?.isLockContent, activeItem.streamInfo?.lockContentAmount))) &&
            !(activeItem as { contentRating?: string }).contentRating?.includes("mature")
            ? () => { void (async () => {
                // A gated short's file is private; download it through a signed URL.
                const url = !videoNeedsAccess(activeItem) ? getVideoUrl(activeTokenId)
                  : activeTokenId != null ? (await fetchVideoAccess(activeTokenId).catch(() => null))?.url : undefined;
                if (url) void downloadVideo({ url, title: activeItem.name || activeItem.title || "video", username: activeUsername });
              })(); }
            : undefined}
          onToggleSave={handleToggleSave}
          onBoostPress={canBoostActive && isOwnerOfActive ? () => setShowBoost(true) : undefined}
          onGiftBoostPress={canBoostActive && !isOwnerOfActive && canGiftBoost ? () => setShowBoost(true) : undefined}
          onRemix={activeItem.postType === "short" && !activeItem.imageUrls?.length && !videoNeedsAccess(activeItem) && !activeIsHidden && activeTokenId != null &&
            (!(activeItem as any).visibility || (activeItem as any).visibility === "public") && !(activeItem as any).spoilerText &&
            !(activeItem as { contentRating?: string }).contentRating?.includes("mature") && (!(activeItem as any).quotePolicy || (activeItem as any).quotePolicy === "public" || isOwnerOfActive)
            ? mode => requireAuth(() => {
                const videoUrl = getVideoUrl(activeTokenId);
                if (videoUrl) navigation.navigate(ScreenNames.VideoRemix, { mode, tokenId: activeTokenId, videoUrl,
                  sourceUrl: (activeItem as any).status === "signed" && (activeItem as any).newPostId != null ? `https://riftn.com/newpost/${(activeItem as any).newPostId}` : `https://riftn.com/app/post/${activeTokenId}`,
                  title: activeItem.name || activeItem.title || "Remix", creator: activeUsername || activeDisplayName });
              })
            : undefined}
          onFollowChange={handleFollowChange}
          onVisibilityChange={handleVisibilityChange}
          onEditSuccess={handleEditSuccess}
          onDeleteSuccess={handleDeleteSuccess}
        />
      )}

      {showBoost && activeTokenId != null && (
        <BoostSheet
          visible={showBoost}
          onClose={() => setShowBoost(false)}
          tokenId={activeTokenId}
          postTitle={activeItem?.name || activeItem?.title || undefined}
          isOwnPost={isOwnerOfActive}
        />
      )}
      </Reanimated.View>
    </View>
  );
};

export default ShortsViewerScreen;

const styles = StyleSheet.create({
  playerFrame: { position: "absolute", top: 0, left: 0, right: 0 },
  matureSlide: { width: "100%", backgroundColor: "#000", justifyContent: "center", paddingHorizontal: 20 },
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  topGradient: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 96,
    zIndex: 15,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // Web's `top-4 left-4 right-4`, flat — see the EDGE comment for why no
    // inset is added on top of it.
    paddingTop: EDGE,
    paddingHorizontal: EDGE,
    paddingBottom: 10,
    zIndex: 20,
  },
  topButton: {
    width: CHROME_SIZE,
    height: CHROME_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  volumeTrack: {
    position: "absolute",
    // Rises from the button now that it sits on the bottom row.
    bottom: CHROME_SIZE + 4,
    left: 0,
    width: CHROME_SIZE,
    height: 120,
    borderRadius: CHROME_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  volumeTrackInner: {
    width: 4,
    height: 96,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  volumeFill: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 2,
  },
  // Web's `h-10 min-w-[40px] px-1.5`: it grows past the square only when the
  // rate needs the room ("1.25x"), and keeps the height so the group's
  // baseline and cap line stay flush.
  speedButton: {
    width: undefined,
    minWidth: CHROME_SIZE,
    paddingHorizontal: 6,
  },
  // Web's `text-[11px] font-bold`.
  speedButtonText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  captionDim: {
    backgroundColor: "rgba(0,0,0,0.7)",
    // Over the gradient, under the caption stack it is there to make legible.
    zIndex: 6,
  },
  bottomGradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    // Shorter than it was: the action bar carries its own contrast now, so the
    // scrim only has to cover the caption instead of washing out half the video.
    height: "34%",
    zIndex: 5,
  },
  scrubTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    // Its own row, above the player's buttons and clear of the home gesture.
    bottom: EDGE + TOOLS_HEIGHT,
    zIndex: 11,
  },
  scrubPreviewLayer: {
    position: "absolute",
    left: EDGE,
    right: EDGE,
    top: 0,
    bottom: 0,
  },
  scrubHitArea: {
    height: SCRUB_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: EDGE,
  },
  scrubLine: {
    height: 6,
    overflow: "hidden",
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
    justifyContent: "center",
  },
  scrubLineActive: {
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  scrubFill: {
    width: "100%",
    height: "100%",
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  scrubFillActive: {
    backgroundColor: "#fff",
  },
  // A zero-width post that rides the line; the dot and the lens centre on it.
  scrubThumbSlot: {
    position: "absolute",
    left: EDGE,
    top: 0,
    width: 0,
    height: SCRUB_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  scrubThumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  scrubLens: {
    width: 62,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.6)",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  scrubLensLine: {
    width: 50,
    height: 15,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  scrubLensPlayed: {
    width: "50%",
    height: "100%",
    backgroundColor: "#fff",
  },
  toolsBar: {
    position: "absolute",
    left: EDGE,
    right: EDGE,
    bottom: EDGE,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 20,
  },
  bottomStack: {
    position: "absolute",
    left: EDGE,
    right: EDGE,
    // Web closes the frame with `pb-[max(1rem,env(safe-area-inset-bottom))]`.
    // Inside the root SafeAreaView that resolves to a flat 16 — the old
    // `insets.bottom + 10` was the notch charged twice. The scrubber row and
    // the player's buttons sit under it.
    bottom: EDGE + TOOLS_HEIGHT + SCRUB_HEIGHT,
    zIndex: 10,
  },
  captionBlock: {
    // Web's `mb-3`, both between the creator row and the caption and between
    // the caption and the action row. It is a gap rather than a margin on
    // creatorRow because the caption is conditional, and Yoga does not
    // collapse a trailing margin — a short with neither title nor description
    // ended up with 24pt of air above the action row instead of 12.
    gap: 12,
    marginBottom: 12,
  },
  // Web's `gap-2`.
  // Hugs the avatar and name, so the empty space beside a short name is not a
  // profile tap (same rule as feed card headers).
  creatorRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 8,
  },
  creatorText: {
    flexShrink: 1,
  },
  creatorNameRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  creatorNameText: {
    flexShrink: 1,
  },
  // Web: `text-base font-semibold` over `text-sm text-white/70`, both with
  // `leading-tight` and a drop shadow.
  creatorName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
    ...TEXT_SHADOW,
  },
  creatorHandle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    lineHeight: 18,
    ...TEXT_SHADOW,
  },
  // Web's caption is `text-sm leading-relaxed`; the title carries the same
  // size at a heavier weight so it reads as the headline of the two.
  captionTitle: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    marginBottom: 2,
    ...TEXT_SHADOW,
  },
  captionBody: {
    color: "#fff",
    fontSize: 14,
    lineHeight: 20,
    ...TEXT_SHADOW,
  },
  captionMore: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 4,
    ...TEXT_SHADOW,
  },
  // captionBlock's 12pt gap is the spacing between the creator row, the caption
  // and the action row — far too much air for a control that belongs to the
  // line above it. Pulled back to sit just under the caption.
  captionTranslate: {
    marginTop: -8,
  },
  // No wrapper and no fixed height any more: without a slab to fill, the row
  // is exactly as tall as its tallest cell.
  actionBar: {
    backgroundColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
  },
  /**
   * Equal share of the row — this is what puts the icons on a fixed grid.
   *
   * `minHeight`, not vertical padding: the slab used to give every cell a
   * fixed 46pt through `alignItems: "stretch"` inside it, and taking the slab
   * away took the height with it. Padding around a 20pt icon would leave the
   * buttons at 32pt, under both the 44pt iOS minimum and Android's 48dp, on
   * the one surface a viewer actually thumbs. 44 also lands the row within
   * 2pt of the old height, so nothing above it moves.
   */
  actionCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 44,
  },
  /** The outer cells align to the caption's edges, as web's `justify-between`
   *  does, while the middle four stay centred in their share. */
  actionCellFirst: {
    justifyContent: "flex-start",
  },
  actionCellLast: {
    justifyContent: "flex-end",
  },
  /**
   * Content-sized variant, so the reaction tray anchors to the thumb. Carries
   * the same 44pt floor as the cell rather than padding on top of it — the
   * two nest, and padding on both made the outer box 44 while leaving the
   * Pressable inside it at 32.
   *
   * `minWidth` as well, which the flex cells get from their equal share and
   * this one does not: it is the only button sized by its content, so on a
   * short with no likes yet it was a 20pt icon plus a "0" — about 31pt wide,
   * on the most-tapped control on the screen.
   */
  actionInline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minHeight: 44,
    minWidth: 44,
  },
  // Wider than the 20pt slot and centred without lineHeight, so Android
  // draws the whole emoji instead of cutting its edge and bottom.
  actionGlyph: {
    fontSize: 17,
    height: 22,
    width: 26,
    marginHorizontal: -3,
    textAlign: "center",
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  // Web's `text-xs font-medium text-white/70 drop-shadow-lg`.
  actionCount: {
    color: COUNT_COLOR,
    fontSize: 12,
    fontWeight: "500",
    ...TEXT_SHADOW,
  },
  // Web's `w-12 h-12 rounded-xl`. Avatar derives its own radius from the size
  // (16% → 8), so the 12 web draws is set here.
  avatar: {
    borderRadius: 12,
  },
  pauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  seekFlash: {
    position: "absolute",
    zIndex: 50,
  },
  seekFlashText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
});

/** Over a locked clip the viewer cannot play: what unlocks it, and a way in. */
function ReelLockCard({ subscribers, line, onPress }: { subscribers: boolean; line?: string; onPress: () => void }) {
  const { t } = useCopy();
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={{ alignItems: "center", paddingHorizontal: 22, paddingVertical: 18, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.65)", maxWidth: 280 }}
      >
        <Icon name={subscribers ? "Star" : "Lock"} size={26} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 8, textAlign: "center" }}>
          {subscribers ? t("feedCard.subscribersOnly") : t("superpowers.locked")}
        </Text>
        {!!line && <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 4, textAlign: "center" }}>{line}</Text>}
        <View style={{ marginTop: 12, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999, backgroundColor: "#fff" }}>
          <Text style={{ color: "#000", fontSize: 14, fontWeight: "700" }}>
            {subscribers ? t("subscriptions.subscribe") : t("walletSetup.unlock")}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
