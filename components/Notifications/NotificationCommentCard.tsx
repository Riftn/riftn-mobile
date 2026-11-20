/**
 * The comment a notification is about, in full, with Reply / Like / Tip.
 *
 * A reply row used to be one sentence and a thumbnail, so answering somebody
 * meant leaving Notifications for the post. The list now carries the comment
 * itself (the server attaches `comment` to rows about one): its whole text,
 * its picture or GIF, and the reader's own reaction. Reply opens a small box
 * under it, Like reacts in place, Tip opens the tip sheet aimed at the
 * comment's author, and the arrow opens the post at that comment. A clip or
 * voice note shows as a tile that opens the post, where it plays.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useOnDemandTranslate } from "../../hooks/useOnDemandTranslate";
import { Pressable, Text, TextInput, View, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import SmartImage from "../common/SmartImage";
import GlassTipSheet from "../Tip/GlassTipSheet";
import { TipGemIcon } from "../Home/TipGemIcon";
import { buildCdnPath, toastError, toastSuccess } from "../../libs";
import { postComment, reactComment } from "../../services/nft.service";
import { useGrowingTextInput } from "../../hooks/useGrowingTextInput";
import { useAppTheme } from "../../context/ThemeContext";
import { DIGITAL_PURCHASES_ENABLED } from "../../config/storefront";
import type { NotificationItem } from "../../services/user.service";

/** Rows about somebody else's comment: those get Reply / Like / Tip. */
const ACTIONABLE = new Set(["comment", "comment_reply", "creator_comment_reply", "mention"]);

const media = (key?: string | null): string | undefined => {
  if (!key) return undefined;
  if (/^(https?:|file:|\/)/.test(key)) return key;
  return buildCdnPath(key) ?? key;
};

export function notificationHasComment(item: NotificationItem): boolean {
  const c = item.comment;
  return !!c && ACTIONABLE.has(item.type as string) && !!(c.content?.trim() || c.imageUrl || c.gifUrl || c.videoUrl || c.audioUrl);
}

const MUTED = "#8B8D90";

interface Props {
  item: NotificationItem;
  viewerAddress?: string | null;
  /** Opens the post at this comment (the row's own tap). */
  onOpen: (item: NotificationItem) => void;
  /** Marks the row read the first time the reader acts on it. */
  onEngaged?: (item: NotificationItem) => void;
  /** Show the text in the reader's language (row long press → Translate). */
  translate?: boolean;
}

function NotificationCommentCardBase({ item, viewerAddress, onOpen, onEngaged, translate = false }: Props) {
  const { t } = useTranslation();
  const { skin, accent } = useAppTheme();
  const comment = item.comment!;
  const commentId = String(comment.id ?? item.commentId);
  const tokenId = item.tokenId ?? comment.tokenId;
  const author = (comment.address || item.actorAddress || "").toLowerCase();
  const isOwn = !!viewerAddress && author === viewerAddress.toLowerCase();
  const actionable = !isOwn && tokenId != null;
  const activeInk = skin ? `rgb(${accent.join(",")})` : "#F4F4F5";
  // Ink on the accent fill. Written in System's colours (black on white);
  // System Light's tone pass flips both, as it does for the Accept pill.
  const sendInk = "#000000";

  const shown = useOnDemandTranslate((comment.content || "").trim(), translate);
  const [liked, setLiked] = useState(comment.myReaction ? comment.myReaction !== "dislike" : !!comment.isLiked);
  const [likes, setLikes] = useState(comment.likeCount ?? 0);
  const [liking, setLiking] = useState(false);
  const [replies, setReplies] = useState(comment.replyCount ?? 0);
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const grow = useGrowingTextInput(draft, 22, 120);

  // The list recycles rows: a row reused for another notification starts fresh.
  useEffect(() => {
    setLiked(comment.myReaction ? comment.myReaction !== "dislike" : !!comment.isLiked);
    setLikes(comment.likeCount ?? 0);
    setReplies(comment.replyCount ?? 0);
    setReplyOpen(false);
    setDraft("");
    setTipOpen(false);
  }, [item._id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (replyOpen) {
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
  }, [replyOpen]);

  const engaged = useCallback(() => onEngaged?.(item), [onEngaged, item]);

  const toggleLike = useCallback(async () => {
    if (liking) return;
    engaged();
    const next = !liked;
    setLiked(next);
    setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    setLiking(true);
    try {
      const res = await reactComment({ commentId, reaction: "like" });
      if (res && typeof res.likes === "number") setLikes(res.likes);
      if (res && typeof res.liked === "boolean") setLiked(res.liked);
    } catch {
      setLiked(!next);
      setLikes((n) => Math.max(0, n + (next ? -1 : 1)));
    } finally {
      setLiking(false);
    }
  }, [liking, liked, commentId, engaged]);

  const replyTo = item.actor?.username || item.actorUsername;

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending || tokenId == null) return;
    setSending(true);
    try {
      await postComment({
        streamTokenId: Number(tokenId),
        content: replyTo && !body.startsWith("@") ? `@${replyTo} ${body}` : body,
        commentId,
      });
      setDraft("");
      setReplyOpen(false);
      setReplies((n) => n + 1);
      toastSuccess(t("toasts.comment_posted"));
    } catch (e) {
      toastError((e as Error)?.message || t("toasts.failed_to_post_comment"));
    } finally {
      setSending(false);
    }
  }, [draft, sending, tokenId, replyTo, commentId, t]);

  const text = shown.text;
  const image = media(comment.imageUrl || comment.gifUrl);
  const hasClip = !!comment.videoUrl;
  const hasVoice = !!comment.audioUrl;

  return (
    <View style={{ marginTop: 6 }}>
      {!!text && (
        <Text className="text-theme-neutrals-100" style={{ fontSize: 14.5, lineHeight: 20 }}>
          {text}
        </Text>
      )}

      {!!image && (
        <Pressable onPress={() => onOpen(item)} style={{ marginTop: 8, alignSelf: "flex-start" }}>
          <SmartImage
            source={{ uri: image }}
            style={{ width: 220, height: 220, borderRadius: 12, backgroundColor: "#18181B" }}
            contentFit="cover"
            recyclingKey={`${item._id}:img`}
            transition={120}
          />
        </Pressable>
      )}

      {(hasClip || hasVoice) && (
        <Pressable
          onPress={() => onOpen(item)}
          className="bg-theme-neutrals-800"
          style={{ marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16 }}
        >
          <Icon name={hasClip ? "Play" : "Mic"} size={13} color="#F4F4F5" />
          <Text style={{ color: "#F4F4F5", fontSize: 13, fontWeight: "600" }}>
            {hasClip ? t("audioPost.play") : t("dm.voiceNote")}
          </Text>
        </Pressable>
      )}

      {actionable && (
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, marginLeft: -8 }}>
          <Pressable
            onPress={() => { engaged(); setReplyOpen((v) => !v); }}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t("communities.reply")}
            style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 32, paddingHorizontal: 8 }}
          >
            <Icon name="MessageSquare" size={17} color={replyOpen ? activeInk : MUTED} strokeWidth={1.8} />
            {replies > 0 && <Text style={{ fontSize: 13, color: MUTED }}>{replies}</Text>}
          </Pressable>
          <Pressable
            onPress={toggleLike}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityState={{ selected: liked }}
            accessibilityLabel={t("reactionInfo.labels.like")}
            style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 32, paddingHorizontal: 8 }}
          >
            <Icon name="ThumbsUp" size={17} color={liked ? activeInk : MUTED} fill={liked ? activeInk : undefined} strokeWidth={1.8} />
            {likes > 0 && <Text style={{ fontSize: 13, color: liked ? activeInk : MUTED }}>{likes}</Text>}
          </Pressable>
          {DIGITAL_PURCHASES_ENABLED && !!author && (
            <Pressable
              onPress={() => { engaged(); setTipOpen(true); }}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t("comments.tip")}
              style={{ flexDirection: "row", alignItems: "center", height: 32, paddingHorizontal: 8 }}
            >
              <TipGemIcon tipped={false} burstKey={0} size={17} color={MUTED} />
            </Pressable>
          )}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => { engaged(); onOpen(item); }}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t("converter.viewPost")}
            style={{ height: 32, paddingHorizontal: 8, justifyContent: "center" }}
          >
            <Icon name="ArrowUpRight" size={17} color={MUTED} strokeWidth={1.8} />
          </Pressable>
        </View>
      )}

      {actionable && replyOpen && (
        <View
          className="bg-theme-neutrals-800 border-theme-neutrals-700"
          style={{ marginTop: 4, flexDirection: "row", alignItems: "flex-end", gap: 8, borderRadius: 18, borderWidth: 1, paddingLeft: 12, paddingRight: 5, paddingVertical: 5 }}
        >
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={500}
            placeholder={replyTo
              ? t("governance.discussion.replyingTo", { name: `@${replyTo}` })
              : t("comments.replyPlaceholder")}
            placeholderTextColor={MUTED}
            className="text-theme-neutrals-100"
            onContentSizeChange={grow.onContentSizeChange}
            scrollEnabled={grow.scrollEnabled}
            style={[{ flex: 1, fontSize: 14.5, paddingTop: 6, paddingBottom: 6 }, grow.sizeStyle()]}
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel={t("tip.send")}
            // Same fill as the follow-request Accept pill: the theme's colour
            // on the canvas skins, the page ink on System / System Light.
            className={skin ? undefined : "bg-theme-accent"}
            style={[
              { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", opacity: !draft.trim() || sending ? 0.4 : 1 },
              skin ? { backgroundColor: activeInk } : null,
            ]}
          >
            {sending
              ? <ActivityIndicator size="small" color={skin ? "#FFFFFF" : sendInk} />
              : <Icon name="Send" size={15} color={skin ? "#FFFFFF" : sendInk} />}
          </Pressable>
        </View>
      )}

      {DIGITAL_PURCHASES_ENABLED && actionable && tipOpen && (
        <GlassTipSheet
          visible={tipOpen}
          onClose={() => setTipOpen(false)}
          toAddress={author}
          tokenId={Number(tokenId) || 0}
          recipientName={item.actor?.displayName || replyTo}
          tipContext="user"
          commentId={Number(commentId) || undefined}
        />
      )}
    </View>
  );
}

export const NotificationCommentCard = memo(NotificationCommentCardBase);
export default NotificationCommentCard;
