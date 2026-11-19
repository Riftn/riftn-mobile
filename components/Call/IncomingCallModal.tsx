import React from "react";
import { useTranslation } from "react-i18next";
import { useCall } from "../../context/CallContext";
import { CallStage, CallIdentity, CallPill, CallFoot, CallRow } from "./CallChrome";
import { usePeerIdentity } from "./usePeerIdentity";
import { startCallRingtone, stopCallRingtone } from "../../libs/call-ringtone";

const IncomingCallModal: React.FC = () => {
  const { isIncoming, currentCall, acceptCall, rejectCall, peerAddress } = useCall();
  const { t } = useTranslation();
  const peer = usePeerIdentity(peerAddress);

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
      />
      <CallFoot>
        <CallRow>
          <CallPill icon="PhoneOff" label={t("calls.decline")} onPress={rejectCall} />
          <CallPill icon={isVideo ? "Video" : "Phone"} label={t("calls.accept")} onPress={acceptCall} solid />
        </CallRow>
      </CallFoot>
    </CallStage>
  );
};

export default IncomingCallModal;
