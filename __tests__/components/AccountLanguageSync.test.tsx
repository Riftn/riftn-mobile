import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));

const mockLang = { language: 'en' };
let mockReady = false;
let mockResolve: () => void = () => {};
const mockReadyPromise = new Promise<void>(resolve => { mockResolve = () => { mockReady = true; resolve(); }; });
const mockUpdate = jest.fn((_body: { preferredLanguage: string }) => Promise.resolve());

jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: mockLang }) }));
jest.mock('../../i18n', () => ({
  isLanguageReady: () => mockReady,
  get languageReady() { return mockReadyPromise; },
}));
jest.mock('../../context/AuthContext', () => ({
  useAuthState: () => ({ isSignedIn: true }),
  useUser: () => ({ walletAddress: '0xABC', preferredLanguage: 'tr' }),
}));
jest.mock('../../services/auth.service', () => ({ AuthService: { updateProfile: (body: { preferredLanguage: string }) => mockUpdate(body) } }));

import AccountLanguageSync from '../../components/common/AccountLanguageSync';

let tree: ReactTestRenderer | undefined;
afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

it('does not report the English the app boots in before the reader language loads', async () => {
  await act(async () => { tree = create(<AccountLanguageSync />); });
  expect(mockUpdate).not.toHaveBeenCalled();

  // The Turkish pack loads: the account already says Turkish, so nothing is sent.
  mockLang.language = 'tr';
  await act(async () => { mockResolve(); await mockReadyPromise; });
  act(() => tree!.update(<AccountLanguageSync />));
  expect(mockUpdate).not.toHaveBeenCalled();

  // A real pick of another language is still reported.
  mockLang.language = 'es';
  act(() => tree!.update(<AccountLanguageSync />));
  expect(mockUpdate).toHaveBeenCalledWith({ preferredLanguage: 'es' });
});
