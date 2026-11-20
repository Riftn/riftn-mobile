/**
 * One short style for every counter on screen: 999, 1.2K, 3.4M, 1B.
 * Views, listens, likes, followers, members, votes, points and the rest all go
 * through here, the same as the website. Money keeps its exact amount and does
 * not use this.
 */
const UNITS: Array<[number, string]> = [
  [1e3, 'K'],
  [1e6, 'M'],
  [1e9, 'B'],
  [1e12, 'T'],
];

/** A plain number: "1200", "1,200", "1 200", "12.5". Anything else is left as it is. */
const NUMERIC = /^-?\d{1,3}(?:[,\s  ]\d{3})+$|^-?\d+(?:\.\d+)?$/;

export function formatCount(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  let n: number;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!NUMERIC.test(trimmed)) return value; // already short ("1.2K") or not a number
    n = /^-?\d+(?:\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number(trimmed.replace(/[^\d-]/g, ''));
  } else {
    n = value;
  }
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 1000) return sign + String(Number.isInteger(abs) ? abs : Math.round(abs * 100) / 100);
  for (let i = 0; i < UNITS.length; i++) {
    const [size, suffix] = UNITS[i];
    const short = Math.round((abs / size) * 10) / 10;
    // 999,950 rounds to 1000K; that reads as 1M.
    if (short < 1000 || i === UNITS.length - 1) return `${sign}${short}${suffix}`;
  }
  return sign + String(abs);
}

/** Placeholders in translated copy that hold a counter. {{count}} covers plurals. */
export const COUNTER_PLACEHOLDERS = new Set([
  'count', 'views', 'likes', 'listens', 'listeners', 'followers', 'following', 'attended',
  'subscribers', 'members', 'viewers', 'watchers', 'plays', 'reposts', 'shares', 'upvotes',
  'votes', 'points', 'reactions', 'replies', 'comments', 'going', 'interested', 'holders',
]);

/**
 * i18next runs every {{placeholder}} through this. Counter placeholders come out
 * short ("1.2K listens"); plurals still pick their form from the real number and
 * every other placeholder is left exactly as passed.
 */
export function shortenCounterPlaceholder(
  value: unknown,
  format?: string,
  _lng?: string,
  options?: { interpolationkey?: string; [key: string]: unknown },
): unknown {
  if (format) return value;
  const key = options?.interpolationkey;
  if (!key || !COUNTER_PLACEHOLDERS.has(key)) return value;
  if (typeof value === 'number' || typeof value === 'string') return formatCount(value);
  return value;
}
