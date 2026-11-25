import { formatDistance, setDefaultOptions } from 'date-fns';
// One file per language: the 'date-fns/locale' index pulls in all ~100
// languages (about 1 MB of app code) and only these are used.
import { ar } from 'date-fns/locale/ar';
import { es } from 'date-fns/locale/es';
import { fr } from 'date-fns/locale/fr';
import { nl } from 'date-fns/locale/nl';
import { tr } from 'date-fns/locale/tr';
import { enUS } from 'date-fns/locale/en-US';
import { zhCN } from 'date-fns/locale/zh-CN';
import { zhTW } from 'date-fns/locale/zh-TW';
import { normalizeLanguageCode } from './language-code';

const locales = { ar, es, fr, nl, tr, zh: zhCN, zh_tw: zhTW };
export function applyDateLocale(language: string): void {
  setDefaultOptions({ locale: locales[normalizeLanguageCode(language) as keyof typeof locales] || enUS });
}

export function formatRelativeTime(input: string | number | Date | null | undefined, language: string, style: 'long' | 'short' | 'narrow' = 'long'): string {
  const value = input == null ? NaN : new Date(input).getTime();
  const elapsed = Number.isFinite(value) ? Math.max(0, Date.now() - value) : 0;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86400000], ['month', 30 * 86400000], ['week', 7 * 86400000],
    ['day', 86400000], ['hour', 3600000], ['minute', 60000],
  ];
  const [unit, size] = units.find(([, duration]) => elapsed >= duration) || ['second', Infinity];
  try {
    return new Intl.RelativeTimeFormat(language.replace('_', '-'), { numeric: 'auto', style })
      .format(-Math.floor(elapsed / size), unit);
  } catch {
    // Hermes builds can omit RelativeTimeFormat entirely. Retrying it in
    // English throws again and takes down every translated conversation row.
    const locale = locales[normalizeLanguageCode(language) as keyof typeof locales] || enUS;
    const now = Date.now();
    return formatDistance(new Date(now - elapsed), new Date(now), { locale, addSuffix: true });
  }
}
