/**
 * Painting: a full-screen canvas opened from the composer's post options.
 * Paint-style tools (pencil, brush, eraser, fill, line, rectangle, ellipse)
 * plus oil, pastel, watercolour and charcoal brushes, from the brush engine
 * shared with the web (libs/painting/engine). Done writes the picture to a
 * file and hands it back, so it posts (and can be minted) like any photo.
 *
 * Black like the photo studio on every theme; the paper is white.
 *
 * Skia-drawn, so only load this through `optionalSkia` (libs/skia).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import Slider from "@react-native-community/slider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Canvas, Group, Image as SkiaImage, Picture, createPicture, type SkImage, type SkSurface } from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import Icon, { type IconName } from "../ui/Icon";
import {
  ART_TOOLS,
  DEFAULT_SIZE,
  PAINT_ASPECTS,
  endStroke,
  PAINT_PALETTE,
  PAPER,
  PaintHistory,
  SIZE_MAX,
  SIZE_MIN,
  hexToHsv,
  hsvToHex,
  isShape,
  moveStroke,
  shapeOp,
  startStroke,
  type PaintAspect,
  type PaintOp,
  type PaintTool,
  type Stroke,
} from "../../libs/painting/engine";
import { clearPaper, drawSkOps, fillAt, makePaper, restore, savePainting, snapshot, type SavedPainting } from "./paintingSkia";
import { toastError } from "../../libs/toast";

interface Props {
  onClose: () => void;
  onDone: (painting: SavedPainting) => void;
}

const WHITE = "#ffffff";
const DIM = "hsla(0, 0%, 100%, 0.6)";
const LINE = "hsla(0, 0%, 100%, 0.16)";
/** Snapshots kept for undo; each is a full frame. */
const UNDO_LIMIT = 10;

const BASIC: { tool: PaintTool; icon: IconName; label: string }[] = [
  { tool: "pencil", icon: "Pencil", label: "painting.tools.pencil" },
  { tool: "brush", icon: "Paintbrush", label: "painting.tools.brush" },
  { tool: "eraser", icon: "Eraser", label: "painting.tools.eraser" },
  { tool: "fill", icon: "PaintBucket", label: "painting.tools.fill" },
  { tool: "line", icon: "Slash", label: "painting.tools.line" },
  { tool: "rect", icon: "Square", label: "painting.tools.rect" },
  { tool: "ellipse", icon: "Circle", label: "painting.tools.ellipse" },
];
const ASPECTS: PaintAspect[] = ["portrait", "square", "wide"];

function ToolButton({ icon, on, onPress, label, disabled }: { icon: IconName; on?: boolean; onPress: () => void; label: string; disabled?: boolean }) {
  return (
    <Pressable
      className="dark-surface"
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!on, disabled: !!disabled }}
      style={{ opacity: disabled ? 0.35 : 1 }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: on ? "hsla(0, 0%, 100%, 0.5)" : LINE, backgroundColor: on ? "hsla(0, 0%, 100%, 0.2)" : "hsla(0, 0%, 100%, 0.05)" }}>
        <Icon name={icon} size={18} color={on ? WHITE : "hsla(0, 0%, 100%, 0.8)"} />
      </View>
    </Pressable>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable className="dark-surface" onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <View style={{ height: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", borderWidth: 1, borderColor: on ? WHITE : LINE, backgroundColor: on ? WHITE : "transparent" }}>
        <Text style={{ color: on ? "#000" : DIM, fontSize: 12, fontWeight: on ? "700" : "500" }}>{label}</Text>
      </View>
    </Pressable>
  );
}

export default function PaintingStudio({ onClose, onDone }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [tool, setTool] = useState<PaintTool>("brush");
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [fillShape, setFillShape] = useState(false);
  const [aspect, setAspect] = useState<PaintAspect>("portrait");
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<SkImage | null>(null);
  const [preview, setPreview] = useState<PaintOp | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hsv, setHsv] = useState(() => hexToHsv("#000000"));
  const [saving, setSaving] = useState(false);
  const [, setVersion] = useState(0);

  const surfaceRef = useRef<SkSurface | null>(null);
  const historyRef = useRef<PaintHistory<SkImage> | null>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const shapeRef = useRef<{ x: number; y: number; ex: number; ey: number } | null>(null);
  const frameReq = useRef<number | null>(null);

  const { w: W, h: H } = PAINT_ASPECTS[aspect];
  const bump = () => setVersion((v) => v + 1);

  // White paper at the chosen size; a new size starts a new painting.
  useEffect(() => {
    const surface = makePaper(W, H);
    surfaceRef.current = surface;
    if (!surface) return;
    const first = snapshot(surface);
    historyRef.current = new PaintHistory(first, UNDO_LIMIT);
    setFrame(first);
    bump();
  }, [W, H]);

  useEffect(() => () => {
    if (frameReq.current !== null) cancelAnimationFrame(frameReq.current);
  }, []);

  /** Show what is on the paper, at most once a frame. */
  const refresh = useCallback(() => {
    if (frameReq.current !== null) return;
    frameReq.current = requestAnimationFrame(() => {
      frameReq.current = null;
      const surface = surfaceRef.current;
      if (surface) setFrame(snapshot(surface));
    });
  }, []);

  const commit = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface || !historyRef.current) return;
    const shot = snapshot(surface);
    historyRef.current.push(shot);
    setFrame(shot);
    bump();
  }, []);

  const step = (dir: "undo" | "redo") => {
    const surface = surfaceRef.current;
    const history = historyRef.current;
    if (!surface || !history) return;
    const target = dir === "undo" ? history.undo() : history.redo();
    if (!target) return;
    restore(surface, target);
    setFrame(target);
    bump();
  };

  const clear = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    clearPaper(surface);
    commit();
  };

  const canUndo = !!historyRef.current?.canUndo;
  const canRedo = !!historyRef.current?.canRedo;
  const blank = !canUndo;

  const cancel = () => {
    if (!canUndo) {
      onClose();
      return;
    }
    Alert.alert(t("painting.discardTitle"), undefined, [
      { text: t("painting.keep"), style: "cancel" },
      { text: t("painting.discard"), style: "destructive", onPress: onClose },
    ]);
  };

  const done = async () => {
    const surface = surfaceRef.current;
    if (!surface || saving) return;
    setSaving(true);
    try {
      onDone(await savePainting(surface, W, H));
    } catch {
      toastError(t("painting.saveFailed"));
      setSaving(false);
    }
  };

  // ── paper size on screen ──
  const onArea = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
  };
  const box = useMemo(() => {
    if (!area) return null;
    const pad = 12;
    const k = Math.min((area.w - pad * 2) / W, (area.h - pad * 2) / H);
    if (!(k > 0)) return null;
    return { w: Math.floor(W * k), h: Math.floor(H * k), k: Math.floor(W * k) / W };
  }, [area, W, H]);

  // ── touch ──
  const pointOf = (e: GestureResponderEvent) => {
    const k = box?.k ?? 1;
    return { x: e.nativeEvent.locationX / k, y: e.nativeEvent.locationY / k };
  };
  // Apple Pencil (and 3D Touch) report pressure; Android fingers report noise.
  const pressureOf = (e: GestureResponderEvent) => {
    const force = (e.nativeEvent as { force?: number }).force;
    return Platform.OS === "ios" && typeof force === "number" && force > 0 ? force : 1;
  };

  const onGrant = (e: GestureResponderEvent) => {
    const surface = surfaceRef.current;
    if (!surface || !box) return;
    const p = pointOf(e);
    if (tool === "fill") {
      if (fillAt(surface, W, H, p.x, p.y, color)) commit();
      return;
    }
    if (isShape(tool)) {
      shapeRef.current = { x: p.x, y: p.y, ex: p.x, ey: p.y };
      return;
    }
    const { stroke, ops } = startStroke(tool, color, size, p.x, p.y, pressureOf(e), Math.floor(Math.random() * 2 ** 31));
    strokeRef.current = stroke;
    drawSkOps(surface.getCanvas(), ops);
    refresh();
  };

  const onMove = (e: GestureResponderEvent) => {
    const p = pointOf(e);
    const shape = shapeRef.current;
    if (shape) {
      shape.ex = p.x;
      shape.ey = p.y;
      setPreview(shapeOp(tool, shape.x, shape.y, p.x, p.y, size, color, fillShape));
      return;
    }
    const stroke = strokeRef.current;
    const surface = surfaceRef.current;
    if (!stroke || !surface) return;
    const ops = moveStroke(stroke, p.x, p.y, pressureOf(e));
    if (!ops.length) return;
    drawSkOps(surface.getCanvas(), ops);
    refresh();
  };

  const onEnd = () => {
    const surface = surfaceRef.current;
    const shape = shapeRef.current;
    shapeRef.current = null;
    if (shape && surface) {
      setPreview(null);
      const op = shapeOp(tool, shape.x, shape.y, shape.ex, shape.ey, size, color, fillShape);
      if (op) {
        drawSkOps(surface.getCanvas(), [op]);
        commit();
      }
      return;
    }
    const stroke = strokeRef.current;
    if (stroke && surface) {
      strokeRef.current = null;
      const tail = endStroke(stroke);
      if (tail.length) drawSkOps(surface.getCanvas(), tail);
      if (frameReq.current !== null) {
        cancelAnimationFrame(frameReq.current);
        frameReq.current = null;
      }
      commit();
    }
  };

  const previewPicture = useMemo(
    () => (preview ? createPicture((c) => drawSkOps(c, [preview]), { width: W, height: H }) : null),
    [preview, W, H],
  );

  const pickColor = (c: string) => {
    setColor(c);
    setHsv(hexToHsv(c));
  };
  const setHsvPart = (part: Partial<typeof hsv>) => {
    const next = { ...hsv, ...part };
    setHsv(next);
    setColor(hsvToHex(next.h, next.s, next.v));
  };

  const dot = Math.max(2, Math.min(36, (tool === "pencil" ? Math.max(1, size / 4) : size) * (box?.k ?? 0.35)));
  const custom = !PAINT_PALETTE.includes(color.toLowerCase());

  return (
    <Modal visible animationType="slide" statusBarTranslucent onRequestClose={cancel}>
      <View className="flex-1 bg-black dark-surface" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        {/* Top bar */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
          <Pressable className="dark-surface" onPress={cancel} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("painting.close")}>
            <View style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
              <Icon name="X" size={20} color="hsla(240, 5%, 65%, 1)" />
            </View>
          </Pressable>
          <Text style={{ flex: 1, color: WHITE, fontSize: 14, fontWeight: "600" }}>{t("painting.title")}</Text>
          <ToolButton icon="Undo2" onPress={() => step("undo")} disabled={!canUndo} label={t("painting.undo")} />
          <ToolButton icon="Redo2" onPress={() => step("redo")} disabled={!canRedo} label={t("painting.redo")} />
          <Pressable className="dark-surface" onPress={done} disabled={saving || blank} accessibilityRole="button" accessibilityLabel={t("painting.done")} accessibilityState={{ disabled: saving || blank }}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: WHITE, minWidth: 64, alignItems: "center", opacity: blank ? 0.5 : 1 }}>
              {saving ? <ActivityIndicator size="small" color="#000" /> : <Text style={{ color: "#000", fontSize: 13, fontWeight: "600" }}>{t("painting.done")}</Text>}
            </View>
          </Pressable>
        </View>

        {blank && (
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, paddingBottom: 4 }} accessibilityLabel={t("painting.shape")}>
            {ASPECTS.map((a) => (
              <Pressable key={a} className="dark-surface" onPress={() => setAspect(a)} accessibilityRole="button" accessibilityState={{ selected: aspect === a }}>
                <View style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: aspect === a ? "hsla(0, 0%, 100%, 0.6)" : LINE, backgroundColor: aspect === a ? "hsla(0, 0%, 100%, 0.15)" : "transparent" }}>
                  <Text style={{ color: aspect === a ? WHITE : DIM, fontSize: 11 }}>{t(`painting.aspect.${a}`)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* Paper */}
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} onLayout={onArea}>
          {box && frame ? (
            <View
              style={{ width: box.w, height: box.h, backgroundColor: PAPER }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
              onResponderGrant={onGrant}
              onResponderMove={onMove}
              onResponderRelease={onEnd}
              onResponderTerminate={onEnd}
              accessibilityLabel={t("painting.title")}
            >
              <Canvas style={{ width: box.w, height: box.h }} pointerEvents="none">
                <SkiaImage image={frame} x={0} y={0} width={box.w} height={box.h} fit="fill" />
                {previewPicture ? (
                  <Group transform={[{ scale: box.k }]}>
                    <Picture picture={previewPicture} />
                  </Group>
                ) : null}
              </Canvas>
            </View>
          ) : (
            <ActivityIndicator color={WHITE} />
          )}
        </View>

        {/* Tools */}
        <View style={{ paddingTop: 8, paddingBottom: 8, gap: 10 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 6, alignItems: "center" }}>
            {BASIC.map((b) => (
              <ToolButton key={b.tool} icon={b.icon} on={tool === b.tool} onPress={() => setTool(b.tool)} label={t(b.label)} />
            ))}
            <View style={{ width: 1, height: 24, backgroundColor: LINE, marginHorizontal: 4 }} />
            {ART_TOOLS.map((id) => (
              <Chip key={id} label={t(`painting.tools.${id}`)} on={tool === id} onPress={() => setTool(id)} />
            ))}
          </ScrollView>

          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 10 }}>
            <View style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: dot, height: dot, borderRadius: dot, borderWidth: 1, borderColor: "hsla(0, 0%, 100%, 0.3)", backgroundColor: tool === "eraser" ? PAPER : color }} />
            </View>
            <Text style={{ color: DIM, fontSize: 11 }}>{t("painting.size")}</Text>
            <Slider
              style={{ flex: 1, height: 36 }}
              minimumValue={SIZE_MIN}
              maximumValue={SIZE_MAX}
              step={1}
              value={size}
              onValueChange={(v) => setSize(Math.round(v))}
              minimumTrackTintColor={WHITE}
              maximumTrackTintColor="hsla(0, 0%, 100%, 0.25)"
              thumbTintColor={WHITE}
              accessibilityLabel={t("painting.size")}
            />
            {(tool === "rect" || tool === "ellipse") && <Chip label={t("painting.fillShape")} on={fillShape} onPress={() => setFillShape((v) => !v)} />}
            <ToolButton icon="Trash2" onPress={clear} disabled={blank} label={t("painting.clear")} />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4, gap: 8, alignItems: "center" }}>
            {PAINT_PALETTE.map((c) => (
              <Pressable
                key={c}
                className="dark-surface"
                onPress={() => pickColor(c)}
                accessibilityRole="button"
                accessibilityLabel={t("painting.colour")}
                accessibilityState={{ selected: color.toLowerCase() === c }}
                style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: 2, borderColor: color.toLowerCase() === c ? WHITE : "hsla(0, 0%, 100%, 0.2)", transform: [{ scale: color.toLowerCase() === c ? 1.1 : 1 }] }}
              />
            ))}
            <Pressable
              className="dark-surface"
              onPress={() => { setHsv(hexToHsv(color)); setPickerOpen((v) => !v); }}
              accessibilityRole="button"
              accessibilityLabel={t("painting.customColour")}
              accessibilityState={{ expanded: pickerOpen, selected: custom }}
            >
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: custom || pickerOpen ? WHITE : "hsla(0, 0%, 100%, 0.2)", backgroundColor: custom ? color : "hsla(0, 0%, 100%, 0.08)" }}>
                <Icon name="Palette" size={16} color={WHITE} />
              </View>
            </Pressable>
          </ScrollView>

          {pickerOpen && (
            <View style={{ paddingHorizontal: 16, gap: 2 }}>
              {(
                [
                  { key: "h", label: t("painting.hue"), max: 360, value: hsv.h, track: hsvToHex(hsv.h, 1, 1) },
                  { key: "s", label: t("painting.saturation"), max: 1, value: hsv.s, track: hsvToHex(hsv.h, 1, Math.max(0.4, hsv.v)) },
                  { key: "v", label: t("painting.brightness"), max: 1, value: hsv.v, track: hsvToHex(hsv.h, hsv.s, 1) },
                ] as const
              ).map((row) => (
                <View key={row.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text style={{ color: DIM, fontSize: 11, width: 76 }} numberOfLines={1}>{row.label}</Text>
                  <Slider
                    style={{ flex: 1, height: 32 }}
                    minimumValue={0}
                    maximumValue={row.max}
                    value={row.value}
                    onValueChange={(v) => setHsvPart({ [row.key]: v })}
                    minimumTrackTintColor={row.track}
                    maximumTrackTintColor="hsla(0, 0%, 100%, 0.25)"
                    thumbTintColor={WHITE}
                    accessibilityLabel={row.label}
                  />
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
