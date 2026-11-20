/**
 * Live Studio's chat bot on a phone. The twin of riftn-web's StreamBotPanel:
 * a co-host for the creator's own stream chat that says hi to new people,
 * answers questions from what the creator writes here, catches late joiners
 * up and wakes a quiet chat. Off until switched on.
 */
import React, { useEffect, useState } from "react";
import { Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "../../libs";
import {
  getMyStreamBot,
  saveMyStreamBot,
  STREAM_BOT_ABOUT_MAX,
  type StreamBotChattiness,
  type StreamBotPersonality,
  type StreamBotSettings,
} from "../../services/livechat.service";
import { Chips, Label } from "./WidgetSettingsForm";

const myStreamBotKey = ["my-stream-bot"] as const;
const PERSONALITIES: StreamBotPersonality[] = ["chill", "hype", "funny", "formal"];
const CHATTINESS: StreamBotChattiness[] = ["quiet", "normal", "lots"];

function Row({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View className={`flex-row items-center justify-between gap-4 ${disabled ? "opacity-50" : ""}`}>
      <View className="flex-1">
        <Text className="text-white text-sm font-medium">{label}</Text>
        {hint ? <Text className="text-theme-neutrals-500 text-xs mt-1">{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

export function StreamBotEditor() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: myStreamBotKey, queryFn: getMyStreamBot, staleTime: 15_000 });
  const [settings, setSettings] = useState<StreamBotSettings | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && !dirty) setSettings(data);
  }, [data, dirty]);

  const save = useMutation({
    mutationFn: (next: StreamBotSettings) => saveMyStreamBot(next),
    onSuccess: (saved) => {
      queryClient.setQueryData(myStreamBotKey, saved);
      setSettings(saved);
      setDirty(false);
      toastSuccess(t("liveStudio.bot.saved"));
    },
    onError: () => toastError(t("liveStudio.bot.saveFailed")),
  });

  const change = (patch: Partial<StreamBotSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setDirty(true);
  };

  if (isLoading) return null;
  if (isError || !settings) {
    return <Text className="text-theme-neutrals-400 text-sm">{t("liveStudio.bot.loadFailed")}</Text>;
  }

  return (
    <View className="gap-4">
      <Text className="text-theme-neutrals-500 text-xs">{t("liveStudio.bot.intro")}</Text>
      <Row
        label={t("liveStudio.bot.enabled")}
        hint={t("liveStudio.bot.enabledHint")}
        value={settings.enabled}
        // On/off saves straight away: it is the one setting people flip mid-stream.
        onChange={(v) => {
          const next = { ...settings, enabled: v };
          setSettings(next);
          save.mutate(next);
        }}
      />

      <View className={settings.enabled ? "gap-4" : "gap-4 opacity-60"}>
        <View>
          <Label>{t("liveStudio.bot.about")}</Label>
          <TextInput
            className="rounded-xl border border-theme-neutrals-700 bg-theme-neutrals-800 px-3 py-2 text-white text-sm"
            multiline
            maxLength={STREAM_BOT_ABOUT_MAX}
            value={settings.about}
            placeholder={t("liveStudio.bot.aboutPlaceholder")}
            placeholderTextColor="hsla(0, 0%, 60%, 1)"
            onChangeText={(about) => change({ about })}
            style={{ minHeight: 96, textAlignVertical: "top" }}
          />
          <Text className="text-theme-neutrals-500 text-xs mt-1.5">
            {t("liveStudio.bot.aboutHint")} · {settings.about.length}/{STREAM_BOT_ABOUT_MAX}
          </Text>
        </View>
        <View>
          <Label>{t("liveStudio.bot.personality")}</Label>
          <Chips
            value={settings.personality}
            options={PERSONALITIES.map((p) => ({ value: p, label: t(`liveStudio.bot.personalities.${p}`) }))}
            onChange={(personality) => change({ personality })}
          />
        </View>
        <View>
          <Label>{t("liveStudio.bot.chattiness")}</Label>
          <Chips
            value={settings.chattiness}
            options={CHATTINESS.map((c) => ({ value: c, label: t(`liveStudio.bot.chattinessLevels.${c}`) }))}
            onChange={(chattiness) => change({ chattiness })}
          />
        </View>
        <Row label={t("liveStudio.bot.greet")} hint={t("liveStudio.bot.greetHint")} value={settings.greet} onChange={(greet) => change({ greet })} />
        <Row label={t("liveStudio.bot.answer")} hint={t("liveStudio.bot.answerHint")} value={settings.answer} onChange={(answer) => change({ answer })} />
        <Row label={t("liveStudio.bot.catchUp")} hint={t("liveStudio.bot.catchUpHint")} value={settings.catchUp} onChange={(catchUp) => change({ catchUp })} />
        <Row
          label={t("liveStudio.bot.wakeQuiet")}
          hint={t("liveStudio.bot.wakeQuietHint")}
          value={settings.wakeQuiet && settings.chattiness !== "quiet"}
          disabled={settings.chattiness === "quiet"}
          onChange={(wakeQuiet) => change({ wakeQuiet })}
        />
        <Row
          label={t("liveStudio.bot.commandButtons")}
          hint={t("liveStudio.bot.commandButtonsHint")}
          value={settings.commandButtons}
          onChange={(commandButtons) => change({ commandButtons })}
        />
      </View>

      <Text className="text-theme-neutrals-500 text-xs">{t("liveStudio.bot.safety")}</Text>

      <View className="flex-row items-center justify-end gap-3">
        {dirty ? <Text className="text-theme-neutrals-400 text-xs">{t("liveStudio.unsaved")}</Text> : null}
        <TouchableOpacity
          disabled={!dirty || save.isPending}
          onPress={() => save.mutate(settings)}
          className={`px-4 h-9 rounded-xl bg-white items-center justify-center ${!dirty || save.isPending ? "opacity-40" : ""}`}
        >
          <Text className="text-black text-xs font-semibold">{save.isPending ? t("liveStudio.saving") : t("liveStudio.bot.save")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
