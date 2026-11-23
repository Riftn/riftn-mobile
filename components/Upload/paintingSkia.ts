/**
 * Skia half of the Painting canvas: draws the shared brush engine's ops
 * (libs/painting/engine) onto a raster surface, fills, and writes the finished
 * painting to a file.
 *
 * Skia-drawn: only load this through `optionalSkia` (libs/skia).
 */
import {
  AlphaType,
  ColorType,
  ImageFormat,
  PaintStyle,
  PointMode,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkImage,
  type SkPoint,
  type SkSurface,
} from "@shopify/react-native-skia";
import * as FileSystem from "expo-file-system/legacy";
import { PAPER, floodFill, paintingFileName, type PaintOp } from "../../libs/painting/engine";

/** Above this a painting goes out as JPEG instead of PNG. */
const PNG_MAX_BYTES = 4_500_000;

function paintOf(color: string, alpha: number) {
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(color));
  paint.setAlphaf(alpha);
  return paint;
}

/**
 * Draw painting ops. Segments, dots and specks that share a colour, alpha and
 * width go down in one drawPoints call, so a pastel stroke's hundreds of
 * specks cost a handful of calls.
 */
export function drawSkOps(canvas: SkCanvas, ops: PaintOp[]) {
  const batches = new Map<string, { mode: PointMode; width: number; cap: StrokeCap; color: string; a: number; pts: SkPoint[] }>();
  const batch = (mode: PointMode, width: number, cap: StrokeCap, color: string, a: number) => {
    const key = `${mode}|${color}|${a}|${width}|${cap}`;
    let b = batches.get(key);
    if (!b) {
      b = { mode, width, cap, color, a, pts: [] };
      batches.set(key, b);
    }
    return b.pts;
  };
  for (const op of ops) {
    switch (op.k) {
      case "seg":
        batch(PointMode.Lines, op.w, op.cap === "square" ? StrokeCap.Square : op.cap === "butt" ? StrokeCap.Butt : StrokeCap.Round, op.color, op.a).push({ x: op.x1, y: op.y1 }, { x: op.x2, y: op.y2 });
        break;
      case "dot":
        batch(PointMode.Points, Math.max(1, op.r * 2), StrokeCap.Round, op.color, op.a).push({ x: op.x, y: op.y });
        break;
      case "speck":
        batch(PointMode.Points, op.s, StrokeCap.Square, op.color, op.a).push({ x: op.x, y: op.y });
        break;
      case "ring": {
        const paint = paintOf(op.color, op.a);
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(op.w);
        canvas.drawCircle(op.x, op.y, Math.max(0.5, op.r), paint);
        break;
      }
      case "rect": {
        const paint = paintOf(op.color, 1);
        if (!op.fill) {
          paint.setStyle(PaintStyle.Stroke);
          paint.setStrokeWidth(op.lw);
          paint.setStrokeJoin(StrokeJoin.Miter);
        }
        canvas.drawRect(Skia.XYWHRect(op.x, op.y, op.w, op.h), paint);
        break;
      }
      case "ellipse": {
        const paint = paintOf(op.color, 1);
        if (!op.fill) {
          paint.setStyle(PaintStyle.Stroke);
          paint.setStrokeWidth(op.lw);
        }
        canvas.drawOval(Skia.XYWHRect(op.cx - op.rx, op.cy - op.ry, Math.max(1, op.rx * 2), Math.max(1, op.ry * 2)), paint);
        break;
      }
    }
  }
  for (const b of batches.values()) {
    const paint = paintOf(b.color, b.a);
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(b.width);
    paint.setStrokeCap(b.cap);
    canvas.drawPoints(b.mode, b.pts, paint);
  }
}

/** A raster surface of white paper. */
export function makePaper(w: number, h: number): SkSurface | null {
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  clearPaper(surface);
  return surface;
}

export function clearPaper(surface: SkSurface) {
  surface.getCanvas().drawColor(Skia.Color(PAPER));
}

export function snapshot(surface: SkSurface): SkImage {
  surface.flush();
  return surface.makeImageSnapshot();
}

/** Put a saved frame back (undo / redo). Frames are opaque, so this replaces. */
export function restore(surface: SkSurface, frame: SkImage) {
  surface.getCanvas().drawImage(frame, 0, 0);
}

/** Fill bucket at (x, y). False when nothing changed. */
export function fillAt(surface: SkSurface, w: number, h: number, x: number, y: number, color: string): boolean {
  const info = { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
  const px = snapshot(surface).makeNonTextureImage().readPixels(0, 0, info);
  if (!(px instanceof Uint8Array)) return false;
  if (!floodFill(px, w, h, x, y, color)) return false;
  const filled = Skia.Image.MakeImage(info, Skia.Data.fromBytes(px), w * 4);
  if (!filled) return false;
  surface.getCanvas().drawImage(filled, 0, 0);
  return true;
}

/** Write the painting to a file: PNG, or JPEG when the PNG would be large. */
export async function savePainting(surface: SkSurface, w: number, h: number) {
  const image = snapshot(surface).makeNonTextureImage();
  let b64 = image.encodeToBase64(ImageFormat.PNG, 100);
  let ext: "png" | "jpg" = "png";
  if (!b64 || b64.length * 0.75 > PNG_MAX_BYTES) {
    b64 = image.encodeToBase64(ImageFormat.JPEG, 92);
    ext = "jpg";
  }
  if (!b64) throw new Error("encode failed");
  const fileName = paintingFileName(ext);
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
  return { uri, width: w, height: h, mimeType: ext === "png" ? "image/png" : "image/jpeg", fileName, fileSize: Math.round(b64.length * 0.75) };
}

export type SavedPainting = Awaited<ReturnType<typeof savePainting>>;
