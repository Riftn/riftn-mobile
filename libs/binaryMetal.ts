/**
 * Binary Metal: the riff maths, shared with riftn-web public/binary-metal/engine.js.
 *
 * The bits, the tab and the playhead are worked out here so the screen draws
 * them straight away. The sound itself is drawn by the web engine in a hidden
 * WebView (riftn.com/binary-metal/render.html), so the app and the site sound
 * the same. Keep these numbers in step with engine.js.
 */

export type BinaryMetalStyle = 'thrash' | 'doom' | 'blast' | 'groove';
export type BinaryMetalTuning = 'e-standard' | 'drop-d' | 'drop-c' | 'b-standard';

export interface BinaryMetalOptions {
  style: BinaryMetalStyle;
  bpm: number;
  tuning: BinaryMetalTuning;
  power: boolean;
}

export const MAX_CHARS = 200;
export const STEPS_PER_BYTE = 8;
export const MIN_BPM = 60;
export const MAX_BPM = 240;
const TAIL = 2.4;

export const STYLE_IDS: BinaryMetalStyle[] = ['thrash', 'doom', 'blast', 'groove'];
export const TUNING_IDS: BinaryMetalTuning[] = ['drop-d', 'e-standard', 'drop-c', 'b-standard'];

export const STYLE_BPM: Record<BinaryMetalStyle, number> = { thrash: 180, doom: 90, blast: 200, groove: 140 };

export const TUNING_STRINGS: Record<BinaryMetalTuning, string[]> = {
  'e-standard': ['e', 'B', 'G', 'D', 'A', 'E'],
  'drop-d': ['e', 'B', 'G', 'D', 'A', 'D'],
  'drop-c': ['d', 'A', 'F', 'C', 'G', 'C'],
  'b-standard': ['b', 'F#', 'D', 'A', 'E', 'B'],
};

export const isStyle = (v: unknown): v is BinaryMetalStyle => typeof v === 'string' && (STYLE_IDS as string[]).includes(v);

/** The text as the engine plays it: capped at MAX_CHARS characters. */
export function clip(text: string): string {
  return Array.from(String(text ?? '')).slice(0, MAX_CHARS).join('');
}

/** UTF-8 bytes of one character, without relying on TextEncoder. */
function utf8(ch: string): number[] {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
}

export interface BinaryMetalByte { ch: string; bits: string }

/** One entry per UTF-8 byte: the character it came from and its 8 bits. */
export function bytesOf(text: string): BinaryMetalByte[] {
  const out: BinaryMetalByte[] = [];
  for (const ch of Array.from(clip(text))) {
    for (const b of utf8(ch)) out.push({ ch, bits: b.toString(2).padStart(8, '0') });
  }
  return out;
}

export function settingsOf(opts: Partial<BinaryMetalOptions>): BinaryMetalOptions {
  const style = opts.style && isStyle(opts.style) ? opts.style : 'thrash';
  const tuning = opts.tuning && TUNING_STRINGS[opts.tuning] ? opts.tuning : 'drop-d';
  const raw = Number(opts.bpm) || STYLE_BPM[style];
  const bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(raw)));
  return { style, tuning, bpm, power: !!opts.power };
}

/** Where everything lands in time, for the playhead. */
export function timeline(text: string, opts: Partial<BinaryMetalOptions>) {
  const s = settingsOf(opts);
  const step = 60 / s.bpm / 2;
  const lead = 8 * step;
  const count = bytesOf(text).length;
  const end = lead + count * STEPS_PER_BYTE * step;
  return { step, lead, bytes: count, end, duration: end + TAIL };
}

/** Which byte and which bit are sounding at `t` seconds (null in the count-in or the tail). */
export function positionAt(text: string, opts: Partial<BinaryMetalOptions>, t: number): { byte: number; bit: number } | null {
  const tl = timeline(text, opts);
  if (t < tl.lead || t >= tl.end) return null;
  const n = Math.floor((t - tl.lead) / tl.step);
  return { byte: Math.floor(n / STEPS_PER_BYTE), bit: n % STEPS_PER_BYTE };
}

/**
 * The tab, one bar per byte: for each bar six strings (high first), each a
 * list of eight frets ('-' for a string that does not play).
 */
export function tabBars(text: string, opts: Partial<BinaryMetalOptions>): string[][][] {
  const s = settingsOf(opts);
  const dropped = s.tuning === 'drop-d' || s.tuning === 'drop-c';
  return bytesOf(text).map(({ bits }) => {
    const cols = Array.from(bits, (bit) => {
      const fret = Number(bit);
      const col = ['-', '-', '-', '-', '-', String(fret)];
      if (s.power) {
        col[4] = String(dropped ? fret : fret + 2);
        col[3] = String(dropped ? fret : fret + 2);
      }
      return col;
    });
    return [0, 1, 2, 3, 4, 5].map((row) => cols.map((c) => c[row]));
  });
}

/** "riftn-rules-doom.mp3", as engine.js names files. */
export function fileName(text: string, opts: Partial<BinaryMetalOptions>, ext: string): string {
  const s = settingsOf(opts);
  const slug = clip(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'riff';
  return `${slug}-${s.style}.${ext}`;
}

export const formatClock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
