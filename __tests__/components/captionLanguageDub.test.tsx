import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { VideoPlayer } from 'expo-video';
import CaptionOverlay from '../../components/VideoPlayerCore/CaptionOverlay';
jest.mock('../../hooks/useDubDiscovery', () => ({ useDubDiscovery: jest.fn() }));

let mockDubOn = true;
const mockSetDub = jest.fn();
const mockFindVoice = jest.fn((_lang: unknown) => Promise.resolve({ identifier: 'v' }));
let mockSourceLang = '';
jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? children : null,
  StyleSheet: { create: (styles: unknown) => styles, flatten: (styles: unknown) => styles },
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key, i18n: { language: 'es' } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('../../components/common/MediaControlGlyph', () => ({ MediaControlIcon: () => null }));
jest.mock('../../components/VideoPlayerCore/CaptionFixSheet', () => () => null);
jest.mock('../../libs', () => ({ toastInfo: jest.fn() }));
jest.mock('../../libs/video-preferences', () => ({ useMediaVolume: () => 1 }));
jest.mock('../../libs/cached-dub-languages', () => ({ hasCachedDubLanguage: () => false }));
jest.mock('../../hooks/useVideoDub', () => ({ useDubSettings: () => ({ on: mockDubOn, lang: null }), setDubSettings: (...args: unknown[]) => mockSetDub(...args) }));
jest.mock('../../hooks/useVoiceDub', () => ({ useVoiceDub: jest.fn(), baseLang: (lang: string) => (lang ?? '').toLowerCase().split('-')[0], findVoice: (lang: unknown) => mockFindVoice(lang), speechAvailable: false }));
jest.mock('../../hooks/useCachedVideoDub', () => ({ useCachedVideoDub: () => null }));
jest.mock('../../hooks/useCachedDubAudio', () => ({ useCachedDubAudio: jest.fn() }));
jest.mock('../../hooks/useTranscript', () => ({
  useTranscript: () => ({
    status: mockSourceLang ? 'ready' : 'processing',
    transcript: mockSourceLang ? { id: 'transcript', source_lang: mockSourceLang, segments: [] } : null,
    inFlight: !mockSourceLang, canRetry: false,
  }),
  useTranscriptTranslation: () => ({ translation: null }),
}));
jest.mock('../../hooks/useTranscriptCorrections', () => ({ useTranscriptCorrections: () => ({ accepted: new Map() }), applyCorrections: (segments: unknown) => segments }));
jest.mock('../../libs/subtitlePrefs', () => ({
  getSubtitlesEnabled: () => false, getSubtitleLang: () => 'original', getSubtitleSize: () => 'medium',
  SUBTITLE_SIZES: { medium: 16 }, SUBTITLE_LANGUAGES: [{ code: 'original', name: 'Original' }, { code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }],
  setSubtitleLang: jest.fn(), setSubtitlesEnabled: jest.fn(), splitIntoLines: () => [],
}));

beforeEach(() => { mockDubOn = false; mockSourceLang = 'en'; mockSetDub.mockClear(); });

const player = { playing: false, muted: false, addListener: () => ({ remove: jest.fn() }) } as unknown as VideoPlayer;
function openSheet() {
  const screen = render(<CaptionOverlay tokenId={123} positionMs={0} player={player} controlsVisible />);
  fireEvent.press(screen.getByLabelText('Subtitles off'));
  return screen;
}

it('switches the dub on in a foreign language as soon as it is picked', () => {
  const screen = openSheet();
  fireEvent.press(screen.getByText('Spanish'));
  expect(mockSetDub).toHaveBeenLastCalledWith({ on: true, lang: 'es' });
});

it('leaves the original audio alone when the spoken language is picked', () => {
  const screen = openSheet();
  fireEvent.press(screen.getByText('English'));
  expect(mockSetDub).not.toHaveBeenCalled();
});

it('goes back to the original audio when Original is picked with a dub on', () => {
  mockDubOn = true;
  const screen = openSheet();
  fireEvent.press(screen.getByText('Original'));
  expect(mockSetDub).toHaveBeenLastCalledWith({ on: false, lang: null });
});
