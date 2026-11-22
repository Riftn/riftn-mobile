import { openMessageReport } from "../common/MessageReportHost";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import HoldSheet, { type HoldReactionChip, type HoldTile } from "../ui/HoldSheet";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getAccount } from "../../services/user.service";
import { useProfileLocalTime } from "../../hooks/useProfileLocalTime";
import { copyToClipboard } from "../../libs/clipboard.utils";
import { canLinkMessage, copyLinkLabel } from "../../libs/chatMessageLink";
import { copyMessageMedia } from "../../libs/copyMessageMedia";
import { buildCdnPath } from "../../libs/misc";
import type { LiveChatMessageData } from "../../services/livechat.service";
import EmojiSheet from "../Upload/EmojiSheet";

import type { TranslateToggle } from "../ui/TranslateButton";

export interface MessageLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LiveChatContextMenuProps {
  visible: boolean;
  message: LiveChatMessageData | null;
  layout: MessageLayout | null;
  isMe: boolean;
  /** The viewer's address, for marking which reactions are already theirs. */
  viewerAddress?: string;
  isModerator: boolean;
  onClose: () => void;
  onReply?: (msg: LiveChatMessageData) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onEdit?: (msg: LiveChatMessageData) => void;
  onDelete?: (msg: LiveChatMessageData) => void;
  onPin?: (msg: LiveChatMessageData) => void;
  /** Open the chat search on everything this message's author has said. */
  onSeeMessages?: (msg: LiveChatMessageData) => void;
  /** "Copy link": a riftn.com link that opens this chat on this line. */
  onCopyLink?: (msg: LiveChatMessageData) => void;
  /** Whether this message's author is on the room's ban list, so a moderator is offered Unban instead. */
  isSenderBanned?: boolean;
  onBan?: (msg: LiveChatMessageData) => void;
  onUnban?: (msg: LiveChatMessageData) => void;
  /** Translate / Show original — set only when the line is in another language. */
  translate?: TranslateToggle;
  /** How far the screen should slide its list up so the held line clears the sheet (0 to settle back). */
  onLift?: (px: number) => void;
  /** Open the list of who reacted to this line. */
  onShowReactors?: (messageId: string) => void;
}

const REACTION_EMOJIS = ["🔥", "❤️", "😂", "👀", "💯", "🙌"];

/* ─── Hold sheet ─────────────────────────────────────────────
 * Holding a line keeps that line where it is (no copy of it is drawn), dims
 * the rest of the chat, lifts the list so the line sits just above a glass
 * sheet, and the sheet carries the reactions and actions. The old menu drew a
 * second card of the message over the real one, which on Android (no blur)
 * read as the message twice, with its reply quote repeated again.
 * Mirrors dehubweb ChatHoldSheet.
 * ──────────────────────────────────────────────────────────── */

const LiveChatContextMenuComponent: React.FC<LiveChatContextMenuProps> = ({
  visible,
  message,
  layout,
  isMe,
  viewerAddress,
  isModerator,
  onClose,
  onReply,
  onReact,
  onEdit,
  onDelete,
  onPin,
  onSeeMessages,
  onCopyLink,
  isSenderBanned,
  onBan,
  onUnban,
  translate,
  onLift,
  onShowReactors,
}) => {
  const { t } = useTranslation();
  const authorAddress = message?.senderAddress;
  const { data: authorTimeZone } = useQuery({
    queryKey: ["chat-author-timezone", authorAddress],
    enabled: visible && !!authorAddress && message?.messageType !== "system",
    staleTime: 60_000,
    queryFn: async () => (await getAccount(authorAddress!))?.data?.result?.customs?.publicTimeZone ?? null,
  });
  const authorLocalTime = useProfileLocalTime(authorTimeZone);
  // Message whose full emoji picker is open. The menu closes first: iOS will
  // not stack a second modal on one that is still presenting.
  const [moreFor, setMoreFor] = useState<LiveChatMessageData | null>(null);
  const moreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (moreTimer.current) clearTimeout(moreTimer.current);
  }, []);

  const run = useCallback((fn?: () => void, delay = 150) => {
    onClose();
    if (fn) setTimeout(fn, delay);
  }, [onClose]);

  const handleReaction = useCallback(
    (emoji: string) => {
      if (!message) return;
      onReact?.(message._id, emoji);
      onClose();
    },
    [message, onReact, onClose],
  );

  const viewer = viewerAddress?.toLowerCase();
  const moreSheet = (
    <EmojiSheet
      visible={!!moreFor}
      onClose={() => setMoreFor(null)}
      selected={
        moreFor && viewer
          ? Object.entries(moreFor.reactions ?? {})
              .filter(([, addresses]) => addresses?.some((a) => a.toLowerCase() === viewer))
              .map(([emoji]) => emoji)
          : undefined
      }
      onSelect={(emoji) => {
        if (moreFor) onReact?.(moreFor._id, emoji);
      }}
    />
  );

  // Stays mounted while closed so the sheet can play its way out.
  if (!visible || !message) {
    return (
      <>
        <HoldSheet visible={false} layout={null} onClose={onClose} reactions={null} tiles={[]} onLift={onLift} frame inline />
        {moreSheet}
      </>
    );
  }

  const hasContent = !!message.content?.trim();
  // The API only rewrites a text body — a caption on a photo, GIF or voice
  // note is refused, so offering Edit there is a button that can only fail.
  const canEdit = isMe && message.messageType === "text" && hasContent;
  const canDelete = isMe || isModerator;
  // The viewer's own address, not the author's.
  const myAddress = viewer;

  const tiles: HoldTile[] = [];
  // Reply lands at once: the reply strip and the keyboard rise while the
  // sheet slides away, instead of the list dropping back and then jumping up.
  if (onReply) tiles.push({ key: "reply", icon: "Reply", label: t("liveChat.reply"), prime: true, onPress: () => { onReply(message); onClose(); } });
  if (hasContent) tiles.push({ key: "copy", icon: "Copy", label: t("common.copy"), onPress: () => { copyToClipboard(message.content); onClose(); } });
  if (onCopyLink && canLinkMessage(message._id)) tiles.push({ key: "copy-link", icon: "Link", label: copyLinkLabel(), onPress: () => { onCopyLink(message); onClose(); } });
  if (onSeeMessages && message.senderAddress && message.messageType !== "system") tiles.push({
    key: "their-messages",
    icon: "Search",
    label: t("chatSearch.theirMessages", { defaultValue: "Their messages" }),
    onPress: () => run(() => onSeeMessages(message)),
  });
  if (translate) tiles.push({
    key: "translate",
    icon: translate.isTranslated ? "RotateCcw" : "Languages",
    label: translate.isTranslated ? t("common.showOriginal") : t("common.translate"),
    onPress: () => { onClose(); translate.toggle(); },
  });
  // A photo or GIF can be copied as itself, not just its caption.
  const firstMedia = message.media?.[0];
  const rawMedia = message.messageType === "gif" ? (message.gif?.url || firstMedia?.url) : message.messageType === "media" ? firstMedia?.url : undefined;
  const mediaUrl = rawMedia ? (/^https?:/.test(rawMedia) ? rawMedia : buildCdnPath(rawMedia) ?? null) : null;
  if (mediaUrl && /^https?:/.test(mediaUrl)) {
    const kind = message.messageType === "gif" || firstMedia?.type === "gif" || firstMedia?.mimeType === "image/gif" ? "gif" as const : "image" as const;
    tiles.push({ key: "copy-media", icon: "Images", label: t("dm.copyMedia", { defaultValue: "Copy media" }), onPress: () => { onClose(); void copyMessageMedia(mediaUrl, kind); } });
  }
  if (canEdit && onEdit) tiles.push({ key: "edit", icon: "Pencil", label: t("common.edit"), onPress: () => run(() => onEdit(message)) });
  if (isModerator && onPin) tiles.push({
    key: "pin",
    icon: message.isPinned ? "PinOff" : "Pin",
    label: message.isPinned ? t("liveChat.unpinMessage") : t("liveChat.pinMessage"),
    secondary: true,
    onPress: () => run(() => onPin(message), 100),
  });
  if (isModerator && !isMe && (isSenderBanned ? onUnban : onBan)) tiles.push({
    key: "ban",
    icon: isSenderBanned ? "ShieldCheck" : "Ban",
    label: isSenderBanned ? t("publicChat.unbanUser") : t("publicChat.banUser"),
    destructive: !isSenderBanned,
    secondary: true,
    onPress: () => run(() => (isSenderBanned ? onUnban : onBan)?.(message), 100),
  });
  if (canDelete && onDelete) tiles.push({ key: "delete", icon: "Trash2", label: t("common.delete"), destructive: true, secondary: true, onPress: () => run(() => onDelete(message), 100) });
  // Every viewer can report a message (App Review 1.2), not only moderators.
  if (!isMe && message.senderAddress) tiles.push({
    key: "report",
    icon: "Flag",
    label: t("postOptions.report"),
    destructive: true,
    secondary: true,
    onPress: () => {
      onClose();
      openMessageReport({
        userId: message.senderAddress,
        userName: message.sender?.displayName || message.sender?.username,
        where: "Live chat",
        messageId: message._id,
        text: message.content,
      });
    },
  });

  const reactions: HoldReactionChip[] | null = onReact
    ? REACTION_EMOJIS.map((emoji) => ({
        key: emoji,
        emoji,
        selected: !!myAddress && (message.reactions?.[emoji]?.some((a) => a?.toLowerCase() === myAddress) ?? false),
      }))
    : null;

  // Who reacted, Telegram style: the reactions and how many people, a tap away from the list.
  const reacted = Object.entries(message.reactions ?? {}).filter(([, who]) => (who?.length ?? 0) > 0).sort((a, b) => b[1].length - a[1].length);
  const people = new Set(reacted.flatMap(([, who]) => who.map((a) => a?.toLowerCase()))).size;
  const summary = onShowReactors && people > 0
    ? {
        emojis: reacted.map(([emoji]) => emoji),
        label: t("reactions.count", { count: people }),
        onPress: () => {
          const id = message._id;
          onClose();
          setTimeout(() => onShowReactors(id), 300);
        },
      }
    : null;

  return (
    <>
      <HoldSheet
        visible
        layout={layout}
        onClose={onClose}
        reactions={reactions}
        onReaction={handleReaction}
        onMore={() => {
          const msg = message;
          onClose();
          if (moreTimer.current) clearTimeout(moreTimer.current);
          moreTimer.current = setTimeout(() => setMoreFor(msg), 350);
        }}
        tiles={tiles}
        scrollActions
        summary={summary}
        meta={authorLocalTime ? t("profile.localTime", { defaultValue: "Local time {{time}}", time: authorLocalTime }) : undefined}
        onLift={onLift}
        frame
        inline
      />
      {moreSheet}
    </>
  );
};

export const LiveChatContextMenu = memo(LiveChatContextMenuComponent);
export default LiveChatContextMenu;
