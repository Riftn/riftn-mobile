import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useReducedMotion } from 'react-native-reanimated';
import { useAppTheme } from '../../context/ThemeContext';

/** One pass of the light band across the page. */
export const SHINE_MS = 1300;

/**
 * A soft band of light that crosses a page of placeholder shapes. One view
 * moved on the native thread; it stops with the placeholder it sits on.
 */
export default function Shine() {
  const { width } = useWindowDimensions();
  const { isLight } = useAppTheme();
  const reducedMotion = useReducedMotion();
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: SHINE_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reducedMotion, x]);
  if (reducedMotion) return null;
  const band = isLight ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.07)';
  return (
    <Animated.View pointerEvents="none" accessible={false}
      style={[StyleSheet.absoluteFill, { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-width, width] }) }] }]}>
      <LinearGradient colors={['rgba(255,255,255,0)', band, 'rgba(255,255,255,0)']} locations={[0.3, 0.5, 0.7]}
        start={{ x: 0, y: 0.42 }} end={{ x: 1, y: 0.58 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}
