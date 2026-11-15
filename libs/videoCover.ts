import * as FileSystem from "expo-file-system/legacy";
import * as VideoThumbnails from "expo-video-thumbnails";

/**
 * Where to look for a video's cover, in order.
 *
 * Frame 0 is black on any clip that fades in, and that black frame became
 * the poster every grid card and the shorts player show before playback.
 * One second in is what the server uses when it pulls a frame itself.
 */
export const COVER_PROBE_MS = [1000, 3000, 0] as const;

/**
 * A flat black frame compresses to almost nothing: a few KB for a whole
 * 1080x1920 JPEG, where a real picture, even a dark one, runs far larger.
 */
const BLANK_BYTES_PER_PIXEL = 0.006;

export async function looksBlank(uri: string, width?: number, height?: number): Promise<boolean> {
  if (!width || !height) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof info.size === "number" && info.size < width * height * BLANK_BYTES_PER_PIXEL;
  } catch {
    return false;
  }
}

/** A cover frame for a picked video, skipping a black intro. */
export async function captureVideoCover(uri: string, quality = 0.6): Promise<string> {
  let fallback: string | null = null;
  for (const time of COVER_PROBE_MS) {
    const shot = await VideoThumbnails.getThumbnailAsync(uri, { time, quality }).catch(() => null);
    if (!shot) continue;
    fallback ??= shot.uri;
    if (!(await looksBlank(shot.uri, shot.width, shot.height))) return shot.uri;
  }
  if (!fallback) throw new Error("No frame could be read from the video");
  return fallback;
}
