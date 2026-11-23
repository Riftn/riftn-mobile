import { renderHook } from '@testing-library/react-native';

const mockReportError = jest.fn();
jest.mock('../../libs/errorReporter', () => ({ reportError: (...args: unknown[]) => mockReportError(...args) }));
jest.mock('../../modules/media-bridge', () => ({ memoryFootprintMB: () => 412 }));

import { noteShortsViewerOpened, useStuckShortReport } from '../../hooks/useStuckShortReport';

function fakePlayer(time = 0) {
  return { currentTime: time, bufferedPosition: time + 2, playing: true, status: 'readyToPlay' } as any;
}

describe('useStuckShortReport', () => {
  beforeEach(() => { jest.useFakeTimers(); mockReportError.mockClear(); noteShortsViewerOpened(); });
  afterEach(() => { jest.useRealTimers(); });

  it('reports a Short that sits still for 2 s, then how long it took to start', () => {
    const player = fakePlayer();
    renderHook(() => useStuckShortReport(player, true, { postId: 7, source: 'https://cdn/x/master.m3u8', wanted: () => true, firstFrame: () => true, detail: () => ({ asked: true }) }));
    jest.advanceTimersByTime(1500);
    expect(mockReportError).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(mockReportError).toHaveBeenCalledTimes(1);
    const [component, [message], { metadata }] = mockReportError.mock.calls[0];
    expect(component).toBe('ShortsViewer');
    expect(message).toBe('short stuck');
    expect(metadata).toMatchObject({ postId: 7, swipe: 1, kind: 'hls', asked: true, memoryMB: 412, bankedAhead: 2 });
    player.currentTime = 0.5;
    jest.advanceTimersByTime(500);
    expect(mockReportError).toHaveBeenCalledTimes(2);
    expect(mockReportError.mock.calls[1][1][0]).toBe('short stuck then started');
  });

  it('says nothing for a Short that starts, or one the viewer paused', () => {
    const moving = fakePlayer();
    renderHook(() => useStuckShortReport(moving, true, { source: 'a.mp4', wanted: () => true, firstFrame: () => true }));
    jest.advanceTimersByTime(500);
    moving.currentTime = 0.4;
    jest.advanceTimersByTime(5000);
    const paused = fakePlayer();
    renderHook(() => useStuckShortReport(paused, true, { source: 'b.mp4', wanted: () => false, firstFrame: () => true }));
    jest.advanceTimersByTime(16000);
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('reports one that never starts', () => {
    renderHook(() => useStuckShortReport(fakePlayer(), true, { source: 'c.mp4', wanted: () => true, firstFrame: () => false }));
    jest.advanceTimersByTime(16000);
    expect(mockReportError.mock.calls.map((call) => call[1][0])).toEqual(['short stuck', 'short stuck never started']);
  });
});
