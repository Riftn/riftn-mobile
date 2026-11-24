const mockSetCategory = jest.fn(async () => undefined);
jest.mock('expo-notifications', () => ({ setNotificationCategoryAsync: (...args: unknown[]) => (mockSetCategory as any)(...args) }));
jest.mock('../../libs/storage', () => ({ storage: { getString: jest.fn(), set: jest.fn() } }));
jest.mock('../../libs/push-tap-data', () => ({ readNotificationData: jest.fn() }));

import i18n from 'i18next';
import { registerMessageReplyCategory } from '../../services/push/message-reply';

const lastPlaceholder = () => (mockSetCategory.mock.calls.at(-1) as unknown as [string, unknown, { previewPlaceholder: string }])[2].previewPlaceholder;

beforeAll(async () => { if (!i18n.isInitialized) await i18n.init({ lng: 'en', resources: { en: { translation: {} } } }); });

it('puts the lock-screen line in the reader language once its pack lands after the switch', async () => {
  await i18n.changeLanguage('tr');
  await registerMessageReplyCategory();
  expect(lastPlaceholder()).toBe('New message on Riftn');

  // The pack with these words downloads after the language already switched.
  i18n.addResourceBundle('tr', 'translation', { quickReply: { hiddenPreview: "Riftn'de yeni mesaj" } }, true, true);
  await Promise.resolve();
  expect(lastPlaceholder()).toBe("Riftn'de yeni mesaj");

  const calls = mockSetCategory.mock.calls.length;
  await registerMessageReplyCategory();
  expect(mockSetCategory.mock.calls.length).toBe(calls);
});
