jest.mock('react-native-css-interop', () => ({ createInteropElement: require('react').createElement }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('../../context/CallContext', () => ({ useCall: () => ({}) }));
jest.mock('../../libs/logger', () => ({ createLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock('../../services/supabase', () => ({ supabase: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  multiGet: jest.fn(() => Promise.resolve([])),
  setItem: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../libs/auth.utils', () => ({ getAuthToken: jest.fn() }));

import { foldCaption, foldTranslation, type CaptionLine } from '../../hooks/useCallCaptions';

const line = (id: string, text: string, final = false): CaptionLine => ({ id, wallet: '0xa', name: 'a', text, final, at: 0 });

describe('call caption lines', () => {
  it('updates a line in place as it is spoken', () => {
    const one = foldCaption([], line('1', 'hel'));
    const two = foldCaption(one, line('1', 'hello', true));
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ text: 'hello', final: true });
  });

  it('keeps only the newest three lines', () => {
    let lines: CaptionLine[] = [];
    for (const id of ['1', '2', '3', '4']) lines = foldCaption(lines, line(id, id));
    expect(lines.map((l) => l.id)).toEqual(['2', '3', '4']);
  });

  it('attaches translations and keeps them when the line is re-sent', () => {
    const base = foldCaption([], line('1', 'hello', true));
    const translated = foldTranslation(base, { id: '1', translations: { es: 'hola' } });
    expect(translated[0].translations).toEqual({ es: 'hola' });
    const again = foldCaption(translated, line('1', 'hello', true));
    expect(again[0].translations).toEqual({ es: 'hola' });
    expect(foldTranslation(base, { id: 'missing', translations: { es: 'x' } })).toBe(base);
  });
});
