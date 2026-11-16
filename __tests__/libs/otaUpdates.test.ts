jest.mock("expo-updates", () => ({
  isEnabled: true,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

import * as Updates from "expo-updates";
import {
  APPLY_AFTER_BACKGROUND_MS,
  __resetOtaStateForTests,
  applyOtaUpdateDuringSetup,
  applyOtaUpdateIfReady,
  checkForOtaUpdate,
  isUpdateReady,
} from "../../libs/otaUpdates";

const mocked = Updates as unknown as {
  checkForUpdateAsync: jest.Mock;
  fetchUpdateAsync: jest.Mock;
  reloadAsync: jest.Mock;
};

describe("over-the-air updates on foreground", () => {
  beforeEach(() => {
    __resetOtaStateForTests();
    jest.clearAllMocks();
    (global as any).__DEV__ = false;
    mocked.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
    mocked.fetchUpdateAsync.mockResolvedValue({ isNew: true });
    mocked.reloadAsync.mockResolvedValue(undefined);
  });

  it("downloads an available update and marks it ready", async () => {
    await checkForOtaUpdate(1_000_000_000);
    expect(mocked.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(isUpdateReady()).toBe(true);
  });

  it("treats an update the launch check already downloaded as ready", async () => {
    mocked.fetchUpdateAsync.mockResolvedValue({ isNew: false });
    await checkForOtaUpdate(1_000_000_000);
    expect(isUpdateReady()).toBe(true);
  });

  it("does not hit the update server more than once per interval", async () => {
    mocked.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
    await checkForOtaUpdate(1_000_000_000);
    await checkForOtaUpdate(1_000_000_000 + 5 * 60 * 60_000);
    expect(mocked.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    await checkForOtaUpdate(1_000_000_000 + 6 * 60 * 60_000 + 60_000);
    expect(mocked.checkForUpdateAsync).toHaveBeenCalledTimes(2);
  });

  it("applies a ready update only after a long enough absence", async () => {
    await checkForOtaUpdate(1_000_000_000);
    expect(await applyOtaUpdateIfReady(APPLY_AFTER_BACKGROUND_MS - 1, true)).toBe(false);
    expect(mocked.reloadAsync).not.toHaveBeenCalled();
    expect(await applyOtaUpdateIfReady(APPLY_AFTER_BACKGROUND_MS, true)).toBe(true);
    expect(mocked.reloadAsync).toHaveBeenCalledTimes(1);
    expect(isUpdateReady()).toBe(false);
  });

  it("never reloads when nothing was downloaded", async () => {
    expect(await applyOtaUpdateIfReady(10 * APPLY_AFTER_BACKGROUND_MS)).toBe(false);
    expect(mocked.reloadAsync).not.toHaveBeenCalled();
  });

  it("keeps a downloaded update for the next launch when returning from a call", async () => {
    await checkForOtaUpdate(1_000_000_000);
    expect(await applyOtaUpdateIfReady(10 * APPLY_AFTER_BACKGROUND_MS)).toBe(false);
    expect(mocked.reloadAsync).not.toHaveBeenCalled();
    expect(isUpdateReady()).toBe(true);
  });

  it("swallows a failed check so the next foreground retries", async () => {
    mocked.checkForUpdateAsync.mockRejectedValue(new Error("offline"));
    await expect(checkForOtaUpdate(1_000_000_000)).resolves.toBeUndefined();
    expect(isUpdateReady()).toBe(false);
  });

  it("restarts into a downloaded update during first-run setup", async () => {
    await checkForOtaUpdate(1_000_000_000);
    await expect(applyOtaUpdateDuringSetup()).resolves.toBe(true);
    expect(mocked.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it("carries on with setup when no update is ready", async () => {
    mocked.checkForUpdateAsync.mockResolvedValue({ isAvailable: false });
    await expect(applyOtaUpdateDuringSetup(50)).resolves.toBe(false);
    expect(mocked.reloadAsync).not.toHaveBeenCalled();
  });

  it("waits for a download that is still running before sign-in", async () => {
    let done: (value: { isNew: boolean }) => void = () => {};
    mocked.fetchUpdateAsync.mockReturnValue(new Promise((resolve) => { done = resolve; }));
    const applied = applyOtaUpdateDuringSetup(5_000);
    await Promise.resolve();
    await Promise.resolve();
    done({ isNew: true });
    await expect(applied).resolves.toBe(true);
    expect(mocked.fetchUpdateAsync).toHaveBeenCalledTimes(1);
  });
});

it('retries failed downloads after bounded backoff and resumes the success cadence', async () => {
  __resetOtaStateForTests();
  jest.clearAllMocks();
  (global as any).__DEV__ = false;
  mocked.checkForUpdateAsync.mockResolvedValue({ isAvailable: true });
  mocked.fetchUpdateAsync.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ isNew: true });
  await checkForOtaUpdate(0);
  await checkForOtaUpdate(59_999);
  expect(mocked.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  await checkForOtaUpdate(60_000);
  expect(mocked.checkForUpdateAsync).toHaveBeenCalledTimes(2);
  expect(isUpdateReady()).toBe(true);
  await checkForOtaUpdate(120_000);
  expect(mocked.checkForUpdateAsync).toHaveBeenCalledTimes(2);
  expect(mocked.reloadAsync).not.toHaveBeenCalled();
});
