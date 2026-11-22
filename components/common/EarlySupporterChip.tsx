/**
 * Early supporter chip (mobile)
 * =============================
 * Beside the name on a profile, for anyone with at least one request on the
 * Requests board that shipped (Requests 4dbc2296). Tapping it opens their
 * latest shipped request. Twin of web's components/app/EarlySupporterChip.tsx.
 *
 * The chip came out with a one-day head start for the person who asked for
 * it, so it rides useEarlyAccess like any feature built from a request.
 */
import React, { FC } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { ScreenNames } from "../../navigation/ScreenNames";
import { useEarlyAccess, useEarlySupporter } from "../../hooks/useEarlyAccess";
import { EARLY_SUPPORTER_OPEN_BY, EARLY_SUPPORTER_REQUEST_ID } from "../../libs/early-access";
import { formatCount } from "../../libs/format-count";

interface EarlySupporterChipProps {
  address?: string | null;
  username?: string | null;
}

const EarlySupporterChip: FC<EarlySupporterChipProps> = ({ address, username }) => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const open = useEarlyAccess(EARLY_SUPPORTER_REQUEST_ID, EARLY_SUPPORTER_OPEN_BY);
  const { data } = useEarlySupporter(address, username, open);

  if (!open || !data || data.shipped < 1) return null;

  const label = t("features.earlySupporter.title", {
    defaultValue: "Early supporter: {{value}} of their requests shipped",
    value: formatCount(data.shipped),
  });

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      onPress={() =>
        navigation.navigate(
          ScreenNames.FeatureRequests,
          data.latestId ? { requestId: data.latestId } : undefined,
        )
      }
    >
      {/* Fill on an inner View: Pressable fills get repainted by the tone pass. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          height: 16,
          paddingHorizontal: 6,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.15)",
          backgroundColor: "rgba(255,255,255,0.10)",
        }}
      >
        <Ionicons name="bulb-outline" size={10} color="#FFFFFF" />
        <Text style={{ color: "#FFFFFF", fontSize: 10, lineHeight: 12, fontWeight: "600" }}>
          {t("features.earlySupporter.chip", "Early supporter")}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default React.memo(EarlySupporterChip);
