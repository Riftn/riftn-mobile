import { behindForRatio, behindFromOffset, formatBehind, isBehindLive, snapFor, TIMESHIFT_WINDOW_SEC } from '../../libs/liveTimeshift';

describe('live timeshift', () => {
  it('places the viewer on the last three minutes', () => {
    expect(snapFor(0, false).ratio).toBe(1);
    expect(snapFor(90, true)).toEqual({ behind: 90, ratio: 0.5, paused: true });
    expect(snapFor(TIMESHIFT_WINDOW_SEC * 2, false).ratio).toBe(0);
  });

  it('maps the line back to seconds', () => {
    expect(behindForRatio(0.5)).toBe(90);
    expect(behindForRatio(2)).toBe(0);
  });

  it('does not count normal HLS latency as behind', () => {
    expect(behindFromOffset(6, 5)).toBe(1);
    expect(behindFromOffset(48, 6)).toBe(42);
    expect(behindFromOffset(4, null)).toBe(0);
    expect(isBehindLive({ behind: 2 })).toBe(false);
    expect(isBehindLive({ behind: 4 })).toBe(true);
  });

  it('writes the gap the way the tag shows it', () => {
    expect(formatBehind(42)).toBe('−0:42');
    expect(formatBehind(125)).toBe('−2:05');
  });
});
