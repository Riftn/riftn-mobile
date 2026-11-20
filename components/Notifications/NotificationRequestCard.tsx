/**
 * What a Requests-board notification is about, with Reply / Like or Upvote.
 *
 * A comment row shows the comment itself, whole, with its picture; a clip or
 * voice note is a tile that opens the board at it. Reply answers it in its
 * thread and Like reacts in place. A new request shows its whole description
 * and first picture; Upvote votes for it and Reply leaves a comment on it.
 * The arrow opens the board at the request (the row's own tap).
 */
import React, { memo, useEffect, useRef, useState } from "react";
import { useOnDemandTranslate } from "../../hooks/useOnDemandTranslate";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import Icon from "../ui/Icon";
import SmartImage from "../common/SmartImage";
import { toastSuccess } from "../../libs";
import { useUser } from "../../context/AuthContext";
import { useAppTheme } from "../../context/ThemeContext";
import { useGrowingTextInput } from "../../hooks/useGrowingTextInput";
import { useFeatureThreadActions, type FeatureCommentRow } from "../../hooks/useFeatureRequestThread";
import { useUserVotes, useVoteFeatureRequest } from "../../hooks/useFeatureRequests";
import { isPositiveReaction, type PostReaction } from "../../libs/reactions";
import { loadRequest, loadRequestComment, REQUEST_COMMENT_ACTIONABLE } from "../../libs/notification-request";
import type { NotificationItem } from "../../services/user.service";

const MUTED = "#8B8D90";

type Row = NotificationItem & { customReferenceId?: string; customReferenceTitle?: string; customCommentId?: string };

const positive = (r: PostReaction | null) => {
  if (!r) return false;
  try { return isPositiveReaction(r); } catch { return false; }
};

interface Props {
  item: NotificationItem;
  /** Opens the board at this request or comment (the row's own tap). */
  onOpen: (item: NotificationItem) => void;
  /** Marks the row read the first time the reader acts on it. */
  onEngaged?: (item: NotificationItem) => void;
  /** Show the text in the reader's language (row long press → Translate). */
  translate?: boolean;
}

function NotificationRequestCardBase({ item, onOpen, onEngaged, translate = false }: Props) {
  const { t } = useTranslation();
  const { skin, accent } = useAppTheme();
  const user = useUser() as { walletAddress?: string; address?: string } | null;
  const viewer = (user?.walletAddress || user?.address || "").toLowerCase();
  const row = item as Row;
  const type = item.type as string;
  const isNew = type === "feature_request_new";
  const requestId = row.customReferenceId;
  const commentId = row.customCommentId;
  const activeInk = skin ? `rgb(${accent.join(",")})` : "#F4F4F5";
  // Ink on the accent fill, written in System's colours; System Light's tone
  // pass flips it, as it does for the Accept pill.
  const sendInk = "#000000";

  const commentQuery = useQuery({
    queryKey: ["notification-request-comment", commentId, viewer],
    queryFn: () => loadRequestComment(commentId!, viewer),
    enabled: !isNew && !!commentId,
    staleTime: 60_000,
  });
  const requestQuery = useQuery({
    queryKey: ["notification-request", requestId],
    queryFn: () => loadRequest(requestId!),
    enabled: isNew && !!requestId,
    staleTime: 60_000,
  });
  const comment = commentQuery.data ?? null;
  const request = requestQuery.data ?? null;
  const fid = (isNew ? request?.id : comment?.featureRequestId) ?? requestId ?? "";

  const { data: votes } = useUserVotes();
  const vote = useVoteFeatureRequest();
  const actions = useFeatureThreadActions(fid, {
    title: row.customReferenceTitle || item.tokenTitle || "",
    authorAddress: request?.authorAddress ?? "",
  });

  const [myReaction, setMyReaction] = useState<PostReaction | null>(null);
  const [likes, setLikes] = useState(0);
  const [liking, setLiking] = useState(false);
  const [voteDelta, setVoteDelta] = useState(0);
  const [replies, setReplies] = useState(0);
  const [replyOpen, setReplyOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<TextInput>(null);
  const grow = useGrowingTextInput(draft, 22, 120);

  // The list recycles rows: a row reused for another notification starts fresh.
  useEffect(() => {
    setVoteDelta(0);
    setReplies(0);
    setReplyOpen(false);
    setDraft("");
  }, [item._id]);
  useEffect(() => {
    setMyReaction(comment?.myReaction ?? null);
    setLikes(comment?.likeCount ?? 0);
  }, [comment]);
  useEffect(() => {
    if (replyOpen) {
      const id = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(id);
    }
  }, [replyOpen]);

  const shown = useOnDemandTranslate((isNew ? request?.description : comment?.content)?.trim(), translate);

  if (isNew ? !request : !comment) return null;

  const author = isNew ? request!.authorAddress : comment!.walletAddress;
  const isOwn = !!viewer && author === viewer;
  const canReply = !!viewer && (isNew || (REQUEST_COMMENT_ACTIONABLE.has(type) && !isOwn));
  const text = shown.text;
  const mediaUrl = isNew ? request!.imageUrl : comment!.mediaUrl;
  const mediaType = isNew ? (request!.imageUrl ? "image" : null) : comment!.mediaType;
  const isPicture = !!mediaUrl && (mediaType === "image" || mediaType === "gif");
  const isClip = !!mediaUrl && mediaType === "video";
  const isVoice = !!mediaUrl && (mediaType === "audio" || mediaType === "voice");
  const replyTo = isNew ? null : (item.actor?.username || item.actorUsername || comment!.username);
  const myVote = votes?.[fid];
  const upvoted = myVote === 1;
  const liked = positive(myReaction);
  const engaged = () => onEngaged?.(item);

  // Only the fields the thread actions read: the comment's id and author.
  const asRow = (): FeatureCommentRow => ({
    id: comment!.id,
    feature_request_id: comment!.featureRequestId,
    wallet_address: comment!.walletAddress,
    username: comment!.username,
    avatar: null,
    content: comment!.content,
    created_at: "",
    parent_id: null,
    updated_at: null,
  });

  const toggleLike = async () => {
    if (!comment || liking) return;
    engaged();
    const before = myReaction;
    const reaction: PostReaction = liked && before ? before : "like";
    setMyReaction(liked ? null : "like");
    setLikes((n) => Math.max(0, n + (liked ? -1 : 1)));
    setLiking(true);
    try {
      await actions.react(asRow(), reaction, before);
    } catch {
      setMyReaction(before);
      setLikes((n) => Math.max(0, n + (liked ? 1 : -1)));
    } finally {
      setLiking(false);
    }
  };

  const toggleVote = () => {
    if (!request || vote.isPending) return;
    engaged();
    setVoteDelta((d) => d + (upvoted ? -1 : 1));
    vote.mutate(
      { featureRequestId: request.id, voteType: 1, currentVote: myVote },
      { onError: () => setVoteDelta((d) => d + (upvoted ? 1 : -1)) },
    );
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || actions.submit.isPending) return;
    try {
      await actions.submit.mutateAsync({
        content: replyTo && !body.startsWith("@") ? `@${replyTo} ${body}` : body,
        parent: isNew ? null : asRow(),
        media: null,
      });
      setDraft("");
      setReplyOpen(false);
      setReplies((n) => n + 1);
      toastSuccess(t("toasts.comment_posted"));
    } catch {
      // The thread actions already said it failed.
    }
  };

  const voteCount = isNew ? Math.max(0, request!.voteCount + voteDelta) : 0;
  const replyCount = isNew ? request!.commentCount + replies : replies;
  const sending = actions.submit.isPending;

  return (
    <View style={{ marginTop: 6 }}>
      {!!text && (
        <Text className="text-theme-neutrals-100" style={{ fontSize: 14.5, lineHeight: 20 }} numberOfLines={12}>
          {text}
        </Text>
      )}

      {isPicture && (
        <Pressable onPress={() => onOpen(item)} style={{ marginTop: 8, alignSelf: "flex-start" }}>
          <SmartImage
            source={{ uri: mediaUrl! }}
            style={{ width: 220, height: 220, borderRadius: 12, backgroundColor: "#18181B" }}
            contentFit="cover"
            recyclingKey={`${item._id}:img`}
            transition={120}
          />
        </Pressable>
      )}

      {(isClip || isVoice) && (
        <Pressable
          onPress={() => onOpen(item)}
          className="bg-theme-neutrals-800"
          style={{ marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16 }}
        >
          <Icon name={isClip ? "Play" : "Mic"} size={13} color="#F4F4F5" />
          <Text style={{ color: "#F4F4F5", fontSize: 13, fontWeight: "600" }}>
            {isClip ? t("audioPost.play") : t("dm.voiceNote")}
          </Text>
        </Pressable>
      )}

      {!!viewer && (
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, marginLeft: -8 }}>
          {canReply && (
            <Pressable
              onPress={() => { engaged(); setReplyOpen((v) => !v); }}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityLabel={t("communities.reply")}
              style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 32, paddingHorizontal: 8 }}
            >
              <Icon name="MessageSquare" size={17} color={replyOpen ? activeInk : MUTED} strokeWidth={1.8} />
              {replyCount > 0 && <Text style={{ fontSize: 13, color: MUTED }}>{replyCount}</Text>}
            </Pressable>
          )}
          {isNew ? (
            <Pressable
              onPress={toggleVote}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="button"
              accessibilityState={{ selected: upvoted }}
              accessibilityLabel={t("copy.bc7b4fda29f9")}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: 8 }}
            >
              <Icon name="ArrowUp" size={18} color={upvoted ? activeInk : MUTED} strokeWidth={upvoted ? 2.4 : 1.8} />
              {voteCount > 0 && <Text style={{ fontSize: 13, color: upvoted ? activeInk : MUTED }}>{voteCount}</Text>}
            </Pressable>
          ) : (
            !isOwn && (
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
            )
          )}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => { engaged(); onOpen(item); }}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t("miniApps.card.open")}
            style={{ height: 32, paddingHorizontal: 8, justifyContent: "center" }}
          >
            <Icon name="ArrowUpRight" size={17} color={MUTED} strokeWidth={1.8} />
          </Pressable>
        </View>
      )}

      {canReply && replyOpen && (
        <View
          className="bg-theme-neutrals-800 border-theme-neutrals-700"
          style={{ marginTop: 4, flexDirection: "row", alignItems: "flex-end", gap: 8, borderRadius: 18, borderWidth: 1, paddingLeft: 12, paddingRight: 5, paddingVertical: 5 }}
        >
          <TextInput
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={2000}
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
    </View>
  );
}

export const NotificationRequestCard = memo(NotificationRequestCardBase);
export default NotificationRequestCard;
