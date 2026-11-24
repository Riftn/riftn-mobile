/**
 * Live reaction arrival (app side of web src/components/app/chat/ReactionArrival)
 * ===============================================================================
 * A reaction landing on a chat line, yours or somebody else's, now moves:
 *
 *   - the emoji itself plays once (Noto animated emoji, libs/chatReactionEmoji),
 *     all the way to its last frame, and melts back into the still glyph;
 *   - the chip answers with the look picked in Settings → Appearance →
 *     "Reactions in chat" (libs/chatReactionStyle): Fly in by default, Pop,
 *     Burst, or Off;
 *   - the number rolls to its new value (RollingCount).
 *
 * What counts as an arrival: the chip's list of people grew while it was on
 * screen, or a chip appeared on a message that had already been on screen for
 * a moment (useReactionHost). Opening a chat, older pages and re-mounted rows
 * never play.
 *
 * Flights and bursts leave the chip, so they are drawn by the nearest
 * ReactionArrivalScope (an overlay over the chat list) rather than inside the
 * row, where the next row or the list edge would cover them. A chip with no
 * scope above it just pops. Reduced motion: count change only.
 */
import React, { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { getAppPrefs } from "../../hooks/useAppPrefs";
import { animatedChatEmoji } from "../../libs/chatReactionEmoji";
import { useAppTheme } from "../../context/ThemeContext";
import { EmojiClip, EmojiClipWarmUp, EmojiPoster } from "./EmojiClip";
import { useClipPlayer, type ClipArt } from "./useClipPlayer";

const HOST_SETTLE_MS = 700;
/** A flying copy fades out over this long once it is sitting on the chip. */
const LAND_COVER_MS = 80;
/** The moving emoji is drawn in a box this many times the still one's font size. */
export const CLIP_BOX = 1.35;
/** A flying emoji with no moving file is text at this share of its box. */
const TEXT_FILL = 0.8;

type Art = ClipArt;

const hostSeenAt = new Map<string, number>();
const chipsSeen = new Set<string>();

/** Note that a chat message is on screen. Safe inside a loop (no React state). */
export function markReactionHost(messageId: string | undefined | null) {
  if (messageId && !hostSeenAt.has(messageId)) hostSeenAt.set(messageId, Date.now());
}

/** Call once per rendered chat message, before its reactions. */
export function useReactionHost(messageId: string | undefined | null) {
  markReactionHost(messageId);
}

const includes = (list: readonly string[], me?: string | null) => {
  if (!me) return false;
  const low = me.toLowerCase();
  return list.some((a) => a?.toLowerCase() === low);
};

type Point = { x: number; y: number };
interface Flight {
  id: number;
  kind: "fly" | "bloom" | "ring";
  emoji: string;
  /** The moving file for this emoji, when it has one. */
  art: Art | null;
  /** How big the emoji is where it lands, so the flying copy ends at that size. */
  landSize?: number;
  mine: boolean;
  to: Point;
  from: Point;
  /** Where the chip was, in window pixels, when it took off. */
  toWindow: Point;
  /** The chip itself, so the flight can follow it if the list moves it mid-air. */
  target?: React.RefObject<View | null>;
  onLand?: () => void;
}
interface ScopeApi {
  /** Window position of the scope's overlay, to turn chip positions into overlay ones. */
  launch: (flight: Omit<Flight, "id" | "to" | "from"> & { fromWindow?: Point }) => void;
}
const ScopeContext = createContext<ScopeApi | null>(null);

/** The nearest ReactionArrivalScope, for things outside a chat chip that land reactions (the Messages list badge). */
export function useReactionArrivalScope(): ScopeApi | null {
  return useContext(ScopeContext);
}

/**
 * Wrap a chat list (or the whole chat body) in this so reactions can fly over
 * it. It is a plain View: pass the style the wrapped container had.
 */
export function ReactionArrivalScope({ style, pointerEvents, children }: { style?: StyleProp<ViewStyle>; pointerEvents?: "box-none" | "auto"; children: React.ReactNode }) {
  const overlay = useRef<View>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const nextId = useRef(0);
  const api = useMemo<ScopeApi>(() => ({
    launch: ({ fromWindow, ...rest }) => {
      const { toWindow } = rest;
      overlay.current?.measureInWindow((ox, oy, ow, oh) => {
        const to = { x: toWindow.x - ox, y: toWindow.y - oy };
        const from = fromWindow
          ? { x: fromWindow.x - ox, y: fromWindow.y - oy }
          : rest.mine
            ? { x: to.x + 40, y: Math.max(12, to.y - 90) }
            : { x: to.x + (Math.random() < 0.5 ? -1 : 1) * (24 + Math.random() * 30), y: Math.min(oh - 8, to.y + 120) };
        const id = nextId.current++;
        setFlights((list) => [...list.slice(-11), { ...rest, id, to, from: { x: Math.min(Math.max(from.x, 8), ow - 8), y: from.y } }]);
      });
    },
  }), []);
  const done = useCallback((id: number) => setFlights((list) => list.filter((f) => f.id !== id)), []);
  return (
    <ScopeContext.Provider value={api}>
      <View style={style} pointerEvents={pointerEvents}>
        {children}
        <View ref={overlay} collapsable={false} pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 50, elevation: 50 }]}>
          <EmojiClipWarmUp />
          {flights.map((f) => <FlightView key={f.id} flight={f} onDone={done} />)}
        </View>
      </View>
    </ScopeContext.Provider>
  );
}

function useTint() {
  const { isLight } = useAppTheme();
  return isLight ? "rgba(24,24,27,0.55)" : "rgba(244,244,245,0.8)";
}

/**
 * Emoji drawn in flight: the character until the moving file is ready, then
 * the file. It is the file's first frame held still (nothing plays out of
 * sight on the way to the chip) unless `play`, which runs it once and rests
 * on the last.
 */
const FlyingEmoji = memo(function FlyingEmoji({ emoji, art, size, play, onEnd }: { emoji: string; art: Art | null; size: number; play?: boolean; onEnd?: () => void }) {
  const [ready, setReady] = useState(false);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {!ready && <Text style={{ fontSize: size * TEXT_FILL, includeFontPadding: false, textAlignVertical: "center" }}>{emoji}</Text>}
      {art ? (
        <View style={[StyleSheet.absoluteFill, { opacity: ready ? 1 : 0 }]}>
          {play
            ? <EmojiClip uri={art.uri} ms={art.ms} size={size} play={ready} onReady={() => setReady(true)} onEnd={onEnd} />
            : <EmojiPoster uri={art.uri} size={size} onReady={() => setReady(true)} />}
        </View>
      ) : null}
    </View>
  );
});

function arcStops(from: Point, ctrl: Point, to: Point, steps = 10) {
  const xs: number[] = [];
  const ys: number[] = [];
  const ts: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    ts.push(t);
    xs.push(u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x);
    ys.push(u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y);
  }
  return { ts, xs, ys };
}

const SPARKS = [0, 1, 2, 3, 4, 5];

/** How long a flight keeps checking where its chip is: the longest flight plus its landing. */
const FOLLOW_MS = 4500;

/**
 * Keeps a flight on its chip while it is in the air.
 *
 * The landing spot is measured once, as the reaction arrives, but the chip
 * keeps moving after that: the list scrolls to keep the newest line in view,
 * other chips wrap, a panel slides. The emoji then landed where the chip used
 * to be. This re-measures the chip every frame and shifts the whole flight by
 * how far it has moved, so it always ends on the chip.
 */
function useFollowChip(flight: Flight) {
  const offset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  useEffect(() => {
    const target = flight.target;
    if (!target) return;
    let alive = true;
    let busy = false;
    let frame = 0;
    const started = Date.now();
    const tick = () => {
      if (!alive || Date.now() - started > FOLLOW_MS) return;
      if (!busy && target.current) {
        busy = true;
        target.current.measureInWindow((x, y, w, h) => {
          busy = false;
          // Gone from layout (row recycled, tab hidden): keep the last good spot.
          if (!alive || (w === 0 && h === 0)) return;
          offset.setValue({ x: x + w / 2 - flight.toWindow.x, y: y + h / 2 - flight.toWindow.y });
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(frame); };
    // One follow per flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return offset;
}

const FlightView = memo(function FlightView({ flight, onDone }: { flight: Flight; onDone: (id: number) => void }) {
  const t = useRef(new Animated.Value(0)).current;
  const spark = useRef(new Animated.Value(0)).current;
  /** Bloom only: the drop from over the line into the chip (started when its emoji has played), then the melt. */
  const drop = useRef(new Animated.Value(0)).current;
  const melt = useRef(new Animated.Value(0)).current;
  const dropping = useRef(false);
  const startedAt = useRef(Date.now()).current;
  const follow = useFollowChip(flight);
  const tint = useTint();
  const { kind, mine, to, from, art } = flight;
  const size = kind === "bloom" ? 58 : mine ? 34 : 26;
  const total = kind === "bloom" ? 400 : kind === "ring" ? 520 : mine ? 640 : 760;
  const sparkCenter = kind === "bloom" ? { x: to.x, y: Math.max(size, to.y - 44) } : to;
  // The size it shrinks to so it lands exactly on the chip's emoji.
  const end = (flight.landSize ?? 16) / size;
  const tail = kind === "fly" ? 640 : kind === "bloom" ? 0 : 120;

  /** Bloom: fall into the chip, land, melt away. Runs once, when the emoji has played (or straight away without one). */
  const startDrop = useCallback(() => {
    if (dropping.current) return;
    dropping.current = true;
    const run = () => {
      Animated.sequence([
        Animated.timing(drop, { toValue: 1, duration: 400, easing: Easing.bezier(0.5, 0, 0.3, 1), useNativeDriver: true }),
        Animated.timing(melt, { toValue: 1, duration: LAND_COVER_MS, easing: Easing.linear, useNativeDriver: true }),
      ]).start(() => onDone(flight.id));
      setTimeout(() => flight.onLand?.(), 370);
    };
    // It always gets its moment over the line first.
    const wait = startedAt + 850 - Date.now();
    if (wait > 0) setTimeout(run, wait);
    else run();
  }, [drop, melt, flight, onDone, startedAt]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (kind === "bloom") {
      timers.push(setTimeout(() => Animated.timing(spark, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(), 220));
      Animated.timing(t, { toValue: 1, duration: total, easing: Easing.linear, useNativeDriver: true }).start();
      // With a moving file the drop waits for it to finish (FlyingEmoji onEnd); this is the backstop.
      timers.push(setTimeout(startDrop, art ? art.ms + 1500 : 850));
      return () => timers.forEach(clearTimeout);
    }
    timers.push(setTimeout(() => {
      flight.onLand?.();
      if (kind === "fly") Animated.timing(spark, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, kind === "ring" ? 0 : total - 30));
    if (kind === "ring") Animated.timing(spark, { toValue: 1, duration: total, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.timing(t, { toValue: 1, duration: total + tail, easing: Easing.linear, useNativeDriver: true }).start(() => onDone(flight.id));
    return () => timers.forEach(clearTimeout);
    // One run per flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The flight itself occupies the first `share` of t; the rest lets sparks finish.
  const share = total / (total + tail);
  let body: React.ReactNode = null;
  if (kind === "fly") {
    const ctrl = { x: (from.x + to.x) / 2 + (mine ? -30 : 0), y: Math.min(from.y, to.y) - (mine ? 60 : 40) };
    const { ts, xs, ys } = arcStops(from, ctrl, to);
    const input = ts.map((v) => v * share);
    // It stays whole until it is sitting on the chip, then melts into the emoji under it.
    const gone = share + LAND_COVER_MS / (total + tail);
    body = (
      <Animated.View
        style={{
          position: "absolute", left: -size / 2, top: -size / 2,
          opacity: t.interpolate({ inputRange: [0, 0.1 * share, share, gone, 1], outputRange: [0, 1, 1, 0, 0] }),
          transform: [
            { translateX: t.interpolate({ inputRange: input, outputRange: xs, extrapolate: "clamp" }) },
            { translateY: t.interpolate({ inputRange: input, outputRange: ys, extrapolate: "clamp" }) },
            { scale: t.interpolate({ inputRange: [0, 0.15 * share, 0.55 * share, share], outputRange: [0.5, 1, 1, end], extrapolate: "clamp" }) },
          ],
        }}
      >
        <FlyingEmoji emoji={flight.emoji} art={art} size={size} />
      </Animated.View>
    );
  } else if (kind === "bloom") {
    // t: the bloom (0..1 over 400 ms). drop: the fall into the chip. melt: it fades onto the chip's own emoji.
    body = (
      <Animated.View
        style={{
          position: "absolute", left: -size / 2, top: -size / 2,
          opacity: Animated.multiply(
            t.interpolate({ inputRange: [0, 0.45], outputRange: [0, 1], extrapolate: "clamp" }),
            melt.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          ),
          transform: [
            { translateX: drop.interpolate({ inputRange: [0, 1], outputRange: [sparkCenter.x, to.x] }) },
            { translateY: drop.interpolate({ inputRange: [0, 1], outputRange: [sparkCenter.y, to.y] }) },
            { scale: Animated.multiply(
              t.interpolate({ inputRange: [0, 0.62, 1], outputRange: [0.2, 1.18, 1] }),
              drop.interpolate({ inputRange: [0, 1], outputRange: [1, end] }),
            ) },
          ],
        }}
      >
        <FlyingEmoji emoji={flight.emoji} art={art} size={size} play onEnd={startDrop} />
      </Animated.View>
    );
  }

  const ringSize = kind === "bloom" ? 112 : 46;
  const reach = kind === "bloom" ? 54 : kind === "ring" ? 20 : mine ? 18 : 13;
  const count = kind === "bloom" ? 8 : kind === "ring" ? 5 : mine ? 6 : 4;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: follow.getTranslateTransform() }]}>
      {body}
      {kind !== "fly" && (
        <Animated.View
          style={{
            position: "absolute", width: ringSize, height: ringSize, left: sparkCenter.x - ringSize / 2, top: sparkCenter.y - ringSize / 2,
            borderRadius: ringSize / 2, borderWidth: 2, borderColor: tint,
            opacity: spark.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.9, 0] }),
            transform: [{ scale: spark.interpolate({ inputRange: [0, 1], outputRange: [kind === "bloom" ? 0.22 : 0.22, 1] }) }],
          }}
        />
      )}
      {SPARKS.concat(count > 6 ? [6, 7] : []).slice(0, count).map((i) => {
        const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
        const dx = Math.cos(angle) * reach;
        const dy = Math.sin(angle) * reach;
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute", width: 5, height: 5, borderRadius: 2, backgroundColor: tint,
              left: sparkCenter.x - 2.5, top: sparkCenter.y - 2.5,
              opacity: spark.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 0] }),
              transform: [
                { translateX: spark.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
                { translateY: spark.interpolate({ inputRange: [0, 1], outputRange: [0, dy + 6] }) },
              ],
            }}
          />
        );
      })}
    </Animated.View>
  );
});

interface ReactionGlyphProps {
  messageId: string;
  emoji: string;
  /** Everyone on this chip. A longer list than last render is an arrival. */
  addresses: readonly string[];
  me?: string | null;
  /** Font size of the still emoji. */
  size?: number;
  textStyle?: StyleProp<TextStyle>;
  /** The still glyph, when the chip draws its own (custom emoji images). */
  still?: React.ReactNode;
}

/** The emoji inside a chat reaction chip, which plays when a reaction lands. */
export const ReactionGlyph = memo(function ReactionGlyph({ messageId, emoji, addresses, me, size = 14, textStyle, still }: ReactionGlyphProps) {
  const ref = useRef<View>(null);
  const scope = useContext(ScopeContext);
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const shown = useRef(new Animated.Value(1)).current;
  const before = useRef<readonly string[] | null>(null);
  const player = useClipPlayer();
  const box = Math.round(size * CLIP_BOX);

  const bump = useCallback((strength = 1) => {
    const s = 1 + 0.24 * strength;
    Animated.sequence([
      Animated.timing(scale, { toValue: s, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }),
    ]).start();
  }, [scale]);

  useEffect(() => {
    const prev = before.current;
    before.current = addresses;
    let arrived = false;
    let mine = false;
    if (prev === null) {
      const key = `${messageId}|${emoji}`;
      const known = chipsSeen.has(key);
      chipsSeen.add(key);
      const seen = hostSeenAt.get(messageId);
      if (!known && seen !== undefined && Date.now() - seen > HOST_SETTLE_MS) {
        arrived = true;
        mine = includes(addresses, me);
      }
    } else if (addresses.length > prev.length) {
      arrived = true;
      mine = includes(addresses, me) && !includes(prev, me);
    }
    const style = getAppPrefs().chatReactionStyle;
    if (!arrived || reduceMotion || style === "off") return;

    const art = animatedChatEmoji(emoji);
    // A chip that was not there before keeps its emoji out of sight until the flying copy lands.
    const fresh = prev === null;
    const flies = !!scope && (style === "fly" || (style === "burst" && mine));
    const bloom = flies && style === "burst";
    // Burst plays your own reaction big over the line, so its chip does not play it a second time.
    const armed = art && !bloom ? player.prepare(art) : false;

    if (style === "pop" || !scope) {
      scale.setValue(0.35);
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }).start();
      if (armed) player.begin(false);
      return;
    }
    if (!flies) {
      // Burst, someone else's: a small ring and sparks round the chip.
      ref.current?.measureInWindow((x, y, w, h) => {
        if (w === 0 && h === 0) return;
        scope.launch({ kind: "ring", emoji, art: null, mine, toWindow: { x: x + w / 2, y: y + h / 2 }, target: ref });
      });
      bump(0.9);
      if (armed) player.begin(false);
      return;
    }
    if (fresh) shown.setValue(0);
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      shown.setValue(1);
      bump(mine ? 1 : 0.7);
      if (armed) player.begin(true);
    };
    ref.current?.measureInWindow((x, y, w, h) => {
      // Not laid out (hidden tab, closed panel): nowhere to fly to, just show it.
      if (w === 0 && h === 0) { land(); return; }
      scope.launch({
        kind: bloom ? "bloom" : "fly",
        target: ref,
        emoji,
        art,
        landSize: art ? box : size / TEXT_FILL,
        mine,
        toWindow: { x: x + w / 2, y: y + h / 2 },
        onLand: land,
      });
    });
    // A lost flight must never leave the chip blank.
    setTimeout(() => { if (!landed) { landed = true; shown.setValue(1); if (armed) player.begin(false); } }, bloom ? (art?.ms ?? 0) + 3000 : 1600);
    // Only a change in who reacted can be an arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses]);

  const clip = player.clip;
  return (
    <Animated.View ref={ref} collapsable={false} style={{ opacity: shown, transform: [{ scale }], alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ opacity: player.stillOpacity }}>
        {still ?? <Text style={[{ fontSize: size, includeFontPadding: false, textAlignVertical: "center" }, textStyle]}>{emoji}</Text>}
      </Animated.View>
      {clip ? (
        <Animated.View pointerEvents="none" style={{ position: "absolute", width: box, height: box, opacity: player.clipOpacity }}>
          <EmojiClip
            key={clip.key}
            uri={clip.uri}
            ms={clip.ms}
            size={box}
            play={player.playing}
            onReady={() => player.onReady(clip.key)}
            onEnd={() => player.onEnd(clip.key)}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

/** A reaction count that rolls to its new value instead of swapping in place. */
export const RollingCount = memo(function RollingCount({ value, style, className }: { value: number; style?: StyleProp<TextStyle>; className?: string }) {
  const prev = useRef(value);
  const [from, setFrom] = useState<number | null>(null);
  const t = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (prev.current === value) return;
    const old = prev.current;
    prev.current = value;
    if (reduceMotion || getAppPrefs().chatReactionStyle === "off") return;
    setFrom(old);
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 380, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start(() => setFrom(null));
  }, [value, reduceMotion, t]);
  if (from === null) return <Text className={className} style={style}>{value}</Text>;
  const dir = value > from ? 1 : -1;
  return (
    <View style={{ overflow: "hidden" }}>
      <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10 * dir, 0] }) }] }}>
        <Text className={className} style={style}>{value}</Text>
      </Animated.View>
      <Animated.View
        style={{ position: "absolute", left: 0, top: 0, opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0, 0] }), transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -10 * dir] }) }] }}
      >
        <Text className={className} style={style}>{from}</Text>
      </Animated.View>
    </View>
  );
});
