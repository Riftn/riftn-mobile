import { setPlayerProp } from '../../libs/playerProps';

describe('setPlayerProp', () => {
  it('writes only when the value changes', () => {
    let writes = 0;
    let rate = 1;
    const player: any = { get playbackRate() { return rate; }, set playbackRate(v: number) { writes++; rate = v; } };
    setPlayerProp(player, 'playbackRate', 1);
    expect(writes).toBe(0);
    setPlayerProp(player, 'playbackRate', 1.5);
    setPlayerProp(player, 'playbackRate', 1.5);
    expect(writes).toBe(1);
  });

  it('ignores a released player', () => {
    const player: any = { get muted() { throw new Error('released'); } };
    expect(() => setPlayerProp(player, 'muted', true)).not.toThrow();
    expect(() => setPlayerProp(null, 'muted', true)).not.toThrow();
  });
});
