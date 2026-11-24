/**
 * Hold the profile picture or the banner: a glass sheet with Change, Paste,
 * Copy and Delete for the owner, Copy for everyone else. Mirrors the web
 * right-click / hold menu (dehubweb useProfileImageMenu).
 *
 * Paste reads an image off the clipboard and sends it through the same
 * cropper as a picked photo, so it lands in the profile's shape.
 */
import React, { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import ImageCropPicker from "react-native-image-crop-picker";
import HoldSheet, { type HoldLayout, type HoldTile } from "../ui/HoldSheet";
import { AVATAR_UPLOAD_SIDE } from "../../libs/assets.util";
import { copyImage } from "../../libs/assistantMedia";
import { toastError, toastInfo } from "../../libs/toast";

export type ProfileImageKind = "avatar" | "cover";

/** Crop box per picture, the same the photo picker uses. */
export const PROFILE_IMAGE_CROP: Record<ProfileImageKind, { width: number; height: number }> = {
  avatar: { width: AVATAR_UPLOAD_SIDE, height: AVATAR_UPLOAD_SIDE },
  cover: { width: 1800, height: 600 },
};

const isCancel = (e: unknown) => {
  const code = (e as { code?: string })?.code;
  const msg = String((e as { message?: string })?.message || "");
  return code === "E_PICKER_CANCELLED" || /cancel/i.test(msg);
};

/**
 * The clipboard's image, cropped to the picture's shape, as a local file.
 * Null when there is no image (a toast says so) or the crop was cancelled.
 */
export async function pasteProfileImage(kind: ProfileImageKind, noImageText: string): Promise<string | null> {
  let has = false;
  try {
    has = await Clipboard.hasImageAsync();
  } catch {
    has = false;
  }
  if (!has) {
    toastInfo(noImageText);
    return null;
  }
  const image = await Clipboard.getImageAsync({ format: "jpeg", jpegQuality: 0.95 });
  const data = image?.data || "";
  const base64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  if (!base64) {
    toastInfo(noImageText);
    return null;
  }
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
  const path = `${dir}pasted_${kind}_${Date.now()}.jpg`;
  await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
  try {
    const cropped: any = await ImageCropPicker.openCropper({
      path,
      ...PROFILE_IMAGE_CROP[kind],
      cropping: true,
      cropperCircleOverlay: false,
      compressImageQuality: 0.9,
      forceJpg: true,
      mediaType: "photo",
    } as any);
    return cropped?.path ?? null;
  } catch (e) {
    if (isCancel(e)) return null;
    throw e;
  }
}

export interface ProfileImageMenuTarget {
  kind: ProfileImageKind;
  layout: HoldLayout | null;
}

/** Measure the held picture so the sheet can dim around it, then open. */
export function useProfileImageMenu() {
  const [target, setTarget] = useState<ProfileImageMenuTarget | null>(null);
  const avatarRef = useRef<View>(null);
  const coverRef = useRef<View>(null);
  const open = useCallback((kind: ProfileImageKind) => {
    const node = kind === "avatar" ? avatarRef.current : coverRef.current;
    if (!node?.measureInWindow) {
      setTarget({ kind, layout: null });
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setTarget({ kind, layout: Number.isFinite(y) && height > 0 ? { x, y, width, height } : null });
    });
  }, []);
  const close = useCallback(() => setTarget(null), []);
  return { target, open, close, avatarRef, coverRef };
}

interface ProfileImageMenuProps {
  target: ProfileImageMenuTarget | null;
  onClose: () => void;
  /** The profile owner: Change, Paste, Delete. */
  canEdit: boolean;
  /** Full-size picture to copy; undefined hides Copy. */
  imageUrl: (kind: ProfileImageKind) => string | undefined;
  /** A real uploaded picture (not the default art): Delete shows only then. */
  hasImage: (kind: ProfileImageKind) => boolean;
  onChange?: (kind: ProfileImageKind) => void;
  /** A pasted image, already cropped. */
  onPasted?: (kind: ProfileImageKind, uri: string) => void;
  onRemove?: (kind: ProfileImageKind) => void;
  /** Shown first when a tap on the picture does something else (plays their Moment). */
  onView?: (kind: ProfileImageKind) => void;
}

export default function ProfileImageMenu({ target, onClose, canEdit, imageUrl, hasImage, onChange, onPasted, onRemove, onView }: ProfileImageMenuProps) {
  const { t } = useTranslation();
  const kind = target?.kind ?? "avatar";
  const url = target ? imageUrl(kind) : undefined;

  const paste = useCallback(async () => {
    onClose();
    try {
      const uri = await pasteProfileImage(kind, t("feed.noImagesFound"));
      if (uri) onPasted?.(kind, uri);
    } catch (e) {
      toastError(e, t("converter.errorClipboard"));
    }
  }, [kind, onClose, onPasted, t]);

  const tiles: HoldTile[] = [];
  if (onView && url) {
    tiles.push({ key: "view", icon: "Image", label: t("profileImage.view", { defaultValue: "View photo" }), prime: !canEdit, onPress: () => { onClose(); onView(kind); } });
  }
  if (canEdit && onChange) {
    tiles.push({ key: "change", icon: "ImagePlus", label: t("profileImage.change"), prime: true, onPress: () => { onClose(); onChange(kind); } });
  }
  if (canEdit && onPasted) {
    tiles.push({ key: "paste", icon: "ClipboardPaste", label: t("common.paste"), onPress: () => { void paste(); } });
  }
  if (url) {
    tiles.push({ key: "copy", icon: "Copy", label: t("common.copy"), onPress: () => { onClose(); void copyImage(url); } });
  }
  if (canEdit && onRemove && target && hasImage(kind)) {
    tiles.push({ key: "delete", icon: "Trash2", label: t("common.delete"), destructive: true, onPress: () => { onClose(); onRemove(kind); } });
  }

  return (
    <HoldSheet
      visible={!!target && tiles.length > 0}
      layout={target?.layout ?? null}
      onClose={onClose}
      reactions={null}
      tiles={tiles}
    />
  );
}
