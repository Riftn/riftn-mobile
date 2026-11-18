/**
 * Settings → Reset wallet. Same flow as the web's Settings row: makes a new
 * built-in wallet and moves this account (username, posts, followers,
 * messages) onto it, proved by the account's email, phone or Google sign-in.
 * See libs/wallet-core/settings-reset.ts for the rules.
 */
import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import GlassModal from "../ui/GlassModal";
import Icon from "../ui/Icon";
import { useAuthActions } from "../../context/AuthContext";
import { AuthButton, AuthErrorNotice, AuthField, AuthTextButton, authColors, authText } from "../auth/AuthControls";
import { assessPassword, MIN_PASSWORD_LENGTH } from "../../libs/wallet-core/passwordStrength";
import { resetWalletFromSettings, RESET_NEEDS_LOGIN } from "../../libs/wallet-core/settings-reset";
import { TWO_FACTOR_REQUIRED_CODE } from "../../libs/two-factor-login";
import { toastSuccess } from "../../libs";

type Props = { visible: boolean; onClose: () => void; currentAddress: string };

const ResetWalletModal: React.FC<Props> = ({ visible, onClose, currentAddress }) => {
  const { t } = useTranslation();
  const { signInWithWallet, signOut } = useAuthActions();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (busy) return;
    setPassword(""); setConfirm(""); setAcknowledged(false); setTwoFactorCode("");
    setNeedsTwoFactor(false); setNeedsLogin(false); setError(null);
    onClose();
  }, [busy, onClose]);

  const submit = useCallback(async () => {
    setError(null);
    if (password !== confirm) {
      setError(t("resetWallet.mismatch", { defaultValue: "Passwords don't match" }));
      return;
    }
    setBusy(true);
    try {
      const assessment = await assessPassword(password);
      if (!assessment.longEnough) throw new Error(t("resetWallet.tooShort", { defaultValue: "Password must be at least {{count}} characters", count: MIN_PASSWORD_LENGTH }));
      if (assessment.breached === true) throw new Error(t("resetWallet.breached", { defaultValue: "This password has appeared in a data breach. Choose a different one" }));
      if (!assessment.acceptable) throw new Error(t("resetWallet.weak", { defaultValue: "Choose a stronger password (mix letters, numbers and symbols)" }));
      await resetWalletFromSettings({
        fromAddress: currentAddress,
        password,
        twoFactorCode: needsTwoFactor ? twoFactorCode : undefined,
        signInWithWallet,
      });
      toastSuccess(t("resetWallet.doneTitle", { defaultValue: "Your account is on its new wallet" }));
      setBusy(false);
      setPassword(""); setConfirm(""); setAcknowledged(false); setTwoFactorCode(""); setNeedsTwoFactor(false);
      onClose();
      return;
    } catch (e: any) {
      if (e?.code === TWO_FACTOR_REQUIRED_CODE) {
        setNeedsTwoFactor(true);
        setError(t("resetWallet.twoFactor", { defaultValue: "Enter the code from your authenticator app to move your account." }));
      } else if (e?.code === RESET_NEEDS_LOGIN || e?.code === "WALLET_NOT_LINKED") {
        setNeedsLogin(true);
      } else {
        setError(e?.message || t("resetWallet.failed", { defaultValue: "Could not reset your wallet. Nothing was moved. Try again." }));
      }
    }
    setBusy(false);
  }, [password, confirm, needsTwoFactor, twoFactorCode, currentAddress, signInWithWallet, onClose, t]);

  return (
    <GlassModal visible={visible} onClose={close} presentation="center" maxHeight="85%" blurIntensity={30}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
        <Text style={[authText.title, { textAlign: "center", marginBottom: 12 }]}>
          {t("resetWallet.title", { defaultValue: "Reset wallet" })}
        </Text>
        {needsLogin ? (
          <View>
            <Text style={[authText.body, { marginBottom: 16 }]}>
              {t("resetWallet.reloginApp", { defaultValue: "A reset is proved with your account's email, phone or Google sign-in, not the old wallet, because anyone holding the old key could sign too. Log out, log back in with that sign-in, then come back here. No sign-in email yet? Add one on riftn.com under Settings → Sign-in first." })}
            </Text>
            <AuthButton
              variant="primary"
              label={t("resetWallet.logOut", { defaultValue: "Log out" })}
              onPress={() => { close(); void signOut(); }}
            />
          </View>
        ) : (
          <View>
            <Text style={[authText.body, { marginBottom: 12 }]}>
              {t("resetWallet.intro", { defaultValue: "Makes a new Riftn wallet and moves your username, posts, followers and messages onto it. Use this if your wallet is lost or someone else has its key. The old wallet stops working for sign-in." })}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, borderWidth: 1, borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.1)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <Icon name="TriangleAlert" size={16} color="#fbbf24" />
              <Text style={[authText.caption, { flex: 1, color: authColors.label }]}>
                {t("resetWallet.funds", { defaultValue: "Tokens, NFTs and other balances do not move. They stay at the old address. If you can still open the old wallet, send them out first." })}
              </Text>
            </View>
            <AuthField
              value={password}
              onChangeText={setPassword}
              placeholder={t("resetWallet.password", { defaultValue: "New wallet password (min {{count}} chars)", count: MIN_PASSWORD_LENGTH })}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="newPassword"
              containerStyle={{ marginBottom: 10 }}
            />
            <AuthField
              value={confirm}
              onChangeText={setConfirm}
              placeholder={t("resetWallet.confirm", { defaultValue: "Confirm password" })}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="newPassword"
              containerStyle={{ marginBottom: 10 }}
            />
            {needsTwoFactor && (
              <AuthField
                value={twoFactorCode}
                onChangeText={setTwoFactorCode}
                placeholder={t("resetWallet.twoFactorPlaceholder", { defaultValue: "Authenticator code" })}
                keyboardType="number-pad"
                containerStyle={{ marginBottom: 10 }}
              />
            )}
            <TouchableOpacity
              onPress={() => setAcknowledged((v) => !v)}
              disabled={busy}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acknowledged }}
            >
              <View style={{ width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: authColors.label, alignItems: "center", justifyContent: "center", backgroundColor: acknowledged ? authColors.label : "transparent" }}>
                {acknowledged && <Icon name="Check" size={14} color="#000" />}
              </View>
              <Text style={[authText.caption, { flex: 1 }]}>
                {t("resetWallet.ack", { defaultValue: "I understand my old funds stay in the old wallet." })}
              </Text>
            </TouchableOpacity>
            <AuthErrorNotice message={error} style={{ marginBottom: 12 }} />
            <AuthButton
              variant="primary"
              label={t("resetWallet.submit", { defaultValue: "Reset wallet" })}
              loading={busy}
              disabled={busy || !password || !confirm || !acknowledged || (needsTwoFactor && !twoFactorCode.trim())}
              onPress={() => { void submit(); }}
            />
            <AuthTextButton label={t("resetWallet.cancel", { defaultValue: "Cancel" })} onPress={close} disabled={busy} style={{ marginTop: 8 }} />
          </View>
        )}
      </ScrollView>
    </GlassModal>
  );
};

export default ResetWalletModal;
