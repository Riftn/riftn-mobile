/**
 * Channel points' own mark: a coin edge with a raised centre. The same
 * drawing as web's PointsIcon, in whatever colour the caller passes.
 */
import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

export function PointsIcon({ size = 16, color = "#fff", strokeWidth = 1.8 }: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={12} cy={12} r={9} />
      <Circle cx={12} cy={12} r={4.25} />
      <Path d="M12 3v2.2M12 18.8V21" />
    </Svg>
  );
}

export default PointsIcon;
