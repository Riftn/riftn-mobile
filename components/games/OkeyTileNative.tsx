/**
 * One Okey tile: cream face, coloured number and dot. "OK" marks the wild
 * tile, a star is a false joker. Web twin: riftn-web OkeyTile.tsx.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isOkeyTile, tileFace } from '../../services/games.service';

/** Red, yellow, blue, black. */
export const OKEY_COLORS = ['hsla(0, 65%, 51%, 1)', 'hsla(42, 100%, 43%, 1)', 'hsla(215, 75%, 45%, 1)', 'hsla(240, 4%, 11%, 1)'];
const COLOR_NAMES = ['Red', 'Yellow', 'Blue', 'Black'];

const SIZES = {
  xs: { w: 22, h: 30, font: 12 },
  sm: { w: 30, h: 42, font: 16 },
  md: { w: 34, h: 48, font: 19 },
} as const;

export default function OkeyTileNative({
  tile,
  indicator,
  size = 'md',
  selected,
  onPress,
  disabled,
}: {
  tile: number | null;
  indicator?: number;
  size?: keyof typeof SIZES;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const d = SIZES[size];
  if (tile === null) {
    return <View style={[styles.empty, { width: d.w, height: d.h }]} />;
  }
  const face = tileFace(tile);
  const wild = indicator !== undefined && isOkeyTile(tile, indicator);
  const body = (
    <View style={[styles.tile, { width: d.w, height: d.h }, selected && styles.selected]}>
      {face.falseJoker ? (
        <Text allowFontScaling={false} style={[styles.num, { fontSize: d.font * 0.85, color: OKEY_COLORS[3], marginTop: 4 }]}>{'★'}</Text>
      ) : (
        <>
          <Text allowFontScaling={false} style={[styles.num, { fontSize: d.font, color: OKEY_COLORS[face.c] }]}>{face.n}</Text>
          <View style={{ width: d.font * 0.35, height: d.font * 0.35, borderRadius: d.font, backgroundColor: OKEY_COLORS[face.c], marginTop: 1 }} />
        </>
      )}
      {wild ? (
        <View style={styles.badge}>
          <Text allowFontScaling={false} style={styles.badgeText}>OK</Text>
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={face.falseJoker ? 'False joker' : `${COLOR_NAMES[face.c]} ${face.n}`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: { borderRadius: 5, backgroundColor: 'hsla(155, 60%, 15%, 0.6)', borderWidth: 1, borderColor: 'hsla(0, 0%, 100%, 0.1)' },
  tile: {
    borderRadius: 5,
    alignItems: 'center',
    paddingTop: 2,
    backgroundColor: 'hsla(40, 100%, 96%, 1)',
    borderBottomWidth: 2,
    borderBottomColor: 'hsla(42, 22%, 66%, 1)',
    shadowColor: 'hsla(0, 0%, 0%, 1)',
    shadowOpacity: 0.35,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  selected: { transform: [{ translateY: -7 }], borderWidth: 2, borderColor: 'hsla(43, 96%, 56%, 1)' },
  num: { fontWeight: '800', includeFontPadding: false },
  badge: { position: 'absolute', top: -5, right: -5, borderRadius: 8, paddingHorizontal: 3, backgroundColor: 'hsla(43, 96%, 56%, 1)' },
  badgeText: { fontSize: 8, fontWeight: '900', color: 'hsla(0, 0%, 0%, 1)' },
});
