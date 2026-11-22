/** Photo looks and the background behind wide photos in a moment (no Skia here). */
import { DEFAULT_ADJUST, studioColorMatrix } from "../../libs/imageFilters";

/** Same keys as web's PHOTO_LOOKS, drawn with the photo studio's matrices. */
export const PHOTO_LOOKS = {
  none: "normal",
  warm: "valencia",
  cool: "perpetua",
  vivid: "clarendon",
  fade: "reyes",
  mono: "moon",
  noir: "inkwell",
  retro: "nashville",
} as const;
export type PhotoLook = keyof typeof PHOTO_LOOKS;

export const PHOTO_BACKDROPS = {
  blur: null,
  black: ["#000000", "#000000"],
  dusk: ["#a391fc", "#f39bff"],
  sunset: ["#ff6fb1", "#ffb36b"],
  ocean: ["#7fe3e0", "#3a7bd5"],
  forest: ["#1f4037", "#99f2c8"],
} as const;
export type PhotoBackdrop = keyof typeof PHOTO_BACKDROPS;

export function lookMatrix(look: PhotoLook): number[] | null {
  return look === "none" ? null : studioColorMatrix(PHOTO_LOOKS[look], 100, DEFAULT_ADJUST);
}
