/**
 * The photo in the moment creator with its look and background, drawn the
 * same way the shared file is. Skia-drawn: load only through `optionalSkia`.
 */
import React from "react";
import { Blur, Canvas, ColorMatrix, Image, LinearGradient, Rect, useImage, vec } from "@shopify/react-native-skia";

import { lookMatrix, PHOTO_BACKDROPS, type PhotoBackdrop, type PhotoLook } from "./story-effects";

const DIM = [0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 1, 0];

export default function StoryPhotoPreview({ uri, width, height, look, backdrop }: {
  uri: string; width: number; height: number; look: PhotoLook; backdrop: PhotoBackdrop;
}) {
  const image = useImage(uri);
  const matrix = lookMatrix(look);
  const stops = PHOTO_BACKDROPS[backdrop];
  if (!image) return null;
  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }} pointerEvents="none">
      {stops ? (
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient start={vec(0, 0)} end={vec(width * 0.35, height)} colors={[stops[0], stops[1]]} />
        </Rect>
      ) : (
        <Image image={image} x={0} y={0} width={width} height={height} fit="cover">
          <Blur blur={24} />
          <ColorMatrix matrix={DIM} />
        </Image>
      )}
      <Image image={image} x={0} y={0} width={width} height={height} fit="contain">
        {matrix ? <ColorMatrix matrix={matrix} /> : null}
      </Image>
    </Canvas>
  );
}
