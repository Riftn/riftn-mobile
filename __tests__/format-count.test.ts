import { formatCount, shortenCounterPlaceholder } from '../libs/format-count';
import { formatCompactNumber } from '../libs/numbers.util';

describe('formatCount', () => {
  it('keeps small counts whole', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(40)).toBe('40');
    expect(formatCount(999)).toBe('999');
  });

  it('shortens big counts', () => {
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(1200)).toBe('1.2K');
    expect(formatCount(15420)).toBe('15.4K');
    expect(formatCount(999_950)).toBe('1M');
    expect(formatCount(3_400_000)).toBe('3.4M');
    expect(formatCount(2_500_000_000)).toBe('2.5B');
  });

  it('reads numbers passed as text and leaves short text alone', () => {
    expect(formatCount('1200')).toBe('1.2K');
    expect(formatCount('1,200')).toBe('1.2K');
    expect(formatCount('1.2K')).toBe('1.2K');
    expect(formatCount(null)).toBe('0');
  });

  it('matches the older compact helper for big numbers', () => {
    expect(formatCompactNumber(1200)).toBe('1.2K');
    expect(formatCompactNumber(999_950)).toBe('1M');
  });

  it('shortens counter placeholders in copy only', () => {
    expect(shortenCounterPlaceholder(1200, undefined, 'en', { interpolationkey: 'count' })).toBe('1.2K');
    expect(shortenCounterPlaceholder(1200, undefined, 'en', { interpolationkey: 'amount' })).toBe(1200);
  });
});
