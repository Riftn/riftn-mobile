import { ReactionArrivalScope } from "../components/ChatReactions/ReactionArrival";
import { usePerfProbe } from "../libs/perfTrace";
import MessageSearch from "../components/DM/MessageSearch";
import { setLockedMediaPayer } from "../libs/dmLocked";
import MessageSurface from "../components/DM/MessageSurface";
import { useTranslation as _useCopy } from 'react-i18next';
import { useDraftState } from "../hooks/useDraftState";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FlatList } from "react-native-gesture-handler";
import {
  Text,
  View,
  TouchableOpacity,
  Platform,
  Keyboard,
  ActivityIndicator,
  Alert,
  TouchableWithoutFeedback,
  BackHandler,
  Pressable,
} from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { setOpenConversation, clearOpenConversation } from "../libs/activeChat";
import Icon from "../components/ui/Icon";

import ScreenHeader, { SCREEN_HEADER_TITLE_FONT_SIZE } from "../components/ScreenHeader";
import CallButton from "../components/Call/CallButton";
import MessageBubble from "../components/DM/MessageBubble";
import ChatInputBar, {
  type ChatMediaAttachment,
} from "../components/DM/ChatInputBar";
import type { SmartReplyTurn } from "../services/ai.service";
import ChatDayPill, { chatDayKey } from "../components/DM/ChatDayPill";
import { UnreadMarker, UnreadJumpButton } from "../components/DM/UnreadJump";
import { findUnreadAnchor, type UnreadAnchor } from "../libs/chatUnreadAnchor";
import { anchorFromReadSpot } from "../libs/chatReadPosition";
import { useChatReadPosition } from "../hooks/useChatReadPosition";
import MessageContextMenu, {
  type MessageLayout,
} from "../components/DM/MessageContextMenu";
import ForwardPickerModal from "../components/DM/ForwardPickerModal";
import MessageSelectBar from "../components/DM/MessageSelectBar";
import DeleteMessageSheet, { resolveDelete, type DeleteRequest } from "../components/DM/DeleteMessageSheet";
import { BulkTick, CHECKED_FILL } from "../components/DM/BulkChatBar";
import { copyToClipboard } from "../libs/clipboard.utils";
import DmFeeBanner from "../components/DM/DmFeeBanner";
import DmEncryptionBanner from "../components/DM/DmEncryptionBanner";
import DmSafetyBanner from "../components/DM/DmSafetyBanner";
import MessageRequestBar from "../components/DM/MessageRequestBar";
import { collapsedUnreadableRows } from "../libs/dm-e2ee/collapsed-unreadable";
import { DmUndecryptableRun } from "../components/DM/DmLockedState";
import { useChatPrefs } from "../hooks/useChatPrefs";
import NewChatIntro from "../components/DM/NewChatIntro";
import TipAmountSheet from "../components/DM/TipAmountSheet";
import PollCard from "../components/DM/PollCard";
import CreatePollSheet from "../components/DM/CreatePollSheet";
import NotesSheet from "../components/DM/NotesSheet";
import { ScreenNames } from "../navigation/ScreenNames";
import { ScheduledMessagesSheet, ScheduledStrip, scheduledDmKey, useScheduledDms, useWhenLabel } from "../components/DM/ScheduledMessages";
import ScheduleSheet from "../components/Upload/ScheduleSheet";
import { scheduleDm } from "../services/dm/dm.scheduled";
import { useQueryClient } from "@tanstack/react-query";
import FullScreenVideoPlayer from "../components/common/FullScreenVideoPlayer";
import type { DmVideoPlayExtra } from "../components/DM/MessageBubble";
import { haptic } from "../libs/haptics";
import { useVoiceRecorder, VoiceNoteRecordingOverlay } from "../components/Comments/VoiceNoteRecorder";
import type { VoiceNoteResult } from "../components/Comments/VoiceNoteRecorder";
import Avatar from "../components/common/Avatar";
import { MomentAvatarOutline, useFaceMoment, useOpenMoments } from "../components/Stories/MomentPeek";
import OnlineDot from "../components/common/OnlineDot";
import { useIsOnline } from "../libs/online-presence";
import { getShowLastSeen, lastSeenWhen, useLastSeen } from "../libs/last-seen";
import ChatHeaderMenuButton from "../components/Chat/ChatHeaderMenuButton";
import AssistantDmButtons from "../components/DM/AssistantDmButtons";
import { isAssistantAddress } from "../libs/assistant";
import ChatMenu from "../components/Chat/ChatMenu";
import WhenOpened from "../components/ui/WhenOpened";
import { translateDmAndAbove } from "../libs/dm-translation-store";
import ConfirmBlockModal from "../components/common/ConfirmBlockModal";
import PinnedMessageBanner from "../components/DM/PinnedMessageBanner";

import { useUser, useAuthState, useAuthActions, useProvider } from "../context/AuthContext";
import { useTranslation } from "react-i18next";
import { useBannedAccount } from "../hooks/useBannedAccount";
import type { User } from "../context/AuthContext";
import { useWebSocketApi } from "../context/WebSocketContext";
import { useGateToHome } from "../hooks/useGateToHome";
import { useUserProfileSheet } from "../context/UserProfileSheetContext";
import {
  useWeb3Provider,
  useERC20Contract,
  useStreamControllerContract,
} from "../hooks/use-web3";
import { writeContractAA } from "../libs/aa.write";
import * as ethersImport from "ethers";
import { supportedTokens } from "../config/constants";
import { DIGITAL_PURCHASES_ENABLED } from "../config/storefront";
import { openMessageReport } from "../components/common/MessageReportHost";
import { STREAM_CONTROLLER_CONTRACT_ADDRESSES } from "../config/web3.constants";

import { DMSocketEvent } from "../services/enums/dm-socket-events.enum";
import type {
  DmMessage,
  DmConversation,
  DmUser,
  DmFee,
  ID,
  OptimisticMessage,
  EditMessageResponse,
  ReactionUpdatedPayload,
  DeleteMessageResponse,
  ReadReceiptResponse,
  DownloadReceiptResponse,
  FeeConfirmedPayload,
} from "../services/dm/dm.types";
import {
  getMessages,
  getDmUserStatus,
  getDmPlanSettings,
  addFreeAccess,
  removeFreeAccess,
  bulkDeleteMessages,
  markDmMessageViewed,
  acceptMessageRequest,
  deleteConversation,
  type DmUserStatus,
  type DmPlanSettings,
  type DmPlanMessageType,
} from "../services/dm/dm.api";
import {
  dmActions,
  dmState,
  useDmMessages,
  useDmContacts,
  useOptimisticMessages,
  getPeerPolicy,
} from "../store/dm.store";
import { dmSendQueue } from "../services/dm/dm.send";
import { isPrivatePhoto } from "../libs/dm-destruct";
import { ensureDmEncryption, retryDmEncryption, type DmEncryptionStatus } from "../libs/dm-e2ee/setup";
import { decryptIncoming } from "../libs/dm-e2ee/peer";
import { onIdentityChange, prepareOutgoing } from "../libs/dm-e2ee/keys";
import { languageName, peerLanguage, translateOutgoing } from "../libs/dm-translate-out";
import { ensureAiConsent, hasAiConsent } from "../libs/ai-consent";
import { getUserLanguage } from "../services/translation.service";
import { getAccount, isFollowing as checkIsFollowing } from "../services/user.service";
import { localTimeLine, useProfileLocalTime } from "../hooks/useProfileLocalTime";
import { blockUser, unblockUser } from "../services/block.service";
import { truncateAddress } from "../libs/strings.util";
import { dmDraftKey } from "../libs/draft-cache";
import { getAvatarUrl, getBadgeUrlFor, getBadgeHoverOpticalStyle } from "../libs/misc";
import BadgeArtwork from "../components/common/BadgeArtwork";
import { toastError, toastInfo, toastSuccess, toastWarning } from "../libs/toast";
import { useComposerKeyboard } from "../hooks/useComposerKeyboard";
import { createLogger } from "../libs/logger";
import { useDmPin } from "../hooks/useDmPin";
import { useCallActions } from "../context/CallContext";
import { useDmHeadRecovery } from "../hooks/useDmHeadRecovery";
import { dismissReadMessageNotifications } from "../services/push/push.service";
import { clearPendingChatLink, copyChatMessageLink, peekPendingChatLink, toastNotInLinkedChat, useLinkedMessage } from "../libs/chatMessageLink";
import EmojiSheet from "../components/Upload/EmojiSheet";
import CommentLikersSheet from "../components/Comments/CommentLikersSheet";

/** Safely extract a plain string ID from either a raw string or a populated Mongoose document. */
function resolveConvId(...vals: unknown[]): string {
  for (const v of vals) {
    if (!v) continue;
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && (v as any)._id) return String((v as any)._id);
  }
  return '';
}

export type ChatScreenProps = {
  route: {
    params?: {
      conversationId?: ID;
      targetAddress?: string;
      targetUser?: Partial<User>;
      title?: string;
      /** Pre-filled text for the message input (e.g. shared post URL) */
      sharedText?: string;
      /** Sent on open, once — the Builder lander's request to @assistant. */
      autoSendText?: string;
      /** Opened from the New message drawer: the message box takes the caret at once. */
      focusComposer?: boolean;
    };
  };
};


const PAGE_SIZE = 30;
/** History pages a chat may pull in at open to reach where you left off. */
const MAX_READ_SPOT_PAGES = 10;
/** How long an edit may go unacknowledged before the old words are put back. */
const EDIT_CONFIRM_TIMEOUT_MS = 10_000;
const log = createLogger("ChatScreen");


const ChatScreen: React.FC<ChatScreenProps> = ({ route }) => {
  usePerfProbe("ChatScreen");
  const { t: _copy } = _useCopy();
  const navigation = useNavigation<any>();
  const user = useUser();
  const { isSignedIn, needsUsername } = useAuthState();
  const { t, i18n } = useTranslation();
  // A banned account keeps every conversation it has and can send into none.
  const { isBanned: accountBanned } = useBannedAccount();
  const { patchUser } = useAuthActions();
  // The session's own provider, not useWeb3Provider's read client below: on a
  // returning session this is the locked shim, and it is the only thing that
  // can open the wallet for the encryption signature.
  const { provider: sessionProvider } = useProvider();
  const allow = isSignedIn && !needsUsername;
  useGateToHome(allow);

  const ws = useWebSocketApi();
  const { showUserProfile } = useUserProfileSheet();

  const { provider, account, chainId } = useWeb3Provider();
  const ethers = useMemo(() => (ethersImport as any).ethers || ethersImport, []);
  const tokenMeta = useMemo(
    () => chainId ? supportedTokens.find((t) => t.chainId === chainId && t.symbol === "DHB") : undefined,
    [chainId],
  );
  const tokenAddress = tokenMeta?.address;
  const controllerAddress = useMemo(
    () => (chainId ? (STREAM_CONTROLLER_CONTRACT_ADDRESSES as Record<number, string>)[chainId] : undefined),
    [chainId],
  );
  const tokenContract = useERC20Contract(tokenAddress);
  const controllerContract = useStreamControllerContract();

  // Edge-to-edge Android does not shrink the window for the keyboard, so the
  // composer lifts itself: measured against the keyboard's top rather than
  // worked out from its height and the insets, which left it under the keys
  // on some phones.
  const composerKeyboard = useComposerKeyboard(0, { gap: 0 });
  const inputLift = composerKeyboard.lift;
  const [inputBarHeight, setInputBarHeight] = useState(60);
  const listBottomPadding = inputBarHeight + inputLift;

  const convId = route?.params?.conversationId as ID | undefined;
  const targetAddress = route?.params?.targetAddress;

  const address = useMemo(
    () => ((user as any)?.walletAddress || (user as any)?.address || "").toLowerCase(),
    [user],
  );
  const userId = ((user as any)?._id || (user as any)?.id) as string | undefined;
  const { setCallMessageHandler } = useCallActions();

  const storeMessages = useDmMessages(convId || "");
  const conversations = useDmContacts();

  const [target, setTarget] = useState<(Partial<User> & { _id?: string }) | null>(
    (route?.params?.targetUser as any) || null,
  );
  const [dmDisabledRaw, setDmDisabled] = useState(false);
  const [dmReasonRaw, setDmReason] = useState<string | null>(null);

  // Rules the peer attached to DMs through their subscription plan. A plan
  // that has DMs switched off closes the thread; otherwise it can narrow which
  // kinds of message go through and set a floor on tips.
  const [planRules, setPlanRules] = useState<DmPlanSettings | null>(null);
  const peerPlanId = (target as any)?.dmPlanId as string | undefined;
  useEffect(() => {
    if (!peerPlanId) {
      setPlanRules(null);
      return;
    }
    let cancelled = false;
    getDmPlanSettings(peerPlanId).then((rules) => {
      if (!cancelled) setPlanRules(rules);
    });
    return () => { cancelled = true; };
  }, [peerPlanId]);
  const planGated = !!planRules && !planRules.enabled;
  const dmDisabled = dmDisabledRaw || planGated;
  const dmReason = dmDisabledRaw
    ? dmReasonRaw
    : planGated
      ? t("dm.planRestricted")
      : dmReasonRaw;
  const planMinTip = planRules?.minTipDhb ?? 0;

  /** True (and says why) when the peer's plan does not take this kind of message. */
  const planBlocks = useCallback(
    (kind: DmPlanMessageType, tip: number = 0): boolean => {
      const allowed = planRules?.allowedMessageTypes;
      if (allowed && allowed.length > 0) {
        if (!allowed.includes(kind) || (tip > 0 && !allowed.includes("tip"))) {
          toastWarning(t("dm.planTypeNotAllowed"));
          return true;
        }
      }
      if (tip > 0 && planMinTip > 0 && tip < planMinTip) {
        toastWarning(t("dm.planMinTip", { amount: planMinTip.toLocaleString() }));
        return true;
      }
      return false;
    },
    [planRules, planMinTip, t],
  );
  const [dmFee, setDmFee] = useState<DmFee | null>(null);
  const storefrontFeeBlocked = !DIGITAL_PURCHASES_ENABLED && !!dmFee?.required && !dmFee?.hasFreeAccess && dmFee.fee > 0;
  const [creating, setCreating] = useState(false);
  const createdConvIdRef = useRef<ID | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);
  // The fresh newest page has landed (the store can hold an older cached copy).
  const [headLoaded, setHeadLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [remoteTyping, setRemoteTyping] = useState(false);

  // Picking several messages: hold one, Select, then tap others. null = not picking.
  const [pickedMsgs, setPickedMsgs] = useState<Set<string> | null>(null);
  // Several messages forwarded at once from the Select bar.
  const [bulkForward, setBulkForward] = useState<DmMessage[] | null>(null);

  // Context menu
  const [contextMessage, setContextMessage] = useState<DmMessage | null>(null);
  const liftedId = contextMessage?._id;
  const [contextLayout, setContextLayout] = useState<MessageLayout | null>(null);
  const [contextIsMine, setContextIsMine] = useState(false);

  // Reply / edit
  const [editingMessage, setEditingMessage] = useState<DmMessage | null>(null);

  /*
   * An edit is a fire-and-forget socket emit with an optimistic patch painted
   * in front of it, so one the server never accepted looked exactly like one it
   * saved — right up until the thread was reopened and the old words came back.
   * Each edit parks a timer here until the server echoes it back. An edit that
   * goes unacknowledged puts the old words back on screen and says so, rather
   * than leaving a change that only exists on this phone.
   */
  const pendingEditsRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; resolve: (sent: boolean) => void }>>(
    new Map(),
  );

  const settlePendingEdit = useCallback((messageId: string, sent = true) => {
    const pending = pendingEditsRef.current.get(messageId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(sent);
    pendingEditsRef.current.delete(messageId);
  }, []);

  useEffect(() => {
    const pending = pendingEditsRef.current;
    return () => {
      pending.forEach(({ timer, resolve }) => { clearTimeout(timer); resolve(false); });
      pending.clear();
    };
  }, []);

  // Forward
  const [forwardVisible, setForwardVisible] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<DmMessage | null>(null);

  // Menu / block
  const [menuVisible, setMenuVisible] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"block" | "unblock">("block");
  const [blockLoading, setBlockLoading] = useState(false);

  // Video
  const [videoPlay, setVideoPlay] = useState<({ uri: string } & DmVideoPlayExtra) | null>(null);
  const openVideo = useCallback((uri: string, extra?: DmVideoPlayExtra) => setVideoPlay({ uri, ...extra }), []);
  const closeVideo = useCallback(() => {
    // A view-once video is gone for both people once the other side has opened it.
    if (videoPlay?.viewOnce && videoPlay.messageId) {
      void markDmMessageViewed(videoPlay.messageId).catch(() => undefined);
    }
    setVideoPlay(null);
  }, [videoPlay]);

  // Tip
  const [tipAmount, setTipAmount] = useState(0);
  const [tipSheetVisible, setTipSheetVisible] = useState(false);

  // Poll
  const [pollSheetVisible, setPollSheetVisible] = useState(false);
  const [notesVisible, setNotesVisible] = useState(false);

  // Sending state — true while any job in the queue targets this conversation
  // (We keep this simple: the queue processes serially, so any active job = sending)
  const sending = false; // Queue handles async; no component-level sending state needed

  // Peer DM status (fetched for new chats to show intro)
  const [peerDmStatus, setPeerDmStatus] = useState<DmUserStatus | null>(null);

  // Current user's own DM status (for creator features like free access)
  const [myDmStatus, setMyDmStatus] = useState<DmUserStatus | null>(null);

  // Scroll
  const listRef = useRef<FlatList<DmMessage> | null>(null);
  const isAtBottomRef = useRef(true);
  const [showJumpBtn, setShowJumpBtn] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);


  const currentConvId = convId || createdConvIdRef.current;
  // A push for this chat stays quiet while it is on screen (push.service).
  useFocusEffect(
    useCallback(() => {
      if (!currentConvId) return;
      const id = String(currentConvId);
      setOpenConversation(id);
      return () => clearOpenConversation(id);
    }, [currentConvId]),
  );

  const currentConversation = useMemo(
    () => conversations.find((c) => c._id === currentConvId) ?? null,
    [conversations, currentConvId],
  );

  // Message pinning
  const { pinnedMessageId, pinMessage, unpinMessage } = useDmPin(
    currentConvId || undefined,
    address || undefined,
    currentConversation,
  );

  const handlePinMessage = useCallback(() => {
    if (contextMessage) pinMessage(contextMessage._id);
  }, [contextMessage, pinMessage]);

  const handleUnpinMessage = useCallback(() => {
    unpinMessage();
  }, [unpinMessage]);

  // DHB balance for display & validation in fee / tip UI
  const dhbBalance = useMemo(
    () => (user as any)?.tokenBalances?.DHB ?? null,
    [user],
  );

  // Optimistic messages (global store — survives navigation)
  const optimisticMsgs = useOptimisticMessages(currentConvId || "temp");

  const peer = useMemo(() => {
    const addr = (
      targetAddress ||
      (target as any)?.address ||
      (target as any)?.walletAddress ||
      ""
    ).toLowerCase();
    const displayName =
      (target as any)?.displayName || undefined;
    const username =
      (target as any)?.username || undefined;
    const avatarRaw = (target as any)?.avatarImageUrl || undefined;
    if (!currentConvId) return { address: addr, displayName, username, avatarImageUrl: avatarRaw, badgeImg: (target as any)?.hideBadgeAndBalance ? undefined : getBadgeUrlFor(target as any) };
    const c = conversations.find((x) => x._id === currentConvId);
    const other = c?.participants?.find(
      (p) =>
        p.participant &&
        String(p.participant._id) !== String(userId) &&
        String(p.participant.address || "").toLowerCase() !== address,
    )?.participant;
    return {
      address: String(other?.address || addr || ""),
      displayName: String(other?.displayName || displayName || ""),
      username: String(other?.username || username || ""),
      avatarImageUrl: other?.avatarImageUrl || avatarRaw,
      badgeImg: ((other as any) ?? (target as any))?.hideBadgeAndBalance ? undefined : getBadgeUrlFor((other as any) ?? (target as any)),
    };
  }, [currentConvId, conversations, target, targetAddress, userId, address]);

  const peerLocalTime = useProfileLocalTime(
    target?.address?.toLowerCase() === peer.address?.toLowerCase() ? target?.customs?.publicTimeZone : undefined,
  );
  // "Last seen 5 min ago", only for someone who opted in (libs/last-seen),
  // and not while their online dot is showing.
  const peerCustoms = useMemo(() => {
    if (target?.address?.toLowerCase() !== peer.address?.toLowerCase()) return null;
    const raw = (target as any)?.customs;
    if (typeof raw !== "string") return raw ?? null;
    try { return JSON.parse(raw); } catch { return null; }
  }, [target, peer.address]);
  const peerLastSeenOptIn = getShowLastSeen(peerCustoms);
  const peerOnline = useIsOnline(peer.address, peerLastSeenOptIn);
  const peerSeenAt = useLastSeen(peer.address, peerLastSeenOptIn);
  const [seenTick, setSeenTick] = useState(Date.now);
  useEffect(() => {
    if (!peerSeenAt) return;
    const timer = setInterval(() => setSeenTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [peerSeenAt]);
  const peerSeenWhen = peerSeenAt ? lastSeenWhen(peerSeenAt, i18n.language, seenTick) : null;
  const peerLastSeen = !peerLastSeenOptIn || !peerSeenAt || peerOnline
    ? ""
    : peerSeenWhen
    ? t("profile.lastSeen", { defaultValue: "Last seen {{when}}", when: peerSeenWhen })
    : t("profile.lastSeenJustNow", { defaultValue: "Last seen just now" });
  const peerSubtitle = [
    peer.username ? `@${peer.username}` : "",
    peerLastSeen,
    localTimeLine(t as never, peerLocalTime, target?.customs?.publicTimeZone),
  ].filter(Boolean).join(" · ");
  const peerLabel = useMemo(
    () => peer.displayName || peer.username || truncateAddress(peer.address) || t("copy.04f8996da763", { defaultValue: "user" }),
    [peer, t],
  );

  /*
   * Where this thread's unsent text is kept. Keyed on the peer, not on
   * currentConvId, which does not exist at all until createAndStart answers —
   * that is precisely the moment you are most likely to be mid-sentence,
   * writing to someone for the first time.
   */
  const draftKey = useMemo(
    () => dmDraftKey(user?.walletAddress || user?.address, peer.address),
    [user?.walletAddress, user?.address, peer.address],
  );
  const [replyTo, setReplyTo] = useDraftState<DmMessage | null>(draftKey ? `${draftKey}:reply` : null, null);

  // ── Scheduled messages ────────────────────────────────────────────────
  // Chats that already exist and are free to message. A paid chat needs its
  // fee paid at the moment of sending, which a later send cannot do.
  const scheduleQueryClient = useQueryClient();
  const feeGated = !!dmFee?.required && !dmFee?.hasFreeAccess;
  const canSchedule = !!currentConvId && !feeGated && !accountBanned && !dmDisabled;
  const scheduled = useScheduledDms(canSchedule ? currentConvId : null, peer.address);
  const whenLabel = useWhenLabel();
  const [scheduledVisible, setScheduledVisible] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<{ text: string; clear: () => void } | null>(null);
  const handleSchedulePress = useCallback(({ text, hasAttachment, clear }: { text: string; hasAttachment: boolean; clear: () => void }) => {
    Keyboard.dismiss();
    if (hasAttachment) {
      toastInfo(t("dmSchedule.textOnly", { defaultValue: "Only text messages can be scheduled for now." }));
      return;
    }
    // Nothing typed: the clock shows what is already waiting.
    if (!text) { setScheduledVisible(true); return; }
    setScheduleDraft({ text, clear });
  }, [t]);
  const confirmSchedule = async (date: Date | null) => {
    const draft = scheduleDraft;
    if (!date || !draft || !currentConvId) return;
    try {
      // Sealed for this chat now, the same as a message sent by hand.
      const wire = await prepareOutgoing(peer.address, draft.text);
      await scheduleDm({ dmId: currentConvId, content: wire.content, sendAt: date, replyTo: replyTo?._id });
      draft.clear();
      if (replyTo) setReplyTo.complete(replyTo, null);
      void scheduleQueryClient.invalidateQueries({ queryKey: scheduledDmKey(currentConvId) });
      toastSuccess(t("dmSchedule.scheduledToast", { defaultValue: "Scheduled for {{when}}", when: whenLabel(date) }));
    } catch (e: any) {
      toastError(e?.message || t("dmSchedule.error", { defaultValue: "That did not work. Try again." }));
    }
  };

  // "When they're next online": sent now as a normal line (one tick and an
  // hourglass for the sender), held by the server until they next open the
  // app or site. Same rules as scheduling: free one-to-one text.
  const sendWhenOnline = () => {
    const draft = scheduleDraft;
    if (!draft || !currentConvId) return;
    draft.clear();
    dmSendQueue.sendText({
      conversationId: currentConvId,
      userId: userId || "me",
      address,
      content: draft.text,
      replyTo,
      whenOnline: true,
    });
    if (replyTo) setReplyTo.complete(replyTo, null);
    scrollToBottom();
  };

  const iBlockedThem = useMemo(() => !!(target as any)?.youBlocked, [target]);

  const title =
    route?.params?.title ||
    peer.displayName ||
    peer.username ||
    (peer.address ? truncateAddress(peer.address) : t("copy.460b3a7da007", { defaultValue: "Chat" }));

  // Build the combined list: optimistic + store (newest first for inverted FlatList)
  const messageList = useMemo(() => {
    const base = [...storeMessages].reverse(); // store is asc → flip to desc
    // The queue removes the exact pending entry after persistence. Matching
    // text here hides a repeated reply (including a failed one) behind an
    // earlier message with the same words.
    const stillPending = optimisticMsgs.filter(p => !base.some(m => m._id === p._tempId || m._clientKey === p._tempId));
    // The socket can deliver our own saved copy a moment before the send
    // queue swaps it in under the pending line's key. Hide that early copy
    // while its pending line is still on screen, so the line is never doubled
    // and never re-mounted: the queue then hands it the same key.
    const claimed = new Set<string>();
    const sending = stillPending.filter(p => p.uploadStatus !== "failed");
    const shown = sending.length
      ? base.filter(m => {
          if (m._clientKey || m.author !== "me") return true;
          const twin = sending.find(p =>
            !claimed.has(p._tempId) &&
            (p.msgType || "msg") === (m.msgType || "msg") &&
            (p.content || "") === (m.content || ""));
          if (!twin) return true;
          claimed.add(twin._tempId);
          return false;
        })
      : base;
    return [...(stillPending as DmMessage[]), ...shown];
  }, [storeMessages, optimisticMsgs]);

  // Depends on messageList — must be declared after it
  const pinnedMessage = useMemo(
    () => (pinnedMessageId ? messageList.find((m) => m._id === pinnedMessageId) ?? null : null),
    [pinnedMessageId, messageList],
  );

  const isMine = useCallback(
    (msg: DmMessage): boolean => {
      if (msg.author === "me") return true;
      if (msg.author === "other") return false;
      const senderId =
        typeof msg.sender === "object" ? msg.sender?._id : msg.sender;
      if (userId && String(senderId) === String(userId)) return true;
      const senderAddr =
        typeof msg.sender === "object"
          ? (msg.sender?.address || "").toLowerCase()
          : "";
      if (address && senderAddr === address) return true;
      return false;
    },
    [userId, address],
  );

  // "Unread messages" marker. The store marks lines read as soon as they
  // land, so the count is taken on the first render, before the read effect
  // below zeroes the conversation's badge. See libs/chatUnreadAnchor.
  const openedAtRef = useRef(Date.now());
  const unreadAtOpenRef = useRef(0);
  const unreadSnapTakenRef = useRef(false);
  if (!unreadSnapTakenRef.current) {
    const fromConversation = Number(currentConversation?.unreadCount ?? 0) || 0;
    const fromFlags = storeMessages.filter((m) => !isMine(m) && m.isRead === false).length;
    unreadAtOpenRef.current = Math.max(unreadAtOpenRef.current, fromConversation, fromFlags);
    if (currentConversation || storeMessages.length > 0) unreadSnapTakenRef.current = true;
  }
  const flagAnchor = useMemo(
    () => findUnreadAnchor(
      messageList.map((m) => ({
        id: m._id,
        mine: isMine(m),
        createdAt: m.createdAt,
        skip: !!m.undecryptable || String(m._id).startsWith("temp"),
      })),
      unreadAtOpenRef.current,
      openedAtRef.current,
    ),
    [messageList, isMine],
  );
  // Where you left off, saved on the server (same spot as the website). With
  // a spot the chat opens on the line after it; without one it falls back to
  // the read-flag guess above.
  const readChatId = currentConvId && /^[0-9a-f]{24}$/i.test(String(currentConvId)) ? String(currentConvId) : null;
  const readSpot = useChatReadPosition(readChatId);
  const [spotAnchor, setSpotAnchor] = useState<{ anchor: UnreadAnchor | null } | null>(null);
  const unreadAnchor = readSpot.opening ? (spotAnchor?.anchor ?? null) : (readSpot.ready ? flagAnchor : null);
  // Saving starts once the chat has been placed, so the bottom it paints
  // first never counts as having read everything.
  const readTrackingRef = useRef(false);

  /**
   * Tail of the thread handed to the reply drafter, oldest first. Text only —
   * an image or voice note carries nothing the model can reply to.
   *
   * messageList is newest-first for the inverted FlatList, so this takes the
   * head and flips it; slicing the tail would hand over the OLDEST twelve
   * messages in the conversation.
   */
  const smartReplyThread = useMemo<SmartReplyTurn[]>(
    () =>
      messageList
        .filter((m) => (m.msgType ?? "msg") === "msg" && !!m.content?.trim())
        .slice(0, 12)
        .reverse()
        .map((m) => {
          const mine = isMine(m);
          return {
            from: mine ? ("me" as const) : ("them" as const),
            name: mine ? undefined : peerLabel,
            text: m.content!.trim(),
          };
        }),
    [messageList, isMine, peerLabel],
  );


  // Where the list sits and how tall it is, for a smooth trip to the bottom.
  const scrollYRef = useRef(0);
  const viewportHRef = useRef(0);
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      try {
        // From far up an animated scroll crawls through unmeasured rows and
        // stutters: hop to just over a screen above the end, then glide.
        const lead = Math.round((viewportHRef.current || 700) * 1.25);
        if (scrollYRef.current > lead) {
          listRef.current?.scrollToOffset({ offset: lead, animated: false });
          requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
        } else {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }
      } catch {}
    });
  }, []);

  const onScroll = useCallback((e: any) => {
    const { contentOffset, layoutMeasurement } = e.nativeEvent || {};
    scrollYRef.current = contentOffset?.y || 0;
    if (layoutMeasurement?.height) viewportHRef.current = layoutMeasurement.height;
    const atBottom = (contentOffset?.y || 0) <= 40;
    isAtBottomRef.current = atBottom;
    setShowJumpBtn(!atBottom);
  }, []);

  const scrollRetryRef = useRef(0);
  const scrollViewPositionRef = useRef(0.3);
  const highlightAndScroll = useCallback(
    (messageId: string) => {
      const idx = messageList.findIndex((m) => m._id === messageId);
      if (idx < 0) return;
      setHighlightedId(null);
      scrollRetryRef.current = 0;
      scrollViewPositionRef.current = 0.3;
      try {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
      } catch {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      }
      setTimeout(() => {
        setHighlightedId(messageId);
        setTimeout(() => setHighlightedId(null), 4000);
      }, 300);
    },
    [messageList],
  );

  // The target of a pinned banner or quoted reply can sit far beyond the
  // cells the list has measured (the store keeps the whole thread). Without
  // this handler scrollToIndex throws RN's invariant, which is fatal from an
  // event handler. Jump near the estimated offset, then retry once measured.
  const onScrollToIndexFailed = useCallback(
    (info: { index: number; averageItemLength: number }) => {
      listRef.current?.scrollToOffset({
        offset: info.averageItemLength * info.index,
        animated: false,
      });
      if (scrollRetryRef.current >= 3) return;
      scrollRetryRef.current += 1;
      setTimeout(() => {
        try {
          listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: scrollViewPositionRef.current });
        } catch {}
      }, 250);
    },
    [],
  );

  // Jump capsule state: unread lines below the screen, and whether the marker
  // is still above it. Driven by which rows are on screen (list is inverted:
  // index 0 is the newest line at the bottom).
  const [unreadBelow, setUnreadBelow] = useState(0);
  // Lines from other people that landed below the screen after you last sat
  // at the bottom: with the unread ones above, the number on the scroll-down
  // button. Lines you already read never count, however far up you scroll.
  const [newBelow, setNewBelow] = useState(0);
  const seenUpToRef = useRef(openedAtRef.current);
  // Once you've been at the newest line, the lines that were unread when you
  // opened the chat have been read: scrolling back up never counts them again.
  const reachedBottomRef = useRef(false);
  const isMineRef = useRef(isMine);
  isMineRef.current = isMine;
  const refreshNewBelow = useCallback(() => {
    const list = unreadStateRef.current.list;
    const range = visibleRangeRef.current;
    if (!range) return;
    const at = (m: any) => new Date(m?.createdAt || 0).getTime() || 0;
    if (range.min === 0 && list[0]) {
      seenUpToRef.current = Math.max(seenUpToRef.current, at(list[0]));
      // Not the first paint at the bottom before the chat jumps to its marker.
      if (readTrackingRef.current || !unreadStateRef.current.anchor) reachedBottomRef.current = true;
    }
    let n = 0;
    for (let i = 0; i < range.min && i < list.length; i++) {
      const m = list[i];
      if (!m || isMineRef.current(m) || String(m._id).startsWith("temp")) continue;
      if (at(m) > seenUpToRef.current) n++;
    }
    setNewBelow(n);
  }, []);
  const [unreadMarkerAbove, setUnreadMarkerAbove] = useState(false);
  const [unreadMarkerSeen, setUnreadMarkerSeen] = useState(false);
  const visibleRangeRef = useRef<{ min: number; max: number } | null>(null);
  const unreadStateRef = useRef({ anchor: unreadAnchor, list: messageList });
  unreadStateRef.current = { anchor: unreadAnchor, list: messageList };
  const refreshUnreadJump = useCallback(() => {
    const { anchor, list } = unreadStateRef.current;
    const range = visibleRangeRef.current;
    if (!anchor || !range) {
      setUnreadBelow(0);
      setUnreadMarkerAbove(false);
      return;
    }
    let below = 0;
    for (const id of anchor.ids) {
      const i = list.findIndex((m) => m._id === id);
      if (i >= 0 && i < range.min) below++;
    }
    setUnreadBelow(below);
    const anchorIndex = list.findIndex((m) => m._id === anchor.id);
    setUnreadMarkerAbove(anchorIndex > range.max);
    if (anchorIndex >= range.min && anchorIndex <= range.max) setUnreadMarkerSeen(true);
  }, []);
  useEffect(() => { refreshUnreadJump(); }, [unreadAnchor, refreshUnreadJump]);
  useEffect(() => { refreshNewBelow(); }, [messageList, refreshNewBelow]);
  /** Saves the newest line on screen (lowest index on the inverted list) as where you left off. */
  const reportReadSpotRef = useRef(() => {});
  reportReadSpotRef.current = () => {
    const range = visibleRangeRef.current;
    if (!range || !readTrackingRef.current) return;
    const list = unreadStateRef.current.list;
    for (let i = range.min; i <= range.max; i++) {
      const m = list[i];
      if (!m || String(m._id).startsWith("temp") || !m.createdAt) continue;
      readSpot.report(String(m._id), String(m.createdAt));
      return;
    }
  };
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
    const idx = viewableItems.map((v) => v.index).filter((i): i is number => typeof i === "number");
    visibleRangeRef.current = idx.length ? { min: Math.min(...idx), max: Math.max(...idx) } : null;
    // Inverted list: index 0 is the newest line, so everything under the
    // lowest visible index is below the screen.
    refreshNewBelow();
    refreshUnreadJump();
    reportReadSpotRef.current();
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current;

  const scrollToUnreadMarker = useCallback((animated = true) => {
    const anchor = unreadStateRef.current.anchor;
    if (!anchor) return;
    const index = unreadStateRef.current.list.findIndex((m) => m._id === anchor.id);
    if (index < 0) return;
    scrollRetryRef.current = 0;
    // viewPosition 1 on an inverted list puts the row (marker on top of it)
    // at the top of the screen; few enough unread to fit and it clamps to
    // the newest line.
    scrollViewPositionRef.current = 0.98;
    isAtBottomRef.current = false;
    try {
      listRef.current?.scrollToIndex({ index, animated, viewPosition: 0.98 });
    } catch {}
    setUnreadMarkerSeen(true);
  }, []);

  // Open on the marker once the thread has loaded.
  const unreadPlacedRef = useRef(false);
  useEffect(() => {
    if (unreadPlacedRef.current || !unreadAnchor || initialLoading) return;
    // Placed inside the timer: a head refresh starting in between cancels it
    // and the effect runs again once the fresh page is in.
    const timer = setTimeout(() => {
      unreadPlacedRef.current = true;
      scrollToUnreadMarker(false);
      // Let the jump settle before the rows on screen count as read.
      setTimeout(() => { readTrackingRef.current = true; reportReadSpotRef.current(); }, 600);
    }, 150);
    return () => clearTimeout(timer);
  }, [unreadAnchor, initialLoading, scrollToUnreadMarker]);

  // Depends on highlightAndScroll — must be declared after it
  const scrollToPinnedMessage = useCallback(() => {
    if (pinnedMessage) {
      highlightAndScroll(pinnedMessage._id);
    }
  }, [pinnedMessage, highlightAndScroll]);

  const handleReplyPress = useCallback(
    (messageId: string) => {
      highlightAndScroll(messageId);
    },
    [highlightAndScroll],
  );

  // A copied message link to this chat: read back until the line is held,
  // then scroll to it and light it up.
  const linkStateRef = useRef({ messageList, hasMore, loadingMore, loadMore: async () => {}, highlightAndScroll });
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const linkKey = convId ? `dm:${convId}` : null;
  useLinkedMessage(
    linkKey,
    !initialLoading && messageList.length > 0,
    async (id) => {
      for (let round = 0; round < 25; round += 1) {
        const state = linkStateRef.current;
        if (state.messageList.some((m) => m._id === id)) {
          setTimeout(() => linkStateRef.current.highlightAndScroll(id), 350);
          return true;
        }
        if (!state.hasMore) return false;
        if (!state.loadingMore) await state.loadMore();
        await new Promise((r) => setTimeout(r, 150));
      }
      return false;
    },
  );
  // Someone who is not in the chat has no messages and no contact for it.
  useEffect(() => {
    if (!linkKey || !peekPendingChatLink(linkKey)) return;
    const timer = setTimeout(() => {
      const link = peekPendingChatLink(linkKey);
      if (!link) return;
      if (linkStateRef.current.messageList.length || conversationsRef.current.some((c) => c._id === convId)) return;
      clearPendingChatLink(link.nonce);
      toastNotInLinkedChat();
      if (navigation.canGoBack()) navigation.goBack();
    }, 6000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey]);

  const onContentSizeChange = useCallback(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [scrollToBottom]);


  useEffect(() => {
    const show = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hide = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onKb = () => {
      if (isAtBottomRef.current) scrollToBottom();
    };
    const s1 = Keyboard.addListener(show as any, onKb);
    const s2 = Keyboard.addListener(hide as any, onKb);
    return () => {
      s1.remove();
      s2.remove();
    };
  }, [scrollToBottom]);

  // Encryption identity: opening a chat only loads a key already in the
  // keychain. Making one takes a signature (the unlock sheet on a locked
  // wallet), so that waits for the Unlock button rather than popping up the
  // moment the chat opens.
  //
  // Waits for the provider. Without one there is nothing to sign with, and the
  // whole feature used to fail exactly here — every returning session, because
  // the module-level signing registry is only filled during an interactive
  // sign-in — leaving the phone sending in the clear and unable to open a
  // single encrypted line, with nothing on screen to say so.
  const [e2eeStatus, setE2eeStatus] = useState<DmEncryptionStatus | null>(null);
  useEffect(() => {
    let active = true;
    setE2eeStatus(null);
    if (!address) return;
    // Loading a saved identity needs no signing provider. This also lets a
    // returning user see Unlock while the provider reconnects.
    ensureDmEncryption(address, sessionProvider, { interactive: false })
      .then((status) => { if (active) setE2eeStatus(status); })
      .catch(() => { if (active) setE2eeStatus("error"); });
    return () => { active = false; };
  }, [address, sessionProvider]);

  const [e2eeRetrying, setE2eeRetrying] = useState(false);
  const retryEncryption = useCallback(async () => {
    if (!address || e2eeRetrying) return;
    setE2eeRetrying(true);
    try {
      setE2eeStatus(await retryDmEncryption(address, sessionProvider));
    } catch {
      setE2eeStatus("error");
    } finally {
      setE2eeRetrying(false);
    }
  }, [address, sessionProvider, e2eeRetrying]);

  // Encryption is per chat and off unless "Encrypt chat" is on. Nothing asks
  // for the wallet on its own: older encrypted lines collapse into one row
  // per run, and the banner offers Unlock for anyone who wants to read them.
  const hasUndecryptable = e2eeStatus !== "ready" && messageList.some((m) => m.undecryptable);
  const { byId: chatPrefsById, update: updateChatPref, seeReactions } = useChatPrefs(!!address);
  // An open chat's reactions are seen, including ones that land while it's open.
  const openChatHasReactions = !!currentConvId && !!chatPrefsById.get(String(currentConvId))?.reactions;
  useEffect(() => {
    if (openChatHasReactions && currentConvId) seeReactions(String(currentConvId));
  }, [openChatHasReactions, currentConvId, seeReactions]);
  const canToggleEncryption = !!currentConvId && /^[0-9a-f]{24}$/i.test(String(currentConvId));
  const chatEncrypted = canToggleEncryption && !!chatPrefsById.get(String(currentConvId))?.encryptedAt;
  // "Send in their language": your lines go out translated into the language
  // they read Riftn in. Not offered while the chat is encrypted.
  const canTranslateOut = canToggleEncryption && !chatEncrypted;
  const translateOutOn = canTranslateOut && !!chatPrefsById.get(String(currentConvId))?.translateOutAt;
  const onToggleTranslateOut = useCallback(async () => {
    if (!currentConvId) return;
    const on = !translateOutOn;
    // Translating sends the text to the translator, so it asks once, like Translate does.
    if (on && !hasAiConsent() && !(await ensureAiConsent())) return;
    void updateChatPref(String(currentConvId), { translateOut: on });
    if (!on) {
      toastSuccess(t("dmTranslateOut.offToast", { defaultValue: "Your messages here go as you type them" }));
      return;
    }
    const lang = await peerLanguage(String(currentConvId));
    if (lang) {
      toastSuccess(t("dmTranslateOut.onToast", {
        defaultValue: "Your messages here now go out in {{language}}",
        language: languageName(lang, getUserLanguage()),
      }));
    } else {
      toastSuccess(t("dmTranslateOut.noLanguage", {
        defaultValue: "They haven't picked an app language yet, so your messages go as you type them for now",
      }));
    }
  }, [currentConvId, translateOutOn, updateChatPref, t]);
  const onToggleEncryption = useCallback(() => {
    if (!currentConvId) return;
    const on = !chatEncrypted;
    void updateChatPref(String(currentConvId), { encrypted: on });
    if (on) toastSuccess(t("messages.encrypted", { defaultValue: "End-to-end encrypted" }));
    // Turning it on is the deliberate moment to set up this device's key.
    if (on && e2eeStatus !== "ready") void retryEncryption();
  }, [currentConvId, chatEncrypted, updateChatPref, t, e2eeStatus, retryEncryption]);

  const [expandedUnreadable, setExpandedUnreadable] = useState<Set<string>>(() => new Set());
  useEffect(() => { setExpandedUnreadable(new Set()); }, [currentConvId]);
  const undecryptableRuns = useMemo(
    () => collapsedUnreadableRows(messageList, expandedUnreadable),
    [messageList, expandedUnreadable],
  );
  const expandUnreadable = useCallback((start: number, count: number) => {
    const rows = messageList.slice(start, start + count);
    setExpandedUnreadable(previous => {
      const expanded = new Set(previous);
      for (const row of rows) expanded.add(row._id);
      return expanded;
    });
  }, [messageList]);

  // Re-run the history fetch below once the identity comes online, so lines
  // fetched before it (held as "undecryptable") open.
  const [identityTick, setIdentityTick] = useState(0);
  useEffect(() => onIdentityChange(() => setIdentityTick((t) => t + 1)), []);


  useEffect(() => {
    const t = setTimeout(scrollToBottom, 150);
    return () => clearTimeout(t);
  }, [currentConvId, scrollToBottom]);


  const computeBlockDmState = useCallback(
    (acct: any): { disabled: boolean; reason: string | null } => {
      if (!!(acct?.youBlocked) && !!(acct?.blockedYou))
        return { disabled: true, reason: t("copy.45156cf98a89", { defaultValue: "You've blocked this user and they've blocked you." }) };
      if (!!(acct?.blockedYou))
        return { disabled: true, reason: t("copy.b4bfeb07748c", { defaultValue: "This user has blocked you." }) };
      if (!!(acct?.youBlocked))
        return { disabled: true, reason: t("copy.f2835d753fbd", { defaultValue: "You've blocked this user." }) };
      if (!!(acct?.isBlocked))
        return { disabled: true, reason: t("copy.4472e19f9ab5", { defaultValue: "Messaging is restricted due to a block." }) };
      if (Boolean(acct?.blocklist?.adminBlocked))
        return { disabled: true, reason: t("copy.2ed9f7fcdb50", { defaultValue: "This account has been blocked." }) };
      return { disabled: false, reason: null };
    },
    [t],
  );


  useEffect(() => {
    let cancelled = false;
    const addr = (peer.address || "").toLowerCase();
    if (!addr) return;

    // Prime from cache
    const cached = getPeerPolicy(addr);
    if (cached) {
      setDmDisabled(!!cached.disabled);
      setDmReason(cached.reason || null);
      if (cached.dmFee) {
        setDmFee(cached.dmFee);
      }
    }

    (async () => {
      try {
        const res: any = await getAccount(addr);
        const acct: any = res?.data?.result || res?.result;
        if (cancelled || !acct) return;
        setTarget(acct);
        const blockState = computeBlockDmState(acct);
        if (blockState.disabled) {
          setDmDisabled(true);
          setDmReason(blockState.reason);
          dmActions.setPeerPolicy(addr, { disabled: true, reason: blockState.reason, status: "BLOCKLIST" });
        } else {
          const disables = acct.dmSettings?.disables || [];
          if (disables.includes("ALL")) {
            setDmDisabled(true);
            const allReason = t("copy.9e2050d824cc", { defaultValue: "This account has disabled all DMs" });
            setDmReason(allReason);
            dmActions.setPeerPolicy(addr, { disabled: true, reason: allReason, status: "ALL" });
          } else if (disables.includes("NEW_DM") && !currentConvId) {
            setDmDisabled(true);
            const newDmReason = t("copy.76b4bb23be6b", { defaultValue: "This account doesn't accept new DMs" });
            setDmReason(newDmReason);
            dmActions.setPeerPolicy(addr, { disabled: true, reason: newDmReason, status: "NEW_DM" });
          } else {
            setDmDisabled(false);
            setDmReason(null);
            dmActions.setPeerPolicy(addr, { disabled: false, reason: null, status: "ACTIVE_ALL" });
          }
        }

        // Private account check — can't DM without following
        if (acct.isPrivate && !blockState.disabled) {
          try {
            const followResult = await checkIsFollowing(addr);
            if (!cancelled && !followResult.isFollowing) {
              setDmDisabled(true);
              const reason = followResult.isFollowRequestPending
                ? t("copy.b87034ff2ad5", { defaultValue: "This is a private account. Your follow request is pending." })
                : t("copy.ced9ac0e20ad", { defaultValue: "This is a private account. Follow them to send messages." });
              setDmReason(reason);
            }
          } catch {
            /* ignore — allow messaging if check fails */
          }
        }
      } catch {
        /* ignore */
      }

      // Also fetch DM user status for fee info (especially for new chats)
      try {
        const rawStatus = await getDmUserStatus(addr);
        // The API may wrap the response — handle both shapes
        const status: DmUserStatus | undefined =
          (rawStatus as any)?.data ?? (rawStatus as any)?.result ?? rawStatus;
        if (!cancelled && status) {
          setPeerDmStatus(status);
          // Always derive fee from server status (authoritative source)
          if (status.perMessageFee && status.perMessageFee > 0) {
            const hasFree =
              Array.isArray(status.freeAccessUsers) &&
              status.freeAccessUsers.some(
                (a: string) => a.toLowerCase() === address,
              );
            const newFee: DmFee = {
              required: !hasFree,
              fee: status.perMessageFee,
              hasFreeAccess: hasFree,
            };
            setDmFee(newFee);
          } else if (status.perMessageFee === 0 || !status.perMessageFee) {
            // Peer has no fee — ensure we clear any stale fee
            setDmFee(null);
          }
        }
      } catch (feeErr) {
        log.error("getDmUserStatus error:", feeErr);
      }
    })();
    return () => { cancelled = true; };
  }, [peer.address, currentConvId, computeBlockDmState, t]);


  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getDmUserStatus(address)
      .then((status) => {
        if (!cancelled && status) setMyDmStatus(status);
      })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, [address]);


  const normalizeAuthor = useCallback(
    (m: any): DmMessage => {
      if (m.author === "me" || m.author === "other") return m;
      const senderId = String(m?.sender?._id || m?.sender || "");
      const senderAddr = String(m?.sender?.address || "").toLowerCase();
      const mine =
        (userId && senderId === userId) ||
        (address && senderAddr === address);
      return { ...m, author: mine ? "me" : "other" };
    },
    [userId, address],
  );

  const recoverHead = useCallback(async (isCurrent: () => boolean) => {
    if (!currentConvId || !address) return;
    // Keep alerts that arrive while the conversation is loading.
    const readThrough = Date.now();
    setInitialLoading(true);
    try {
      const resp = await getMessages(currentConvId, { address, limit: PAGE_SIZE });
      const msgs = resp?.messages || [];
      const normalized = await decryptIncoming(currentConvId, address, msgs.map(normalizeAuthor));
      if (!isCurrent()) return;
      if (normalized.length) dmActions.upsertMessages(currentConvId, normalized);
      if (msgs.length < PAGE_SIZE) setHasMore(false);
      if (userId) {
        dmActions.markAllRead(currentConvId, userId);
        if (Array.isArray(resp?.messages)) {
          void dismissReadMessageNotifications(currentConvId, address, readThrough, isCurrent);
        }
      }
    } catch (e) {
      log.error("recover message head", e);
    } finally {
      if (isCurrent()) {
        setInitialLoading(false);
        setHeadLoaded(true);
      }
    }
  }, [currentConvId, address, identityTick, normalizeAuthor, userId]);
  useDmHeadRecovery(recoverHead, allow && !!currentConvId && !!address);


  const loadMore = useCallback(async () => {
    if (!currentConvId || !address || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const resp = await getMessages(currentConvId, {
        address,
        skip: storeMessages.length,
        limit: PAGE_SIZE,
      });
      const msgs = resp?.messages || [];
      if (msgs.length) {
        dmActions.upsertMessages(
          currentConvId,
          await decryptIncoming(currentConvId, address, msgs.map((m: any) => normalizeAuthor(m))),
        );
      }
      if (msgs.length < PAGE_SIZE) setHasMore(false);
    } catch (e) {
      log.error("loadMore", e);
    } finally {
      setLoadingMore(false);
    }
  }, [currentConvId, address, storeMessages.length, loadingMore, hasMore]);
  linkStateRef.current = { messageList, hasMore, loadingMore, loadMore, highlightAndScroll };

  // Decide once where the chat opens from the saved spot: pull in older pages
  // until the spot is loaded (up to MAX_READ_SPOT_PAGES), then fix the marker.
  const readSpotPagesRef = useRef(0);
  const [headWaitOver, setHeadWaitOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setHeadWaitOver(true), 4000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const spot = readSpot.opening;
    if (!spot || spotAnchor || initialLoading || !storeMessages.length) return;
    if (!headLoaded && !headWaitOver) return;
    const lines = storeMessages.map((m) => ({
      id: String(m._id),
      mine: isMine(m),
      at: m.createdAt,
      skip: !!m.undecryptable || String(m._id).startsWith("temp"),
    }));
    const found = anchorFromReadSpot(lines, spot, hasMore, openedAtRef.current);
    if (found.kind === "older") {
      if (readSpotPagesRef.current < MAX_READ_SPOT_PAGES) {
        if (!loadingMore) {
          readSpotPagesRef.current += 1;
          void loadMore();
        }
        return;
      }
      const theirs = lines.filter((l) => !l.mine && !l.skip);
      setSpotAnchor({ anchor: theirs.length ? { id: theirs[0].id, ids: theirs.map((l) => l.id), count: theirs.length } : null });
      return;
    }
    setSpotAnchor({ anchor: found.kind === "anchor" ? found.anchor : null });
  }, [readSpot.opening, spotAnchor, initialLoading, storeMessages, headLoaded, headWaitOver, hasMore, loadingMore, loadMore, isMine]);
  // No marker to place: saving can start straight away.
  useEffect(() => {
    if (!readSpot.ready) return;
    if (readSpot.opening ? (spotAnchor && !spotAnchor.anchor) : !flagAnchor) readTrackingRef.current = true;
  }, [readSpot.ready, readSpot.opening, spotAnchor, flagAnchor]);

  // Re-emit whenever new messages arrive so the other user gets read receipts
  // even for messages sent while we're already viewing the conversation.
  const lastMsgId = useMemo(
    () => storeMessages.length ? storeMessages[storeMessages.length - 1]?._id : null,
    [storeMessages],
  );

  useEffect(() => {
    if (!currentConvId || !userId) return;
    log.info("[MARK_AS_READ] emitting markAsRead", { dmId: currentConvId, userId, lastMsgId });
    ws.emitAuthed(DMSocketEvent.markAsRead, { dmId: currentConvId });
    dmActions.markAllRead(currentConvId, userId);
  }, [currentConvId, userId, ws, lastMsgId]);


  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Typing indicator
    unsubs.push(
      ws.on(DMSocketEvent.Typing, (p: any) => {
        const cId = resolveConvId(p?.dmId, p?.conversation);
        if (cId !== currentConvId) return;
        const fromId = String(p?.userId || p?.sender || "");
        if (fromId === userId) return;
        setRemoteTyping(true);
      }),
    );
    unsubs.push(
      ws.on(DMSocketEvent.StopTyping, (p: any) => {
        const cId = resolveConvId(p?.dmId, p?.conversation);
        if (cId !== currentConvId) return;
        setRemoteTyping(false);
      }),
    );

    // Edit
    unsubs.push(
      ws.on(DMSocketEvent.EditMessage, (payload: EditMessageResponse) => {
        settlePendingEdit(payload.messageId);
        if (payload.dmId === currentConvId) {
          dmActions.applyEdit(payload);
        }
      }),
    );

    // Reactions: the server sends the message's whole reaction map back,
    // to us and to the other side, after every add or remove.
    unsubs.push(
      ws.on(DMSocketEvent.ReactionUpdated, (payload: ReactionUpdatedPayload) => {
        if (payload?.dmId === currentConvId) dmActions.applyReactions(payload);
      }),
    );

    // Delete
    unsubs.push(
      ws.on(DMSocketEvent.DeleteMessage, (payload: DeleteMessageResponse) => {
        if (payload.dmId === currentConvId) {
          dmActions.removeMessage(payload);
        }
      }),
      ws.on(DMSocketEvent.DestructOpened, (payload: { dmId: ID; messageId: ID; openedAt: string }) => {
        if (payload.dmId === currentConvId) dmActions.applyDestructOpened(payload);
      }),
    );

    // Read receipt — ignore self-receipts (our own markAsRead echoed back)
    unsubs.push(
      ws.on(DMSocketEvent.readReceipt, (payload: ReadReceiptResponse) => {
        log.info("[READ_RECEIPT] received", {
          dmId: payload.dmId,
          readBy: payload.readBy,
          currentUserId: userId,
          isSelf: String(payload.readBy) === String(userId),
          matchesConvId: payload.dmId === currentConvId,
        });
        if (payload.dmId === currentConvId && String(payload.readBy) !== String(userId)) {
          log.info("[READ_RECEIPT] applying — peer read our messages");
          dmActions.applyReadReceipt(payload);
        }
      }),
    );

    // Download receipt
    unsubs.push(
      ws.on(DMSocketEvent.downloadReceipt, (payload: DownloadReceiptResponse) => {
        if (payload.dmId === currentConvId) {
          dmActions.applyDownloadReceipt(payload);
        }
      }),
    );

    // DM fee payment
    unsubs.push(
      ws.on(DMSocketEvent.DmFeePayment, (p: any) => {
        log.info("DmFeePayment", p);
      }),
    );

    // Fee / tip confirmed on-chain — update optimistic message status
    unsubs.push(
      ws.on(DMSocketEvent.FeeConfirmed, (data: FeeConfirmedPayload) => {
        log.debug("feeConfirmed:", data);
        if (data?.conversationId && data?.messageId) {
          dmActions.applyFeeConfirmed(
            data.conversationId,
            data.messageId,
            data.amount,
          );
        }
      }),
    );

    // Error
    unsubs.push(
      ws.on(DMSocketEvent.Error, (err: any) => {
        const msg: string = err?.msg || t("copy.2fb0459cd6fb", { defaultValue: "Message failed" });
        if (/disturb|dnd|can't receive|disabled/i.test(msg)) {
          setDmDisabled(true);
          setDmReason(msg);
          toastWarning(msg);
        } else if (
          err?.code === "DM_FEE_REQUIRED" &&
          /not yet confirmed/i.test(msg)
        ) {
          // Suppress toast — the send queue handles retries automatically
        } else {
          toastError(msg);
        }
      }),
    );

    return () => unsubs.forEach((u) => { try { u(); } catch {} });
  }, [ws, currentConvId, userId, settlePendingEdit, t]);

  // Auto-clear typing after 5s silence
  useEffect(() => {
    if (!remoteTyping) return;
    const t = setTimeout(() => setRemoteTyping(false), 5000);
    return () => clearTimeout(t);
  }, [remoteTyping]);


  const ensureConversation = useCallback(async (): Promise<ID> => {
    if (currentConvId) return currentConvId;
    // Resolve target account
    let acct = target;
    if (!acct?._id && targetAddress) {
      const res: any = await getAccount(targetAddress);
      acct = res?.data?.result || res?.result;
      if (acct) setTarget(acct);
    }
    if (!acct?._id) throw new Error("Cannot identify recipient");

    if (creating) {
      await new Promise((r) => setTimeout(r, 300));
      if (createdConvIdRef.current) return createdConvIdRef.current;
    }
    setCreating(true);

    const newId: ID = await new Promise<ID>((resolve, reject) => {
      const handleOk = (resp: any) => {
        try {
          const data = resp?.data || resp;
          const id = String(data?._id || data?.id || "");
          if (!id) throw new Error("Invalid response");
          dmActions.upsertContacts([data as DmConversation]);
          createdConvIdRef.current = id;
          navigation.setParams({ conversationId: id } as any);
          // Extract DM fee
          if (data?.dmFee) {
            setDmFee(data.dmFee);
          }
          resolve(id);
        } catch (e) {
          reject(e);
        } finally {
          ws.off(DMSocketEvent.CreateAndStart, handleOk);
          ws.off(DMSocketEvent.Error, handleErr);
        }
      };
      const handleErr = (err: any) => {
        try {
          reject(new Error(err?.msg || "Unable to start DM"));
        } finally {
          ws.off(DMSocketEvent.CreateAndStart, handleOk);
          ws.off(DMSocketEvent.Error, handleErr);
        }
      };
      ws.on(DMSocketEvent.CreateAndStart, handleOk);
      ws.on(DMSocketEvent.Error, handleErr);
      ws.emitAuthed(DMSocketEvent.CreateAndStart, { _id: acct!._id });
    }).finally(() => setCreating(false));

    return newId;
  }, [currentConvId, creating, target, targetAddress, ws, navigation]);


  const payDmFee = useCallback(
    async (feeAmount: number): Promise<string> => {
      if (
        !provider || !account || !chainId ||
        !tokenContract || !controllerContract ||
        !tokenMeta || !tokenAddress || !controllerAddress
      ) {
        throw new Error("Wallet not connected. Please connect your wallet first.");
      }

      const amountBN = ethers.utils.parseUnits(
        String(feeAmount),
        tokenMeta.decimals || 18,
      );

      // Check balance
      const balance = await tokenContract.balanceOf(account);
      if (ethers.BigNumber.from(balance).lt(amountBN)) {
        throw new Error(`Insufficient token balance. You need ${feeAmount} tokens.`);
      }

      // Approve if needed
      const currentAllowance = await tokenContract.allowance(account, controllerAddress);
      if (ethers.BigNumber.from(currentAllowance).lt(amountBN)) {
        const userBal = await tokenContract.balanceOf(account);
        const approveAmount = userBal.gte(amountBN) ? userBal : amountBN;
        await writeContractAA(tokenContract, "approve", [controllerAddress, approveAmount], {
          context: "approve",
        });
      }

      // Execute sendTip(tokenId=0, amount, toAddress, tokenAddress)
      // Per docs: submit tx and return the hash immediately — do NOT wait for
      // on-chain confirmation. The server creates a pending record and the
      // Alchemy webhook confirms it automatically.
      const peerAddr = peer.address;
      if (!peerAddr) throw new Error("Recipient address unknown");
      const res = await writeContractAA(
        controllerContract,
        "sendTip",
        [0, amountBN, peerAddr, tokenAddress],
        { context: "dm-fee" },
      );
      const txHash = res.hash;
      if (!txHash) throw new Error("Transaction submitted but no hash returned");

      // Optimistically update local DHB balance
      try {
        await patchUser((prev) => ({
          tokenBalances: {
            ...(prev.tokenBalances || {}),
            DHB: Math.max(0, Number((prev.tokenBalances as any)?.DHB || 0) - feeAmount),
          },
        } as any));
      } catch { /* non-critical */ }

      return txHash;
    },
    [provider, account, chainId, tokenContract, controllerContract, tokenMeta, tokenAddress, controllerAddress, ethers, peer.address, patchUser],
  );

  // The queue is a module-level singleton that runs outside React lifecycle.
  // We inject ws, feePayer, and conversationResolver here so the queue
  // can use them even after this screen unmounts.

  useEffect(() => {
    dmSendQueue.init(ws);
  }, [ws]);

  useEffect(() => {
    dmSendQueue.setFeePayer(payDmFee);
    return () => { dmSendQueue.setFeePayer(null); };
  }, [payDmFee]);

  // Unlocking a locked photo is the same tip to the other person in the chat.
  useEffect(() => {
    setLockedMediaPayer(payDmFee);
    return () => { setLockedMediaPayer(null); };
  }, [payDmFee]);

  useEffect(() => {
    dmSendQueue.setConversationResolver(ensureConversation);
    return () => { dmSendQueue.setConversationResolver(null); };
  }, [ensureConversation]);

  // Register call message handler so call events appear as bubbles in this chat
  useEffect(() => {
    setCallMessageHandler((content) => {
      dmSendQueue.sendText({
        conversationId: currentConvId || "temp",
        userId: userId || "me",
        address,
        content,
      });
    });
    return () => setCallMessageHandler(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCallMessageHandler, currentConvId, userId, address]);


  /** Dispatch a standalone tip (msgType: 'tip') — only used when user sends
   *  a tip with NO content attached (no text, no gif, no media). */
  const dispatchStandaloneTip = useCallback(async () => {
    if (tipAmount <= 0) return false;
    const sentId = dmSendQueue.sendTip({
      conversationId: currentConvId || "temp",
      userId: userId || "me",
      address,
      tipAmount,
      dmFee,
    });
    return dmSendQueue.waitForDelivery(sentId);
  }, [tipAmount, currentConvId, userId, address, dmFee]);

  const onSendText = useCallback(
    async (text: string) => {
      const content = text.trim();

      // Allow tip-only sends (no text content) — dispatched as standalone tip
      if (!content && tipAmount <= 0) return false;
      if (dmDisabled) {
        toastWarning(dmReason || t("copy.e77db1187f46", { defaultValue: "Can't send messages right now" }));
        return false;
      }
      if (!editingMessage && planBlocks(content ? "text" : "tip", tipAmount)) return false;

      // Editing is still handled inline (not queued)
      if (editingMessage) {
        const target = editingMessage;
        const previousContent = target.content || "";
        const previousOriginal = target.original ?? null;
        // A line sent in their language is edited as you typed it.
        if (content === (previousOriginal?.content ?? previousContent).trim()) {
          setEditingMessage(null);
          return true;
        }
        try {
          const cId = await ensureConversation();
          // Same rules as a fresh send: in their language when that is on for
          // this chat, otherwise encrypted when both sides have keys.
          const translated = await translateOutgoing(String(cId), content);
          const wire = translated
            ? { content: translated.content, encrypted: false }
            : await prepareOutgoing(peer.address, content);
          settlePendingEdit(target._id, false);
          const confirmed = new Promise<boolean>(resolve => {
            const timer = setTimeout(() => {
              settlePendingEdit(target._id, false);
              dmActions.applyEdit({ dmId: cId, messageId: target._id, content: previousContent,
                isEdited: !!target.isEdited, editedAt: target.editedAt || new Date().toISOString(), author: "me",
                original: previousOriginal });
              toastError(t("dm.failedToEdit"));
            }, EDIT_CONFIRM_TIMEOUT_MS);
            pendingEditsRef.current.set(target._id, { timer, resolve });
          });
          dmActions.applyEdit({ dmId: cId, messageId: target._id, content: translated ? translated.content : content, isEdited: true,
            editedAt: new Date().toISOString(), author: "me",
            original: translated ? { content: translated.original, lang: translated.lang } : null });
          ws.emitAuthed(DMSocketEvent.EditMessage, {
            dmId: cId,
            messageId: target._id,
            content: wire.content,
            ...(translated ? { original: translated.original, translatedTo: translated.lang } : {}),
          });
          const sent = await confirmed;
          if (sent) setEditingMessage(current => current?._id === target._id ? null : current);
          return sent;
        } catch (e) {
          settlePendingEdit(target._id, false);
          toastError(e, t("dm.failedToEdit"));
          return false;
        }
      }

      if (content) {
        // Text message — attach tipAmount so the queue pays tip on-chain
        // and includes tipTxHash in the sendMessage event
        const sentId = dmSendQueue.sendText({
          conversationId: currentConvId || "temp",
          userId: userId || "me",
          address,
          content,
          replyTo,
          dmFee,
          tipAmount: tipAmount > 0 ? tipAmount : undefined,
        });
        if (!(await dmSendQueue.waitForDelivery(sentId))) return false;
      } else {
        // No content but tipAmount > 0 — standalone tip (msgType: 'tip')
        if (!(await dispatchStandaloneTip())) return false;
      }

      scrollToBottom();
      setReplyTo.complete(replyTo, null);
      setTipAmount(0);
      return true;
    },
    [dmDisabled, dmReason, dmFee, editingMessage, currentConvId, userId, address, peer.address, ensureConversation, ws, scrollToBottom, replyTo, tipAmount, dispatchStandaloneTip, settlePendingEdit, planBlocks, setReplyTo, t],
  );

  // The Builder lander hands its request over as `autoSendText`: sent once,
  // exactly as if it had been typed here, so the build starts in this thread
  // the moment it opens. Cleared from the params so coming back to the screen
  // never sends it twice.
  const autoSendRef = useRef<string | undefined>(route?.params?.autoSendText);
  useEffect(() => {
    const text = autoSendRef.current;
    if (!text || !peer.address) return;
    autoSendRef.current = undefined;
    navigation.setParams?.({ autoSendText: undefined });
    onSendText(text);
  }, [onSendText, peer.address, navigation]);

  const onSendGif = useCallback(
    async (gifUrl: string, caption?: string) => {
      if (!gifUrl || dmDisabled) {
        toastWarning(dmReason || t("copy.dae38d549299", { defaultValue: "Can't send right now" }));
        return false;
      }
      if (planBlocks("gif", tipAmount)) return false;

      const sentId = dmSendQueue.sendGif({
        conversationId: currentConvId || "temp",
        userId: userId || "me",
        address,
        gifUrl,
        caption: caption?.trim(),
        replyTo,
        dmFee,
        tipAmount: tipAmount > 0 ? tipAmount : undefined,
      });
      if (!(await dmSendQueue.waitForDelivery(sentId))) return false;

      scrollToBottom();
      setReplyTo.complete(replyTo, null);
      setTipAmount(0);
      return true;
    },
    [dmDisabled, dmReason, dmFee, currentConvId, userId, address, scrollToBottom, replyTo, tipAmount, planBlocks, setReplyTo, t],
  );

  const onSendMedia = useCallback(
    async (attachment: ChatMediaAttachment, caption?: string) => {
      if (!attachment.uri || !user || dmDisabled) {
        toastWarning(dmReason || t("copy.dae38d549299", { defaultValue: "Can't send right now" }));
        return false;
      }
      if (planBlocks(attachment.type === "video" ? "video" : attachment.type === "audio" ? "audio" : "image", tipAmount)) return false;

      const sentId = dmSendQueue.sendMedia({
        conversationId: currentConvId || "temp",
        userId: userId || "me",
        address,
        uri: attachment.uri,
        thumbnailUri: attachment.thumbnailUri,
        mediaType:
          attachment.type === "video" ? "video" : attachment.type === "audio" ? "audio" : attachment.type === "file" ? "file" : "image",
        mimeType: attachment.mimeType,
        fileName: attachment.name,
        fileSize: attachment.size,
        duration: attachment.duration,
        lockPrice: attachment.lockPrice || undefined,
        ...(attachment.type === "video" && attachment.options ? { mediaOptions: attachment.options } : {}),
        // Timers ride on photos and videos alike (the studio offers them for both).
        ...((attachment.type === "video" || attachment.type === "image") && attachment.destruct ? { destruct: attachment.destruct } : {}),
        caption: caption?.trim(),
        replyTo,
        dmFee,
        tipAmount: tipAmount > 0 ? tipAmount : undefined,
      });
      if (!(await dmSendQueue.waitForDelivery(sentId))) return false;

      scrollToBottom();
      setReplyTo.complete(replyTo, null);
      setTipAmount(0);
      return true;
    },
    [user, address, dmDisabled, dmReason, dmFee, currentConvId, userId, scrollToBottom, replyTo, tipAmount, planBlocks, setReplyTo, t],
  );

  const onSendPhotos = useCallback(
    async (files: ChatMediaAttachment[], caption?: string) => {
      if (!user || dmDisabled) {
        toastWarning(dmReason || t("copy.dae38d549299", { defaultValue: "Can't send right now" }));
        return false;
      }
      if (planBlocks("image", tipAmount)) return false;

      const sentId = dmSendQueue.sendPhotos({
        conversationId: currentConvId || "temp",
        userId: userId || "me",
        address,
        files,
        caption,
        replyTo,
        dmFee,
      });
      // Retry belongs to the failed message in the thread.
      await dmSendQueue.waitForDelivery(sentId);
      scrollToBottom();
      setReplyTo.complete(replyTo, null);
      return true;
    },
    [user, dmDisabled, dmReason, t, planBlocks, tipAmount, currentConvId, userId, address, replyTo, dmFee, scrollToBottom, setReplyTo],
  );

  const handleVoiceComplete = useCallback(
    (result: VoiceNoteResult) => {
      if (!user || dmDisabled || !result.uri) return;
      if (planBlocks("audio")) return;
      dmSendQueue.sendMedia({
        conversationId: currentConvId || "temp",
        userId: userId || "me",
        address,
        uri: result.uri,
        mediaType: "image",
        mimeType: result.mimeType,
        msgType: "voice",
        voiceDuration: Math.round(result.durationMs / 1000),
        replyTo,
        dmFee,
      });
      scrollToBottom();
      setReplyTo.complete(replyTo, null);
    },
    [user, dmDisabled, currentConvId, userId, address, replyTo, dmFee, scrollToBottom, planBlocks, setReplyTo],
  );

  const handleVoiceCancel = useCallback(() => {}, []);

  const voiceRecorder = useVoiceRecorder({
    onRecordingComplete: handleVoiceComplete,
    onCancel: handleVoiceCancel,
  });

  const onStartVoice = useCallback(() => {
    voiceRecorder.startRecording();
  }, [voiceRecorder]);


  const onLongPressMessage = useCallback(
    (message: DmMessage, layout: MessageLayout, mine: boolean) => {
      setContextMessage(message);
      setContextLayout(layout);
      setContextIsMine(mine);
    },
    [],
  );

  const closeContextMenu = useCallback(() => {
    setContextMessage(null);
    setContextLayout(null);
  }, []);

  const handleReply = useCallback(() => {
    if (contextMessage) setReplyTo(contextMessage);
    closeContextMenu();
  }, [contextMessage, closeContextMenu, setReplyTo]);

  const handleEdit = useCallback(() => {
    if (contextMessage) setEditingMessage(contextMessage);
    closeContextMenu();
  }, [contextMessage, closeContextMenu]);

  // Translate on one message translates every message above it too, as on web.
  const handleTranslateAbove = useCallback(() => {
    const tapped = contextMessage;
    if (!tapped?._id) return;
    const at = Date.parse(String(tapped.createdAt)) || Date.now();
    const earlier = storeMessages
      .filter((m) => !!m._id && !isMine(m))
      .map((m) => ({ id: m._id, content: m.content, at: Date.parse(String(m.createdAt)) || 0 }))
      .filter((line) => line.at <= at);
    void translateDmAndAbove(tapped._id, tapped.content, earlier);
  }, [contextMessage, storeMessages, isMine]);

  /**
   * Toggle one emoji on any message in the thread, old or new. Shown at once,
   * then the server's reactionUpdated echo replaces it with the real map; a
   * socket error leaves the server's map in place on the next echo or fetch.
   */
  const toggleReaction = useCallback(
    (message: DmMessage, emoji: string, addOnly = false) => {
      if (!currentConvId || !address || !message?._id) return;
      const liveMessage = dmState.messagesByConversation[currentConvId]?.find((row) => row._id === message._id);
      if (!liveMessage) return;
      const current = liveMessage.reactions || {};
      const others = (current[emoji] || []).filter((a) => a.toLowerCase() !== address);
      const mine = others.length !== (current[emoji] || []).length;
      if (addOnly && mine) return;
      if (addOnly) haptic.select();
      const next = { ...current };
      if (mine) {
        if (others.length) next[emoji] = others;
        else delete next[emoji];
      } else {
        next[emoji] = [...others, address];
      }
      dmActions.applyReactions({ dmId: currentConvId, messageId: message._id, reactions: next });
      ws.emitAuthed(mine ? DMSocketEvent.RemoveReaction : DMSocketEvent.AddReaction, {
        dmId: currentConvId,
        messageId: message._id,
        emoji,
      });
    },
    [address, currentConvId, ws],
  );

  // From the message menu: who reacted (a frozen copy of the line's reactions),
  // and the full emoji picker for one message.
  const [reactorsOf, setReactorsOf] = useState<Record<string, string[]> | null>(null);
  const [emojiFor, setEmojiFor] = useState<DmMessage | null>(null);
  const handleShowReactors = useCallback(() => {
    if (contextMessage?.reactions) setReactorsOf({ ...contextMessage.reactions });
  }, [contextMessage]);
  const handleMoreEmoji = useCallback(() => {
    if (contextMessage) setEmojiFor(contextMessage);
  }, [contextMessage]);

  const handleContextReact = useCallback(
    (emoji: string) => {
      if (contextMessage) toggleReaction(contextMessage, emoji);
    },
    [contextMessage, toggleReaction],
  );

  // Like Telegram, in a one-to-one chat any message (yours or theirs) can go
  // for both of you or just for you.
  const deleteMessages = useCallback(
    (convId: string, list: DmMessage[], forBoth: boolean) => {
      const event = forBoth ? DMSocketEvent.DeleteMessage : DMSocketEvent.HideMessage;
      for (const m of list) {
        ws.emitAuthed(event, { dmId: convId, messageId: m._id });
        dmActions.removeMessage({ dmId: convId, messageId: m._id });
      }
    },
    [ws],
  );
  const [deleteReq, setDeleteReq] = useState<DeleteRequest | null>(null);
  const askDelete = useCallback(
    (convId: string, list: DmMessage[], onDone: () => void) => {
      if (!list.length) return;
      const many = list.length > 1;
      setDeleteReq(resolveDelete({
        count: list.length,
        canDeleteForEveryone: true,
        oneToOne: true,
        peerName: peerLabel,
        onDelete: (scope) => {
          deleteMessages(convId, list, scope === "everyone");
          if (many) toastSuccess(t("msgSelect.deleted", { defaultValue: "Deleted {{count}} messages", count: list.length }));
          else toastSuccess(t("dm.messageDeleted"));
          onDone();
        },
      }));
    },
    [deleteMessages, peerLabel],
  );

  const handleDelete = useCallback(() => {
    if (!contextMessage || !currentConvId) return;
    const target = contextMessage;
    const convId = currentConvId;
    closeContextMenu();
    // Let the hold menu finish leaving: iOS won't raise a sheet over a closing one.
    setTimeout(() => askDelete(convId, [target], () => {}), 250);
  }, [contextMessage, currentConvId, closeContextMenu, askDelete]);

  // "Copy link" on a message. A chat still being set up has no id a link
  // could name yet.
  const linkableConv = !!currentConvId && /^[A-Za-z0-9_-]{1,64}$/.test(String(currentConvId))
    && !String(currentConvId).startsWith("new_") && !/^0x[0-9a-f]{40}$/i.test(String(currentConvId));
  const handleCopyLink = useCallback(() => {
    if (contextMessage?._id && currentConvId) {
      copyChatMessageLink({ kind: "dm", conversationId: String(currentConvId) }, String(contextMessage._id));
    }
  }, [contextMessage, currentConvId]);

  const handleForward = useCallback(() => {
    if (contextMessage) setForwardMessage(contextMessage);
    setForwardVisible(true);
    closeContextMenu();
  }, [contextMessage, closeContextMenu]);

  /** Sends one message on to another chat. Resolves false when it could not go from this phone. */
  const forwardOne = useCallback(
    async (msg: DmMessage, targetConvId: ID): Promise<boolean> => {
      if (isPrivatePhoto(msg)) return false;
      if (msg.encMedia) {
        try {
          await dmSendQueue.forwardEncryptedMedia({
            message: msg,
            targetConversationId: targetConvId,
            userId: userId || "me",
            address,
          });
          return true;
        } catch {
          return false;
        }
      }
      if (msg.encrypted) {
        // The server cannot re-encrypt for another conversation, so an
        // encrypted line is re-sent from here: plaintext from the store,
        // encrypted again for the target's peer, citing the original.
        if (msg.undecryptable) return false;
        dmSendQueue.sendText({
          conversationId: targetConvId,
          userId: userId || "me",
          address,
          content: msg.content || "",
          forwardedFrom: { messageId: msg._id },
        });
        return true;
      }
      ws.emitAuthed(DMSocketEvent.ForwardMessage, {
        messageId: msg._id,
        targetDmId: targetConvId,
      });
      return true;
    },
    [ws, userId, address],
  );

  const onForwardSelect = useCallback(
    (targetConvId: ID) => {
      if (bulkForward) {
        const list = bulkForward;
        setForwardVisible(false);
        setBulkForward(null);
        setPickedMsgs(null);
        void (async () => {
          let ok = 0;
          // One after another, so they land in the same order as here.
          for (const m of list) if (await forwardOne(m, targetConvId)) ok++;
          if (ok === list.length) toastSuccess(t("msgSelect.forwarded", { defaultValue: "{{count}} messages forwarded", count: ok }));
          else if (ok > 0) toastWarning(t("msgSelect.partForwarded", { defaultValue: "Forwarded {{ok}} of {{total}}", ok, total: list.length }));
          else toastWarning(t("dm.cantForwardFromDevice"));
        })();
        return;
      }
      if (!forwardMessage) return;
      if (forwardMessage.encMedia) {
        const original = forwardMessage;
        setForwardVisible(false);
        setForwardMessage(null);
        forwardOne(original, targetConvId).then((sent) =>
          sent ? toastSuccess(t("dm.messageForwarded")) : toastWarning(t("dm.cantForwardFromDevice")),
        );
        return;
      }
      if (forwardMessage.encrypted && forwardMessage.undecryptable) {
        toastWarning(t("dm.cantForwardFromDevice"));
        return;
      }
      void forwardOne(forwardMessage, targetConvId);
      toastSuccess(t("dm.messageForwarded"));
      setForwardVisible(false);
      setForwardMessage(null);
    },
    [forwardMessage, bulkForward, forwardOne],
  );

  // ─── Picking several messages (Select) ────────────────────────────────────
  const picking = pickedMsgs !== null;
  /** Picked messages in thread order, oldest first (the list is newest first). */
  const pickedList = useMemo(
    () => (pickedMsgs ? messageList.filter((m) => pickedMsgs.has(m._id)).reverse() : []),
    [pickedMsgs, messageList],
  );
  // Every pick can be deleted for you; all-yours picks can go for both.
  const pickedOwn = pickedList;
  const togglePick = useCallback((m: DmMessage) => {
    setPickedMsgs((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(m._id)) next.delete(m._id);
      else next.add(m._id);
      return next;
    });
  }, []);
  const handleSelect = useCallback(() => {
    if (contextMessage?._id) setPickedMsgs(new Set([contextMessage._id]));
    closeContextMenu();
  }, [contextMessage, closeContextMenu]);
  // A different chat starts with nothing picked.
  useEffect(() => { setPickedMsgs(null); }, [currentConvId]);
  // Android back leaves picking before it leaves the chat.
  useEffect(() => {
    if (!picking) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { setPickedMsgs(null); return true; });
    return () => sub.remove();
  }, [picking]);
  const copyPicked = useCallback(() => {
    const text = pickedList
      .map((m) => (m.undecryptable ? "" : (m.content || "").trim()))
      .filter(Boolean)
      .join("\n");
    if (!text) {
      toastWarning(t("msgSelect.nothingToCopy", { defaultValue: "Nothing to copy in the picked messages" }));
      return;
    }
    copyToClipboard(text);
    toastSuccess(t("msgSelect.copied", { defaultValue: "Copied {{count}} messages", count: pickedList.length }));
    setPickedMsgs(null);
  }, [pickedList]);
  const forwardPicked = useCallback(() => {
    if (!pickedList.length) return;
    setBulkForward(pickedList);
    setForwardVisible(true);
  }, [pickedList]);
  const deletePicked = useCallback(() => {
    if (!currentConvId || !pickedOwn.length) return;
    askDelete(currentConvId, pickedOwn, () => setPickedMsgs(null));
  }, [currentConvId, pickedOwn, askDelete]);


  const onTypingChange = useCallback(
    (isTyping: boolean) => {
      if (!currentConvId) return;
      ws.emitAuthed(
        isTyping ? DMSocketEvent.Typing : DMSocketEvent.StopTyping,
        { dmId: currentConvId },
      );
    },
    [currentConvId, ws],
  );


  useEffect(() => {
    const convId = currentConvId;
    if (!convId) return;
    const onServerMsg = (payload: any) => {
      const cId = resolveConvId(payload?.conversation, payload?.dmId);
      if (cId !== convId) return;
      // Text/GIF confirmation belongs to the send queue, which inserts the
      // saved message before removing its pending entry. Keep only the media
      // upload safety net here, and never consume an incoming message.
      if (payload?.author !== "me" || payload?.msgType !== "media") return;
      const list = (dmState as any).optimisticByConversation?.[convId] as OptimisticMessage[] | undefined;
      if (!list?.length) return;
      const msgType = payload?.msgType || "";
      const match = list.find((p) => {
        if (msgType === "media") return p.msgType === "media" && (p.mediaUrls?.length ?? 0) < 2;
        return false;
      });
      if (match) dmActions.removeOptimistic(convId, match._tempId);
    };
    const onJob = (payload: any) => {
      if (payload?.photoBatch) return;
      const raw = payload?.message || payload;
      const cId = resolveConvId(raw?.conversation, payload?.dmId);
      if (cId !== convId) return;
      const list = (dmState as any).optimisticByConversation?.[convId] as OptimisticMessage[] | undefined;
      if (!list?.length) return;
      const match = list.find((p) => p.msgType === "media" && (p.mediaUrls?.length ?? 0) < 2);
      if (match) dmActions.removeOptimistic(convId, match._tempId);
    };
    const u1 = ws.on(DMSocketEvent.SendMessage, onServerMsg);
    const u2 = ws.on(DMSocketEvent.JobMessageId, onJob);
    return () => {
      try { u1(); } catch {}
      try { u2(); } catch {}
    };
  }, [ws, currentConvId, peer.address]);


  const openMenu = useCallback(() => setMenuVisible(true), []);
  const closeMenu = useCallback(() => setMenuVisible(false), []);

  const onBlockUser = useCallback(() => {
    closeMenu();
    setConfirmMode("block");
    setConfirmVisible(true);
  }, [closeMenu]);

  // A first message from someone you don't follow: the thread carries
  // Accept / Delete / Block until you accept, reply or follow them.
  const isRequestChat = !!currentConvId && !!conversations.find((x) => x._id === currentConvId)?.isRequest;
  const [requestBusy, setRequestBusy] = useState(false);
  const onAcceptRequest = useCallback(async () => {
    if (!currentConvId) return;
    setRequestBusy(true);
    try {
      await acceptMessageRequest(currentConvId);
      dmActions.acceptRequest(currentConvId);
    } catch (e) {
      toastError(e, t("dmRequests.acceptFailed", { defaultValue: "Couldn't accept, try again" }));
    } finally {
      setRequestBusy(false);
    }
  }, [currentConvId, t]);
  const onDeleteRequest = useCallback(async () => {
    if (!currentConvId) return;
    try {
      await deleteConversation(currentConvId, address);
      dmActions.removeConversation(currentConvId);
      toastSuccess(t("toasts.conversation_deleted"));
      navigation.goBack();
    } catch (e) {
      toastError(e, t("dm.failedToDeleteConversation"));
    }
  }, [currentConvId, address, navigation, t]);

  const onUnblockUser = useCallback(() => {
    closeMenu();
    setConfirmMode("unblock");
    setConfirmVisible(true);
  }, [closeMenu]);


  const onClearChat = useCallback(async () => {
    closeMenu();
    if (!currentConvId || !address) return;
    Alert.alert(
      t("dm.clearMessages"),
      t("dm.clearMessagesConfirm"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("library.clear"),
          style: "destructive",
          onPress: async () => {
            try {
              const allIds = storeMessages.map((m) => m._id).filter(Boolean);
              if (allIds.length) {
                await bulkDeleteMessages(currentConvId, allIds, address);
              }
              dmActions.clearMessages(currentConvId);
              // Also clear any in-flight optimistic messages for this conversation
              const optimistic = (dmState as any).optimisticByConversation?.[currentConvId] as OptimisticMessage[] | undefined;
              if (optimistic?.length) {
                for (const m of optimistic) dmActions.removeOptimistic(currentConvId, m._tempId);
              }
              toastSuccess(t("dm.messagesCleared"));
            } catch (e) {
              toastError(e, t("dm.failedToClearMessages"));
            }
          },
        },
      ],
    );
  }, [currentConvId, address, storeMessages, closeMenu]);

  const onToggleFreeAccess = useCallback(async () => {
    closeMenu();
    const addr = (peer.address || "").toLowerCase();
    if (!addr) return;
    const currentlyFree = !!(myDmStatus?.freeAccessUsers?.some(
      (a: string) => a.toLowerCase() === addr,
    ));
    try {
      if (currentlyFree) {
        await removeFreeAccess(addr);
        setMyDmStatus((prev) =>
          prev ? { ...prev, freeAccessUsers: (prev.freeAccessUsers || []).filter((a) => a.toLowerCase() !== addr) } : prev,
        );
        toastSuccess(t("dm.removedFreeAccess", { name: peerLabel }));
      } else {
        await addFreeAccess(addr);
        setMyDmStatus((prev) =>
          prev ? { ...prev, freeAccessUsers: [...(prev.freeAccessUsers || []), addr] } : prev,
        );
        toastSuccess(t("dm.grantedFreeAccess", { name: peerLabel }));
      }
    } catch (e) {
      toastError(e, t("dm.failedToUpdateFreeAccess"));
    }
  }, [peer.address, myDmStatus, peerLabel, closeMenu]);

  const onSearchChat = useCallback(() => {
    closeMenu();
    setSearchVisible(true);
  }, [closeMenu]);

  const onConfirmBlock = useCallback(async () => {
    const addr = peer.address;
    if (!addr) return;
    setBlockLoading(true);
    try {
      if (confirmMode === "block") {
        setDmDisabled(true);
        setDmReason(t("copy.f2835d753fbd", { defaultValue: "You've blocked this user." }));
        await blockUser(addr, "Blocked from chat");
        setTarget((prev: any) => prev ? { ...prev, youBlocked: true } : prev);
        toastSuccess(t("postOptions.blockedUser", { name: peerLabel }));
      } else {
        setDmDisabled(false);
        setDmReason(null);
        await unblockUser(addr);
        setTarget((prev: any) => prev ? { ...prev, youBlocked: false } : prev);
        toastSuccess(t("postOptions.unblockedUser", { name: peerLabel }));
      }
    } catch (e) {
      const rollback = computeBlockDmState(target);
      setDmDisabled(rollback.disabled);
      setDmReason(rollback.reason);
      toastError(e, confirmMode === "block" ? t("copy.4fe0d0facd1a", { defaultValue: "Failed to block" }) : t("copy.576a5b77b7f1", { defaultValue: "Failed to unblock" }));
    } finally {
      setBlockLoading(false);
      setConfirmVisible(false);
    }
  }, [peer.address, confirmMode, peerLabel, target, computeBlockDmState, t]);


  const peerAvatarUri = useMemo(() => {
    const url = getAvatarUrl(peer.avatarImageUrl);
    return url && url !== "default-avatar" ? url : undefined;
  }, [peer.avatarImageUrl]);

  const peerMoment = useFaceMoment(peer.address);
  const openPeerMoments = useOpenMoments(peer.address);
  const LeftHeader = useMemo(
    () => (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => {
          if (peerMoment) {
            void openPeerMoments();
            return;
          }
          const id = peer.username || peer.address;
          if (id) showUserProfile(id, { source: "chat-header" });
        }}
      >
        <Avatar uri={peerAvatarUri} size={40} radius={9} name={peer.displayName || peer.username} />
        <MomentAvatarOutline peek={peerMoment} radius={9} />
      </TouchableOpacity>
    ),
    [peerAvatarUri, peer.username, peer.address, showUserProfile, peer.displayName, peerMoment, openPeerMoments],
  );

  const RightHeader = useMemo(
    () => (
      <View className="flex-row items-center">
        {isAssistantAddress(peer.address) ? (
          <AssistantDmButtons />
        ) : peer.address ? (
          <CallButton recipientAddress={peer.address} />
        ) : null}
        <ChatHeaderMenuButton onPress={openMenu} />
      </View>
    ),
    [openMenu, peer.address],
  );

  const handleSwipeToReply = useCallback(
    (msg: DmMessage) => {
      setReplyTo(msg);
    },
    [setReplyTo],
  );

  // The camera on an "Opened" photo: answer that photo with a photo or video.
  const [mediaReplyRequest, setMediaReplyRequest] = useState<{ onPicked: () => void } | null>(null);
  const closeMediaReply = useCallback(() => setMediaReplyRequest(null), []);
  const handleCameraReply = useCallback(
    (msg: DmMessage) => {
      Keyboard.dismiss();
      setMediaReplyRequest({ onPicked: () => setReplyTo(msg) });
    },
    [setReplyTo],
  );

  const renderMessage = useCallback(
    ({ item, index }: { item: DmMessage; index: number }) => {
      const mine = isMine(item);
      // The list is newest first (inverted): the line above on screen is
      // index + 1, the one below is index - 1. A run is back-to-back plain
      // lines from one side within 5 minutes on the same day.
      const older = messageList[index + 1];
      const newer = messageList[index - 1];
      const joins = (a?: DmMessage, b?: DmMessage) =>
        !!a && !!b && !a.undecryptable && !b.undecryptable &&
        ["msg", "media", "gif"].includes(a.msgType ?? "msg") && ["msg", "media", "gif"].includes(b.msgType ?? "msg") &&
        isMine(a) === isMine(b) &&
        chatDayKey(a.createdAt) === chatDayKey(b.createdAt) &&
        Math.abs(new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()) < 5 * 60_000;
      const dayPill = item.createdAt && (!older || chatDayKey(older.createdAt) !== chatDayKey(item.createdAt))
        ? <ChatDayPill iso={item.createdAt} />
        : null;
      const unreadMarker = unreadAnchor?.id === item._id ? <UnreadMarker count={unreadAnchor.count} /> : null;
      // Poll messages use a dedicated card
      if (item.msgType === "poll" && item.poll?.tokenId) {
        return (
          <View>
            {dayPill}
            {unreadMarker}
            <PollCard
              tokenId={item.poll.tokenId}
              autoTranslate={false}
              pollOwnerAddress={
                typeof item.sender === "object"
                  ? item.sender?.address ?? ""
                  : ""
              }
            />
          </View>
        );
      }
      const run = undecryptableRuns.get(item._id);
      if (run !== undefined) return run > 0 ? (
        <>{dayPill}{unreadMarker}<DmUndecryptableRun count={run} onExpand={() => expandUnreadable(index, run)} /></>
      ) : null;
      // The long-press menu floats its own copy of this bubble over the list.
      // The copy is see-through, so the original underneath showed its text
      // and time a second time; hide it while the menu is open.
      const bubble = (
          <MessageBubble
            message={item}
            isMine={mine}
            groupFirst={!joins(older, item)}
            groupLast={!joins(item, newer)}
            onLongPress={onLongPressMessage}
            onVideoPress={openVideo}
            localMediaUri={(item as OptimisticMessage)?._localMediaUri}
            onSwipeToReply={handleSwipeToReply}
            onReplyPress={handleReplyPress}
            highlighted={highlightedId === item._id}
            myAddress={address}
            onToggleReaction={toggleReaction}
            callPeerAddress={peer.address || undefined}
            onCameraReply={handleCameraReply}
          />
      );
      // Picking: the whole line is one tap target with a tick on the left;
      // the bubble's own taps, holds and swipes wait until picking ends.
      const pickable = !(item as OptimisticMessage)?._tempId;
      if (picking) {
        const checked = !!pickedMsgs?.has(item._id);
        return (
          <View>
            {dayPill}
            {unreadMarker}
            <Pressable
              testID="msg-pick-row"
              disabled={!pickable}
              onPress={() => togglePick(item)}
              onLongPress={() => togglePick(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              style={{ flexDirection: "row", alignItems: "center", paddingLeft: 10 }}
            >
              {checked && <View pointerEvents="none" style={CHECKED_FILL} />}
              <View style={{ opacity: pickable ? 1 : 0 }}><BulkTick checked={checked} /></View>
              <View style={{ flex: 1 }} pointerEvents="none">{bubble}</View>
            </Pressable>
          </View>
        );
      }
      return (
        <View style={liftedId === item._id ? { opacity: 0 } : undefined}>
          {dayPill}
          {unreadMarker}
          {bubble}
        </View>
      );
    },
    [isMine, messageList, onLongPressMessage, handleSwipeToReply, handleCameraReply, handleReplyPress, highlightedId, undecryptableRuns, expandUnreadable, address, toggleReaction, liftedId, unreadAnchor, picking, pickedMsgs, togglePick],
  );

  // The temp id a line was drawn under stays its key after the send lands.
  const keyExtractor = useCallback((item: DmMessage) => item._clientKey ?? item._id, []);

  const listFooter = useMemo(
    () =>
      loadingMore ? (
        <View className="py-4 items-center">
          <ActivityIndicator size="small" color="#F4F4F5" />
        </View>
      ) : null,
    [loadingMore],
  );


  // Determine whether to show the NewChatIntro (no existing conversation, no messages)
  const showNewChatIntro = !currentConvId && messageList.length === 0;

  // Build policy info for NewChatIntro
  const peerPolicy = useMemo(() => ({
    dmEnabled: !dmDisabled,
    dmDisabledReason: dmReason,
    perMessageFee: peerDmStatus?.perMessageFee ?? dmFee?.fee ?? 0,
    hasFreeAccess: dmFee?.hasFreeAccess ?? false,
    isBlocked: iBlockedThem,
  }), [dmDisabled, dmReason, peerDmStatus, dmFee, iBlockedThem]);

  // Tip handlers — selecting a tip amount "attaches" it to the next send.
  // The tip is dispatched alongside the message (or standalone if no content).
  const handleTipPress = useCallback(() => {
    const allowed = planRules?.allowedMessageTypes;
    if (allowed && allowed.length > 0 && !allowed.includes("tip")) {
      toastWarning(t("dm.planTypeNotAllowed"));
      return;
    }
    setTipSheetVisible(true);
  }, [planRules, t]);
  const handleClearTip = useCallback(() => setTipAmount(0), []);

  const handlePollCreated = useCallback(
    (_tokenId: number, message?: unknown) => {
      setPollSheetVisible(false);
      // The other side gets it over the socket; the sender's copy comes back here.
      if (message && currentConvId) dmActions.upsertMessages(currentConvId, [normalizeAuthor(message)]);
      scrollToBottom();
    },
    [scrollToBottom, currentConvId, normalizeAuthor],
  );
  const handleTipConfirm = useCallback((amount: number) => {
    setTipAmount(amount);
    setTipSheetVisible(false);
  }, []);

  return (
    <View style={{ flex: 1 }} className="bg-theme-neutrals-900">
      <ScreenHeader
        appearance="centered"
        title={title}
        leftContent={LeftHeader}
        rightContent={RightHeader}
        subtitle={remoteTyping ? _copy("copy.30f5934e6249", { defaultValue: "typing…" }) : peerSubtitle || undefined}
        titleBadge={(peer as any).badgeImg ? (
          <BadgeArtwork
            source={(peer as any).badgeImg}
            style={getBadgeHoverOpticalStyle((peer as any).badgeImg, SCREEN_HEADER_TITLE_FONT_SIZE, 0, 23)}
            contentFit="contain"
          />
        ) : undefined}
        titleAccessory={<OnlineDot address={peer.address} />}
      />

      {searchVisible ? <MessageSearch messages={messageList} onSelect={highlightAndScroll} onClose={() => setSearchVisible(false)} /> : null}

      <WhenOpened open={menuVisible}>
        {() => (
          <ChatMenu
              visible={menuVisible}
              onClose={closeMenu}
              isBlocked={iBlockedThem}
              onBlockUser={onBlockUser}
              onUnblockUser={onUnblockUser}
              onClearChat={currentConvId ? onClearChat : undefined}
              onToggleEncryption={canToggleEncryption ? onToggleEncryption : undefined}
              encrypted={chatEncrypted}
              onToggleTranslateOut={canTranslateOut ? () => void onToggleTranslateOut() : undefined}
              translateOut={translateOutOn}
              onSearchChat={onSearchChat}
              onToggleFreeAccess={myDmStatus?.perMessageFee && myDmStatus.perMessageFee > 0 ? onToggleFreeAccess : undefined}
              peerHasFreeAccess={
                !!(myDmStatus?.freeAccessUsers?.some(
                  (a: string) => a.toLowerCase() === (peer.address || "").toLowerCase(),
                ))
              }
              isCreator={!!(myDmStatus?.perMessageFee && myDmStatus.perMessageFee > 0)}
              onReportUser={peer.address || peer.username ? () => openMessageReport({
                userId: String(peer.address || peer.username),
                userName: peer.displayName || peer.username,
                where: "Direct message conversation",
                messageId: currentConvId ? `conversation ${currentConvId}` : undefined,
              }) : undefined}
            />
        )}
      </WhenOpened>

        {/* Per-message fee banner — always visible when fee info exists */}
        {DIGITAL_PURCHASES_ENABLED && <DmFeeBanner dmFee={dmFee} peerDisplayName={peer.displayName} />}

        {/* Says so when this device has no key, instead of silently sending
            in the clear and showing the peer's lines as unopenable. */}
        {(chatEncrypted || hasUndecryptable) && (
          <DmEncryptionBanner
            status={e2eeStatus}
            busy={e2eeRetrying}
            onRetry={retryEncryption}
            olderOnly={!chatEncrypted}
          />
        )}

        <DmSafetyBanner peer={peer} />

        {isRequestChat && !dmDisabled && (
          <MessageRequestBar
            name={peerLabel}
            busy={requestBusy}
            onAccept={onAcceptRequest}
            onDelete={onDeleteRequest}
            onBlock={onBlockUser}
          />
        )}

        {/* Pinned message banner */}
        {pinnedMessage && (
          <PinnedMessageBanner
            pinnedMessage={pinnedMessage}
            onPress={scrollToPinnedMessage}
            onUnpin={handleUnpinMessage}
          />
        )}

        <View className="flex-1">
          {/* New chat intro — shown before first message */}
          {/* A brand-new chat has no message list yet, so nothing on the
              screen took a tap away from the composer: the keyboard stayed
              up wherever you touched until you left Messages. A tap on the
              intro (or the loading spinner) now puts it away, the same as a
              tap on the list does once there are messages. */}
          {showNewChatIntro ? (
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View className="flex-1">
                <NewChatIntro
                  peer={{
                    address: peer.address,
                    displayName: peer.displayName,
                    username: peer.username,
                    avatarImageUrl: peerAvatarUri,
                  }}
                  policy={peerPolicy}
                />
              </View>
            </TouchableWithoutFeedback>
          ) : initialLoading && messageList.length === 0 ? (
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="small" color="#F4F4F5" />
              </View>
            </TouchableWithoutFeedback>
          ) : (
            <ReactionArrivalScope style={{ flex: 1 }}>
            <FlatList
              ref={listRef}
              inverted
              data={messageList}
              keyExtractor={keyExtractor}
              renderItem={renderMessage}
              // The list is inverted, so "flex-end" here is the top of the
              // screen: a chat with a few messages starts under the header
              // and reads down, instead of stranding them on the composer
              // with an empty screen above. A full chat fills the space and
              // still anchors to the newest message.
              contentContainerStyle={{
                flexGrow: 1,
                justifyContent: "flex-end",
                paddingTop: listBottomPadding,
                paddingBottom: 8,
              }}
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              scrollEventThrottle={16}
              onContentSizeChange={onContentSizeChange}
              onEndReached={loadMore}
              onEndReachedThreshold={0.3}
              // Fewer offscreen screens and smaller batches: the JS thread
              // stays free for the scroll in a long thread.
              windowSize={15}
              maxToRenderPerBatch={10}
              onScrollToIndexFailed={onScrollToIndexFailed}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              ListFooterComponent={listFooter}
              showsVerticalScrollIndicator={false}
            />
            </ReactionArrivalScope>
          )}

          {/* Jump capsule: up to the unread marker until it has been on
              screen, then down to the newest line; count = unread below. */}
          {!dmDisabled && !showNewChatIntro && (
            <View
              pointerEvents="box-none"
              className="absolute right-4"
              // Sit on the measured composer, not a fixed 100pt: with the
              // suggested-replies tray or a reply strip the composer is ~200pt
              // tall and paints over the pill.
              style={{ bottom: inputBarHeight + inputLift + 12 }}
            >
              {(() => {
                const up = !!unreadAnchor && !unreadMarkerSeen && unreadMarkerAbove;
                return (
                  <UnreadJumpButton
                    show={showJumpBtn || up}
                    up={up}
                    count={showJumpBtn || up ? (reachedBottomRef.current ? 0 : unreadBelow) + newBelow : 0}
                    onPress={up ? () => scrollToUnreadMarker(true) : scrollToBottom}
                  />
                );
              })()}
            </View>
          )}

          {/* Input or disabled banner — absolutely positioned, lifts with keyboard */}
          <View
            className="absolute left-0 right-0 bottom-0"
            // No insets.bottom pad at rest either: this container already ends
            // above the home indicator, so adding it again left a dead strip
            // under the composer.
            style={{ marginBottom: inputLift }}
            ref={composerKeyboard.ref}
            collapsable={false}
            onLayout={(e) => {
              setInputBarHeight(e.nativeEvent.layout.height);
              composerKeyboard.onLayout();
            }}
          >
            {/* Solid page colour, no frost: phone web's composer is the plain
                page with a hairline on top. Still opaque, since the list
                scrolls under this bar. */}
            <MessageSurface material={false} />
            {picking ? (
              <MessageSelectBar
                count={pickedList.length}
                ownCount={pickedOwn.length}
                onCopy={copyPicked}
                onForward={forwardPicked}
                onDelete={deletePicked}
                onCancel={() => setPickedMsgs(null)}
              />
            ) : voiceRecorder.isRecording ? (
              <VoiceNoteRecordingOverlay recorder={voiceRecorder} />
            ) : dmDisabled ? (
              <View className="px-4 py-3 bg-theme-neutrals-800 border-t border-theme-neutrals-700/50">
                <Text className="text-theme-neutrals-400 text-xs">
                  {dmReason || _copy("copy.944ae402da39", { defaultValue: "This account is not accepting messages right now." })}
                </Text>
                {iBlockedThem && !!currentConvId && (
                  <TouchableOpacity
                    onPress={() => {
                      setConfirmMode("unblock");
                      setConfirmVisible(true);
                    }}
                    className="mt-1"
                  >
                    <Text className="text-theme-blue-300 text-xs font-medium">
                      {t("dm.tapToUnblock")}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <>
              {canSchedule ? <ScheduledStrip items={scheduled.items} onOpen={() => setScheduledVisible(true)} /> : null}
              <ChatInputBar
                onSchedulePress={canSchedule ? handleSchedulePress : undefined}
                scheduledCount={scheduled.items.length}
                onSendText={onSendText}
                onSendMedia={onSendMedia}
                onSendPhotos={tipAmount > 0 || (dmFee?.required && !dmFee.hasFreeAccess) ? undefined : onSendPhotos}
                allowLock={DIGITAL_PURCHASES_ENABLED}
                onSendGif={onSendGif}
                onStartVoice={onStartVoice}
                onTypingChange={onTypingChange}
                // A paid DM (the recipient charges per message) is a purchase the
                // App Store build cannot take (3.1.1), so the bar says so instead.
                disabled={creating || accountBanned || storefrontFeeBlocked}
                disabledMessage={accountBanned ? t("banned.line") : storefrontFeeBlocked ? t("storefront.unavailable") : undefined}
                sending={sending}
                replyTo={replyTo}
                mediaReplyRequest={mediaReplyRequest}
                onCloseMediaReply={closeMediaReply}
                onCancelReply={() => setReplyTo.complete(replyTo, null)}
                editingMessage={editingMessage}
                onCancelEdit={() => setEditingMessage(null)}
                dmFee={DIGITAL_PURCHASES_ENABLED ? dmFee : null}
                tipAmount={tipAmount}
                onTipPress={DIGITAL_PURCHASES_ENABLED ? handleTipPress : undefined}
                onClearTip={handleClearTip}
                dhbBalance={dhbBalance}
                onPollPress={currentConvId ? () => setPollSheetVisible(true) : undefined}
                onNotePress={() => setNotesVisible(true)}
                initialText={route?.params?.sharedText}
                autoFocus={!!route?.params?.focusComposer}
                thread={smartReplyThread}
                peerName={peerLabel}
                draftKey={draftKey}
              />
              </>
            )}
          </View>
        </View>

        <WhenOpened open={!!deleteReq}>
          {() => (
            <DeleteMessageSheet request={deleteReq} onClose={() => setDeleteReq(null)} />
          )}
        </WhenOpened>

        {/* Context menu */}
        <WhenOpened open={!!contextMessage}>
          {() => (
            <MessageContextMenu
              visible={!!contextMessage}
              message={contextMessage}
              layout={contextLayout}
              isMine={contextIsMine}
              peerUser={{
                displayName: peer.displayName,
                username: peer.username,
                avatarImageUrl: peer.avatarImageUrl,
              }}
              myUser={{
                displayName: (user as any)?.displayName || (user as any)?.username,
                username: (user as any)?.username,
                avatarImageUrl: (user as any)?.avatarImageUrl,
              }}
              onClose={closeContextMenu}
              onReply={handleReply}
              onEdit={handleEdit}
              onForward={handleForward}
              onCopyLink={linkableConv ? handleCopyLink : undefined}
              onSelect={handleSelect}
              onTranslate={handleTranslateAbove}
              onDelete={handleDelete}
              canDeleteAny
              onPin={handlePinMessage}
              onUnpin={handleUnpinMessage}
              isPinned={contextMessage ? pinnedMessageId === contextMessage._id : false}
              onReact={handleContextReact}
              myAddress={address}
              onShowReactors={handleShowReactors}
              onMoreEmoji={handleMoreEmoji}
            />
          )}
        </WhenOpened>
        <WhenOpened open={!!reactorsOf}>
          {() => (
            <CommentLikersSheet
              visible={!!reactorsOf}
              onClose={() => setReactorsOf(null)}
              commentId={null}
              localReactions={reactorsOf}
            />
          )}
        </WhenOpened>
        <WhenOpened open={!!emojiFor}>
          {() => (
            <EmojiSheet
              visible={!!emojiFor}
              onClose={() => setEmojiFor(null)}
              selected={emojiFor ? Object.entries(emojiFor.reactions ?? {}).filter(([, who]) => who?.some((a) => a.toLowerCase() === (address || "").toLowerCase())).map(([e]) => e) : []}
              onSelect={(emoji) => { if (emojiFor) toggleReaction(emojiFor, emoji); setEmojiFor(null); }}
            />
          )}
        </WhenOpened>

        {/* Forward picker */}
        <WhenOpened open={forwardVisible}>
          {() => (
            <ForwardPickerModal
              visible={forwardVisible}
              onClose={() => {
                setForwardVisible(false);
                setForwardMessage(null);
                setBulkForward(null);
              }}
              onSelect={onForwardSelect}
              conversations={conversations}
              myUserId={userId}
              myAddress={address}
            />
          )}
        </WhenOpened>

        {/* Block confirmation */}
        <WhenOpened open={confirmVisible}>
          {() => (
            <ConfirmBlockModal
              visible={confirmVisible}
              mode={confirmMode}
              targetLabel={peerLabel}
              onConfirm={onConfirmBlock}
              onCancel={() => setConfirmVisible(false)}
              loading={blockLoading}
            />
          )}
        </WhenOpened>

        {/* Full-screen video player */}
        <WhenOpened open={!!videoPlay}>
          {() => (
            <FullScreenVideoPlayer
              visible={!!videoPlay}
              uri={videoPlay?.uri}
              options={videoPlay?.options}
              onClose={closeVideo}
            />
          )}
        </WhenOpened>

        {/* Tip amount sheet */}
        <WhenOpened open={tipSheetVisible}>
          {() => (
            <TipAmountSheet
              visible={tipSheetVisible}
              onClose={() => setTipSheetVisible(false)}
              onConfirm={handleTipConfirm}
              currentAmount={tipAmount}
              dhbBalance={dhbBalance}
              minAmount={Math.max(
                dmFee?.required && !dmFee?.hasFreeAccess ? (dmFee?.fee ?? 1) : 1,
                planMinTip,
              )}
            />
          )}
        </WhenOpened>

        {/* Create poll sheet */}
        {canSchedule && currentConvId ? (
          <>
            <WhenOpened open={!!scheduleDraft}>
              {() => (
                <ScheduleSheet
                  visible={!!scheduleDraft}
                  onClose={() => setScheduleDraft(null)}
                  scheduledDate={null}
                  onSchedule={(date) => { void confirmSchedule(date); }}
                  onWhenOnline={sendWhenOnline}
                  kind="message"
                  moving
                  title={t("dmSchedule.whenTitle", { defaultValue: "Send when?" })}
                />
              )}
            </WhenOpened>
            <WhenOpened open={scheduledVisible}>
              {() => (
                <ScheduledMessagesSheet
                  visible={scheduledVisible}
                  onClose={() => setScheduledVisible(false)}
                  dmId={currentConvId}
                  peerAddress={peer.address}
                  peerName={peerLabel}
                  items={scheduled.items}
                  isLoading={scheduled.isLoading}
                />
              )}
            </WhenOpened>
          </>
        ) : null}

        <WhenOpened open={notesVisible}>
          {() => (
            <NotesSheet
              visible={notesVisible}
              onClose={() => setNotesVisible(false)}
              onMessage={(a, reply) => navigation.push(ScreenNames.Chat, {
                targetAddress: a.address.toLowerCase(),
                title: a.displayName || a.username || a.address,
                targetUser: { ...a, walletAddress: a.address },
                focusComposer: true,
                ...(reply ? { autoSendText: reply } : {}),
              })}
            />
          )}
        </WhenOpened>

        <WhenOpened open={pollSheetVisible}>
          {() => (
            <CreatePollSheet
              visible={pollSheetVisible}
              onClose={() => setPollSheetVisible(false)}
              onCreated={handlePollCreated}
              conversationId={currentConvId ? String(currentConvId) : undefined}
            />
          )}
        </WhenOpened>
    </View>
  );
};

export default ChatScreen;
