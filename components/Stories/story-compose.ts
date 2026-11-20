/**
 * Drawing a moment's final picture with Skia, like web's story-compose.
 * Words are placed in fractions of the 9:16 stage, so they land in the same
 * place on the 1080 x 1920 file whatever the phone. A photo moment gets them
 * drawn into the photo; a video moment gets a transparent layer the viewer
 * lays over the clip.
 *
 * Only load this through `optionalSkia` (libs/skia).
 */
import { Skia, FontWeight, ImageFormat, TileMode, type SkCanvas, type SkImage } from "@shopify/react-native-skia";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

export const OUT_W = 1080;
export const OUT_H = 1920;

export interface TextLayer {
  id: string;
  text: string;
  /** Centre, 0..1 of the stage. */
  x: number;
  y: number;
  /** Font size as a fraction of the stage width. */
  size: number;
  color: string;
  box: boolean;
}

const FAMILIES = Platform.select({ ios: ["Helvetica Neue"], default: ["sans-serif"] });

function drawText(canvas: SkCanvas, layer: TextLayer) {
  const text = layer.text.trim();
  if (!text) return;
  const px = Math.round(layer.size * OUT_W);
  const lines = text.split("\n");
  const lineH = px * 1.18;
  const cx = layer.x * OUT_W;
  const top = layer.y * OUT_H - (lines.length * lineH) / 2;
  lines.forEach((line, i) => {
    // Paragraph shaping can fall back to the system emoji font and preserves
    // joined emoji and skin-tone sequences when baking the overlay.
    const builder = Skia.ParagraphBuilder.Make({ maxLines: 1 });
    builder.pushStyle({
      color: Skia.Color(layer.color),
      fontSize: px,
      fontFamilies: FAMILIES,
      fontStyle: { weight: FontWeight.Bold },
      ...(layer.box ? {} : {
        shadows: [{ color: Skia.Color("rgba(0,0,0,0.45)"), blurRadius: px * 0.12, offset: { x: 0, y: 0 } }],
      }),
    });
    builder.addText(line || " ");
    builder.pop();
    const paragraph = builder.build();
    paragraph.layout(100_000);
    const w = paragraph.getLongestLine();
    const lineTop = top + lineH * i;
    if (layer.box) {
      const pad = px * 0.32;
      const box = Skia.Paint();
      box.setAntiAlias(true);
      box.setColor(Skia.Color(layer.color.toLowerCase() === "#ffffff" ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.92)"));
      canvas.drawRRect(
        Skia.RRectXY(Skia.XYWHRect(cx - w / 2 - pad, lineTop, w + pad * 2, lineH), px * 0.28, px * 0.28),
        box,
      );
    }
    paragraph.paint(canvas, cx - w / 2, lineTop + (lineH - paragraph.getHeight()) / 2);
  });
}

function drawCover(canvas: SkCanvas, image: SkImage) {
  const sw = image.width();
  const sh = image.height();
  const ratio = sw / sh;
  const paint = Skia.Paint();
  const cover = () => {
    const scale = Math.max(OUT_W / sw, OUT_H / sh);
    const w = sw * scale;
    const h = sh * scale;
    canvas.drawImageRect(image, Skia.XYWHRect(0, 0, sw, sh), Skia.XYWHRect((OUT_W - w) / 2, (OUT_H - h) / 2, w, h), paint);
  };
  if (ratio <= 0.75) return cover();
  // Much wider than tall: the whole picture over a dimmed, blurred copy.
  const blur = Skia.Paint();
  blur.setImageFilter(Skia.ImageFilter.MakeBlur(40, 40, TileMode.Clamp, null));
  blur.setColorFilter(Skia.ColorFilter.MakeMatrix([0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 1, 0]));
  const scale = Math.max(OUT_W / sw, OUT_H / sh);
  canvas.drawImageRect(image, Skia.XYWHRect(0, 0, sw, sh), Skia.XYWHRect((OUT_W - sw * scale) / 2, (OUT_H - sh * scale) / 2, sw * scale, sh * scale), blur);
  const h = OUT_W / ratio;
  canvas.drawImageRect(image, Skia.XYWHRect(0, 0, sw, sh), Skia.XYWHRect(0, (OUT_H - h) / 2, OUT_W, h), paint);
}

async function save(snapshot: SkImage, png: boolean): Promise<string> {
  const b64 = snapshot.encodeToBase64(png ? ImageFormat.PNG : ImageFormat.JPEG, 90);
  if (!b64) throw new Error("encode failed");
  const out = `${FileSystem.cacheDirectory}moment-${Date.now()}.${png ? "png" : "jpg"}`;
  await FileSystem.writeAsStringAsync(out, b64, { encoding: FileSystem.EncodingType.Base64 });
  return out;
}

/** The photo and its words, flattened into one 1080 x 1920 JPEG. */
export async function composePhoto(uri: string, layers: TextLayer[]): Promise<string> {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error("could not decode image");
  const surface = Skia.Surface.Make(OUT_W, OUT_H) ?? Skia.Surface.MakeOffscreen(OUT_W, OUT_H);
  if (!surface) throw new Error("could not allocate surface");
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("#000000"));
  drawCover(canvas, image);
  layers.forEach((l) => drawText(canvas, l));
  surface.flush();
  return save(surface.makeImageSnapshot().makeNonTextureImage(), false);
}

/** A video moment's words on a transparent PNG, or null when there are none. */
export async function composeOverlay(layers: TextLayer[]): Promise<string | null> {
  const visible = layers.filter((l) => l.text.trim());
  if (!visible.length) return null;
  const surface = Skia.Surface.Make(OUT_W, OUT_H) ?? Skia.Surface.MakeOffscreen(OUT_W, OUT_H);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color("transparent"));
  visible.forEach((l) => drawText(canvas, l));
  surface.flush();
  return save(surface.makeImageSnapshot().makeNonTextureImage(), true);
}
