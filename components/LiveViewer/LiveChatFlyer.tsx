import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, type LayoutChangeEvent } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Avatar from "../common/Avatar";
import { TEXT_SHADOW } from "../common/ViewerChrome";
import { finishFlight, markArrived, measureChatAnchor, subscribeFlight, type Flight } from "../../libs/liveChatFlight";
import { BoldText } from "../../libs/bold-markup";

/** The house travel curve, 440ms: the same flight as the web chat. */
const TRAVEL = Easing.bezier(0.45, 0, 0.1, 1);
const DURATION = 440;
/** A chat line's avatar (20) and its gap (6): where its words start. */
const WORDS_X = 26;

interface Props {
  /** Your name and face, drawn exactly as your line in the chat draws them. */
  name: string;
  nameColor: string;
  avatarUri?: string;
}

/**
 * Your line on its way from the box into the chat. Lies over the whole player
 * (absolute fill, no touches); see libs/liveChatFlight.
 */
export default function LiveChatFlyer({ name, nameColor, avatarUri }: Props) {
  const layerRef = useRef<View>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [width, setWidth] = useState(0);
  const origin = useRef({ x: 0, y: 0 });
  const started = useRef<number | null>(null);
  const finishing = useRef<number | null>(null);
  const p = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const shown = useSharedValue(0);

  useEffect(() => subscribeFlight((f) => {
    setFlight(f && !f.done ? f : null);
    if (!f || f.done) return;
    // The real line is drawn: land exactly on it.
    if (f.row && started.current === f.id) {
      tx.value = withTiming(f.row.x - origin.current.x, { duration: 160 });
      ty.value = withTiming(f.row.y - origin.current.y, { duration: 160 });
    }
    if (f.arrived && f.row && finishing.current !== f.id) {
      finishing.current = f.id;
      const id = f.id;
      setTimeout(() => { shown.value = 0; finishFlight(id); }, 170);
    }
  }), [shown, tx, ty]);

  // Nothing lands within a few seconds (the send failed): the copy fades out.
  useEffect(() => {
    if (!flight) return;
    const id = flight.id;
    const timer = setTimeout(() => {
      shown.value = withTiming(0, { duration: 200 });
      setTimeout(() => finishFlight(id), 220);
    }, 5000);
    return () => clearTimeout(timer);
  }, [flight?.id, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const onCopyLayout = useCallback((e: LayoutChangeEvent) => {
    const f = flight;
    if (!f || started.current === f.id) return;
    const h = e.nativeEvent.layout.height;
    started.current = f.id;
    layerRef.current?.measureInWindow((ox, oy) => {
      origin.current = { x: ox, y: oy };
      measureChatAnchor((anchor) => {
        sx.value = f.from.x - WORDS_X - ox;
        sy.value = f.from.y - oy;
        tx.value = (anchor ? anchor.x : f.from.x - WORDS_X) - ox;
        ty.value = (anchor ? anchor.y - h : f.from.y - 80) - oy;
        p.value = 0;
        shown.value = 1;
        const id = f.id;
        p.value = withTiming(1, { duration: DURATION, easing: TRAVEL }, (done) => {
          if (done) runOnJS(markArrived)(id);
        });
      });
    });
  }, [flight, p, shown, sx, sy, tx, ty]);

  useEffect(() => {
    if (!flight) return;
    // The copy is drawn at the line's own width, so it wraps exactly as the
    // line will; it waits for that one measure (-1: no chat to measure).
    measureChatAnchor((a) => setWidth(a?.width ? a.width : -1));
  }, [flight?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyStyle = useAnimatedStyle(() => ({
    opacity: shown.value * Math.min(1, 0.35 + p.value * 6.5),
    transform: [
      { translateX: sx.value + (tx.value - sx.value) * p.value },
      { translateY: sy.value + (ty.value - sy.value) * p.value },
    ],
  }));
  // Face arrives with the words, not before them.
  const faceStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, Math.min(1, (p.value - 0.3) / 0.45)) }));

  return (
    <View ref={layerRef} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {flight && width !== 0 ? (
        <Animated.View
          key={flight.id}
          onLayout={onCopyLayout}
          style={[styles.copy, width > 0 ? { maxWidth: width * 0.92 } : null, copyStyle]}
        >
          <Animated.View style={[styles.face, faceStyle]}>
            <Avatar uri={avatarUri} size={20} name={name} />
          </Animated.View>
          <View style={styles.words}>
            <Text style={styles.text}>
              <Text style={[styles.name, { color: nameColor }]}>{name} </Text>
              <BoldText text={flight.text} />
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { position: "absolute", left: 0, top: 0, flexDirection: "row", alignItems: "flex-start", opacity: 0 },
  face: { marginRight: 6, marginTop: 2 },
  words: { flexShrink: 1 },
  text: { color: "#FFFFFF", fontSize: 13, lineHeight: 18, ...TEXT_SHADOW },
  name: { fontWeight: "700" },
});
