/**
 * The arrivals other than the Rift (Settings → Appearance → After you sign
 * in): Trace, Tune in, Deck and Glass drop. Same looks and timing as web's
 * src/components/app/login/arrival-concepts.ts, drawn here frame by frame
 * with Skia on the UI thread:
 *
 * - Trace: two comets of light chase round the Riftn mark's outline; on
 *   arrival the mark fills, shrinks away and the picture pops out of it.
 * - Tune in: TV static in the frame with lines rolling up; on arrival it
 *   squeezes to a bright line and snaps open on the picture.
 * - Deck: the sign-in screen's clips gather into a fanned deck and shuffle;
 *   on arrival the deck sweeps away and your card drops in back first (the
 *   Riftn mark) and flips to your picture.
 * - Glass drop: a liquid-glass drop wobbles with two droplets orbiting; on
 *   arrival they are pulled in, it settles into the picture's shape and the
 *   picture develops behind the glass, then a sheen crosses it.
 *
 * Each ends on the picture, 120pt with a 15pt corner, in the middle of its
 * parent: the same place and shape as the Rift's open frame, so the flight
 * home (SignInArrival) carries it the same way.
 */
import React, { useEffect, useMemo } from 'react';
import { Platform, StyleSheet } from 'react-native';
import {
  BlurStyle,
  Canvas,
  ClipOp,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
  createPicture,
  matchFont,
  useImage,
  type SkCanvas,
  type SkFont,
  type SkImage,
  type SkPath,
} from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { LOGIN_CLIPS } from './login-clip-assets';

export const CONCEPT_LOOKS = ['trace', 'tune', 'deck', 'glass'] as const;
export type ConceptLook = (typeof CONCEPT_LOOKS)[number];

/** From the account landing until the picture stands still. */
export const CONCEPT_REVEAL_MS: Record<ConceptLook, number> = { trace: 700, tune: 900, deck: 640, glass: 830 };
/** When the name comes in under the picture, after the account landed. */
export const CONCEPT_NAME_MS: Record<ConceptLook, number> = { trace: 650, tune: 600, deck: 600, glass: 600 };
/** From the account landing until the picture flies home. */
export const CONCEPT_HOLD_MS = 1300;

/** The canvas around the 0×0 middle: room for the deck's sweep and the droplets. */
const HALF = 230;
const SIZE = HALF * 2;

/** The Riftn mark (brand-icon.svg on web). */
const MARK_PATH = 'M868.0 1411.1C865.0 1410.1 850.4 1405.3 835.5 1400.5C805.2 1390.7 783.8 1382.8 771.1 1376.9C717.6 1351.7 677.9 1324.1 639.5 1285.6C609.6 1255.6 590.7 1231.4 568.8 1195.0C551.3 1165.8 533.4 1123.9 523.7 1089.0C515.5 1059.9 511.6 1039.4 508.5 1009.0C507.1 995.1 506.9 967.6 507.2 749.0L507.5 504.5L552.5 504.5C597.0 504.5 597.6 504.5 605.0 506.9C634.6 516.1 654.8 536.7 664.1 567.0L666.4 574.5L667.1 783.0C667.5 910.3 668.2 994.6 668.8 999.5C672.9 1032.5 683.8 1067.8 699.3 1098.5C706.9 1113.5 712.2 1122.1 723.1 1136.9C751.6 1175.7 783.2 1202.4 828.4 1226.0C838.4 1231.2 843.3 1234.6 850.6 1241.2C860.7 1250.5 869.9 1264.7 874.3 1278.0C878.3 1290.1 878.5 1293.7 878.5 1354.0L878.5 1412.5L876.0 1412.7C874.6 1412.9 871.0 1412.1 868.0 1411.1ZM1035.7 1412.3C1035.3 1412.0 1035.0 1385.5 1035.0 1353.6C1035.0 1300.8 1035.2 1294.7 1036.9 1286.4C1040.5 1269.2 1048.7 1254.3 1060.9 1242.7C1068.7 1235.4 1075.0 1231.1 1088.0 1224.2C1136.6 1198.6 1172.6 1165.5 1201.4 1120.1C1225.3 1082.4 1238.4 1044.7 1244.1 997.6C1245.9 982.2 1246.0 972.8 1246.0 780.3C1246.0 585.7 1246.1 578.9 1247.9 571.3C1250.4 561.2 1252.4 555.8 1256.2 549.0C1268.3 527.2 1287.4 512.3 1310.8 506.4C1320.0 504.1 1321.2 504.0 1362.4 504.0C1393.9 504.0 1404.9 504.3 1405.8 505.2C1407.4 506.8 1407.6 962.7 1406.0 988.5C1402.8 1041.2 1392.1 1089.5 1373.0 1137.5C1361.3 1167.0 1335.8 1211.7 1316.3 1237.0C1299.7 1258.6 1293.0 1266.1 1272.6 1286.5C1239.8 1319.1 1206.7 1343.6 1168.0 1363.7C1162.2 1366.8 1155.9 1370.1 1154.0 1371.1C1137.6 1379.8 1121.7 1385.9 1075.6 1401.1C1040.4 1412.7 1037.0 1413.7 1035.7 1412.3ZM883.1 836.6C882.3 835.6 882.0 765.2 882.2 564.9L882.5 294.5L885.5 286.0C892.9 265.5 909.0 250.5 932.5 242.5C944.5 238.4 950.0 238.0 998.1 238.0C1032.9 238.0 1044.9 238.3 1045.8 239.2C1046.7 240.1 1047.0 300.6 1047.0 505.5C1047.0 786.1 1047.1 779.4 1042.6 791.9C1036.3 809.4 1017.8 826.1 997.5 832.8C982.3 837.8 980.0 838.0 930.7 838.0C892.7 838.0 884.0 837.8 883.1 836.6Z';

/** Static: grey grains a little tinted by the theme, a new field every 66ms, 2pt grains. */
const STATIC = Skia.RuntimeEffect.Make(`
uniform float seed;
uniform float3 tint;
half4 main(float2 p) {
  float2 c = floor(p / 2.0);
  float v = fract(sin(dot(c + float2(seed * 7.13, seed * 3.71), float2(12.9898, 78.233))) * 43758.5453);
  float g = v * v * 200.0 / 255.0;
  return half4(g * tint, 1.0);
}`);

// Lazily made Skia objects shared by every arrival (paths, the mark's length).
let mark: { path: SkPath; length: number } | null = null;
export function markPath() {
  if (mark) return mark;
  const path = Skia.Path.MakeFromSVGString(MARK_PATH) ?? Skia.Path.Make();
  // The whole outline's length, as web's getTotalLength() (the dash starts
  // again on each of the mark's three strokes).
  let length = 0;
  const it = Skia.ContourMeasureIter(path, false, 1);
  for (let c = it.next(); c; c = it.next()) length += c.length();
  mark = { path, length: length || 3000 };
  return mark;
}

const DECK_CARDS = [
  LOGIN_CLIPS['1063060687058935045'].poster,
  require('../../assets/login-stack/1093248878319179369.jpg'),
  LOGIN_CLIPS['547609635960318917'].poster,
  LOGIN_CLIPS['701717185720155462'].poster,
];

type Rgb = [number, number, number];
function hexRgb(color: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return [255, 255, 255];
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb;
}

export interface Res {
  look: ConceptLook;
  a: Rgb;
  b: Rgb;
  picture: SkImage | null;
  cards: Array<SkImage | null>;
  font: SkFont;
  initial: string;
  path: SkPath;
  length: number;
}

// ---------- drawing (worklets)
function clamp(x: number, a = 0, b = 1) { 'worklet'; return Math.min(b, Math.max(a, x)); }
function lerp(a: number, b: number, t: number) { 'worklet'; return a + (b - a) * t; }
function prog(t: number, a: number, b: number) { 'worklet'; return clamp((t - a) / (b - a)); }
function eOut(x: number) { 'worklet'; return 1 - Math.pow(1 - x, 3); }
function eIn(x: number) { 'worklet'; return x * x * x; }
function eIO(x: number) { 'worklet'; return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
function eBack(x: number) { 'worklet'; const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }

function color(c: Rgb, alpha: number) {
  'worklet';
  return Float32Array.of(c[0] / 255, c[1] / 255, c[2] / 255, clamp(alpha));
}
function paint(c: Rgb, alpha: number) {
  'worklet';
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(color(c, alpha));
  return p;
}
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** A soft shadow under a rounded box. */
function shadow(canvas: SkCanvas, x: number, y: number, w: number, h: number, r: number, dy: number, blur: number, alpha: number) {
  'worklet';
  if (alpha <= 0.002) return;
  const p = paint(BLACK, alpha);
  p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, blur / 2, true));
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y + dy, w, h), r, r), p);
}

/** The picture (cover), or its initial on the dark frame when there is none. */
function photo(canvas: SkCanvas, res: Res, x: number, y: number, s: number, r: number, alpha: number) {
  'worklet';
  if (alpha <= 0.002) return;
  canvas.save();
  canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(x, y, s, s), r, r), ClipOp.Intersect, true);
  const bg = paint([22, 24, 29], alpha);
  canvas.drawRect(Skia.XYWHRect(x, y, s, s), bg);
  const img = res.picture;
  if (img) {
    const iw = img.width(), ih = img.height();
    const side = Math.min(iw, ih);
    const p = paint(WHITE, alpha);
    canvas.drawImageRect(img, Skia.XYWHRect((iw - side) / 2, (ih - side) / 2, side, side), Skia.XYWHRect(x, y, s, s), p);
  } else {
    const glow = Skia.Paint();
    glow.setAlphaf(alpha);
    glow.setShader(Skia.Shader.MakeRadialGradient(
      { x: x + s / 2, y: y + s * 0.35 }, s * 0.75,
      [color([Math.round(res.a[0] * 0.45 + 22 * 0.55), Math.round(res.a[1] * 0.45 + 24 * 0.55), Math.round(res.a[2] * 0.45 + 29 * 0.55)], 1), color([22, 24, 29], 1)],
      [0, 1], TileMode.Clamp,
    ));
    canvas.drawRect(Skia.XYWHRect(x, y, s, s), glow);
    const tp = paint(WHITE, 0.85 * alpha);
    const w = res.font.measureText(res.initial).width;
    canvas.save();
    canvas.translate(x + s / 2, y + s / 2);
    canvas.scale(s / 120, s / 120);
    canvas.drawText(res.initial, -w / 2, 19, tp, res.font);
    canvas.restore();
  }
  canvas.restore();
}

function drawTrace(canvas: SkCanvas, res: Res, t: number, a: number) {
  'worklet';
  const ip = prog(t, 0, 300);
  const markAlpha = ip * (1 - prog(a, 350, 650));
  if (markAlpha > 0.002) {
    const sc = lerp(0.92, 1, eOut(ip)) * lerp(1, 0.8, eIn(prog(a, 300, 650)));
    const k = (116 / 1210) * sc;
    canvas.save();
    canvas.scale(k, k);
    canvas.translate(-(351 + 605), -(223 + 605));
    const base = paint(WHITE, 0.22 * markAlpha);
    base.setStyle(PaintStyle.Stroke);
    base.setStrokeWidth(12);
    canvas.drawPath(res.path, base);
    const fillA = prog(a, 0, 220) * 0.95;
    if (fillA > 0) canvas.drawPath(res.path, paint(WHITE, fillA * markAlpha));
    const comet = (1 - prog(a, 0, 250)) * markAlpha;
    if (comet > 0.002) {
      const L = res.length, seg = L * 0.3, off = (t / 1800) * L;
      for (const [c, o] of [[res.a, 0], [res.b, L / 2]] as Array<[Rgb, number]>) {
        for (const glow of [true, false]) {
          const p = paint(c, comet);
          p.setStyle(PaintStyle.Stroke);
          p.setStrokeWidth(22);
          p.setStrokeCap(StrokeCap.Round);
          p.setStrokeJoin(StrokeJoin.Round);
          p.setPathEffect(Skia.PathEffect.MakeDash([seg, L - seg], (((off + o) % L) + L) % L));
          if (glow) p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 14, true));
          canvas.drawPath(res.path, p);
        }
      }
    }
    canvas.restore();
  }
  // the mark becomes the picture
  const bp = prog(a, 330, 700);
  const boxA = eOut(bp);
  if (boxA > 0.002) {
    const s = lerp(0.6, 1, eBack(bp));
    canvas.save();
    canvas.scale(s, s);
    shadow(canvas, -60, -60, 120, 120, 15, 18, 50, 0.6 * boxA);
    photo(canvas, res, -60, -60, 120, 15, boxA);
    canvas.restore();
  }
}

function drawTune(canvas: SkCanvas, res: Res, t: number, a: number) {
  'worklet';
  const ip = prog(t, 0, 280);
  if (ip <= 0) return;
  const sq = prog(a, 0, 200), op = prog(a, 260, 560);
  let sy = 1, sx = 1;
  if (a >= 0 && a < 200) { sy = lerp(1, 0.02, eIn(sq)); sx = lerp(1, 1.12, sq); }
  else if (a >= 200 && a < 260) { sy = 0.02; sx = 1.12; }
  else if (a >= 260) { sy = lerp(0.02, 1, eOut(op)); sx = lerp(1.12, 1, eOut(op)); }
  const s = lerp(0.9, 1, ip);
  canvas.save();
  canvas.scale(sx * s, sy * s);
  // glow + ring + drop shadow
  shadow(canvas, -60, -60, 120, 120, 15, 18, 50, 0.6 * ip);
  const glow = paint(res.a, 0.2 * ip);
  glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 20, true));
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-60, -60, 120, 120), 15, 15), glow);
  const box = Skia.RRectXY(Skia.XYWHRect(-60, -60, 120, 120), 15, 15);
  // brightness(1 + 3sq) while it squeezes
  const bright = a >= 0 && a < 260 ? 1 + 3 * sq : 1;
  const layer = Skia.Paint();
  layer.setAlphaf(ip);
  if (bright !== 1) layer.setColorFilter(Skia.ColorFilter.MakeMatrix([bright, 0, 0, 0, 0, 0, bright, 0, 0, 0, 0, 0, bright, 0, 0, 0, 0, 0, 1, 0]));
  canvas.saveLayer(layer);
  canvas.clipRRect(box, ClipOp.Intersect, true);
  canvas.drawRect(Skia.XYWHRect(-60, -60, 120, 120), paint([11, 12, 14], 1));
  if (a >= 260) photo(canvas, res, -60, -60, 120, 0, 1);
  const staticA = a >= 260 ? 1 - prog(a, 260, 420) : 1;
  if (STATIC && staticA > 0) {
    const sp = Skia.Paint();
    sp.setAlphaf(staticA);
    const tint = [0.75 + (0.25 * res.a[0]) / 255, 0.75 + (0.25 * res.a[1]) / 255, 0.75 + (0.25 * res.a[2]) / 255];
    sp.setShader(STATIC.makeShader([Math.floor(t / 66) % 997, tint[0], tint[1], tint[2]]));
    canvas.drawRect(Skia.XYWHRect(-60, -60, 120, 120), sp);
  }
  // lines rolling up
  const linesA = a >= 260 ? 1 - prog(a, 500, 900) : 1;
  if (linesA > 0) {
    const lp = paint(BLACK, 0.55 * linesA);
    const shift = (((t / 1000) * 18) % 3 + 3) % 3;
    for (let y = -60 - shift + 2; y < 60; y += 3) canvas.drawRect(Skia.XYWHRect(-60, y - 0.5, 120, 1), lp);
  }
  const barA = a >= 260 ? 1 - prog(a, 300, 600) : 1;
  if (barA > 0) {
    const top = -60 + 120 - ((t / 2200) % 1) * 160;
    const bp = Skia.Paint();
    bp.setAlphaf(barA);
    bp.setShader(Skia.Shader.MakeLinearGradient({ x: 0, y: top }, { x: 0, y: top + 26 }, [color(WHITE, 0), color(WHITE, 0.14), color(WHITE, 0)], [0, 0.5, 1], TileMode.Clamp));
    canvas.drawRect(Skia.XYWHRect(-60, top, 120, 26), bp);
  }
  // vignette
  const vp = Skia.Paint();
  vp.setShader(Skia.Shader.MakeRadialGradient({ x: 0, y: 0 }, 85, [color(BLACK, 0), color(BLACK, 0), color(BLACK, 0.55)], [0, 0.59, 1], TileMode.Clamp));
  canvas.drawRect(Skia.XYWHRect(-60, -60, 120, 120), vp);
  canvas.restore();
  // ring
  const ring = paint(WHITE, 0.14 * ip);
  ring.setStyle(PaintStyle.Stroke);
  ring.setStrokeWidth(1.5);
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-60.75, -60.75, 121.5, 121.5), 15.75, 15.75), ring);
  canvas.restore();
  // the flash line
  const lineA = a >= 150 && a < 320 ? (a < 260 ? 1 : 1 - prog(a, 260, 320)) : 0;
  if (lineA > 0) {
    const lx = a < 260 ? lerp(0.6, 1, prog(a, 150, 260)) : lerp(1, 0.2, prog(a, 260, 320));
    canvas.save();
    canvas.scale(lx, 1);
    const lg = paint(res.a, lineA);
    lg.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 9, true));
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-74, -5, 148, 10), 5, 5), lg);
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-70, -1, 140, 2), 1, 1), paint(WHITE, lineA));
    canvas.restore();
  }
}

function drawDeck(canvas: SkCanvas, res: Res, w: number, a: number) {
  'worklet';
  const N = 4, P = 620;
  const step = Math.max(0, Math.floor(w / P)), sp = w > 0 ? (w % P) / P : 0;
  const fan = [[-9, -14], [-3, -5], [3, 4], [9, 13]];
  const drawn: Array<[number, number, number, number, number, number, number]> = [];
  for (let i = 0; i < N; i++) {
    const depth = (((i - step) % N) + N) % N;
    const g = eOut(prog(w, i * 70, i * 70 + 380));
    let rot = fan[depth][0], x = fan[depth][1], y = 0, z = depth;
    if (depth === N - 1 && sp > 0.35) {
      const q = prog(sp, 0.35, 1), out = Math.sin(q * Math.PI);
      x = lerp(fan[N - 1][1], fan[0][1], eIO(q)) + out * 70;
      rot = lerp(fan[N - 1][0], fan[0][0], eIO(q)) + out * 14;
      y = -out * 10;
      z = q > 0.5 ? -1 : N;
    } else if (sp > 0.35) {
      const q = eIO(prog(sp, 0.35, 1));
      rot = lerp(fan[depth][0], fan[depth + 1][0], q);
      x = lerp(fan[depth][1], fan[depth + 1][1], q);
    }
    let o = g;
    if (a >= 0) {
      const q = eIn(prog(a, 250, 650));
      const side = depth % 2 ? 1 : -1;
      x += side * q * (120 + depth * 30);
      rot += side * q * 25;
      o *= 1 - q;
    }
    drawn.push([z, i, x, y + lerp(30, 0, g), rot, lerp(0.8, 1, g), o]);
  }
  drawn.sort((p, q) => p[0] - q[0]);
  for (const [, i, x, y, rot, s, o] of drawn) {
    if (o <= 0.002) continue;
    canvas.save();
    // transform-origin: the card's bottom middle
    canvas.translate(x, y + 60);
    canvas.rotate(rot, 0, 0);
    canvas.scale(s, s);
    canvas.translate(0, -60);
    shadow(canvas, -42, -60, 84, 120, 12, 10, 30, 0.6 * o);
    const rr = Skia.RRectXY(Skia.XYWHRect(-42, -60, 84, 120), 12, 12);
    canvas.save();
    canvas.clipRRect(rr, ClipOp.Intersect, true);
    canvas.drawRect(Skia.XYWHRect(-42, -60, 84, 120), paint([22, 24, 29], o));
    const img = res.cards[i];
    if (img) {
      const iw = img.width(), ih = img.height();
      const sw = Math.min(iw, (ih * 84) / 120), sh = (sw * 120) / 84;
      canvas.drawImageRect(img, Skia.XYWHRect((iw - sw) / 2, (ih - sh) / 2, sw, sh), Skia.XYWHRect(-42, -60, 84, 120), paint(WHITE, o));
    }
    canvas.restore();
    const ring = paint(WHITE, 0.18 * o);
    ring.setStyle(PaintStyle.Stroke);
    ring.setStrokeWidth(1);
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-42.5, -60.5, 85, 121), 12.5, 12.5), ring);
    canvas.restore();
  }
  // your card drops onto the deck back first and flips
  if (a < 0) return;
  const dp = prog(a, 0, 260), fp = prog(a, 220, 620);
  const ty = lerp(-160, 0, eOut(dp));
  const ang = (lerp(180, 0, eBack(fp)) * Math.PI) / 180;
  const sc = lerp(0.9, 1, dp);
  const cos = Math.cos(ang);
  canvas.save();
  canvas.translate(0, ty);
  canvas.scale(cos * sc, sc);
  if (cos < 0) {
    // the back: the Riftn mark on dark, lit by the theme
    canvas.scale(-1, 1);
    const glow = paint(res.a, 0.33);
    glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 15, true));
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-60, -60, 120, 120), 15, 15), glow);
    shadow(canvas, -60, -60, 120, 120, 15, 14, 40, 0.6);
    canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-60, -60, 120, 120), 15, 15), paint([16, 17, 20], 1));
    const k = 56 / 1210;
    canvas.save();
    canvas.scale(k, k);
    canvas.translate(-(351 + 605), -(223 + 605));
    canvas.drawPath(res.path, paint(WHITE, 1));
    canvas.restore();
  } else {
    shadow(canvas, -60, -60, 120, 120, 15, 14, 40, 0.6);
    photo(canvas, res, -60, -60, 120, 15, 1);
  }
  const ring = paint(WHITE, 0.2);
  ring.setStyle(PaintStyle.Stroke);
  ring.setStrokeWidth(1);
  canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(-60.5, -60.5, 121, 121), 15.5, 15.5), ring);
  canvas.restore();
}

/** A box with each corner's own elliptical radius (CSS border-radius with a slash). */
function blobPath(w: number, h: number, rx: number[], ry: number[]) {
  'worklet';
  const k = 0.5523;
  const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
  const p = Skia.Path.Make();
  p.moveTo(x0 + rx[0], y0);
  p.lineTo(x1 - rx[1], y0);
  p.cubicTo(x1 - rx[1] + rx[1] * k, y0, x1, y0 + ry[1] - ry[1] * k, x1, y0 + ry[1]);
  p.lineTo(x1, y1 - ry[2]);
  p.cubicTo(x1, y1 - ry[2] + ry[2] * k, x1 - rx[2] + rx[2] * k, y1, x1 - rx[2], y1);
  p.lineTo(x0 + rx[3], y1);
  p.cubicTo(x0 + rx[3] - rx[3] * k, y1, x0, y1 - ry[3] + ry[3] * k, x0, y1 - ry[3]);
  p.lineTo(x0, y0 + ry[0]);
  p.cubicTo(x0, y0 + ry[0] - ry[0] * k, x0 + rx[0] - rx[0] * k, y0, x0 + rx[0], y0);
  p.close();
  return p;
}

function drawGlass(canvas: SkCanvas, res: Res, w: number, a: number) {
  'worklet';
  const s = w / 1000;
  const ip = eBack(prog(w, 0, 450));
  const settle = eOut(prog(a, 0, 450));
  const blob = (k: number) => 50 + 12 * Math.sin(s * 2.1 + k) * (1 - settle);
  const r0 = blob(0), r1 = blob(1.7), q0 = blob(2.3), q1 = blob(5.2);
  const sq = (v: number) => (lerp(v, 12.9, settle) / 100) * 116;
  const path = blobPath(116, 116, [sq(r0), sq(100 - r0), sq(r1), sq(100 - r1)], [sq(q0), sq(q1), sq(100 - q1), sq(100 - q0)]);
  const wob = 1 + 0.04 * Math.sin(s * 3.3) * (1 - settle);
  const size = lerp(1, 120 / 116, settle);
  const alpha = prog(w, 0, 200);
  // droplets orbit, pulled back in on arrival
  for (const [k, d] of [[0, 22], [Math.PI, 14]]) {
    const ang = s * 2.2 + k;
    const rad = lerp(84 + 8 * Math.sin(s * 1.3 + k), 0, eIn(prog(a, 0, 300)));
    const dA = prog(w, 250, 600) * (1 - prog(a, 200, 300));
    if (dA <= 0.002) continue;
    const cx = Math.cos(ang) * rad, cy = Math.sin(ang) * rad * 0.8;
    canvas.drawCircle(cx, cy, d / 2, paint(WHITE, 0.16 * dA));
    const rim = paint(WHITE, 0.25 * dA);
    rim.setStyle(PaintStyle.Stroke);
    rim.setStrokeWidth(1);
    canvas.drawCircle(cx, cy, d / 2 - 0.5, rim);
    const hi = paint(WHITE, 0.6 * dA);
    hi.setStyle(PaintStyle.Stroke);
    hi.setStrokeWidth(1);
    canvas.drawArc(Skia.XYWHRect(cx - d / 2 + 1, cy - d / 2 + 1, d - 2, d - 2), 205, 130, false, hi);
  }
  if (alpha <= 0.002) return;
  canvas.save();
  canvas.rotate(Math.sin(s * 0.9) * 8 * (1 - settle), 0, 0);
  canvas.scale(ip * wob * size, ip * (2 - wob) * size);
  // drop shadow
  const sh = paint(BLACK, 0.45 * alpha);
  sh.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 25, true));
  canvas.save();
  canvas.translate(0, 20);
  canvas.drawPath(path, sh);
  canvas.restore();
  const layer = Skia.Paint();
  layer.setAlphaf(alpha);
  canvas.saveLayer(layer);
  canvas.clipPath(path, ClipOp.Intersect, true);
  // the glass: lit from the top left, the dark sheet showing through
  canvas.drawRect(Skia.XYWHRect(-58, -58, 116, 116), paint([96, 98, 106], 0.55));
  const fill = Skia.Paint();
  fill.setShader(Skia.Shader.MakeLinearGradient({ x: -40, y: -70 }, { x: 40, y: 70 }, [color(WHITE, 0.22), color(WHITE, 0.04), color(WHITE, 0.1)], [0, 0.45, 1], TileMode.Clamp));
  canvas.drawRect(Skia.XYWHRect(-58, -58, 116, 116), fill);
  // light moving inside
  const kA = 1 - prog(a, 100, 450);
  if (kA > 0) {
    for (const [c, ph, r, o] of [[res.a, 0, 30, 0.55], [res.b, 3.1, 26, 0.45]] as Array<[Rgb, number, number, number]>) {
      const kp = paint(c, o * kA * 0.75);
      kp.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 14, true));
      canvas.drawCircle(Math.cos(s * 1.6 + ph) * r, Math.sin(s * 1.6 + ph) * r, 45, kp);
    }
  }
  // the picture develops behind the glass
  const pp = prog(a, 150, 650);
  if (pp > 0) {
    const pl = Skia.Paint();
    pl.setAlphaf(eOut(pp));
    if (pp < 1) {
      const sat = lerp(1.6, 1, pp);
      const lr = 0.213 * (1 - sat), lg = 0.715 * (1 - sat), lb = 0.072 * (1 - sat);
      pl.setImageFilter(Skia.ImageFilter.MakeBlur(lerp(12, 0, eOut(pp)) + 0.01, lerp(12, 0, eOut(pp)) + 0.01, TileMode.Clamp, null));
      pl.setColorFilter(Skia.ColorFilter.MakeMatrix([lr + sat, lg, lb, 0, 0, lr, lg + sat, lb, 0, 0, lr, lg, lb + sat, 0, 0, 0, 0, 0, 1, 0]));
    }
    canvas.saveLayer(pl);
    photo(canvas, res, -58, -58, 116, 0, 1);
    canvas.restore();
  }
  // the sheen
  const shp = prog(a, 380, 820);
  if (shp > 0 && shp < 1) {
    const left = -58 + (lerp(-50, 130, eIO(shp)) / 100) * 116;
    const sp = Skia.Paint();
    sp.setShader(Skia.Shader.MakeLinearGradient({ x: left, y: 0 }, { x: left + 46, y: 8 }, [color(WHITE, 0), color(WHITE, 0.45), color(WHITE, 0)], [0, 0.5, 1], TileMode.Clamp));
    canvas.drawRect(Skia.XYWHRect(left, -82, 46, 164), sp);
  }
  canvas.restore();
  // rim lights
  const rim = paint(WHITE, 0.22 * alpha * (1 - settle * 0.6));
  rim.setStyle(PaintStyle.Stroke);
  rim.setStrokeWidth(1);
  canvas.drawPath(path, rim);
  canvas.restore();
}

export function drawConcept(canvas: SkCanvas, res: Res, t: number, a: number) {
  'worklet';
  canvas.save();
  canvas.translate(HALF, HALF);
  if (res.look === 'trace') drawTrace(canvas, res, t, a);
  else if (res.look === 'tune') drawTune(canvas, res, t, a);
  else if (res.look === 'deck') drawDeck(canvas, res, t, a);
  else drawGlass(canvas, res, t, a);
  canvas.restore();
}

let font: SkFont | null = null;
function initialFont() {
  if (!font) font = matchFont({ fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }), fontSize: 52, fontWeight: 'bold' });
  return font;
}

/**
 * One arrival, centred on its parent's middle. `opened`: the account is in.
 * `instantOpen` starts on the picture; `skipIntro` starts mid-loop (it already
 * played on the veil).
 */
export const ConceptArrival: React.FC<{
  look: ConceptLook;
  picture: string | null;
  name: string;
  opened: boolean;
  instantOpen?: boolean;
  skipIntro?: boolean;
  colors: { a: string; b: string };
}> = ({ look, picture, name, opened, instantOpen, skipIntro, colors }) => {
  const pictureImage = useImage(picture ?? undefined);
  const c0 = useImage(DECK_CARDS[0]);
  const c1 = useImage(DECK_CARDS[1]);
  const c2 = useImage(DECK_CARDS[2]);
  const c3 = useImage(DECK_CARDS[3]);
  const { path, length } = markPath();
  const res = useMemo<Res>(() => ({
    look,
    a: hexRgb(colors.a),
    b: hexRgb(colors.b),
    picture: pictureImage,
    cards: [c0, c1, c2, c3],
    font: initialFont(),
    initial: (name || '?').trim().charAt(0).toUpperCase(),
    path,
    length,
  }), [look, colors.a, colors.b, pictureImage, c0, c1, c2, c3, name, path, length]);

  const reveal = CONCEPT_REVEAL_MS[look];
  const t = useSharedValue(skipIntro || instantOpen ? 1500 : 0);
  const openAt = useSharedValue(instantOpen ? -100000 : -1);
  const openNow = useSharedValue(!!opened);
  const base = useSharedValue(skipIntro || instantOpen ? 1500 : 0);
  useEffect(() => { openNow.value = opened; }, [opened, openNow]);

  const clock = useFrameCallback((info) => {
    t.value = base.value + info.timeSinceFirstFrame;
    if (openNow.value && openAt.value === -1) openAt.value = t.value;
  }, !instantOpen);
  // Nothing moves once the picture stands still.
  useEffect(() => {
    if (instantOpen || !opened) return;
    const timer = setTimeout(() => clock.setActive(false), reveal + 120);
    return () => clearTimeout(timer);
  }, [opened, instantOpen, reveal, clock]);

  const pic = useDerivedValue(() => createPicture((canvas) => {
    const a = openAt.value === -1 ? -1 : t.value - openAt.value;
    drawConcept(canvas, res, t.value, a);
  }, { width: SIZE, height: SIZE }));

  return (
    <Canvas style={styles.canvas} pointerEvents="none">
      <Picture picture={pic} />
    </Canvas>
  );
};

const styles = StyleSheet.create({
  canvas: { position: 'absolute', left: -HALF, top: -HALF, width: SIZE, height: SIZE },
});
