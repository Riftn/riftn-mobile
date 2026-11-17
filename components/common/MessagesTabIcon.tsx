import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import Animated, {
  cancelAnimation, Easing, Extrapolation, interpolate, ReduceMotion,
  useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import Icon from '../ui/Icon';
import {
  ENVELOPE_BODY_PATH, ENVELOPE_SIDE_RIPPLE_PATHS, MESSAGE_SLIP_TAIL, messagesEnvelopeMotion, type MessageSlip, type WormFrame,
} from '../../libs/messages-envelope-motion';

// Phase of the cycle by which the swing, the glow, the side lines and the last
// wriggling slip (and its tail) are all back at rest.
const RING_END = 0.92;
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

type SlipTrack = { ts: number[]; xs: number[]; ys: number[]; rs: number[]; sxs: number[]; sys: number[]; ops: number[] };

function slipTrack(frames: WormFrame[], u: number): SlipTrack {
  return {
    ts: frames.map(f => f.t), xs: frames.map(f => f.x * u), ys: frames.map(f => f.y * u),
    rs: frames.map(f => f.rotate), sxs: frames.map(f => f.sx), sys: frames.map(f => f.sy),
    ops: frames.map(f => f.opacity),
  };
}

// One slip popping out of the envelope's top edge like a little worm, or one
// dot of its body when `dot` is set. Units are the icon's 32-unit viewBox,
// measured from the envelope's centre.
function Slip({ phase, slip, track, u, cycleMs, color, dot }: {
  phase: SharedValue<number>; slip: MessageSlip; track: SlipTrack; u: number; cycleMs: number; color: string;
  dot?: { radius: number; opacity: number };
}) {
  const style = useAnimatedStyle(() => {
    const t = (phase.value * cycleMs - slip.delayMs) / slip.lifeMs;
    if (t <= 0 || t >= 1) return { opacity: 0 };
    // Hidden while inside the envelope's box (4..28 across, 5.2..27 down):
    // it shows as it pops out of the top edge, and again beside or below it.
    const x = 16 + interpolate(t, track.ts, track.xs, Extrapolation.CLAMP) / u;
    const y = 16 + interpolate(t, track.ts, track.ys, Extrapolation.CLAMP) / u;
    const half = dot ? dot.radius : 2.8;
    let out = 1;
    if (x > 4 - half && x < 28 + half && y + half > 5.2 && y - half < 27) {
      out = Math.min(1, Math.max(0, (5.2 - (y - half)) / (2 * half)));
    }
    return {
      opacity: interpolate(t, track.ts, track.ops, Extrapolation.CLAMP) * (dot?.opacity ?? 1) * out,
      transform: [
        { translateX: interpolate(t, track.ts, track.xs, Extrapolation.CLAMP) },
        { translateY: interpolate(t, track.ts, track.ys, Extrapolation.CLAMP) },
        { rotate: `${interpolate(t, track.ts, track.rs, Extrapolation.CLAMP)}deg` },
        { scaleX: interpolate(t, track.ts, track.sxs, Extrapolation.CLAMP) },
        { scaleY: interpolate(t, track.ts, track.sys, Extrapolation.CLAMP) },
      ],
    };
  });
  if (dot) {
    return (
      <Animated.View style={[{
        position: 'absolute', left: (16 - dot.radius) * u, top: (16 - dot.radius) * u,
        width: 2 * dot.radius * u, height: 2 * dot.radius * u, borderRadius: dot.radius * u, backgroundColor: color, opacity: 0,
      }, style]} />
    );
  }
  return (
    <Animated.View style={[{
      position: 'absolute', left: 12.2 * u, top: 13.2 * u,
      width: 7.6 * u, height: 5.6 * u, borderRadius: u, backgroundColor: color, opacity: 0,
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
 * one red slip per unread message (up to 20) pops out of its top edge like a
 * little worm, flies up and out to its own side, then tumbles back down. More
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
  const profile = useMemo(() => messagesEnvelopeMotion(unread), [unread]);
  const tracks = useMemo(() => profile.slips.map(slip => ({
    head: slipTrack(slip.frames, u),
    body: slip.tail.map(frames => slipTrack(frames, u)),
  })), [profile, u]);
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
        {ringing && !rested && (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, overflow: 'visible' }}>
            {profile.slips.map((slip, index) => (
              <React.Fragment key={`${profile.slips.length}-${index}`}>
                {tracks[index].body.map((track, k) => (
                  <Slip key={k} phase={phase} slip={slip} track={track} u={u} cycleMs={profile.cycleMs}
                    color={letterColor} dot={MESSAGE_SLIP_TAIL[k]} />
                ))}
                <Slip phase={phase} slip={slip} track={tracks[index].head} u={u} cycleMs={profile.cycleMs} color={letterColor} />
              </React.Fragment>
            ))}
          </View>
        )}
        {ringing && rested && (
          <View pointerEvents="none" style={{
            position: 'absolute', left: 0, top: -14 * u, width: size, height: 19.2 * u, overflow: 'hidden',
          }}>
            <View style={{
              position: 'absolute', left: 9.2 * u, top: 12.4 * u,
              width: 13.6 * u, height: 12 * u, borderRadius: 1.8 * u, backgroundColor: letterColor,
            }}>
              <View style={{
                position: 'absolute', left: 2.2 * u, top: 2.2 * u, width: 9.2 * u, height: 1.3 * u,
                borderRadius: .65 * u, backgroundColor: 'rgba(255, 255, 255, 0.7)',
              }} />
            </View>
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
