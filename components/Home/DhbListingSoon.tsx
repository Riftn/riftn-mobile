import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { KitButton, PageSection } from "../page/PageKit";
import TickerLogo from "../Search/TickerLogo";
import TokenLaunchNotify from "../TokenLaunch/TokenLaunchNotify";
import { RIFT_REFERENCE_PRICE } from "../../libs/dhb-listing";

type Detail = "info" | "contract" | "buy";

export function DhbListingSoon({ showSymbol = true }: { showSymbol?: boolean }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<Detail | null>(null);
  const actions = [
    { key: "info", label: t("tokenLaunch.tickerInfo", "Info") },
    { key: "contract", label: t("tokenLaunch.tickerContract", "Contract address") },
    { key: "buy", label: t("tokenLaunch.tickerBuy", "Buy") },
  ] as const;

  return (
    <>
      <PageSection>
        <View testID="rift-ticker" style={styles.content}>
          <View style={styles.identity}>
            <TickerLogo symbol="RIFT" size={36} />
            <View>
              {showSymbol && <Text className="text-white font-semibold">$RIFT</Text>}
              <Text className="text-white font-semibold">{RIFT_REFERENCE_PRICE}</Text>
              <Text className="text-theme-neutrals-400 text-xs">{t("tokenLaunch.referencePrice", "In-app reference price")}</Text>
            </View>
          </View>
          <View style={styles.actions}>
            {actions.map(({ key, label }) => (
              <KitButton key={key} label={label} variant={detail === key ? "primary" : "quiet"}
                onPress={() => setDetail(current => current === key ? null : key)} />
            ))}
          </View>
          {detail === "info" && (
            <Text accessibilityLiveRegion="polite" className="text-white text-sm">{t("tokenLaunch.eyebrow", "Coming soon")}</Text>
          )}
          {detail === "contract" && (
            <Text accessibilityLiveRegion="polite" className="text-white text-sm">{t("tokenLaunch.contractPending", "To be confirmed")}</Text>
          )}
        </View>
      </PageSection>
      {detail === "buy" && <TokenLaunchNotify />}
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12 },
  identity: { flexDirection: "row", alignItems: "center", gap: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});
