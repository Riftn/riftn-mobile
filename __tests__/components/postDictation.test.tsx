import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { PostDictationButton } from '../../components/Upload/PostDictationButton';
import type { VoiceNoteResult } from '../../hooks/useVoiceRecorder';

jest.mock('react-native', () => ({
  Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', Text: 'Text',
  StyleSheet: { flatten: (style: unknown) => style },
}));
jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../components/ui/Icon', () => () => null);
jest.mock('../../libs/toast', () => ({ toastError: jest.fn() }));
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
const mockTranscribe = jest.fn();
const mockDelete = jest.fn(async (_uri: string, _options: { idempotent: boolean }) => {});
const mockStart = jest.fn();
let mockFinish: (take: VoiceNoteResult) => Promise<void>;
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: async () => ({ exists: true, size: 200 }),
  deleteAsync: (uri: string, options: { idempotent: boolean }) => mockDelete(uri, options),
}));
jest.mock('../../services/creator-audio.service', () => ({ runCreatorAudio: (...args: unknown[]) => mockTranscribe(...args) }));
jest.mock('../../hooks/useVoiceRecorder', () => ({
  useVoiceRecorder: (handlers: { onRecordingComplete: typeof mockFinish }) => {
    mockFinish = handlers.onRecordingComplete;
    return { isRecording: false, startRecording: mockStart };
  },
}));
const take = { uri: 'file:///recording.m4a', durationMs: 1200, mimeType: 'audio/mp4' };
beforeEach(() => { mockFocused = true; jest.clearAllMocks(); });

it('transcribes a take into a draft and removes the temporary recording', async () => {
  const append = jest.fn();
  mockTranscribe.mockResolvedValue({ transcript: 'नमस्ते مرحبًا' });
  const view = render(<PostDictationButton wallet="alice" maxChars={50} setText={append} atLimit={false} />);
  fireEvent.press(view.getByLabelText('copy.abfe6d40e5fc'));
  expect(mockStart).toHaveBeenCalled();
  await act(async () => { await mockFinish(take); });
  expect(mockTranscribe).toHaveBeenCalledWith('', {
    task: 'transcribe', plainDictation: true, media: { uri: take.uri, size: 200, mimeType: take.mimeType, name: 'dictation.m4a' },
  }, 'alice');
  const update = append.mock.calls[0][0];
  expect(update('typed while waiting')).toBe('typed while waiting नमस्ते مرحبًا');
  expect(update('x'.repeat(50))).toBe('x'.repeat(50));
  expect(mockDelete).toHaveBeenCalledWith(take.uri, { idempotent: true });
});

it('discards a transcription if its composer loses focus before it resolves', async () => {
  let finish!: (value: unknown) => void;
  mockTranscribe.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const append = jest.fn();
  const view = render(<PostDictationButton wallet="alice" maxChars={50} setText={append} atLimit={false} />);
  let pending!: Promise<void>;
  await act(async () => { pending = mockFinish(take); });
  mockFocused = false;
  view.rerender(<PostDictationButton wallet="alice" maxChars={50} setText={append} atLimit={false} />);
  await act(async () => { finish({ transcript: 'late' }); await pending; });
  expect(append).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledWith(take.uri, { idempotent: true });
});
