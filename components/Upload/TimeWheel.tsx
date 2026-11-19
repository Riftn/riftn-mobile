import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView } from "react-native";
import * as Haptics from "expo-haptics";
import { useKitColors } from "../page/PageKit";
import { uses12Hour, wheelColumns, wheelIndexes, wheelLabels, wheelMinutes } from "../../libs/clockWheel";

const ITEM = 40;
const VISIBLE = 5;

interface WheelProps {
  items: string[];
  value: number;
  onChange: (index: number) => void;
  label: string;
}

/**
 * One spinning column, like the iPhone clock: flick it and it settles on the
 * row in the middle band, with a light tick per row. Tapping a row picks it.
 */
function Wheel({ items, value, onChange, label }: WheelProps) {
  const ref = useRef<ScrollView>(null);
  const y = useRef(new Animated.Value(value * ITEM)).current;
  const moving = useRef(false);
  const ticked = useRef(value);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clamp = (i: number) => Math.max(0, Math.min(items.length - 1, i));

  // Follow outside changes (a pick, typed text) unless the finger is on it.
  useEffect(() => {
    if (moving.current) return;
    ticked.current = value;
    ref.current?.scrollTo({ y: value * ITEM, animated: true });
  }, [value]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const settle = (offset: number) => {
    moving.current = false;
    const i = clamp(Math.round(offset / ITEM));
    if (i !== value) onChange(i);
  };

  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y } } }], {
      useNativeDriver: true,
      listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const i = clamp(Math.round(event.nativeEvent.contentOffset.y / ITEM));
        if (i === ticked.current) return;
        ticked.current = i;
        try { void Haptics.selectionAsync(); } catch { /* not supported */ }
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [y, items.length],
  );

  return (
    <View style={styles.column}>
      <Animated.ScrollView
        ref={ref as never}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM}
        decelerationRate="fast"
        contentOffset={{ x: 0, y: value * ITEM }}
        // contentOffset is only a first guess on some Androids; land on the value once laid out.
        onLayout={() => ref.current?.scrollTo({ y: value * ITEM, animated: false })}
        contentContainerStyle={{ paddingVertical: ITEM * ((VISIBLE - 1) / 2) }}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={() => { moving.current = true; clearTimeout(settleTimer.current); }}
        // A slow release has no momentum phase (Android never sends one), so
        // settle shortly after the finger lifts unless a fling takes over.
        onScrollEndDrag={event => {
          const offset = event.nativeEvent.contentOffset.y;
          clearTimeout(settleTimer.current);
          settleTimer.current = setTimeout(() => settle(offset), 220);
        }}
        onMomentumScrollBegin={() => clearTimeout(settleTimer.current)}
        onMomentumScrollEnd={event => settle(event.nativeEvent.contentOffset.y)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: items[value] }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={event => {
          const next = clamp(value + (event.nativeEvent.actionName === "increment" ? 1 : -1));
          if (next !== value) onChange(next);
        }}
      >
        {items.map((text, i) => {
          const range = [(i - 2) * ITEM, (i - 1) * ITEM, i * ITEM, (i + 1) * ITEM, (i + 2) * ITEM];
          return (
            <Pressable key={i} onPress={() => onChange(i)} style={styles.row} accessibilityElementsHidden importantForAccessibility="no">
              <Animated.Text
                style={[
                  styles.text,
                  {
                    opacity: y.interpolate({ inputRange: range, outputRange: [0.25, 0.5, 1, 0.5, 0.25], extrapolate: "clamp" }),
                    transform: [
                      { scale: y.interpolate({ inputRange: range, outputRange: [0.82, 0.9, 1, 0.9, 0.82], extrapolate: "clamp" }) },
                      { perspective: 300 },
                      { rotateX: y.interpolate({ inputRange: [(i - 2) * ITEM, i * ITEM, (i + 2) * ITEM], outputRange: ["40deg", "0deg", "-40deg"], extrapolate: "clamp" }) },
                    ],
                  },
                ]}
              >
                {text}
              </Animated.Text>
            </Pressable>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

interface TimeWheelProps {
  /** Minutes after midnight. */
  minutes: number;
  onChange: (minutes: number) => void;
  locale?: string;
}

/** Hours, minutes and (for 12-hour clocks) AM/PM, side by side over one highlight band. Same as web. */
export default function TimeWheel({ minutes, onChange, locale }: TimeWheelProps) {
  const c = useKitColors();
  const cols = useMemo(() => wheelColumns(locale), [locale]);
  const twelve = useMemo(() => uses12Hour(locale), [locale]);
  const labels = useMemo(() => wheelLabels(locale), [locale]);
  const idx = wheelIndexes(minutes, twelve);
  const set = (patch: Partial<typeof idx>) => onChange(wheelMinutes({ ...idx, ...patch }, twelve));

  return (
    <View style={styles.wrap}>
      {/* The band the picked row sits in; the fill is on its own View so the control pass leaves it alone. */}
      <View pointerEvents="none" style={[styles.band, { backgroundColor: c.chipBg, borderColor: c.hairline, borderWidth: c.isMinimal ? 1 : 0 }]} />
      <Wheel items={cols.hours} value={idx.hour} onChange={hour => set({ hour })} label={labels.hour} />
      <View pointerEvents="none" style={styles.colon}><Animated.Text style={styles.text}>:</Animated.Text></View>
      <Wheel items={cols.minutes} value={idx.minute} onChange={minute => set({ minute })} label={labels.minute} />
      {cols.periods ? <Wheel items={cols.periods} value={idx.period} onChange={period => set({ period })} label={labels.period} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignSelf: "center", width: "100%", maxWidth: 280, height: ITEM * VISIBLE, gap: 4 },
  band: { position: "absolute", left: 0, right: 0, top: ITEM * ((VISIBLE - 1) / 2), height: ITEM, borderRadius: 12 },
  column: { flex: 1, height: ITEM * VISIBLE },
  row: { height: ITEM, alignItems: "center", justifyContent: "center" },
  colon: { justifyContent: "center" },
  text: { color: "#FFFFFF", fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
