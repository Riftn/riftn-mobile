/**
 * What fills the screen around a wide video in the swipe player.
 *
 * `glow`: the picture is mirrored outward from its own top and bottom edges
 * and softened, so the colour at each edge of the video carries on into the
 * fill and there is no line where one stops and the other starts.
 *
 * `floor`: nothing above the video, and under it the picture's mirror image
 * fading out, as if it stood on a polished floor.
 *
 * The playing video itself cannot be drawn from here, so the picture is the
 * storyboard frame for the moment being watched (one every few seconds,
 * cross-faded), or the poster for a clip without a storyboard.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Blur, Canvas, ColorMatrix, Group, Image, LinearGradient, Paint, Rect, rect, useImage, vec, type SkImage } from '@shopify/react-native-skia';
import { Easing, useSharedValue, withTiming } from 'react-native-reanimated';
import { storyboardOffset, type Storyboard } from '../../libs/storyboard';

export type WideFillLook = 'glow' | 'floor';

interface Box { left: number; top: number; width: number; height: number }
interface Frame { image: SkImage; x: number; y: number; w: number; h: number; key: string }

const SATURATE = 1.35;
const SATURATION = (() => {
  const s = SATURATE;
  const r = 0.213 * (1 - s), g = 0.715 * (1 - s), b = 0.072 * (1 - s);
  return [r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0];
})();

/** The part of a picture that has the video's shape, taken from its middle. */
function cropTo(image: SkImage, x: number, y: number, w: number, h: number, aspect: number, key: string): Frame {
  const have = w / h;
  if (have > aspect) {
    const cw = h * aspect;
    return { image, x: x + (w - cw) / 2, y, w: cw, h, key };
  }
  const ch = w / aspect;
  return { image, x, y: y + (h - ch) / 2, w, h: ch, key };
}

/** One copy of the frame drawn into `box`, upside down when `flipped`. */
function Tile({ frame, box, flipped }: { frame: Frame; box: Box; flipped: boolean }) {
  const sx = box.width / frame.w;
  const sy = box.height / frame.h;
  const picture = (
    <Group
      clip={rect(box.left, box.top, box.width, box.height)}
      transform={[{ translateX: box.left - frame.x * sx }, { translateY: box.top - frame.y * sy }, { scaleX: sx }, { scaleY: sy }]}
    >
      <Image image={frame.image} x={0} y={0} width={frame.image.width()} height={frame.image.height()} fit="fill" />
    </Group>
  );
  if (!flipped) return picture;
  return <Group transform={[{ translateY: 2 * box.top + box.height }, { scaleY: -1 }]}>{picture}</Group>;
}

function GlowTiles({ frame, picture, height }: { frame: Frame; picture: Box; height: number }) {
  const tiles: React.ReactNode[] = [<Tile key="0" frame={frame} box={picture} flipped={false} />];
  for (let k = 1, top = picture.top - picture.height; top > -picture.height && k < 6; k++, top -= picture.height) {
    tiles.push(<Tile key={`u${k}`} frame={frame} box={{ ...picture, top }} flipped={k % 2 === 1} />);
  }
  for (let k = 1, top = picture.top + picture.height; top < height && k < 6; k++, top += picture.height) {
    tiles.push(<Tile key={`d${k}`} frame={frame} box={{ ...picture, top }} flipped={k % 2 === 1} />);
  }
  return <>{tiles}</>;
}

interface Props {
  look: WideFillLook;
  width: number;
  height: number;
  /** Where the video sits inside the frame. */
  picture: Box;
  poster?: string | null;
  storyboard?: Storyboard;
  /** The player to follow; only read while `live`. */
  player?: { currentTime?: number } | null;
  live: boolean;
}

export default function WideVideoFill({ look, width, height, picture, poster, storyboard, player, live }: Props) {
  const posterImage = useImage(poster || undefined);
  const sheet = useImage(storyboard?.url);
  const [second, setSecond] = useState(0);

  const step = storyboard?.spriteDuration ?? 0;
  useEffect(() => {
    if (!live || !player || !(step > 0)) return;
    const read = () => {
      let now = 0;
      try { now = player.currentTime ?? 0; } catch {}
      const slot = Math.floor(now / step) * step;
      setSecond(prev => (prev === slot ? prev : slot));
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [live, player, step]);

  const aspect = picture.height > 0 ? picture.width / picture.height : 0;
  const frame = useMemo<Frame | null>(() => {
    if (!(aspect > 0)) return null;
    if (sheet && storyboard) {
      const at = storyboardOffset(storyboard, second);
      return cropTo(sheet, at.x, at.y, storyboard.spriteWidth, storyboard.spriteHeight, aspect, `s${at.x}:${at.y}`);
    }
    if (posterImage) return cropTo(posterImage, 0, 0, posterImage.width(), posterImage.height(), aspect, 'poster');
    return null;
  }, [aspect, sheet, storyboard, second, posterImage]);

  // The frame before this one stays underneath while the new one fades in.
  const [shown, setShown] = useState<{ under: Frame | null; over: Frame | null }>({ under: null, over: null });
  const mix = useSharedValue(1);
  useEffect(() => {
    if (!frame) return;
    setShown(prev => {
      if (prev.over?.key === frame.key && prev.over.image === frame.image) return prev;
      return { under: prev.over, over: frame };
    });
  }, [frame]);
  useEffect(() => {
    if (!shown.over) return;
    mix.value = 0;
    mix.value = withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) });
  }, [shown, mix]);

  if (!(width > 0) || !(height > 0) || !(picture.height > 0) || !shown.over) return null;

  if (look === 'floor') {
    const floor = picture.top + picture.height;
    if (height - floor < 1) return null;
    const mirror: Box = { ...picture, top: floor };
    return (
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        {shown.under ? <Tile frame={shown.under} box={mirror} flipped /> : null}
        <Group opacity={mix}><Tile frame={shown.over} box={mirror} flipped /></Group>
        <Rect x={0} y={floor} width={width} height={height - floor}>
          <LinearGradient start={vec(0, floor)} end={vec(0, floor + picture.height * 0.8)} colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,1)']} />
        </Rect>
        {/* The edge of the floor catches a little light. */}
        <Rect x={picture.left} y={floor} width={picture.width} height={StyleSheet.hairlineWidth} color="rgba(255,255,255,0.22)" />
      </Canvas>
    );
  }

  const soften = (fading: boolean) => (
    <Paint opacity={fading ? mix : 1}>
      <Blur blur={Math.max(18, width * 0.07)} mode="clamp" />
      <ColorMatrix matrix={SATURATION} />
    </Paint>
  );
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {shown.under ? <Group layer={soften(false)}><GlowTiles frame={shown.under} picture={picture} height={height} /></Group> : null}
      <Group layer={soften(true)}><GlowTiles frame={shown.over} picture={picture} height={height} /></Group>
      {/* Deepens only the far top and bottom, where the buttons and caption sit. */}
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height)}
          positions={[0, 0.3, 0.5, 0.7, 1]}
          colors={['rgba(0,0,0,0.34)', 'rgba(0,0,0,0.04)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.04)', 'rgba(0,0,0,0.4)']}
        />
      </Rect>
    </Canvas>
  );
}
