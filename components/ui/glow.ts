import { Platform, type ViewStyle } from "react-native";
import { isLightTone, LIGHT_INK } from "../../theme/colors";

/*
 * Glows that look the same on iPhone, Android and the website.
 *
 * The old shadowColor / shadowRadius props only draw on iPhone. On Android
 * they do nothing (or, with elevation, a grey drop shadow), so lit lines came
 * out flat or wrapped in a pale band. boxShadow is drawn by both platforms,
 * with the same numbers web uses.
 */

const lineCache = new Map<string, ViewStyle>();

/** A lit line or dot: web's `box-shadow: 0 0 10px c, 0 0 2px c`. */
export function glowLine(color: string, blur = 10): ViewStyle {
  color = toneOf(color);
  const key = `${color}|${blur}`;
  let s = lineCache.get(key);
  if (!s) {
    s = { backgroundColor: color, boxShadow: `0px 0px ${blur}px ${color}, 0px 0px 2px ${color}` };
    lineCache.set(key, s);
  }
  return s;
}

const iconCache = new Map<string, ViewStyle>();

/**
 * A glow that follows an icon's shape: web's `drop-shadow(0 0 Npx c)`.
 * iPhone: a layer shadow on a clear view follows what is drawn inside it.
 * Android: the same drop-shadow filter as web (Android 12 and newer; older
 * phones show the plain icon, never a box).
 */
export function glowIcon(color: string, blur = 8, opacity = 0.7): ViewStyle {
  color = toneOf(color);
  const key = `${color}|${blur}|${opacity}`;
  let s = iconCache.get(key);
  if (!s) {
    s = Platform.OS === "android"
      ? ({ filter: [{ dropShadow: { offsetX: 0, offsetY: 0, standardDeviation: blur / 2, color: withAlpha(color, opacity) } }] } as ViewStyle)
      : { shadowColor: color, shadowOpacity: opacity, shadowRadius: blur, shadowOffset: { width: 0, height: 0 } };
    iconCache.set(key, s);
  }
  return s;
}

/** A soft glow around a box with a solid fill (rings, lit cards). */
export function glowBox(color: string, blur = 14, alpha = 0.35): ViewStyle {
  color = toneOf(color);
  return { boxShadow: `0px 0px ${blur}px ${withAlpha(color, alpha)}` };
}

export function withAlpha(color: string, a: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const short = /^#([0-9a-f]{3})$/i.exec(color);
  if (short) {
    const [r, g, b] = short[1].split("").map((c) => parseInt(c + c, 16));
    return `rgba(${r},${g},${b},${a})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((x) => x.trim());
    return `rgba(${r},${g},${b},${a})`;
  }
  const hsl = /^hsla?\(([^,]+),([^,]+),([^,)]+)/i.exec(color);
  if (hsl) return `hsla(${hsl[1].trim()},${hsl[2].trim()},${hsl[3].trim()},${a})`;
  return color;
}

/**
 * System Light turns white fills into ink on the way through the JSX runtime
 * (libs/jsx/tone.js) but leaves shadows alone, so a white line would glow
 * white on a white page. Web lights the line in ink there; do the same.
 */
function toneOf(color: string): string {
  if (!isLightTone()) return color;
  const c = color.replace(/\s/g, "").toLowerCase();
  return c === "#fff" || c === "#ffffff" || c === "white" || c === "rgb(255,255,255)" ? LIGHT_INK : color;
}
