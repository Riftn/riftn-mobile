import { usePerfProbe } from "../../libs/perfTrace";
import { outsideImage } from "../../libs/outside-image";
import { ReactionChips } from "./MessageReactions";
import { useReactionHost } from "../ChatReactions/ReactionArrival";
import CallNoteCard from "./CallNoteCard";
import { formatMessageTime } from "../../libs/date.util";
import { useTranslation as _useCopy } from 'react-i18next';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
  Linking,
} from "react-native";
import type { ImageLoadEventData } from "expo-image";
import SwipeReplyArrows from "../Chat/SwipeReplyArrows";
import SmartImage from "../common/SmartImage";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  withSequence,
  withDelay,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import Avatar from "../common/Avatar";
import Icon from "../ui/Icon";
import { toastError } from "../../libs/toast";
import { formatAttachmentSize, getAttachmentLabel } from "../../libs/attachments";
import VoiceNotePlayer from "../Comments/VoiceNotePlayer";
import PaymentBadge from "./PaymentBadge";
import { getAvatarUrl, buildCdnPath } from "../../libs/misc";
import type { DmMessage, DmMsgType, DmMediaUrl, ReplyPreview, OptimisticMessage } from "../../services/dm/dm.types";
import { getSenderUser } from "../../services/dm/dm.types";
import type { MessageLayout } from "./MessageContextMenu";
import DehubLinkCard from "../common/DehubLinkCard";
import LinkedText from "../common/LinkedText";
import { useChatTextScale } from "../../hooks/useAppPrefs";
import MomentReplyPreview from "./MomentReplyPreview";
import { parseMomentReply, parseSharedMoment } from "../../libs/moment-reply";
import LinkPreviewCard from "../common/LinkPreviewCard";
import { findDehubLink, stripDehubLinkMatches } from "../../libs/dehub-links";
import {
  AssetRefCards,
  bubbleAssetCardWidth,
  MAX_ASSET_CARDS_PER_MESSAGE,
} from "../common/AssetRefCard";
import { findAssetRefs, stripAssetRefs } from "../../libs/asset-refs";
import { haptic } from "../../libs/haptics";
import { TipGemIcon } from "../Home/TipGemIcon";
import DmOpenTimerMedia from "./DmOpenTimerMedia";
import EncryptedMedia from "./EncryptedMedia";
import LockedMedia from "./LockedMedia";
import DmVideoTile, { useVideoPoster } from "./DmVideoTile";
import type { DmVideoOptions } from "../../libs/dm-video-options";
import type { DmDestruct } from "../../libs/dm-destruct";
import DmTimeLeft from "./DmTimeLeft";
import { encryptedMediaLabel } from "../../libs/dm-e2ee/media-label";
import { dmSendQueue } from "../../services/dm/dm.send";
import { useDmTranslation, toggleDmTranslation, autoTranslateDm, shouldAutoTranslateDm, primeDmPair } from "../../libs/dm-translation-store";
import { languageName } from "../../libs/dm-translate-out";
import { useMetaGrey } from "../../theme/metaGrey";
import { autoTranslateEnabled, subscribeAutoTranslate } from "../../libs/auto-translate-setting";
import { queueAutoTranslate } from "../../libs/auto-translate-queue";
import { getUserLanguage } from "../../services/translation.service";
import TranslateButton from "../ui/TranslateButton";
import { isAssistantAddress } from "../../libs/assistant";
import { assistantActionIds, withoutAssistantActionLinks } from "../../libs/assistantActionLinks";
import AssistantActionCard from "../Assistant/AssistantActionCard";

/**
 * A line of yours that did not go out: it stays where it was sent, with
 * Retry (resends the same message in place, reusing any fee already paid)
 * and a cross to drop it.
 */
function SendFailedRow({ message }: { message: OptimisticMessage }) {
  const { t } = useTranslation();
  const tempId = message._tempId;
  const canRetry = !!tempId && dmSendQueue.canRetry(tempId);
  return (
    <View className="flex-row items-center gap-2">
      <Text className="text-[11px] text-red-500">{t("dm.notSent", { defaultValue: "Not sent" })}</Text>
      {canRetry && (
        <Pressable
          onPress={() => { haptic.tap(); dmSendQueue.retry(tempId); }}
          hitSlop={8}
          accessibilityRole="button"
          className="flex-row items-center gap-0.5"
        >
          <Icon name="RotateCw" size={11} color="#EF4444" />
          <Text className="text-[11px] font-semibold text-red-500">{t("dm.retrySend", { defaultValue: "Retry" })}</Text>
        </Pressable>
      )}
      {!!tempId && (
        <Pressable
          onPress={() => dmSendQueue.discard(String(message.conversation), tempId)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("dm.discardSend", { defaultValue: "Remove" })}
        >
          <Icon name="X" size={11} color="rgba(255,255,255,0.5)" />
        </Pressable>
      )}
    </View>
  );
}


const resolveUrl = (path: string): string => {
  if (
    path.startsWith("file://") ||
    path.startsWith("/") ||
    path.startsWith("http://") ||
    path.startsWith("https://")
  ) {
    return path;
  }
  return buildCdnPath(path) ?? path;
};

const isImageMime = (mime?: string): boolean =>
  !!mime && (mime.startsWith("image/") || /jpe?g|png|webp|heic|gif/i.test(mime));

const isVideoMime = (mime?: string): boolean =>
  !!mime && (mime.startsWith("video/") || /mp4|mov|quicktime|webm/i.test(mime));


/** Max bubble is ~75% screen. Allow image to fill that minus padding. */
const maxImageWidth = (windowWidth: number) => Math.round(windowWidth * 0.75 - 24);
const MIN_IMAGE_WIDTH = 160;
const MAX_IMAGE_HEIGHT = 320;
const DEFAULT_ASPECT = 4 / 3;

interface AutoImageProps {
  uri: string;
  isGif?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}

/**
 * Renders an image that sizes itself to its natural aspect ratio,
 * constrained within maxImageWidth × MAX_IMAGE_HEIGHT.
 * Shows skeleton while loading, fallback icon on error.
 */
const AutoImage: React.FC<AutoImageProps> = memo(({ uri, isGif, onPress, onLongPress }) => {
  const { t } = useTranslation();
  const { width: windowWidth } = useWindowDimensions();
  const [aspect, setAspect] = useState<number>(DEFAULT_ASPECT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
  }, [uri]);

  // The aspect comes off the image's own load event. Image.getSize fetched
  // the file a second time through a different pipeline and decoded it at full
  // resolution just to read two numbers.
  const handleLoad = useCallback((e: ImageLoadEventData) => {
    const { width: w, height: h } = e.source;
    if (w > 0 && h > 0) setAspect(w / h);
    setLoading(false);
  }, []);

  // Calculate display dimensions
  let displayW = maxImageWidth(windowWidth);
  let displayH = displayW / aspect;
  if (displayH > MAX_IMAGE_HEIGHT) {
    displayH = MAX_IMAGE_HEIGHT;
    displayW = displayH * aspect;
  }
  displayW = Math.max(Math.round(displayW), MIN_IMAGE_WIDTH);
  displayH = Math.round(displayH);

  if (error) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
      >
        <View
          className="bg-theme-neutrals-700 items-center justify-center"
          style={{ width: displayW, height: displayH }}
        >
          <Icon name="Image" size={32} color="#555" />
          <Text className="text-theme-neutrals-500 text-[11px] mt-1">
            {t("dm.failedToLoad")}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
      <View style={{ width: displayW, height: displayH }}>
        {loading && (
          <View
            className="absolute inset-0 bg-theme-neutrals-700 items-center justify-center"
            style={{ width: displayW, height: displayH }}
          >
            <ActivityIndicator size="small" color="#555" />
          </View>
        )}
        {/* expo-image takes no className, so the backdrop lives on a wrapper. */}
        <View className="bg-theme-neutrals-700" style={{ width: displayW, height: displayH }}>
          <SmartImage
            source={{ uri }}
            recyclingKey={uri}
            style={{ width: displayW, height: displayH }}
            contentFit="cover"
            onLoad={handleLoad}
            onError={() => { setLoading(false); setError(true); }}
          />
        </View>
        {isGif && (
          <View className="absolute bottom-1.5 left-1.5 dark-surface bg-black/60 rounded px-1.5 py-0.5">
            <Text className="text-[11px] text-white font-bold">GIF</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});


/** What the full-screen player needs beyond the file: how to play it, and whether watching it removes it. */
export interface DmVideoPlayExtra {
  options?: DmVideoOptions | null;
  messageId?: string;
  viewOnce?: boolean;
}

/** A plain DM video: the sender's cover frame at the real shape. */
const PlainDmVideo: React.FC<{
  uri: string;
  messageId: string;
  options?: DmVideoOptions | null;
  destruct?: DmDestruct | null;
  mine: boolean;
  maxW: number;
  maxH: number;
  onPress: () => void;
  onLongPress?: () => void;
}> = memo(({ uri, messageId, options, destruct, mine, maxW, maxH, onPress, onLongPress }) => {
  const { poster, failed } = useVideoPoster(uri, options);
  return (
    <DmVideoTile
      posterUri={poster?.uri}
      width={poster?.w}
      height={poster?.h}
      options={options}
      destruct={destruct}
      mine={mine}
      messageId={messageId}
      maxW={maxW}
      maxH={maxH}
      failed={failed}
      onOpen={onPress}
      onLongPress={onLongPress}
      // A view-once video opens full screen, where watching it counts.
      inlineUri={destruct?.mode === "view" ? null : uri}
    />
  );
});

interface MessageBubbleProps {
  message: DmMessage;
  isMine: boolean;
  showAvatar?: boolean;
  /**
   * Where this line sits in a run from one sender (back-to-back, within 5
   * minutes, same day). Inner corners tighten and only the last line carries
   * the time, so a run reads as one block. Both default to true: a lone line.
   */
  groupFirst?: boolean;
  groupLast?: boolean;
  onLongPress?: (
    message: DmMessage,
    layout: MessageLayout,
    isMine: boolean,
  ) => void;
  onImagePress?: (url: string) => void;
  onVideoPress?: (url: string, play?: DmVideoPlayExtra) => void;
  /** Local URI override for optimistic media (pre-upload). */
  localMediaUri?: string;
  /** Called when the user swipes to reply. */
  onSwipeToReply?: (message: DmMessage) => void;
  /** Called when the reply preview is tapped — scrolls to the original message. */
  onReplyPress?: (messageId: string) => void;
  /** Whether this bubble is highlighted (flash animation after scroll). */
  highlighted?: boolean;
  /** Lowercase wallet address of the viewer, to mark their own reactions. */
  myAddress?: string;
  /** Toggle the viewer's reaction from a chip under the bubble. */
  onToggleReaction?: (message: DmMessage, emoji: string, addOnly?: boolean) => void;
  /** The other person in a one-to-one chat, so a call card can call them back. */
  callPeerAddress?: string;
}


const MessageBubbleComponent: React.FC<MessageBubbleProps> = ({
  message,
  isMine,
  showAvatar = false,
  groupFirst = true,
  groupLast = true,
  onLongPress,
  onImagePress,
  onVideoPress,
  localMediaUri,
  onSwipeToReply,
  onReplyPress,
  highlighted = false,
  myAddress = "",
  onToggleReaction,
  callPeerAddress,
}) => {
  usePerfProbe("MessageBubble");
  const { t: _copy } = _useCopy();
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  // Reader's chat text size (Settings → Appearance), on top of the phone's own font size.
  const textScale = useChatTextScale();
  const chatTextStyle = useMemo(() => ({ fontSize: 15 * textScale, lineHeight: Math.round(21 * textScale) }), [textScale]);
  const { width: windowWidth } = useWindowDimensions();
  const MAX_IMAGE_WIDTH = maxImageWidth(windowWidth);
  const BUBBLE_ASSET_CARD_WIDTH = bubbleAssetCardWidth(windowWidth);
  const containerRef = useRef<View>(null);

  const isTipMsg = (message.msgType as DmMsgType) === "tip";
  useReactionHost(message._id);

  // Highlight animation for scroll-to-reply
  const highlightOpacity = useSharedValue(0);

  useEffect(() => {
    if (highlighted) {
      highlightOpacity.value = withSequence(
        withTiming(1, { duration: 300 }),
        withTiming(0.4, { duration: 350 }),
        withTiming(1, { duration: 350 }),
        withTiming(0.4, { duration: 350 }),
        withTiming(1, { duration: 350 }),
        withDelay(600, withTiming(0, { duration: 500 })),
      );
    } else {
      highlightOpacity.value = 0;
    }
  }, [highlighted, highlightOpacity]);

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: highlightOpacity.value,
  }));

  const isCallMsg = message.msgType === "msg" && /^[📞📹📵]/u.test(message.content || "");

  const REPLY_THRESHOLD = 60;
  const translateX = useSharedValue(0);
  // Reply arrows are built on the first swipe, not for every bubble on screen.
  const [swipeArmed, setSwipeArmed] = useState(false);
  const noSwipe = useMemo(() => Gesture.Tap(), []);

  const fireSwipeReply = useCallback(() => {
    haptic.select();
    onSwipeToReply?.(message);
  }, [message, onSwipeToReply]);

  const panGesture = useMemo(
    () =>
      // iOS keeps rightward swipes for native back navigation.
      Gesture.Pan()
        .activeOffsetX(Platform.OS === "ios" ? -14 : [-14, 14])
        .failOffsetY([-15, 15])
        .onStart(() => {
          runOnJS(setSwipeArmed)(true);
        })
        .onUpdate((e) => {
          translateX.value = Math.min(Math.max(e.translationX, -80), 80);
        })
        .onEnd((_event, success) => {
          if (success && Math.abs(translateX.value) >= REPLY_THRESHOLD) {
            runOnJS(fireSwipeReply)();
          }
        })
        .onFinalize(() => {
          translateX.value = withSpring(0, { damping: 20, stiffness: 200 });
        }),
    [fireSwipeReply],
  );

  const swipeAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const senderUser = getSenderUser(message);
  const avatarUrl = getAvatarUrl(senderUser?.avatarImageUrl);

  const msgType: DmMsgType = (message.msgType as DmMsgType) || "msg";
  const isVoice = msgType === "voice";
  const isGif = msgType === "gif";
  const isMedia = msgType === "media";
  // End-to-end encrypted attachment: rendered from its descriptor, never from
  // the ciphertext URL directly.
  const encMedia = message.encMedia || null;
  const encUrl = useMemo(() => {
    const first = message.mediaUrls?.find((mu) => typeof mu === "object" && mu.encrypted);
    return first ? first.url : null;
  }, [message.mediaUrls]);
  const encVisual = !!encMedia && (encMedia.kind === "image" || encMedia.kind === "video");
  const hasText = !!message.content?.trim() && !isGif;
  const isUploading = message.uploadStatus === "pending";
  const isUploadFailed = message.uploadStatus === "failed";
  const optimistic = message as Partial<OptimisticMessage>;
  const canDoubleTap = !isMine && !!myAddress && !!onToggleReaction
    && msgType === "msg" && hasText && !isCallMsg && !message.undecryptable
    && !optimistic._optimistic && !optimistic._tempId && !isUploading && !isUploadFailed;
  const addHeart = useCallback(() => {
    onToggleReaction?.(message, "❤️", true);
  }, [message, onToggleReaction]);
  const doubleTap = useMemo(() => Gesture.Tap()
    .enabled(canDoubleTap)
    .numberOfTaps(2)
    .maxDuration(220)
    .maxDelay(300)
    .maxDistance(10)
    .runOnJS(true)
    .onEnd((_event, success) => { if (success) addHeart(); }), [addHeart, canDoubleTap]);

  const mediaItems = useMemo(() => {
    // GIF: prefer URL from mediaUrls, fall back to content for legacy messages
    if (isGif) {
      const gifMedia = message.mediaUrls?.find(
        (mu) => typeof mu === "object" && /gif/i.test(mu.mimeType || mu.type || ""),
      );
      const gifRaw = gifMedia
        ? (typeof gifMedia === "string" ? gifMedia : gifMedia.url)
        : (message.content?.startsWith("http") ? message.content : null);
      if (!gifRaw) return [];
      const gifUrl = outsideImage(resolveUrl(gifRaw));
      return [{ url: gifUrl, kind: "gif" as const }];
    }
    // Encrypted entries render through EncryptedMedia (or not at all, when
    // this device cannot open them).
    if (encMedia) return [];
    const plainUrls = message.mediaUrls?.filter((mu) => !(typeof mu === "object" && mu.encrypted));
    if (!plainUrls?.length) {
      if (localMediaUri) return [{ url: localMediaUri, kind: "image" as const }];
      return [];
    }

    const items = plainUrls.map((mu) => {
      const raw = typeof mu === "string" ? mu : mu.url;
      const mime = typeof mu === "object" ? mu.mimeType || mu.type : undefined;
      // A document is flagged by the entry's own type, and must be checked
      // before localMediaUri — that branch assumes a preview-ready image.
      const isFile = typeof mu === "object" && mu.type === "file";
      if (isFile) {
        return {
          url: resolveUrl(raw),
          kind: "file" as const,
          name: (mu as any).name as string | undefined,
          size: (mu as any).size as number | undefined,
        };
      }
      // An audio FILE (not a recorded voice note) plays inline like one.
      if (typeof mime === "string" && (mime.startsWith("audio/") || mime === "audio")) {
        return { url: resolveUrl(raw), kind: "audio" as const, name: (mu as any).name as string | undefined };
      }
      const url = localMediaUri || resolveUrl(raw);
      // localMediaUri is always a preview-ready asset (thumbnail jpg for video, original for image)
      const kind: "image" | "video" | "gif" = localMediaUri
        ? "image"
        : isVideoMime(mime) ? "video" : "image";
      return { url, kind };
    });

    return items;
  }, [message.mediaUrls, message.content, isGif, isMedia, msgType, message._id, localMediaUri, encMedia]);


  // A shared thing arrives as text containing a link to it (optionally with a
  // caption on the line above). Detect it so we can render a tappable card
  // instead of a dead URL.
  //
  // This recognised `…/post/<id>` and nothing else, so a shop item, a
  // community, an event or a profile — all of which the web app renders as a
  // card when you send them — landed here as a bare URL.
  // @assistant offers to do things (react, follow, read your chats) with a
  // link in its reply. In its DM, as on the Assistant screen, that link is a
  // confirm card and is left out of the text.
  const assistantActions = useMemo(
    () =>
      !isMine && msgType === "msg" && isAssistantAddress(callPeerAddress)
        ? assistantActionIds(message.content)
        : [],
    [isMine, msgType, callPeerAddress, message.content],
  );
  // Sent with "Send in their language": `content` is the line in the
  // recipient's language, `original` what the sender typed. The sender sees
  // their own words, the recipient sees theirs, and either can flip.
  const sentPair = msgType === "msg" && message._id && message.original?.content ? message.original : null;
  if (sentPair) primeDmPair(message._id, isMine ? message.content ?? "" : sentPair.content);
  const bodyContent = sentPair && isMine
    ? sentPair.content
    : assistantActions.length
      ? withoutAssistantActionLinks(message.content ?? "")
      : message.content;

  const momentReply = useMemo(() => msgType === "msg" && !encMedia && !mediaItems.length
    ? parseMomentReply(bodyContent) ?? parseSharedMoment(bodyContent) : null, [msgType, encMedia, mediaItems.length, bodyContent]);
  const sharedLink = useMemo(() => {
    if (momentReply || isVoice || isGif || encMedia || mediaItems.length > 0) return null;
    const link = findDehubLink(bodyContent ?? "");
    if (!link) return null;
    // Everything except the carded link itself is the caption.
    //
    // A blanket `https?://\S+` sweep used to run here as well, which deleted
    // every *other* link in the message — send someone a post and an article
    // together and the article was simply not there on arrival. The web app
    // never did this; whatever survives stripping now renders as a tappable
    // link instead of as debris.
    const caption = stripDehubLinkMatches(bodyContent ?? "", [link]).trim();
    return { link, caption };
  }, [momentReply, bodyContent, isVoice, isGif, encMedia, mediaItems.length]);

  // Market references in a plain message. Skipped when the message is an entity
  // share, which has its own card.
  const assetRefs = useMemo(
    () =>
      sharedLink || momentReply
        ? []
        : findAssetRefs(bodyContent ?? "").slice(0, MAX_ASSET_CARDS_PER_MESSAGE),
    [bodyContent, sharedLink, momentReply],
  );
  const assetDisplayText = useMemo(
    () => (assetRefs.length ? stripAssetRefs(bodyContent ?? "", assetRefs) : bodyContent),
    [bodyContent, assetRefs],
  );

  // Translate from the hold menu: the bubble swaps in the translation and
  // shows "Show original" under it.
  const translation = useDmTranslation(message._id);
  const translated = translation?.status === "shown" ? translation.text : null;

  // Messages you receive translate themselves when they plainly read as another
  // language (live chat rules). Queued behind the screen's own work, a few at a
  // time. Your own messages stay as you wrote them.
  const autoEnabled = React.useSyncExternalStore(subscribeAutoTranslate, autoTranslateEnabled);
  const { i18n: autoI18n } = useTranslation();
  useEffect(() => {
    if (isMine || isCallMsg || !autoEnabled || !message._id || sentPair) return;
    if (msgType !== "msg" && !(msgType === "media" && message.content)) return;
    const readerLang = getUserLanguage();
    if (!shouldAutoTranslateDm(message.content, readerLang)) return;
    return queueAutoTranslate(() => autoTranslateDm(message._id, message.content));
  }, [isMine, isCallMsg, autoEnabled, message._id, message.content, msgType, autoI18n.language, sentPair]);
  const metaGrey = useMetaGrey();
  const pairShown = translation?.status === "shown";
  // The small note under a line sent in their language: which version this is.
  const pairNote = !sentPair ? ""
    : isMine
      ? (pairShown
        ? t("dmTranslateOut.asTheySee", { defaultValue: "As they see it" })
        : t("dmTranslateOut.sentIn", { defaultValue: "Sent in {{language}}", language: languageName(sentPair.lang, getUserLanguage()) }))
      : (pairShown
        ? t("dmTranslateOut.original", { defaultValue: "Original" })
        : t("dmTranslateOut.translated", { defaultValue: "Translated" }));
  const translationStatus = sentPair ? (
    <View className="px-3 pt-1">
      <TouchableOpacity
        onPress={() => void toggleDmTranslation(message._id, message.content)}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="button"
        style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
      >
        <Icon name="Languages" size={12} color={isMine ? "hsla(0, 0%, 100%, 0.72)" : metaGrey} />
        <Text style={{ fontSize: 12, color: isMine ? "hsla(0, 0%, 100%, 0.72)" : metaGrey }}>{pairNote}</Text>
      </TouchableOpacity>
    </View>
  ) : translation ? (
    <View className="px-3 pt-1">
      <TranslateButton
        inline
        statusOnly
        isTranslated={translation.status === "shown"}
        isLoading={translation.status === "loading"}
        onTranslate={() => void toggleDmTranslation(message._id, message.content)}
        onShowOriginal={() => void toggleDmTranslation(message._id, message.content)}
      />
    </View>
  ) : null;

  const handleLongPress = useCallback(() => {
    containerRef.current?.measureInWindow((x, y, width, height) => {
      onLongPress?.(message, { x, y, width, height }, isMine);
    });
  }, [message, isMine, onLongPress]);

  const handleImageTap = useCallback(
    (url: string, index: number = 0) => {
      if (onImagePress) {
        onImagePress(url);
        return;
      }
      const imageUrls = mediaItems
        .filter((m) => m.kind !== "video")
        .map((m) => m.url);
      navigation.navigate("ImageViewer", {
        images: imageUrls.length > 0 ? imageUrls : [url],
        initialIndex: index,
        allowDownload: true,
      });
    },
    [navigation, onImagePress, mediaItems],
  );

  // A locked photo opens on its own: the gallery list would be the blurred preview.
  const handleImageTapUrl = useCallback(
    (url: string) => {
      if (onImagePress) {
        onImagePress(url);
        return;
      }
      navigation.navigate("ImageViewer", { images: [url], initialIndex: 0, allowDownload: true });
    },
    [navigation, onImagePress],
  );

  const handleVideoTap = useCallback(
    (url: string) => {
      onVideoPress?.(url, {
        options: message.mediaOptions ?? message.encMedia?.opts ?? null,
        messageId: message._id,
        viewOnce: message.destruct?.mode === "view" && !isMine,
      });
    },
    [onVideoPress, message.mediaOptions, message.encMedia, message._id, message.destruct, isMine],
  );

  /**
   * Documents are handed to the OS rather than opened in-app: they're stored
   * with `Content-Disposition: attachment`, so the download manager takes them
   * and nothing an uploader supplied is ever parsed or rendered by us.
   */
  const handleFileTap = useCallback(async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        toastError(t("dm.cantOpenFile"));
        return;
      }
      await Linking.openURL(url);
    } catch {
      toastError(t("dm.couldntOpenFile"));
    }
  }, [t]);


  const timeStr = formatMessageTime(message.createdAt);

  // Whether this message was sent with an on-chain payment (per-message fee or voluntary tip)
  const isPaidMsg = !!(message.paymentTxHash || message.paymentStatus || message.tipAmount);

  // Determine payment amount for the badge:
  // - Per-message fee: tipAmount is set on optimistic from dmFee.fee, confirmed via feeConfirmed event
  // - Tipped message: tipAmount is populated once confirmed
  const paymentAmount = message.tipAmount ?? null;
  const paymentSymbol = message.tipSymbol ?? "DHB";

  // Failed = upload failed on a paid message (tx reverted, e.g. STF error)
  const isFailed = isPaidMsg && message.uploadStatus === "failed";

  const StatusRow = useCallback(() => (
    <View
      className={`flex-row items-center gap-1 mt-0.5 ${
        isMine ? "justify-end" : "justify-start"
      }`}
    >
      <Text
        className={`text-[11px] ${
          isMine ? "text-white/50" : "text-theme-neutrals-500"
        }`}
      >
        {timeStr}
      </Text>
      {message.encrypted && (
        <Icon name="Lock" size={10} color={isMine ? "rgba(255,255,255,0.45)" : "#808089"} />
      )}
      {isMine && isUploadFailed && (
        <SendFailedRow message={message as OptimisticMessage} />
      )}
      {isMine && !isUploadFailed && message.whenOnline && !message.isRead && !(message as OptimisticMessage)._optimistic && (
        // Sent for when they're next online. Stays until it is read, never
        // changes on delivery, so it says nothing about when they were online.
        <Icon name="Hourglass" size={11} color="rgba(255,255,255,0.55)" accessibilityLabel={t("dmSchedule.whenOnlineTick", { defaultValue: "Waiting for them to come online. Turns into two ticks when read." })} />
      )}
      {isMine && !isUploadFailed && (
        // One fixed 12px slot: a small spinner while the line is going out,
        // the tick once it lands. Same box either way, so nothing moves.
        <View style={{ width: 12, height: 12, alignItems: "center", justifyContent: "center" }}>
          {(message as OptimisticMessage)._optimistic ? (
            <ActivityIndicator
              size="small"
              color="rgba(255,255,255,0.6)"
              style={{ transform: [{ scale: 0.5 }] }}
              accessibilityLabel={t("dm.sending")}
            />
          ) : (
            <Icon
              name={message.isRead ? "CheckCheck" : "Check"}
              size={12}
              color={message.isRead ? "#F4F4F5" : "rgba(255,255,255,0.55)"}
            />
          )}
        </View>
      )}
    </View>
  ), [timeStr, isMine, message.isRead, message.encrypted, message, isUploadFailed, t]);


  // Tail corner: the last line of a run keeps the small 2px tail corner, lines
  // inside the run get 6px on that side, and every line after the first gets
  // 6px on the top of that side too.
  const tailCorner = isMine
    ? (groupLast ? "rounded-br-sm" : "rounded-br-md")
    : (groupLast ? "rounded-bl-sm" : "rounded-bl-md");
  const topCorner = groupFirst ? "" : isMine ? " rounded-tr-md" : " rounded-tl-md";
  const bubbleBg = isMine
    ? `bg-white/[0.11] rounded-xl ${tailCorner}${topCorner}`
    : `border border-white/[0.16] rounded-xl ${tailCorner}${topCorner}`;

  const isMediaOnly = (mediaItems.length > 0 || encVisual) && !hasText && !isVoice;
  // Media-only paid msgs need a background for PaymentBadge; plain media-only don't
  const activeBubbleBg = isMediaOnly
    ? (isPaidMsg
        ? bubbleBg + " overflow-hidden"  // full bubble bg for payment badge area
        : `rounded-xl ${tailCorner}${topCorner} overflow-hidden`)
    : bubbleBg;

  // These two returns sit below every hook above deliberately.
  //
  // They used to sit at the top, which left this component calling three
  // hooks for a call or tip notice and a dozen for an ordinary message. A
  // bubble that changed kind in place — `isCallMsg` is a regex over
  // `message.content` — would flip branch under the same key and take the
  // thread down with "rendered fewer hooks than expected". Keep them here.
  if (isCallMsg) {
    return (
      <CallNoteCard
        content={message.content || ""}
        time={formatMessageTime(message.createdAt)}
        isMine={isMine}
        peerAddress={callPeerAddress}
      />
    );
  }

  if (isTipMsg) {
    const tipSym = message.tipSymbol && message.tipSymbol !== "DHB" ? message.tipSymbol : null;
    const amountLabel = message.tipAmount
      ? tipSym
        ? `${Number(message.tipAmount).toLocaleString()} ${tipSym}`
        : t("dm.tokenAmount", { amount: Number(message.tipAmount).toLocaleString() })
      : tipSym || t("dm.tokensUnit");
    const isPending = message.paymentStatus === "pending";
    const label = isMine
      ? t("dm.youTipped", { amount: amountLabel })
      : t("dm.tippedYouAmount", { amount: amountLabel });

    return (
      <View className="items-center py-2 px-4">
        <View className="flex-row items-center bg-theme-neutrals-800/60 rounded-full px-3 py-1.5 gap-1.5">
          <TipGemIcon tipped burstKey={Date.now() - new Date(message.createdAt).getTime() < 15_000 ? 1 : 0} size={14} color="#F4F4F5" />
          <Text className="text-theme-neutrals-300 text-[12px] font-medium">
            {label}
          </Text>
          {isPending && (
            <ActivityIndicator size={10} color="#A6A9AC" style={{ marginLeft: 2 }} />
          )}
        </View>
        {isPending && (
          <Text className="text-theme-neutrals-500 text-[11px] mt-1">
            {t("dm.confirmingOnChain")}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View>
      {/* Reply arrows — sit behind the message */}
      {swipeArmed ? <SwipeReplyArrows x={translateX} threshold={REPLY_THRESHOLD} /> : null}

      <GestureDetector gesture={onSwipeToReply ? panGesture : noSwipe}>
        <Animated.View style={swipeAnimStyle}>
          <Pressable
            onLongPress={handleLongPress}
            delayLongPress={350}
          >
        <View
          ref={containerRef}
          className={`flex-row items-end gap-2 px-3 ${groupFirst ? "pt-0.5" : "pt-[1px]"} ${groupLast ? "pb-1.5" : "pb-[1px]"} ${
            isMine ? "justify-end" : "justify-start"
          }`}
        >
          {/* Highlight overlay for scroll-to-reply (only while flashing) */}
          {highlighted ? (
            <Animated.View
              style={[
                {
                  position: "absolute",
                  top: -2,
                  left: 0,
                  right: 0,
                  bottom: -2,
                  backgroundColor: "rgba(255,255,255, 0.12)",
                  borderRadius: 12,
                },
                highlightStyle,
              ]}
              pointerEvents="none"
            />
          ) : null}
          {/* Avatar (other user, first in a group) */}
          {!isMine && showAvatar && (
            <Avatar
              uri={
                avatarUrl && avatarUrl !== "default-avatar"
                  ? avatarUrl
                  : undefined
              }
              size={28}
              name={senderUser?.displayName || senderUser?.username}
            />
          )}

          {/* Only the received text bubble takes the gesture, not the row or avatar. */}
          <GestureDetector gesture={doubleTap}>
          <View
            collapsable={false}
            className={`max-w-[75%] ${activeBubbleBg} overflow-hidden`}
          >
            {/* Forwarded tag */}
            {message.isForwarded && (
              <View className="flex-row items-center gap-1 px-3 pt-1.5">
                <Icon name="Forward" size={10} color={isMine ? "rgba(255,255,255,0.5)" : "#A6A9AC"} />
                <Text className={`text-[11px] italic ${isMine ? "text-white/50" : "text-theme-neutrals-400"}`}>
                  {t("dm.forwarded")}
                </Text>
              </View>
            )}

            {/* Reply-to preview */}
            {message.replyTo && (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => message.replyTo?._id && onReplyPress?.(message.replyTo._id)}
                className={`mx-2 mt-2 rounded-lg overflow-hidden ${
                  isMine ? "bg-white/10" : "bg-theme-neutrals-700"
                }`}
              >
                <View className="px-2.5 py-2">
                  <Text
                    className={`text-[11px] font-medium mb-0.5 ${
                      isMine ? "text-white/70" : "text-accent"
                    }`}
                    numberOfLines={1}
                  >
                    {message.replyTo.sender?.displayName ||
                      message.replyTo.sender?.username ||
                      t("settings.unknown")}
                  </Text>
                  {message.replyTo.msgType === "voice" ? (
                    <View className="flex-row items-center gap-1">
                      <Icon
                        name="Mic"
                        size={12}
                        color={isMine ? "rgba(255,255,255,0.5)" : "#A6A9AC"}
                      />
                      <Text
                        className={`text-[12px] ${
                          isMine ? "text-white/50" : "text-theme-neutrals-400"
                        }`}
                      >
                        {t("dm.voiceNote")}
                        {message.replyTo.voiceDuration
                          ? ` ${Math.floor(message.replyTo.voiceDuration / 60)}:${String(
                              Math.round(message.replyTo.voiceDuration % 60),
                            ).padStart(2, "0")}`
                          : ""}
                      </Text>
                    </View>
                  ) : message.replyTo.msgType === "gif" ? (
                    <View className="flex-row items-center gap-1">
                      <Text
                        className={`text-[12px] ${
                          isMine ? "text-white/50" : "text-theme-neutrals-400"
                        }`}
                      >
                        GIF
                      </Text>
                    </View>
                  ) : message.replyTo.encMedia || message.replyTo.mediaUrls?.[0]?.encrypted ? (
                    <View className="flex-row items-center gap-1.5">
                      {message.replyTo.encMedia?.thumb ? (
                        <SmartImage
                          source={{ uri: message.replyTo.encMedia.thumb }}
                          style={{ width: 32, height: 32, borderRadius: 4 }}
                          contentFit="cover"
                          cachePolicy="none"
                          blurRadius={4}
                        />
                      ) : (
                        <Icon
                          name={message.replyTo.encMedia?.kind === "file" ? "FileText" : "Image"}
                          size={14}
                          color={isMine ? "rgba(255,255,255,0.5)" : "#A6A9AC"}
                        />
                      )}
                      <Text
                        className={`text-[12px] flex-1 ${
                          isMine ? "text-white/50" : "text-theme-neutrals-400"
                        }`}
                        numberOfLines={1}
                      >
                        {message.replyTo.content ||
                          (message.replyTo.encMedia
                            ? encryptedMediaLabel(message.replyTo.encMedia, t)
                            : t("dm.attachment"))}
                      </Text>
                    </View>
                  ) : message.replyTo.mediaUrls?.length ? (
                    <View className="flex-row items-center gap-1.5">
                      <SmartImage
                        source={{ uri: resolveUrl(message.replyTo.mediaUrls[0]?.url) }}
                        recyclingKey={resolveUrl(message.replyTo.mediaUrls[0]?.url)}
                        style={{ width: 32, height: 32, borderRadius: 4 }}
                        contentFit="cover"
                      />
                      <Text
                        className={`text-[12px] flex-1 ${
                          isMine ? "text-white/50" : "text-theme-neutrals-400"
                        }`}
                        numberOfLines={1}
                      >
                        {message.replyTo.content || t("dm.photo")}
                      </Text>
                    </View>
                  ) : (
                    <Text
                      className={`text-[12px] ${
                        isMine ? "text-white/50" : "text-theme-neutrals-400"
                      }`}
                      numberOfLines={2}
                    >
                      {message.replyTo.content || ""}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            )}

            {/* End-to-end encrypted attachment */}
            {encMedia && (
              <View>
                <EncryptedMedia
                  destruct={message.destruct}
                  descriptor={encMedia}
                  rawUrl={encUrl}
                  messageId={message._id}
                  isMine={isMine}
                  onVideoPress={handleVideoTap}
                  onLongPress={handleLongPress}
                />
                {isUploadFailed && encVisual && (
                  <View className="absolute inset-0 items-center justify-center dark-surface bg-black/50">
                    <Icon name="CircleAlert" size={28} color="#F4F4F5" />
                    <Text className="text-[11px] text-white/80 mt-1 font-medium">
                      {t("dm.failedToSend")}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Pay-to-unlock photo or video: its own card, never the plain media path. */}
            {isMedia && message.lock ? (
              <LockedMedia
                message={message}
                isMine={isMine}
                width={MAX_IMAGE_WIDTH}
                onImagePress={handleImageTapUrl}
                onVideoPress={onVideoPress}
                onLongPress={handleLongPress}
              />
            ) : null}

            {/* Media (images / video / GIF) */}
            {mediaItems.length > 0 && !isVoice && !(isMedia && message.lock) && (
              <View>
                {mediaItems.map((item, idx) =>
                  message.destruct?.mode === "open" && (item.kind === "image" || item.kind === "video") ? (
                    <DmOpenTimerMedia
                      key={idx}
                      messageId={message._id}
                      mine={isMine}
                      destruct={message.destruct}
                      kind={item.kind}
                      src={item.url}
                      onOpenOwn={() => (item.kind === "video" ? handleVideoTap(item.url) : handleImageTapUrl(item.url))}
                      onLongPress={handleLongPress}
                    />
                  ) : item.kind === "audio" ? (
                    <View key={idx} className="px-2 py-1 min-w-[220px]" style={{ maxWidth: MAX_IMAGE_WIDTH }}>
                      <VoiceNotePlayer audioUrl={item.url} compact />
                      {(item as any).name ? (
                        <Text className={`text-[11px] mt-0.5 px-1 ${isMine ? "text-white/70" : "text-theme-neutrals-500"}`} numberOfLines={1}>
                          {(item as any).name}
                        </Text>
                      ) : null}
                    </View>
                  ) : item.kind === "file" ? (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => handleFileTap(item.url)}
                      onLongPress={handleLongPress}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={_copy("copy.8fe1a08e1a39", { defaultValue: "Download {{value1}}", value1: (item as any).name || _copy("copy.602a5e69c302", { defaultValue: "attachment" }) })}
                      className="flex-row items-center px-3 py-2.5"
                      style={{ maxWidth: MAX_IMAGE_WIDTH }}
                    >
                      <View
                        className={`w-9 h-9 rounded-lg items-center justify-center mr-2.5 ${
                          isMine ? "bg-white/15" : "bg-theme-neutrals-700"
                        }`}
                      >
                        <Icon name="FileText" size={18} color={isMine ? "#fff" : "#F4F4F5"} />
                      </View>
                      <View className="flex-1">
                        <Text
                          className={`text-[14px] font-medium ${
                            isMine ? "text-white" : "text-theme-neutrals-100"
                          }`}
                          numberOfLines={1}
                        >
                          {(item as any).name || t("dm.attachment")}
                        </Text>
                        <Text
                          className={`text-[11px] mt-0.5 ${
                            isMine ? "text-white/70" : "text-theme-neutrals-500"
                          }`}
                        >
                          {getAttachmentLabel((item as any).name || "")}
                          {(item as any).size ? ` · ${formatAttachmentSize((item as any).size)}` : ""}
                        </Text>
                      </View>
                      <Icon name="Download" size={16} color={isMine ? "#ffffffaa" : "#8B8D90"} />
                    </TouchableOpacity>
                  ) : item.kind === "video" ? (
                    <PlainDmVideo
                      key={idx}
                      uri={item.url}
                      messageId={message._id}
                      options={message.mediaOptions}
                      destruct={message.destruct}
                      mine={isMine}
                      maxW={MAX_IMAGE_WIDTH}
                      maxH={MAX_IMAGE_HEIGHT}
                      onPress={() => handleVideoTap(item.url)}
                      onLongPress={handleLongPress}
                    />
                  ) : (
                    <DmTimeLeft key={idx} destruct={message.destruct}>
                      <AutoImage
                        uri={item.url}
                        isGif={item.kind === "gif"}
                        onPress={() => handleImageTap(item.url, idx)}
                        onLongPress={handleLongPress}
                      />
                    </DmTimeLeft>
                  ),
                )}
                {/* Upload progress / failure overlay */}
                {isUploading && (
                  <View className="absolute inset-0 items-center justify-center dark-surface bg-black/40">
                    <ActivityIndicator color="#fff" size="small" />
                    <Text className="text-[11px] text-white/80 mt-1">
                      {t("dm.sending")}
                    </Text>
                  </View>
                )}
                {isUploadFailed && (
                  <View className="absolute inset-0 items-center justify-center dark-surface bg-black/50">
                    <Icon name="CircleAlert" size={28} color="#F4F4F5" />
                    <Text className="text-[11px] text-white/80 mt-1 font-medium">
                      {t("dm.failedToSend")}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Voice note */}
            {isVoice && !encMedia && (() => {
              const first = message.mediaUrls?.[0];
              // Ciphertext this device cannot open is not playable audio.
              const raw = typeof first === "object" && first?.encrypted ? undefined : first;
              const voiceUrl = raw
                ? resolveUrl(typeof raw === "string" ? raw : raw.url)
                : undefined;
              return voiceUrl ? (
                <View className="px-2 min-w-[200px]">
                  <VoiceNotePlayer
                    audioUrl={voiceUrl}
                    duration={message.voiceDuration ?? undefined}
                    compact
                  />
                </View>
              ) : (
                <View className="flex-row items-center px-3 py-2.5 gap-2.5 min-w-[160px]">
                  <View
                    className={`w-8 h-8 rounded-xl items-center justify-center ${
                      isMine ? "bg-white/15" : "bg-accent/20"
                    }`}
                  >
                    <Icon name="Mic" size={16} color={isMine ? "#fff" : "#F4F4F5"} />
                  </View>
                  <Text
                    className={`text-[11px] ${
                      isMine ? "text-white/70" : "text-theme-neutrals-500"
                    }`}
                  >
                    {message.voiceDuration
                      ? `${Math.floor(message.voiceDuration / 60)}:${String(
                          Math.round(message.voiceDuration % 60),
                        ).padStart(2, "0")}`
                      : "0:00"}
                  </Text>
                </View>
              );
            })()}

            {/* Shared Riftn link — rich preview card that opens it on tap */}
            {momentReply ? (
              <View style={{ maxWidth: MAX_IMAGE_WIDTH }}>
                <MomentReplyPreview shared={"shared" in momentReply} id={momentReply.id} onLongPress={handleLongPress} />
                {!!momentReply.text && <LinkedText text={translated ?? momentReply.text} onLongPress={handleLongPress}
                  className={`px-3 pt-2 text-[15px] ${isMine ? "text-white" : "text-theme-neutrals-100"}`}
                  style={chatTextStyle} fontSize={15 * textScale} />}
                {translationStatus}
              </View>
            ) : sharedLink ? (
              <>
                {/* The card leads the bubble and the caption follows it, the
                    way a photo with a caption reads. The post card folds the
                    caption into itself as a title, so only the others print it. */}
                <DehubLinkCard
                  link={sharedLink.link}
                  isMine={isMine}
                  inBubble
                  fallbackTitle={sharedLink.caption || undefined}
                  onLongPress={handleLongPress}
                />
                {!!sharedLink.caption && sharedLink.link.kind !== "post" && (
                  <LinkedText
                    text={translated ?? sharedLink.caption}
                    className={`px-3 pt-2 text-[15px] leading-5 ${
                      isMine ? "text-white" : "text-theme-neutrals-100"
                    }`}
                    onLongPress={handleLongPress}
                    style={chatTextStyle}
                    fontSize={15 * textScale}
                  />
                )}
                {sharedLink.link.kind !== "post" && translationStatus}
              </>
            ) : (
              hasText && (
                <>
                  {!!assetDisplayText?.trim() && (
                    <LinkedText
                      text={translated ?? assetDisplayText}
                      className={`px-3 ${
                        mediaItems.length > 0 ? "pt-1.5 pb-0.5" : "pt-2.5 pb-0.5"
                      } text-[15px] leading-5 ${
                        isMine ? "text-white" : "text-theme-neutrals-100"
                      }`}
                      onLongPress={handleLongPress}
                    style={chatTextStyle}
                    fontSize={15 * textScale}
                    />
                  )}
                  {translationStatus}
                  {/* A contract address or a $TICKER in a message cards up the
                      same way it does in a post. Entity shares are left alone:
                      they already have a card above. The width is fixed because
                      a bubble sizes to its text, and an address-only message has
                      no text left to size it. */}
                  {assetRefs.length > 0 && (
                    <View
                      className="px-3 pb-1"
                      style={{ width: BUBBLE_ASSET_CARD_WIDTH + 24 }}
                    >
                      <AssetRefCards refs={assetRefs} />
                    </View>
                  )}
                  {assistantActions.map((id) => (
                    <View key={id} className="px-2 pb-2" style={{ width: 300 }}>
                      <AssistantActionCard actionId={id} />
                    </View>
                  ))}
                  {/* An outside link gets the OG card the web bubble already
                      shows. Fixed width for the same reason the asset card has
                      one, and it renders nothing at all when the message holds
                      no external link, so a plain text bubble is untouched. */}
                  <LinkPreviewCard
                    text={assetDisplayText}
                    style={{
                      width: BUBBLE_ASSET_CARD_WIDTH,
                      marginHorizontal: 12,
                      marginBottom: 4,
                    }}
                  />
                </>
              )
            )}

            {/* Encrypted on another device's key — never show the envelope */}
            {message.undecryptable && (
              <View className="flex-row items-center gap-1.5 px-3 pt-2.5 pb-0.5">
                <Icon name="Lock" size={12} color={isMine ? "rgba(255,255,255,0.5)" : "#A6A9AC"} />
                <Text
                  className={`text-[14px] italic ${isMine ? "text-white/60" : "text-theme-neutrals-400"}`}
                >
                  {t("messages.cannotDecrypt")}
                </Text>
              </View>
            )}

            {/* Payment badge — "Sent with X DHB" for paid / tipped messages */}
            {isPaidMsg && !isMediaOnly && (
              <View className="px-3">
                <PaymentBadge
                  amount={paymentAmount}
                  symbol={paymentSymbol}
                  status={message.paymentStatus}
                  isMine={isMine}
                  failed={isFailed}
                />
              </View>
            )}

            {/* Inline timestamp + status */}
            {isMediaOnly ? (
              <>
                {/* Payment badge overlay for media-only paid messages */}
                {isPaidMsg && (
                  <View className="px-2 pb-0.5">
                    <PaymentBadge
                      amount={paymentAmount}
                      symbol={paymentSymbol}
                      status={message.paymentStatus}
                      isMine={isMine}
                      failed={isFailed}
                    />
                  </View>
                )}
                <View className={`${isPaidMsg ? "px-2 pb-1.5" : "absolute bottom-1.5 right-2"} flex-row items-center gap-1 ${isPaidMsg ? "justify-end" : "dark-surface bg-black/50 rounded-full px-1.5 py-0.5"}`}>
                  <Text className="text-[11px] text-white/80">{timeStr}</Text>
                  {message.encrypted && (
                    <Icon name="Lock" size={10} color="rgba(255,255,255,0.6)" />
                  )}
                  {isMine && message.whenOnline && !message.isRead ? (
                    <Icon name="Hourglass" size={11} color="rgba(255,255,255,0.6)" />
                  ) : null}
                  {isMine && (
                    <Icon
                      name={message.isRead ? "CheckCheck" : "Check"}
                      size={12}
                      color={message.isRead ? "#F4F4F5" : "rgba(255,255,255,0.6)"}
                    />
                  )}
                </View>
              </>
            ) : (
              // Inside a run only the last line carries the time; a line that
              // is still sending, failed, or paid keeps its row.
              groupLast || isPaidMsg || isUploadFailed || (message as OptimisticMessage)._optimistic ? (
                <View className="px-3 pb-1.5">
                  <StatusRow />
                </View>
              ) : (
                <View className="pb-2" />
              )
            )}
          </View>
          </GestureDetector>
        </View>
      </Pressable>
        </Animated.View>
      </GestureDetector>
      {onToggleReaction && (
        <ReactionChips
          messageId={message._id}
          reactions={message.reactions}
          myAddress={myAddress}
          isMine={isMine}
          onToggle={(emoji) => onToggleReaction(message, emoji)}
        />
      )}
    </View>
  );
};

export default memo(MessageBubbleComponent);
