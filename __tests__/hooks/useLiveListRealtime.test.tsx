import { act, cleanup, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
jest.mock('react-native-css-interop', () => ({ createInteropElement: require('react').createElement }));
let mockSignedIn = true;
let mockEpoch = 1;
const mockInvalidate = jest.fn();
const mockDisconnect = jest.fn();
const mockAnonHandlers: Record<string, () => void> = {};
let mockCorePing: (() => void) | null = null;
const mockOn = jest.fn((event: string, listener: () => void) => {
  if (event === 'live.list.changed') mockCorePing = listener;
  return () => { mockCorePing = null; };
});
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock('socket.io-client', () => ({ io: () => ({
  on: (event: string, listener: () => void) => { mockAnonHandlers[event] = listener; },
  disconnect: mockDisconnect,
}) }));
jest.mock('../../config/env', () => ({ __esModule: true, default: { WEBSOCKET_URL: 'https://example.test' } }));
jest.mock('../../context/AuthContext', () => ({ useAuthState: () => ({ isSignedIn: mockSignedIn }) }));
jest.mock('../../context/WebSocketContext', () => ({
  useWebSocketApi: () => ({ on: mockOn }),
  useWebSocketStatus: () => ({ connectionEpoch: mockEpoch }),
}));
import { useLiveListRealtime, LIVE_LIST_KEY } from '../../hooks/useLiveListRealtime';

let stateChanged: (state: AppStateStatus) => void;
beforeEach(() => {
  jest.useFakeTimers();
  mockSignedIn = true; mockEpoch = 1; mockCorePing = null; jest.clearAllMocks();
  Object.keys(mockAnonHandlers).forEach(k => delete mockAnonHandlers[k]);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    stateChanged = listener;
    return { remove: jest.fn() };
  });
});
afterEach(() => { cleanup(); jest.useRealTimers(); jest.restoreAllMocks(); });

const flush = () => act(() => { jest.advanceTimersByTime(1_000); });

it('re-reads the live list when the core socket pings', () => {
  renderHook(() => useLiveListRealtime());
  expect(mockCorePing).not.toBeNull();
  act(() => { mockCorePing!(); mockCorePing!(); });
  flush();
  expect(mockInvalidate).toHaveBeenCalledTimes(1);
  expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: LIVE_LIST_KEY });
});

it('re-reads on a core reconnect and on coming back to the foreground', () => {
  const hook = renderHook(() => useLiveListRealtime());
  mockEpoch = 2;
  hook.rerender({});
  flush();
  expect(mockInvalidate).toHaveBeenCalledTimes(1);
  act(() => stateChanged('background'));
  act(() => stateChanged('active'));
  flush();
  expect(mockInvalidate).toHaveBeenCalledTimes(2);
});

it('signed out: holds its own socket while on screen, closes it in the background', () => {
  mockSignedIn = false;
  const hook = renderHook(() => useLiveListRealtime());
  expect(mockOn).not.toHaveBeenCalled();
  act(() => mockAnonHandlers.connect());
  act(() => mockAnonHandlers['live.list.changed']());
  flush();
  expect(mockInvalidate).toHaveBeenCalledTimes(1);
  act(() => stateChanged('background'));
  expect(mockDisconnect).toHaveBeenCalledTimes(1);
  hook.unmount();
});
