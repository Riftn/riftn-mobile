import React from "react";
import { useTranslation } from "react-i18next";
import { useCall } from "../../context/CallContext";
import { CallDuration } from "./CallDuration";
import { CallStage, CallIdentity, CallControl, CallDock, CallFoot, CallWave } from "./CallChrome";
import { CallCaptionsControl, CallCaptionsOverlay } from "./CallCaptions";
import { usePeerIdentity } from "./usePeerIdentity";

const VoiceCallModal: React.FC = () => {
  const {
    isCallActive,
    currentCall,
    isConnecting,
    isRinging,
    isMuted,
    isSpeakerOn,
    endCall,
    toggleMute,
    toggleSpeaker,
    peerAddress,
    isMinimized,
    setMinimized,
  } = useCall();

  const { t } = useTranslation();
  const peer = usePeerIdentity(peerAddress);

  const isAudioCall = currentCall?.call_type === "audio";
  const isVisible = (isCallActive || isConnecting) && isAudioCall && !!currentCall;

  if (!isVisible || isMinimized) return null;

  const status = isRinging
    ? t("calls.calling")
    : isConnecting
      ? t("calls.connecting")
      : <CallDuration fallback={t("calls.connected")} />;

  return (
    <CallStage peer={peer} onRequestClose={() => setMinimized(true)} onCorner={() => setMinimized(true)}>
      <CallIdentity kindIcon="Phone" kindLabel={t("calls.voiceCall")} peer={peer} status={status} ringing={isRinging}>
        {isCallActive ? <CallWave paused={isMuted} /> : null}
      </CallIdentity>
      <CallFoot>
        {isCallActive ? <CallCaptionsOverlay /> : null}
        <CallDock>
          <CallControl
            icon={isSpeakerOn ? "Volume2" : "Volume1"}
            label={t("calls.speaker")}
            onPress={toggleSpeaker}
            active={isSpeakerOn}
          />
          <CallControl
            icon={isMuted ? "MicOff" : "Mic"}
            label={isMuted ? t("calls.unmute") : t("calls.mute")}
            onPress={toggleMute}
            active={isMuted}
          />
          {isCallActive ? <CallCaptionsControl /> : null}
          <CallControl
            icon="PhoneOff"
            label={isCallActive ? t("calls.end") : t("common.cancel")}
            onPress={endCall}
            primary
          />
        </CallDock>
      </CallFoot>
    </CallStage>
  );
};

export default VoiceCallModal;
