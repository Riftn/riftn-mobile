import React from "react";
import { Animated, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { RtcSurfaceView, RenderModeType, VideoSourceType } from "react-native-agora";
import { useTranslation } from "react-i18next";
import Avatar from "../common/Avatar";
import Icon from "../ui/Icon";
import type { GroupParticipant } from "../../hooks/useCall";
import { createStageDirector, TALK_LEVEL, type TownHallKey, type TownHallState } from "../../libs/townHall";
import { useStage } from "./CallChrome";
import { usePeerIdentity } from "./usePeerIdentity";
import { CallModButton } from "./CallModSheet";

/**
 * Town hall: whoever is talking fills the stage, everyone else sits in the
 * strip underneath. When several people talk at once the loudest has the
 * stage. A new speaker fades in. Tap someone in the strip to pin them to the
 * stage; tap Unpin to let go. The chat's moderators get a ⋯ button on
 * whoever is on stage to mute or remove them.
 */
export interface TownHallProps {
  topInset: number;
  bottomInset: number;
  isVideo: boolean;
  self: { name: string; avatarUrl: string | null; camera: boolean; muted: boolean };
  localCanvas: React.ComponentProps<typeof RtcSurfaceView>["canvas"];
  participants: GroupParticipant[];
  readGroupLevels: () => Map<number, number>;
  /** Set for the chat's moderators: open the menu for someone. */
  onModerate?: (participant: GroupParticipant) => void;
}

const TICK_MS = 90;
const FADE_MS = 240;
const TILE_W = 76;
const TILE_H = 96;

export function TownHall({ topInset, bottomInset, isVideo, self, localCanvas, participants, readGroupLevels, onModerate }: TownHallProps) {
  const { t } = useTranslation();
  const { palette } = useStage();
  const [pinned, setPinned] = React.useState<TownHallKey | null>(null);
  const [state, setState] = React.useState<TownHallState>({ stage: null, talkers: [], cut: 0 });
  const director = React.useMemo(createStageDirector, []);
  const level = React.useRef(new Animated.Value(0)).current;

  const live = React.useRef({ participants, self, pinned, readGroupLevels });
  live.current = { participants, self, pinned, readGroupLevels };

  React.useEffect(() => {
    let previous = "";
    const tick = () => {
      const { participants: people, self: me, pinned: pin, readGroupLevels: read } = live.current;
      const present: TownHallKey[] = [0, ...people.map(person => person.uid)];
      const levels = read();
      for (const person of people) {
        if (!person.audio) levels.set(person.uid, 0);
        else if (!levels.has(person.uid)) levels.set(person.uid, person.speaking ? TALK_LEVEL * 3 : 0);
      }
      if (me.muted) levels.set(0, 0);
      const next = director.update(levels, present, Date.now(), pin);
      if (next.stage != null) {
        Animated.timing(level, { toValue: Math.min(1, (levels.get(next.stage) ?? 0) * 2.4), duration: TICK_MS, useNativeDriver: true }).start();
      }
      const key = `${next.stage}|${next.cut}|${next.talkers.join(",")}`;
      if (key !== previous) { previous = key; setState(next); }
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [director, level]);

  React.useEffect(() => {
    if (pinned != null && pinned !== 0 && !participants.some(person => person.uid === pinned)) setPinned(null);
  }, [participants, pinned]);


  const stage = state.stage ?? participants[0]?.uid ?? 0;
  const talking = new Set(state.talkers);
  const onStage = stage === 0 ? null : participants.find(person => person.uid === stage) ?? null;
  const togglePin = (key: TownHallKey) => setPinned(current => (current === key ? null : key));
  const stageTalking = talking.has(stage);

  return (
    <View style={[styles.root, { paddingTop: topInset, paddingBottom: bottomInset }]}>
      <View
        style={[
          styles.stage,
          { backgroundColor: palette.glass, borderColor: stageTalking ? palette.ring : palette.line, borderWidth: stageTalking ? 2 : 1 },
        ]}
      >
        <FadeIn key={`${stage}-${state.cut}`}>
          {stage === 0 ? (
            <StageShot name={self.name} avatarUrl={self.avatarUrl} level={level}>
              {isVideo && self.camera ? <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={localCanvas} /> : null}
            </StageShot>
          ) : onStage ? (
            <RemoteStageShot participant={onStage} level={level} />
          ) : null}
        </FadeIn>
        <StageName participant={onStage} selfName={stage === 0 ? t("calls.you", { defaultValue: "You" }) : null} muted={stage === 0 ? self.muted : !onStage?.audio} talking={stageTalking} />
        {onModerate && onStage?.wallet ? (
          <CallModButton onPress={() => onModerate(onStage)} label={t("calls.modMenu", { name: "", defaultValue: "Moderate" }).trim()} />
        ) : null}
        {pinned != null ? (
          <Pressable onPress={() => setPinned(null)} style={[styles.topChip, styles.pin]} accessibilityRole="button" hitSlop={8}>
            <Icon name="Pin" size={13} color="#FFFFFF" />
            <Text style={styles.chipText}>{t("calls.unpin", { defaultValue: "Unpin" })}</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripScroll} contentContainerStyle={styles.strip}>
        <StripTile
          name={t("calls.you", { defaultValue: "You" })}
          avatarUrl={self.avatarUrl}
          muted={self.muted}
          talking={talking.has(0)}
          onStage={stage === 0}
          pinned={pinned === 0}
          onPress={() => togglePin(0)}
        >
          {isVideo && self.camera && stage !== 0 ? <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={localCanvas} zOrderMediaOverlay /> : null}
        </StripTile>
        {participants.map(person => (
          <RemoteStripTile
            key={person.uid}
            participant={person}
            talking={talking.has(person.uid)}
            onStage={stage === person.uid}
            pinned={pinned === person.uid}
            onPress={() => togglePin(person.uid)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** A new speaker fades in over the last one. Each one mounts fresh, so it starts unseen. */
function FadeIn({ children }: { children: React.ReactNode }) {
  const opacity = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const run = Animated.timing(opacity, { toValue: 1, duration: FADE_MS, useNativeDriver: true });
    run.start();
    return () => run.stop();
  }, [opacity]);
  return <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>{children}</Animated.View>;
}

function StageShot({ name, avatarUrl, level, children }: { name: string; avatarUrl: string | null; level: Animated.Value; children?: React.ReactNode }) {
  const scale = level.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  return (
    <View style={StyleSheet.absoluteFill}>
      {avatarUrl ? <Image source={{ uri: avatarUrl }} blurRadius={40} style={[StyleSheet.absoluteFill, styles.wash]} /> : null}
      <View style={styles.face} pointerEvents="none">
        <Animated.View style={{ transform: [{ scale }] }}>
          <Avatar uri={avatarUrl} size={148} radius={38} name={name.replace(/^@/, "")} />
        </Animated.View>
      </View>
      {children}
    </View>
  );
}

function RemoteStageShot({ participant, level }: { participant: GroupParticipant; level: Animated.Value }) {
  const peer = usePeerIdentity(participant.wallet ?? "");
  return (
    <StageShot name={peer.name} avatarUrl={peer.avatarUrl} level={level}>
      {participant.video ? (
        <RtcSurfaceView
          style={StyleSheet.absoluteFill}
          canvas={{ uid: participant.uid, sourceType: VideoSourceType.VideoSourceRemote, renderMode: RenderModeType.RenderModeHidden }}
        />
      ) : null}
    </StageShot>
  );
}

function StageName({ participant, selfName, muted, talking }: { participant: GroupParticipant | null; selfName: string | null; muted: boolean; talking: boolean }) {
  const peer = usePeerIdentity(participant?.wallet ?? "");
  const shown = selfName ?? (participant?.wallet ? peer.name : "…");
  return (
    <View style={styles.name} pointerEvents="none">
      {muted ? <Icon name="MicOff" size={14} color="#FFFFFF" /> : <Meter on={talking} />}
      <Text style={styles.nameText} numberOfLines={1}>{shown}</Text>
    </View>
  );
}

function Meter({ on }: { on: boolean }) {
  const bars = React.useRef([0, 1, 2].map(() => new Animated.Value(0.3))).current;
  React.useEffect(() => {
    if (!on) { bars.forEach(bar => { bar.stopAnimation(); bar.setValue(0.3); }); return; }
    const loops = bars.map((bar, index) => Animated.loop(Animated.sequence([
      Animated.delay(index * 120),
      Animated.timing(bar, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(bar, { toValue: 0.3, duration: 350, useNativeDriver: true }),
    ])));
    loops.forEach(loop => loop.start());
    return () => loops.forEach(loop => loop.stop());
  }, [on, bars]);
  return (
    <View style={styles.meter}>
      {bars.map((bar, index) => <Animated.View key={index} style={[styles.meterBar, { transform: [{ scaleY: bar }] }]} />)}
    </View>
  );
}

function StripTile({ name, avatarUrl, muted, talking, onStage, pinned, onPress, children }: {
  name: string; avatarUrl: string | null; muted: boolean; talking: boolean; onStage: boolean; pinned: boolean; onPress: () => void; children?: React.ReactNode;
}) {
  const { palette } = useStage();
  const borderColor = pinned ? palette.fg : talking ? palette.ring : palette.line;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: pinned }}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: palette.glass, borderColor, borderWidth: pinned || talking ? 2 : 1, opacity: onStage && !pinned ? 0.5 : 1 },
        pressed ? { transform: [{ scale: 0.96 }] } : null,
      ]}
    >
      <View style={styles.tileFace} pointerEvents="none">
        <Avatar uri={avatarUrl} size={44} radius={12} name={name.replace(/^@/, "")} />
      </View>
      {children}
      <View style={styles.tileName} pointerEvents="none">
        {muted ? <Icon name="MicOff" size={10} color="#FFFFFF" /> : null}
        <Text style={styles.tileNameText} numberOfLines={1}>{name}</Text>
      </View>
    </Pressable>
  );
}

function RemoteStripTile({ participant, talking, onStage, pinned, onPress }: {
  participant: GroupParticipant; talking: boolean; onStage: boolean; pinned: boolean; onPress: () => void;
}) {
  const peer = usePeerIdentity(participant.wallet ?? "");
  return (
    <StripTile
      name={participant.wallet ? peer.name : "…"}
      avatarUrl={peer.avatarUrl}
      muted={!participant.audio}
      talking={talking}
      onStage={onStage}
      pinned={pinned}
      onPress={onPress}
    >
      {/* The person on stage shows there; their tile keeps their picture so one camera is drawn once. */}
      {participant.video && !onStage ? (
        <RtcSurfaceView
          style={StyleSheet.absoluteFill}
          canvas={{ uid: participant.uid, sourceType: VideoSourceType.VideoSourceRemote, renderMode: RenderModeType.RenderModeHidden }}
          zOrderMediaOverlay
        />
      ) : null}
    </StripTile>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 12, gap: 8 },
  stage: { flex: 1, minHeight: 0, borderRadius: 24, overflow: "hidden" },
  wash: { opacity: 0.5, transform: [{ scale: 1.3 }] },
  face: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  name: {
    position: "absolute", left: 12, bottom: 12, maxWidth: "85%", flexDirection: "row", alignItems: "center", gap: 8,
    paddingLeft: 12, paddingRight: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: "rgba(18,18,22,0.6)",
  },
  nameText: { flexShrink: 1, color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  meter: { flexDirection: "row", alignItems: "center", gap: 2, height: 14 },
  meterBar: { width: 3, height: 14, borderRadius: 2, backgroundColor: "#FFFFFF" },
  topChip: {
    position: "absolute", top: 12, height: 30, flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, borderRadius: 999, backgroundColor: "rgba(18,18,22,0.6)",
  },
  pin: { left: 12 },
  chipText: { color: "#FFFFFF", fontSize: 12.5, fontWeight: "700" },
  stripScroll: { flexGrow: 0, flexShrink: 0, height: TILE_H + 4 },
  strip: { gap: 8, paddingVertical: 2, flexGrow: 1, justifyContent: "center" },
  tile: { width: TILE_W, height: TILE_H, borderRadius: 16, overflow: "hidden" },
  tileFace: { ...StyleSheet.absoluteFillObject, bottom: 18, alignItems: "center", justifyContent: "center" },
  tileName: {
    position: "absolute", left: 4, right: 4, bottom: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: "rgba(18,18,22,0.6)",
  },
  tileNameText: { flexShrink: 1, color: "#FFFFFF", fontSize: 10.5, fontWeight: "600" },
});
