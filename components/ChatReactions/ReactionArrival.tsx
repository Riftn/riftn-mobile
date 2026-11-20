/**
 * Live reaction arrival (app side of web src/components/app/chat/ReactionArrival)
 * ===============================================================================
 * A reaction landing on a chat line, yours or somebody else's, now moves:
 *
 *   - the emoji itself plays once (Noto animated emoji, libs/chatReactionEmoji)
 *     and settles back to the still glyph;
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
import SmartImage from "../common/SmartImage";
import { getAppPrefs } from "../../hooks/useAppPrefs";
import { animatedChatEmoji } from "../../libs/chatReactionEmoji";
import { useAppTheme } from "../../context/ThemeContext";

const HOST_SETTLE_MS = 700;
const PLAY_CAP_MS = 2600;

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
  uri: string | null;
  mine: boolean;
  to: Point;
  from: Point;
  onLand?: () => void;
}
interface ScopeApi {
  /** Window position of the scope's overlay, to turn chip positions into overlay ones. */
  launch: (flight: Omit<Flight, "id" | "to" | "from"> & { toWindow: Point; fromWindow?: Point }) => void;
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
    launch: ({ toWindow, fromWindow, ...rest }) => {
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

/** Emoji drawn in flight: the moving file once it has loaded, the character until then. */
const FlyingEmoji = memo(function FlyingEmoji({ emoji, uri, size }: { emoji: string; uri: string | null; size: number }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {!loaded && <Text style={{ fontSize: size * 0.8, includeFontPadding: false, textAlignVertical: "center" }}>{emoji}</Text>}
      {uri ? (
        <SmartImage source={{ uri }} style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]} contentFit="contain" onLoad={() => setLoaded(true)} />
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

const FlightView = memo(function FlightView({ flight, onDone }: { flight: Flight; onDone: (id: number) => void }) {
  const t = useRef(new Animated.Value(0)).current;
  const spark = useRef(new Animated.Value(0)).current;
  const tint = useTint();
  const { kind, mine, to, from } = flight;
  const size = kind === "bloom" ? 58 : mine ? 34 : 26;
  const total = kind === "bloom" ? 1250 : kind === "ring" ? 520 : mine ? 640 : 760;
  const sparkCenter = kind === "bloom" ? { x: to.x, y: Math.max(size, to.y - 44) } : to;

  useEffect(() => {
    const landAt = kind === "ring" ? 0 : total - 30;
    const land = setTimeout(() => {
      flight.onLand?.();
      if (kind === "fly") Animated.timing(spark, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, landAt);
    const sparkStart = kind === "bloom" ? setTimeout(() => Animated.timing(spark, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(), 220) : null;
    if (kind === "ring") Animated.timing(spark, { toValue: 1, duration: total, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.timing(t, { toValue: 1, duration: kind === "fly" ? total + 640 : total + 120, easing: Easing.linear, useNativeDriver: true }).start(() => onDone(flight.id));
    return () => { clearTimeout(land); if (sparkStart) clearTimeout(sparkStart); };
    // One run per flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The flight itself occupies the first `share` of t; the rest lets sparks finish.
  const share = kind === "fly" ? total / (total + 640) : total / (total + 120);
  let body: React.ReactNode = null;
  if (kind === "fly") {
    const ctrl = { x: (from.x + to.x) / 2 + (mine ? -30 : 0), y: Math.min(from.y, to.y) - (mine ? 60 : 40) };
    const { ts, xs, ys } = arcStops(from, ctrl, to);
    const input = ts.map((v) => v * share);
    const end = 16 / size;
    body = (
      <Animated.View
        style={{
          position: "absolute", left: -size / 2, top: -size / 2,
          opacity: t.interpolate({ inputRange: [0, 0.1 * share, share, share + 0.001, 1], outputRange: [0, 1, 1, 0, 0] }),
          transform: [
            { translateX: t.interpolate({ inputRange: input, outputRange: xs, extrapolate: "clamp" }) },
            { translateY: t.interpolate({ inputRange: input, outputRange: ys, extrapolate: "clamp" }) },
            { scale: t.interpolate({ inputRange: [0, 0.15 * share, 0.55 * share, share], outputRange: [0.5, 1, 1, end], extrapolate: "clamp" }) },
          ],
        }}
      >
        <FlyingEmoji emoji={flight.emoji} uri={flight.uri} size={size} />
      </Animated.View>
    );
  } else if (kind === "bloom") {
    const end = 16 / size;
    const s = share;
    body = (
      <Animated.View
        style={{
          position: "absolute", left: -size / 2, top: -size / 2,
          opacity: t.interpolate({ inputRange: [0, 0.2 * s, s, s + 0.001, 1], outputRange: [0, 1, 1, 0, 0] }),
          transform: [
            { translateX: t.interpolate({ inputRange: [0, 0.68 * s, s], outputRange: [sparkCenter.x, sparkCenter.x, to.x], extrapolate: "clamp" }) },
            { translateY: t.interpolate({ inputRange: [0, 0.68 * s, s], outputRange: [sparkCenter.y, sparkCenter.y, to.y], extrapolate: "clamp" }) },
            { scale: t.interpolate({ inputRange: [0, 0.2 * s, 0.32 * s, 0.68 * s, s], outputRange: [0.2, 1.18, 1, 1, end], extrapolate: "clamp" }) },
          ],
        }}
      >
        <FlyingEmoji emoji={flight.emoji} uri={flight.uri} size={size} />
      </Animated.View>
    );
  }

  const ringSize = kind === "bloom" ? 112 : 46;
  const reach = kind === "bloom" ? 54 : kind === "ring" ? 20 : mine ? 18 : 13;
  const count = kind === "bloom" ? 8 : kind === "ring" ? 5 : mine ? 6 : 4;
  return (
    <>
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
    </>
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
  const [play, setPlay] = useState<{ uri: string; key: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const token = useRef(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

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
    const run = ++token.current;
    if (art) {
      setLoaded(false);
      setPlay({ uri: art.uri, key: Date.now() });
      setTimeout(() => { if (mounted.current && run === token.current) setPlay(null); }, Math.min(PLAY_CAP_MS, art.ms) + (style === "pop" ? 0 : 700));
    }

    const flies = style === "fly" || (style === "burst" && mine);
    if (style === "pop" || !scope) {
      scale.setValue(0.35);
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 140, useNativeDriver: true }).start();
      return;
    }
    if (!flies) {
      // Burst, someone else's: a small ring and sparks round the chip.
      ref.current?.measureInWindow((x, y, w, h) => {
        scope.launch({ kind: "ring", emoji, uri: null, mine, toWindow: { x: x + w / 2, y: y + h / 2 } });
      });
      bump(0.9);
      return;
    }
    shown.setValue(0);
    ref.current?.measureInWindow((x, y, w, h) => {
      scope.launch({
        kind: style === "burst" ? "bloom" : "fly",
        emoji,
        uri: art?.uri ?? null,
        mine,
        toWindow: { x: x + w / 2, y: y + h / 2 },
        onLand: () => {
          shown.setValue(1);
          bump(mine ? 1 : 0.7);
        },
      });
    });
    // A lost flight must never leave the chip blank.
    setTimeout(() => shown.setValue(1), 1600);
    // Only a change in who reacted can be an arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses]);

  const box = Math.round(size * 1.35);
  return (
    <Animated.View ref={ref} collapsable={false} style={{ opacity: shown, transform: [{ scale }], alignItems: "center", justifyContent: "center" }}>
      {still ? (
        <View style={play && loaded ? { opacity: 0 } : null}>{still}</View>
      ) : (
        <Text style={[{ fontSize: size, includeFontPadding: false, textAlignVertical: "center" }, textStyle, play && loaded ? { opacity: 0 } : null]}>{emoji}</Text>
      )}
      {play ? (
        <View pointerEvents="none" style={{ position: "absolute", width: box, height: box }}>
          <SmartImage
            key={play.key}
            source={{ uri: play.uri }}
            style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
            contentFit="contain"
            onLoad={() => setLoaded(true)}
          />
        </View>
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
