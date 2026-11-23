import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { rememberGalleryIndex } from "../../libs/media-presentation";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../context/ThemeContext";
import { usePagerGestureRef } from "../../context/PagerGestureContext";
import { measureImageAspect } from "../common/SmartImage";
import AltTextBadge from "./AltTextBadge";
import ComicFoil from "./ComicFoil";
import { BORDER_LOOKS, isComicBorder } from "../../libs/comic-borders";

/**
 * Comic posts as foil collector cards, the same cards as riftn.com.
 *
 * The feed shows the top card with the next two fanned behind it. A sideways
 * swipe deals the next page: the top card glides off to the left while the
 * next one straightens up from the fan. Nothing leans, flashes or bounces.
 * In the feed a tap opens the post. On the post page a tap deals the next
 * page, and a tap on the caption strip turns the card over to the caption
 * and alt text in full; a tap on the back turns it face up again. The post
 * page also adds the hand of every page and "Read all pages".
 */

type Foil = [string, string, string, string];
/** Light, accent, deep, and the card face. The foil follows the theme. */
const FOILS: Record<string, Foil> = {
  horror: ["#ffd0d4", "#ff6874", "#a92c3a", "#150c0f"],
  hazy: ["#f1dcff", "#c08bff", "#6d3fb4", "#150f20"],
  cosmic: ["#dfe3ff", "#8f9bff", "#3f47b4", "#0f1120"],
  osaka: ["#ffd6ea", "#ff6fb5", "#a3306b", "#180d16"],
  jungle: ["#eef3cf", "#b9d38a", "#5f7a33", "#19140d"],
  war: ["#d4fffd", "#4fe3e0", "#1d7f7d", "#08130f"],
  hacker: ["#d6ffe4", "#39ff88", "#138a43", "#03100a"],
  island: ["#e0f4ff", "#7dd3fc", "#2a7fb0", "#0e1828"],
  winter: ["#f2fbff", "#bae6fd", "#6aa6c9", "#101823"],
  lavalamp: ["#ffe6cc", "#fdba74", "#b5622a", "#1a0d08"],
};
const GOLD: Foil = ["#f7e7b4", "#c9a24e", "#a9822f", "#15101a"];
const INK = "#f3ebe4";
const SERIF = Platform.select({ ios: "Georgia", default: "serif" });
const MONO = Platform.select({ ios: "Menlo", default: "monospace" });
const HOLO = ["#ff6ec4", "#ffd36e", "#7af0c6", "#6ea8ff", "#c58bff", "#ff6ec4", "#ffd36e", "#7af0c6"] as const;
/** How long a deal takes, and its curve: quick off the mark, soft landing, no overshoot. */
const DEAL_MS = 420;
const FLIP_MS = 520;
const EASE = Easing.bezier(0.22, 0.8, 0.3, 1);

/** Cover URL to its clamped aspect ratio. */
const coverRatios = new Map<string, number>();

const pad2 =(n: number) => String(n).padStart(2, "0");

/** The theme's own foil: what a comic with no border preset wears. */
export function themeFoil(theme: string): Foil {
  return FOILS[theme] ?? GOLD;
}

function ComicDeck({ images, galleryKey, captions, descriptions, title, width, onOpen, full = false, border, active = true }: {
  images: string[];
  galleryKey?: string;
  captions?: string[];
  descriptions?: string[];
  title?: string;
  /** The space the deck has. */
  width: number;
  /** Feed: a tap opens the post. Leave out on the post page, where a tap deals the next page. */
  onOpen?: () => void;
  full?: boolean;
  /** Border preset (libs/comic-borders); absent is the theme's foil. */
  border?: string;
  /** On screen. Holographic and glitter strips only move while it is. */
  active?: boolean;
}) {
  const { t } = useTranslation();
  const { theme } = useAppTheme();
  const look = isComicBorder(border) ? BORDER_LOOKS[border] : undefined;
  const foil = look?.foil ?? themeFoil(theme);
  const accent = look?.accent ?? foil[1];
  const shine = look?.quiet ? 0.25 : 1;
  const pagerRef = usePagerGestureRef();
  const total = images.length;
  const [index, setIndex] = useState(0);
  useEffect(() => { if (galleryKey) rememberGalleryIndex(galleryKey, index); }, [galleryKey, index]);
  const [flipped, setFlipped] = useState(false);
  const [reading, setReading] = useState(false);
  const [ratio, setRatio] = useState(() => coverRatios.get(images[0]) ?? 0.75);

  // The art box takes the cover's shape, kept between tall and wide.
  // Remembered per cover, so the post page opens at the size the feed card
  // already had instead of starting portrait and jumping.
  useEffect(() => {
    let live = true;
    const cover = images[0];
    const known = cover ? coverRatios.get(cover) : undefined;
    if (known) setRatio(known);
    else if (cover) measureImageAspect(cover).then(r => {
      if (!r) return;
      const next = Math.max(0.62, Math.min(1.5, r));
      coverRatios.set(cover, next);
      if (live) setRatio(next);
    });
    return () => { live = false; };
  }, [images]);

  // Tablets get the bigger desktop card.
  const roomy = width >= 700;
  const cardW = Math.round(Math.min(ratio > 1 ? width * 0.9 : width * 0.82, ratio > 1 ? (roomy ? 600 : 440) : (roomy ? 440 : 360)));
  const artW = cardW - 12 - 16;
  const artH = Math.round(artW / ratio);

  const reduceMotion = useReducedMotion();
  const caption = captions?.[index]?.trim() || "";
  const alt = descriptions?.[index]?.trim() || "";
  const cardH = artH + 92;
  // Which page is on top; fractional while a deal is in flight or dragged.
  const pos = useSharedValue(0);
  const flip = useSharedValue(0);

  useEffect(() => {
    flip.value = withTiming(flipped ? 180 : 0, { duration: reduceMotion ? 0 : FLIP_MS, easing: EASE });
  }, [flipped, flip, reduceMotion]);

  const land = useCallback((to: number) => { setIndex(to); }, []);
  /** Deal to a page next door; a page further away (the hand) is just shown. */
  const go = useCallback((to: number) => {
    "worklet";
    const target = Math.max(0, Math.min(total - 1, to));
    const near = Math.abs(target - pos.value) <= 1.2 && !reduceMotion;
    pos.value = withTiming(target, { duration: near ? DEAL_MS : 0, easing: EASE }, done => {
      if (done) runOnJS(land)(target);
    });
  }, [total, pos, land, reduceMotion]);

  const tap = useCallback((y?: number) => {
    if (onOpen) { onOpen(); return; }
    if (flipped) { setFlipped(false); return; }
    if ((caption || alt) && y !== undefined && y > artH + 38) { setFlipped(true); return; }
    if (index < total - 1) go(index + 1);
  }, [onOpen, flipped, caption, alt, artH, index, total, go]);

  const gesture = useMemo(() => {
    let pan = Gesture.Pan()
      .enabled(!flipped && total > 1)
      .activeOffsetX([-10, 10])
      .failOffsetY([-12, 12])
      .onUpdate(e => {
        const atEdge = (e.translationX > 0 && index === 0) || (e.translationX < 0 && index === total - 1);
        pos.value = index - (atEdge ? e.translationX / 5 : e.translationX) / cardW;
      })
      .onEnd(e => {
        go(e.translationX < -50 ? index + 1 : e.translationX > 50 ? index - 1 : index);
      });
    if (pagerRef) pan = pan.blocksExternalGesture(pagerRef);
    const press = Gesture.Tap().maxDuration(450).onEnd((e, ok) => { if (ok) runOnJS(tap)(e.y); });
    return Gesture.Race(pan, press);
  }, [index, total, cardW, flipped, go, tap, pagerRef, pos]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 900 }, { rotateY: `${flip.value}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 900 }, { rotateY: `${flip.value + 180}deg` }],
  }));

  const pageLabel = `${pad2(index + 1)} / ${pad2(total)}`;
  const name = title?.trim() || t("comic.title", { defaultValue: "Comic" });
  const dealt = [index - 1, index, index + 1, index + 2, index + 3].filter(i => i >= 0 && i < total);
  const strip = (look?.strip ?? [foil[0], foil[1], foil[0], foil[2], foil[0]]) as string[];

  if (reading) {
    return (
      <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
        <View style={styles.readHead}>
          <Text style={styles.readTitle} numberOfLines={1}>{name}</Text>
          <Pressable onPress={() => setReading(false)} style={styles.pill} accessibilityRole="button">
            <Text style={styles.pillText}>{t("comic.cards", { defaultValue: "Back to cards" })}</Text>
          </Pressable>
        </View>
        {images.map((uri, i) => (
          <View key={`${uri}-${i}`} style={{ marginBottom: 18 }}>
            <ReadPage uri={uri} width={width - 8} alt={descriptions?.[i]} />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Text style={styles.readNum}>{pad2(i + 1)}</Text>
              {captions?.[i]?.trim() ? <Text style={styles.readCap}>{captions[i]}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: full ? 12 : 20 }}>
      <View style={{ width: cardW, height: cardH }}>
        <View style={[styles.floor, { width: cardW * 0.84, left: cardW * 0.08, top: cardH - 10 }]} />

        <GestureDetector gesture={gesture}>
          <View
            style={StyleSheet.absoluteFill}
            accessible
            accessibilityRole="button"
            accessibilityLabel={onOpen
              ? t("comic.open", { defaultValue: "Open comic, page {{page}} of {{total}}", page: index + 1, total })
              : t("comic.goto", { defaultValue: "Page {{page}}", page: index + 1 })}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }, { name: "activate" }]}
            onAccessibilityAction={e => {
              if (e.nativeEvent.actionName === "increment") go(index + 1);
              else if (e.nativeEvent.actionName === "decrement") go(index - 1);
              else if (onOpen) onOpen();
              else if (caption || alt) setFlipped(f => !f);
            }}
          >
            {dealt.map(i => {
              const top = i === index;
              const pageCaption = captions?.[i]?.trim() || "";
              return (
                <DealtCard key={i} page={i} pos={pos} cardW={cardW}>
                  {/* Front */}
                  <Animated.View style={[StyleSheet.absoluteFill, styles.side, top ? frontStyle : null]}>
                    <ComicFoil colors={strip} look={look} width={cardW} height={cardH} animate={top && active} />
                    <View style={[styles.face, { backgroundColor: foil[3] }]}>
                      <View style={styles.top}>
                        <Text style={styles.title} numberOfLines={1}>{name}</Text>
                        <Text style={styles.num}>{`${pad2(i + 1)} / ${pad2(total)}`}</Text>
                      </View>
                      <View style={[styles.art, { height: artH }]}>
                        <Image
                          source={{ uri: images[i] }}
                          style={StyleSheet.absoluteFill}
                          contentFit="contain"
                          accessibilityLabel={top ? alt || undefined : undefined}
                        />
                        {top && alt ? <View style={styles.altSpot} pointerEvents="box-none"><AltTextBadge text={alt} /></View> : null}
                      </View>
                      <Text style={styles.cap} numberOfLines={3}>{pageCaption}</Text>
                    </View>
                    {top ? (
                      <LinearGradient
                        pointerEvents="none"
                        colors={HOLO}
                        start={{ x: 0, y: 0.2 }}
                        end={{ x: 1, y: 0.8 }}
                        style={[StyleSheet.absoluteFill, { opacity: 0.1 * shine }]}
                      />
                    ) : null}
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(255,255,255,0.18)", "rgba(255,255,255,0)", "rgba(255,255,255,0)"]}
                      start={{ x: 0.2, y: 0 }}
                      end={{ x: 0.8, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                  </Animated.View>

                  {/* Back */}
                  {top ? (
                    <Animated.View style={[StyleSheet.absoluteFill, styles.side, styles.back, { backgroundColor: foil[3], borderColor: foil[1] }, backStyle]}>
                      <Text style={[styles.lab, { color: accent }]}>{t("comic.page", { defaultValue: "Page {{page}}", page: index + 1 })}</Text>
                      <Text style={styles.backTitle}>{caption || name}</Text>
                      {alt ? (
                        <>
                          <Text style={[styles.lab, { color: accent }]}>{t("comic.alt", { defaultValue: "Alt text" })}</Text>
                          <Text style={styles.backAlt}>{alt}</Text>
                        </>
                      ) : null}
                      <View style={styles.backFoot}>
                        <Text style={styles.footText} numberOfLines={1}>{title}</Text>
                        <Text style={styles.footText}>{pageLabel}</Text>
                      </View>
                    </Animated.View>
                  ) : null}
                </DealtCard>
              );
            })}
          </View>
        </GestureDetector>
      </View>

      {full && total > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 24, maxWidth: width }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, alignItems: "flex-end" }}
        >
          {images.map((uri, i) => (
            <Pressable
              key={`${uri}-${i}`}
              onPress={() => { setFlipped(false); go(i); }}
              accessibilityRole="button"
              accessibilityState={{ selected: i === index }}
              accessibilityLabel={t("comic.goto", { defaultValue: "Page {{page}}", page: i + 1 })}
              style={[styles.mini, {
                marginLeft: i === 0 ? 0 : total > 8 ? -8 : 4,
                zIndex: i === index ? total : i,
                transform: [{ translateY: i === index ? -10 : 0 }, { rotate: `${(i - (total - 1) / 2) * Math.min(4, 40 / total)}deg` }],
                borderColor: i === index ? "#fff" : foil[1],
              }]}
            >
              <Image source={{ uri }} style={styles.miniImg} contentFit="cover" />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {full && total > 1 ? (
        <Pressable onPress={() => setReading(true)} style={[styles.pill, { marginTop: 16 }]} accessibilityRole="button">
          <Text style={styles.pillText}>{t("comic.showAll", { defaultValue: "Show all {{count}} pages", count: total })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One card of the deal. Slot 0 is the top card, 1 and 2 are fanned behind it,
 * and below 0 the card has been dealt away to the left.
 */
function DealtCard({ page, pos, cardW, children }: { page: number; pos: SharedValue<number>; cardW: number; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => {
    const slot = Math.max(-1, Math.min(3, page - pos.value));
    const away = slot < 0 ? -slot : 0;
    const back = Math.max(0, slot);
    return {
      opacity: away ? (away < 0.6 ? 1 : 1 - (away - 0.6) / 0.4) : back > 2 ? 0 : 1,
      transform: away
        ? [{ translateX: -away * 1.08 * cardW }, { translateY: away * 12 }, { rotate: `${-away * 8}deg` }]
        : [{ translateX: back * 14 }, { translateY: back * 6 }, { rotate: `${back * 4}deg` }, { scale: 1 - back * 0.04 }],
    };
  });
  const shade = useAnimatedStyle(() => ({ opacity: Math.min(0.45, Math.max(0, page - pos.value) * 0.22) }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 60 - page }, style]}>
      {children}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shade, shade]} />
    </Animated.View>
  );
}

function ReadPage({ uri, width, alt }: { uri: string; width: number; alt?: string }) {
  const [ratio, setRatio] = useState<number>();
  useEffect(() => {
    let live = true;
    measureImageAspect(uri).then(r => { if (live && r) setRatio(r); });
    return () => { live = false; };
  }, [uri]);
  return (
    <Image
      source={{ uri }}
      style={{ width, height: width / (ratio ?? 1), borderRadius: 8, backgroundColor: "rgba(0,0,0,0.4)" }}
      contentFit="contain"
      accessibilityLabel={alt || undefined}
    />
  );
}

const styles = StyleSheet.create({
  side: { borderRadius: 14, overflow: "hidden", backfaceVisibility: "hidden" },
  face: { position: "absolute", top: 6, left: 6, right: 6, bottom: 6, borderRadius: 9, overflow: "hidden" },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 6 },
  title: { flex: 1, color: INK, fontFamily: SERIF, fontStyle: "italic", fontWeight: "600", fontSize: 14 },
  num: { color: INK, fontFamily: MONO, fontSize: 10, letterSpacing: 0.4 },
  art: { marginHorizontal: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#0b0b0e", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.18)" },
  altSpot: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  cap: { color: INK, fontFamily: SERIF, fontStyle: "italic", fontSize: 13.5, lineHeight: 18, paddingHorizontal: 11, paddingTop: 8, paddingBottom: 10, minHeight: 50 },
  shade: { backgroundColor: "#000", borderRadius: 14 },
  floor: { position: "absolute", height: 26, borderRadius: 30, backgroundColor: "rgba(0,0,0,0.45)" },
  back: { borderWidth: 6, padding: 16, gap: 10 },
  lab: { fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.6, textTransform: "uppercase" },
  backTitle: { color: INK, fontFamily: SERIF, fontStyle: "italic", fontWeight: "600", fontSize: 20, lineHeight: 25 },
  backAlt: { color: "rgba(255,255,255,0.72)", fontSize: 13, lineHeight: 19 },
  backFoot: { marginTop: "auto", flexDirection: "row", justifyContent: "space-between", gap: 8 },
  footText: { color: "rgba(255,255,255,0.5)", fontFamily: MONO, fontSize: 10 },
  mini: { width: 34, height: 48, padding: 2, borderRadius: 6, borderWidth: 2, backgroundColor: "#111" },
  miniImg: { flex: 1, borderRadius: 3 },
  pill: { height: 36, justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  pillText: { color: "#fff", fontSize: 14, fontWeight: "500" },
  readHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 8 },
  readTitle: { flex: 1, color: "#fff", fontWeight: "600", fontSize: 15 },
  readNum: { color: "rgba(255,255,255,0.5)", fontFamily: MONO, fontSize: 11, paddingTop: 2 },
  readCap: { flex: 1, color: "#fff", fontFamily: SERIF, fontStyle: "italic", fontSize: 14, lineHeight: 20 },
});

export default memo(ComicDeck);
