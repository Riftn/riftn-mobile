/**
 * Where the saved feed lives between launches: a file in the app's cache folder.
 *
 * It used to be one large MMKV value. On an S24+ every write reported success
 * and the key was readable for the rest of that run, yet every next launch
 * found nothing there, so the first feed always waited on the network. Small
 * MMKV values have gone missing the same way (see libs/durable-setting). A
 * plain file read synchronously at startup does not depend on that store.
 */
import { storage } from "./storage";

/** The old MMKV key, still read once so nobody loses a cache that did survive. */
export const QUERY_CACHE_KEY = "dehub-query-cache";
const FILE_NAME = "query-cache-v1.json";

type CacheFile = { exists: boolean; textSync(): string; create(options?: { overwrite?: boolean }): void; write(text: string): void; delete(): void };

function cacheFile(): CacheFile | null {
  try {
    const { File, Paths } = require("expo-file-system");
    return new File(Paths.cache, FILE_NAME) as CacheFile;
  } catch {
    return null;
  }
}

export function readSavedQueryCache(): string | null {
  try {
    const file = cacheFile();
    if (file?.exists) {
      const text = file.textSync();
      if (text) return text;
    }
  } catch {
    /* fall through to the old place */
  }
  try {
    return storage.getString(QUERY_CACHE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Throws when the file cannot be written, so the caller can report it. */
export function writeSavedQueryCache(text: string): void {
  const file = cacheFile();
  if (!file) throw new Error("no file store");
  // write() needs the file to be there on some platforms; creating it first
  // costs nothing where it does not.
  if (!file.exists) {
    try {
      file.create({ overwrite: true });
    } catch {
      /* write() below reports the real failure */
    }
  }
  file.write(text);
  try {
    if (storage.contains(QUERY_CACHE_KEY)) storage.delete(QUERY_CACHE_KEY);
  } catch {
    /* the old copy is only ever a fallback */
  }
}

export function savedQueryCacheExists(): boolean {
  try {
    return !!cacheFile()?.exists;
  } catch {
    return false;
  }
}

export function dropSavedQueryCache(): void {
  try {
    const file = cacheFile();
    if (file?.exists) file.delete();
  } catch {
    /* nothing to drop */
  }
  try {
    storage.delete(QUERY_CACHE_KEY);
  } catch {
    /* MMKV unavailable */
  }
}
