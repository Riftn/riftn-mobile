/**
 * The Moments viewer's own action icons (react, comment, share), drawn to
 * read apart from the feed's: a folded two-tone heart, a bubble with lines,
 * and a folded curved arrow. Same shapes as web's moment-icons.
 */
import React from "react";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

const HEART = "M12 20.5s-8-4.6-8-10.4A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 8 2.5c0 5.8-8 10.4-8 10.4z";

export function MomentHeart({ size = 22, filled, color = "#fff" }: { size?: number; filled?: boolean; color?: string }) {
  if (!filled) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d={HEART} stroke={color} strokeWidth={2} strokeLinejoin="round" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Defs>
        <LinearGradient id="mhA" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#ff5a8a" /><Stop offset="1" stopColor="#ff0a6c" /></LinearGradient>
        <LinearGradient id="mhB" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#ff2d7a" /><Stop offset="1" stopColor="#e0005a" /></LinearGradient>
      </Defs>
      <Path d={HEART} fill="url(#mhA)" />
      <Path d="M12 20.5c-1-2.6-1.4-6.8 0-12.9A4.4 4.4 0 0 1 20 10.1c0 5.8-8 10.4-8 10.4z" fill="url(#mhB)" opacity={0.85} />
    </Svg>
  );
}

export function MomentComment({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M7.5 4h9A3.5 3.5 0 0 1 20 7.5v6a3.5 3.5 0 0 1-3.5 3.5H10l-5 3.5V7.5A3.5 3.5 0 0 1 7.5 4z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Path d="M9 9.5h6M9 12.5h4" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function MomentShare({ size = 22, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3.5 19.5c1.2-5.6 5.2-9.3 10.5-9.6V5.5l7 6.5-7 6.5v-4.4c-4.2-.1-7.6 1.6-10.5 5.4z" fill={color} />
      <Path d="M14 5.5l7 6.5h-7z" fill={color} opacity={0.55} />
    </Svg>
  );
}

/** "Share to Moment": a shelf tile (rounded square, like the Moment faces) with a plus. Same shape as web. */
export function MomentAdd({ size = 20, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M14 3.5H8A4.5 4.5 0 0 0 3.5 8v8A4.5 4.5 0 0 0 8 20.5h8a4.5 4.5 0 0 0 4.5-4.5v-6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M18.5 2.5v6M15.5 5.5h6" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M9.5 9.5l5 2.5-5 2.5z" fill={color} />
    </Svg>
  );
}
