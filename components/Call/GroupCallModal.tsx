import { PUBLIC_CHAT_CALL_ID } from "../../libs/groupCall";
import React from "react";
import { StyleSheet, Text, View, ScrollView, useWindowDimensions } from "react-native";
import { RtcSurfaceView, RenderModeType, VideoSourceType } from "react-native-agora";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Avatar from "../common/Avatar";
import Icon from "../ui/Icon";
import { useCall } from "../../context/CallContext";
import { useAuth } from "../../context/AuthContext";
import type { GroupParticipant } from "../../hooks/useCall";
import { CallDuration } from "./CallDuration";
import { CallStage, CallIdentity, CallControl, CallDock, CallFoot, CallPill, CallRow, useStage } from "./CallChrome";
import { CallCaptionsControl, CallCaptionsOverlay } from "./CallCaptions";
import { CallBackgroundPanel, CallFxButton } from "./CallBackgroundPicker";
import { usePeerIdentity } from "./usePeerIdentity";
import { startCallRingtone, stopCallRingtone } from "../../libs/call-ringtone";

/**
 * A group call, voice or video, on the same stage as a direct call.
 *
 * Until someone else is in the room it is the ringing screen with the group's
 * name. Then it becomes a grid: one tile per person, their camera when it is
 * on and their picture when it is not, outlined while they talk. Leave is the
 * one solid control; the call carries on for whoever is still in it.
 */
const GroupCallModal: React.FC = () => {
  const {
    isCallActive, isIncoming, isRinging, isConnecting, currentCall, peerAddress,
    isMuted, isSpeakerOn, isCameraOff, selfSpeaking, groupCamerasFull, groupParticipants, localCanvas,
    isMinimized, setMinimized, endCall, acceptCall, rejectCall,
    toggleMute, toggleSpeaker, toggleCamera, switchCamera,
    callBackground, callBackgroundSupported, setCallBackground,
  } = useCall();
  const [fxOpen, setFxOpen] = React.useState(false);
  const { user } = useAuth();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const caller = usePeerIdentity(isIncoming ? peerAddress : "");
  const self = usePeerIdentity((user?.walletAddress || user?.address || "").toLowerCase());

  // Ring and buzz while a group call is waiting, the same as a one-to-one call.
  React.useEffect(() => {
    if (!isIncoming) return;
    startCallRingtone();
    return stopCallRingtone;
  }, [isIncoming]);

  if (!currentCall?.group_id) return null;
  if (!isIncoming && (isMinimized || !(isCallActive || isConnecting))) return null;

  const isVideo = currentCall.call_type === "video";
  const groupName = currentCall.group_name || t("calls.group", { defaultValue: "Group" });
  const kindLabel = isVideo
    ? t("calls.groupVideoCall", { defaultValue: "Group video call" })
    : t("calls.groupVoiceCall", { defaultValue: "Group voice call" });
  const stagePeer = { name: groupName, avatarUrl: isIncoming ? caller.avatarUrl : self.avatarUrl };
  // Back must not decline an incoming call; Accept and Decline are the only exits.
  const minimize = () => { if (!isIncoming) setMinimized(true); };

  if (isIncoming || !isCallActive) {
    const status = isIncoming
      ? t("calls.isCalling", { name: caller.name, defaultValue: "{{name}} is calling" })
      : isRinging
        ? currentCall?.group_id === PUBLIC_CHAT_CALL_ID
          ? t("calls.waitingForPeople", { defaultValue: "Waiting for people to join..." })
          : t("calls.callingGroup", { defaultValue: "Ringing the group..." })
        : t("calls.connecting");
    return (
      <CallStage peer={stagePeer} onRequestClose={minimize} onCorner={isIncoming ? undefined : minimize}>
        <CallIdentity kindIcon={isVideo ? "Video" : "Users"} kindLabel={kindLabel} peer={stagePeer} status={status} ringing={isIncoming || isRinging} />
        <CallFoot>
          {isIncoming ? (
            <CallRow>
              <CallPill icon="PhoneOff" label={t("calls.decline")} onPress={rejectCall} />
              <CallPill icon={isVideo ? "Video" : "Phone"} label={t("calls.accept")} onPress={acceptCall} solid />
            </CallRow>
          ) : (
            <CallDock>
              <CallControl icon={isMuted ? "MicOff" : "Mic"} label={isMuted ? t("calls.unmute") : t("calls.mute")} onPress={toggleMute} active={isMuted} />
              <CallControl icon="PhoneOff" label={t("common.cancel")} onPress={endCall} primary />
            </CallDock>
          )}
        </CallFoot>
      </CallStage>
    );
  }

  return (
    <CallStage peer={stagePeer} onRequestClose={minimize} onCorner={minimize}>
      <View style={[styles.top, { paddingTop: insets.top + 18 }]} pointerEvents="none">
        <View style={styles.chip}>
          <Text style={styles.chipName} numberOfLines={1}>{groupName}</Text>
          <Text style={styles.chipTime}><CallDuration fallback={t("calls.connected")} /></Text>
        </View>
      </View>
      <TileGrid
        topInset={insets.top + 64}
        bottomInset={Math.max(22, insets.bottom + 10) + 124}
        self={{ name: t("calls.you", { defaultValue: "You" }), avatarUrl: self.avatarUrl, video: isVideo && !isCameraOff, muted: isMuted, speaking: selfSpeaking && !isMuted }}
        localCanvas={localCanvas}
        participants={groupParticipants}
      />
      {isVideo && callBackgroundSupported ? (
        <CallFxButton open={fxOpen} active={callBackground !== "none"} onToggle={() => setFxOpen(open => !open)} />
      ) : null}
      <CallFoot>
        <CallCaptionsOverlay />
        {isVideo && callBackgroundSupported && fxOpen ? (
          <CallBackgroundPanel value={callBackground} onPick={setCallBackground} onClose={() => setFxOpen(false)} />
        ) : null}
        {isVideo ? <CallCaptionsControl variant="chip" /> : null}
        <CallDock compact={isVideo}>
          {!isVideo ? (
            <CallControl icon={isSpeakerOn ? "Volume2" : "Volume1"} label={t("calls.speaker")} onPress={toggleSpeaker} active={isSpeakerOn} />
          ) : null}
          <CallControl icon={isMuted ? "MicOff" : "Mic"} label={isMuted ? t("calls.unmute") : t("calls.mute")} onPress={toggleMute} active={isMuted} compact={isVideo} />
          {isVideo ? (
            <>
              {/* Every camera slot taken: the button says so, and a tap explains how to get one. */}
              <CallControl
                icon={isCameraOff ? "VideoOff" : "Video"}
                label={isCameraOff && groupCamerasFull ? t("calls.camerasFull", { defaultValue: "Cameras full" }) : t("calls.camera")}
                onPress={toggleCamera}
                active={isCameraOff}
                dimmed={isCameraOff && groupCamerasFull}
                compact
              />
              <CallControl icon="RefreshCw" label={t("calls.flip")} onPress={switchCamera} compact />
            </>
          ) : null}
          {isVideo ? null : <CallCaptionsControl />}
          <CallControl icon="PhoneOff" label={t("calls.leave", { defaultValue: "Leave" })} onPress={endCall} primary compact={isVideo} />
        </CallDock>
      </CallFoot>
    </CallStage>
  );
};

type SelfTile = { name: string; avatarUrl: string | null; video: boolean; muted: boolean; speaking: boolean };

/**
 * The screen splits as people join, up to four: one fills it, two take a half
 * each, three are a wide tile over two, four are quarters. A fifth person and
 * on keep quarter tiles and the grid scrolls for the rest.
 */
function TileGrid({ topInset, bottomInset, self, localCanvas, participants }: {
  topInset: number; bottomInset: number; self: SelfTile; localCanvas: React.ComponentProps<typeof RtcSurfaceView>["canvas"]; participants: GroupParticipant[];
}) {
  const { width, height } = useWindowDimensions();
  const count = participants.length + 1;
  const gap = 8;
  const full = width - 24;
  const half = (full - gap) / 2;
  const room = Math.max(240, height - topInset - bottomInset);
  const tileHeight = count === 1 ? room : (room - gap) / 2;
  const widthOf = (index: number) => (count <= 2 || (count === 3 && index === 0) ? full : half);
  return (
    <ScrollView
      style={styles.gridScroll}
      contentContainerStyle={[styles.grid, { paddingTop: topInset, paddingBottom: bottomInset, gap }]}
      scrollEnabled={count > 4}
      showsVerticalScrollIndicator={false}
    >
      <Tile width={widthOf(0)} height={tileHeight} name={self.name} avatarUrl={self.avatarUrl} muted={self.muted} speaking={self.speaking}>
        {self.video ? <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={localCanvas} zOrderMediaOverlay /> : null}
      </Tile>
      {participants.map((participant, index) => (
        <RemoteTile key={participant.uid} participant={participant} width={widthOf(index + 1)} height={tileHeight} />
      ))}
    </ScrollView>
  );
}

function RemoteTile({ participant, width, height }: { participant: GroupParticipant; width: number; height: number }) {
  const peer = usePeerIdentity(participant.wallet ?? "");
  return (
    <Tile width={width} height={height} name={participant.wallet ? peer.name : "…"} avatarUrl={peer.avatarUrl} muted={!participant.audio} speaking={participant.speaking}>
      {participant.video ? (
        <RtcSurfaceView
          style={StyleSheet.absoluteFill}
          canvas={{ uid: participant.uid, sourceType: VideoSourceType.VideoSourceRemote, renderMode: RenderModeType.RenderModeHidden }}
        />
      ) : null}
    </Tile>
  );
}

function Tile({ width, height, name, avatarUrl, muted, speaking, children }: {
  width: number; height: number; name: string; avatarUrl: string | null; muted: boolean; speaking: boolean; children?: React.ReactNode;
}) {
  const { palette } = useStage();
  const face = Math.min(112, Math.max(56, width * 0.38));
  return (
    <View
      style={[
        styles.tile,
        { width, backgroundColor: palette.glass, borderColor: speaking ? palette.fg : palette.line, borderWidth: speaking ? 2 : 1 },
        { height },
      ]}
    >
      <View style={styles.face} pointerEvents="none">
        <Avatar uri={avatarUrl} size={face} radius={Math.round(face * 0.26)} name={name.replace(/^@/, "")} />
      </View>
      {children}
      <View style={styles.nameChip} pointerEvents="none">
        {muted ? <Icon name="MicOff" size={11} color="#FFFFFF" /> : null}
        <Text style={styles.nameText} numberOfLines={1}>{name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 2, alignItems: "center", paddingHorizontal: 70 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "100%", paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(18,18,22,0.55)",
  },
  chipName: { flexShrink: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  chipTime: { color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: "500", fontVariant: ["tabular-nums"] },
  gridScroll: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12 },
  tile: { borderRadius: 20, overflow: "hidden" },
  face: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  nameChip: {
    position: "absolute", left: 8, bottom: 8, maxWidth: "90%", flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(18,18,22,0.6)",
  },
  nameText: { flexShrink: 1, color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
});

export default GroupCallModal;
