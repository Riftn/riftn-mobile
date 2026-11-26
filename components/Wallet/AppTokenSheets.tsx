import React, { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Image, ScrollView, Keyboard } from "react-native";
import Animated, { FadeInDown, ReduceMotion, ZoomIn } from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import GlassModal from "../ui/GlassModal";
import AccentButtonGradient from "../ui/AccentButtonGradient";
import { DhbCoin } from "../common/DhbCoin";
import { sanitizeAmountInput } from "../../libs/amount-input";
import { APP_TOKENS_QUERY_KEY, useAppTokens } from "../../hooks/useAppTokens";
import { useUser } from "../../context/AuthContext";
import {
  findAppTokenRecipient, newAppTokenKey, sendAppTokens,
  type AppTokenEntry, type AppTokenPerson,
} from "../../services/app-tokens.service";

/**
 * App tokens: DHB held on Riftn, not on a chain. The send sheet moves app
 * tokens to another account and never touches a chain; the history sheet
 * shows the balance and every movement. Mirrors web AppTokens.tsx.
 */

const fmt = (amount: string | number) =>
  Number(amount).toLocaleString(undefined, { maximumFractionDigits: 6 });

function personName(p?: AppTokenPerson) {
  if (!p) return "";
  return p.username ? `@${p.username}` : `${p.address.slice(0, 6)}…${p.address.slice(-4)}`;
}

export const AppTokenSendSheet: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useAppTokens(open);
  const user = useUser();
  const walletAddress = user?.walletAddress || user?.address;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const amountInput = useRef<TextInput>(null);
  const [recipient, setRecipient] = useState<AppTokenPerson | null>(null);
  const [looking, setLooking] = useState(false);
  const [sending, setSending] = useState(false);
  const [step, setStep] = useState<"details" | "review" | "sent">("details");
  const [receipt, setReceipt] = useState<{ balance: string; to: AppTokenPerson; amount: string } | null>(null);
  const [sendError, setSendError] = useState("");
  const inFlight = useRef(false);
  // One key per attempt: kept across a retry of the same send, replaced once it lands.
  const keyRef = useRef(newAppTokenKey());

  const balance = Number(data?.balance ?? 0);
  const value = Number(amount);
  const tooMuch = value > balance;
  const canSend = !!recipient && !looking && /^\d+(\.\d{1,6})?$/.test(amount) && value >= 1 && !tooMuch;
  const remaining = (Math.round(balance * 1_000_000) - Math.round(value * 1_000_000)) / 1_000_000;
  const tokenSymbol = data?.symbol === "RIFT" ? "RIFT" : t("staking.tokensUnit", "tokens");
  const stepTitle = step === "review" ? t("appTokens.reviewTransfer", "Review transfer")
    : step === "sent" ? t("appTokens.transferComplete", "Transfer complete")
    : t("appTokens.sendTitle");

  useEffect(() => {
    setRecipient(null);
    setLooking(false);
    const text = to.trim();
    if (text.length < 2) return;
    let cancelled = false;
    setLooking(true);
    const timer = setTimeout(async () => {
      try {
        const found = await findAppTokenRecipient(text);
        if (!cancelled) setRecipient(found);
      } catch {
        if (!cancelled) setRecipient(null);
      } finally {
        if (!cancelled) setLooking(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [to]);

  // A changed send is a new send, so it gets a new key.
  useEffect(() => { keyRef.current = newAppTokenKey(); }, [to, amount, note]);

  const close = () => {
    if (inFlight.current) return;
    setStep("details");
    setReceipt(null);
    setSendError("");
    onClose();
  };

  const send = async () => {
    if (!recipient || inFlight.current || step !== "review") return;
    inFlight.current = true;
    setSending(true);
    setSendError("");
    try {
      const result = await sendAppTokens({ to: recipient.address, amount, key: keyRef.current, purpose: "transfer", note: note.trim() || undefined });
      setReceipt({ ...result, amount });
      setStep("sent");
      setTo("");
      setAmount("");
      setNote("");
      setShowNote(false);
      const queryKey = [APP_TOKENS_QUERY_KEY, walletAddress?.toLowerCase() ?? null];
      queryClient.setQueryData<typeof data>(queryKey, current => current ? { ...current, balance: result.balance } : current);
      void queryClient.invalidateQueries({ queryKey });
    } catch (err: any) {
      const code = err?.code;
      setSendError(
        code === "INSUFFICIENT" ? t("appTokens.errorInsufficient")
          : code === "RATE_LIMIT" ? t("appTokens.errorRateLimit")
          : code === "NO_RECIPIENT" ? t("appTokens.errorNoRecipient")
          : code === "SELF" ? t("appTokens.errorSelf")
          : err?.message || t("appTokens.errorGeneric"),
      );
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  return (
    <GlassModal visible={open} onClose={close} presentation="bottom" scrollable dismissible={!sending}>
      <View className="gap-4 px-5 pb-4 pt-2">
        <Text accessibilityRole="header" className="text-2xl font-bold text-white">{stepTitle}</Text>
        {step === "details" && <>
        <Text className="text-sm text-white/60">{t("appTokens.sendHint")}</Text>
        <View>
          <Text className="text-white text-base font-semibold mb-2">{t("appTokens.to")}</Text>
          <TextInput
            placeholder={t("appTokens.toPlaceholder")}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholderTextColor="#8B8D90"
            value={to}
            onChangeText={value => { setRecipient(null); setTo(value); }}
            accessibilityLabel={t("appTokens.to")}
            returnKeyType="next"
            onSubmitEditing={() => amountInput.current?.focus()}
            className="border border-theme-neutrals-700 rounded-lg px-3 h-12 text-white text-base"
          />
          {looking ? (
            <Text className="text-xs text-white/60 mt-2">{t("appTokens.looking")}</Text>
          ) : recipient ? (
            <View className="flex-row items-center gap-2 mt-2">
              {recipient.avatarImageUrl
                ? <Image source={{ uri: recipient.avatarImageUrl }} className="w-6 h-6 rounded" />
                : <Ionicons name="person-circle-outline" size={22} color="#aaa" />}
              <Text className="text-sm text-white" numberOfLines={1}>{recipient.displayName || personName(recipient)}</Text>
              {!!recipient.displayName && <Text className="text-xs text-white/50" numberOfLines={1}>{personName(recipient)}</Text>}
            </View>
          ) : to.trim().length >= 2 ? (
            <Text className="text-xs text-white/60 mt-2">{t("appTokens.errorNoRecipient")}</Text>
          ) : null}
        </View>
        <View>
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-base text-white">{t("appTokens.amount")}</Text>
            <View className="flex-row items-center gap-2">
              <Text className="text-xs text-white/60">{t("appTokens.available", { amount: fmt(balance) })}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={() => setAmount(data?.balance ?? "0")} className="min-h-[44px] justify-center px-2">
                <Text className="text-sm font-semibold text-white">{t("staking.max", "Max")}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TextInput
            ref={amountInput}
            keyboardType="decimal-pad"
            accessibilityLabel={t("appTokens.amount")}
            placeholder="0"
            placeholderTextColor="#8B8D90"
            value={amount}
            onChangeText={(v) => setAmount(sanitizeAmountInput(v, 6))}
            className="border border-theme-neutrals-700 rounded-lg px-3 h-12 text-white text-base"
          />
          {tooMuch && <Text className="text-xs text-white/80 mt-1">{t("appTokens.errorInsufficient")}</Text>}
          {value > 0 && value < 1 && <Text className="mt-1 text-xs text-white/60">{t("appTokens.minimumTransfer", "Minimum transfer is 1 RIFT.")}</Text>}
          {showNote ? <TextInput
            accessibilityLabel={t("appTokens.notePlaceholder")}
            placeholder={t("appTokens.notePlaceholder")}
            placeholderTextColor="#8B8D90"
            value={note}
            maxLength={140}
            onChangeText={setNote}
            className="border border-theme-neutrals-700 rounded-lg px-3 h-12 text-white text-base mt-3"
          /> : (
            <TouchableOpacity accessibilityRole="button" onPress={() => setShowNote(true)} className="min-h-[44px] self-start justify-center">
              <Text className="text-sm text-white/65">{t("appTokens.addNote", "Add a note")}</Text>
            </TouchableOpacity>
          )}
        </View>
        <AccentButtonGradient>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !canSend }}
            disabled={!canSend} onPress={() => { Keyboard.dismiss(); setSendError(""); setStep("review"); }}
            className={`min-h-[52px] flex-row items-center justify-center gap-2 ${!canSend ? "opacity-60" : ""}`}>
            <Text className="font-semibold text-white">{t("appTokens.reviewTransfer", "Review transfer")}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </AccentButtonGradient>
        </>}

        {step === "review" && recipient && <>
          <View className="items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
            {recipient.avatarImageUrl
              ? <Image source={{ uri: recipient.avatarImageUrl }} className="h-11 w-11 rounded-full" />
              : <Ionicons name="person-circle-outline" size={39} color="#aaa" />}
            <Text className="text-center text-3xl font-semibold text-white">{fmt(amount)} {tokenSymbol}</Text>
            <Text className="text-center text-sm text-white/65">{recipient.displayName || personName(recipient)}{recipient.displayName && recipient.username ? " · " + personName(recipient) : ""}</Text>
          </View>
          {!!note.trim() && <Text className="text-sm text-white/65">{note.trim()}</Text>}
          <Text className="text-sm text-white/65">{t("appTokens.balanceAfterSend", { amount: fmt(remaining), symbol: tokenSymbol, defaultValue: "After sending: {{amount}} {{symbol}}" })}</Text>
          {!!sendError && <Text accessibilityRole="alert" className="text-sm text-red-300">{sendError}</Text>}
          <AccentButtonGradient>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: sending, busy: sending }} disabled={sending}
              onPress={() => void send()} className="min-h-[52px] flex-row items-center justify-center gap-2">
              {sending && <ActivityIndicator color="#fff" />}
              <Text className="font-semibold text-white">{sending ? t("wallet.sending") : t("appTokens.sendButton")}</Text>
            </TouchableOpacity>
          </AccentButtonGradient>
          <TouchableOpacity accessibilityRole="button" disabled={sending} onPress={() => setStep("details")}
            className="min-h-[44px] items-center justify-center">
            <Text className="font-semibold text-white/70">{t("common.edit", "Edit")}</Text>
          </TouchableOpacity>
        </>}

        {step === "sent" && receipt && (
          <Animated.View entering={FadeInDown.duration(230).reduceMotion(ReduceMotion.System)} className="gap-4 py-3">
            <Animated.View entering={ZoomIn.springify().damping(15).reduceMotion(ReduceMotion.System)}
              className="h-[76px] w-[76px] items-center justify-center self-center rounded-full border border-emerald-400/25 bg-emerald-400/15">
              <Ionicons name="checkmark" size={41} color="#6ee7b7" />
            </Animated.View>
            <View accessibilityLiveRegion="polite" className="items-center gap-1">
              <Text className="text-center text-3xl font-semibold text-white">{fmt(receipt.amount)} {tokenSymbol}</Text>
              <Text className="text-center text-sm text-white/65">{t("appTokens.sent", { amount: fmt(receipt.amount), name: personName(receipt.to) })}</Text>
            </View>
            <Text className="text-center text-sm text-white/65">{t("appTokens.available", { amount: fmt(receipt.balance) })}</Text>
            <AccentButtonGradient>
              <TouchableOpacity accessibilityRole="button" onPress={close} className="min-h-[52px] items-center justify-center">
                <Text className="font-semibold text-white">{t("common.done", "Done")}</Text>
              </TouchableOpacity>
            </AccentButtonGradient>
          </Animated.View>
        )}
      </View>
    </GlassModal>
  );
};

function EntryRow({ entry }: { entry: AppTokenEntry }) {
  const { t } = useTranslation();
  const who = personName(entry.counterparty);
  const label = {
    opening: t("appTokens.kindOpening"),
    send: t("appTokens.kindSent", { name: who }),
    receive: t("appTokens.kindReceived", { name: who }),
    spend: t("appTokens.kindSpent"),
    refund: t("appTokens.kindRefund"),
    deposit: t("appTokens.kindDeposit"),
    adjust: t("appTokens.kindAdjust"),
    stake: t("appTokens.kindStaked", "Staked"),
    unstake: t("appTokens.kindUnstaked", "Unstaked"),
  }[entry.kind];
  const positive = !entry.amount.startsWith("-");
  return (
    <View className="flex-row items-center justify-between gap-3 py-2.5 border-b border-white/5">
      <View className="flex-1 min-w-0">
        <Text className="text-sm text-white" numberOfLines={1}>{label}</Text>
        <Text className="text-[11px] text-white/50" numberOfLines={1}>
          {new Date(entry.at).toLocaleString()}{entry.note ? ` · ${entry.note}` : ""}
        </Text>
      </View>
      <Text className={`text-sm font-medium ${positive ? "text-emerald-400" : "text-white"}`}>
        {positive ? "+" : "−"}{fmt(entry.amount.replace("-", ""))} <DhbCoin />
      </Text>
    </View>
  );
}

export const AppTokenHistorySheet: React.FC<{ open: boolean; onClose: () => void; onSend: () => void }> = ({ open, onClose, onSend }) => {
  const { t } = useTranslation();
  const { data, isLoading } = useAppTokens(open);
  return (
    <GlassModal visible={open} onClose={onClose} presentation="bottom" scrollable>
      <View className="p-5 gap-4">
        <Text className="text-white font-bold text-xl">{data?.symbol === "RIFT" ? "$RIFT" : t("appTokens.title")}</Text>
        <View className="rounded-xl bg-white/5 border border-white/10 p-4">
          <Text className="text-2xl font-bold text-white">{fmt(data?.balance ?? 0)} <DhbCoin /></Text>
          {Number(data?.staked) > 0 && (
            <Text className="text-sm text-white/70 mt-2">{t("appTokens.stakedBalance", { amount: fmt(data?.staked ?? "0"), defaultValue: "{{amount}} staked" })}</Text>
          )}
          <Text className="text-[12px] leading-5 text-white/50 mt-2">{t("appTokens.explainer")}</Text>
        </View>
        <TouchableOpacity onPress={() => { onClose(); onSend(); }} className="h-11 rounded-xl bg-theme-neutrals-700 flex-row items-center justify-center gap-2">
          <Ionicons name="arrow-up" size={16} color="#fff" />
          <Text className="text-white font-semibold">{t("assets.send")}</Text>
        </TouchableOpacity>
        <Text className="text-[11px] uppercase tracking-wide text-white/50">{t("appTokens.history")}</Text>
        {isLoading ? <ActivityIndicator color="#aaa" /> : data?.entries?.length ? (
          <ScrollView style={{ maxHeight: 360 }}>
            {data.entries.map((e, i) => <EntryRow key={`${e.at}-${i}`} entry={e} />)}
          </ScrollView>
        ) : (
          <Text className="text-sm text-white/50">{t("appTokens.noHistory")}</Text>
        )}
      </View>
    </GlassModal>
  );
};
