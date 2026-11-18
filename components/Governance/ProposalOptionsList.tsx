/**
 * ProposalOptionsList
 * ===================
 * The answers of a multiple choice governance proposal, native twin of web's
 * ProposalOptions: one row per answer filled to its share of the weighted
 * vote, the viewer's pick marked. Tapping an answer votes for it, tapping your
 * own pick again takes the vote back. Styled after the post poll card so a
 * poll reads the same wherever it is.
 */
import React from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import {
  leadingOption,
  optionTallies,
  type GovernanceProposal,
} from "../../services/governance.service";

interface Props {
  proposal: GovernanceProposal;
  /** The answer the viewer voted for, if any. */
  myOption: number | null | undefined;
  /** Omit for a read-only list (the board card opens the proposal instead). */
  onVote?: (optionIndex: number) => void;
  disabled?: boolean;
  /** The answer a vote is on its way to, for its spinner. */
  pendingOption?: number | null;
  /** Board card size: no footer. */
  compact?: boolean;
}

const ProposalOptionsList: React.FC<Props> = ({ proposal, myOption, onVote, disabled, pendingOption, compact }) => {
  const { t } = useTranslation();
  const options = proposal.options ?? [];
  const tallies = optionTallies(proposal);
  const totalWeight = tallies.reduce((sum, tally) => sum + tally.weight, 0);
  const totalVoters = tallies.reduce((sum, tally) => sum + tally.voters, 0);
  const decided = proposal.status !== "open";
  const winner = decided && proposal.status === "passed" ? leadingOption(tallies) : null;
  const pct = (i: number) => (totalWeight > 0 ? Math.round((tallies[i].weight / totalWeight) * 100) : 0);

  return (
    <View>
      {options.map((text, i) => {
        const mine = myOption === i;
        const won = winner === i;
        const canVote = !!onVote && !disabled;
        // Read-only rows are plain views, so a tap on the board card falls
        // through to the card and opens the proposal.
        const Row: React.ElementType = onVote ? TouchableOpacity : View;
        return (
          <Row
            key={i}
            {...(onVote
              ? {
                onPress: () => onVote(i),
                disabled: !canVote,
                activeOpacity: canVote ? 0.7 : 1,
                accessibilityRole: "button",
                accessibilityState: { selected: mine, disabled: !canVote },
              }
              : {})}
            accessibilityLabel={`${text}, ${pct(i)}%`}
            className={`relative overflow-hidden ${compact ? "py-2" : "py-2.5"} mb-1.5`}
            style={{ borderRadius: 8 }}
          >
            <View className="absolute inset-0 bg-white/10" style={{ borderRadius: 8 }} />
            <View
              className="absolute inset-y-0 left-0"
              style={{
                borderRadius: 8,
                width: `${pct(i)}%`,
                backgroundColor: mine || won ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)",
              }}
            />
            <View className="relative z-10 flex-row items-center justify-between px-3">
              <View className="flex-row items-center gap-2 flex-1 min-w-0">
                {!decided && (
                  pendingOption === i ? (
                    <ActivityIndicator size="small" color="#F4F4F5" style={{ width: 16, height: 16 }} />
                  ) : (
                    <View
                      className={`w-4 h-4 border items-center justify-center ${
                        mine ? "bg-white border-white" : "border-white/30"
                      }`}
                      style={{ borderRadius: 8 }}
                    >
                      {mine && <View className="w-2 h-2 dark-surface bg-black" style={{ borderRadius: 4 }} />}
                    </View>
                  )
                )}
                <Text
                  className={`${compact ? "text-[13px]" : "text-sm"} flex-shrink ${mine || won ? "text-white font-medium" : "text-zinc-300"}`}
                  numberOfLines={2}
                >
                  {text}
                </Text>
                {won && <Icon name="Check" size={14} color="#F4F4F5" />}
              </View>
              <Text className={`text-xs ml-2 ${mine || won ? "text-white font-medium" : "text-zinc-400"}`}>{pct(i)}%</Text>
            </View>
          </Row>
        );
      })}
      {!compact && (
        <Text className="text-zinc-400 text-[12px] mt-0.5">
          {t("governance.optionVoters", { count: totalVoters })}
          {" · "}
          {decided
            ? winner !== null
              ? t("governance.optionWinner", { option: options[winner] })
              : t("governance.optionNoWinner")
            : myOption !== null && myOption !== undefined
              ? t("governance.optionTapToUndo")
              : t("governance.optionPickOne")}
        </Text>
      )}
    </View>
  );
};

export default React.memo(ProposalOptionsList);
