import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * The level bar shown while the speaker is held and dragged: full at the top,
 * silent at the bottom. Purely visual; the speaker button owns the gesture
 * (see libs/feed-volume-responder). Callers place it with `style`.
 */
export default function VolumeLevelTrack({ level, style }: { level: number; style?: StyleProp<ViewStyle> }) {
  const percent = Math.round(Math.max(0, Math.min(1, level)) * 100);
  return (
    <View style={[styles.track, style]} pointerEvents="none">
      <View style={styles.inner}>
        <View style={[styles.fill, { height: `${percent}%` }]} />
      </View>
    </View>
  );
}

export const VOLUME_TRACK_WIDTH = 32;
export const VOLUME_TRACK_HEIGHT = 104;

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    width: VOLUME_TRACK_WIDTH,
    height: VOLUME_TRACK_HEIGHT,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'hsla(0, 0%, 100%, 0.12)',
    backgroundColor: 'hsla(0, 0%, 0%, 0.55)',
    zIndex: 40,
  },
  inner: {
    width: 4,
    height: 84,
    borderRadius: 2,
    backgroundColor: 'hsla(0, 0%, 100%, 0.3)',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    backgroundColor: 'hsla(0, 0%, 100%, 1)',
    borderRadius: 2,
  },
});
