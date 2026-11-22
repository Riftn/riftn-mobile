import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { useUser, useAuthActions } from "../../context/AuthContext";
import { AuthService } from "../../services/auth.service";
import { getAccountProfile } from "../../services/user.service";
import { toastError, toastSuccess } from "../../libs/toast";
import {
  BUSINESS_CATEGORIES,
  CREATOR_CATEGORIES,
  isValidContactEmail,
  readAccountCategory,
  readAccountType,
  readContactEmail,
  type AccountType,
} from "../../libs/account-type";

const TYPES: { id: AccountType; icon: string }[] = [
  { id: "personal", icon: "User" },
  { id: "creator", icon: "Star" },
  { id: "business", icon: "Briefcase" },
];

/**
 * Edit profile > Account type: Personal, Creator or Business, a category under
 * the name, and (Business) a public contact email. Saves on its own, merged
 * into the freshly read `customs` (the API replaces the blob wholesale).
 */
export default function AccountTypeSection() {
  const { t } = useTranslation();
  const user = useUser();
  const { patchUser } = useAuthActions();
  const stored = (user?.customs ?? {}) as Record<string, unknown>;
  const [type, setType] = useState<AccountType>(readAccountType(stored));
  const [category, setCategory] = useState<string | null>(readAccountCategory(stored));
  const [email, setEmail] = useState(readContactEmail(stored) ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setType(readAccountType(stored));
    setCategory(readAccountCategory(stored));
    setEmail(readContactEmail(stored) ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.address]);

  const dirty =
    type !== readAccountType(stored) ||
    category !== readAccountCategory(stored) ||
    (type === "business" && email.trim() !== (readContactEmail(stored) ?? ""));
  const categories: readonly string[] = type === "creator" ? CREATOR_CATEGORIES : type === "business" ? BUSINESS_CATEGORIES : [];
  const emailOk = isValidContactEmail(email);

  const save = async () => {
    if (!user?.address || !emailOk || saving) return;
    setSaving(true);
    try {
      const account = await getAccountProfile(user.address);
      const base = ((account?.customs ?? stored) || {}) as Record<string, unknown>;
      const next: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(base)) {
        if (["accountType", "accountCategory", "contactEmail"].includes(key)) continue;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") next[key] = value;
      }
      if (type !== "personal") next.accountType = type;
      if (type !== "personal" && category) next.accountCategory = category;
      if (type === "business" && email.trim()) next.contactEmail = email.trim();
      await AuthService.updateProfile({ customs: JSON.stringify(next) });
      await patchUser({ customs: next } as any);
      toastSuccess(t("accountType.saved"));
    } catch {
      toastError(t("accountType.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="mt-2" style={{ gap: 10 }}>
      <View>
        <Text className="text-white text-sm">{t("accountType.title")}</Text>
        <Text className="text-neutral-400 text-xs mt-1">{t("accountType.hint")}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup">
        {TYPES.map(({ id, icon }) => {
          const on = type === id;
          return (
            <TouchableOpacity
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              activeOpacity={0.8}
              onPress={() => { if (id !== type) setCategory(null); setType(id); }}
              style={{ flex: 1 }}
            >
              <View
                style={{
                  minHeight: 64,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: on ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)",
                  backgroundColor: on ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Icon name={icon as any} size={20} color={on ? "#FFFFFF" : "rgba(255,255,255,0.7)"} />
                <Text style={{ color: on ? "#FFFFFF" : "rgba(255,255,255,0.75)", fontSize: 13, fontWeight: "500" }}>
                  {t(`accountType.type.${id}`)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      {categories.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text className="text-neutral-400 text-xs font-medium">{t("accountType.category")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {categories.map((id) => {
              const on = category === id;
              return (
                <TouchableOpacity
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  activeOpacity={0.8}
                  onPress={() => setCategory(on ? null : id)}
                >
                  <View
                    style={{
                      minHeight: 36,
                      paddingHorizontal: 12,
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: on ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)",
                      backgroundColor: on ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: on ? "#FFFFFF" : "rgba(255,255,255,0.75)", fontSize: 13 }}>{t(`accountType.cat.${id}`)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
      {type === "business" && (
        <View style={{ gap: 6 }}>
          <Text className="text-neutral-400 text-xs font-medium">{t("accountType.contactEmail")}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t("accountType.contactEmailPlaceholder")}
            placeholderTextColor="rgba(255,255,255,0.4)"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white text-sm"
          />
          {!emailOk && <Text style={{ color: "#F87171", fontSize: 12 }}>{t("accountType.badEmail")}</Text>}
        </View>
      )}
      {dirty && (
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.85} disabled={saving || !emailOk} onPress={() => void save()}>
          <View style={{ minHeight: 44, borderRadius: 12, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", opacity: saving || !emailOk ? 0.5 : 1 }}>
            {saving ? <ActivityIndicator color="#000000" /> : <Text style={{ color: "#000000", fontSize: 14, fontWeight: "600" }}>{t("accountType.save")}</Text>}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}
