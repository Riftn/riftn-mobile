import { createInstance } from 'i18next';
import { formatCommentTime } from '../../libs/comment-time';
import en from '../../i18n/locales/en.json';
import tr from '../../i18n/locales/tr.json';

it('uses the current language for every row of a comment thread', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'tr', resources: { tr: { translation: tr }, en: { translation: en } } });
  const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);
  expect([1, 2, 3].map(days => formatCommentTime(daysAgo(days), i18n.t))).toEqual(['1G', '2G', '3G']);
  await i18n.changeLanguage('en');
  expect(formatCommentTime(daysAgo(2), i18n.t)).toBe('2d');
  expect(formatCommentTime(undefined, i18n.t)).toBe('');
  expect(formatCommentTime('invalid', i18n.t)).toBe('');
});
