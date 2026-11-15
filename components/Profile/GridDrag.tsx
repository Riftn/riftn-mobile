/**
 * Moving a post on your own profile grid by the grip in its corner.
 *
 * The grid is a recycling list, so its cells cannot slide around each other
 * the way the Arrange sheet's tiles do. Instead the held tile floats over the
 * grid as a copy that follows the finger, the slot it would land in is
 * outlined, and letting go reports "from this place to that place". The list
 * does not scroll while a tile is held; a far move is what the Arrange sheet
 * is for.
 *
 * Usage: wrap the list in `<GridDragHost>`; a tile inside it renders
 * `<GridGrip>` when `useGridDrag()` is not null.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

const COLUMNS = 3;
const HOLD_MS = 140;
const LIFT_SCALE = 1.05;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);

type Rect = { x: number; y: number; w: number; h: number };

interface GridDragApi {
  tx: SharedValue<number>;
  ty: SharedValue<number>;
  /** 1 while a tile is held. */
  active: SharedValue<number>;
  begin: (index: number, cell: View | null, ghost: React.ReactNode) => void;
  finish: () => void;
}

const GridDragContext = createContext<GridDragApi | null>(null);

/** Null when the grid here is not the owner's to arrange. */
export const useGridDrag = () => useContext(GridDragContext);

interface HostProps {
  enabled: boolean;
  /** How many posts the grid holds now: a tile cannot be dropped past the last one. */
  getCount: () => number;
  onDrop: (from: number, to: number) => void;
  /** Told when a tile is lifted and let go, so the list can stop scrolling under it. */
  onHoldChange?: (holding: boolean) => void;
  children: React.ReactNode;
}

export function GridDragHost({ enabled, getCount, onDrop, onHoldChange, children }: HostProps) {
  const hostRef = useRef<View>(null);
  const [held, setHeld] = useState<{ index: number; rect: Rect; ghost: React.ReactNode } | null>(null);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const active = useSharedValue(0);
  const start = useSharedValue(0);
  const total = useSharedValue(1);
  const countRef = useRef(getCount);
  countRef.current = getCount;
  const origin = useSharedValue<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const lift = useSharedValue(1);

  // The place under the middle of the held tile, counted in whole tiles from
  // where it started. Every tile is the same size, three across.
  const target = useDerivedValue(() => {
    const { w, h } = origin.value;
    const col0 = start.value % COLUMNS;
    const col = Math.min(COLUMNS - 1, Math.max(0, col0 + Math.round(tx.value / w)));
    const row = Math.floor(start.value / COLUMNS) + Math.round(ty.value / h);
    return Math.min(Math.max(0, total.value - 1), Math.max(0, row * COLUMNS + col));
  });

  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const holdRef = useRef(onHoldChange);
  holdRef.current = onHoldChange;

  const begin = useCallback((index: number, cell: View | null, ghost: React.ReactNode) => {
    const host = hostRef.current;
    if (!cell || !host || active.value) return;
    host.measureInWindow((hx, hy) => {
      cell.measureInWindow((x, y, w, h) => {
        if (!w || !h) return;
        const rect = { x: x - hx, y: y - hy, w, h };
        origin.value = rect;
        start.value = index;
        total.value = Math.max(1, countRef.current());
        tx.value = 0;
        ty.value = 0;
        active.value = 1;
        lift.value = withTiming(LIFT_SCALE, { duration: 220, easing: EASE });
        setHeld({ index, rect, ghost });
        holdRef.current?.(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => { /* no haptics */ });
      });
    });
  }, [active, lift, origin, start, total, tx, ty]);

  const finish = useCallback(() => {
    if (!active.value) return;
    const from = start.value;
    const to = target.value;
    active.value = 0;
    lift.value = 1;
    setHeld(null);
    holdRef.current?.(false);
    if (to !== from) dropRef.current(from, to);
  }, [active, lift, start, target]);

  const api = useMemo<GridDragApi>(() => ({ tx, ty, active, begin, finish }), [tx, ty, active, begin, finish]);

  const ghostStyle = useAnimatedStyle(() => ({
    left: origin.value.x,
    top: origin.value.y,
    width: origin.value.w,
    height: origin.value.h,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: lift.value }],
  }));
  const slotStyle = useAnimatedStyle(() => {
    const { x, y, w, h } = origin.value;
    const moved = target.value !== start.value;
    const col = (target.value % COLUMNS) - (start.value % COLUMNS);
    const row = Math.floor(target.value / COLUMNS) - Math.floor(start.value / COLUMNS);
    return { left: x + col * w, top: y + row * h, width: w, height: h, opacity: moved ? 1 : 0 };
  });

  return (
    <GridDragContext.Provider value={enabled ? api : null}>
      <View ref={hostRef} style={styles.host} collapsable={false}>
        {children}
        {held && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {/* The place it left, dimmed, so the copy reads as the tile itself. */}
            <View style={[styles.left, { left: held.rect.x, top: held.rect.y, width: held.rect.w, height: held.rect.h }]} />
            <Animated.View style={[styles.slot, slotStyle]}><View style={styles.slotLine} /></Animated.View>
            <Animated.View style={[styles.ghost, ghostStyle]}>{held.ghost}</Animated.View>
          </View>
        )}
      </View>
    </GridDragContext.Provider>
  );
}

interface GripProps {
  index: number;
  /** The tile's own cell, measured when it lifts. */
  cellRef: React.RefObject<View | null>;
  /** What floats under the finger: the tile, drawn again without its grip. */
  ghost: () => React.ReactNode;
  /** A light poster tile: dark dots on a faint chip. */
  light?: boolean;
  label: string;
}

export function GridGrip({ index, cellRef, ghost, light, label }: GripProps) {
  const drag = useGridDrag();
  const mine = useSharedValue(0);
  const lift = useCallback(() => {
    drag?.begin(index, cellRef.current, ghost());
  }, [drag, index, cellRef, ghost]);
  const drop = useCallback(() => drag?.finish(), [drag]);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!!drag)
    .activateAfterLongPress(HOLD_MS)
    .onStart(() => {
      "worklet";
      if (!drag || drag.active.value) return;
      mine.value = 1;
      runOnJS(lift)();
    })
    .onUpdate((e) => {
      "worklet";
      if (!drag || !mine.value) return;
      drag.tx.value = e.translationX;
      drag.ty.value = e.translationY;
    })
    .onFinalize(() => {
      "worklet";
      if (!mine.value) return;
      mine.value = 0;
      runOnJS(drop)();
    }), [drag, mine, lift, drop]);

  if (!drag) return null;
  // dark-surface: kept out of the light theme's tone pass, like the tile under it.
  const dot = light ? styles.dotDark : styles.dotLight;
  return (
    <GestureDetector gesture={gesture}>
      <View className="dark-surface" style={styles.grip} accessible accessibilityRole="button" accessibilityLabel={label} collapsable={false}>
        <View style={[styles.chip, light && styles.chipLight]}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={styles.dots}><View style={[styles.dot, dot]} /><View style={[styles.dot, dot]} /></View>
          ))}
        </View>
      </View>
    </GestureDetector>
  );
}

/** Room the grip takes in a tile's bottom right corner, for what sat there. */
export const GRIP_ROOM = 30;

const styles = StyleSheet.create({
  host: { flex: 1 },
  left: { position: "absolute", backgroundColor: "rgba(0,0,0,0.55)" },
  slot: { position: "absolute", padding: 1 },
  slotLine: { flex: 1, borderRadius: 6, borderWidth: 2, borderColor: "#FFFFFF", backgroundColor: "rgba(255,255,255,0.14)" },
  ghost: {
    position: "absolute",
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  // A thumb-sized target around a small chip.
  grip: { position: "absolute", right: 0, bottom: 0, width: 40, height: 40, alignItems: "flex-end", justifyContent: "flex-end", padding: 6 },
  chip: { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", gap: 2.5, backgroundColor: "rgba(0,0,0,0.5)" },
  chipLight: { backgroundColor: "rgba(0,0,0,0.1)" },
  dots: { flexDirection: "row", gap: 2.5 },
  dot: { width: 3, height: 3, borderRadius: 1.5 },
  dotLight: { backgroundColor: "#FFFFFF" },
  dotDark: { backgroundColor: "#17161B" },
});
