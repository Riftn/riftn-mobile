import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

/**
 * "Distribute" share glyph: a person in a ring with six arrows pointing out.
 * Same artwork as web cut-icons/feeddistribute. Optional look for the post
 * Share button (Settings > Appearance > Share icon).
 */
const CX = 16;
const CY = 16;
const RING = 6.6;

const f = (n: number) => n.toFixed(2);
const SPOKES = [-90, -30, 30, 90, 150, 210].map((deg) => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r0 = RING + 0.6;
  const rb = 11;
  const rt = 14.4;
  const hw = 2;
  const bx = CX + rb * c;
  const by = CY + rb * s;
  return {
    line: `M${f(CX + r0 * c)} ${f(CY + r0 * s)}L${f(bx)} ${f(by)}`,
    head: `M${f(bx - hw * s)} ${f(by + hw * c)}L${f(CX + rt * c)} ${f(CY + rt * s)}L${f(bx + hw * s)} ${f(by - hw * c)}Z`,
  };
});
const BODY = `M${CX - 3.3} ${CY + 3.9}V${CY + 2.6}Q${CX - 3.3} ${CY + 0.9} ${CX - 1.6} ${CY + 0.9}H${CX + 1.6}Q${CX + 3.3} ${CY + 0.9} ${CX + 3.3} ${CY + 2.6}V${CY + 3.9}`;

export function DistributeIcon({ size = 20, color = "#fff", strokeWidth = 2 }: { size?: number; color?: string; strokeWidth?: number }) {
  const common = { fill: "none", stroke: color, strokeWidth: strokeWidth * 0.85, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={CX} cy={CY} r={RING} {...common} />
      <Circle cx={CX} cy={CY - 2.1} r={1.9} {...common} />
      <Path d={BODY} {...common} />
      {SPOKES.map((p, i) => (
        <React.Fragment key={i}>
          <Path d={p.line} {...common} />
          <Path d={p.head} {...common} />
        </React.Fragment>
      ))}
    </Svg>
  );
}
