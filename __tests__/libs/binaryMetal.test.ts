import { bytesOf, fileName, positionAt, settingsOf, tabBars, timeline } from '../../libs/binaryMetal';

describe('binary metal maths (matches riftn-web engine.js)', () => {
  it('turns text into UTF-8 bytes', () => {
    expect(bytesOf('Hi').map((b) => b.bits)).toEqual(['01001000', '01101001']);
    expect(bytesOf('é').map((b) => b.bits)).toEqual(['11000011', '10101001']);
    expect(bytesOf('🤘')).toHaveLength(4);
  });

  it('caps tempo and falls back to the style tempo', () => {
    expect(settingsOf({ style: 'doom' }).bpm).toBe(90);
    expect(settingsOf({ style: 'blast', bpm: 999 }).bpm).toBe(240);
    expect(settingsOf({ style: 'nope' as never }).style).toBe('thrash');
  });

  it('places the playhead after the count-in', () => {
    const opts = { style: 'thrash' as const, bpm: 180 };
    const tl = timeline('A', opts);
    expect(tl.lead).toBeCloseTo(8 * (60 / 180 / 2));
    expect(positionAt('A', opts, 0)).toBeNull();
    expect(positionAt('A', opts, tl.lead + 0.01)).toEqual({ byte: 0, bit: 0 });
    expect(positionAt('A', opts, tl.end)).toBeNull();
  });

  it('writes 0 open and 1 first fret on the low string, power chords above', () => {
    const [bar] = tabBars('A', { tuning: 'e-standard', power: true });
    expect(bar[5].join('')).toBe('01000001');
    expect(bar[4].join('')).toBe('23222223');
    expect(bar[0].join('')).toBe('--------');
  });

  it('names files like the web', () => {
    expect(fileName('Riftn rules!', { style: 'doom' }, 'mp3')).toBe('riftn-rules-doom.mp3');
    expect(fileName('', { style: 'thrash' }, 'wav')).toBe('riff-thrash.wav');
  });
});
