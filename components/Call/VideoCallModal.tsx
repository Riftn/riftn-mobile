import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { RtcSurfaceView } from "react-native-agora";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useCall } from "../../context/CallContext";
import { CallDuration } from "./CallDuration";
import { CallStage, CallIdentity, CallControl, CallDock, CallFoot } from "./CallChrome";
import { CallCaptionsControl, CallCaptionsOverlay } from "./CallCaptions";
import { usePeerIdentity } from "./usePeerIdentity";
import { CallBackgroundPanel, CallFxButton } from "./CallBackgroundPicker";

const VideoCallModal: React.FC = () => {
  const {
    isCallActive,
    currentCall,
    isConnecting,
    isRinging,
    isMuted,
    isSpeakerOn,
    isCameraOff,
    localCanvas,
    remoteCanvas,
    remoteUid,
    peerAddress,
    isMinimized,
    setMinimized,
    endCall,
    toggleMute,
    toggleSpeaker,
    toggleCamera,
    switchCamera,
    callBackground,
    callBackgroundSupported,
    setCallBackground,
  } = useCall();

  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const peer = usePeerIdentity(peerAddress);

  const isVideoCall = currentCall?.call_type === "video";
  const isVisible = (isCallActive || isConnecting) && isVideoCall && !!currentCall;

  // Own camera sits just above the controls, and rises with them when subtitles show.
  // Kept above the early return so the hook order never changes between renders.
  const [footHeight, setFootHeight] = React.useState(0);
  const [fxOpen, setFxOpen] = React.useState(false);

  if (!isVisible || isMinimized) return null;

  const live = !!remoteUid;
  const status = isRinging
    ? t("calls.calling")
    : isConnecting
      ? t("calls.connecting")
      : <CallDuration fallback={t("calls.connected")} />;
  const footClearance = footHeight ? footHeight + 12 : Math.max(22, insets.bottom + 10) + 132;

  return (
    <CallStage peer={peer} live={live} onRequestClose={() => setMinimized(true)} onCorner={() => setMinimized(true)}>
      {live ? (
        <>
          <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={remoteCanvas} />
          {/* Name and timer ride over the other person's video once it is up. */}
          <View style={[styles.top, { paddingTop: insets.top + 14 }]} pointerEvents="none">
            <View style={styles.chip}>
              <Text style={styles.chipName} numberOfLines={1}>{peer.name}</Text>
              <Text style={styles.chipTime}>{status}</Text>
            </View>
          </View>
          <View style={styles.fill} />
        </>
      ) : (
        // Nobody on the far side yet: show who is being called, not an empty camera.
        <CallIdentity kindIcon="Video" kindLabel={t("calls.videoCall")} peer={peer} status={status} ringing={isRinging} />
      )}

      {/* Own camera. Always mounted so the preview can attach before the call state settles. */}
      <View
        style={[styles.self, live ? { bottom: footClearance, width: 104, height: 148 } : { top: insets.top + 68, width: 84, height: 120 }]}
        pointerEvents="none"
      >
        <RtcSurfaceView
          style={[StyleSheet.absoluteFill, { opacity: isCameraOff ? 0 : 1 }]}
          zOrderMediaOverlay={true}
          canvas={localCanvas}
        />
        {isCameraOff ? (
          <View style={styles.selfOff} accessibilityLabel={t("calls.cameraOff")}>
            <Icon name="VideoOff" size={20} color="rgba(255,255,255,0.62)" />
          </View>
        ) : null}
      </View>

      {callBackgroundSupported ? (
        <CallFxButton open={fxOpen} active={callBackground !== "none"} onToggle={() => setFxOpen(open => !open)} />
      ) : null}

      <CallFoot onHeight={setFootHeight}>
        {isCallActive ? <CallCaptionsOverlay /> : null}
        {callBackgroundSupported && fxOpen ? (
          <CallBackgroundPanel value={callBackground} onPick={setCallBackground} onClose={() => setFxOpen(false)} />
        ) : null}
        {isCallActive ? <CallCaptionsControl variant="chip" /> : null}
        <CallDock compact>
          <CallControl
            icon={isSpeakerOn ? "Volume2" : "Volume1"}
            label={t("calls.speaker")}
            onPress={toggleSpeaker}
            active={isSpeakerOn}
            compact
          />
          <CallControl
            icon={isMuted ? "MicOff" : "Mic"}
            label={isMuted ? t("calls.unmute") : t("calls.mute")}
            onPress={toggleMute}
            active={isMuted}
            compact
          />
          <CallControl
            icon={isCameraOff ? "VideoOff" : "Video"}
            label={t("calls.camera")}
            onPress={toggleCamera}
            active={isCameraOff}
            compact
          />
          <CallControl icon="RefreshCw" label={t("calls.flip")} onPress={switchCamera} compact />
          <CallControl
            icon="PhoneOff"
            label={isCallActive ? t("calls.end") : t("common.cancel")}
            onPress={endCall}
            primary
            compact
          />
        </CallDock>
      </CallFoot>
    </CallStage>
  );
};

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 70,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(18,18,22,0.55)",
  },
  chipName: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  chipTime: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 14,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  self: {
    position: "absolute",
    right: 16,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: "#17171B",
  },
  selfOff: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default VideoCallModal;
