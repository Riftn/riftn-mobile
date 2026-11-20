import React, { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, View, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useAppTheme } from "../../context/ThemeContext";

/**
 * The row of look cards in Settings → Appearance (Sign-in screen, After you
 * sign in): a side-swipe carousel where one and a half cards show. A card's
 * preview is only built once it has been swiped into view, and only plays
 * while it is in view, so a row of looping previews never runs at once.
 * Bleeds through the bento's padding like ThemePicker, so cards slide out
 * under the bento's edge instead of being sliced off inside it.
 */
const BENTO_PAD = 16;
const GAP = 12;

export type LookCardView = { seen: boolean; inView: boolean; width: number };

/** Same width for every card: 60% of the bento's inside. */
export function useLookCardWidth(): number {
  const { width } = useWindowDimensions();
  const { skin } = useAppTheme();
  const inside = width - (skin ? 16 : 0) - BENTO_PAD * 2;
  return Math.round(Math.min(inside * 0.6, 260));
}

export default function LookCarousel({
  count,
  activeIndex,
  renderCard,
}: {
  count: number;
  /** The picked card, brought into view when the row first shows. */
  activeIndex: number;
  renderCard: (index: number, view: LookCardView) => React.ReactNode;
}) {
  const cardW = useLookCardWidth();
  const step = cardW + GAP;
  const scroller = useRef<ScrollView>(null);
  const [viewport, setViewport] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, -1]);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const opened = useRef(false);

  const update = useCallback(
    (x: number, w: number) => {
      if (!w) return;
      // A card counts as in view once a quarter of it shows.
      const first = Math.max(0, Math.ceil((x - BENTO_PAD - cardW * 0.75) / step));
      const last = Math.min(count - 1, Math.floor((x - BENTO_PAD + w - cardW * 0.25) / step));
      setRange((prev) => (prev[0] === first && prev[1] === last ? prev : [first, last]));
      setSeen((prev) => {
        let next: Set<number> | null = null;
        for (let i = first; i <= last; i++) {
          if (!prev.has(i)) (next ??= new Set(prev)).add(i);
        }
        return next ?? prev;
      });
    },
    [cardW, step, count],
  );

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      setViewport(w);
      if (opened.current) return;
      opened.current = true;
      // Open on the picked card, so a pick far along the row isn't lost.
      const x = activeIndex > 0 ? Math.max(0, activeIndex * step) : 0;
      if (x > 0) scroller.current?.scrollTo({ x, animated: false });
      update(x, w);
    },
    [activeIndex, step, update],
  );

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => update(e.nativeEvent.contentOffset.x, viewport),
    [update, viewport],
  );

  const offsets = useMemo(() => Array.from({ length: count }, (_, i) => i * step), [count, step]);

  return (
    <ScrollView
      ref={scroller}
      horizontal
      accessibilityRole="radiogroup"
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      snapToOffsets={offsets}
      onLayout={onLayout}
      onScroll={onScroll}
      scrollEventThrottle={32}
      style={{ marginHorizontal: -BENTO_PAD }}
      contentContainerStyle={{ gap: GAP, paddingHorizontal: BENTO_PAD, paddingVertical: 2 }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ width: cardW }}>
          {renderCard(i, { seen: seen.has(i), inView: i >= range[0] && i <= range[1], width: cardW })}
        </View>
      ))}
    </ScrollView>
  );
}
