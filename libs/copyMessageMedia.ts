/**
 * "Copy media" on a held chat message.
 *
 * A photo goes on the clipboard as the picture itself, so it pastes into
 * another chat or app. A GIF would freeze on its first frame as a picture, and
 * a video can't sit on a clipboard at all, so those copy their link.
 */
import * as Clipboard from "expo-clipboard";
import { copyImage } from "./assistantMedia";
import { toastError, toastSuccess } from "./toast";
import { translateCopy as _translateCopy } from "../i18n/copy";

export type CopyMediaKind = "image" | "gif" | "video";

export async function copyMessageMedia(url: string, kind: CopyMediaKind): Promise<void> {
  if (kind === "image") {
    await copyImage(url);
    return;
  }
  try {
    await Clipboard.setStringAsync(url);
    toastSuccess(kind === "gif"
      ? _translateCopy("chatHold.gifLinkCopied", { defaultValue: "GIF link copied" })
      : _translateCopy("chatHold.videoLinkCopied", { defaultValue: "Video link copied" }));
  } catch {
    toastError(_translateCopy("chatHold.copyFailed", { defaultValue: "Couldn't copy" }));
  }
}
