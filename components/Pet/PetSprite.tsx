/**
 * The stream pet itself, the app side of web's PetSprite: a round little
 * creature drawn in SVG. It grows a feature with each stage (ears, a tail, a
 * tuft, a halo), bobs when happy, sways when hungry, breathes slowly with
 * closed eyes and floating z's when asleep, and wobbles while still an egg.
 * A bump of `chomp` plays one happy hop (a viewer's snack).
 *
 * The colour is the one the creator picked, the same in every theme.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Stop } from "react-native-svg";
import { PET_PALETTE, type PetColor, type PetMood, type PetStage } from "../../services/stream-pet.service";

const SCALE: Record<PetStage, number> = { egg: 1, baby: 0.62, kid: 0.74, teen: 0.86, grown: 0.95, legend: 1 };
const INK = "#2a2340";

interface Props {
  color: PetColor;
  stage: PetStage;
  mood: PetMood;
  size?: number;
  chomp?: number;
}

function useLoop(duration: number, run: boolean) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!run) return;
    v.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration, run]);
  return v;
}

export default function PetSprite({ color, stage, mood, size = 96, chomp = 0 }: Props) {
  const p = PET_PALETTE[color] ?? PET_PALETTE.violet;
  const egg = stage === "egg" || mood === "egg";
  const loop = useLoop(egg ? 2800 : mood === "asleep" ? 4200 : mood === "hungry" ? 3200 : 2400, true);
  const z = useLoop(3000, mood === "asleep" && !egg);
  const hop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!chomp) return;
    hop.setValue(0);
    Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(hop, { toValue: 0, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
  }, [chomp, hop]);

  const hopY = hop.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.14] });
  let motion: any[];
  if (egg) motion = [{ rotate: loop.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["-4deg", "0deg", "4deg"] }) }];
  else if (mood === "asleep") motion = [{ scaleY: loop.interpolate({ inputRange: [0, 1], outputRange: [1, 0.95] }) }, { scaleX: loop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }];
  else if (mood === "hungry") motion = [{ rotate: loop.interpolate({ inputRange: [0, 1], outputRange: ["-3deg", "3deg"] }) }];
  else motion = [{ translateY: loop.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.05] }) }];

  const s = SCALE[stage];
  const idx = ["egg", "baby", "kid", "teen", "grown", "legend"].indexOf(stage);
  const gid = `pet-${color}-${stage}`;

  return (
    <View style={{ width: size, height: size }} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute" }}>
        <Ellipse cx="50" cy="93" rx={egg ? 22 : 26 * s} ry="4" fill="rgba(0,0,0,0.22)" />
      </Svg>
      <Animated.View style={{ width: size, height: size, transform: [{ translateY: size / 2 }, ...motion, { translateY: hopY }, { translateY: -size / 2 }] }}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <RadialGradient id={`${gid}-g`} cx="40%" cy="30%" r="80%">
              <Stop offset="0%" stopColor={egg ? "#ffffff" : p.belly} />
              <Stop offset={egg ? "55%" : "45%"} stopColor={egg ? p.belly : p.body} />
              <Stop offset="100%" stopColor={egg ? p.body : p.shade} />
            </RadialGradient>
          </Defs>
          {egg ? (
            <G>
              <Path d="M50 14 C70 14 80 44 80 62 C80 80 67 90 50 90 C33 90 20 80 20 62 C20 44 30 14 50 14 Z" fill={`url(#${gid}-g)`} stroke={p.shade} strokeWidth="2" />
              <Circle cx="38" cy="52" r="5" fill={p.body} opacity={0.7} />
              <Circle cx="60" cy="40" r="3.5" fill={p.body} opacity={0.7} />
              <Circle cx="62" cy="70" r="6" fill={p.body} opacity={0.6} />
              <Path d="M34 62 l6 -5 l5 5 l6 -6 l5 5 l6 -5 l5 5" fill="none" stroke={p.shade} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
            </G>
          ) : (
            <G transform={`translate(50 92) scale(${s}) translate(-50 -92)`}>
              {idx >= 5 ? <Ellipse cx="50" cy="8" rx="17" ry="4.5" fill="none" stroke="#ffe08a" strokeWidth="3" /> : null}
              {idx >= 3 ? <Path d="M78 74 C94 72 96 56 86 52 C80 50 78 58 84 60" fill="none" stroke={p.shade} strokeWidth="7" strokeLinecap="round" /> : null}
              {idx >= 2 ? (
                <G>
                  <Path d="M26 40 L22 12 L44 28 Z" fill={p.body} stroke={p.shade} strokeWidth="2" strokeLinejoin="round" />
                  <Path d="M74 40 L78 12 L56 28 Z" fill={p.body} stroke={p.shade} strokeWidth="2" strokeLinejoin="round" />
                  <Path d="M28 34 L26 20 L37 29 Z" fill={p.belly} opacity={0.8} />
                  <Path d="M72 34 L74 20 L63 29 Z" fill={p.belly} opacity={0.8} />
                </G>
              ) : null}
              {idx >= 4 ? (
                <Path d="M50 22 C46 12 40 10 38 14 M50 22 C50 10 54 6 56 8 M50 22 C56 14 62 14 63 18" fill="none" stroke={p.shade} strokeWidth="3.5" strokeLinecap="round" />
              ) : null}
              <Ellipse cx="38" cy="90" rx="9" ry="5" fill={p.shade} />
              <Ellipse cx="62" cy="90" rx="9" ry="5" fill={p.shade} />
              <Path d="M50 20 C76 20 86 44 86 62 C86 80 72 90 50 90 C28 90 14 80 14 62 C14 44 24 20 50 20 Z" fill={`url(#${gid}-g)`} stroke={p.shade} strokeWidth="2" />
              <Ellipse cx="50" cy="70" rx="22" ry="15" fill={p.belly} opacity={0.85} />
              <Ellipse cx="29" cy="62" rx="6" ry="3.5" fill="#ff7aa8" opacity={mood === "asleep" ? 0.25 : 0.45} />
              <Ellipse cx="71" cy="62" rx="6" ry="3.5" fill="#ff7aa8" opacity={mood === "asleep" ? 0.25 : 0.45} />
              {mood === "asleep" ? (
                <G fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round">
                  <Path d="M33 52 q5 4 10 0" />
                  <Path d="M57 52 q5 4 10 0" />
                  <Path d="M47 64 q3 2 6 0" />
                </G>
              ) : mood === "hungry" ? (
                <G>
                  <Ellipse cx="38" cy="52" rx="4.5" ry="5" fill={INK} />
                  <Ellipse cx="62" cy="52" rx="4.5" ry="5" fill={INK} />
                  <Circle cx="39.5" cy="50.5" r="1.4" fill="#fff" />
                  <Circle cx="63.5" cy="50.5" r="1.4" fill="#fff" />
                  <Path d="M32 44 l9 -3" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
                  <Path d="M68 44 l-9 -3" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
                  <Ellipse cx="50" cy="66" rx="3.5" ry="4" fill={INK} />
                </G>
              ) : (
                <G>
                  <Ellipse cx="38" cy="52" rx="5" ry="6" fill={INK} />
                  <Ellipse cx="62" cy="52" rx="5" ry="6" fill={INK} />
                  <Circle cx="40" cy="49.5" r="1.8" fill="#fff" />
                  <Circle cx="64" cy="49.5" r="1.8" fill="#fff" />
                  <Path d="M43 63 q7 7 14 0" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
                </G>
              )}
            </G>
          )}
        </Svg>
      </Animated.View>
      {mood === "asleep" && !egg ? (
        <Animated.Text
          style={{
            position: "absolute",
            left: size * 0.74,
            top: size * 0.1,
            color: "#ffffff",
            fontWeight: "700",
            fontSize: Math.max(9, size * 0.12),
            opacity: z.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0.9, 0] }),
            transform: [
              { translateX: z.interpolate({ inputRange: [0, 1], outputRange: [0, size * 0.06] }) },
              { translateY: z.interpolate({ inputRange: [0, 1], outputRange: [size * 0.04, -size * 0.1] }) },
            ],
          }}
        >
          z
        </Animated.Text>
      ) : null}
    </View>
  );
}
