/**
 * SuperPowersOrbit
 * ================
 * The twelve powers on a ring around the badge that unlocks them. Native twin
 * of web's `SuperPowersOrbit`.
 *
 * Powers sit in unlock order clockwise from twelve o'clock, so the lit chrome
 * arc runs from the top to the last power this account holds; everything past
 * it is dimmed. Tapping a node only selects it. The panel under the ring is
 * where a power is spent, so a stray tap on a small circle never books anything.
 *
 * Node labels are left off: at phone width twelve of them collide, and the
 * selected power's name is printed in the panel underneath.
 */
import React, { type ReactNode } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import SuperPowerIcon from "../common/SuperPowerIcon";
import type { SuperPowerInfo } from "../../services/superpower.service";

/** Ring radius as a share of the box. */
const RADIUS = 0.4;

function pointAt(index: number, count: number, size: number) {
  const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
  return {
    x: size / 2 + size * RADIUS * Math.cos(angle),
    y: size / 2 + size * RADIUS * Math.sin(angle),
  };
}

export interface OrbitPower {
  power: SuperPowerInfo;
  unlocked: boolean;
}

interface Props {
  size: number;
  powers: OrbitPower[];
  selectedKey: string | null;
  onSelect: (power: SuperPowerInfo) => void;
  /** The badge and its allowance, in the middle of the ring. */
  core: ReactNode;
}

export default function SuperPowersOrbit({ size, powers, selectedKey, onSelect, core }: Props) {
  const count = powers.length;
  let lit = 0;
  while (lit < count && powers[lit].unlocked) lit += 1;

  const r = size * RADIUS;
  const start = pointAt(0, count, size);
  const end = pointAt(Math.max(lit - 1, 0), count, size);
  const sweep = count ? ((lit - 1) / count) * 360 : 0;
  const node = Math.round(size * 0.135);
  const nodeSelected = Math.round(size * 0.165);

  return (
    <View style={{ width: size, height: size, alignSelf: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="spOrbitChrome" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#ffffff" />
            <Stop offset="0.5" stopColor="#8a9097" />
            <Stop offset="1" stopColor="#ffffff" />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={1.5} />
        {lit > 1 ? (
          <Path
            d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${end.x} ${end.y}`}
            fill="none"
            stroke="url(#spOrbitChrome)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ) : null}
      </Svg>

      <View
        pointerEvents="none"
        style={[styles.core, { left: size * 0.24, top: size * 0.24, width: size * 0.52, height: size * 0.52 }]}
      >
        {core}
      </View>

      {powers.map(({ power, unlocked }, index) => {
        const { x, y } = pointAt(index, count, size);
        const selected = power.key === selectedKey;
        const d = selected ? nodeSelected : node;
        return (
          <Pressable
            key={power.key}
            onPress={() => onSelect(power)}
            accessibilityRole="button"
            accessibilityLabel={power.label}
            accessibilityState={{ selected }}
            hitSlop={4}
            style={[
              styles.node,
              { left: x - d / 2, top: y - d / 2, width: d, height: d, borderRadius: d / 2 },
              selected ? styles.nodeSelected : unlocked ? styles.nodeOn : styles.nodeOff,
            ]}
          >
            <SuperPowerIcon
              power={power.key}
              style={{ width: d * 0.64, height: d * 0.64, opacity: unlocked ? 1 : 0.25 }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  core: { position: "absolute", alignItems: "center", justifyContent: "center" },
  node: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0b0b0d",
    borderWidth: 1,
  },
  nodeOn: { borderColor: "rgba(255,255,255,0.16)" },
  nodeOff: { borderColor: "rgba(255,255,255,0.05)" },
  nodeSelected: {
    borderColor: "#ffffff",
    borderWidth: 1.5,
    boxShadow: "0px 0px 14px rgba(255,255,255,0.35)",
  },
});
