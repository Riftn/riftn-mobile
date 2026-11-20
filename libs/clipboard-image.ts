/**
 * A copied picture (a screenshot, an image copied from Photos or a browser)
 * as a local file the chat composer can send.
 *
 * iOS text fields only paste text: long-press → Paste with a screenshot on the
 * clipboard does nothing in a React Native TextInput. So the composer checks
 * the clipboard itself and offers "Paste image" when there is one.
 * `hasImageAsync` only asks whether there is an image, so it never shows
 * iOS's "allow paste" prompt; that only appears when the user taps Paste.
 */
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";

export async function clipboardHasImage(): Promise<boolean> {
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}

export interface ClipboardImageFile {
  uri: string;
  width?: number;
  height?: number;
  size?: number;
}

export async function clipboardImageFile(): Promise<ClipboardImageFile | null> {
  if (!(await clipboardHasImage())) return null;
  const image = await Clipboard.getImageAsync({ format: "jpeg", jpegQuality: 0.92 });
  const data = image?.data || "";
  const base64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  if (!base64) return null;
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
  const uri = `${dir}pasted_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return {
    uri,
    width: image?.size?.width || undefined,
    height: image?.size?.height || undefined,
    size: Math.floor((base64.length * 3) / 4),
  };
}
