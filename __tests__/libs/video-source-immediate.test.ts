import { Platform } from 'react-native';
import { replaceVideoSource } from '../../libs/video-source';

describe('replaceVideoSource immediate', () => {
  const os = Platform.OS;
  afterEach(() => { (Platform as any).OS = os; });

  const player = () => ({ replace: jest.fn(), replaceAsync: jest.fn(() => Promise.resolve()) });

  it('attaches a web address at once on iPhone, without the warning', async () => {
    (Platform as any).OS = 'ios';
    const p = player();
    await replaceVideoSource(p as any, 'https://cdn.example/v/master.m3u8', { immediate: true });
    expect(p.replace).toHaveBeenCalledWith('https://cdn.example/v/master.m3u8', true);
    expect(p.replaceAsync).not.toHaveBeenCalled();
  });

  it('keeps replaceAsync for clearing, local files, Android and when not asked', async () => {
    (Platform as any).OS = 'ios';
    for (const [source, options] of [[null, { immediate: true }], ['file:///a.mp4', { immediate: true }], ['https://x/a.mp4', undefined]] as const) {
      const p = player();
      await replaceVideoSource(p as any, source as any, options);
      expect(p.replace).not.toHaveBeenCalled();
      expect(p.replaceAsync).toHaveBeenCalledTimes(1);
    }
    (Platform as any).OS = 'android';
    const p = player();
    await replaceVideoSource(p as any, 'https://x/a.mp4', { immediate: true });
    expect(p.replace).not.toHaveBeenCalled();
  });

  it('falls back to replaceAsync if the quick way throws', async () => {
    (Platform as any).OS = 'ios';
    const p = player();
    p.replace.mockImplementation(() => { throw new Error('released'); });
    await replaceVideoSource(p as any, 'https://x/a.mp4', { immediate: true });
    expect(p.replaceAsync).toHaveBeenCalledTimes(1);
  });
});
