/**
 * One animated chat emoji (libs/chatReactionEmoji) that can hold its first
 * frame, play exactly once and say when it is done. That is what lets a
 * reaction fly in holding still, play all the way through in its chip, and
 * hand back to the plain emoji on its last frame instead of mid-motion.
 *
 * Drawn with Skia when this build has it (frame-exact, see SkiaEmojiClip).
 * Builds without Skia use the image view: it starts on `play` and its end is
 * timed from that moment with the file's known length.
 */
import React, { memo, useEffect, useRef, useState } from "react";
import { Image } from "expo-image";
import { optionalSkia } from "../../libs/skia";

export interface EmojiClipProps {
  uri: string;
  /** Length of one run, for the build without Skia. */
  ms: number;
  size: number;
  /** false holds the first frame; true plays once from it. */
  play: boolean;
  /** The first frame is on screen. */
  onReady?: () => void;
  /** The run has reached its end. */
  onEnd?: () => void;
}

const skia = optionalSkia(() => require("./SkiaEmojiClip") as typeof import("./SkiaEmojiClip"));

/** Fetch an emoji's file ahead of its first play. */
export function warmEmojiClip(uri: string): void {
  if (skia) skia.warmSkiaEmojiClip(uri);
  else void Image.prefetch(uri, "memory-disk").catch(() => false);
}

const ImageEmojiClip = memo(function ImageEmojiClip({ uri, ms, size, play, onReady, onEnd }: EmojiClipProps) {
  const ref = useRef<Image>(null);
  const [loaded, setLoaded] = useState(false);
  const calls = useRef({ onReady, onEnd });
  calls.current = { onReady, onEnd };
  useEffect(() => {
    if (!play || !loaded) return;
    void ref.current?.startAnimating()?.catch?.(() => {});
    const t = setTimeout(() => calls.current.onEnd?.(), ms);
    return () => clearTimeout(t);
  }, [play, loaded, ms]);
  return (
    <Image
      ref={ref}
      source={{ uri }}
      autoplay={false}
      cachePolicy="memory-disk"
      contentFit="contain"
      style={{ width: size, height: size }}
      onLoad={() => { setLoaded(true); calls.current.onReady?.(); }}
    />
  );
});

export const EmojiClip = memo(function EmojiClip(props: EmojiClipProps) {
  const [plain, setPlain] = useState(!skia);
  if (skia && !plain) {
    const { SkiaEmojiClip } = skia;
    return <SkiaEmojiClip uri={props.uri} size={props.size} play={props.play} onReady={props.onReady} onEnd={props.onEnd} onError={() => setPlain(true)} />;
  }
  return <ImageEmojiClip {...props} />;
});
