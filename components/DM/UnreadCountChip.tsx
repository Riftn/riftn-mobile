import React, { memo, useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing, Extrapolation, interpolate, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useAppTheme } from '../../context/ThemeContext';
import { useAppPrefs } from '../../hooks/useAppPrefs';

const RING_MS = 1500;

function SideLine({ progress, side, echo, color }: { progress: SharedValue<number>; side: number; echo: number; color: string }) {
  const style = useAnimatedStyle(() => {
    const p = (progress.value * RING_MS - echo * 140) / 1000;
    return {
      opacity: p <= 0 ? 0 : interpolate(p, [0, .15, 1], [0, .8, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(p, [0, 1], [0, side === 0 ? -7 : 7], Extrapolation.CLAMP) },
        { scaleY: interpolate(p, [0, 1], [.9, 1.15], Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[{
      position: 'absolute', top: 2, bottom: 2, width: 1.3, borderRadius: 1, backgroundColor: color,
    }, side === 0 ? { left: -4 } : { right: -4 }, style]} />
  );
}

/**
 * Unread number on a chat. Squared off like the rest of the app, and it rings
 * once like the Messages icon (red flash, red rim, lines off both sides) when
 * it shows up and each time the number goes up.
 */
export default memo(function UnreadCountChip({ count }: { count: number }) {
  const { isLight } = useAppTheme();
  const { messagesPills: pills } = useAppPrefs();
  const reduced = useReducedMotion();
  const progress = useSharedValue(1);
  const last = useRef(0);
  useEffect(() => {
    if (count > last.current && !reduced) {
      progress.value = 0;
      progress.value = withTiming(1, { duration: RING_MS, easing: Easing.linear, reduceMotion: ReduceMotion.System });
    }
    last.current = count;
  }, [count, reduced, progress]);
  const red = isLight ? '#dc3545' : '#ff6874';
  const wiggle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.value, [0, .1, .24, .38, .52, .62, 1], [0, 14, -10, 6, -3, 0, 0], Extrapolation.CLAMP)}deg` }],
  }));
  const hot = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, .1, .62, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
  }));
  const rim = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, .1, .6, 1], [0, .4, .3, 0], Extrapolation.CLAMP),
  }));
  if (!(count > 0)) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <Animated.View style={[{ overflow: 'visible' }, wiggle]}>
      <Animated.View pointerEvents="none" style={[{
        position: 'absolute', left: -2, right: -2, top: -2, bottom: -2, borderRadius: 8, backgroundColor: red,
      }, rim]} />
      <View className="bg-white rounded-[6px] min-w-[18px] h-[18px] items-center justify-center px-1" style={pills ? { borderRadius: 9, minWidth: 20, height: 20 } : undefined}>
        <Text className="text-[10px] text-black font-bold">{label}</Text>
      </View>
      <Animated.View pointerEvents="none" style={[{
        position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 6, backgroundColor: red,
        alignItems: 'center', justifyContent: 'center',
      }, hot]}>
        <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff' }}>{label}</Text>
      </Animated.View>
      {[0, 1, 2, 3].map(i => <SideLine key={i} progress={progress} side={i % 2} echo={i > 1 ? 1 : 0} color={red} />)}
    </Animated.View>
  );
});
