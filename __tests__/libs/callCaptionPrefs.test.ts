import { renderHook } from '@testing-library/react-native';

// var, not let: the module loads (and calls multiGet) before this line runs.
// eslint-disable-next-line no-var
var mockResolve: (rows: [string, string | null][]) => void;
jest.mock('@react-native-async-storage/async-storage', () => ({
  multiGet: jest.fn(() => new Promise((r) => { mockResolve = r; })),
  setItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../services/supabase', () => ({ supabase: {} }));
jest.mock('../../libs/auth.utils', () => ({ getAuthToken: jest.fn() }));

import { setShowCallCaptions, useCallCaptionPrefs } from '../../libs/callCaptions';

it('keeps a choice made before the saved ones finish loading', async () => {
  setShowCallCaptions(true);
  mockResolve([['riftn.call.captions.show', '0'], ['riftn.call.captions.send', '0'], ['riftn.call.captions.lang', null]]);
  await new Promise((r) => setTimeout(r, 0));
  const { result } = renderHook(() => useCallCaptionPrefs());
  expect(result.current.show).toBe(true);
  // Untouched choices still come from storage.
  expect(result.current.send).toBe(false);
});
