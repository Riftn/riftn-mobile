import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusRow } from '../../components/DM/NotesSheet';
import { getNotes, type NoteEntry } from '../../services/notes.service';

jest.mock('../../services/notes.service', () => ({ getNotes: jest.fn() }));
jest.mock('../../services/supabase', () => ({}));
jest.mock('../../libs/supabase-wallet-client', () => ({}));
jest.mock('../../libs/misc', () => ({ getAvatarUrl: () => '' }));
jest.mock('../../libs/toast', () => ({}));
jest.mock('../../context/AuthContext', () => ({}));
jest.mock('../../context/ThemeContext', () => ({ useAppTheme: () => ({ isLight: true }) }));
jest.mock('../../components/common/Avatar', () => () => null);
jest.mock('../../components/common/SmartImage', () => () => null);
jest.mock('../../components/DM/GifPicker', () => () => null);
jest.mock('../../components/Post/SoundPickerSheet', () => () => null);
jest.mock('../../components/DM/note-translate', () => ({ useNoteWords: (text?: string) => ({ shown: text }) }));
jest.mock('expo-audio', () => ({}));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Rect: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue: string }) => options?.defaultValue ?? key }) }));

it('opens a followed account’s status without a matching conversation', async () => {
  const author = { address: '0xabc', username: 'araf', displayName: 'Araf', avatarImageUrl: null };
  const entry: NoteEntry = {
    author,
    note: {
      id: 'status', text: 'hello', gifUrl: null, song: null, location: null,
      postedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  };
  jest.mocked(getNotes).mockResolvedValue({ mine: null, notes: [entry] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const onOpen = jest.fn();
  render(
    <QueryClientProvider client={client}>
      <StatusRow me={{ ...author, address: '0xdef', username: 'viewer', displayName: 'Viewer' }} onOpen={onOpen} />
    </QueryClientProvider>,
  );

  fireEvent.press(await screen.findByRole('button', { name: 'Araf: hello' }));
  expect(onOpen).toHaveBeenCalledWith(entry);
});
