/**
 * One animated emoji, stepped frame by frame with Skia. Skia only: load it
 * through `optionalSkia` (see EmojiClip.tsx, which also holds the fallback).
 *
 * An image view plays an animated file on its own clock and never says where
 * it is, so "play once, then show the still emoji" used to be a timer
 * guessing when the picture ended. Here the frames are ours: the first one is
 * held until `play`, each next one is shown when its time comes (late frames
 * are caught up, so a busy moment cannot stretch the run), and `onEnd` fires
 * after the last frame has had its full time on screen.
 */
import React, { memo, useEffect, useRef, useState } from "react";
import { Canvas, Image, Skia, type SkAnimatedImage, type SkData, type SkImage } from "@shopify/react-native-skia";

export interface SkiaEmojiClipProps {
  uri: string;
  size: number;
  /** false holds the first frame; true plays once from it and rests on the last. */
  play: boolean;
  /** The first frame is on screen. */
  onReady?: () => void;
  /** The last frame has been shown for its full time. */
  onEnd?: () => void;
  /** The file could not be read or drawn: the caller falls back. */
  onError?: () => void;
}

/** Downloaded files, kept for the session so a second play starts at once. */
const files = new Map<string, Promise<SkData | null>>();
const MAX_FILES = 40;

function loadFile(uri: string): Promise<SkData | null> {
  let p = files.get(uri);
  if (!p) {
    p = Skia.Data.fromURI(uri).then((d) => d ?? null).catch(() => null);
    files.set(uri, p);
    void p.then((d) => { if (!d) files.delete(uri); });
    if (files.size > MAX_FILES) files.delete(files.keys().next().value!);
  }
  return p;
}

/** Fetch a file ahead of its first play (no drawing). */
export function warmSkiaEmojiClip(uri: string): void {
  void loadFile(uri);
}

/** Frames kept alive behind the one on screen, so one still being drawn is never freed under it. */
const KEEP_FRAMES = 3;
const MIN_FRAME_MS = 10;

export const SkiaEmojiClip = memo(function SkiaEmojiClip({ uri, size, play, onReady, onEnd, onError }: SkiaEmojiClipProps) {
  const [anim, setAnim] = useState<SkAnimatedImage | null>(null);
  const [frame, setFrame] = useState<SkImage | null>(null);
  const calls = useRef({ onReady, onEnd, onError });
  calls.current = { onReady, onEnd, onError };
  const shown = useRef<SkImage | null>(null);
  const old = useRef<SkImage[]>([]);

  useEffect(() => {
    let live = true;
    void loadFile(uri).then((data) => {
      if (!live) return;
      try {
        const made = data ? Skia.AnimatedImage.MakeAnimatedImageFromEncoded(data) : null;
        const first = made?.getCurrentFrame() ?? null;
        if (!made || !first || made.getFrameCount() < 1) { calls.current.onError?.(); return; }
        shown.current = first;
        setFrame(first);
        setAnim(made);
      } catch {
        calls.current.onError?.();
      }
    });
    return () => { live = false; };
  }, [uri]);

  // Ready once the canvas has had a frame or two to draw the first picture.
  useEffect(() => {
    if (!anim) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => calls.current.onReady?.()); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [anim]);

  useEffect(() => {
    if (!anim || !play) return;
    let raf = 0;
    let stopped = false;
    const count = anim.getFrameCount();
    let index = 0;
    let due = Date.now() + Math.max(MIN_FRAME_MS, anim.currentFrameDuration());
    const finish = () => { stopped = true; calls.current.onEnd?.(); };
    const tick = () => {
      if (stopped) return;
      const now = Date.now();
      try {
        let moved = false;
        while (now >= due && index < count - 1) {
          anim.decodeNextFrame();
          index += 1;
          due += Math.max(MIN_FRAME_MS, anim.currentFrameDuration());
          moved = true;
        }
        if (moved) {
          const next = anim.getCurrentFrame();
          if (next) {
            if (shown.current) old.current.push(shown.current);
            shown.current = next;
            setFrame(next);
            while (old.current.length > KEEP_FRAMES) old.current.shift()?.dispose?.();
          }
        }
      } catch {
        finish();
        return;
      }
      if (index >= count - 1 && now >= due) { finish(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [anim, play]);

  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      {frame ? <Image image={frame} x={0} y={0} width={size} height={size} fit="contain" /> : null}
    </Canvas>
  );
});
