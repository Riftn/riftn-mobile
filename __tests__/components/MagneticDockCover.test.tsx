import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import MagneticDockCover from '../../components/common/MagneticDockCover';
import { registerDockTarget } from '../../libs/magneticDock';

let mockReduced = false;
let mockWidth = 390;
const mockMotions: { duration: number; complete: (result: { finished: boolean }) => void; stop: jest.Mock }[] = [];
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('../../screens/SplashScreen', () => 'SplashScreen');
jest.mock('react-native', () => ({
  View: 'View', Image: 'Image',
  useWindowDimensions: () => ({ width: mockWidth, height: 844 }),
  StyleSheet: { absoluteFill: { position: 'absolute', inset: 0 } },
  Easing: { bezier: () => 'easing', out: () => 'easing', cubic: 'cubic' },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(mockReduced),
    addEventListener: () => ({ remove: jest.fn() }),
  },
  Animated: {
    View: 'AnimatedView', Image: 'AnimatedImage',
    Value: class { interpolate(config: unknown) { return config; } stopAnimation() {} },
    timing: (_value: unknown, config: { duration: number }) => {
      const stop = jest.fn();
      return { stop, start: (complete: (result: { finished: boolean }) => void) => mockMotions.push({ duration: config.duration, complete, stop }) };
    },
  },
}));

let tree: ReactTestRenderer;
let unregister: (() => void) | undefined;
const hide = jest.fn();
const done = jest.fn();
beforeEach(() => { jest.useFakeTimers(); mockReduced = false; mockWidth = 390; mockMotions.length = 0; hide.mockClear(); done.mockClear(); });
afterEach(() => { act(() => tree?.unmount()); unregister?.(); unregister = undefined; jest.clearAllTimers(); jest.useRealTimers(); });

async function launch(measureHost = true) {
  await act(async () => {
    tree = create(<MagneticDockCover enabled reveal={false} onComplete={done} />, {
      createNodeMock: () => ({ measureInWindow: (callback: (x: number, y: number) => void) => { if (measureHost) callback(0, 24); } }),
    });
  });
  await act(async () => { tree.update(<MagneticDockCover enabled reveal onComplete={done} />); });
}
function register() {
  unregister = registerDockTarget(callback => callback({ x: 174, y: 48, width: 42, height: 36, tint: '#111', hide }));
}

it('hides the real mark during flight and restores it exactly once at landing', async () => {
  register();
  await launch();
  expect(hide).toHaveBeenCalledWith(true);
  expect(mockMotions[0].duration).toBe(950);
  act(() => mockMotions[0].complete({ finished: true }));
  expect(hide).toHaveBeenLastCalledWith(false);
  act(() => jest.advanceTimersByTime(2000));
  expect(done).toHaveBeenCalledTimes(1);
});

it('crossfades without hiding the header when reduced motion is enabled', async () => {
  mockReduced = true;
  register();
  await launch();
  expect(mockMotions[0].duration).toBe(420);
  expect(hide).not.toHaveBeenCalled();
});

it('crossfades when no focused logo exists and releases a stalled host measurement', async () => {
  await launch();
  expect(mockMotions[0].duration).toBe(420);
  act(() => tree.unmount());
  register();
  await launch(false);
  act(() => jest.advanceTimersByTime(1400));
  expect(done).toHaveBeenCalledTimes(1);
});

it('restores the real mark and cancels pending work when entry unmounts', async () => {
  register();
  await launch();
  act(() => tree.unmount());
  expect(hide).toHaveBeenLastCalledWith(false);
  act(() => jest.advanceTimersByTime(2000));
  expect(done).not.toHaveBeenCalled();
});

it('releases the cover when rotation changes the landing coordinates', async () => {
  register();
  await launch();
  mockWidth = 844;
  await act(async () => { tree.update(<MagneticDockCover enabled reveal onComplete={done} />); });
  expect(hide).toHaveBeenLastCalledWith(false);
  expect(done).toHaveBeenCalledTimes(1);
});

describe('early flight', () => {
  const early = { x: 174, y: 24, tint: '#111', delayMs: 300 };
  const mock = { createNodeMock: () => ({ measureInWindow: (callback: (x: number, y: number) => void) => callback(0, 24) }) };
  async function startEarly() {
    await act(async () => { tree = create(<MagneticDockCover enabled={false} reveal={false} onComplete={done} />, mock); });
    await act(async () => { tree.update(<MagneticDockCover enabled={false} reveal={false} early={early} onComplete={done} />); });
  }

  it('starts the flight before the page is ready, wait included, and leaves the header alone', async () => {
    register();
    await startEarly();
    expect(mockMotions).toHaveLength(1);
    expect(mockMotions[0].duration).toBe(1250);
    expect(hide).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it('hands over to the header logo once the page is ready and the flight has landed', async () => {
    register();
    await startEarly();
    await act(async () => { tree.update(<MagneticDockCover enabled reveal early={early} onComplete={done} />); });
    expect(hide).toHaveBeenCalledWith(true);
    act(() => mockMotions[1].complete({ finished: true }));
    expect(done).not.toHaveBeenCalled();
    act(() => mockMotions[0].complete({ finished: true }));
    expect(hide).toHaveBeenLastCalledWith(false);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('keeps the cover until the page is ready when the flight lands first', async () => {
    register();
    await startEarly();
    act(() => mockMotions[0].complete({ finished: true }));
    expect(done).not.toHaveBeenCalled();
    await act(async () => { tree.update(<MagneticDockCover enabled reveal early={early} onComplete={done} />); });
    act(() => mockMotions[1].complete({ finished: true }));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('fades the logo out over the page when the header logo is not where it was', async () => {
    unregister = registerDockTarget(callback => callback({ x: 60, y: 48, width: 42, height: 36, tint: '#111', hide }));
    await startEarly();
    await act(async () => { tree.update(<MagneticDockCover enabled reveal early={early} onComplete={done} />); });
    expect(hide).not.toHaveBeenCalledWith(true);
    act(() => mockMotions.slice(1).forEach(motion => motion.complete?.({ finished: true })));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
