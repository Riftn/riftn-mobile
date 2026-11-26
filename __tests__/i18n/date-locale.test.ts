import type { TFunction } from 'i18next';
import { formatPostAge, formatPostDate, parsePostTimestamp } from '../../i18n/post-timestamp';
import { format } from 'date-fns';
import { applyDateLocale, formatRelativeTime } from '../../i18n/date-locale';

afterEach(() => applyDateLocale('en'));
describe('selected-language dates', () => {
  it('keeps Turkish conversation timestamps working without RelativeTimeFormat', () => {
    const original = Intl.RelativeTimeFormat;
    try {
      Object.defineProperty(Intl, 'RelativeTimeFormat', { configurable: true, writable: true, value: undefined });
      expect(formatRelativeTime(Date.now() - 120000, 'tr-TR')).toBe('2 dakika önce');
      expect(formatRelativeTime(null, 'fr')).toBeTruthy();
      expect(formatRelativeTime(Date.now() - 120000, 'unknown')).toBe('2 minutes ago');
    } finally {
      Object.defineProperty(Intl, 'RelativeTimeFormat', { configurable: true, writable: true, value: original });
    }
  });
  it('formats month names using the selected app language', () => {
    applyDateLocale('fr'); expect(format(new Date(2026, 0, 3), 'MMMM')).toBe('janvier');
    applyDateLocale('tr'); expect(format(new Date(2026, 0, 3), 'MMMM')).toBe('Ocak');
  });
  it('localizes relative time and invalid dates without English fallbacks', () => {
    expect(formatRelativeTime(Date.now() - 120000, 'es')).toBe('hace 2 minutos');
    expect(formatRelativeTime(null, 'fr')).toBe('maintenant');
    expect(formatRelativeTime(Date.now() - 120000, 'ar')).toMatch(/[\u0600-\u06ff]/);
  });
});

describe('post timestamps', () => {
  const t = ((key: string) => key) as unknown as TFunction;

  it('formats compact ages in the chosen language', () => {
    const posted = parsePostTimestamp('2026-01-02T04:30:00+03:00');
    const now = Date.parse('2026-01-02T02:30:00Z');
    expect(formatPostAge(posted, 'en', t, now)).toBe('1h ago');
    expect(formatPostAge(posted, 'tr', t, now + 2 * 3600000)).toMatch(/^3\s*sa(?:at)?\.?\s+önce$/);
    expect(formatPostAge(posted, 'ja', t, now)).toMatch(/^1\s*時間前$/);
    expect(formatPostAge(posted, 'tr', t, now - 3600000)).toBe('şimdi');
    expect(formatPostAge(parsePostTimestamp('invalid'), 'tr', t, now)).toBe('');
  });

  it.each([
    [1, '1m ago'],
    [5, '5m ago'],
    [59, '59m ago'],
    [60, '1h ago'],
    [120, '2h ago'],
    [1440, '1d ago'],
    [4320, '3d ago'],
    [10080, '1w ago'],
    [20160, '2w ago'],
  ])('formats a post that is %i minutes old as %s', (minutes, label) => {
    const posted = new Date('2026-01-02T01:30:00Z');
    expect(formatPostAge(posted, 'en', t, posted.getTime() + minutes * 60000)).toBe(label);
  });

  it('shows now during the first minute', () => {
    const posted = new Date('2026-01-02T01:30:00Z');
    expect(formatPostAge(posted, 'en', t, posted.getTime() + 59000)).toBe('now');
  });

  it('uses the same instant across publisher offsets and rolls the local date across midnight', () => {
    const post = parsePostTimestamp('2026-01-01T20:30:00-05:00')!;
    expect(post).toEqual(parsePostTimestamp('2026-01-02T04:30:00+03:00'));
    const options = { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' } as const;
    expect(formatPostDate(post, 'tr', { ...options, timeZone: 'America/Los_Angeles' })).toMatch(/1 Ocak.*17:30/);
    expect(formatPostDate(post, 'tr', { ...options, timeZone: 'Europe/Istanbul' })).toMatch(/2 Ocak.*04:30/);
  });

  it('uses the app translations when the runtime cannot localize an age', () => {
    const translate = jest.fn((key: string, options?: { count?: number; time?: string }) => ({
      'dm.justNow': 'az önce',
      'comments.timeHours': `${options?.count} sa`,
      'stories.agoLabel': `${options?.time} önce`,
    }[key]));
    const lookup = translate as unknown as TFunction;
    const posted = new Date('2026-01-02T01:30:00Z');
    const now = posted.getTime();
    const relative = jest.spyOn(Intl.RelativeTimeFormat, 'supportedLocalesOf').mockReturnValue([]);
    try {
      expect(formatPostAge(posted, 'tr-TR', lookup, now)).toBe('az önce');
      expect(formatPostAge(posted, 'tr-TR', lookup, now + 3 * 3600000)).toBe('3 sa önce');
      expect(translate).toHaveBeenCalledWith('comments.timeHours', { count: 3, defaultValue: '3h' });
    } finally {
      relative.mockRestore();
    }
  });
});
