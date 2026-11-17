import React from 'react';
import { act, create } from 'react-test-renderer';
import { deferredScreen } from '../../navigation/deferredScreen';
import { useTransitionSettled } from '../../hooks/useTransitionSettled';

let mockFocused = true;
let mockReducedMotion = false;
const mockRoute = { key: 'destination' };
const mockListeners = new Set<(event: any) => void>();
const mockNavigation = {
  addListener: (_name: string, listener: (event: any) => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
};
jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
  useIsFocused: () => mockFocused,
}));
jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => mockReducedMotion }));
jest.mock('../../navigation/RouteLoadingShell', () => 'LoadingShell');
jest.mock('../../navigation/ShellCover', () => 'ShellCover');

let key = 0;
beforeEach(() => {
  jest.useFakeTimers();
  mockFocused = true;
  mockReducedMotion = false;
  mockListeners.clear();
});
afterEach(() => jest.useRealTimers());

function page() {
  function Content() {
    const ready = useTransitionSettled();
    return require('react').createElement('Page', { ready });
  }
  const load = jest.fn(() => Content);
  const Screen = deferredScreen(`test-${key++}`, load);
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Screen route={mockRoute} />); });
  return { load, Screen, tree };
}

it('commits the shell before requiring content, then mounts after the entrance without a second wait', () => {
  const { load, tree } = page();
  expect(tree.root.findAllByType('LoadingShell' as any)).toHaveLength(1);
  expect(load).not.toHaveBeenCalled();
  act(() => { for (const listener of mockListeners) listener({ data: { closing: false } }); });
  expect(load).toHaveBeenCalledTimes(1);
  expect(tree.root.findByType('Page' as any).props.ready).toBe(true);
  act(() => tree.unmount());
});

it('does not require content when Back blurs the page before its entrance finishes', () => {
  const { load, Screen, tree } = page();
  act(() => { mockFocused = false; tree.update(<Screen route={mockRoute} />); });
  act(() => { for (const listener of mockListeners) listener({ data: { closing: true } }); });
  act(() => jest.advanceTimersByTime(1000));
  expect(load).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it('cancels deferred work on unmount and removes the transition listener', () => {
  const { load, tree } = page();
  act(() => tree.unmount());
  act(() => jest.advanceTimersByTime(1000));
  expect(load).not.toHaveBeenCalled();
  expect(mockListeners.size).toBe(0);
});

it('loads after a bounded fallback if native transitionEnd is absent', () => {
  const { load, tree } = page();
  act(() => jest.advanceTimersByTime(599));
  expect(load).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(load).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('does not wait out an animation when reduced motion is enabled', () => {
  mockReducedMotion = true;
  const { load, tree } = page();
  act(() => jest.advanceTimersByTime(32));
  expect(load).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('retains already-mounted content on blur instead of replacing it with a shell', () => {
  const { load, Screen, tree } = page();
  act(() => jest.advanceTimersByTime(600));
  // The shell dissolves over the page it hands to, then is gone.
  expect(tree.root.findAllByType('ShellCover' as any)).toHaveLength(1);
  act(() => jest.advanceTimersByTime(300));
  act(() => { mockFocused = false; tree.update(<Screen route={mockRoute} />); });
  expect(tree.root.findAllByType('LoadingShell' as any)).toHaveLength(0);
  expect(tree.root.findAllByType('Page' as any)).toHaveLength(1);
  expect(load).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});

it('does not restart the loading gate when a theme boundary remounts an already-open route', () => {
  const { load, Screen, tree } = page();
  act(() => jest.advanceTimersByTime(600));
  act(() => tree.unmount());
  let remounted!: ReturnType<typeof create>;
  act(() => { remounted = create(<Screen route={mockRoute} />); });
  expect(remounted.root.findAllByType('LoadingShell' as any)).toHaveLength(0);
  expect(remounted.root.findByType('Page' as any).props.ready).toBe(true);
  expect(load).toHaveBeenCalledTimes(1);
  act(() => remounted.unmount());
});

it('opens a new instance of a warm screen without waiting for another transition timer', () => {
  const { load, Screen, tree } = page();
  act(() => jest.advanceTimersByTime(600));
  act(() => tree.unmount());
  let next!: ReturnType<typeof create>;
  act(() => { next = create(<Screen route={{ key: 'fresh-route' }} />); });
  expect(next.root.findAllByType('LoadingShell' as any)).toHaveLength(0);
  expect(load).toHaveBeenCalledTimes(1);
  act(() => next.unmount());
});

it('keeps the shell over a page that is still on its own loader, up to the cap', () => {
  const { useRouteBusy } = require('../../context/RouteBusyContext');
  function Loader() { useRouteBusy(); return null; }
  function Content() { return require('react').createElement(Loader); }
  const Screen = deferredScreen(`busy-${key++}`, () => Content);
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Screen route={mockRoute} />); });
  act(() => jest.advanceTimersByTime(600));
  act(() => jest.advanceTimersByTime(2400));
  expect(tree.root.findByType('ShellCover' as any).props.fading).toBe(false);
  act(() => jest.advanceTimersByTime(100));
  expect(tree.root.findByType('ShellCover' as any).props.fading).toBe(true);
  act(() => jest.advanceTimersByTime(300));
  expect(tree.root.findAllByType('ShellCover' as any)).toHaveLength(0);
  act(() => tree.unmount());
});

it('with reduced motion keeps the one shell over a loading page, then cuts to it', () => {
  mockReducedMotion = true;
  const { useRouteBusy } = require('../../context/RouteBusyContext');
  let done!: () => void;
  function Loader() {
    const [busy, setBusy] = require('react').useState(true);
    done = () => setBusy(false);
    useRouteBusy(busy);
    return null;
  }
  function Content() { return require('react').createElement(Loader); }
  const Screen = deferredScreen(`busy-rm-${key++}`, () => Content);
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Screen route={mockRoute} />); });
  act(() => jest.advanceTimersByTime(100));
  expect(tree.root.findByType('ShellCover' as any).props.fading).toBe(false);
  act(() => done());
  expect(tree.root.findAllByType('ShellCover' as any)).toHaveLength(0);
  act(() => tree.unmount());
});

it('draws a loaded page on its first frame unless it asks for its shell first', () => {
  const { preloadDeferredScreen } = require('../../navigation/deferredScreen');
  function Content() {
    return require('react').createElement('Page');
  }
  const direct = `loaded-${key++}`;
  preloadDeferredScreen(direct, () => Content);
  const Direct = deferredScreen(direct, () => Content);
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Direct route={mockRoute} />); });
  expect(tree.root.findAllByType('Page' as any)).toHaveLength(1);
  act(() => tree.unmount());

  const shellFirst = `shell-first-${key++}`;
  preloadDeferredScreen(shellFirst, () => Content);
  const Shelled = deferredScreen(shellFirst, () => Content, undefined, { shellFirst: true });
  act(() => { tree = create(<Shelled route={mockRoute} />); });
  expect(tree.root.findAllByType('LoadingShell' as any)).toHaveLength(1);
  expect(tree.root.findAllByType('LoadingShell' as any)[0].props.route).toBe(mockRoute);
  act(() => jest.advanceTimersByTime(16));
  expect(tree.root.findAllByType('Page' as any)).toHaveLength(1);
  expect(tree.root.findAllByType('LoadingShell' as any)).toHaveLength(0);
  act(() => tree.unmount());
});
