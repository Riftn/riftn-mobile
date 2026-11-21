import { act, renderHook } from '@testing-library/react-native';

let mockListener: ((e: any) => void) | null = null;
const mockPending: any[] = [];
const mockCompleteMute = jest.fn();
const mockEnd = jest.fn();
const mockUnlock = jest.fn();

jest.mock('../../modules/call-screen', () => ({
  completeNativeMute: (id: string, applied: boolean) => mockCompleteMute(id, applied),
  callScreenSupported: () => true,
  addCallScreenListener: (fn: (e: any) => void) => { mockListener = fn; return () => { mockListener = null; }; },
  takePendingCallActions: () => Promise.resolve(mockPending.splice(0)),
  endNativeCall: (id: string) => mockEnd(id),
  requestUnlock: () => mockUnlock(),
}));
jest.mock('../../services/push/push.service', () => ({ refreshPushRegistration: jest.fn(() => Promise.resolve(true)) }));

import { useNativeCallScreen } from '../../hooks/useNativeCallScreen';

function fakeCall(overrides: Record<string, unknown> = {}): any {
  return {
    currentCall: null,
    isIncoming: false,
    isConnecting: false,
    acceptCallById: jest.fn(() => Promise.resolve()),
    declineCallById: jest.fn(() => Promise.resolve()),
    endCall: jest.fn(),
    ...overrides,
  };
}

const flush = () => act(async () => { await Promise.resolve(); });

describe('useNativeCallScreen', () => {
  beforeEach(() => { mockEnd.mockClear(); mockUnlock.mockClear(); });

  it('answers and declines from the phone call screen', async () => {
    const call = fakeCall();
    renderHook(() => useNativeCallScreen(call));
    await flush();
    act(() => mockListener?.({ action: 'answer', sessionId: 's1', callType: 'audio' }));
    expect(call.acceptCallById).toHaveBeenCalledWith('s1');
    act(() => mockListener?.({ action: 'decline', sessionId: 's2' }));
    expect(call.declineCallById).toHaveBeenCalledWith('s2');
  });

  it('acknowledges the requested mute state only when the matching call applies it', async () => {
    const setNativeMute = jest.fn((session: string) => session === 'current');
    renderHook(() => useNativeCallScreen(fakeCall({ setNativeMute })));
    await flush();
    for (const [id, sessionId, muted] of [['1', 'current', 'true'], ['2', 'current', 'false'], ['3', 'stale', 'true']]) {
      act(() => mockListener?.({ action: 'mute', requestId: id, sessionId, muted }));
    }
    expect(setNativeMute.mock.calls).toEqual([['current', true], ['current', false], ['stale', true]]);
    expect(mockCompleteMute.mock.calls).toEqual([['1', true], ['2', true], ['3', false]]);
  });

  it('takes actions made before the app was listening', async () => {
    mockPending.push({ action: 'answer', sessionId: 'early' });
    const call = fakeCall();
    renderHook(() => useNativeCallScreen(call));
    await flush();
    expect(call.acceptCallById).toHaveBeenCalledWith('early');
  });

  it('stops the phone ring when the app rings, and ends it when the call finishes', async () => {
    const ringing = fakeCall({ currentCall: { id: 'c1', status: 'ringing' }, isIncoming: true });
    const { rerender } = renderHook(({ call }: { call: any }) => useNativeCallScreen(call), { initialProps: { call: ringing } });
    expect(mockEnd).toHaveBeenCalledWith('c1');
    mockEnd.mockClear();
    rerender({ call: fakeCall() });
    expect(mockEnd).toHaveBeenCalledWith('c1');
  });

  it('keeps the phone call screen while a call answered there connects', async () => {
    const connecting = fakeCall({ currentCall: { id: 'c2', status: 'connected' }, isConnecting: true });
    renderHook(() => useNativeCallScreen(connecting));
    expect(mockEnd).not.toHaveBeenCalled();
    expect(mockUnlock).toHaveBeenCalled();
  });
});
