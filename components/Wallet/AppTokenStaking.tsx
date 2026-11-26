import React, { useRef, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useUser } from "../../context/AuthContext";
import { APP_TOKENS_QUERY_KEY, useAppTokens } from "../../hooks/useAppTokens";
import { useDraftState } from "../../hooks/useDraftState";
import {
  moveAppTokenStake, newAppTokenKey, type AppTokenStakeRequest, type AppTokensAccount,
} from "../../services/app-tokens.service";
import { FIELD_TEXT } from "../../theme/inputs";
import { KitButton } from "../page/PageKit";

export function AppTokenStaking() {
  const user = useUser();
  const address = (user?.walletAddress || user?.address)?.toLowerCase();
  return address ? <StakingForm key={address} address={address} /> : null;
}

function StakingForm({ address }: { address: string }) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useAppTokens();
  const queryClient = useQueryClient();
  const [pending, setPending] = useDraftState<AppTokenStakeRequest | null>("app-token-stake-request", null);
  const [direction, setDirection] = useState<AppTokenStakeRequest["direction"]>(pending?.direction ?? "stake");
  const [amount, setAmount] = useState(pending?.amount ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sending = useRef(false);
  const balance = data?.balance ?? "0";
  const staked = data?.staked ?? "0";
  const max = direction === "stake" ? balance : staked;
  const valid = /^\d+(\.\d{1,6})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= Number(max);
  const stakeLabel = t("staking.appStake", "Stake");
  const unstakeLabel = t("staking.appUnstake", "Unstake");
  const action = direction === "stake" ? stakeLabel : unstakeLabel;

  async function submit() {
    if (sending.current || (!pending && !valid)) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    const request = pending ?? { direction, amount, key: newAppTokenKey() };
    setPending(request);
    try {
      const result = await moveAppTokenStake(request);
      setPending.complete(request, null);
      setAmount("");
      queryClient.setQueryData<AppTokensAccount>([APP_TOKENS_QUERY_KEY, address], current =>
        current ? { ...current, balance: result.balance, staked: result.staked } : current,
      );
      setMessage(request.direction === "stake"
        ? t("appTokens.kindStaked", "Staked")
        : t("appTokens.kindUnstaked", "Unstaked"));
      void queryClient.invalidateQueries({ queryKey: [APP_TOKENS_QUERY_KEY, address] });
    } catch (error) {
      const failure = error as { status?: number; message?: string; code?: string };
      const rejected = [400, 402, 403].includes(failure.status ?? 0) || failure.code === "KEY_REUSED";
      if (rejected) setPending.complete(request, null);
      setMessage(rejected && failure.message
        ? failure.message
        : t("staking.pendingAppStake", "Confirm the result by retrying this request."));
      void refetch();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (isPending && !pending) return <ActivityIndicator color="#fff" />;
  if (isError && !data && !pending) {
    return <KitButton label={t("staking.retryBalance", "Retry loading balances")} onPress={() => void refetch()} />;
  }

  return (
    <View className="gap-4">
      <Text className="text-sm text-white/70">{t("staking.inAppDescription", "Stake from your Riftn wallet. Unstake at any time to make your tokens available again.")}</Text>
      <View className="flex-row gap-3">
        <View className="flex-1"><Text className="text-xs text-white/60">{t("staking.availableTokens", "Available tokens")}</Text><Text className="text-lg font-semibold text-white">{data ? balance : "—"}</Text></View>
        <View className="flex-1"><Text className="text-xs text-white/60">{t("staking.stakedTokens", "Staked tokens")}</Text><Text className="text-lg font-semibold text-white">{data ? staked : "—"}</Text></View>
      </View>
      <View className="flex-row gap-2">
        {(["stake", "unstake"] as const).map(option => (
          <KitButton key={option} variant={direction === option ? "primary" : "quiet"}
            label={option === "stake" ? stakeLabel : unstakeLabel} disabled={!!pending}
            onPress={() => { setDirection(option); setAmount(""); setMessage(""); }} />
        ))}
      </View>
      <View className="flex-row items-center gap-2">
        <TextInput className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white"
          style={FIELD_TEXT} keyboardType="decimal-pad" value={amount} editable={!pending} maxLength={24}
          accessibilityLabel={t("appTokens.amount")} placeholder={t("appTokens.amount")} placeholderTextColor="#aaa"
          onChangeText={value => setAmount(value.replace(",", "."))} />
        <KitButton variant="quiet" label={t("staking.max")} disabled={!!pending || !data} onPress={() => setAmount(max)} />
      </View>
      <KitButton disabled={busy || (!pending && !valid)} onPress={() => void submit()}
        label={busy ? t("common.loading", "Loading…") : pending ? t("staking.retryAction", { action, defaultValue: "Retry {{action}}" }) : action} />
      {!!message && <Text accessibilityLiveRegion="polite" className="text-sm text-white/75">{message}</Text>}
    </View>
  );
}
