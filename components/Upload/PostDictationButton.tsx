import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as FileSystem from 'expo-file-system/legacy';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { runCreatorAudio } from '../../services/creator-audio.service';
import { toastError } from '../../libs/toast';
import Icon from '../ui/Icon';

type Props = {
  wallet: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  maxChars: number;
  atLimit: boolean;
};

export function PostDictationButton(props: Props) {
  const focused = useIsFocused();
  return focused ? <DictationControl {...props} /> : null;
}

function DictationControl({ wallet, setText, maxChars, atLimit }: Props) {
  const { t } = useTranslation();
  const [transcribing, setTranscribing] = useState(false);
  const active = useRef(false);
  const latest = useRef({ setText, maxChars });
  latest.current = { setText, maxChars };
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const recorder = useVoiceRecorder({
    maxDurationMs: 120_000,
    onCancel: () => {},
    onRecordingComplete: async ({ uri, mimeType }) => {
      setTranscribing(true);
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists) throw new Error(t('creator.audioNeedsFile'));
        if (!active.current) return;
        const { transcript } = await runCreatorAudio('', {
          task: 'transcribe', plainDictation: true,
          media: { uri, mimeType, size: info.size, name: 'dictation.m4a' },
        }, wallet);
        if (!active.current || !transcript) return;
        const current = latest.current;
        current.setText(previous => {
          if (previous.length >= current.maxChars) return previous;
          const spacer = previous && !/\s$/.test(previous) ? ' ' : '';
          return (previous + spacer + transcript).slice(0, current.maxChars);
        });
      } catch (error) {
        if (active.current) toastError(error instanceof Error ? error.message : t('copy.ccb684944295'));
      } finally {
        if (active.current) setTranscribing(false);
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    },
  });

  const label = transcribing ? t('copy.4e9a93669648') : recorder.isRecording ? t('editor.voiceClone.stop') : t('copy.abfe6d40e5fc');
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      disabled={transcribing || recorder.isStopping || (atLimit && !recorder.isRecording)}
      onPress={recorder.isRecording ? recorder.stopRecording : recorder.startRecording}
      className="flex-row items-center gap-1 px-3 py-2 mr-2">
      {transcribing ? <ActivityIndicator size="small" /> : <Icon name={recorder.isRecording ? 'Square' : 'Mic'} size={18} color={recorder.isRecording ? '#ef4444' : '#a1a1aa'} />}
      <Text className="text-theme-neutrals-400 text-xs" numberOfLines={1}>{recorder.isRecording
        ? `${Math.floor(recorder.elapsedMs / 60_000)}:${String(Math.floor(recorder.elapsedMs / 1000) % 60).padStart(2, '0')}`
        : label}</Text>
    </Pressable>
  );
}
