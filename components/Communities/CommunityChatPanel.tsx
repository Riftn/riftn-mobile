import { useChatTextScale } from "../../hooks/useAppPrefs";
import { openMessageReport } from "../common/MessageReportHost";
import { IS_APP_STORE_BUILD } from "../../config/storefront";
import { useKeyboardSwap } from "../../hooks/useKeyboardSwap";
import { useSurfaceDraft, draftIdentity } from '../../hooks/useSurfaceDraft';
import { useDraftState } from '../../hooks/useDraftState';
import BadgeArtwork from "../common/BadgeArtwork";
import SwipeToReply from "../Chat/SwipeToReply";
/**
 * CommunityChatPanel
 * ==================
 * Mobile counterpart to web's CommunityChat, and the community sibling of
 * TVChatPanel: the message row is the same row — same display-name fallback
 * chain, same staking badge, same `h:mm AM/PM` stamp, same quoted-reply block
 * and reaction pills — so a message reads identically in either place.
 *
 * On top of that row sits the community layer:
 *   - a pinned banner that jumps to and flashes the pinned message
 *   - a long-press action sheet (reply / copy / edit / pin / delete), each
 *     entry gated on the right the server would check
 *   - the restriction states (not a member, muted, posting revoked) rendered
 *     in place of the composer
 *   - the slow-mode hint and post-send countdown
 *
 * The database is the authority on every one of these — the gating here only
 * avoids offering a control that would be refused.
 *
 * GIFs and voice notes, as on web, sit behind abilities.can("send_media"):
 * a GIF posts its GIPHY URL, a voice note is uploaded through the same
 * dm-upload-media function web uses and posts the stored URL. Photos follow
 * Public Chat's rules (JPG, PNG, GIF, WebP up to 10MB), with the typed line
 * as the caption.
 *
 * Sizing is the caller's job: this fills whatever box it is given (flex: 1).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { runWithPermissions } from "../../libs/permissions.util";
import { holderGateOf, runHolderCheck } from "../../libs/holder-gate";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  Modal,
  StyleSheet,
} from "react-native";
import SmartImage from "../common/SmartImage";
import { Image } from "expo-image";
import { storageImageSource } from "../../libs/cdnImage";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BuyAlertCard, parseBuyAlert } from "./BuyAlertCard";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import Avatar from "../common/Avatar";
import { getAvatarUrl, getBadgeHoverOpticalStyle as getBadgeOpticalStyle, getBadgeUrl, resolveBadgeBalance } from "../../libs/misc";
import { copyToClipboard } from "../../libs/clipboard.utils";
import { toastSuccess } from "../../libs/toast";
import { useUser } from "../../context/AuthContext";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import { useCommunityChat } from "../../hooks/useCommunityChat";
import { useComposerKeyboard } from "../../hooks/useComposerKeyboard";
import { getCommunityAbilities, isForever } from "../../libs/community-permissions";
import { communityKindOf } from "../../libs/community-kinds";
import type { Community, CommunityChatMessage, CommunityMember } from "../../types/community";
import { DehubLinkCards, MAX_CARDS_PER_MESSAGE } from "../common/DehubLinkCard";
import LinkPreviewCard from "../common/LinkPreviewCard";
import { findDehubLinks, stripDehubLinkMatches } from "../../libs/dehub-links";
import { chatBodyText } from "../../libs/chat-gif";
import { AssetRefCards, MAX_ASSET_CARDS_PER_MESSAGE } from "../common/AssetRefCard";
import { findAssetRefs, stripAssetRefs } from "../../libs/asset-refs";
import MentionSuggestions from "../common/MentionSuggestions";
import EmojiSheet from "../Upload/EmojiSheet";
import WhenOpened from "../ui/WhenOpened";
import { InlineEmoji, expandEmojiTokens } from "../common/EmojiText";
import { ReactionArrivalScope, ReactionGlyph, RollingCount, useReactionHost } from "../ChatReactions/ReactionArrival";
import { useMentions } from "../../hooks/useMentions";
import { useCommunityJoinLines } from "../../hooks/useCommunityJoinLines";
import type { MentionUser } from "../../services/mention.service";
import { ChatReactorsSheet } from "./ChatReactorsSheet";
import TranslateButton from "../ui/TranslateButton";
import { canTranslateDm, getDmTranslation, shouldAutoTranslateDm, toggleDmTranslation, translateDmAndAbove, useDmTranslation } from "../../libs/dm-translation-store";
import { getUserLanguage } from "../../services/translation.service";
import GifPicker from "../DM/GifPicker";
import VoiceNotePlayer from "../Comments/VoiceNotePlayer";
import ImageViewerModal from "../common/ImageViewerModal";
import { useVoiceRecorder, VoiceNoteRecordingOverlay } from "../Comments/VoiceNoteRecorder";
import type { VoiceNoteResult } from "../Comments/VoiceNoteRecorder";
import { uploadLiveChatImage } from "../../services/livechat.service";
import { toastError } from "../../libs/toast";
import { askAiAdmin, getCommunityMemberRow } from "../../services/communities.service";
import { MemberActionsSheet, canTargetMember } from "./manage/MemberActionsSheet";
import { translateCopy as _translateCopy } from "../../i18n/copy";
import { UnreadMarker, UnreadJumpButton } from "../DM/UnreadJump";
import { useAppTheme } from "../../context/ThemeContext";
import type { UnreadAnchor } from "../../libs/chatUnreadAnchor";
import { anchorFromReadSpot } from "../../libs/chatReadPosition";
import { useChatReadPosition } from "../../hooks/useChatReadPosition";
import { roomChatId } from "../../services/dm/dm.api";
import DeleteMessageSheet, { resolveDelete, type DeleteRequest } from "../DM/DeleteMessageSheet";

const REACTION_EMOJIS = ["🔥", "❤️", "😂", "👀", "💯", "🙌"];
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const MAX_LEN = 500;
/** Rendered window, oldest end trimmed. Grown by the "show earlier" header. */
const PAGE = 30;
/** History pages a chat may pull in at open to reach where you left off. */
const MAX_READ_SPOT_PAGES = 10;
const FLASH_MS = 1500;
/** Long enough for the action sheet to finish dismissing before the delete sheet. */
const ALERT_DELAY_MS = 250;

const MONTHS = [
  () => _translateCopy("copy.5c5db120cb11", { defaultValue: "Jan" }),
  () => _translateCopy("copy.caf71b3f582d", { defaultValue: "Feb" }),
  () => _translateCopy("copy.b4b7d3818dbf", { defaultValue: "Mar" }),
  () => _translateCopy("copy.617531b4fec3", { defaultValue: "Apr" }),
  () => _translateCopy("copy.8c78fe5b9936", { defaultValue: "May" }),
  () => _translateCopy("copy.b27fd46ed1b6", { defaultValue: "Jun" }),
  () => _translateCopy("copy.c43f56b9807e", { defaultValue: "Jul" }),
  () => _translateCopy("copy.41e1d82aa990", { defaultValue: "Aug" }),
  () => _translateCopy("copy.451e2b719061", { defaultValue: "Sep" }),
  () => _translateCopy("copy.6877e8494c3a", { defaultValue: "Oct" }),
  () => _translateCopy("copy.3e630d2964a0", { defaultValue: "Nov" }),
  () => _translateCopy("copy.f2a0cfbcf191", { defaultValue: "Dec" }),
];

const formatClock = (date: Date): string => {
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? _translateCopy("copy.6b987654a411", { defaultValue: "PM" }) : _translateCopy("copy.c8f48a68649d", { defaultValue: "AM" });
  return `${h % 12 || 12}:${m} ${ampm}`;
};

/** `4 Aug, 9:05 PM` — built by hand so it does not depend on Intl being present. */
const formatWhen = (date: Date): string =>
  `${date.getDate()} ${MONTHS[date.getMonth()]()}, ${formatClock(date)}`;

const humaniseInterval = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
};

/** Client-only list rows for "Name joined"; never sent or stored. */
const JOIN_LINE_TYPE = "member_join";

const mmss = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;

// ─── Message row ─────────────────────────────────────────────────────────────

const ChatRow: React.FC<{
  message: CommunityChatMessage;
  myAddress: string;
  flashing: boolean;
  canReact: boolean;
  onLongPress: (message: CommunityChatMessage) => void;
  onToggleReaction: (id: string, emoji: string) => void;
  onShowReactors: (message: CommunityChatMessage, emoji: string) => void;
  onOpenProfile: (identifier: string, wallet?: string) => void;
  onJumpToMessage: (id: string) => Promise<void>;
}> = ({ message, myAddress, flashing, canReact, onLongPress, onToggleReaction, onShowReactors, onOpenProfile, onJumpToMessage }) => {
  const { t } = useTranslation();

  const isMe = !!myAddress && message.wallet_address?.toLowerCase() === myAddress;
  const { isLight } = useAppTheme();
  const displayName =
    message.display_name ||
    message.username ||
    message.wallet_address?.slice(0, 8) ||
    t("communities.chatPanel.anon", { defaultValue: "Anon" });
  const avatarUrl = getAvatarUrl(message.avatar_url || "");
  const badgeImg = getBadgeUrl(resolveBadgeBalance({ badgeBalance: message.badge_balance }), { username: message.username });

  const reactionEntries = useMemo(
    () => Object.entries(message.reactions || {}).filter(([, addrs]) => addrs.length > 0),
    [message.reactions],
  );
  useReactionHost(message.id);

  const profileId = message.username || message.wallet_address;
  // A tapped picture opens full screen, with Download.
  const [viewing, setViewing] = useState<string[] | null>(null);

  // Web sends a GIF with its URL as the message body and the same URL in
  // image_url. The picture is already on screen, so printing the body as well
  // just puts a stray link under it — drop it, and the link card with it.
  const textScale = useChatTextScale();
  const bodyText = useMemo(() => chatBodyText(message), [message]);

  // A shop item, an event or another community dropped into a channel arrived
  // as a bare URL; card it the same way the feed and DMs now do.
  const dehubLinks = useMemo(
    () => findDehubLinks(bodyText).slice(0, MAX_CARDS_PER_MESSAGE),
    [bodyText],
  );
  const linkFreeContent = useMemo(
    () => (dehubLinks.length ? stripDehubLinkMatches(bodyText, dehubLinks) : bodyText),
    [bodyText, dehubLinks],
  );
  // Same for a contract address or a ticker dropped into a channel.
  const assetRefs = useMemo(
    () => findAssetRefs(linkFreeContent).slice(0, MAX_ASSET_CARDS_PER_MESSAGE),
    [linkFreeContent],
  );
  const displayContent = useMemo(
    () => stripAssetRefs(linkFreeContent, assetRefs),
    [linkFreeContent, assetRefs],
  );
  // Translate from the hold menu swaps the words for the translation, with
  // "Show original" under them, the same as DMs.
  const translation = useDmTranslation(message.id);
  const translatedText = translation?.status === "shown" ? translation.text : null;
  // A small Translate under lines in another language, as on web: holding
  // the message to find it was a step too many.
  const offerTranslate = useMemo(
    () => !isMe && !!bodyText && shouldAutoTranslateDm(bodyText, getUserLanguage()),
    [isMe, bodyText],
  );

  return (
    <Pressable
      onLongPress={() => onLongPress(message)}
      delayLongPress={300}
      className="flex-row px-3 py-1.5"
      style={[isMe && (isLight ? styles.mineRowLight : styles.mineRow), flashing && styles.flash]}
    >
      <Pressable onPress={() => profileId && onOpenProfile(profileId, message.wallet_address)}>
        <Avatar uri={avatarUrl} size={32} name={displayName} />
      </Pressable>

      <View className="flex-1 ml-2.5">
        <View className="flex-row items-baseline gap-1.5 mb-0.5 flex-wrap">
          <Text
            className="font-bold text-white"
            style={{ fontSize: 13.5 * textScale }}
            numberOfLines={1}
            onPress={() => profileId && onOpenProfile(profileId, message.wallet_address)}
          >
            {displayName}
          </Text>
          {!!badgeImg && (
            <BadgeArtwork source={badgeImg} style={[getBadgeOpticalStyle(badgeImg, 13), { marginLeft: 0 }]} contentFit="contain" />
          )}
          {!!message.pinned_at && <Icon name="Pin" size={10} color="#A1A1AA" />}
          <Text className="text-zinc-400 text-xs ml-auto">
            {formatClock(new Date(message.created_at))}
          </Text>
        </View>

        {!!message.reply_to && (
          <Pressable
            className="bg-white/5 rounded-lg px-2.5 py-1.5 mb-1"
            onPress={() => void onJumpToMessage(message.reply_to!.id)}
            onLongPress={() => onLongPress(message)}
            delayLongPress={300}
            accessibilityRole="button"
            accessibilityLabel={t("communities.jumpToReply", { defaultValue: "Jump to replied message" })}
          >
            <Text className="text-zinc-300 text-[11px] font-medium" numberOfLines={1}>
              {message.reply_to.sender_name}
            </Text>
            <Text className="text-white/50 text-xs" numberOfLines={1}>
              {message.reply_to.content}
            </Text>
          </Pressable>
        )}

        {message.message_type === "voice" && !!message.image_url ? (
          <View style={{ marginBottom: 4, maxWidth: 260 }}>
            <VoiceNotePlayer audioUrl={message.image_url} compact />
          </View>
        ) : !!message.image_url && (
          <Pressable
            onPress={() => setViewing([message.image_url!])}
            onLongPress={() => onLongPress(message)}
            delayLongPress={300}
            accessibilityRole="imagebutton"
          >
            <Image
              source={storageImageSource(message.image_url, 180)}
              style={styles.messageImage}
              contentFit="cover"
            />
          </Pressable>
        )}
        <ImageViewerModal images={viewing} onClose={() => setViewing(null)} allowDownload />

        {/* A shared community or invite leads the message and its words follow,
            matching the DM bubble. The long press reaches through the card so
            reacting to a shared invite works like any other message. */}
        {dehubLinks.length > 0 && (
          <View style={displayContent ? { marginBottom: 6 } : undefined}>
            <DehubLinkCards links={dehubLinks} onLongPress={() => onLongPress(message)} />
          </View>
        )}

        {!!displayContent && (
          <Text className="text-white/80" style={{ fontSize: 15 * textScale, lineHeight: Math.round(21 * textScale) }}>{expandEmojiTokens(translatedText ?? displayContent, { fontSize: 15 * textScale })}</Text>
        )}
        {!translation && offerTranslate && (
          <View className="pt-1 self-start">
            <TranslateButton
              inline
              isTranslated={false}
              isLoading={false}
              onTranslate={() => void toggleDmTranslation(message.id, bodyText)}
              onShowOriginal={() => void toggleDmTranslation(message.id, bodyText)}
            />
          </View>
        )}
        {!!translation && (
          <View className="pt-1">
            <TranslateButton
              inline
              statusOnly
              isTranslated={translation.status === "shown"}
              isLoading={translation.status === "loading"}
              onTranslate={() => void toggleDmTranslation(message.id, bodyText)}
              onShowOriginal={() => void toggleDmTranslation(message.id, bodyText)}
            />
          </View>
        )}

        <LinkPreviewCard text={bodyText} />
        <AssetRefCards refs={assetRefs} />

        {!!message.edited_at && (
          <Text className="text-zinc-400 text-xs mt-0.5">
            {t("communities.chatPanel.edited", { defaultValue: "edited" })}
          </Text>
        )}

        {reactionEntries.length > 0 && (
          <View className="flex-row flex-wrap gap-1 mt-1">
            {reactionEntries.map(([emoji, addrs]) => {
              const mine = !!myAddress && addrs.some((a) => a.toLowerCase() === myAddress);
              return (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    if (canReact) onToggleReaction(message.id, emoji);
                  }}
                  // Press and hold shows who reacted, even for people who can't react.
                  onLongPress={() => onShowReactors(message, emoji)}
                  delayLongPress={300}
                  style={[styles.reactionPill, mine && styles.reactionPillMine]}
                >
                  <ReactionGlyph messageId={message.id} emoji={emoji} addresses={addrs} me={myAddress} still={<InlineEmoji value={emoji} size={11} />} size={11} />
                  <RollingCount value={addrs.length} style={[styles.reactionCount, mine && { color: "#FFFFFF" }]} />
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
    </Pressable>
  );
};

// ─── Panel ───────────────────────────────────────────────────────────────────

interface CommunityChatPanelProps {
  community: Community;
  membership: CommunityMember | null | undefined;
  isMember: boolean;
  /** Joins the community: makes the "join to chat" bar a button. */
  onJoin?: () => void;
  joining?: boolean;
  /** A search result to open the chat on; `n` changes on every pick. */
  jumpTo?: { id: string; n: number } | null;
}

export function CommunityChatPanel({ community, membership, isMember, onJoin, joining, jumpTo }: CommunityChatPanelProps) {
  const { t } = useTranslation();
  const user = useUser() as any;
  const { showUserProfile } = useUserProfileSheet();

  /**
   * Edge-to-edge Android does not shrink the window for the keyboard, so the
   * panel lifts its composer by hand, measured against the keyboard's top
   * (hooks/useComposerKeyboard). Working it out from the keyboard height and
   * the insets left the box under the keys on some phones.
   */
  const composerKeyboard = useComposerKeyboard(0, { gap: 0 });
  const keyboardLift = composerKeyboard.lift;
  // The message actions sheet is a Modal, which is edge-to-edge and outside the
  // root SafeAreaView, so it has to clear the nav bar on its own.
  const insets = useSafeAreaInsets();

  const listRef = useRef<FlatList<CommunityChatMessage>>(null);
  const atBottomRef = useRef(true);
  // While the keyboard opens or closes the list shrinks under the reader and
  // its scroll reports read as "scrolled up", so the latest message stayed
  // hidden under the reply box. A reader at the bottom when the keys start
  // moving is held on the latest message until they settle.
  const liftGuardUntilRef = useRef(0);
  const lastLiftRef = useRef(keyboardLift);
  useEffect(() => {
    if (lastLiftRef.current === keyboardLift) return;
    lastLiftRef.current = keyboardLift;
    if (!atBottomRef.current) return;
    liftGuardUntilRef.current = Date.now() + 1200;
    const timers = [0, 120, 350, 700, 1000].map((ms) =>
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [keyboardLift]);
  // "Jump to latest", as web's CommunityChat draws it: shown once the reader
  // has scrolled up, with a count of the messages that arrived since.
  const [showJump, setShowJump] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myAddress = ((user?.walletAddress || user?.address || "") as string).toLowerCase();
  // Holder groups: re-read this member's balance when the chat opens, so a
  // top-up lets them talk again and a sale is caught before they type.
  useEffect(() => {
    if (!isMember || !myAddress || !holderGateOf(community)) return;
    if (membership?.role === "owner" || membership?.role === "admin") return;
    runHolderCheck(community.id, myAddress).catch(() => { /* the send guard still decides */ });
  }, [isMember, myAddress, community, membership?.role]);

  const abilities = useMemo(
    () => getCommunityAbilities(community, membership),
    [community, membership],
  );

  const {
    messages,
    pinnedMessage,
    isLoading,
    hasOlderMessages, isLoadingOlder, loadOlder, showMessage, showLatest, isHistoryWindow, error: historyError, refreshHistory,
    sendMessage,
    editMessage,
    deleteMessage,
    hideMessage,
    setPinned,
    addReaction,
    removeReaction,
  } = useCommunityChat(community.id, { isPrivate: community.is_private });

  const [editing, setEditing] = useState<CommunityChatMessage | null>(null);
  const [text, setText] = useDraftState(editing ? `community:${community.id}:edit:${editing.id}` : `community:${community.id}:composer`, editing?.content ?? "");
  // @mention typeahead. Handles were already parsed out of sent text for
  // notifications, but nothing suggested anyone while typing, so a mention
  // only landed if you already knew the handle exactly.
  // The people talking here come first, so tagging someone in the group is
  // one "@" and a tap rather than a search across everyone on Riftn.
  const mentionPool = useMemo(() => {
    const seen = new Set<string>();
    const pool: MentionUser[] = [];
    for (let i = messages.length - 1; i >= 0 && pool.length < 50; i--) {
      const m = messages[i];
      const handle = m.username?.trim();
      if (!handle || seen.has(handle.toLowerCase())) continue;
      if (myAddress && m.wallet_address?.toLowerCase() === myAddress) continue;
      seen.add(handle.toLowerCase());
      pool.push({
        username: handle,
        displayName: m.display_name || handle,
        avatarImageUrl: m.avatar_url || "",
        address: m.wallet_address,
        isFollowing: false,
      });
    }
    return pool;
  }, [messages, myAddress]);
  const mentions = useMentions(text, setText, mentionPool);
  const [replyTo, setReplyTo] = useDraftState<CommunityChatMessage | null>(`community:${community.id}:reply`, null);
  const [sending, setSending] = useState(false);
  const [sheetFor, setSheetFor] = useState<CommunityChatMessage | null>(null);
  const [reactorsFor, setReactorsFor] = useState<{ id: string; emoji: string } | null>(null);
  // Message whose full emoji picker is open. The action sheet closes first:
  // iOS will not stack a second modal on one that is still presenting.
  const [moreFor, setMoreFor] = useState<CommunityChatMessage | null>(null);
  const moreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (moreTimer.current) clearTimeout(moreTimer.current);
  }, []);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [cooldown, setCooldown] = useState(0);

  const canPin = abilities.can("pin_messages");
  const canSendMedia = abilities.can("send_media");
  const [gifOpen, setGifOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const keyboardSwap = useKeyboardSwap(inputRef);
  const gifPress = useMemo(() => keyboardSwap.pressProps(() => keyboardSwap.swapTo(() => setGifOpen(true))), [keyboardSwap]);
  const canDeleteAny = abilities.can("delete_messages");
  const canSend = isMember && !abilities.isMuted && abilities.can("send_messages");

  const slowSeconds = community.slow_mode_seconds || 0;
  /** Owners and admins are exempt server-side, so only members see the hint. */
  const slowModeApplies = slowSeconds > 0 && abilities.role === "member";

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (alertTimer.current) clearTimeout(alertTimer.current);
    },
    [],
  );

  // One tick per second; each decrement re-runs the effect.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const visibleMessages = useMemo(
    () =>
      messages.length > visibleCount ? messages.slice(messages.length - visibleCount) : messages,
    [messages, visibleCount],
  );

  // "Name joined" lines, slotted in by time. Only joins inside the loaded
  // window show, so scrolling back doesn't stack a wall of old joins on top.
  const joinLines = useCommunityJoinLines(community.id, myAddress, isMember);
  const listItems = useMemo(() => {
    if (!joinLines.length) return visibleMessages;
    const oldest = visibleMessages[0]?.created_at;
    // Reading an older stretch: nothing past its last message either.
    const newest = isHistoryWindow ? visibleMessages[visibleMessages.length - 1]?.created_at : undefined;
    const joins = joinLines
      .filter((j) => (!oldest || j.joinedAt >= oldest) && (!newest || j.joinedAt <= newest))
      .slice(0, oldest ? undefined : 10)
      .map(
        (j) =>
          ({
            id: `join:${j.wallet}`,
            community_id: community.id,
            wallet_address: j.wallet,
            username: null,
            display_name: j.name,
            avatar_url: null,
            badge_balance: null,
            content: "",
            message_type: JOIN_LINE_TYPE,
            image_url: null,
            reply_to_id: null,
            reactions: {},
            created_at: j.joinedAt,
            pinned_at: null,
            pinned_by: null,
            edited_at: null,
          }) as CommunityChatMessage,
      );
    if (!joins.length) return visibleMessages;
    return [...visibleMessages, ...joins].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [visibleMessages, joinLines, community.id, isHistoryWindow]);

  // Runs after the window has grown, so the index is always in range.
  useEffect(() => {
    if (!pendingJump) return;
    const index = listItems.findIndex((m) => m.id === pendingJump);
    if (index >= 0) {
      try {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
      } catch {
        // onScrollToIndexFailed picks it up
      }
    }
    if (index >= 0) setPendingJump(null);
  }, [pendingJump, listItems]);

  const jumpToMessage = useCallback(
    async (id: string) => {
      try {
        await showMessage(id);
        setFlashId(id);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlashId(null), FLASH_MS);
        setVisibleCount(Math.max(messages.length, 50));
        atBottomRef.current = false;
        setPendingJump(id);
      } catch { toastError(t("common.failedToLoad")); }
    },
    [showMessage, messages.length, t],
  );

  // A message picked in the chat search (CommunityDetailScreen's header).
  const jumpRef = useRef(jumpToMessage);
  jumpRef.current = jumpToMessage;
  useEffect(() => {
    if (jumpTo?.id) void jumpRef.current(jumpTo.id);
  }, [jumpTo?.id, jumpTo?.n]);

  const loadEarlier = useCallback(async () => {
    if (isLoadingOlder) return;
    atBottomRef.current = false;
    try {
      if (visibleCount >= messages.length && !(await loadOlder())) return;
      setVisibleCount(c => c + PAGE);
    } catch { toastError(t("common.failedToLoad")); }
  }, [isLoadingOlder, visibleCount, messages.length, loadOlder, t]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  // Counted from the old tail, not the length: the list is capped at 200, so
  // once it is full every new message pushes an old one out and the length
  // stops moving. Old tail gone (a full refetch) counts nothing, like web.
  const lastIdRef = useRef<string | null>(null);
  const lastMessageId = messages[messages.length - 1]?.id ?? null;
  useEffect(() => {
    const prev = lastIdRef.current;
    lastIdRef.current = lastMessageId;
    if (!prev || prev === lastMessageId || atBottomRef.current) return;
    const at = messages.findIndex((m) => m.id === prev);
    const added = at === -1 ? 0 : messages.length - 1 - at;
    if (added > 0) setUnseen((n) => n + added);
    // Only a new tail is a new message; `messages` is read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageId]);

  const jumpToLatest = useCallback(async () => {
    try {
      await showLatest();
      setVisibleCount(PAGE);
      atBottomRef.current = true;
      setUnseen(0);
      setShowJump(false);
      scrollToBottom();
    } catch { toastError(t("common.failedToLoad")); }
  }, [showLatest, scrollToBottom, t]);

  // ─── Where you left off ──────────────────────────────────────────────────
  // Saved on the server per chat (same spot as the website). The chat opens
  // on the first line you haven't seen, under an "Unread messages" line.
  const readSpot = useChatReadPosition(myAddress ? roomChatId(community.id) : null);
  const openedAtRef = useRef(Date.now());
  const [unreadAnchor, setUnreadAnchor] = useState<UnreadAnchor | null>(null);
  const [readDecided, setReadDecided] = useState(false);
  const readSpotPagesRef = useRef(0);
  const readTrackingRef = useRef(false);
  const unreadPlacedRef = useRef(false);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const [unreadMarkerAbove, setUnreadMarkerAbove] = useState(false);
  const [unreadMarkerSeen, setUnreadMarkerSeen] = useState(false);
  useEffect(() => {
    if (readDecided || isLoading || !messages.length || !readSpot.ready) return;
    const decide = (anchor: UnreadAnchor | null) => {
      setReadDecided(true);
      setUnreadAnchor(anchor);
      if (anchor) {
        atBottomRef.current = false;
        const index = messages.findIndex((m) => m.id === anchor.id);
        if (index >= 0) setVisibleCount((c) => Math.max(c, messages.length - index + 3));
      } else {
        readTrackingRef.current = true;
      }
    };
    if (!readSpot.opening || isHistoryWindow) { decide(null); return; }
    const lines = messages.map((m) => ({
      id: m.id,
      mine: !!myAddress && m.wallet_address?.toLowerCase() === myAddress,
      at: m.created_at,
      skip: !!(m as { send_state?: string }).send_state || m.message_type === "buy_alert" || m.message_type === "admin_response",
    }));
    const found = anchorFromReadSpot(lines, readSpot.opening, hasOlderMessages, openedAtRef.current);
    if (found.kind === "older") {
      if (readSpotPagesRef.current < MAX_READ_SPOT_PAGES) {
        if (!isLoadingOlder) {
          readSpotPagesRef.current += 1;
          loadOlder().catch(() => {});
        }
        return;
      }
      const theirs = lines.filter((l) => !l.mine && !l.skip);
      decide(theirs.length ? { id: theirs[0].id, ids: theirs.map((l) => l.id), count: theirs.length } : null);
      return;
    }
    decide(found.kind === "anchor" ? found.anchor : null);
  }, [readDecided, isLoading, messages, readSpot.ready, readSpot.opening, isHistoryWindow, hasOlderMessages, isLoadingOlder, loadOlder, myAddress]);

  // Land on the marker once its row is in the list: it sits at the top.
  useEffect(() => {
    if (!unreadAnchor || unreadPlacedRef.current) return;
    const index = listItems.findIndex((m) => m.id === unreadAnchor.id);
    if (index < 0) return;
    const timer = setTimeout(() => {
      unreadPlacedRef.current = true;
      try {
        listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
      } catch { /* onScrollToIndexFailed */ }
      setTimeout(() => { readTrackingRef.current = true; reportReadSpotRef.current(); }, 600);
    }, 150);
    return () => clearTimeout(timer);
  }, [unreadAnchor, listItems]);

  const listItemsRef = useRef(listItems);
  listItemsRef.current = listItems;
  const unreadAnchorRef = useRef(unreadAnchor);
  unreadAnchorRef.current = unreadAnchor;
  const visibleRangeRef = useRef<{ min: number; max: number } | null>(null);
  const reportReadSpotRef = useRef(() => {});
  reportReadSpotRef.current = () => {
    const range = visibleRangeRef.current;
    if (!range || !readTrackingRef.current) return;
    const list = listItemsRef.current;
    for (let i = range.max; i >= range.min; i--) {
      const m = list[i];
      if (!m || m.message_type === JOIN_LINE_TYPE || (m as { send_state?: string }).send_state) continue;
      readSpot.report(m.id, m.created_at);
      return;
    }
  };
  const refreshUnreadJump = useCallback(() => {
    const anchor = unreadAnchorRef.current;
    const range = visibleRangeRef.current;
    if (!anchor || !range) { setUnreadBelow(0); setUnreadMarkerAbove(false); return; }
    const list = listItemsRef.current;
    let below = 0;
    for (const id of anchor.ids) {
      const i = list.findIndex((m) => m.id === id);
      if (i > range.max) below++;
    }
    setUnreadBelow(below);
    const at = list.findIndex((m) => m.id === anchor.id);
    setUnreadMarkerAbove(at >= 0 && at < range.min);
    if (at >= range.min && at <= range.max) setUnreadMarkerSeen(true);
  }, []);
  useEffect(() => { refreshUnreadJump(); }, [unreadAnchor, refreshUnreadJump]);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
    const idx = viewableItems.map((v) => v.index).filter((i): i is number => typeof i === "number");
    visibleRangeRef.current = idx.length ? { min: Math.min(...idx), max: Math.max(...idx) } : null;
    refreshUnreadJump();
    reportReadSpotRef.current();
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;
  const scrollToUnreadMarker = useCallback(() => {
    const anchor = unreadAnchorRef.current;
    if (!anchor) return;
    const index = listItemsRef.current.findIndex((m) => m.id === anchor.id);
    if (index < 0) return;
    atBottomRef.current = false;
    try {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
    } catch { /* onScrollToIndexFailed */ }
    setUnreadMarkerSeen(true);
  }, []);

  const handleSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      if (editing) {
        await editMessage(editing.id, body);
        if (setText.complete(text, "")) {
          setEditing(current => current?.id === editing.id ? null : current);
          mentions.reset();
        }
      } else {
        await sendMessage(body, replyTo?.id);
        if (setText.complete(text, "")) {
          mentions.reset();
          setReplyTo.complete(replyTo, null);
        }
        atBottomRef.current = true;
        scrollToBottom();
        // Feedback only — the server enforces slow mode on its own.
        if (slowModeApplies) setCooldown(slowSeconds);
        // "/admin <question>" asks the group's AI Admin, same as web. The line
        // is stored first; the function checks it is there before answering.
        const asked = /^\/admin\b\s*([\s\S]*)$/i.exec(body);
        if (asked) {
          const prompt = asked[1].trim();
          if (prompt) {
            void askAiAdmin(community.id, prompt).catch(() =>
              toastError(t("communities.chatPanel.aiAdminFailed", { defaultValue: "AI Admin failed to respond" })),
            );
          }
        }
      }
    } catch {
      // the hook already toasted
    } finally {
      setSending(false);
    }
  }, [text,
    sending,
    editing,
    mentions,
    editMessage,
    sendMessage,
    replyTo,
    scrollToBottom,
    slowModeApplies,
    slowSeconds, setText, setReplyTo, community.id, t]);

  // A GIF or voice note goes out at once, like web, then the same after-send
  // steps as text: reply cleared, scrolled to the bottom, slow mode shown.
  const sendMedia = useCallback(async (type: "gif" | "voice" | "image", url: string, caption = "") => {
    setSending(true);
    try {
      await sendMessage(type === "voice" ? url : caption, replyTo?.id, { type, url });
      setReplyTo.complete(replyTo, null);
      atBottomRef.current = true;
      scrollToBottom();
      if (slowModeApplies) setCooldown(slowSeconds);
    } catch {
      // the hook already toasted
    } finally {
      setSending(false);
    }
  }, [sendMessage, replyTo, setReplyTo, scrollToBottom, slowModeApplies, slowSeconds]);

  const handleVoiceDone = useCallback(async (result: VoiceNoteResult) => {
    if (!myAddress) return;
    setSending(true);
    try {
      // dm-upload-media takes audio/mp4 for the m4a the recorder writes.
      const mime = /m4a|aac|mp4/i.test(result.mimeType || "") || !result.mimeType ? "audio/mp4" : result.mimeType;
      const name = result.uri.split("/").pop() || `voice-${Date.now()}.m4a`;
      const { url } = await uploadLiveChatImage(result.uri, mime, name, myAddress);
      await sendMedia("voice", url);
    } catch (e: any) {
      toastError(e?.message || t("liveChat.voiceUploadFailed"));
      setSending(false);
    }
  }, [myAddress, sendMedia, t]);

  const handlePickPhoto = useCallback(async () => {
    if (!myAddress) return;
    await runWithPermissions(["photos"], async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        // iPhone photos come back as JPEG rather than HEIC.
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      const asset = result.canceled ? null : result.assets?.[0];
      if (!asset) return;
      if (asset.fileSize && asset.fileSize > PHOTO_MAX_BYTES) {
        toastError(t("communities.chatPanel.photoTooLarge", { defaultValue: "Image must be less than 10MB" }));
        return;
      }
      const mime = asset.mimeType && /^image\/(jpeg|png|gif|webp)$/i.test(asset.mimeType) ? asset.mimeType : "image/jpeg";
      const name = asset.fileName || asset.uri.split("/").pop() || `photo-${Date.now()}.jpg`;
      const caption = text.trim();
      setSending(true);
      try {
        const { url } = await uploadLiveChatImage(asset.uri, mime, name, myAddress);
        await sendMedia("image", url, caption);
        if (caption) setText.complete(text, "");
      } catch (e: any) {
        toastError(e?.message || t("liveChat.attachFailed"));
        setSending(false);
      }
    });
  }, [myAddress, sendMedia, t, text, setText]);

  const recorder = useVoiceRecorder({ onRecordingComplete: handleVoiceDone, onCancel: () => {} });

  const handleToggleReaction = useCallback(
    (id: string, emoji: string) => {
      const msg = messages.find((m) => m.id === id);
      const mine = msg?.reactions?.[emoji]?.some((a) => a.toLowerCase() === myAddress);
      if (mine) void removeReaction(id, emoji);
      else void addReaction(id, emoji);
    },
    [messages, myAddress, addReaction, removeReaction],
  );

  const handleShowReactors = useCallback(
    (message: CommunityChatMessage, emoji: string) => setReactorsFor({ id: message.id, emoji }),
    [],
  );
  // Read live from messages so the sheet follows realtime reaction changes.
  const reactorsMessage = reactorsFor ? messages.find((m) => m.id === reactorsFor.id) : undefined;

  const showProfile = useCallback(
    (identifier: string) => showUserProfile(identifier, { source: "community-chat" }),
    [showUserProfile],
  );
  // An owner or an admin who may restrict members gets that member's actions
  // (mute, ban, remove…) from a tap on their name; everyone else, the profile.
  const [memberActions, setMemberActions] = useState<CommunityMember | null>(null);
  const canRestrictMembers = abilities.isOwner || abilities.can("restrict_members");
  const handleOpenProfile = useCallback(
    (identifier: string, wallet?: string) => {
      if (!canRestrictMembers || !wallet || !myAddress || wallet.toLowerCase() === myAddress) {
        showProfile(identifier);
        return;
      }
      getCommunityMemberRow(community.id, wallet, myAddress)
        .then((row) => {
          if (row && canTargetMember(abilities, myAddress, row)) setMemberActions(row);
          else showProfile(identifier);
        })
        .catch(() => showProfile(identifier));
    },
    [canRestrictMembers, myAddress, community.id, abilities, showProfile],
  );

  // Like Telegram: your own message (or anyone's, for a moderator) can go for
  // everyone; any message can be deleted just for you.
  const [deleteReq, setDeleteReq] = useState<DeleteRequest | null>(null);
  const confirmDelete = useCallback(
    (message: CommunityChatMessage) => {
      setSheetFor(null);
      const mine = !!myAddress && message.wallet_address?.toLowerCase() === myAddress;
      if (alertTimer.current) clearTimeout(alertTimer.current);
      // Let the action sheet finish leaving first.
      alertTimer.current = setTimeout(() => {
        setDeleteReq(resolveDelete({
          count: 1,
          canDeleteForEveryone: mine || canDeleteAny,
          onDelete: (scope) => { void (scope === "everyone" ? deleteMessage(message.id) : hideMessage(message.id)); },
        }));
      }, ALERT_DELAY_MS);
    },
    [deleteMessage, hideMessage, myAddress, canDeleteAny],
  );

  // Swipe a line sideways to reply, like Public Chat and DMs.
  const handleSwipeReply = useCallback((message: CommunityChatMessage) => {
    setEditing(null);
    setReplyTo(message);
    inputRef.current?.focus();
  }, [setReplyTo]);

  const renderItem = useCallback(
    ({ item }: { item: CommunityChatMessage }) => {
      // Buy bot posts carry the trade as JSON: draw the card web draws. The
      // iPhone app shows no token trades (App Store 3.1.1).
      if (item.message_type === JOIN_LINE_TYPE) {
        return (
          <Text style={styles.joinLine} numberOfLines={1}>
            {t("communities.chatPanel.joined", { defaultValue: "{{name}} joined", name: item.display_name })}
          </Text>
        );
      }
      if (item.message_type === "buy_alert" && IS_APP_STORE_BUILD) return null;
      const buy = item.message_type === "buy_alert" ? parseBuyAlert(item.content) : null;
      if (buy) return <BuyAlertCard data={buy} time={formatClock(new Date(item.created_at))} />;
      const row = (
      <SwipeToReply onReply={handleSwipeReply} payload={item} enabled={isMember}>
      <ChatRow
        message={item}
        myAddress={myAddress}
        flashing={flashId === item.id}
        canReact={canSend}
        onLongPress={setSheetFor}
        onToggleReaction={handleToggleReaction}
        onShowReactors={handleShowReactors}
        onOpenProfile={handleOpenProfile}
        onJumpToMessage={jumpToMessage}
      />
      </SwipeToReply>
      );
      if (unreadAnchor?.id !== item.id) return row;
      return (
        <View>
          <UnreadMarker count={unreadAnchor.count} />
          {row}
        </View>
      );
    },
    [t, myAddress, flashId, canSend, isMember, handleSwipeReply, handleToggleReaction, handleShowReactors, handleOpenProfile, jumpToMessage, unreadAnchor],
  );

  // ── composer state, in the order the server checks them ──
  const mutedCopy = isForever(abilities.mutedUntil)
    ? t("communities.chatPanel.muted", { defaultValue: "You are muted" })
    : t("communities.chatPanel.mutedUntil", {
        defaultValue: "You are muted until {{date}}",
        date: abilities.mutedUntil ? formatWhen(abilities.mutedUntil) : "",
      });

  const readOnlyChannel = communityKindOf(community) === "channel" && !abilities.isOwner && !abilities.isAdmin;
  const composerNotice = !isMember
    ? t("communities.joinToChat", { defaultValue: "Join this community to chat" })
    : readOnlyChannel
      ? t("communities.newChat.adminsOnly", { defaultValue: "Only admins post in this channel." })
    : abilities.isMuted
      ? mutedCopy
      : !abilities.can("send_messages")
        ? t("communities.chatPanel.postingDisabled", {
            defaultValue: "Posting is disabled for members here",
          })
        : null;

  const noticeIcon: IconName = !isMember ? "Users" : readOnlyChannel ? ("Megaphone" as IconName) : abilities.isMuted ? "MicOff" : "Lock";

  const sendDisabled = !text.trim() || sending || cooldown > 0;

  const sheetIsMine = !!sheetFor && !!myAddress && sheetFor.wallet_address?.toLowerCase() === myAddress;
  const sheetCanEdit = sheetIsMine && sheetFor?.message_type === "text" && !!sheetFor?.content;
  // Anyone can delete a message for themselves (the alert offers "for everyone" when allowed).
  const sheetCanDelete = !!sheetFor?.id;

  const pinnedSender = pinnedMessage
    ? pinnedMessage.display_name ||
      pinnedMessage.username ||
      pinnedMessage.wallet_address?.slice(0, 8) ||
      t("communities.chatPanel.anon", { defaultValue: "Anon" })
    : "";
  const pinnedPreview = pinnedMessage
    ? chatBodyText(pinnedMessage).trim() ||
      t("communities.chatPanel.mediaMessage", { defaultValue: "Media" })
    : "";

  return (
    <View style={[styles.root, { paddingBottom: keyboardLift }]}>
      {!!pinnedMessage && (
        <Pressable style={styles.pinnedBar} onPress={() => jumpToMessage(pinnedMessage.id)}>
          <Icon name="Pin" size={13} color="#FFFFFF" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.pinnedLabel} numberOfLines={1}>
              {t("communities.chatPanel.pinnedMessage", { defaultValue: "Pinned message" })}
            </Text>
            <Text style={styles.pinnedBody} numberOfLines={1}>
              <Text style={styles.pinnedName}>{pinnedSender}</Text>
              {`  ${pinnedPreview}`}
            </Text>
          </View>
          {canPin && (
            <Pressable
              onPress={() => void setPinned(pinnedMessage.id, false)}
              hitSlop={15}
              accessibilityRole="button"
              accessibilityLabel={t("communities.unpin", { defaultValue: "Unpin" })}
            >
              <Icon name="X" size={14} color="#808089" />
            </Pressable>
          )}
        </Pressable>
      )}

      {historyError ? (
        <Pressable onPress={() => void refreshHistory()} style={styles.showMore} accessibilityRole="button">
          <Text style={styles.showMoreText}>{t("common.failedToLoad")} — {t("common.retry")}</Text>
        </Pressable>
      ) : null}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color="#F4F4F5" />
        </View>
      ) : (
        <ReactionArrivalScope style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          // "Show earlier messages" prepends a page; without this the list jumped
          // to the top of the new page instead of holding the reader in place.
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          data={listItems}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={
            listItems.length === 0 ? { flex: 1 } : { paddingVertical: 6 }
          }
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const fromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
            if (fromBottom >= 80 && Date.now() < liftGuardUntilRef.current) return;
            atBottomRef.current = fromBottom < 80;
            const farUp = fromBottom > 240;
            setShowJump((was) => (was === farUp ? was : farUp));
            if (fromBottom < 80) setUnseen((n) => (n === 0 ? n : 0));
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
          }}
          // The keyboard shrinks the list from below. A list that is not
          // inverted keeps its top in place, so the newest messages slid
          // under the reply box; hold the reader on the latest one instead.
          onLayout={() => {
            if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
          }}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: Math.max(0, info.averageItemLength * info.index),
              animated: true,
            });
          }}
          ListHeaderComponent={
            messages.length > visibleMessages.length || hasOlderMessages ? (
              <Pressable
                style={styles.showMore}
                onPress={() => void loadEarlier()}
                disabled={isLoadingOlder}
                accessibilityRole="button"
                accessibilityState={{ busy: isLoadingOlder, disabled: isLoadingOlder }}
              >
                <Text style={styles.showMoreText}>
                  {t("communities.chatPanel.showEarlier", { defaultValue: "Show earlier messages" })}
                </Text>
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.dim}>
                {t("communities.noMessagesYet", { defaultValue: "No messages yet" })}
              </Text>
            </View>
          }
        />
        {(() => {
          // Same control as DMs: up to the unread line until it has been seen,
          // then down to the newest, with the unread lines still below.
          const up = !!unreadAnchor && !unreadMarkerSeen && unreadMarkerAbove;
          if (!(up || showJump || unseen > 0 || isHistoryWindow)) return null;
          return (
            <View style={styles.jumpWrap}>
              <UnreadJumpButton
                up={up}
                count={unreadBelow + unseen}
                onPress={up ? scrollToUnreadMarker : () => void jumpToLatest()}
              />
            </View>
          );
        })()}
        </ReactionArrivalScope>
      )}

      {!!replyTo && !editing && (
        <View style={styles.contextBar}>
          <Icon name="Reply" size={13} color="#FFFFFF" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.contextName} numberOfLines={1}>
              {replyTo.display_name ||
                replyTo.username ||
                t("communities.chatPanel.anon", { defaultValue: "Anon" })}
            </Text>
            <Text style={styles.contextBody} numberOfLines={1}>
              {chatBodyText(replyTo) ||
                t("communities.chatPanel.mediaMessage", { defaultValue: "Media" })}
            </Text>
          </View>
          <Pressable
            onPress={() => setReplyTo.complete(replyTo, null)}
            hitSlop={15}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel", { defaultValue: "Cancel" })}
          >
            <Icon name="X" size={14} color="#808089" />
          </Pressable>
        </View>
      )}

      {!!editing && (
        <View style={styles.contextBar}>
          <Icon name="Pencil" size={13} color="#FFFFFF" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.contextName} numberOfLines={1}>
              {t("communities.chatPanel.editingMessage", { defaultValue: "Editing message" })}
            </Text>
            <Text style={styles.contextBody} numberOfLines={1}>
              {editing.content}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setEditing(null);
              setText.clear();
            }}
            hitSlop={15}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel", { defaultValue: "Cancel" })}
          >
            <Icon name="X" size={14} color="#808089" />
          </Pressable>
        </View>
      )}

      {slowModeApplies && !composerNotice && (
        <Text style={styles.slowModeLine}>
          {t("communities.chatPanel.slowMode", {
            defaultValue: "Slow mode: one message every {{interval}}",
            interval: humaniseInterval(slowSeconds),
          })}
        </Text>
      )}

      {/* No insets.bottom pad here, at rest or otherwise: the root SafeAreaView
          above the navigator already ends this panel above the home indicator,
          and paying it again floated the composer a full band too high. */}
      <MentionSuggestions
        visible={mentions.showSuggestions}
        suggestions={mentions.suggestions}
        onSelect={mentions.selectMention}
        loading={mentions.loading}
      />

      <View
        ref={composerKeyboard.ref}
        collapsable={false}
        onLayout={composerKeyboard.onLayout}
        style={[styles.composer, { paddingBottom: 8 }]}
      >
        {composerNotice ? (
          !isMember && onJoin && membership?.status !== "pending" ? (
            <Pressable
              style={[styles.noticeRow, joining && { opacity: 0.5 }]}
              onPress={onJoin}
              disabled={joining}
              accessibilityRole="button"
              accessibilityLabel={composerNotice}
            >
              <Icon name={noticeIcon} size={14} color="#808089" />
              <Text style={styles.noticeText}>{composerNotice}</Text>
            </Pressable>
          ) : (
            <View style={styles.noticeRow}>
              <Icon name={noticeIcon} size={14} color="#808089" />
              <Text style={styles.noticeText}>{composerNotice}</Text>
            </View>
          )
        ) : recorder.isRecording || recorder.isStopping ? (
          <View style={{ flex: 1 }}>
            <VoiceNoteRecordingOverlay recorder={recorder} />
          </View>
        ) : (
          <>
            {canSendMedia && !editing && (
              <View style={styles.mediaBtns}>
                <Pressable
                  {...gifPress}
                  disabled={sending || cooldown > 0}
                  style={styles.mediaBtn}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={t("comments.addGif")}
                >
                  <Text style={styles.gifText}>{t("liveChat.attachGif")}</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handlePickPhoto()}
                  disabled={sending || cooldown > 0}
                  style={styles.mediaBtn}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={t("liveChat.attachPhoto")}
                  testID="community-chat-photo"
                >
                  <Icon name="Image" size={17} color="#A1A1AA" />
                </Pressable>
                {!text.trim() && (
                  <Pressable
                    onPress={() => recorder.startRecording()}
                    disabled={sending || cooldown > 0}
                    style={styles.mediaBtn}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityLabel={t("comments.recordVoice")}
                  >
                    <Icon name="Mic" size={17} color="#A1A1AA" />
                  </Pressable>
                )}
              </View>
            )}
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={(v) => {
                if (v.length <= MAX_LEN) mentions.handleChangeText(v);
              }}
              onSelectionChange={mentions.handleSelectionChange}
              placeholder={t("communities.typeMessage", { defaultValue: "Type a message..." })}
              placeholderTextColor="#8B8D90"
              style={styles.input}
              multiline
              maxLength={MAX_LEN}
            />
            <Pressable
              onPress={() => void handleSend()}
              disabled={sendDisabled}
              style={[styles.sendBtn, sendDisabled && { opacity: 0.4 }]}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t("dm.sendMessage")}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : cooldown > 0 ? (
                <Text style={styles.cooldownText}>{mmss(cooldown)}</Text>
              ) : (
                <Icon name="Send" size={15} color="#FFFFFF" />
              )}
            </Pressable>
          </>
        )}
      </View>

      {gifOpen && (
        <GifPicker
          visible={gifOpen}
          onClose={() => {
            setGifOpen(false);
            keyboardSwap.restore();
          }}
          onPick={(url) => {
            setGifOpen(false);
            keyboardSwap.restore();
            void sendMedia("gif", url);
          }}
        />
      )}

      <MemberActionsSheet
        community={community}
        membership={membership}
        target={memberActions}
        visible={!!memberActions}
        onClose={() => setMemberActions(null)}
        onEditRights={() => setMemberActions(null)}
        onViewProfile={(m) => setTimeout(() => showProfile(m.wallet_address), 250)}
      />

      {!!reactorsMessage && !!reactorsFor && (
        <ChatReactorsSheet
          reactions={reactorsMessage.reactions ?? {}}
          focusEmoji={reactorsFor.emoji}
          onClose={() => setReactorsFor(null)}
          onOpenProfile={(id) => {
            setReactorsFor(null);
            handleOpenProfile(id);
          }}
        />
      )}

      <Modal
        visible={!!sheetFor}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetFor(null)}
      >
        <Pressable style={styles.overlay} onPress={() => setSheetFor(null)}>
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(28, insets.bottom + 16) }]}
            onPress={(e) => e.stopPropagation()}
          >
            {!!sheetFor && (
              <>
                <Text style={styles.sheetPreview} numberOfLines={2}>
                  {chatBodyText(sheetFor) ||
                    t("communities.chatPanel.mediaMessage", { defaultValue: "Media" })}
                </Text>

                {canSend && (
                  <View style={styles.emojiRow}>
                    {REACTION_EMOJIS.map((emoji) => (
                      <Pressable
                        key={emoji}
                        style={styles.emojiBtn}
                        onPress={() => {
                          handleToggleReaction(sheetFor.id, emoji);
                          setSheetFor(null);
                        }}
                      >
                        <Text style={{ fontSize: 18 }}>{emoji}</Text>
                      </Pressable>
                    ))}
                    <Pressable
                      style={styles.emojiBtn}
                      accessibilityLabel={t("emojiPicker.moreReactions")}
                      onPress={() => {
                        const msg = sheetFor;
                        setSheetFor(null);
                        if (moreTimer.current) clearTimeout(moreTimer.current);
                        moreTimer.current = setTimeout(() => setMoreFor(msg), 350);
                      }}
                    >
                      <Icon name="Plus" size={18} color="#A1A1AA" />
                    </Pressable>
                  </View>
                )}

                {isMember && (
                  <Pressable
                    style={styles.sheetRow}
                    onPress={() => {
                      setEditing(null);
                      setReplyTo(sheetFor);
                      setSheetFor(null);
                    }}
                  >
                    <Icon name="Reply" size={16} color="#FFFFFF" />
                    <Text style={styles.sheetRowText}>
                      {t("communities.reply", { defaultValue: "Reply" })}
                    </Text>
                  </Pressable>
                )}

                {!sheetIsMine && canTranslateDm(chatBodyText(sheetFor)) && (
                  <Pressable
                    style={styles.sheetRow}
                    onPress={() => {
                      const id = sheetFor.id;
                      const text = chatBodyText(sheetFor);
                      const shown = getDmTranslation(id)?.status === "shown";
                      const at = sheetFor.created_at;
                      setSheetFor(null);
                      if (shown) {
                        void toggleDmTranslation(id, text);
                        return;
                      }
                      // Translate also translates everything other people wrote above it.
                      void translateDmAndAbove(id, text, visibleMessages
                        .filter((m) => m.created_at <= at && (!myAddress || m.wallet_address?.toLowerCase() !== myAddress))
                        .map((m) => ({ id: m.id, content: chatBodyText(m), at: new Date(m.created_at).getTime() })));
                    }}
                  >
                    <Icon
                      name={getDmTranslation(sheetFor.id)?.status === "shown" ? "RotateCcw" : "Languages"}
                      size={16}
                      color="#FFFFFF"
                    />
                    <Text style={styles.sheetRowText}>
                      {getDmTranslation(sheetFor.id)?.status === "shown"
                        ? t("common.showOriginal", { defaultValue: "Show original" })
                        : t("common.translate", { defaultValue: "Translate" })}
                    </Text>
                  </Pressable>
                )}

                {!!sheetFor.content && (
                  <Pressable
                    style={styles.sheetRow}
                    onPress={() => {
                      copyToClipboard(sheetFor.content);
                      setSheetFor(null);
                      toastSuccess(
                        t("communities.chatPanel.copied", { defaultValue: "Message copied" }),
                      );
                    }}
                  >
                    <Icon name="Copy" size={16} color="#FFFFFF" />
                    <Text style={styles.sheetRowText}>
                      {t("communities.chatPanel.copyText", { defaultValue: "Copy text" })}
                    </Text>
                  </Pressable>
                )}

                {sheetCanEdit && (
                  <Pressable
                    style={styles.sheetRow}
                    onPress={() => {
                      setReplyTo.complete(replyTo, null);
                      setEditing(sheetFor);
                      setSheetFor(null);
                    }}
                  >
                    <Icon name="Pencil" size={16} color="#FFFFFF" />
                    <Text style={styles.sheetRowText}>
                      {t("common.edit", { defaultValue: "Edit" })}
                    </Text>
                  </Pressable>
                )}

                {canPin && (
                  <Pressable
                    style={styles.sheetRow}
                    onPress={() => {
                      const next = !sheetFor.pinned_at;
                      void setPinned(sheetFor.id, next);
                      setSheetFor(null);
                    }}
                  >
                    <Icon name="Pin" size={16} color="#FFFFFF" />
                    <Text style={styles.sheetRowText}>
                      {sheetFor.pinned_at
                        ? t("communities.unpin", { defaultValue: "Unpin" })
                        : t("communities.pin", { defaultValue: "Pin" })}
                    </Text>
                  </Pressable>
                )}

                {sheetCanDelete && (
                  <Pressable style={styles.sheetRow} onPress={() => confirmDelete(sheetFor)}>
                    <Icon name="Trash2" size={16} color="#F4F4F5" />
                    <Text style={[styles.sheetRowText, { color: "#F4F4F5" }]}>
                      {t("common.delete", { defaultValue: "Delete" })}
                    </Text>
                  </Pressable>
                )}

                {/* Anyone can report someone else's message (App Review 1.2). */}
                {!sheetIsMine && !!sheetFor.wallet_address && (
                  <Pressable
                    style={styles.sheetRow}
                    onPress={() => {
                      const msg = sheetFor;
                      setSheetFor(null);
                      openMessageReport({
                        userId: msg.wallet_address,
                        userName: msg.display_name || msg.username || undefined,
                        where: `Community chat ${community?.slug ?? ""}`.trim(),
                        messageId: String(msg.id),
                        text: chatBodyText(msg),
                      });
                    }}
                  >
                    <Icon name="Flag" size={16} color="#F4F4F5" />
                    <Text style={[styles.sheetRowText, { color: "#F4F4F5" }]}>
                      {t("postOptions.report", { defaultValue: "Report" })}
                    </Text>
                  </Pressable>
                )}

                <Pressable style={styles.sheetCancel} onPress={() => setSheetFor(null)}>
                  <Text style={styles.sheetCancelText}>
                    {t("common.cancel", { defaultValue: "Cancel" })}
                  </Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <WhenOpened open={!!deleteReq}>
        {() => (
          <DeleteMessageSheet request={deleteReq} onClose={() => setDeleteReq(null)} />
        )}
      </WhenOpened>

      <WhenOpened open={!!moreFor}>
        {() => (
          <EmojiSheet
            visible={!!moreFor}
            onClose={() => setMoreFor(null)}
            selected={
              moreFor && myAddress
                ? Object.entries(moreFor.reactions ?? {})
                    .filter(([, addresses]) => addresses?.some((a) => a.toLowerCase() === myAddress))
                    .map(([emoji]) => emoji)
                : undefined
            }
            onSelect={(emoji) => {
              if (moreFor) handleToggleReaction(moreFor.id, emoji);
            }}
          />
        )}
      </WhenOpened>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  joinLine: { alignSelf: "center", color: "#A1A1AA", fontSize: 12, paddingVertical: 6, paddingHorizontal: 16 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  dim: { color: "#A1A1AA", fontSize: 12, textAlign: "center" },

  // Your own lines sit on a soft tint so they stand out in a busy group.
  // Inset by 6 and padded by 6 so avatars stay in line with everyone else's.
  // hsla() keeps System Light's colour pass off it.
  mineRow: {
    backgroundColor: "hsla(0,0%,100%,0.07)",
    borderRadius: 14,
    marginHorizontal: 6,
    paddingHorizontal: 6,
  },
  mineRowLight: {
    backgroundColor: "hsla(0,0%,0%,0.045)",
    borderRadius: 14,
    marginHorizontal: 6,
    paddingHorizontal: 6,
  },
  flash: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.25)",
  },

  messageImage: {
    width: 180,
    height: 180,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: "rgba(255,255,255,0.04)",
  },

  reactionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  reactionPillMine: {
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  reactionCount: { color: "#A1A1AA", fontSize: 10 },

  pinnedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  pinnedLabel: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  pinnedBody: { color: "#a1a1aa", fontSize: 12 },
  pinnedName: { color: "#e4e4e7", fontWeight: "600" },

  showMore: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 14 },
  jumpWrap: {
    position: "absolute",
    right: 12,
    bottom: 10,
  },
  jumpLatest: {
    position: "absolute",
    right: 12,
    bottom: 10,
    minWidth: 36,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(39,39,42,0.92)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
  },
  jumpLatestText: { color: "#F4F4F5", fontSize: 12, fontWeight: "700" },
  showMoreText: { color: "#A1A1AA", fontSize: 12, fontWeight: "600" },

  contextBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  contextName: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  contextBody: { color: "#A1A1AA", fontSize: 12 },

  slowModeLine: {
    color: "#808089",
    fontSize: 11,
    paddingHorizontal: 14,
    paddingBottom: 4,
  },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  input: {
    flex: 1,
    maxHeight: 96,
    color: "#FFFFFF",
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  mediaBtns: { flexDirection: "row", gap: 6 },
  mediaBtn: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  gifText: { color: "#A1A1AA", fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  sendBtn: {
    minWidth: 36,
    height: 36,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  cooldownText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },

  noticeRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.1)",
  },
  noticeText: { color: "#A1A1AA", fontSize: 12, flexShrink: 1, textAlign: "center" },

  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "rgba(12,12,14,0.96)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 16,
    paddingBottom: 28,
  },
  sheetPreview: {
    color: "#A1A1AA",
    fontSize: 12,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  emojiRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  emojiBtn: {
    width: 40,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  sheetRowText: { color: "#FFFFFF", fontSize: 14, fontWeight: "500" },
  sheetCancel: {
    marginTop: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.1)",
  },
  sheetCancelText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
});
