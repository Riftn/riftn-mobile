/**
 * The live-player pieces of the Moments viewer, as on web
 * (riftn-web components/app/stories/StoryRoomChat + stories.css):
 * comments floating over the picture like live chat, hearts rising from the
 * like key, and the "Everyone / Only them" switch above the keyboard.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getStoryComments, type StoryComment } from "../../services/stories.service";
import { avatarOf } from "./story-utils";
import { MomentHeart } from "./MomentIcons";
import { BoldText } from "../../libs/bold-markup";

const FLOATING = 4;

export const TEXT_SHADOW = {
  textShadowColor: "rgba(0,0,0,0.8)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
} as const;

export function useMomentComments(itemId: string | undefined, signedIn: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ["moment-room-comments", itemId, signedIn],
    queryFn: () => getStoryComments(itemId!, signedIn),
    enabled: !!itemId && enabled,
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
  });
}

const nameOfComment = (c: StoryComment) => c.author.displayName || c.author.username || c.author.address.slice(0, 8);

function Face({ c }: { c: StoryComment }) {
  const [broken, setBroken] = useState(false);
  const uri = avatarOf(c.author, 24);
  return (
    <View style={styles.face}>
      {uri && !broken ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setBroken(true)} />
      ) : (
        <Text style={styles.faceLetter}>{nameOfComment(c).slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
}

/** One row; rows that arrive after the first paint rise in from below. */
function Row({ c, rise, fade }: { c: StoryComment; rise: boolean; fade: number }) {
  const v = useRef(new Animated.Value(rise ? 0 : 1)).current;
  useEffect(() => {
    if (!rise) return;
    Animated.timing(v, { toValue: 1, duration: 360, easing: Easing.bezier(0.25, 0.8, 0.25, 1), useNativeDriver: true }).start();
  }, [rise, v]);
  return (
    <Animated.View
      style={[
        styles.row,
        {
          opacity: Animated.multiply(v, fade),
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      <Face c={c} />
      <Text style={styles.text} numberOfLines={2}>
        <Text style={styles.name}>{nameOfComment(c)}  </Text>
        <BoldText text={c.text} />
      </Text>
    </Animated.View>
  );
}

/** The newest few comments over the picture. Draws nothing when there are none. */
export function StoryRoomChat({ comments, onOpen }: { comments: StoryComment[]; onOpen: () => void }) {
  const { t } = useTranslation();
  const rows = useMemo(() => comments.slice(0, FLOATING).reverse(), [comments]);
  const rise = useRef<Map<string, boolean> | null>(null);
  const firstPaint = rise.current === null;
  if (!rise.current) rise.current = new Map();
  for (const r of rows) if (!rise.current.has(r.id)) rise.current.set(r.id, !firstPaint);
  if (!rows.length) return null;
  return (
    <Pressable
      onPress={onOpen}
      style={styles.room}
      accessibilityRole="button"
      accessibilityLabel={t("stories.comments", { defaultValue: "Comments" })}
    >
      {rows.map((c, i) => (
        // The oldest rows fade toward the top, like live chat.
        <Row key={c.id} c={c} rise={!!rise.current?.get(c.id)} fade={rows.length - i >= 4 ? 0.35 : rows.length - i === 3 ? 0.75 : 1} />
      ))}
    </Pressable>
  );
}

/** Hearts rising from the like key. Each burst lives about two seconds. */
export function FloatHearts({ bursts, right, bottom }: { bursts: number[]; right: number; bottom: number }) {
  return (
    <View pointerEvents="none" style={[styles.flow, { right, bottom }]}>
      {bursts.flatMap((id) => [0, 1, 2, 3, 4].map((k) => <Heart key={`${id}-${k}`} delay={k * 140} drift={((id + k * 7) % 25) - 12} />))}
    </View>
  );
}

function Heart({ delay, drift }: { delay: number; drift: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 1900, delay, easing: Easing.bezier(0.25, 0.8, 0.25, 1), useNativeDriver: true }).start();
  }, [v, delay]);
  return (
    <Animated.View
      style={[
        styles.heart,
        {
          opacity: v.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 1, 0] }),
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -240] }) },
            { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, drift] }) },
            { scale: v.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.6, 1.05, 0.9] }) },
          ],
        },
      ]}
    >
      <MomentHeart size={24} filled />
    </Animated.View>
  );
}

/** Who a reply goes to, shown above the keyboard while typing. */
export function ReplyTo({ value, onChange, name }: { value: "everyone" | "author"; onChange: (v: "everyone" | "author") => void; name: string }) {
  const { t } = useTranslation();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 200, easing: Easing.bezier(0.25, 0.8, 0.25, 1), useNativeDriver: true }).start();
  }, [v]);
  const opt = (key: "everyone" | "author", label: string) => (
    <Pressable
      key={key}
      onPress={() => onChange(key)}
      accessibilityRole="radio"
      accessibilityState={{ checked: value === key }}
      style={styles.toOption}
    >
      {/* Fill on an inner view: themes repaint grey-filled buttons. */}
      {value === key ? <View pointerEvents="none" style={styles.toOn} /> : null}
      <Text style={[styles.toText, value === key && styles.toTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
  return (
    <Animated.View
      style={[styles.to, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}
      accessibilityRole="radiogroup"
    >
      {opt("everyone", t("stories.toEveryone", { defaultValue: "Everyone" }))}
      {opt("author", t("stories.toOnly", { name, defaultValue: "Only {{name}}" }))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  room: { gap: 10, marginRight: 64, marginBottom: 12 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  face: { width: 24, height: 24, borderRadius: 6, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.22)" },
  faceLetter: { color: "#fff", fontSize: 11, fontWeight: "800" },
  text: { flex: 1, color: "#fff", fontSize: 13.5, fontWeight: "500", lineHeight: 18, ...TEXT_SHADOW },
  name: { fontSize: 13, fontWeight: "800" },
  flow: { position: "absolute", width: 44, height: 0 },
  heart: { position: "absolute", left: 10, bottom: 0 },
  to: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: 4,
    padding: 3,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: "rgba(20,20,24,0.55)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.16)",
  },
  toOption: { height: 30, paddingHorizontal: 12, borderRadius: 8, justifyContent: "center", overflow: "hidden" },
  toOn: { ...StyleSheet.absoluteFillObject, backgroundColor: "#fff", borderRadius: 8 },
  toText: { color: "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "600" },
  toTextOn: { color: "#0b0b0c" },
});
