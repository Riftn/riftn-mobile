import React, { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet } from 'react-native';

/** A page's opening shell, kept over the page and dissolved away once `fading`. */
export default function ShellCover({ fading, duration, children }: { fading: boolean; duration: number; children: ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!fading) return;
    const anim = Animated.timing(opacity, { toValue: 0, duration, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [fading, duration, opacity]);
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>{children}</Animated.View>;
}
