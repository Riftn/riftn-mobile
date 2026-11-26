import { act, renderHook } from '@testing-library/react-native';
import { useVolumeUpUnmute } from '../../libs/volumeKeyUnmute';
import { visualActivity } from '../../libs/visualActivity';
import { setMutedState } from '../../libs/videoMutedState';
import { getVolume, setVolume } from '../../libs/video-preferences';
import { addVolumeKeyListener } from '../../modules/media-bridge';

jest.mock('../../libs/videoMutedState', () => ({ setMutedState: jest.fn() }));
jest.mock('../../libs/video-preferences', () => ({ getVolume: jest.fn(), setVolume: jest.fn() }));
jest.mock('../../modules/media-bridge', () => ({ addVolumeKeyListener: jest.fn() }));

afterEach(() => {
  visualActivity.setStoryViewerOpen(false);
  jest.clearAllMocks();
});

it('leaves background volume and mute preferences alone while a Moment is open', () => {
  let onVolumeChange: Parameters<typeof addVolumeKeyListener>[0] = () => {};
  jest.mocked(addVolumeKeyListener).mockImplementation(listener => {
    onVolumeChange = listener;
    return () => {};
  });
  jest.mocked(getVolume).mockReturnValue(0);
  const unmute = jest.fn();
  const { unmount } = renderHook(() => useVolumeUpUnmute(unmute));

  act(() => visualActivity.setStoryViewerOpen(true));
  expect(visualActivity.isFeedPlaybackAllowed()).toBe(false);
  act(() => onVolumeChange('up'));
  expect(setMutedState).not.toHaveBeenCalled();
  expect(setVolume).not.toHaveBeenCalled();
  expect(unmute).not.toHaveBeenCalled();

  act(() => visualActivity.setStoryViewerOpen(false));
  expect(visualActivity.isFeedPlaybackAllowed()).toBe(true);
  act(() => onVolumeChange('up'));
  expect(setMutedState).toHaveBeenCalledWith(false);
  expect(setVolume).toHaveBeenCalledWith(0.8);
  expect(unmute).toHaveBeenCalledTimes(1);
  unmount();
});
