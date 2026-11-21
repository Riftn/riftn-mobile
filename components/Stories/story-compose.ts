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
import type { StoryMention } from "../../services/stories.service";

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
  mentionAddress?: string;
}

const FAMILIES = Platform.select({ ios: ["Helvetica Neue"], default: ["sans-serif"] });

function layoutLine(line: string, px: number, layer: TextLayer) {
  // Paragraph shaping falls back to the system emoji font for joined sequences.
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
  return paragraph;
}

function drawText(canvas: SkCanvas, layer: TextLayer) {
  const text = layer.text.trim();
  if (!text) return;
  const px = Math.round(layer.size * OUT_W);
  const lines = text.split("\n");
  const lineH = px * 1.18;
  const cx = layer.x * OUT_W;
  const top = layer.y * OUT_H - (lines.length * lineH) / 2;
  lines.forEach((line, i) => {
    const paragraph = layoutLine(line, px, layer);
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

/** Tap targets use the same paragraph and padding as the exported labels. */
export function mentionBoxes(layers: TextLayer[]): StoryMention[] {
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return layers.flatMap((layer) => {
    if (!layer.mentionAddress) return [];
    const px = Math.round(layer.size * OUT_W);
    const paragraph = layoutLine(layer.text, px, layer);
    const halfW = (paragraph.getLongestLine() + px * 0.64) / (2 * OUT_W);
    const halfH = (px * 1.18) / (2 * OUT_H);
    const x = clamp(layer.x - halfW);
    const y = clamp(layer.y - halfH);
    return [{ address: layer.mentionAddress, x, y, w: clamp(layer.x + halfW) - x, h: clamp(layer.y + halfH) - y }];
  });
}

function drawCover(canvas: SkCanvas, image: SkImage) {
  const sw = image.width();
  const sh = image.height();
  const source = Skia.XYWHRect(0, 0, sw, sh);
  const centeredRect = (scale: number) => {
    const width = sw * scale;
    const height = sh * scale;
    return Skia.XYWHRect((OUT_W - width) / 2, (OUT_H - height) / 2, width, height);
  };
  const fit = Math.min(OUT_W / sw, OUT_H / sh);
  const fill = Math.max(OUT_W / sw, OUT_H / sh);
  if (fill > fit) {
    const blur = Skia.Paint();
    blur.setImageFilter(Skia.ImageFilter.MakeBlur(40, 40, TileMode.Clamp, null));
    blur.setColorFilter(Skia.ColorFilter.MakeMatrix([0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 1, 0]));
    canvas.drawImageRect(image, source, centeredRect(fill), blur);
  }
  canvas.drawImageRect(image, source, centeredRect(fit), Skia.Paint());
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
