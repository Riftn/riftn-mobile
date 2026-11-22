import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../context/ThemeContext';
import Shine from './Shine';

/**
 * [measured width, height, top inset, "x,y,w,h,radius,kind;…"]: a page's real
 * layout as measured on a phone (scripts/ios-nav/tour.ts, "bones"). x and w
 * are tenths of a percent of the width; y, h and radius are points.
 * Kinds: t = a line of text, b = a picture or solid control, i = an icon,
 * s = a card or field.
 */
export type ScreenBonesEntry = [number, number, number, string];

const BONES = require('../../navigation/screenBones.json') as Record<string, ScreenBonesEntry | undefined>;

/**
 * The layouts were measured on an iPhone, where some pages are a short
 * "continue on the website" notice. Those pages are full pages on Android, so
 * the notice's layout (the one many pages share) is not drawn for them there.
 */
let iosNotice: string | null | undefined;
function iosOnlyNotice(): string | null {
  if (iosNotice !== undefined) return iosNotice;
  const seen = new Map<string, number>();
  for (const entry of Object.values(BONES)) {
    if (Array.isArray(entry) && entry[3]) seen.set(entry[3], (seen.get(entry[3]) ?? 0) + 1);
  }
  iosNotice = null;
  for (const [raw, count] of seen) if (count >= 5) iosNotice = raw;
  return iosNotice;
}

export function screenBonesFor(routeName: string | undefined): ScreenBonesEntry | undefined {
  const entry = routeName ? BONES[routeName] : undefined;
  if (!Array.isArray(entry) || !entry[3]) return undefined;
  if (Platform.OS !== 'ios' && entry[3] === iosOnlyNotice()) return undefined;
  return entry;
}

const parsed = new Map<string, [number, number, number, number, number, string][]>();
function shapes(raw: string) {
  let list = parsed.get(raw);
  if (!list) {
    list = raw.split(';').map((bone) => {
      const p = bone.split(',');
      return [Number(p[0]), Number(p[1]), Number(p[2]), Number(p[3]), Number(p[4]), p[5]];
    });
    parsed.set(raw, list);
  }
  return list;
}

/** A page drawn as grey shapes where its text, pictures and cards will be. */
export default function ScreenBones({ entry }: { entry: ScreenBonesEntry }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { isMinimal, isLight, skin, accent } = useAppTheme();
  const [, , measuredTop, raw] = entry;
  const list = useMemo(() => shapes(raw), [raw]);
  // The layout was measured from the top of the screen. Pages sit below the
  // status bar, whose height differs by phone, and this view starts wherever
  // its page does: usually right under the status bar, at the very top for a
  // page drawn edge to edge. Where it starts is read once it is laid out.
  const box = useRef<View>(null);
  const [originY, setOriginY] = useState(insets.top);
  useLayoutEffect(() => {
    box.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y) && Math.abs(y - originY) > 0.5 && y >= 0 && y <= insets.top + 1) setOriginY(y);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insets.top]);
  const shift = insets.top - measuredTop - originY;
  // White under System Light too: its colour pass turns this wash to ink, and
  // an ink value written here was turned back to white (no shapes on white).
  const ink = !isLight && skin && accent ? accent.join(',') : '255,255,255';
  const fill = `rgba(${ink},${isMinimal ? 0.05 : 0.09})`;
  const panel = `rgba(${ink},0.035)`;
  const square = !!skin?.square || isMinimal;
  return (
    <View ref={box} pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {list.map(([x, y, w, h, r, kind], i) => (
        <View key={i} style={{
          position: 'absolute',
          left: (x / 1000) * width,
          top: y + shift,
          width: (w / 1000) * width,
          height: h,
          borderRadius: square ? 0 : r,
          backgroundColor: kind === 's' ? panel : fill,
          borderWidth: kind === 's' ? StyleSheet.hairlineWidth : 0,
          borderColor: panel,
        }} />
      ))}
      <Shine />
    </View>
  );
}
