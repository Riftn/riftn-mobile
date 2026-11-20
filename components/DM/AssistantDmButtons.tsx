/**
 * The assistant's own controls, in the @assistant DM header.
 *
 * Personality and Settings open the same sheets as the Assistant screen and
 * save to the same place (this phone and the account), so the DM answers in
 * the personality and with the chat model picked there.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import Icon from '../ui/Icon';
import AssistantStyleSheet from '../Assistant/AssistantStyleSheet';
import AssistantSettingsSheet, { type AssistantSettings } from '../Assistant/AssistantSettingsSheet';
import { AI_ASSISTANT_STYLE_OPTIONS } from '../../config/ai-styles.constants';
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  currentChatModel,
} from '../../config/ai-models.constants';
import { getAssistantPrefs, saveAssistantPrefs } from '../../services/assistantActions.service';

/** Same key the Assistant screen reads and writes. */
const SETTINGS_KEY = 'dehub-assistant-settings';

const DEFAULT_SETTINGS: AssistantSettings = {
  chatModel: DEFAULT_CHAT_MODEL,
  imageModel: DEFAULT_IMAGE_MODEL,
  videoModel: DEFAULT_VIDEO_MODEL,
  voice: 'female',
  alwaysSpeakReplies: false,
};

const BUTTON = 'w-10 h-10 items-center justify-center active:opacity-70';
const HIT = { top: 8, bottom: 8, left: 4, right: 4 };

export default function AssistantDmButtons() {
  const { t } = useTranslation();
  const [style, setStyle] = useState('normal');
  const [settings, setSettings] = useState<AssistantSettings>(DEFAULT_SETTINGS);
  const [styleOpen, setStyleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => {
        if (!live || !raw) return;
        const parsed = JSON.parse(raw);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings, chatModel: currentChatModel(parsed.settings?.chatModel) });
        if (parsed.style) setStyle(parsed.style);
      })
      .catch(() => {})
      .finally(() => {
        // The account copy wins: it is what this DM answers with.
        getAssistantPrefs()
          .then((p) => {
            if (!live || !p) return;
            if (p.style && AI_ASSISTANT_STYLE_OPTIONS.some((s) => s.id === p.style)) setStyle(p.style);
            if (p.model) setSettings((prev) => ({ ...prev, chatModel: currentChatModel(p.model) }));
          })
          .catch(() => {});
      });
    return () => { live = false; };
  }, []);

  const persist = useCallback((next: AssistantSettings, nextStyle: string) => {
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ settings: next, style: nextStyle })).catch(() => {});
    saveAssistantPrefs({ style: nextStyle, model: next.chatModel }).catch(() => {});
  }, []);

  const pickStyle = useCallback((id: string) => {
    setStyle(id);
    persist(settings, id);
  }, [persist, settings]);

  const changeSettings = useCallback((patch: Partial<AssistantSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      persist(next, style);
      return next;
    });
  }, [persist, style]);

  const current = AI_ASSISTANT_STYLE_OPTIONS.find((s) => s.id === style) || AI_ASSISTANT_STYLE_OPTIONS[0];

  return (
    <View className="flex-row items-center">
      <TouchableOpacity
        className={BUTTON}
        onPress={() => setStyleOpen(true)}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityLabel={t('assistant.aiPersonality')}
      >
        <Text style={{ fontSize: 18 }}>{current.emoji}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        className={BUTTON}
        onPress={() => setSettingsOpen(true)}
        hitSlop={HIT}
        accessibilityRole="button"
        accessibilityLabel={t('assistant.aiSettings')}
      >
        <Icon name="SlidersHorizontal" size={20} color="#E5E7EB" />
      </TouchableOpacity>
      {styleOpen && (
        <AssistantStyleSheet
          visible={styleOpen}
          onClose={() => setStyleOpen(false)}
          selectedStyle={style}
          onSelect={pickStyle}
        />
      )}
      {settingsOpen && (
        <AssistantSettingsSheet
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onChange={changeSettings}
        />
      )}
    </View>
  );
}
