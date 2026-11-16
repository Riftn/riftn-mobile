import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
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

export function screenBonesFor(routeName: string | undefined): ScreenBonesEntry | undefined {
  const entry = routeName ? BONES[routeName] : undefined;
  return Array.isArray(entry) && entry[3] ? entry : undefined;
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
  // Everything sits below the status bar, whose height differs by phone.
  const shift = insets.top - measuredTop;
  const ink = isLight ? '11,11,13' : skin && accent ? accent.join(',') : '255,255,255';
  const fill = `rgba(${ink},${isMinimal ? 0.05 : 0.09})`;
  const panel = `rgba(${ink},0.035)`;
  const square = !!skin?.square || isMinimal;
  return (
    <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
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
