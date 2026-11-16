import React from "react";
import { useTranslation } from "react-i18next";
import { useCall } from "../../context/CallContext";
import { CallStage, CallIdentity, CallPill, CallFoot, CallRow } from "./CallChrome";
import { usePeerIdentity } from "./usePeerIdentity";

/**
 * The last word on a call: how it finished and a way back. It closes on its
 * own after a few seconds (the hook owns the timer), so nobody has to dismiss
 * a call that is already over.
 */
const CallEndedScreen: React.FC = () => {
  const { callSummary, dismissCallSummary, startCall } = useCall();
  const { t } = useTranslation();
  const peer = usePeerIdentity(callSummary?.peerAddress ?? "");

  if (!callSummary) return null;
  const { peerAddress, callType, outcome, duration } = callSummary;
  const isVideo = callType === "video";

  const status = outcome === "ended"
    ? `${t("calls.ended")}${duration ? ` · ${duration}` : ""}`
    : outcome === "declined"
      ? t("calls.declined")
      : outcome === "no_answer"
        ? t("calls.noAnswer")
        : t("calls.missed");

  return (
    <CallStage peer={peer} onRequestClose={dismissCallSummary} onCorner={dismissCallSummary} cornerIcon="X" cornerLabel={t("common.close")}>
      <CallIdentity
        kindIcon={isVideo ? "Video" : "Phone"}
        kindLabel={isVideo ? t("calls.videoCall") : t("calls.voiceCall")}
        peer={peer}
        status={status}
      />
      <CallFoot>
        <CallRow>
          <CallPill icon="X" label={t("common.close")} onPress={dismissCallSummary} />
          <CallPill
            icon={isVideo ? "Video" : "Phone"}
            label={t("calls.callBack")}
            onPress={() => { void startCall(peerAddress, callType); }}
            solid
          />
        </CallRow>
      </CallFoot>
    </CallStage>
  );
};

export default CallEndedScreen;
