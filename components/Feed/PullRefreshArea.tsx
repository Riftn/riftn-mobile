import React, { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from "react-native";
import { Gesture, GestureDetector, type NativeGesture } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import PullRefreshMark, { PULL_HOLD, PULL_HOLD_MAX_MS } from "./PullRefreshMark";
import { PULL_CANCEL_MS, PULL_RETURN_MS, pullForDrag, pullShouldRefresh, pullSpringProgress } from "../../libs/pill-pull-motion";

/** A list scrolled this recently (ms) is still gliding from a fling. */
const SCROLL_SETTLE_MS = 140;

type AreaList = { gesture: NativeGesture; onScrollY: (y: number) => void };
const AreaContext = createContext<AreaList | null>(null);

/**
 * The list's scroll view inside a PullRefreshArea (FlatList / FlashList:
 * `renderScrollComponent={PullRefreshScrollView}`). It tells the area where
 * the list is and shares the finger with it. Outside an area it is a plain
 * ScrollView.
 */
export const PullRefreshScrollView = forwardRef<ScrollView, ScrollViewProps>(function PullRefreshScrollView(props, ref) {
  const area = useContext(AreaContext);
  const { onScroll } = props;
  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    area?.onScrollY(e.nativeEvent.contentOffset.y);
    onScroll?.(e);
  }, [area, onScroll]);
  if (!area) return <ScrollView ref={ref} {...props} />;
  return (
    <GestureDetector gesture={area.gesture}>
      <ScrollView
        ref={ref}
        {...props}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        // The area draws the pull. A bounce or a RefreshControl here would
        // move the rows twice, or (Android) wrap the scroll view so the
        // gesture above no longer sits on it.
        bounces={false}
        overScrollMode="never"
        refreshControl={undefined}
      />
    </GestureDetector>
  );
});

/**
 * Pull to refresh that always answers the finger: pulled down from the top
 * of the list, the rows lower with it and a refresh mark turns in the gap;
 * let go past the mark's full turn and the list holds there with a spinner
 * until the refresh reports back. Replaces the native RefreshControl, whose
 * spinner the app hides, so a pull showed nothing and only a very long one
 * (about twice the spinner's travel) refreshed at all.
 */
export default function PullRefreshArea({ refreshing, onRefresh, enabled = true, children }: {
  refreshing: boolean;
  onRefresh: () => void;
  enabled?: boolean;
  children: React.ReactNode;
}) {
  const scrollY = useSharedValue(0);
  const lastScrollAt = useSharedValue(0);
  const onScrollY = useCallback((y: number) => {
    scrollY.value = y;
    lastScrollAt.value = Date.now();
  }, [scrollY, lastScrollAt]);
  const native = useMemo(() => Gesture.Native(), []);
  const area = useMemo(() => ({ gesture: native, onScrollY }), [native, onScrollY]);

  const pull = useSharedValue(0);
  const armed = useSharedValue(false);
  const pulling = useSharedValue(false);
  const holding = useSharedValue(false);
  const busy = useSharedValue(refreshing);
  const [spinning, setSpinning] = useState(false);
  const refreshingRef = useRef(refreshing);
  refreshingRef.current = refreshing;

  const settle = useCallback(() => {
    holding.value = false;
    pull.value = withTiming(0, { duration: PULL_RETURN_MS, easing: pullSpringProgress });
    setSpinning(false);
  }, [holding, pull]);
  const run = useCallback(() => {
    setSpinning(true);
    onRefresh();
    // A refresh that was skipped (one already running) never reports back.
    setTimeout(() => { if (!refreshingRef.current && holding.value) settle(); }, 700);
  }, [onRefresh, holding, settle]);
  useEffect(() => {
    busy.value = refreshing;
    if (!refreshing && holding.value) settle();
  }, [refreshing, busy, holding, settle]);
  useEffect(() => {
    if (!spinning) return;
    const timer = setTimeout(settle, PULL_HOLD_MAX_MS);
    return () => clearTimeout(timer);
  }, [spinning, settle]);

  const pan = useMemo(() => Gesture.Pan()
    .enabled(enabled)
    .maxPointers(1)
    .activeOffsetY(10)
    .failOffsetY(-10)
    .failOffsetX([-16, 16])
    .simultaneousWithExternalGesture(native)
    .onTouchesDown((_event, state) => {
      if (scrollY.value > 1 || busy.value || holding.value) state.fail();
    })
    .onBegin(() => {
      armed.value = scrollY.value <= 1 && Date.now() - lastScrollAt.value > SCROLL_SETTLE_MS && !busy.value && !holding.value;
      pulling.value = false;
    })
    .onUpdate((e) => {
      if (!armed.value) return;
      if (!pulling.value) {
        if (scrollY.value > 1 || e.translationY < -4) { armed.value = false; return; }
        if (e.translationY <= 0) return;
        pulling.value = true;
      }
      pull.value = pullForDrag(e.translationY);
    })
    .onEnd((e) => {
      if (!pulling.value) return;
      pulling.value = false;
      armed.value = false;
      if (pullShouldRefresh(pull.value, e.velocityY) && !busy.value) {
        holding.value = true;
        pull.value = withTiming(PULL_HOLD, { duration: PULL_RETURN_MS, easing: pullSpringProgress });
        runOnJS(run)();
      } else {
        pull.value = withTiming(0, { duration: PULL_CANCEL_MS, easing: pullSpringProgress });
      }
    })
    .onFinalize(() => {
      if (pulling.value && !holding.value) pull.value = withTiming(0, { duration: PULL_CANCEL_MS, easing: pullSpringProgress });
      pulling.value = false;
      armed.value = false;
    }), [enabled, native, scrollY, lastScrollAt, busy, holding, armed, pulling, pull, run]);

  const listStyle = useAnimatedStyle(() => ({ transform: [{ translateY: pull.value }] }));
  return (
    <GestureDetector gesture={pan}>
      <View style={styles.root}>
        <PullRefreshMark pull={pull} holding={holding} spinning={spinning} />
        <Animated.View style={[styles.root, listStyle]}>
          <AreaContext.Provider value={area}>{children}</AreaContext.Provider>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: "hidden" },
});
