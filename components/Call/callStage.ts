import type { AppThemeName } from "../../theme/colors";
import type { Rgb } from "../../theme/themeColor";

/**
 * The call stage's own colours. The stage sits over a blurred copy of the
 * other person's picture, so it cannot use the page palette: text has to hold
 * over any photo. Each theme tints the stage and names the colour its ringing
 * effect is drawn in (CallRings).
 *
 * No green accept and no red hang-up: `fg` on `onFg` is the one strong button.
 */
export interface StagePalette {
  bg: string;
  fg: string;
  onFg: string;
  muted: string;
  glass: string;
  glassStrong: string;
  line: string;
  dock: string;
  tintTop: string;
  ring: string;
  ring2: string;
  light: boolean;
}

const DARK: StagePalette = {
  bg: "#050506",
  fg: "#FFFFFF",
  onFg: "#0A0A0C",
  muted: "rgba(255,255,255,0.62)",
  glass: "rgba(255,255,255,0.09)",
  glassStrong: "rgba(255,255,255,0.16)",
  line: "rgba(255,255,255,0.13)",
  dock: "rgba(22,22,26,0.72)",
  tintTop: "rgba(0,0,0,0.55)",
  ring: "#FFFFFF",
  ring2: "#FFFFFF",
  light: false,
};

const LIGHT: StagePalette = {
  bg: "#FFFFFF",
  fg: "#14141A",
  onFg: "#FFFFFF",
  muted: "rgba(20,20,26,0.62)",
  glass: "rgba(20,20,26,0.05)",
  glassStrong: "rgba(20,20,26,0.10)",
  line: "rgba(20,20,26,0.12)",
  dock: "rgba(255,255,255,0.78)",
  tintTop: "rgba(255,255,255,0.62)",
  ring: "#14141A",
  ring2: "#14141A",
  light: true,
};

const HACKER: StagePalette = {
  bg: "#000000",
  fg: "#39FF88",
  onFg: "#001A0A",
  muted: "rgba(57,255,136,0.62)",
  glass: "rgba(57,255,136,0.07)",
  glassStrong: "rgba(57,255,136,0.14)",
  line: "rgba(57,255,136,0.28)",
  dock: "rgba(0,14,6,0.82)",
  tintTop: "rgba(0,0,0,0.78)",
  ring: "#39FF88",
  ring2: "#39FF88",
  light: false,
};

const TINTS: Partial<Record<AppThemeName, Partial<StagePalette>>> = {
  immersive: { bg: "#000000", tintTop: "rgba(0,0,0,0.42)", dock: "rgba(12,12,14,0.6)" },
  minimal: { bg: "#000000", tintTop: "rgba(0,0,0,0.7)", dock: "rgba(0,0,0,0.8)" },
  glass: { bg: "#06141A", tintTop: "rgba(4,30,38,0.5)", dock: "rgba(10,34,42,0.6)", ring: "#00D5E6" },
  cosmic: { bg: "#03030A", tintTop: "rgba(20,14,48,0.55)", dock: "rgba(14,12,30,0.66)" },
  hazy: { bg: "#0A0514", tintTop: "rgba(46,18,86,0.52)", dock: "rgba(40,20,70,0.6)", ring: "#B877FF", ring2: "#FF96DC" },
  swarms: { bg: "#040A12", tintTop: "rgba(8,30,52,0.55)", dock: "rgba(10,24,40,0.66)", ring: "#3FB6FF" },
  lavalamp: { bg: "#120604", tintTop: "rgba(70,22,8,0.5)", dock: "rgba(44,16,10,0.64)", ring: "#FF6A2B", ring2: "#FF3D9A" },
  winter: { bg: "#07121D", tintTop: "rgba(22,50,76,0.55)", dock: "rgba(14,32,50,0.64)", ring: "#CDECFF" },
  war: { bg: "#0A0C07", tintTop: "rgba(36,42,22,0.6)", dock: "rgba(24,28,16,0.7)", ring: "#C9D46A" },
  osaka: { bg: "#0C0618", tintTop: "rgba(60,14,70,0.5)", dock: "rgba(22,10,44,0.62)" },
  jungle: { bg: "#041008", tintTop: "rgba(12,52,26,0.55)", dock: "rgba(8,30,16,0.66)", ring: "#5ADC78", ring2: "#EAFF7A" },
  island: { bg: "#03121A", tintTop: "rgba(6,66,84,0.5)", dock: "rgba(6,36,46,0.64)", ring: "#5FE3E0", ring2: "#FFE7B0" },
  horror: { bg: "#070203", tintTop: "rgba(46,4,8,0.6)", dock: "rgba(26,6,8,0.7)", ring: "#B3121F" },
};

/** Themes whose ringing effect follows the member's own Theme Color. */
const FOLLOWS_ACCENT: ReadonlySet<AppThemeName> = new Set(["glass", "hazy", "swarms", "lavalamp"]);

export function stagePalette(theme: AppThemeName, accent?: Rgb | null): StagePalette {
  if (theme === "system-light") return LIGHT;
  if (theme === "hacker") return HACKER;
  const palette: StagePalette = { ...DARK, ...(TINTS[theme] ?? {}) };
  if (accent && FOLLOWS_ACCENT.has(theme)) palette.ring = `rgb(${accent[0]},${accent[1]},${accent[2]})`;
  return palette;
}

/** The same colour at another strength, for glows and soft rims. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(color);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;
  const hex = /^#([\da-f]{6})$/i.exec(color);
  if (!hex) return color;
  const n = parseInt(hex[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
