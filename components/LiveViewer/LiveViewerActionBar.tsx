import { usePurchaseOfferVisible } from "../../config/storefront";
import { useTranslation as _useCopy } from 'react-i18next';
import { useMentions } from "../../hooks/useMentions";
import MentionSuggestions from "../common/MentionSuggestions";
import { useDraftState } from '../../hooks/useDraftState';
/**
 * The live viewer's bottom bar: say something, or do something.
 *
 * One row — a capsule input that takes the width, then a circle per action —
 * instead of the two rows this used to be (a chat input bar, and under it a
 * separate strip of five emoji cells plus like and share). Two stacked rows of
 * controls ate a third of the picture, and the reactions were the only place
 * in the app where an emoji was a button.
 *
 * The five reactions now live behind the one smile circle and open as a strip
 * above the bar, which is where a viewer's thumb already is.
 *
 * Chrome comes from components/common/ViewerChrome: zinc-900 fills, white
 * icons, no hue. The like fills white when it is on, exactly as the shorts
 * action row does.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import type { ReactionType } from "../LiveProducer/ReactionOverlay";
import { formatCompactNumber } from "../../libs/numbers.util";
import { useComposerKeyboard } from "../../hooks/useComposerKeyboard";
import GifPicker from "../DM/GifPicker";
import {
  ChromeFill,
  CHROME_GAP,
  CHROME_HIT_SLOP,
  CHROME_RADIUS,
  CHROME_HAIRLINE,
  EDGE,
  TEXT_SHADOW,
} from "../common/ViewerChrome";

const REACTION_OPTIONS: { type: ReactionType; emoji: string }[] = [
  { type: "HEART", emoji: "❤️" },
  { type: "LIKE", emoji: "👍" },
  { type: "CELEBRATE", emoji: "🎉" },
  { type: "LAUGH", emoji: "😂" },
  { type: "SUPPORT", emoji: "✊" },
];

const COOLDOWN_MS = 400;

/** The height of everything on the bottom row, and on the header above it. */
const BAR_SIZE = 48;

interface Props {
  viewportHeight: number;
  /** Chat */
  canSend: boolean;
  chatEnabled: boolean;
  isLive: boolean;
  isEnded: boolean;
  isScheduled: boolean;
  draftScope: string | null;
  onSendMessage: (content: string) => Promise<boolean>;
  onSendGif: (url: string) => void;
  /** The chat line a held Reply answers, shown over the box until sent or cleared. */
  replyingTo?: { id: string; name: string; content: string } | null;
  onCancelReply?: () => void;
  /** Your own line being edited: the box holds its words until saved or closed. */
  editing?: { id: string; content: string } | null;
  onSaveEdit?: (content: string) => Promise<boolean>;
  onCancelEdit?: () => void;
  /** Actions */
  onReact: (type: ReactionType) => void;
  onLike: () => void;
  onShare: () => void;
  onGiftPress: () => void;
  likeCount: number;
  isLiked: boolean;
  actionsDisabled: boolean;
  /** The creator's !commands, as tap buttons over the box when their chat bot is on. */
  commands?: string[];
}

const LiveViewerActionBar: React.FC<Props> = ({
  viewportHeight,
  canSend,
  chatEnabled,
  isLive,
  isEnded,
  isScheduled,
  draftScope,
  onSendMessage,
  onSendGif,
  replyingTo,
  onCancelReply,
  editing = null,
  onSaveEdit,
  onCancelEdit,
  onReact,
  onLike,
  onShare,
  onGiftPress,
  likeCount,
  isLiked,
  actionsDisabled,
  commands,
}) => {
  const showPurchaseOffer = usePurchaseOfferVisible();
  const { t: _copy } = _useCopy();
  const { t } = useTranslation();
  const [draft, setDraft] = useDraftState(draftScope, "");
  // Editing your own line (like a Requests comment): the box holds that line's
  // words under their own draft, so a half-typed new message is not lost.
  const [editText, setEditText] = useDraftState(editing && draftScope ? `${draftScope}:edit:${editing.id}` : null, editing?.content ?? "");
  const message = editing ? editText : draft;
  const setMessage = (editing ? setEditText : setDraft) as typeof setDraft;
  // @tagging: typing @ offers people, picking one fills in "@username ".
  const mentions = useMentions(message, setMessage as (t: string) => void, undefined, false);
  const sending = useRef(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  // While the box is focused the row stays in its typing layout, so the
  // first letter (and deleting the last one) no longer swaps the buttons in
  // and out and makes the box jump under your thumb.
  const [focused, setFocused] = useState(false);
  const lastTapRef = useRef(0);
  const composerKeyboard = useComposerKeyboard(viewportHeight);
  const inputRef = useRef<TextInput>(null);
  // Reply puts the caret straight in the box, keyboard up.
  const replyId = replyingTo?.id;
  useEffect(() => {
    if (!replyId) return;
    const id = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(id);
  }, [replyId]);
  // Edit does the same, with the line's words already in the box.
  const editId = editing?.id;
  useEffect(() => {
    if (!editId) return;
    setEditText.initialize(editing?.content ?? "");
    const id = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const inputDisabled = !canSend || !chatEnabled || isScheduled;

  const placeholderText = isEnded
    ? _copy("copy.a5813ef6159a", { defaultValue: "Stream ended" })
    : isScheduled
      ? _copy("copy.e8df30b3017f", { defaultValue: "Chat will open when live" })
      : !isLive
        ? _copy("copy.489ef3352bdf", { defaultValue: "Waiting for stream..." })
        : !chatEnabled
          ? _copy("copy.7acfdcb49adf", { defaultValue: "Chat is disabled" })
          : !canSend
            ? _copy("copy.048ff525a56b", { defaultValue: "Sign in to chat" })
            : t("liveViewer.chatPlaceholder", { defaultValue: "type..." });

  const handleSend = useCallback(async () => {
    const content = message.trim();
    if (sending.current || !content || inputDisabled) return;
    if (editing) {
      if (content === editing.content.trim()) { setEditText.clear(); onCancelEdit?.(); return; }
      sending.current = true;
      // The words stay in the box until the edit is confirmed.
      let ok = false;
      try { ok = !!(await onSaveEdit?.(content)); } catch { ok = false; } finally { sending.current = false; }
      if (!ok || !setEditText.complete(message, "")) return;
      mentions.reset();
      onCancelEdit?.();
      return;
    }
    sending.current = true;
    // Empty the box as the line goes out; waiting for the server's echo left
    // the sent words in it for the whole round trip. A failed send puts them
    // back unless something new has been typed since.
    const sent = message;
    setMessage("");
    mentions.reset();
    try {
      if (!(await onSendMessage(content))) setMessage((current) => (current.trim() ? current : sent));
    } catch {
      setMessage((current) => (current.trim() ? current : sent));
    } finally { sending.current = false; }
  }, [message, inputDisabled, onSendMessage, setMessage, mentions, editing, onSaveEdit, onCancelEdit, setEditText]);

  const handleReact = useCallback(
    (type: ReactionType) => {
      const now = Date.now();
      if (now - lastTapRef.current < COOLDOWN_MS) return;
      lastTapRef.current = now;
      setReactionsOpen(false);
      onReact(type);
    },
    [onReact]
  );

  const openReactions = useCallback(() => setReactionsOpen(true), []);
  const closeReactions = useCallback(() => setReactionsOpen(false), []);

  const canSubmit = !!message.trim() && !inputDisabled;
  const typing = canSubmit || (focused && !inputDisabled);

  return (
    <View ref={composerKeyboard.ref} collapsable={false} onLayout={composerKeyboard.onLayout}
      style={{ marginBottom: composerKeyboard.lift }} pointerEvents="box-none">
      {reactionsOpen && isLive ? (
        /* A tap anywhere else closes the strip, like the keyboard. It sits
           first so the strip and the bar draw over it; it reaches up over
           the whole player (overflow is visible, so it still takes touches). */
        <Pressable
          testID="live-reactions-dismiss"
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
          onPress={closeReactions}
          style={{ position: "absolute", left: -2000, right: -2000, bottom: -400, top: -Math.max(viewportHeight, 2000) }}
        />
      ) : null}
      {reactionsOpen && isLive ? (
        <Pressable style={styles.reactionStrip} onPress={closeReactions}>
          <ChromeFill glass />
          {REACTION_OPTIONS.map((opt) => (
            <Pressable
              key={opt.type}
              onPress={() => handleReact(opt.type)}
              disabled={actionsDisabled}
              accessibilityRole="button"
              /* The glyph is the label: a screen reader announces an emoji by its
                 own name, in the reader's language, which no key of ours would. */
              accessibilityLabel={opt.emoji}
              style={[styles.reactionCell, actionsDisabled ? styles.dim : null]}
            >
              <Text style={styles.glyph}>{opt.emoji}</Text>
            </Pressable>
          ))}
        </Pressable>
      ) : null}

      {editing && !inputDisabled ? (
        <View style={styles.replyStrip}>
          <ChromeFill glass />
          <Icon name="Pencil" size={14} color="rgba(255,255,255,0.8)" strokeWidth={1.8} />
          <Text numberOfLines={1} style={styles.replyText}>
            <Text style={{ fontWeight: "700" }}>{t("liveChat.editingMessage")}</Text>
            {`  ${editing.content}`}
          </Text>
          <Pressable
            onPress={() => { setEditText.clear(); onCancelEdit?.(); }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t("common.cancel")}
          >
            <Icon name="X" size={16} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>
      ) : replyingTo && !inputDisabled ? (
        <View style={styles.replyStrip}>
          <ChromeFill glass />
          <Icon name="Reply" size={14} color="rgba(255,255,255,0.8)" strokeWidth={1.8} />
          <Text numberOfLines={1} style={styles.replyText}>
            <Text style={{ fontWeight: "700" }}>{t("dm.replyingTo")} {replyingTo.name}</Text>
            {replyingTo.content ? `  ${replyingTo.content}` : ""}
          </Text>
          <Pressable onPress={onCancelReply} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.close")}>
            <Icon name="X" size={16} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>
      ) : null}

      {!inputDisabled ? (
        <View style={styles.mentionWrap}>
          <MentionSuggestions
            visible={mentions.showSuggestions}
            suggestions={mentions.suggestions}
            onSelect={mentions.selectMention}
            loading={mentions.loading}
          />
        </View>
      ) : null}

      {commands && commands.length > 0 && !inputDisabled && !editing && !typing ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          accessibilityLabel={t("liveStudio.bot.commandsLabel")}
          style={styles.commandStrip}
          contentContainerStyle={styles.commandStripContent}
        >
          {commands.map((command) => (
            <Pressable
              key={command}
              onPress={() => void onSendMessage(command)}
              accessibilityRole="button"
              accessibilityLabel={command}
              style={styles.commandChip}
            >
              <ChromeFill glass />
              <Text style={styles.commandText}>{command}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.row} pointerEvents="box-none">
        <View style={styles.inputWrap}>
          <ChromeFill glass />
          <TextInput
            ref={inputRef}
            value={message}
            onChangeText={mentions.handleChangeText}
            onSelectionChange={mentions.handleSelectionChange}
            placeholder={placeholderText}
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={styles.input}
            editable={!inputDisabled}
            maxLength={500}
            // Grows to four lines so the whole message stays readable; a
            // one-line box scrolled the start of anything longer out of view.
            multiline
            submitBehavior="submit"
            returnKeyType="send"
            onSubmitEditing={handleSend}
            onFocus={() => { setFocused(true); setReactionsOpen(false); }}
            onBlur={() => setFocused(false)}
          />
          {typing ? (
            <Pressable
              onPress={handleSend}
              disabled={!canSubmit}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("tip.send", { defaultValue: "Send" })}
              style={[styles.sendButton, canSubmit ? null : styles.dim]}
            >
              <Icon name={editing ? "Check" : "Send"} size={17} color="#fff" strokeWidth={1.8} />
            </Pressable>
          ) : null}
        </View>

        {/* GIF · gift · share · thumb, on the composer's own row, always.
            One layout whether or not the box is focused: hiding them while
            typing made the bar swap between two looks as the keyboard came
            and went, and the buttons moved under your thumb as you tapped. */}
        <View style={styles.cluster} pointerEvents="box-none">
          {isLive && !inputDisabled ? (
            <Pressable onPress={() => setGifPickerVisible(true)} hitSlop={CHROME_HIT_SLOP}
              accessibilityRole="button" accessibilityLabel={t("comments.addGif")} style={styles.circle}>
              <ChromeFill glass />
              <Text style={styles.gifLabel}>GIF</Text>
            </Pressable>
          ) : null}
          {isLive && showPurchaseOffer ? (
            <Pressable
              onPress={onGiftPress}
              hitSlop={CHROME_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t("postOptions.sendTip", { defaultValue: "Send Tip" })}
              style={styles.circle}
            >
              <ChromeFill glass />
              <Icon name="Gem" size={19} color="#fff" strokeWidth={1.8} />
            </Pressable>
          ) : null}

          <Pressable
            onPress={onShare}
            hitSlop={CHROME_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={t("postOptions.share", { defaultValue: "Share" })}
            style={styles.circle}
          >
            <ChromeFill glass />
            <Icon name="Share2" size={19} color="#fff" strokeWidth={1.8} />
          </Pressable>

          <Pressable
            onPress={onLike}
            onLongPress={isLive ? openReactions : undefined}
            delayLongPress={400}
            hitSlop={CHROME_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={isLiked ? _copy("copy.eaa881c359cf", { defaultValue: "Unlike" }) : _copy("copy.64f915cb8bfc", { defaultValue: "Like" })}
            style={styles.circle}
          >
            <ChromeFill glass />
            <Icon
              name="ThumbsUp"
              size={19}
              color="#fff"
              strokeWidth={1.8}
              fill={isLiked ? "#fff" : "none"}
            />
            {/* No tally. The icon is the control, and a number hung off
                each of three buttons is three more figures on somebody
                else's broadcast — the counts live on the post. */}
          </Pressable>
        </View>
      </View>
      <GifPicker visible={gifPickerVisible} onClose={() => setGifPickerVisible(false)}
        onPick={(url) => { setGifPickerVisible(false); onSendGif(url); }} />
    </View>
  );
};


const styles = StyleSheet.create({
  mentionWrap: { marginHorizontal: 10, marginBottom: 6 },
  commandStrip: { flexGrow: 0, marginBottom: 8 },
  commandStripContent: { paddingHorizontal: EDGE, gap: 6 },
  commandChip: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: CHROME_HAIRLINE,
    overflow: "hidden",
    justifyContent: "center",
  },
  commandText: { color: "#fff", fontSize: 12, fontWeight: "600", ...TEXT_SHADOW },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: EDGE,
    gap: 8,
  },
  cluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  /**
   * 48 with a hairline, matching the buttons beside it and the header
   * above it. This row sits on the picture rather than on the bottom
   * scrim, so unlike the header's chrome it carries its own contrast —
   * the same black/40 and white/15 the web viewer gives the composer.
   */
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: BAR_SIZE,
    borderWidth: 1,
    borderColor: CHROME_HAIRLINE,
    borderRadius: CHROME_RADIUS,

    paddingVertical: 6,
    paddingLeft: 16,
    paddingRight: 6,
    gap: 4,
    overflow: "hidden",
  },
  input: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
    lineHeight: 19,
    // Explicit top/bottom (iOS multiline ignores paddingVertical and adds its
    // own top inset) and no Android font padding, so the words and the
    // placeholder sit in the middle of the box.
    paddingTop: 4,
    paddingBottom: 4,
    includeFontPadding: false,
    maxHeight: 19 * 4 + 8,
    textAlignVertical: "center",
  },
  sendButton: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    width: 42,
    height: BAR_SIZE,
    borderWidth: 1,
    borderColor: CHROME_HAIRLINE,
    borderRadius: CHROME_RADIUS,
    alignItems: "center",
    justifyContent: "center",
  },
  gifLabel: { color: "#fff", fontSize: 12, fontWeight: "800" },
  /**
   * The count rides the circle rather than sitting under it, so the row keeps
   * one height whether or not a stream has any likes yet.
   */
  badge: {
    position: "absolute",
    bottom: -3,
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "700",
    ...TEXT_SHADOW,
  },
  replyStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: EDGE,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: CHROME_HAIRLINE,
    borderRadius: CHROME_RADIUS,
    overflow: "hidden",
  },
  replyText: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12, ...TEXT_SHADOW },
  reactionStrip: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    height: BAR_SIZE,
    borderWidth: 1,
    borderColor: CHROME_HAIRLINE,
    borderRadius: CHROME_RADIUS,
    marginRight: EDGE,
    marginBottom: 8,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  reactionCell: {
    width: 38,
    height: BAR_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: {
    opacity: 0.35,
  },
  glyph: {
    fontSize: 20,
    lineHeight: 26,
    textAlign: "center",
  },
});

export default memo(LiveViewerActionBar);
