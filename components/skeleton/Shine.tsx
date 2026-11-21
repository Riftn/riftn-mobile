import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../context/ThemeContext';

/** One pass of the light band across the page. */
export const SHINE_MS = 1300;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled?.().then((on) => { if (alive) setReduced(on); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduced);
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduced;
}

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
    if (isLight || reducedMotion) return;
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: SHINE_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [isLight, reducedMotion, x]);
  if (isLight || reducedMotion) return null;
  return (
    <Animated.View pointerEvents="none" accessible={false}
      style={[StyleSheet.absoluteFill, { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-width, width] }) }] }]}>
      <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.07)', 'rgba(255,255,255,0)']} locations={[0.3, 0.5, 0.7]}
        start={{ x: 0, y: 0.42 }} end={{ x: 1, y: 0.58 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}
