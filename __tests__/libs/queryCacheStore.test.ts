const mockFiles = new Map<string, string>();
jest.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  File: class {
    path: string;
    constructor(dir: string, name: string) { this.path = `${dir}/${name}`; }
    get exists() { return mockFiles.has(this.path); }
    textSync() { return mockFiles.get(this.path) as string; }
    create() { if (!mockFiles.has(this.path)) mockFiles.set(this.path, ""); }
    write(text: string) { mockFiles.set(this.path, text); }
    delete() { mockFiles.delete(this.path); }
  },
}));
const mockKeys = new Map<string, string>();
jest.mock("../../libs/storage", () => ({
  storage: {
    getString: (key: string) => mockKeys.get(key),
    contains: (key: string) => mockKeys.has(key),
    delete: (key: string) => mockKeys.delete(key),
  },
}));

import { dropSavedQueryCache, readSavedQueryCache, savedQueryCacheExists, writeSavedQueryCache } from "../../libs/queryCacheStore";

beforeEach(() => { mockFiles.clear(); mockKeys.clear(); });

it("reads back what it wrote, from the file", () => {
  writeSavedQueryCache('{"a":1}');
  expect(savedQueryCacheExists()).toBe(true);
  expect(readSavedQueryCache()).toBe('{"a":1}');
});

it("falls back to the old place once, then retires it", () => {
  mockKeys.set("dehub-query-cache", "old");
  expect(readSavedQueryCache()).toBe("old");
  writeSavedQueryCache("new");
  expect(mockKeys.has("dehub-query-cache")).toBe(false);
  expect(readSavedQueryCache()).toBe("new");
});

it("drops both copies", () => {
  mockKeys.set("dehub-query-cache", "old");
  writeSavedQueryCache("new");
  dropSavedQueryCache();
  expect(readSavedQueryCache()).toBeNull();
});
