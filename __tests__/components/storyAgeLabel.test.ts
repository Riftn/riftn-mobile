jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));
jest.mock('expo/virtual/env', () => ({ env: process.env }));

import i18n from '../../i18n';
import { ageLabel } from '../../components/Stories/story-utils';

const now = Date.parse('2026-11-24T12:00:00Z');
const ago = (ms: number) => new Date(now - ms).toISOString();

afterEach(async () => { await i18n.changeLanguage('en'); });

it('prints the short English ages', () => {
  expect(ageLabel(ago(10_000), now)).toBe('now');
  expect(ageLabel(ago(3 * 60_000), now)).toBe('3m');
  expect(ageLabel(ago(5 * 3_600_000), now)).toBe('5h');
});

it('says "now" in the reader\'s language', async () => {
  i18n.addResourceBundle('tr', 'translation', { comments: { timeMinutes: '{{count}} dk', timeHours: '{{count}} sa' } }, true, true);
  await i18n.changeLanguage('tr');
  expect(ageLabel(ago(10_000), now)).toBe('şimdi');
  expect(ageLabel(ago(3 * 60_000), now)).toBe('3 dk');
  expect(ageLabel(ago(9 * 3_600_000), now)).toBe('9 sa');
});
