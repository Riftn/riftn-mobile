jest.mock("../../libs/queryCacheStore", () => ({ readSavedQueryCache: jest.fn(() => null), writeSavedQueryCache: jest.fn(), savedQueryCacheExists: jest.fn(() => true), dropSavedQueryCache: jest.fn() }));
jest.mock("../../libs/errorReporter", () => ({ reportError: jest.fn() }));
jest.mock("react-native", () => ({ AppState: { addEventListener: jest.fn() } }));

import { serializePersistedClient } from "../../config/queryClient";

const query = (key: string, data: unknown) => ({ queryKey: [key], queryHash: key, state: { data, status: "success" } });

it("saves the rest of the cache when one entry cannot be written", () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  const client: any = {
    timestamp: 1,
    buster: "v1",
    clientState: { mutations: [], queries: [query("home-feed", { pages: [{ result: [1] }] }), query("balance", { raw: BigInt(5) })] },
  };
  const saved = JSON.parse(serializePersistedClient(client));
  expect(saved.clientState.queries.map((q: any) => q.queryKey[0])).toEqual(["home-feed"]);
  expect(require("../../libs/errorReporter").reportError).toHaveBeenCalledTimes(1);
});

it("writes a clean cache untouched", () => {
  const client: any = { timestamp: 1, buster: "v1", clientState: { mutations: [], queries: [query("home-feed", { pages: [] })] } };
  expect(serializePersistedClient(client)).toBe(JSON.stringify(client));
});

it("saves straight to disk when asked", () => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  const { queryClient, saveQueryCacheNow } = require("../../config/queryClient");
  const { writeSavedQueryCache } = require("../../libs/queryCacheStore");
  queryClient.setQueryData(["home-feed", 1], { pages: [[1], [2]], pageParams: [0, 1] });
  saveQueryCacheNow("test");
  const [text] = writeSavedQueryCache.mock.calls[writeSavedQueryCache.mock.calls.length - 1];
  const saved = JSON.parse(text);
  expect(saved.buster).toBe("v1");
  expect(saved.clientState.queries[0].state.data.pages).toEqual([[1]]);
  queryClient.clear();
});

it("cancels the launch save and AppState subscription on unmount", () => {
  jest.useFakeTimers();
  try {
    const { AppState } = require("react-native");
    const remove = jest.fn();
    AppState.addEventListener.mockReturnValue({ remove });
    const write = require("../../libs/queryCacheStore").writeSavedQueryCache;
    write.mockClear();
    const stop = require("../../config/queryClient").startQueryCachePersistence();
    stop();
    jest.advanceTimersByTime(10000);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
