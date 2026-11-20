import { FilterMode, ImageFormat, MipmapMode, Skia, TileMode, type SkData } from "@shopify/react-native-skia";

/**
 * A real Gaussian blur of a picture for Android, made once with Skia and
 * handed back as a small PNG data URL that a plain image view shows.
 *
 * Android has no safe live picture blur (RenderScript crashes new phones, see
 * components/common/BlurSafeImage), and the stretch-a-tiny-copy stand-in came
 * out blocky. Baking it once keeps grids and lists on ordinary image views
 * (no Skia canvas per tile). Skia only: load this through `optionalSkia`.
 */

const cache = new Map<string, Promise<string | null>>();
const MAX_CACHED = 80;
let queue: Promise<void> = Promise.resolve();

/** How small the baked copy is: still about 3 pixels per blur step. */
export function bakeScale(radius: number): number {
  return Math.min(1, 3 / Math.max(1, radius));
}

export function bakeBlur(uri: string, width: number, height: number, radius: number, fit: "cover" | "contain"): Promise<string | null> {
  const key = `${uri}|${Math.round(width)}x${Math.round(height)}|${radius}|${fit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // One bake at a time, a frame apart, so a grid of tiles never stacks its
  // decodes onto one frame of the JS thread.
  // The download runs at once; only the decode and drawing wait their turn.
  const data = Skia.Data.fromURI(uri);
  const job = Promise.all([data, queue.then(() => new Promise((r) => setTimeout(r, 16)))])
    .then(([bytes]) => run(bytes, width, height, radius, fit))
    .catch(() => null);
  queue = job.then(() => undefined);
  cache.set(key, job);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  // A failed bake may work next time (network), so it does not stick.
  void job.then((out) => { if (!out) cache.delete(key); });
  return job;
}

function run(bytes: SkData, width: number, height: number, radius: number, fit: "cover" | "contain"): string | null {
  const image = Skia.Image.MakeImageFromEncoded(bytes);
  if (!image || width <= 0 || height <= 0) return null;
  const s = bakeScale(radius);
  const w = Math.max(8, Math.round(width * s));
  const h = Math.max(8, Math.round(height * s));
  const iw = image.width();
  const ih = image.height();

  // 1) Fit the picture into the small box with mipmaps, so shrinking it
  //    averages instead of picking stray pixels.
  const fitted = Skia.Surface.Make(w, h) ?? Skia.Surface.MakeOffscreen(w, h);
  if (!fitted) return null;
  let src = Skia.XYWHRect(0, 0, iw, ih);
  let dst = Skia.XYWHRect(0, 0, w, h);
  if (fit === "cover") {
    const k = Math.max(w / iw, h / ih);
    const cw = w / k;
    const ch = h / k;
    src = Skia.XYWHRect((iw - cw) / 2, (ih - ch) / 2, cw, ch);
  } else {
    const k = Math.min(w / iw, h / ih);
    dst = Skia.XYWHRect((w - iw * k) / 2, (h - ih * k) / 2, iw * k, ih * k);
  }
  fitted.getCanvas().drawImageRectOptions(image, src, dst, FilterMode.Linear, MipmapMode.Linear, Skia.Paint());
  fitted.flush();
  const small = fitted.makeImageSnapshot().makeNonTextureImage();

  // 2) Blur it, clamping the edges so the borders do not fade to clear.
  const out = Skia.Surface.Make(w, h) ?? Skia.Surface.MakeOffscreen(w, h);
  if (!out) return null;
  const paint = Skia.Paint();
  const sigma = Math.max(0.5, radius * s);
  paint.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Clamp, null));
  out.getCanvas().drawImage(small, 0, 0, paint);
  out.flush();
  const b64 = out.makeImageSnapshot().makeNonTextureImage().encodeToBase64(ImageFormat.PNG, 100);
  return b64 ? `data:image/png;base64,${b64}` : null;
}
