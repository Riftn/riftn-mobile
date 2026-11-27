import React from "react";
import { useTranslation } from "react-i18next";
import { useCall } from "../../context/CallContext";
import { CallStage, CallIdentity, CallControl, CallDock, CallFoot, CallRow } from "./CallChrome";
import type { PeerIdentity } from "./usePeerIdentity";
import { startCallRingtone, stopCallRingtone } from "../../libs/call-ringtone";

const IncomingCallModal: React.FC<{ peer: PeerIdentity }> = ({ peer }) => {
  const { isIncoming, currentCall, acceptCall, rejectCall, isMuted, isSpeakerOn, toggleMute, toggleSpeaker } = useCall();
  const { t } = useTranslation();

  // Back must not decline the call; Accept and Decline are the only exits.
  const ignoreBack = () => {};

  // Ring and buzz for as long as the call is waiting. Accept, Decline, the
  // caller hanging up or the call timing out all close this screen, which stops it.
  React.useEffect(() => {
    if (!isIncoming) return;
    startCallRingtone();
    return stopCallRingtone;
  }, [isIncoming]);

  if (!isIncoming) return null;

  const isVideo = currentCall?.call_type === "video";

  return (
    <CallStage peer={peer} onRequestClose={ignoreBack}>
      <CallIdentity
        kindIcon={isVideo ? "Video" : "Phone"}
        kindLabel={t("calls.incoming")}
        peer={peer}
        ringing
        direct
      />
      <CallFoot ringing>
        {!currentCall?.group_id ? <CallDock direct>
          <CallControl direct icon={isSpeakerOn ? "Volume2" : "Volume1"} label={t("calls.speaker")} onPress={toggleSpeaker} active={isSpeakerOn} />
          <CallControl direct icon={isMuted ? "MicOff" : "Mic"} label={t(isMuted ? "calls.unmute" : "calls.mute")} onPress={toggleMute} active={isMuted} />
        </CallDock> : null}
        <CallRow ringing>
          <CallControl large direct icon="PhoneOff" label={t("calls.decline")} onPress={rejectCall} />
          <CallControl large direct icon={isVideo ? "Video" : "Phone"} label={t("calls.accept")} onPress={acceptCall} primary />
        </CallRow>
      </CallFoot>
    </CallStage>
  );
};

export default IncomingCallModal;
