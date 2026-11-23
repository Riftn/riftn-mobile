/**
 * A DM photo or video that disappears a few seconds after the other person
 * first opens it (3 s, 10 s, 25 s or 1 min, picked in the studio's Timer tab).
 * The countdown starts on that first open, not at send, so it can't run out
 * before they have seen it. The sender may allow one replay: when the first
 * countdown ends it closes, and one more open runs the countdown again. The
 * server decides every open; this only shows it. Same behaviour as web's
 * DmOpenTimerMedia.
 *
 * - Sender: a tile saying how long it lasts once opened; tapping it opens it
 *   for you as usual (your own copy does not start the countdown).
 * - Recipient: a closed tile. Tapping it tells the server (which starts the
 *   countdown and removes the message for both when it ends) and shows the
 *   media full screen with a big "29s" countdown on it. Afterwards: "Tap to
 *   replay" while a replay is left, then "Opened".
 */
import React, { memo, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useTranslation } from "react-i18next";
import SmartImage from "../common/SmartImage";
import Icon from "../ui/Icon";
import { markDmMessageViewed } from "../../services/dm/dm.api";
import { countdownLabel, replaysLeft, type DmDestruct } from "../../libs/dm-destruct";

/** Opened this session, with the replays left after it, so a re-render or scroll doesn't offer it again. */
const opened = new Map<string, number>();

type Phase = "closed" | "replay" | "starting" | "open" | "done";

/** Where a recipient's tile starts, from this session's memory and what the server sent. */
function initialOpenPhase(messageId: string, destruct: DmDestruct, now = Date.now()): "closed" | "replay" | "done" {
  const here = opened.get(messageId);
  if (here != null) return here > 0 ? "replay" : "done";
  const end = destruct.expiresAt ? new Date(destruct.expiresAt).getTime() : null;
  if (end != null && end > now) return "closed";
  if (!destruct.openedAt && end == null) return "closed";
  return replaysLeft(destruct) > 0 ? "replay" : "done";
}

interface Props {
  messageId: string;
  mine: boolean;
  destruct: DmDestruct;
  kind: "image" | "video";
  /** Playable address, if already known. */
  src?: string | null;
  /** Fetches (and decrypts) the source on demand. */
  resolveSource?: () => Promise<string | null>;
  /** Sender only: open your own copy as usual. */
  onOpenOwn?: () => void;
  onLongPress?: () => void;
}

const DmOpenTimerMedia: React.FC<Props> = ({ messageId, mine, destruct, kind, src, resolveSource, onOpenOwn, onLongPress }) => {
  const { t } = useTranslation();
  const seconds = destruct.seconds ?? 10;
  const secLabel = seconds >= 60 ? t("dm.openTimer.oneMin", "1 min") : t("dm.openTimer.secs", { n: seconds, defaultValue: "{{n}} sec" });
  const [phase, setPhase] = useState<Phase>(() => (mine ? "closed" : initialOpenPhase(messageId, destruct)));
  const [uri, setUri] = useState<string | null>(src ?? null);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [left, setLeft] = useState(() => replaysLeft(destruct));
  const [isReplay, setIsReplay] = useState(false);
  useEffect(() => { if (src) setUri(src); }, [src]);

  const open = async () => {
    if (mine) { onOpenOwn?.(); return; }
    if (phase !== "closed" && phase !== "replay") return;
    const replaying = phase === "replay";
    setIsReplay(replaying);
    setPhase("starting");
    const [file, res] = await Promise.all([
      uri ? Promise.resolve(uri) : (resolveSource?.() ?? Promise.resolve(null)),
      markDmMessageViewed(messageId).catch(() => ({} as { status?: string; expiresAt?: string; replaysLeft?: number })),
    ]);
    if (res?.status === "gone") {
      opened.set(messageId, 0);
      setPhase("done");
      return;
    }
    const after = typeof res?.replaysLeft === "number" ? res.replaysLeft : replaying ? 0 : replaysLeft(destruct);
    if (file) setUri(file);
    setEndsAt(res?.expiresAt ? new Date(res.expiresAt).getTime() : Date.now() + seconds * 1000);
    setNow(Date.now());
    setLeft(after);
    opened.set(messageId, after);
    setPhase("open");
  };

  const finish = () => setPhase(left > 0 ? "replay" : "done");

  useEffect(() => {
    if (phase !== "open") return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "open" && endsAt && now >= endsAt) setPhase(left > 0 ? "replay" : "done");
  }, [phase, endsAt, now, left]);

  const secsLeft = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : seconds;
  const replayTile = phase === "replay" || (phase === "starting" && isReplay);
  const fraction = endsAt ? Math.max(0, Math.min(1, (endsAt - now) / (seconds * 1000))) : 1;

  if (phase === "done") {
    return (
      <View className="flex-row items-center px-3 py-2.5" style={{ gap: 10, minWidth: 180 }}>
        <Icon name="Eye" size={16} color="#A1A1AA" />
        <Text className="text-[14px] text-theme-neutrals-400">{t("dm.openTimer.opened", "Opened")}</Text>
      </View>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => void open()}
        onLongPress={onLongPress}
        delayLongPress={350}
        accessibilityRole="button"
        className="flex-row items-center px-3 py-3"
        style={{ gap: 12, minWidth: 210 }}
      >
        <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: "hsla(0,0%,100%,0.12)" }}>
          {phase === "starting" ? <ActivityIndicator size="small" color="#F4F4F5" /> : <Icon name={replayTile ? "RotateCcw" : kind === "video" ? "Video" : "Image"} size={20} color="#F4F4F5" />}
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text className="text-[14px] font-semibold text-white">
            {mine
              ? kind === "video" ? t("dm.video", "Video") : t("dm.photo", "Photo")
              : replayTile
                ? t("dm.openTimer.tapReplay", "Tap to replay")
                : kind === "video" ? t("dm.openTimer.tapVideo", "Tap to watch") : t("dm.openTimer.tapPhoto", "Tap to view")}
          </Text>
          <View className="flex-row items-center" style={{ gap: 4 }}>
            <Icon name="Timer" size={12} color="#A1A1AA" />
            <Text className="text-[12px] text-theme-neutrals-400" numberOfLines={2}>
              {mine
                ? t("dm.openTimer.chip", { time: secLabel, defaultValue: "{{time}} once opened" })
                : replayTile
                  ? t("dm.openTimer.lastView", { time: secLabel, defaultValue: "Last view, {{time}}" })
                  : replaysLeft(destruct) > 0
                    ? t("dm.openTimer.goneAfterReplay", { time: secLabel, defaultValue: "Disappears {{time}} after you open it. One replay." })
                    : t("dm.openTimer.goneAfter", { time: secLabel, defaultValue: "Disappears {{time}} after you open it" })}
            </Text>
            {mine && (Number(destruct.replaysAllowed) || 0) > 0 ? (
              <Icon name="RotateCcw" size={12} color="#A1A1AA" accessibilityLabel={t("dm.openTimer.replayAllowed", "One replay allowed")} />
            ) : null}
          </View>
        </View>
      </Pressable>
      {phase === "open" && (
        <Modal visible transparent={false} animationType="fade" onRequestClose={finish} statusBarTranslucent>
          <View className="flex-1 dark-surface" style={{ backgroundColor: "#000" }}>
            <OpenMedia kind={kind} uri={uri} />
            <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, backgroundColor: "hsla(0,0%,100%,0.15)" }}>
              <View style={{ height: 3, width: `${fraction * 100}%`, backgroundColor: "#FFFFFF" }} />
            </View>
            {/* The countdown sits on the photo itself, big enough not to miss. */}
            <View pointerEvents="none" style={{ position: "absolute", top: 54, left: 0, right: 0, alignItems: "center" }}>
              <View
                className="dark-surface"
                accessibilityRole="timer"
                style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: "hsla(0,0%,0%,0.6)", borderWidth: 1, borderColor: "hsla(0,0%,100%,0.18)" }}
              >
                <Icon name="Timer" size={18} color="#FFFFFF" />
                <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{countdownLabel(secsLeft)}</Text>
                {isReplay ? (
                  <View style={{ marginLeft: 2, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: "hsla(0,0%,100%,0.2)" }}>
                    <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "700" }}>{t("dm.openTimer.replaying", "Replay")}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Pressable
              onPress={finish}
              accessibilityRole="button"
              accessibilityLabel={t("common.close", "Close")}
              hitSlop={12}
              className="dark-surface"
              style={{ position: "absolute", top: 50, right: 16, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "hsla(0,0%,100%,0.14)" }}
            >
              <Icon name="X" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </Modal>
      )}
    </>
  );
};

const OpenMedia: React.FC<{ kind: "image" | "video"; uri: string | null }> = ({ kind, uri }) => {
  const { width, height } = useWindowDimensions();
  if (!uri) {
    return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#FFFFFF" /></View>;
  }
  if (kind === "video") return <OpenVideo uri={uri} />;
  return <SmartImage source={{ uri }} style={{ width, height }} contentFit="contain" cachePolicy="none" />;
};

const OpenVideo: React.FC<{ uri: string }> = ({ uri }) => {
  const player = useVideoPlayer(uri, (p) => { p.loop = false; p.play(); });
  return <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls={false} />;
};

export default memo(DmOpenTimerMedia);
