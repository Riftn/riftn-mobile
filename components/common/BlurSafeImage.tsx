import React, { useCallback, useEffect, useState } from "react";
import { Image as ExpoImage, type ImageProps } from "expo-image";
import { Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { optionalSkia } from "../../libs/skia";
import { storageImage } from "../../libs/cdnImage";

const Bake = Platform.OS === "android"
  ? optionalSkia(() => require("../../libs/skiaBlurBake") as typeof import("../../libs/skiaBlurBake"))
  : null;

/**
 * Blurred pictures that can't crash Android.
 *
 * expo-image blurs on Android with RenderScript (glide-transformations), and
 * RenderScript is gone on new Android builds: a Galaxy S24+ crashed natively
 * (null pointer in libRSDriver on Glide's thread) while scrolling a profile
 * with audio tiles. That crash can't be caught from Java or JS.
 *
 * On Android the picture is instead drawn a few dozen pixels wide and scaled
 * up on the GPU, which softens it like a blur. It stays on expo-image, so it
 * comes straight from the cache the feed already filled: a first try that
 * re-fetched through React Native's Image left the Shorts backdrop empty for
 * the first frames of every open. iOS and unblurred pictures are unchanged.
 *
 * That stretched copy is only the first frame: on builds with Skia, a real
 * Gaussian blur is baked once (libs/skiaBlurBake) and replaces it, because
 * the stretch alone showed blocks and creases instead of a soft blur.
 */

/** The remote or file address of an image source, when it has one. */
export function sourceUri(source: ImageProps["source"]): string | null {
  const one = Array.isArray(source) ? source[0] : source;
  const uri = typeof one === "string" ? one : one && typeof one === "object" && "uri" in one ? (one as { uri?: string }).uri : null;
  return typeof uri === "string" && /^(https?|file|data):/i.test(uri) ? uri : null;
}

/** Width in dp of the small copy: a stronger blur draws it smaller. */
export function blurSampleWidth(boxWidth: number, radius: number): number {
  return Math.max(8, Math.min(64, Math.round((boxWidth * 1.2) / Math.max(4, Math.min(radius, 40)))));
}

export function needsSafeBlur(blurRadius: number | null | undefined): boolean {
  return Platform.OS === "android" && !!blurRadius && blurRadius > 0;
}

type SafeBlurProps = Pick<ImageProps, "source" | "style" | "contentFit" | "blurRadius" | "accessible" | "accessibilityLabel" | "testID" | "cachePolicy"> & {
  onError?: () => void;
  onLoadEnd?: () => void;
};

/** The Android path on its own, for components that already wrap expo-image. */
export function AndroidBlurredImage({ source, style, contentFit = "cover", blurRadius, accessible, accessibilityLabel, testID, cachePolicy, onError, onLoadEnd }: SafeBlurProps) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) => (prev && prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  }, []);
  // Never fall back to the full picture: blur also hides locked media.
  const sample = box && box.w > 0 && box.h > 0 ? blurSampleWidth(box.w, blurRadius ?? 0) : 0;
  const sampleH = sample && box ? (sample * box.h) / box.w : 0;
  const uri = sourceUri(source);
  const fit = contentFit === "contain" ? "contain" : "cover";
  const [baked, setBaked] = useState<{ key: string; uri: string } | null>(null);
  const bakeKey = Bake && uri && box && box.w > 0 && box.h > 0 ? `${uri}|${box.w}|${box.h}|${blurRadius}|${fit}` : null;
  useEffect(() => {
    if (!Bake || !bakeKey || !uri || !box) return;
    let alive = true;
    // A blurred copy needs only a small picture: ask the storage resizer for
    // about twice the baked size instead of decoding the full photo.
    const small = storageImage(uri, Math.max(48, Math.round(box.w * Bake.bakeScale(blurRadius ?? 0) * 2)));
    void Bake.bakeBlur(small, box.w, box.h, blurRadius ?? 0, fit).then((out) => {
      if (alive && out) setBaked({ key: bakeKey, uri: out });
    });
    return () => { alive = false; };
    // bakeKey already carries every input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bakeKey]);
  const ready = baked && baked.key === bakeKey ? baked.uri : null;
  return (
    <View
      style={[style as any, { overflow: "hidden" }]}
      onLayout={onLayout}
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      pointerEvents="none"
    >
      {sample > 0 && box ? (
        <ExpoImage
          source={source}
          contentFit={contentFit}
          cachePolicy={cachePolicy}
          transition={0}
          onError={onError ? () => onError() : undefined}
          onLoadEnd={onLoadEnd}
          style={{
            position: "absolute",
            width: sample,
            height: sampleH,
            left: (box.w - sample) / 2,
            top: (box.h - sampleH) / 2,
            transform: [{ scale: box.w / sample }],
          }}
        />
      ) : null}
      {ready ? (
        <ExpoImage source={{ uri: ready }} contentFit="fill" transition={0} cachePolicy="none" style={StyleSheet.absoluteFill} />
      ) : null}
    </View>
  );
}

/** Drop-in for expo-image's Image wherever it is given a blurRadius. */
export default function BlurSafeImage(props: ImageProps) {
  if (!needsSafeBlur(props.blurRadius)) return <ExpoImage {...props} />;
  const { onError, onLoadEnd } = props;
  return (
    <AndroidBlurredImage
      {...props}
      onError={onError ? () => onError({ error: "load failed" } as any) : undefined}
      onLoadEnd={onLoadEnd ? () => onLoadEnd() : undefined}
    />
  );
}
