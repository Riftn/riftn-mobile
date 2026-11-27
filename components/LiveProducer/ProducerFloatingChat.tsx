import { formatCount } from '../../libs/format-count';
import { translateCopy as _translateCopy } from "../../i18n/copy";
import { useMentions } from "../../hooks/useMentions";
import MentionSuggestions from "../common/MentionSuggestions";
import { useDraftState } from '../../hooks/useDraftState';
import { DhbCoin } from "../common/DhbCoin";
import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Pressable,
  useWindowDimensions,
} from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { LinearGradient } from "expo-linear-gradient";
import ArrowUpCircle from "lucide-react-native/dist/esm/icons/circle-arrow-up";
import MessageCircleOff from "lucide-react-native/dist/esm/icons/message-circle-off";
import { StreamActivityType } from "../../services/enums/livestream.enum";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import Avatar from "../common/Avatar";
import { getAvatarUrl } from "../../libs/misc";
import { useComposerKeyboard } from "../../hooks/useComposerKeyboard";
import type { UserReference, ChatHoldLayout } from "../LiveViewer/LiveViewerChat";
import { ReactionArrivalScope, ReactionGlyph, RollingCount, useReactionHost } from "../ChatReactions/ReactionArrival";
import { PointsIcon } from "../LiveViewer/PointsIcon";
import LiveChatEmojiButton from "../LiveChat/LiveChatEmojiButton";

const CHAT_MAX_LENGTH = 240;

export interface ProducerChatActivity {
  status: StreamActivityType | "SYSTEM";
  address?: string;
  createdAt?: number;
  /** Full user reference from socket `user` / REST `account` field. */
  user?: UserReference;
  meta?: Record<string, any> & {
    username?: string;
    content?: string;
    amount?: number;
    avatarImageUrl?: string;
    message?: string;
  };
  optimistic?: boolean;
  /** The chat line's id, once the room has it. */
  id?: string;
  /** emoji -> who reacted. */
  reactions?: Record<string, string[]>;
}

interface ProducerFloatingChatProps {
  activities: ProducerChatActivity[];
  isLive: boolean;
  chatEnabled: boolean;
  canSend: boolean;
  draftScope: string | null;
  onSendMessage: (content: string) => Promise<boolean>;
  onToggleChatEnabled?: () => void;
  settingsUpdating?: boolean;
  /** Hold a line: reactions, who reacted, Copy, Moderate, Delete. */
  onHold?: (activity: ProducerChatActivity, layout: ChatHoldLayout | null) => void;
  /** Tap a reaction: who left it. */
  onShowReactors?: (messageId: string) => void;
  /** The creator's wallet, lower case: their own reaction lands bigger. */
  me?: string;
}

/** Shortened wallet address display */
const shortAddr = (addr?: string): string =>
  addr ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : "";

/** Resolve display name from user ref or meta fallback. */
const resolveDisplayName = (a: ProducerChatActivity): string =>
  a.user?.displayName || a.user?.username || a.meta?.username || shortAddr(a.user?.address || a.address) || _translateCopy("copy.04f8996da763", { defaultValue: "user" });

/** Resolve the avatar from user ref or meta fallback, re-based onto the CDN. */
const resolveAvatarUrl = (a: ProducerChatActivity): string =>
  getAvatarUrl(a.user?.avatarImageUrl || a.meta?.avatarImageUrl);

/** Resolve identifier for profile sheet (prefer username, fallback address). */
const resolveProfileId = (a: ProducerChatActivity): string | undefined =>
  a.user?.username || a.user?.address || a.meta?.username || a.address;

/** Deterministic color palette for usernames (monochrome neutrals ramp) */
const USERNAME_PALETTE = [
  "#F9FBFF",
  "#D4D4D8",
  "#DDE0E3",
  "#F4F4F5",
  "#D4D4D8",
  "#D4D4D8",
  "#D4D4D8",
  "#C2C4C7",
  "#D4D4D8",
  "#D4D4D8",
  "#D4D4D8",
  "#F4F4F5",
  "#D4D4D8",
  "#D4D4D8",
];

const colorForUser = (key?: string): string => {
  if (!key) return "#e5e7eb";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash * 31 + key.charCodeAt(i)) >>> 0);
  }
  return USERNAME_PALETTE[hash % USERNAME_PALETTE.length];
};

/**
 * Messages sit straight on the broadcast now — no bubble behind them — so
 * every line carries its own shadow. Without it a white name over a bright
 * frame is unreadable, and the fix cannot be a slab: the slab is the thing
 * being removed.
 */
const onVideo = {
  textShadowColor: "rgba(0,0,0,0.85)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
} as const;

/** Visible message types (filter join/leave noise) */
const VISIBLE_TYPES = new Set<string>([
  StreamActivityType.MESSAGE,
  StreamActivityType.TIP,
  StreamActivityType.START,
  StreamActivityType.END,
]);

const ProducerFloatingChat: React.FC<ProducerFloatingChatProps> = ({
  activities,
  isLive,
  chatEnabled,
  canSend,
  draftScope,
  onSendMessage,
  onToggleChatEnabled,
  settingsUpdating,
  onHold,
  onShowReactors,
  me,
}) => {
  const { t } = useTranslation();
  const [message, setMessage] = useDraftState(draftScope, "");
  // @tagging: typing @ offers people, picking one fills in "@username ".
  const mentions = useMentions(message, setMessage as (t: string) => void, undefined, false);
  const sending = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<ProducerChatActivity> | null>(null);
  const { showUserProfile } = useUserProfileSheet();
  // Measured against the keys, like every other composer. Lifting by the raw
  // keyboard height ignored where the box sat and, on iPhone, ran alongside
  // the screen's own keyboard pan, which left the box under the keys.
  const composerKeyboard = useComposerKeyboard(0);
  // About a third of the screen: room to read a busy chat while the picture
  // stays clear. A fixed 200 pt was four lines on a Pro Max.
  const { height: windowHeight } = useWindowDimensions();
  const listMaxHeight = Math.round(Math.min(360, Math.max(200, windowHeight * 0.34)));

  const handleUserPress = useCallback(
    (identifier: string) => {
      showUserProfile(identifier, { initialHeightPct: 0.4, source: "producer-chat" } as any);
    },
    [showUserProfile]
  );

  const filteredActivities = useMemo(() => {
    return activities.filter((a) => VISIBLE_TYPES.has(a.status as string) || (a.status === "SYSTEM" && (a.meta?.kind === "reward" || a.meta?.kind === "pointsGift")));
  }, [activities]);

  const dataReversed = useMemo(
    () => filteredActivities.slice().reverse(),
    [filteredActivities]
  );

  const handleSend = useCallback(async () => {
    const content = message.trim();
    if (sending.current || !content || !canSend) return;
    sending.current = true;
    try { if (await onSendMessage(content)) setMessage.complete(message, ""); }
    finally { sending.current = false; }
  }, [message, canSend, onSendMessage, setMessage]);

  const renderItem = useCallback(
    ({ item }: { item: ProducerChatActivity }) => (
      <ChatBubble item={item} onUserPress={handleUserPress} onHold={onHold} onShowReactors={onShowReactors} me={me} />
    ),
    [handleUserPress, onHold, onShowReactors, me]
  );

  const keyExtractor = useCallback(
    (a: ProducerChatActivity, idx: number) => {
      const t = a.createdAt || 0;
      const who = (a.address || a.meta?.username || "").toLowerCase();
      const contentKey =
        a.meta?.content
          ? String(a.meta.content).slice(0, 16)
          : String(a.meta?.amount || "");
      return `${t}:${a.status}:${who}:${contentKey}:${idx}`;
    },
    []
  );

  return (
    <View className="px-3" pointerEvents="box-none" style={{ flexShrink: 1, minHeight: 0 }}>
      {isLive && onToggleChatEnabled ? (
        <View className="flex-row items-center mb-2" pointerEvents="box-none">
          <TouchableOpacity
            onPress={onToggleChatEnabled}
            activeOpacity={0.8}
            disabled={settingsUpdating}
            className={`flex-row items-center px-2.5 py-1 rounded-lg ${
              chatEnabled ? "bg-zinc-900/60" : "bg-white/20"
            }`}
          >
            <MessageCircleOff
              color={chatEnabled ? "#fff" : "rgba(255,255,255,0.5)"}
              size={12}
            />
            <Text className="text-white/70 text-[10px] ml-1 font-medium">
              {chatEnabled ? t("live.chatOn") : t("live.chatOff")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* The list dissolves at its top edge rather than stopping dead. The
          list is inverted, so "top" is the far end of the data — the mask is
          still just a gradient over the viewport, opaque at the bottom. */}
      {/* Reactions fly in over the list, outside the fade so they are never cut. */}
      <ReactionArrivalScope style={{ maxHeight: listMaxHeight, flexShrink: 1, minHeight: 0 }} pointerEvents="box-none">
      <MaskedView
        style={{ maxHeight: listMaxHeight, flexShrink: 1, minHeight: 0 }}
        // box-none, not none: the mask must stay inert but the list underneath
        // has to receive taps and scrolls, or names, avatars and history are dead.
        pointerEvents="box-none"
        maskElement={
          <LinearGradient
            style={{ flex: 1 }}
            colors={["transparent", "#000", "#000"]}
            locations={[0, 0.35, 1]}
          />
        }
      >
        <FlatList
          ref={listRef}
          data={dataReversed}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          inverted
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          maxToRenderPerBatch={16}
          windowSize={5}
          removeClippedSubviews={false}
          keyboardShouldPersistTaps="handled"
        />
      </MaskedView>
      </ReactionArrivalScope>

      {canSend && isLive ? (
        <View style={{ marginTop: 8 }}>
          <MentionSuggestions
            visible={mentions.showSuggestions}
            suggestions={mentions.suggestions}
            onSelect={mentions.selectMention}
            loading={mentions.loading}
          />
        </View>
      ) : null}
      <View
        ref={composerKeyboard.ref}
        collapsable={false}
        onLayout={composerKeyboard.onLayout}
        className="flex-row items-center mt-2 rounded-xl px-3.5 py-2 bg-zinc-900/60"
        style={{ marginBottom: composerKeyboard.lift, minHeight: 44 }}
      >
        <TextInput
          ref={inputRef}
          value={message}
          onChangeText={mentions.handleChangeText}
          onSelectionChange={mentions.handleSelectionChange}
          placeholder={
            isLive && canSend ? t("live.saySomething") : t("live.chatUnavailable")
          }
          placeholderTextColor="#8B8D90"
          className="flex-1 text-white text-sm leading-5"
          editable={canSend && isLive}
          maxLength={CHAT_MAX_LENGTH}
          multiline={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        {canSend && isLive ? (
          <LiveChatEmojiButton
            inputRef={inputRef}
            onSelect={(emoji) => {
              setMessage((draft) => draft.length + emoji.length <= CHAT_MAX_LENGTH ? draft + emoji : draft);
              mentions.reset();
            }}
          />
        ) : null}
        <TouchableOpacity
          onPress={handleSend}
          disabled={!message.trim() || !canSend}
          activeOpacity={0.8}
          className="ml-2"
          style={!message.trim() || !canSend ? { opacity: 0.3 } : undefined}
        >
          <ArrowUpCircle color="#fff" size={26} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

/** Individual chat bubble */
const ChatBubble: React.FC<{
  item: ProducerChatActivity;
  onUserPress: (id: string) => void;
  onHold?: (activity: ProducerChatActivity, layout: ChatHoldLayout | null) => void;
  onShowReactors?: (messageId: string) => void;
  me?: string;
}> = memo(
  ({ item, onUserPress, onHold, onShowReactors, me }) => {
    const { t } = useTranslation();
    const displayName = resolveDisplayName(item);
    const avatarUrl = resolveAvatarUrl(item);
    const profileId = resolveProfileId(item);

    const handlePress = useCallback(() => {
      if (profileId) onUserPress(profileId);
    }, [profileId, onUserPress]);

    // Hold a line, measured so the sheet keeps it in view (as viewers get).
    const rowRef = useRef<View>(null);
    const canHold = !!onHold && !!item.id && !item.optimistic;
    const handleHold = useCallback(() => {
      if (!onHold || !item.id) return;
      const row = rowRef.current;
      if (!row) { onHold(item, null); return; }
      let done = false;
      const fallback = setTimeout(() => { if (!done) { done = true; onHold(item, null); } }, 120);
      row.measureInWindow((x, y, width, height) => {
        if (done) return;
        done = true;
        clearTimeout(fallback);
        onHold(item, width ? { x, y, width, height } : null);
      });
    }, [onHold, item]);
    const reactionEntries = useMemo(
      () => Object.entries(item.reactions ?? {}).filter(([, who]) => who?.length > 0),
      [item.reactions],
    );
    useReactionHost(item.id);

    switch (item.status) {
      case StreamActivityType.MESSAGE: {
        return (
          <Pressable
            ref={rowRef}
            collapsable={false}
            onLongPress={canHold ? handleHold : undefined}
            delayLongPress={300}
            disabled={!canHold}
            className="mb-1.5 px-0.5 py-1 self-start max-w-[92%]"
          >
          <View className="flex-row items-start">
            <TouchableOpacity onPress={handlePress} onLongPress={canHold ? handleHold : undefined} delayLongPress={300} activeOpacity={0.7} className="mr-1.5 mt-0.5">
              <Avatar uri={avatarUrl} size={18} name={displayName} />
            </TouchableOpacity>
            <Text
              className="text-[11px] font-bold mr-1.5"
              style={{ color: colorForUser(displayName), ...onVideo }}
              numberOfLines={1}
              onPress={handlePress}
              onLongPress={canHold ? handleHold : undefined}
            >
              {displayName}
            </Text>
            <Text
              className={`text-white text-[11px] flex-1 flex-shrink ${
                item.optimistic ? "opacity-60" : ""
              }`}
              style={onVideo}
              numberOfLines={3}
            >
              {item.meta?.content}
            </Text>
            {item.optimistic ? (
              <Text className="text-white/30 text-[9px] ml-1">...</Text>
            ) : null}
          </View>
          {reactionEntries.length > 0 && item.id ? (
            <View className="mt-1 flex-row flex-wrap gap-1" style={{ marginLeft: 24 }}>
              {reactionEntries.map(([emoji, who]) => (
                <Pressable
                  key={emoji}
                  disabled={!onShowReactors}
                  onPress={() => { if (item.id) onShowReactors?.(item.id); }}
                  onLongPress={canHold ? handleHold : undefined}
                  delayLongPress={300}
                  hitSlop={6}
                  className="flex-row items-center rounded-full px-1.5 py-0.5"
                  style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
                >
                  <ReactionGlyph messageId={item.id!} emoji={emoji} addresses={who} me={me} size={11} />
                  {who.length > 1 ? <View style={{ marginLeft: 3 }}><RollingCount value={who.length} style={{ ...onVideo, color: "#fff", fontSize: 10 }} /></View> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          </Pressable>
        );
      }
      case StreamActivityType.TIP: {
        return (
          <View className="flex-row items-center mb-1.5 bg-white/10 rounded-xl px-2.5 py-1.5 self-start max-w-[85%] border border-white/20">
            <TouchableOpacity onPress={handlePress} activeOpacity={0.7} className="mr-1.5">
              <Avatar uri={avatarUrl} size={18} name={displayName} />
            </TouchableOpacity>
            <Text className="text-white text-[11px] font-semibold" onPress={handlePress}>
              {displayName}
            </Text>
            <Text className="text-white/70 text-[11px] ml-1">
              {t("live.tippedAmount", { amount: item.meta?.amount })} <DhbCoin />
            </Text>
          </View>
        );
      }
      case StreamActivityType.START:
        return (
          <View className="mb-1.5 self-start">
            <Text className="text-white/50 text-[10px]" style={onVideo}>
              {t("live.streamStarted")}
            </Text>
          </View>
        );
      case StreamActivityType.END:
        return (
          <View className="mb-1.5 self-start">
            <Text className="text-white/50 text-[10px]" style={onVideo}>
              {t("live.streamEnded")}
            </Text>
          </View>
        );
      case "SYSTEM": {
        // One viewer gave another channel points.
        if (item.meta?.kind === "pointsGift") {
          return (
            <View className="flex-row items-center mb-1.5 bg-white/10 rounded-xl px-2.5 py-1.5 self-start max-w-[88%] border border-white/20" testID="producer-chat-points-gift">
              <TouchableOpacity onPress={handlePress} activeOpacity={0.7} className="mr-1.5">
                <Avatar uri={avatarUrl} size={18} name={displayName} />
              </TouchableOpacity>
              <PointsIcon size={12} color="rgba(255,255,255,0.85)" />
              <Text className="text-white text-[11px] ml-1 flex-shrink" numberOfLines={2}>
                <Text className="font-semibold" onPress={handlePress}>{displayName}</Text>{" "}
                <Text style={{ color: "rgba(255,255,255,0.7)" }}>
                  {t("livePoints.give.chatLine", { amount: formatCount(Number(item.meta?.pointsAmount) || 0), name: String(item.meta?.recipientName || "") })}
                </Text>
              </Text>
            </View>
          );
        }
        // A viewer spent channel points on one of your rewards.
        if (item.meta?.kind !== "reward") return null;
        return (
          <View className="flex-row items-start mb-1.5 bg-white/10 rounded-xl px-2.5 py-1.5 self-start max-w-[88%] border border-white/20" testID="producer-chat-reward">
            <TouchableOpacity onPress={handlePress} activeOpacity={0.7} className="mr-1.5">
              <Avatar uri={avatarUrl} size={18} name={displayName} />
            </TouchableOpacity>
            <View className="flex-1 flex-shrink">
              <View className="flex-row items-center" style={{ gap: 4 }}>
                <PointsIcon size={12} color="rgba(255,255,255,0.85)" />
                <Text className="text-white text-[11px] flex-shrink" numberOfLines={2}>
                  <Text className="font-semibold" onPress={handlePress}>{displayName}</Text>{" "}
                  <Text style={{ color: "rgba(255,255,255,0.7)" }}>{t("livePoints.chatRedeemedShort")}</Text>{" "}
                  <Text className="font-semibold">{item.meta?.rewardTitle}</Text>
                </Text>
              </View>
              {item.meta?.content ? (
                <Text className="text-white/80 text-[11px] mt-0.5" numberOfLines={3}>{item.meta.content}</Text>
              ) : null}
            </View>
          </View>
        );
      }
      default:
        return null;
    }
  }
);

export default memo(ProducerFloatingChat);
