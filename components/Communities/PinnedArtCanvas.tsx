/**
 * The pinned community's art behind a profile header, drawn with Skia so it
 * is a real blur on every phone. Android has no safe picture blur
 * (RenderScript is gone), and the stretch-a-tiny-copy stand-in it used came
 * out blocky. Skia only: load it through `optionalSkia`.
 *
 * Mirrors web's pinned-community-stage.css: same blur strengths, boxes and
 * eased (smoothstep) fades, so the two look the same.
 */
import React, { useMemo } from "react";
import { Blur, Canvas, ColorMatrix, Group, Image, LinearGradient, Mask, Rect, useImage, vec, type SkImage } from "@shopify/react-native-skia";

type Box = { x: number; y: number; w: number; h: number };

/** Where `image` sits to cover `box`, with `posY` like CSS background-position y. */
function coverRect(image: SkImage, box: Box, posY: number): Box {
  const scale = Math.max(box.w / image.width(), box.h / image.height());
  const w = image.width() * scale;
  const h = image.height() * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) * posY, w, h };
}

function saturate(s: number): number[] {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0, 0,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

const STEPS = 8;
const ease = (t: number) => t * t * (3 - 2 * t);

/** An eased fade from clear at `from` to solid at `to` (fractions of the height). */
export function easedRamp(from: number, to: number): { colors: string[]; positions: number[] } {
  const colors: string[] = [];
  const positions: number[] = [];
  if (from > 0) { colors.push("rgba(0,0,0,0)"); positions.push(0); }
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    colors.push(`rgba(0,0,0,${ease(t).toFixed(3)})`);
    positions.push(from + (to - from) * t);
  }
  if (to < 1) { colors.push("#000"); positions.push(1); }
  return { colors, positions };
}

function Faded({ width, height, from, to, children }: { width: number; height: number; from: number; to: number; children: React.ReactNode }) {
  const ramp = useMemo(() => easedRamp(from, to), [from, to]);
  return (
    <Mask
      mode="alpha"
      mask={
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={ramp.colors} positions={ramp.positions} />
        </Rect>
      }
    >
      {children}
    </Mask>
  );
}

function Art({ image, box, posY, blur, sat }: { image: SkImage; box: Box; posY: number; blur?: number; sat?: number }) {
  const r = coverRect(image, box, posY);
  return (
    <Image image={image} x={r.x} y={r.y} width={r.w} height={r.h} fit="fill">
      {blur ? <Blur blur={blur} mode="clamp" /> : null}
      {sat && sat !== 1 ? <ColorMatrix matrix={saturate(sat)} /> : null}
    </Image>
  );
}

/** The soft colour wash behind the profile details (the drawing alone). */
export function WashArt({ image, width, height, opacity }: { image: SkImage; width: number; height: number; opacity: number }) {
  // Opaque down to 128 pt above the bottom, then an eased fade out.
  const from = Math.max(0, 1 - 128 / height);
  const colors = ["#000"];
  const positions = [0];
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    colors.push(`rgba(0,0,0,${(1 - ease(t)).toFixed(3)})`);
    positions.push(from + (1 - from) * t);
  }
  return (
    <Mask
      mode="alpha"
      mask={
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient start={vec(0, 0)} end={vec(0, height)} colors={colors} positions={positions} />
        </Rect>
      }
    >
      <Group opacity={opacity}>
        <Art image={image} box={{ x: -64, y: -64, w: width + 128, h: height + 128 }} posY={0.5} blur={52} sat={1.4} />
      </Group>
    </Mask>
  );
}

export function PinnedWashCanvas({ uri, width, height, opacity }: { uri: string; width: number; height: number; opacity: number }) {
  const image = useImage(uri);
  if (!image || width <= 0 || height <= 0) return null;
  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }} pointerEvents="none">
      <WashArt image={image} width={width} height={height} opacity={opacity} />
    </Canvas>
  );
}

/** Height of the art that rises behind the community row. */
export const DISSOLVE_HEIGHT = 210;

/**
 * The art turns sharp gradually toward the community row: heavy, mid and
 * soft blurred copies, then the picture, each fading in a little lower.
 * All copies share one box so their features line up exactly.
 */
export function DissolveArt({ image, width }: { image: SkImage; width: number }) {
  const h = DISSOLVE_HEIGHT;
  const box = { x: -48, y: 0, w: width + 96, h: h + 48 };
  const shade = easedRamp(0.35, 0.8);
  return (
    <Group>
      <Faded width={width} height={h} from={0} to={0.6}>
        <Group opacity={0.7}><Art image={image} box={box} posY={0.6} blur={40} sat={1.35} /></Group>
      </Faded>
      <Faded width={width} height={h} from={0.22} to={0.74}>
        <Art image={image} box={box} posY={0.6} blur={16} sat={1.2} />
      </Faded>
      <Faded width={width} height={h} from={0.36} to={0.8}>
        <Art image={image} box={box} posY={0.6} blur={5} />
      </Faded>
      <Faded width={width} height={h} from={0.5} to={0.92}>
        <Art image={image} box={box} posY={0.6} />
      </Faded>
      {/* Dark behind the community name, clearing to the right. */}
      <Mask
        mode="alpha"
        mask={
          <Rect x={0} y={0} width={width} height={h}>
            <LinearGradient start={vec(0, 0)} end={vec(0, h)} colors={shade.colors} positions={shade.positions} />
          </Rect>
        }
      >
        <Rect x={0} y={0} width={width} height={h}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(width, 0)}
            colors={["rgba(6,4,18,0.86)", "rgba(6,4,18,0.5)", "rgba(6,4,18,0.12)"]}
            positions={[0, 0.45, 1]}
          />
        </Rect>
      </Mask>
    </Group>
  );
}

export function PinnedDissolveCanvas({ uri, width }: { uri: string; width: number }) {
  const image = useImage(uri);
  if (!image || width <= 0) return null;
  return (
    <Canvas style={{ position: "absolute", left: 0, bottom: 0, width, height: DISSOLVE_HEIGHT }} pointerEvents="none">
      <DissolveArt image={image} width={width} />
    </Canvas>
  );
}
