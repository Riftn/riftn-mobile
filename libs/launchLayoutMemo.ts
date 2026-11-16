/**
 * Sizes Home measured on the last run, so the next launch can start from them.
 *
 * Home learns its header height and where the nav pill sits from layout
 * callbacks, after its first render. Each answer re-rendered Home and the feed
 * under it while the launch logo waited. Starting from last run's numbers makes
 * those callbacks report what is already there, so nothing renders twice. A
 * number that no longer fits (new theme, rotated screen, larger text) is
 * replaced by the same callbacks exactly as before.
 *
 * A small file in the cache folder, read synchronously: see queryCacheStore
 * for why not the key-value store.
 */
const FILE_NAME = "launch-layout-v1.json";

type MemoFile = { exists: boolean; textSync(): string; create(options?: { overwrite?: boolean }): void; write(text: string): void };
type Sizes = Record<string, number>;

let loaded: Record<string, Sizes> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function memoFile(): MemoFile | null {
  try {
    const { File, Paths } = require("expo-file-system");
    return new File(Paths.cache, FILE_NAME) as MemoFile;
  } catch {
    return null;
  }
}

function load(): Record<string, Sizes> {
  if (loaded) return loaded;
  loaded = {};
  try {
    const file = memoFile();
    if (file?.exists) {
      const parsed = JSON.parse(file.textSync());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) loaded = parsed as Record<string, Sizes>;
    }
  } catch {
    loaded = {};
  }
  return loaded;
}

/** The sizes remembered for this layout (theme, width...), or an empty object. */
export function recallLayout(key: string): Sizes {
  const sizes = load()[key];
  return sizes && typeof sizes === "object" ? sizes : {};
}

/** A remembered size, only when it is a usable number. */
export function recalledSize(sizes: Sizes, name: string, fallback: number): number {
  const value = sizes[name];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 2000 ? value : fallback;
}

/** Remember sizes for next launch. Written a moment later, off the launch path. */
export function rememberLayout(key: string, sizes: Sizes): void {
  const all = load();
  const current = all[key] ?? {};
  const names = Object.keys(sizes);
  if (names.every(name => current[name] === sizes[name])) return;
  // One entry per layout seen; a handful at most, and old ones are dropped.
  const keys = Object.keys(all);
  if (!all[key] && keys.length >= 12) delete all[keys[0]];
  all[key] = { ...current, ...sizes };
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      const file = memoFile();
      if (!file) return;
      if (!file.exists) file.create({ overwrite: true });
      file.write(JSON.stringify(all));
    } catch {
      /* next launch measures as it always did */
    }
  }, 3000);
  (writeTimer as { unref?: () => void }).unref?.();
}

export function __resetLayoutMemoForTests(): void {
  loaded = null;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
}
