/**
 * Hold a line in your own stream's chat while you are live from the app: the
 * same sheet viewers and Public Chat get. Quick reactions and every emoji,
 * who reacted, Copy, Delete (any line, it is your room), Moderate (timeouts,
 * ban, make moderator) and Report.
 */
import React, { useCallback, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

import HoldSheet, { type HoldTile } from "../ui/HoldSheet";
import EmojiSheet from "../Upload/EmojiSheet";
import DeleteMessageSheet, { resolveDelete, type DeleteRequest } from "../DM/DeleteMessageSheet";
import CommentLikersSheet from "../Comments/CommentLikersSheet";
import { SettingsOptionModal } from "../Settings/SettingsPrimitives";
import { openMessageReport } from "../common/MessageReportHost";
import { copyToClipboard } from "../../libs/clipboard.utils";
import { toastError, toastSuccess } from "../../libs";
import { hideLineForMe } from "../../libs/public-chat-hidden";
import { addStreamModerator, banFromStreams, timeOutInStream } from "../../services/livechat.service";
import type { ChatHoldLayout } from "../LiveViewer/LiveViewerChat";
import type { ProducerChatActivity } from "./ProducerFloatingChat";

const QUICK = ["\u{1F525}", "❤️", "\u{1F602}", "\u{1F440}", "\u{1F4AF}", "\u{1F64C}"];

export interface ProducerHeld { activity: ProducerChatActivity; layout: ChatHoldLayout | null }

interface Props {
  held: ProducerHeld | null;
  onClose: () => void;
  /** The creator's wallet, lower case. */
  me: string;
  tokenId: number | null | undefined;
  /** Reactions as the room holds them now, by message id. */
  reactionsOf: (id: string) => Record<string, string[]> | undefined;
  addReaction: (id: string, emoji: string) => void;
  removeReaction: (id: string, emoji: string) => void;
  deleteMessage: (id: string) => void;
  /** Platform moderators can only be timed out or banned by a super moderator. */
  canModerateUser?: (address?: string | null) => boolean;
}

export default function ProducerChatHold({ held, onClose, me, tokenId, reactionsOf, addReaction, removeReaction, deleteMessage, canModerateUser }: Props) {
  const { t } = useTranslation();
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const [reactorsFor, setReactorsFor] = useState<string | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const [modFor, setModFor] = useState<{ address: string; name: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // The hold sheet is a modal; the next one opens once it has slid away.
  const after = useCallback((fn: () => void) => {
    onClose();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, 350);
  }, [onClose]);

  const mine = useCallback((id: string, emoji: string) => !!me && (reactionsOf(id)?.[emoji] ?? []).some((a) => a?.toLowerCase() === me), [me, reactionsOf]);
  const toggle = useCallback((id: string, emoji: string) => {
    if (mine(id, emoji)) removeReaction(id, emoji);
    else addReaction(id, emoji);
  }, [mine, addReaction, removeReaction]);

  const id = held?.activity.id;
  const text = String(held?.activity.meta?.content || "");
  const address = String(held?.activity.user?.address || held?.activity.address || "").toLowerCase();
  const name = held?.activity.user?.displayName || held?.activity.user?.username || held?.activity.meta?.username || "";
  const reactions = id ? reactionsOf(id) : undefined;

  const tiles: HoldTile[] = [];
  if (held && id) {
    if (text) tiles.push({ key: "copy", icon: "Copy", label: t("common.copy"), onPress: () => { copyToClipboard(text); onClose(); } });
    if (address && address !== me && tokenId != null && (canModerateUser?.(address) ?? true)) tiles.push({
      key: "moderate", icon: "ShieldCheck", label: t("liveChatModeration.title"),
      onPress: () => after(() => setModFor({ address, name })),
    });
    if (address && address !== me) tiles.push({
      key: "report", icon: "Flag", label: t("postOptions.report"), destructive: true, secondary: true,
      onPress: () => after(() => openMessageReport({ userId: address, userName: name || undefined, where: "Live stream chat", messageId: id, text })),
    });
    tiles.push({
      key: "delete", icon: "Trash2", label: t("common.delete"), destructive: true, secondary: true,
      onPress: () => after(() => setDeleteRequest(resolveDelete({
        count: 1,
        canDeleteForEveryone: true,
        onDelete: (scope) => { if (scope === "everyone") deleteMessage(id); else hideLineForMe(me, id); },
      }))),
    });
  }
  const reacted = Object.entries(reactions ?? {}).filter(([, who]) => (who?.length ?? 0) > 0).sort((a, b) => b[1].length - a[1].length);
  const people = new Set(reacted.flatMap(([, who]) => who.map((a) => a?.toLowerCase()))).size;

  const moderate = useCallback(async (choice: string) => {
    const target = modFor;
    setModFor(null);
    if (!target || tokenId == null) return;
    try {
      if (choice === "ban") { await banFromStreams(tokenId, target.address); toastSuccess(t("liveChatModeration.banned")); }
      else if (choice === "moderator") { await addStreamModerator(target.address); toastSuccess(t("liveChatModeration.madeModerator")); }
      else { await timeOutInStream(tokenId, target.address, Number(choice)); toastSuccess(t("liveChatModeration.timedOut")); }
    } catch {
      toastError(t("liveChatModeration.failed"));
    }
  }, [modFor, tokenId, t]);

  return (
    <>
      <HoldSheet
        visible={!!held && !!id}
        layout={held?.layout ?? null}
        onClose={onClose}
        reactions={id && me ? QUICK.map((emoji) => ({ key: emoji, emoji, selected: mine(id, emoji) })) : null}
        onReaction={(emoji) => { if (id) toggle(id, emoji); onClose(); }}
        onMore={id && me ? () => after(() => setMoreFor(id)) : undefined}
        summary={id && people > 0 ? { emojis: reacted.map(([emoji]) => emoji), label: t("reactions.count", { count: people }), onPress: () => after(() => setReactorsFor(id)) } : null}
        tiles={tiles}
        scrollActions
      />
      <EmojiSheet
        visible={!!moreFor}
        onClose={() => setMoreFor(null)}
        selected={moreFor ? Object.keys(reactionsOf(moreFor) ?? {}).filter((emoji) => mine(moreFor, emoji)) : undefined}
        onSelect={(emoji) => { if (moreFor) toggle(moreFor, emoji); }}
      />
      <CommentLikersSheet visible={!!reactorsFor} onClose={() => setReactorsFor(null)} commentId={null} chatMessageId={reactorsFor} />
      <DeleteMessageSheet request={deleteRequest} onClose={() => setDeleteRequest(null)} />
      <SettingsOptionModal
        visible={!!modFor}
        onClose={() => setModFor(null)}
        title={modFor?.name || t("liveChatModeration.title")}
        value=""
        options={[
          { value: "60", label: t("liveChatModeration.timeout1m") },
          { value: "600", label: t("liveChatModeration.timeout10m") },
          { value: "3600", label: t("liveChatModeration.timeout1h") },
          { value: "ban", label: t("liveChatModeration.ban") },
          { value: "moderator", label: t("liveChatModeration.makeModerator") },
        ]}
        onSelect={(choice) => void moderate(choice)}
      />
    </>
  );
}
