import React, { memo, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, Extrapolation, interpolate, ReduceMotion,
  useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import Icon from '../ui/Icon';
import {
  ENVELOPE_BODY_PATH, ENVELOPE_FLAP_PATH, ENVELOPE_SIDE_RIPPLE_PATHS, messagesEnvelopeMotion, type MessageSlip,
} from '../../libs/messages-envelope-motion';

// Phase of the cycle by which the swing, the glow, the side lines and the last
// slip (latest launch near 0.37, flight 0.34) are all back at rest.
const RING_END = 0.75;
// Rings per wake-up (first show, app back in front, a new message), then it
// rests with one slip peeking out so the tab still says something is unread.
const MAX_RINGS = 3;

type Profile = ReturnType<typeof messagesEnvelopeMotion>;

function SideRipple({ phase, side, echo, size, profile, color }: {
  phase: SharedValue<number>; side: number; echo: number; size: number; profile: Profile; color: string;
}) {
  const style = useAnimatedStyle(() => {
    const progress = phase.value - (echo * 325 + side * 104) / profile.cycleMs;
    const reach = profile.reach * size / 32 * (side === 0 ? -1 : 1);
    return {
      opacity: progress <= 0 ? 0 : interpolate(progress, [0, .08, .4, 1], [0, profile.opacity, 0, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(progress, [0, .4], [0, reach], Extrapolation.CLAMP) },
        { scaleY: interpolate(progress, [0, .4], [.94, 1.12], Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', width: size, height: size, left: 0, top: 0 }, style]}>
      <Svg width={size} height={size} viewBox="0 0 32 32">
        <Path d={ENVELOPE_SIDE_RIPPLE_PATHS[side]} fill="none" stroke={color} strokeWidth={1.1} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

// Slips sit behind the envelope inside a window that ends at its top edge, so
// each one appears as it clears the top. Units are the icon's 32-unit viewBox.
const WINDOW_LEFT = -14;
const WINDOW_TOP = -36;

function Slip({ phase, slip, u, cycleMs, color }: {
  phase: SharedValue<number>; slip: MessageSlip; u: number; cycleMs: number; color: string;
}) {
  const style = useAnimatedStyle(() => {
    const progress = phase.value - slip.delayMs / cycleMs;
    return {
      opacity: progress <= 0 ? 0 : interpolate(progress, [0, .03, .22, .34], [0, 1, 1, 0], Extrapolation.CLAMP),
      transform: [
        { translateX: interpolate(progress, [0, .34], [0, slip.dx * u], Extrapolation.CLAMP) },
        { translateY: interpolate(progress, [0, .34], [7 * u, slip.dy * u], Extrapolation.CLAMP) },
        { rotate: `${interpolate(progress, [0, .34], [0, slip.rotate], Extrapolation.CLAMP)}deg` },
        { scale: interpolate(progress, [0, .34], [.7, 1], Extrapolation.CLAMP) },
      ],
    };
  });
  return (
    <Animated.View style={[{
      position: 'absolute', left: (12.2 - WINDOW_LEFT) * u, top: (1.5 - WINDOW_TOP) * u,
      width: 7.6 * u, height: 5.6 * u, borderRadius: u, backgroundColor: color,
    }, style]}>
      <View style={{
        position: 'absolute', left: 1.4 * u, top: 1.5 * u, width: 4.8 * u, height: u,
        borderRadius: .5 * u, backgroundColor: 'rgba(255, 255, 255, 0.8)',
      }} />
    </Animated.View>
  );
}

/**
 * Bottom bar Messages icon. Unread messages ring it on the same beat as the
 * notification bell: it swings, glows red, sends lines off both sides and
 * throws one red slip out of the top per unread message (up to 20). More
 * unread means a harder, faster ring.
 */
export default memo(function MessagesTabIcon({ unread, size, color, letterColor, strokeWidth }: {
  unread: number;
  size: number;
  color: string;
  letterColor: string;
  strokeWidth?: number;
}) {
  const u = size / 32;
  const profile = messagesEnvelopeMotion(unread);
  const reduced = useReducedMotion();
  const phase = useSharedValue(0);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [rested, setRested] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => sub.remove();
  }, []);
  const ringing = profile.unread > 0;
  const ringsLeft = useRef(MAX_RINGS);
  useEffect(() => {
    cancelAnimation(phase);
    phase.value = 0;
    ringsLeft.current = MAX_RINGS;
    if (!ringing || reduced) { setRested(true); return; }
    if (!foreground) return;
    setRested(false);
    // Only the ring itself is animated and a timer starts the next one, so
    // nothing asks for frames while the envelope sits still between rings.
    const ring = () => {
      if (ringsLeft.current <= 0) { clearInterval(timer); setRested(true); return; }
      ringsLeft.current -= 1;
      phase.value = 0;
      phase.value = withTiming(RING_END, {
        duration: profile.cycleMs * RING_END, easing: Easing.linear, reduceMotion: ReduceMotion.System,
      });
    };
    const timer = setInterval(ring, profile.cycleMs);
    ring();
    return () => {
      clearInterval(timer);
      cancelAnimation(phase);
    };
  }, [ringing, foreground, profile.unread, profile.cycleMs, reduced, phase]);
  const swing = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(phase.value,
      [0, .05, .12, .18, .25, .31, .42, 1],
      [0, profile.swing, -.77 * profile.swing, .54 * profile.swing, -.31 * profile.swing, .15 * profile.swing, 0, 0],
      Extrapolation.CLAMP)}deg` }],
  }));
  const rim = useAnimatedStyle(() => ({
    opacity: interpolate(phase.value, [0, .05, .26, .46, 1], [0, .9, .72, 0, 0], Extrapolation.CLAMP),
  }));
  const hot = useAnimatedStyle(() => ({
    opacity: interpolate(phase.value, [0, .05, .28, .48, 1], [0, 1, 1, 0, 0], Extrapolation.CLAMP),
  }));
  return (
    <View style={{ width: size, height: size, overflow: 'visible' }}>
      <Animated.View style={[{ width: size, height: size, transformOrigin: '50% 5%', overflow: 'visible' }, swing]}>
        {ringing && (
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size, transform: [{ scale: 1.05 }] }, rim]}>
            <Svg width={size} height={size} viewBox="0 0 32 32">
              <Path d={ENVELOPE_BODY_PATH} fill={letterColor} fillOpacity={.5} fillRule="evenodd"
                stroke={letterColor} strokeOpacity={.28} strokeWidth={2.6} strokeLinejoin="round" />
            </Svg>
          </Animated.View>
        )}
        {ringing && (
          <View pointerEvents="none" style={{
            position: 'absolute', left: WINDOW_LEFT * u, top: WINDOW_TOP * u, width: 60 * u, height: 41.2 * u, overflow: 'hidden',
          }}>
            {!rested && profile.slips.map((slip, index) => (
              <Slip key={`${profile.slips.length}-${index}`} phase={phase} slip={slip} u={u} cycleMs={profile.cycleMs} color={letterColor} />
            ))}
            {rested && (
              <View style={{
                position: 'absolute', left: (9.2 - WINDOW_LEFT) * u, top: (-1.6 - WINDOW_TOP) * u,
                width: 13.6 * u, height: 12 * u, borderRadius: 1.8 * u, backgroundColor: letterColor,
              }}>
                <View style={{
                  position: 'absolute', left: 2.2 * u, top: 2.2 * u, width: 9.2 * u, height: 1.3 * u,
                  borderRadius: .65 * u, backgroundColor: 'rgba(255, 255, 255, 0.7)',
                }} />
              </View>
            )}
          </View>
        )}
        <Icon name="MessageEnvelope" size={size} color={color} strokeWidth={strokeWidth} />
        {ringing && (
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, hot]}>
            <Icon name="MessageEnvelope" size={size} color={letterColor} strokeWidth={strokeWidth} />
          </Animated.View>
        )}
        {ringing && ENVELOPE_SIDE_RIPPLE_PATHS.map((_, side) => [0, 1].map(echo => (
          <SideRipple key={`${side}-${echo}`} phase={phase} side={side} echo={echo} size={size} profile={profile} color={letterColor} />
        )))}
      </Animated.View>
    </View>
  );
});
