jest.mock(
  'expo-speech',
  () => ({
    speak: jest.fn(),
    stop: jest.fn(() => Promise.resolve()),
    getAvailableVoicesAsync: jest.fn(),
    VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' },
  }),
  { virtual: true },
);

import * as Speech from 'expo-speech';

const mockVoices = Speech.getAvailableVoicesAsync as jest.Mock;

// Fresh module per test: the voice list is cached at module scope.
function load() {
  let mod: typeof import('../../hooks/useVoiceDub');
  jest.isolateModules(() => {
    mod = require('../../hooks/useVoiceDub');
  });
  return mod!;
}

describe('hooks/useVoiceDub', () => {
  beforeEach(() => mockVoices.mockReset());

  describe('speechRate', () => {
    it('speaks at normal speed when the line has room', () => {
      expect(load().speechRate('Hola', 3)).toBe(1);
    });

    it('speeds up for a long line in a short window, but never past 1.5', () => {
      const { speechRate } = load();
      const rate = speechRate('a'.repeat(30), 2);
      expect(rate).toBeGreaterThan(1);
      expect(rate).toBeLessThanOrEqual(1.5);
      expect(speechRate('a'.repeat(300), 1)).toBe(1.5);
    });

    it('reads slower voices faster once they have been timed', () => {
      const { speechRate } = load();
      expect(speechRate('a'.repeat(30), 2, 1, 10)).toBeGreaterThan(speechRate('a'.repeat(30), 2));
    });
  });

  describe('lineRoom', () => {
    it('counts the silence after a line as room, up to a second, and none once it is long past', () => {
      const { lineRoom } = load();
      const lines = [{ start: 0, end: 3, text: 'a' }, { start: 3.4, end: 5, text: 'b' }, { start: 9, end: 10, text: 'c' }];
      expect(lineRoom(lines, 0, 1)).toBeCloseTo(2.4);
      expect(lineRoom(lines, 1, 4.5)).toBeCloseTo(1.5);
      expect(lineRoom(lines, 1, 5.5)).toBeCloseTo(1);
      expect(lineRoom(lines, 1, 8.5)).toBeCloseTo(0);
      expect(lineRoom(lines, 2, 9.5)).toBeCloseTo(1.5);
    });
  });

  it('finds the line under the playhead, and nothing between lines', () => {
    const { segmentIndexAt } = load();
    const segments = [
      { start: 0, end: 2, text: 'one' },
      { start: 3, end: 5, text: 'two' },
    ];
    expect(segmentIndexAt(segments, 1)).toBe(0);
    expect(segmentIndexAt(segments, 2.5)).toBe(-1);
    expect(segmentIndexAt(segments, 4)).toBe(1);
  });

  describe('findVoice', () => {
    it('prefers an enhanced voice for the language', async () => {
      mockVoices.mockResolvedValue([
        { identifier: 'es-basic', language: 'es-ES', quality: 'Default' },
        { identifier: 'es-hq', language: 'es-MX', quality: 'Enhanced' },
        { identifier: 'fr', language: 'fr-FR', quality: 'Enhanced' },
      ]);
      await expect(load().findVoice('es')).resolves.toMatchObject({ identifier: 'es-hq' });
    });

    it('reports no voice when the device has none for the language', async () => {
      mockVoices.mockResolvedValue([{ identifier: 'fr', language: 'fr-FR', quality: 'Default' }]);
      await expect(load().findVoice('tr')).resolves.toBeNull();
    });

    it('does not claim "no voice" when the engine has not listed any yet', async () => {
      mockVoices.mockResolvedValue([]);
      await expect(load().findVoice('tr')).resolves.toBeUndefined();
    });
  });
});
