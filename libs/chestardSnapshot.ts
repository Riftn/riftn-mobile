/**
 * Chestard snapshot
 * =================
 * "Post a snapshot": the board exactly as it stands when you share, drawn in
 * the game's retro look on a 1200x630 picture and written to a PNG the
 * composer can attach. Same drawing as the web (riftn-web
 * src/lib/chestard-snapshot.ts).
 *
 * Skia only: load this through `optionalSkia` (libs/skia), because importing
 * Skia on a binary without it throws.
 */
import {
  BlurStyle,
  PaintStyle,
  ImageFormat,
  Skia,
  TileMode,
  matchFont,
  type SkCanvas,
  type SkFont,
} from '@shopify/react-native-skia';
import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import { formatCount } from './format-count';
import { COLS, ROWS, type ChestardBoard } from './chestard';

const W = 1200;
const H = 630;
const CYAN = '#55ffff';
const MAGENTA = '#ff55ff';
const WHITE = '#e8e8e8';

const scoreText = (n: number) => (n < 1000 ? String(n).padStart(6, '0') : formatCount(n));

let typeface: ReturnType<typeof Skia.Typeface.MakeFreeTypeFaceFromData> | undefined;
async function pixelFont(size: number): Promise<SkFont> {
  if (typeface === undefined) {
    try {
      const asset = Asset.fromModule(require('../assets/fonts/PressStart2P-Regular.ttf'));
      await asset.downloadAsync();
      const data = await Skia.Data.fromURI(asset.localUri ?? asset.uri);
      typeface = Skia.Typeface.MakeFreeTypeFaceFromData(data);
    } catch {
      typeface = null;
    }
  }
  if (typeface) return Skia.Font(typeface, size);
  return matchFont({ fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: size, fontWeight: 'bold' });
}

export interface ChestardSnapshotInput {
  board: ChestardBoard;
  best: number;
  name: string | null;
  labels: { score: string; hi: string; lines: string; drops: string; perDrop: string; gameOver: string };
}

export async function drawChestardSnapshot(input: ChestardSnapshotInput): Promise<{ uri: string; width: number; height: number; mimeType: string; fileName: string } | null> {
  const surface = Skia.Surface.Make(W, H) ?? Skia.Surface.MakeOffscreen(W, H);
  if (!surface) return null;
  const canvas: SkCanvas = surface.getCanvas();
  const { board, best, name, labels } = input;
  const fonts = new Map<number, SkFont>();
  const font = async (size: number) => {
    let f = fonts.get(size);
    if (!f) { f = await pixelFont(size); fonts.set(size, f); }
    return f;
  };
  const paint = (color: string) => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(Skia.Color(color));
    return p;
  };
  // Text is placed by its top edge, like the web canvas (textBaseline top).
  const text = async (s: string, x: number, y: number, size: number, color: string, align: 'left' | 'center' = 'left', glow = false) => {
    const f = await font(size);
    const width = f.measureText(s).width;
    const left = align === 'center' ? x - width / 2 : x;
    if (glow) {
      const g = paint(color);
      g.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 9, true));
      canvas.drawText(s, left, y + size, g, f);
    }
    canvas.drawText(s, left, y + size, paint(color), f);
  };

  // Screen
  const bg = Skia.Paint();
  bg.setShader(Skia.Shader.MakeRadialGradient({ x: W * 0.3, y: H * 0.5 }, W * 0.75, [Skia.Color('#120814'), Skia.Color('#050505')], [0, 1], TileMode.Clamp));
  canvas.drawRect(Skia.XYWHRect(0, 0, W, H), bg);

  await text('CHESTARD', 64, 64, 44, MAGENTA, 'left', true);
  const stats: Array<[string, string, string]> = [
    [labels.score, scoreText(board.score), WHITE],
    [labels.hi, scoreText(best), WHITE],
    [labels.lines, String(board.lines).padStart(2, '0'), WHITE],
    [labels.drops, String(board.drops).padStart(3, '0'), WHITE],
    [labels.perDrop, `X${1 + board.lines}`, MAGENTA],
  ];
  let y = 150;
  for (const [label, value, color] of stats) {
    await text(label.toUpperCase(), 64, y, 16, CYAN);
    await text(value, 64, y + 26, 28, color);
    y += 76;
  }
  if (name) await text(name, 64, H - 92, 18, WHITE);
  await text('RIFTN.COM/ARCADE/CHESTARD', 64, H - 56, 12, 'rgba(85,255,255,0.7)');

  // Board
  const cell = 56;
  const bw = COLS * cell;
  const bh = ROWS * cell;
  const bx = 600;
  const by = (H - bh) / 2 - 10;
  canvas.drawRect(Skia.XYWHRect(bx, by, bw, bh), paint('#000000'));
  const frame = paint(CYAN);
  frame.setStyle(PaintStyle.Stroke);
  frame.setStrokeWidth(3);
  canvas.drawRect(Skia.XYWHRect(bx - 6, by - 6, bw + 12, bh + 12), frame);
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const cx = bx + c * cell + cell / 2;
      const cy = by + bh - r * cell - cell / 2;
      if (r < (board.heights[c] ?? 0)) {
        const ball = Skia.Paint();
        ball.setAntiAlias(true);
        ball.setShader(Skia.Shader.MakeRadialGradient(
          { x: cx - 8, y: cy - 8 }, cell * 0.45,
          [Skia.Color('#ffc2ff'), Skia.Color(MAGENTA), Skia.Color('#b02ab0')], [0, 0.35, 1], TileMode.Clamp,
        ));
        canvas.drawCircle(cx, cy, cell * 0.42, ball);
        canvas.drawCircle(cx - 8, cy - 9, 4, paint('rgba(255,255,255,0.85)'));
      } else {
        canvas.drawRect(Skia.XYWHRect(cx - 2, cy - 2, 4, 4), paint('rgba(85,255,255,0.55)'));
      }
    }
  }
  for (let c = 0; c < COLS; c++) await text(String(c + 1), bx + c * cell + cell / 2, by + bh + 18, 16, CYAN, 'center');

  // Stacks meter
  const mx = bx + bw + 56;
  for (let c = 0; c < COLS; c++) {
    const h = board.heights[c] ?? 0;
    const x = mx + c * 30;
    canvas.drawRect(Skia.XYWHRect(x, by + bh - 180, 22, 180), paint('rgba(85,255,255,0.12)'));
    const fill = (180 * h) / ROWS;
    canvas.drawRect(Skia.XYWHRect(x, by + bh - fill, 22, fill), paint(CYAN));
  }

  if (board.over) {
    canvas.drawRect(Skia.XYWHRect(bx, by + bh / 2 - 50, bw, 100), paint('rgba(0,0,0,0.72)'));
    await text(labels.gameOver.toUpperCase(), bx + bw / 2, by + bh / 2 - 30, 26, MAGENTA, 'center');
    await text(scoreText(board.score), bx + bw / 2, by + bh / 2 + 10, 20, WHITE, 'center');
  }

  surface.flush();
  const b64 = surface.makeImageSnapshot().makeNonTextureImage().encodeToBase64(ImageFormat.PNG, 100);
  if (!b64) return null;
  const fileName = `chestard-snapshot-${Date.now()}.png`;
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
  return { uri, width: W, height: H, mimeType: 'image/png', fileName };
}
