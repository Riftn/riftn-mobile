import { Platform } from "react-native";

// Use installed faces so captions render offline in both the editor and the exported media.
export const CAPTION_FONTS = {
  classic: { label: "Classic", fontFamily: Platform.OS === "ios" ? "Helvetica Neue" : "sans-serif", fontWeight: "700", fontStyle: "normal" },
  minimal: { label: "Minimal", fontFamily: Platform.OS === "ios" ? "Avenir Next" : "sans-serif-light", fontWeight: "300", fontStyle: "normal" },
  groove: { label: "Groove", fontFamily: Platform.OS === "ios" ? "Gill Sans" : "sans-serif", fontWeight: "400", fontStyle: "italic" },
  poster: { label: "Poster", fontFamily: Platform.OS === "ios" ? "Avenir Next Condensed" : "sans-serif-condensed", fontWeight: "900", fontStyle: "normal" },
  book: { label: "Book", fontFamily: Platform.OS === "ios" ? "Georgia" : "serif", fontWeight: "400", fontStyle: "normal" },
  editorial: { label: "Editorial", fontFamily: Platform.OS === "ios" ? "Baskerville" : "serif", fontWeight: "400", fontStyle: "italic" },
  headline: { label: "Headline", fontFamily: Platform.OS === "ios" ? "Times New Roman" : "serif", fontWeight: "700", fontStyle: "normal" },
  mono: { label: "Mono", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontWeight: "400", fontStyle: "normal" },
  terminal: { label: "Terminal", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontWeight: "700", fontStyle: "normal" },
  typewriter: { label: "Typewriter", fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", fontWeight: "400", fontStyle: "italic" },
  marker: { label: "Marker", fontFamily: Platform.OS === "ios" ? "Marker Felt" : "casual", fontWeight: "700", fontStyle: "italic" },
  script: { label: "Script", fontFamily: Platform.OS === "ios" ? "Snell Roundhand" : "cursive", fontWeight: "400", fontStyle: "normal" },
} as const;

export type CaptionFont = keyof typeof CAPTION_FONTS;
export const captionFonts = Object.keys(CAPTION_FONTS) as CaptionFont[];

export function captionFontStyle(font: CaptionFont = "classic") {
  const { fontFamily, fontWeight, fontStyle } = CAPTION_FONTS[font] ?? CAPTION_FONTS.classic;
  return { fontFamily, fontWeight, fontStyle };
}
