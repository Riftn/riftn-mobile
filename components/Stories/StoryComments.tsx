/** Public comments under a moment: everyone who can see it can read them. */
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import Icon from "../ui/Icon";
import Avatar from "../common/Avatar";
import { formatCount } from "../../libs/format-count";
import { toastError } from "../../libs/toast";
import { addStoryComment, deleteStoryComment, getStoryComments, type StoryComment, type StoryItem } from "../../services/stories.service";
import { avatarOf, nameOf } from "./story-utils";
import { formatShortAgo } from "../../libs/date.util";
import { MomentComment } from "./MomentIcons";

export default function StoryComments({ item, signedIn, bottom, onClose, onOpenProfile, onSignIn, onCount }: {
  item: StoryItem;
  signedIn: boolean;
  bottom: number;
  onClose: () => void;
  onOpenProfile: (address: string) => void;
  onSignIn: () => void;
  onCount: (n: number) => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StoryComment[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [count, setCount] = useState(item.commentCount ?? 0);
  const [allow, setAllow] = useState(item.allowReplies);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // The comment a reply goes under, while the person is answering one.
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    let alive = true;
    getStoryComments(item.id, signedIn, undefined, true)
      .then((r) => {
        if (!alive) return;
        setRows(r.comments);
        setNext(r.next);
        setCount(r.commentCount);
        setAllow(r.allowComments);
      })
      .catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [item.id, signedIn]);

  const setTotal = (n: number) => { setCount(n); onCount(n); };

  const more = async () => {
    if (!next) return;
    const r = await getStoryComments(item.id, signedIn, next, true).catch(() => null);
    if (!r) return;
    setRows((list) => [...(list ?? []), ...r.comments]);
    setNext(r.next);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const row = await addStoryComment(item.id, body, replyTo?.id);
      if (row.parentId) {
        setRows((list) => (list ?? []).map((r) => (r.id === row.parentId ? { ...r, replies: [...(r.replies ?? []), row] } : r)));
      } else {
        setRows((list) => [{ ...row, replies: row.replies ?? [] }, ...(list ?? [])]);
      }
      setText("");
      setReplyTo(null);
      setTotal(count + 1);
    } catch (e: any) {
      toastError(e?.message || t("stories.commentFailed", { defaultValue: "Your comment didn't go up. Try again." }));
    } finally {
      setBusy(false);
    }
  };

  const remove = (c: StoryComment) => {
    // A top comment takes its replies with it.
    const gone = 1 + (c.parentId ? 0 : c.replies?.length ?? 0);
    setRows((list) => (list ?? [])
      .filter((r) => r.id !== c.id)
      .map((r) => (c.parentId && r.id === c.parentId ? { ...r, replies: (r.replies ?? []).filter((x) => x.id !== c.id) } : r)));
    if (replyTo?.id === c.id) setReplyTo(null);
    setTotal(Math.max(0, count - gone));
    void deleteStoryComment(item.id, c.id).catch(() => {});
  };

  const answer = (c: StoryComment) => {
    if (!signedIn) { onSignIn(); return; }
    setReplyTo({ id: c.parentId || c.id, name: nameOf(c.author) });
    setTimeout(() => input.current?.focus(), 50);
  };

  const line = (c: StoryComment, reply: boolean) => (
    <View key={c.id} style={[styles.row, reply && styles.replyRow]}>
      <TouchableOpacity onPress={() => onOpenProfile(c.author.address)} accessibilityRole="link" accessibilityLabel={nameOf(c.author)}>
        <Avatar uri={avatarOf(c.author, reply ? 24 : 32)} size={reply ? 24 : 32} radius={reply ? 12 : 16} name={c.author.username || c.author.address} />
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.name} numberOfLines={1} onPress={() => onOpenProfile(c.author.address)}>
          {nameOf(c.author)}
          {c.isCreator ? <Text style={styles.creator}>{"  "}{t("postInfo.creator", { defaultValue: "Creator" })}</Text> : null}
          {" "}<Text style={styles.age}>{formatShortAgo(c.createdAt)}</Text>
        </Text>
        <Text style={styles.text}>{c.text}</Text>
        {allow ? (
          <TouchableOpacity onPress={() => answer(c)} hitSlop={8} style={styles.replyBtn} accessibilityRole="button">
            <Text style={styles.replyText}>{t("dm.reply", { defaultValue: "Reply" })}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {c.canDelete ? (
        <TouchableOpacity onPress={() => remove(c)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.delete", { defaultValue: "Delete" })}>
          <Icon name="Trash2" size={16} color="hsla(0,0%,100%,0.6)" />
        </TouchableOpacity>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.back} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
      <View style={[styles.sheet, { paddingBottom: bottom + 12 }]} accessibilityViewIsModal>
        <View style={styles.head}>
          <MomentComment size={16} />
          <Text style={styles.title}>{t("stories.comments", { defaultValue: "Comments" })}</Text>
          {count > 0 ? <Text style={styles.count}>{formatCount(count)}</Text> : null}
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("common.close", { defaultValue: "Close" })}>
            <Icon name="X" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        {rows === null ? (
          <ActivityIndicator color="#fff" style={{ marginVertical: 20 }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>{t("stories.noCommentsYet", { defaultValue: "No comments yet. Say something everyone can see." })}</Text>
        ) : (
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            {rows.map((c) => (
              <View key={c.id}>
                {line(c, false)}
                {(c.replies ?? []).map((r) => line(r, true))}
              </View>
            ))}
            {next ? (
              <TouchableOpacity onPress={() => void more()} style={{ paddingVertical: 12, alignItems: "center" }}>
                <Text style={styles.name}>{t("common.loadMore", { defaultValue: "Load more" })}</Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        )}
        {!signedIn ? (
          <TouchableOpacity style={styles.box} onPress={onSignIn}>
            <Text style={styles.placeholder}>{t("stories.signInToComment", { defaultValue: "Sign in to comment" })}</Text>
          </TouchableOpacity>
        ) : allow ? (
          <>
          {replyTo ? (
            <View style={styles.replying}>
              <Text style={styles.replyingText} numberOfLines={1}>{t("governance.discussion.replyingTo", { name: replyTo.name, defaultValue: "Replying to {{name}}" })}</Text>
              <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.replyText}>{t("common.cancel", { defaultValue: "Cancel" })}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <View style={styles.box}>
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              placeholder={t("stories.addComment", { defaultValue: "Add a comment for everyone" })}
              placeholderTextColor="hsla(0,0%,100%,0.6)"
              style={styles.input}
              keyboardAppearance="dark"
              returnKeyType="send"
              onSubmitEditing={() => void send()}
              maxLength={300}
            />
            {text.trim() ? (
              <TouchableOpacity onPress={() => void send()} disabled={busy} hitSlop={8} accessibilityRole="button">
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.post}>{t("stories.post", { defaultValue: "Post" })}</Text>}
              </TouchableOpacity>
            ) : null}
          </View>
          </>
        ) : (
          <Text style={styles.empty}>{t("stories.commentsOff", { defaultValue: "Comments are off for this moment" })}</Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  back: { ...StyleSheet.absoluteFillObject, zIndex: 11, backgroundColor: "hsla(0,0%,0%,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "hsl(240,8%,9%)",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 14,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "hsla(0,0%,100%,0.12)",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingBottom: 8 },
  title: { color: "#fff", fontSize: 15, fontWeight: "700" },
  count: { color: "hsla(0,0%,100%,0.6)", fontSize: 14 },
  empty: { color: "hsla(0,0%,100%,0.65)", paddingHorizontal: 8, paddingVertical: 16 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8, paddingHorizontal: 8 },
  name: { color: "#fff", fontSize: 13, fontWeight: "600" },
  age: { color: "hsla(0,0%,100%,0.5)", fontWeight: "400" },
  text: { color: "#fff", fontSize: 14, marginTop: 2 },
  replyRow: { paddingLeft: 50, paddingVertical: 6 },
  creator: { color: "hsla(0,0%,100%,0.75)", fontSize: 11, fontWeight: "700" },
  replyBtn: { marginTop: 4, alignSelf: "flex-start" },
  replyText: { color: "hsla(0,0%,100%,0.65)", fontSize: 12, fontWeight: "700" },
  replying: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingTop: 8 },
  replyingText: { flex: 1, color: "hsla(0,0%,100%,0.8)", fontSize: 12 },
  box: {
    marginTop: 8,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "hsla(240,9%,9%,0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "hsla(0,0%,100%,0.18)",
  },
  input: { flex: 1, color: "#fff", fontSize: 15, paddingVertical: 0 },
  placeholder: { color: "hsla(0,0%,100%,0.8)", fontSize: 14 },
  post: { color: "#fff", fontSize: 14, fontWeight: "700" },
});
