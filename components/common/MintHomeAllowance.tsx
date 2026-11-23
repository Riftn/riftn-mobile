/**
 * How many of today's mints still reach the home feed. Port of web's
 * MintHomeAllowance.
 *
 * Information only: minting is never blocked by it. Past the number a mint
 * still goes through and shows on the creator's profile, in Following and in
 * the fractions market, it just stays off Home. Renders nothing when the API
 * does not send the mint numbers yet.
 */
import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { getPostQuota, type PostQuotaStatus } from "../../services/post-quota.service";
import { formatCount } from "../../libs/format-count";

type Allowance = Pick<PostQuotaStatus, "mintsPerDay" | "homeMintsRemaining">;

export function MintHomeAllowanceLine({ quota, style }: { quota: Allowance | null | undefined; style?: StyleProp<TextStyle> }) {
  const { t } = useTranslation();
  const total = quota?.mintsPerDay;
  if (typeof total !== "number" || total <= 0) return null;
  const left = Math.max(0, Math.min(total, quota?.homeMintsRemaining ?? total));
  return (
    <Text className="text-white/50 text-xs" style={style} testID="mint-home-allowance">
      {t("mintChain.homeAllowance", {
        defaultValue: "{{left}} of {{total}} mints today reach Home. Extra mints go to your profile and the market.",
        left: formatCount(left),
        total: formatCount(total),
      })}
    </Text>
  );
}

/** The same line, reading the signed-in creator's allowance itself. */
export default function MintHomeAllowance({ enabled = true, style }: { enabled?: boolean; style?: StyleProp<TextStyle> }) {
  const { data } = useQuery({
    queryKey: ["post-quota", "mint-allowance"],
    queryFn: getPostQuota,
    enabled,
    staleTime: 15_000,
  });
  if (!enabled) return null;
  return <MintHomeAllowanceLine quota={data} style={style} />;
}
