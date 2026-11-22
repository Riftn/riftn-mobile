import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { runCreatorAudio } from '../../services/creator-audio.service';
import { enhanceText } from '../../services/ai.service';
import { keepsMeaning, tidyDictationLocally } from '../../libs/dictationTidy';
import { toastError } from '../../libs/toast';
import Icon from '../ui/Icon';

/** A press shorter than this is a tap: it keeps recording until the next tap. */
const TAP_MS = 350;

type Props = {
  wallet?: string;
  /** Gets the tidy text once the take is written up. */
  onText: (text: string) => void;
  disabled?: boolean;
  /** Runs instead of recording, e.g. to open sign-in. Return true to stop. */
  beforeStart?: () => boolean;
};

export default function HoldToTalkButton(props: Props) {
  const focused = useIsFocused();
  return focused ? <HoldToTalkControl {...props} /> : null;
}

/**
 * Hold the mic, talk, let go: the take is written up as tidy text.
 * A quick tap keeps it recording until the next tap, which also covers the
 * microphone permission prompt taking the finger off the button.
 */
function HoldToTalkControl({ wallet, onText, disabled, beforeStart }: Props) {
  const { t } = useTranslation();
  const [working, setWorking] = useState(false);
  const [locked, setLocked] = useState(false);
  const pressedAt = useRef(0);
  const holding = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(onText);
  latest.current = onText;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const recorder = useVoiceRecorder({
    maxDurationMs: 120_000,
    onCancel: () => { if (mounted.current) setLocked(false); },
    onRecordingComplete: async ({ uri, mimeType }) => {
      setLocked(false);
      setWorking(true);
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists) throw new Error(t('creator.audioNeedsFile'));
        const { transcript } = await runCreatorAudio('', {
          task: 'transcribe', plainDictation: true,
          media: { uri, mimeType, size: info.size, name: 'dictation.m4a' },
        }, wallet);
        const spoken = tidyDictationLocally(transcript ?? '');
        if (!spoken) throw new Error(t('creator.audioNoSpeech'));
        let text = spoken;
        try {
          const better = await enhanceText(spoken, 'grammar');
          if (keepsMeaning(spoken, better)) text = better;
        } catch { /* The spoken words are already clean enough to keep. */ }
        if (mounted.current) latest.current(text);
      } catch (error) {
        if (mounted.current) toastError(error instanceof Error ? error.message : t('copy.ccb684944295'));
      } finally {
        if (mounted.current) setWorking(false);
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    },
  });

  const recording = recorder.isRecording;
  const onPressIn = () => {
    if (disabled || working || recorder.isStopping) return;
    if (recording || locked) { void recorder.stopRecording(); return; }
    if (beforeStart?.()) return;
    pressedAt.current = Date.now();
    holding.current = true;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    void recorder.startRecording();
  };
  const onPressOut = () => {
    if (!holding.current) return;
    holding.current = false;
    // Short press, or the mic is still being allowed: keep going until a tap.
    if (Date.now() - pressedAt.current < TAP_MS || !recorder.isRecording) { setLocked(true); return; }
    void recorder.stopRecording();
  };

  const seconds = Math.floor(recorder.elapsedMs / 1000);
  const label = working
    ? t('features.voiceWorking', 'Writing it up…')
    : recording
      ? (locked ? t('features.voiceTapDone', 'Tap when done') : t('features.voiceLetGo', 'Let go to add'))
      : t('features.voiceHold', 'Hold to talk');

  return (
    <Pressable testID="request-hold-to-talk" accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ busy: working, selected: recording }}
      disabled={(disabled && !recording) || working}
      onPressIn={onPressIn} onPressOut={onPressOut} hitSlop={6}
      style={(disabled && !recording) ? styles.disabled : undefined}>
      <View style={[styles.pill, recording && styles.pillLive]}>
        {working
          ? <ActivityIndicator size="small" />
          : recording
            ? <View style={styles.dot} />
            : <Icon name="Mic" size={18} color="#A1A1AA" />}
        <Text style={[styles.text, recording && styles.textLive]} numberOfLines={1}>{label}</Text>
        {recording && <Text style={[styles.text, styles.textLive]}>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
  pillLive: { backgroundColor: 'hsla(0, 84%, 60%, 0.15)', borderWidth: 1, borderColor: 'hsla(0, 84%, 60%, 0.45)' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444', marginHorizontal: 4 },
  text: { color: '#A1A1AA', fontSize: 13 },
  textLive: { color: '#F87171', fontVariant: ['tabular-nums'] },
  disabled: { opacity: 0.5 },
});
