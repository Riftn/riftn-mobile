import React from "react";
import { useTranslation } from "react-i18next";
import { useCall } from "../../context/CallContext";
import { CallStage, CallIdentity, CallControl, CallFoot, CallRow } from "./CallChrome";
import type { PeerIdentity } from "./usePeerIdentity";
import { startCallRingtone, stopCallRingtone } from "../../libs/call-ringtone";

const IncomingCallModal: React.FC<{ peer: PeerIdentity }> = ({ peer }) => {
  const { isIncoming, currentCall, acceptCall, rejectCall } = useCall();
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
        kindLabel={isVideo ? t("calls.videoCall") : t("calls.voiceCall")}
        peer={peer}
        status={t("calls.incoming")}
        ringing
        direct
      />
      <CallFoot ringing>
        <CallRow ringing>
          <CallControl large direct icon="PhoneOff" label={t("calls.decline")} onPress={rejectCall} />
          <CallControl large direct icon={isVideo ? "Video" : "Phone"} label={t("calls.accept")} onPress={acceptCall} primary />
        </CallRow>
      </CallFoot>
    </CallStage>
  );
};

export default IncomingCallModal;
