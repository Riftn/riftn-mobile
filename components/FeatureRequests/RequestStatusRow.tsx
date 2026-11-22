import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useAppTheme } from "../../context/ThemeContext";
import { STATUS_LABELS, type FeatureStatus } from "../../hooks/useFeatureRequests";

/**
 * Category, status and the owners' progress note under a request.
 * Concept round: `globalThis.__rqChips = 'a'|'b'|'c'|'d'` picks the look;
 * anything else renders today's grey chips.
 */
export type ChipConcept = "today" | "a" | "b" | "c" | "d";

export function chipConcept(): ChipConcept {
  const v = String((globalThis as { __rqChips?: string }).__rqChips || "").toLowerCase();
  return v === "a" || v === "b" || v === "c" || v === "d" ? v : "today";
}

const SHOWN: FeatureStatus[] = ["under_review", "planned", "in_progress", "declined"];

// Screens are written in the dark palette; System Light flips greys as it
// renders (libs/jsx/tone.js), so these are the dark-theme colours.
const INK = "#EDEDEF";
const MUTED = "rgba(255,255,255,0.68)";
const FAINT = "rgba(255,255,255,0.5)";
const LINE = "rgba(255,255,255,0.16)";
const WASH = "rgba(255,255,255,0.05)";

function mix(rgb: readonly number[], white: number): string {
  const c = rgb.map((v) => Math.round(v + (255 - v) * white));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export default function RequestStatusRow({
  status,
  note,
  categoryChip,
  concept = chipConcept(),
}: {
  status: FeatureStatus;
  note: string;
  categoryChip: React.ReactNode;
  concept?: ChipConcept;
}) {
  const { t } = useTranslation();
  const { skin, accent } = useAppTheme();
  // System / Minimal: white. Canvas themes: their own colour, lifted for text.
  const acc = skin ? mix(accent as unknown as number[], 0.45) : "#FFFFFF";
  const keyBg = skin ? mix(accent as unknown as number[], 0.4) : "#FFFFFF";
  const shown = SHOWN.includes(status);
  const liveNote = status !== "declined" ? note : "";
  const label =
    status === "in_progress"
      ? t("copy.rq.inprogress", { defaultValue: "In progress" })
      : status === "under_review"
        ? t("copy.rq.underreview", { defaultValue: "Under review" })
        : STATUS_LABELS[status];

  const dotLabel = (
    <View style={s.aStatus}>
      <View style={[s.dot, { backgroundColor: acc }]} />
      <Text style={s.aText}>{label}</Text>
    </View>
  );
  const noteText = (withLabel: boolean) => (
    <Text style={s.note}>
      {withLabel && <Text style={s.noteLabel}>{t("copy.rq.update", { defaultValue: "Update" })}  </Text>}
      {liveNote}
    </Text>
  );

  if (concept === "a") {
    return (
      <View style={s.col}>
        <View style={s.row}>
          {categoryChip}
          {shown && dotLabel}
        </View>
        {!!liveNote && noteText(true)}
      </View>
    );
  }

  if (concept === "b") {
    return (
      <View style={s.col}>
        <View style={s.row}>
          {categoryChip}
          {shown && (
            <View style={[s.key, { backgroundColor: keyBg }]}>
              <Text style={s.keyText}>{label}</Text>
            </View>
          )}
        </View>
        {!!liveNote && <View style={[s.quote, { borderLeftColor: acc }]}>{noteText(false)}</View>}
      </View>
    );
  }

  if (concept === "c") {
    const tracked = status === "in_progress" || status === "planned" || status === "under_review";
    const steps = [t("copy.rq.asked", { defaultValue: "Asked" }), label, t("copy.d332dadf1646", { defaultValue: "Shipped" })];
    return (
      <View style={s.col}>
        <View style={s.row}>
          {categoryChip}
          {status === "declined" && dotLabel}
        </View>
        {tracked && (
          <View style={s.track}>
            {steps.map((step, i) => (
              <View key={i} style={s.trackPart}>
                {i > 0 && <View style={[s.seg, i === 1 && { backgroundColor: MUTED }]} />}
                <View style={s.step}>
                  <View
                    style={[
                      s.stepDot,
                      i === 0 && { backgroundColor: MUTED, borderColor: MUTED },
                      i === 1 && { width: 8, height: 8, backgroundColor: acc, borderColor: acc },
                    ]}
                  />
                  <Text style={[s.stepText, i === 0 && { color: MUTED }, i === 1 && { color: INK, fontWeight: "600" }]}>{step}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
        {!!liveNote && noteText(false)}
      </View>
    );
  }

  if (concept === "d") {
    return (
      <View style={s.col}>
        <View style={s.row}>{categoryChip}</View>
        {shown && status !== "declined" && (
          <View style={liveNote ? (skin ? s.dBox : s.dRail) : null}>
            <View style={s.dHead}>
              <Icon name="Loader" size={14} color={acc} />
              <Text style={s.aText}>{label}</Text>
              {!!liveNote && <Text style={s.dBy}>· {t("copy.rq.team", { defaultValue: "Riftn team" })}</Text>}
            </View>
            {!!liveNote && noteText(false)}
          </View>
        )}
        {status === "declined" && dotLabel}
      </View>
    );
  }

  return null;
}

const s = StyleSheet.create({
  col: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  aStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  aText: { color: INK, fontSize: 11, fontWeight: "600" },
  note: { color: MUTED, fontSize: 12, lineHeight: 17 },
  noteLabel: { color: INK, fontWeight: "600" },
  key: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 8 },
  keyText: { color: "#0B0B0C", fontSize: 10, lineHeight: 16, fontWeight: "600" },
  quote: { borderLeftWidth: 2, paddingLeft: 10, paddingVertical: 1 },
  track: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", rowGap: 6 },
  trackPart: { flexDirection: "row", alignItems: "center" },
  seg: { width: 20, height: 1, marginHorizontal: 8, backgroundColor: LINE },
  step: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepDot: { width: 6, height: 6, borderRadius: 4, borderWidth: 1, borderColor: FAINT },
  stepText: { color: FAINT, fontSize: 11, fontWeight: "500" },
  dBox: { gap: 4, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: LINE, backgroundColor: WASH },
  dRail: { gap: 4, borderLeftWidth: 1, borderLeftColor: LINE, paddingLeft: 12, paddingVertical: 2 },
  dHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  dBy: { color: MUTED, fontSize: 11 },
});
