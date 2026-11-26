import { renderHook, waitFor } from '@testing-library/react-native';
import { useAuthBoot } from '../../hooks/useAuthBoot';
import { isTokenExpired } from '../../libs/auth.utils';
import { tokenRefreshManager } from '../../libs/token-refresh';

jest.mock('../../libs/auth.utils', () => ({ isTokenExpired: jest.fn(() => false) }));
jest.mock('../../libs/token-refresh', () => ({
  tokenRefreshManager: { attemptRefresh: jest.fn(), ensureFreshToken: jest.fn(async () => {}) },
}));
it('does not overwrite a corrected profile with the old owner profile on boot', async () => {
  const deps = { getAuthUser: jest.fn().mockResolvedValue({ username: 'kolomba' }), getAuthToken: jest.fn().mockResolvedValue('old-token'), hasSeenAuth: jest.fn().mockResolvedValue(true), setUser: jest.fn(), setIsSignedIn: jest.fn(), setIsFirstTimeUser: jest.fn(), setIsBootLoading: jest.fn(), ensureProvider: jest.fn().mockResolvedValue(undefined), reconcileProfile: jest.fn().mockResolvedValue(true), log: { warn: jest.fn(), error: jest.fn() } };
  renderHook(() => useAuthBoot(deps));
  await waitFor(() => expect(deps.setIsBootLoading).toHaveBeenCalledWith(false));
  expect(deps.reconcileProfile).toHaveBeenCalledTimes(1);
  expect(deps.setUser).not.toHaveBeenCalled();
});

it('reveals a verified same-identity cache while reconciliation is pending', async () => {
  const deps = { getAuthUser: jest.fn().mockResolvedValue({ address: 'verified' }), getAuthToken: jest.fn().mockResolvedValue('token'), hasSeenAuth: jest.fn().mockResolvedValue(true), setUser: jest.fn(), setIsSignedIn: jest.fn(), setIsFirstTimeUser: jest.fn(), setIsBootLoading: jest.fn(), ensureProvider: jest.fn().mockResolvedValue(undefined), canRestoreCachedProfile: jest.fn().mockResolvedValue(true), refreshCachedProfile: jest.fn(() => new Promise<boolean>(() => {})), reconcileProfile: jest.fn().mockResolvedValue(true), log: { warn: jest.fn(), error: jest.fn() } };
  renderHook(() => useAuthBoot(deps));
  await waitFor(() => expect(deps.setIsBootLoading).toHaveBeenCalledWith(false));
  expect(deps.refreshCachedProfile).toHaveBeenCalledTimes(1);
  expect(deps.setUser).toHaveBeenCalledWith({ address: 'verified' });
  expect(deps.setIsSignedIn).toHaveBeenCalledWith(true);
  expect(deps.reconcileProfile).not.toHaveBeenCalled();
});

it.each([false, true])('handles a pending offline boot on reconnect (logged out: %s)', async (loggedOut) => {
  const user = { address: 'verified' };
  let storedToken: string | null = 'expired-access';
  const deps = {
    getAuthUser: jest.fn().mockResolvedValue(user),
    getAuthToken: jest.fn(async () => storedToken),
    hasSeenAuth: jest.fn().mockResolvedValue(true),
    setUser: jest.fn(),
    setIsSignedIn: jest.fn(),
    setIsFirstTimeUser: jest.fn(),
    setIsBootLoading: jest.fn(),
    ensureProvider: jest.fn().mockResolvedValue(undefined),
    canRestoreCachedProfile: jest.fn().mockResolvedValue(true),
    log: { warn: jest.fn(), error: jest.fn() },
  };
  jest.mocked(isTokenExpired).mockReturnValue(true);
  const refresh = jest.mocked(tokenRefreshManager.attemptRefresh);
  refresh.mockReset().mockImplementation(async () => (storedToken = 'fresh-access'));
  const { rerender } = renderHook(
    (hasInternet: boolean) => useAuthBoot({ ...deps, hasInternet }),
    { initialProps: false },
  );
  await waitFor(() => expect(deps.setIsBootLoading).toHaveBeenCalledTimes(2));
  expect(refresh).not.toHaveBeenCalled();
  expect(deps.setIsSignedIn).not.toHaveBeenCalled();

  if (loggedOut) storedToken = null;
  rerender(true);

  if (loggedOut) {
    await waitFor(() => expect(deps.getAuthToken).toHaveBeenCalledTimes(3));
    expect(refresh).not.toHaveBeenCalled();
    expect(deps.setIsSignedIn).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(deps.setIsSignedIn).toHaveBeenCalledWith(true));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(deps.setUser).toHaveBeenLastCalledWith(user);
  }
});
