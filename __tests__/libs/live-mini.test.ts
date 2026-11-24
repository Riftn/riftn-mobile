import { closeLiveMini, closeOtherLiveMini, getLiveMini, openLiveMini, setLiveMiniMode, setLiveMiniSeat, takeLiveMiniSeat } from '../../libs/live-mini';

const base = { url: 'https://x/a.m3u8', title: 'Live', host: '@a', params: {}, mode: 'video' as const, countsAsViewer: true };

describe('live mini', () => {
  afterEach(() => closeLiveMini());

  it('keeps the handed-over seat and gives it up when closed', () => {
    const seat = jest.fn();
    openLiveMini({ ...base, streamId: 's1', release: seat });
    expect(getLiveMini()?.release).toBe(seat);
    closeLiveMini();
    expect(seat).toHaveBeenCalledTimes(1);
    expect(getLiveMini()).toBeNull();
  });

  it('hands the seat back to a viewer of the same live without leaving', () => {
    const seat = jest.fn();
    openLiveMini({ ...base, streamId: 's1', release: seat });
    expect(takeLiveMiniSeat('s2')).toBeNull();
    expect(takeLiveMiniSeat('s1')).toBe(seat);
    closeLiveMini();
    expect(seat).not.toHaveBeenCalled();
  });

  it('closes a different live, but not the same one', () => {
    const seat = jest.fn();
    openLiveMini({ ...base, streamId: 's1', release: seat });
    closeOtherLiveMini('s1');
    expect(getLiveMini()?.streamId).toBe('s1');
    closeOtherLiveMini('s2');
    expect(getLiveMini()).toBeNull();
    expect(seat).toHaveBeenCalledTimes(1);
  });

  it('swaps in a fresh seat after a reconnect', () => {
    const first = jest.fn();
    const second = jest.fn();
    openLiveMini({ ...base, streamId: 's1', release: first });
    setLiveMiniSeat('s1', second);
    expect(first).toHaveBeenCalledTimes(1);
    closeLiveMini();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('switches between the window and the listen bar', () => {
    openLiveMini({ ...base, streamId: 's1' });
    setLiveMiniMode('listen');
    expect(getLiveMini()?.mode).toBe('listen');
    setLiveMiniMode('video', true);
    expect(getLiveMini()?.float).toBe(true);
  });
});
