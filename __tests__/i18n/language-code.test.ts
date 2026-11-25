import { normalizeLanguageCode } from '../../i18n/language-code';

describe('normalizeLanguageCode', () => {
  it.each(['zh-Hant', 'zh-TW', 'zh_tw', 'zh-Hant-HK', 'zh-MO'])(
    'keeps Traditional Chinese distinct for %s',
    (locale) => expect(normalizeLanguageCode(locale)).toBe('zh_tw'),
  );

  it.each([['zh-CN', 'zh'], ['zh-Hans', 'zh'], ['pt-BR', 'pt'], ['en-US', 'en']])(
    'resolves %s to %s',
    (locale, expected) => expect(normalizeLanguageCode(locale)).toBe(expected),
  );
});
