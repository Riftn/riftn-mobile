/**
 * Dubbing with the phone's own voice.
 *
 * The server dub waited on a GPU worker that was never deployed, so every
 * request sat at 'pending' and nobody ever heard one. The device already ships
 * a speech engine for most of the languages we translate into, and the
 * translated transcript is already timed — speaking each line as the playhead
 * reaches it is a dub that costs nothing and works today. It is not the
 * creator's voice; it is a voice, in the viewer's language.
 *
 * Driven by the player's own clock (`timeUpdate`), the same as the captions,
 * so a pause, a seek, a loop and a rate change fall out of one rule instead of
 * a timer of our own that has to be told about each of them.
 */
import { useEffect, useRef } from "react";
import type * as SpeechModule from "expo-speech";
import type { VideoPlayer } from "expo-video";
import type { TranscriptSegment } from "./useTranscript";
import { getVolume, useMediaVolume } from '../libs/video-preferences';
import { applyVideoVolume, dubVoiceVolume, setDubMixActive, useDubMix } from '../libs/dub-mix';

/**
 * expo-speech is a native module and its entry throws on a binary built before
 * it was added — and this file sits on the home feed's import path, which ships
 * over the air to every installed version. Load it only when the installed app
 * has it; on older builds dubbing is simply unavailable until the next APK.
 */
let Speech: typeof SpeechModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Speech = require("expo-speech");
} catch {
  Speech = null;
}

/** The installed app can speak. False on builds that predate expo-speech. */
export const speechAvailable = Speech !== null;
export const getSpeechEngine = () => Speech;

/** Past this a synthetic voice gets hard to follow. */
const MAX_RATE = 1.5;
/** What a device voice gets through per second at rate 1, until this voice has been timed. */
const CHARS_PER_SECOND = 14;
/** How far past its own end a line may run, or start, before the picture wins. */
const MAX_LAG_S = 2.5;
/** A line may use this much of the silence after it. */
const BORROW_S = 1;
/** A jump larger than this between ticks is a seek or a loop, not playback. */
const SEEK_JUMP_S = 1.5;
/** With less than this to speak in, a line is not worth starting. */
const MIN_REMAINING_S = 0.8;

// How fast each voice really reads, timed on the lines it has finished. The
// guess above is wrong by a third for some voices, and a wrong guess is a
// line that does not fit.
const measuredCps = new Map<string, number>();

/** "pt-BR", "pt_BR" and "pt" are the same language to a voice picker. */
export function baseLang(code: string | null | undefined): string {
  return (code ?? "").toLowerCase().split(/[-_]/)[0];
}

/** Index of the line playing at `t` seconds, or -1 before, after or between lines. */
export function segmentIndexAt(segments: TranscriptSegment[], t: number): number {
  return segments.findIndex((s) => t >= s.start && t < s.end);
}

/** Seconds a line starting at `t` has: the rest of its span plus some of the silence after it. */
export function lineRoom(segments: TranscriptSegment[], i: number, t: number): number {
  const seg = segments[i];
  if (t - seg.end > MAX_LAG_S) return 0;
  const next = i + 1 < segments.length ? segments[i + 1].start : Infinity;
  return Math.max(0, seg.end - t) + Math.min(BORROW_S, Math.max(0, next - Math.max(seg.end, t)));
}

/**
 * How fast to speak `text` so it fits the `seconds` left of its line. Never
 * slower than normal, never past MAX_RATE: a line that still does not fit
 * runs on, and the next one waits for it.
 */
export function speechRate(text: string, seconds: number, playbackRate = 1, charsPerSecond = CHARS_PER_SECOND): number {
  const window = seconds / Math.max(0.25, playbackRate || 1);
  if (window <= 0) return MAX_RATE;
  const needed = text.length / charsPerSecond / window;
  return Math.min(MAX_RATE, Math.max(1, needed));
}

let voicesPromise: Promise<SpeechModule.Voice[]> | null = null;
function loadVoices(): Promise<SpeechModule.Voice[]> {
  if (!voicesPromise) {
    const pending = Speech
      ? Speech.getAvailableVoicesAsync().catch(() => [] as SpeechModule.Voice[])
      : Promise.resolve([] as SpeechModule.Voice[]);
    voicesPromise = pending;
    // Android answers with an empty list until its engine has bound. Caching
    // that would report "no voice" for every language for the whole session.
    void pending.then((voices) => {
      if (!voices.length && voicesPromise === pending) voicesPromise = null;
    });
  }
  return voicesPromise;
}

/**
 * The best installed voice for a language: `null` when the device has none,
 * `undefined` when the engine would not list its voices — speak with just the
 * language then and let the platform choose.
 */
export async function findVoice(lang: string): Promise<SpeechModule.Voice | null | undefined> {
  if (!Speech) return null;
  const voices = await loadVoices();
  if (!voices.length) return undefined;
  const aliases: Record<string, string> = { no: 'nb', tl: 'fil', iw: 'he', yue: 'zh' };
  const base = aliases[baseLang(lang)] ?? baseLang(lang);
  const matches = voices.filter((v) => (aliases[baseLang(v.language)] ?? baseLang(v.language)) === base);
  if (!matches.length) return null;
  const exact = matches.filter((v) => v.language.toLowerCase().replace('_', '-') === lang.toLowerCase().replace('_', '-'));
  const pool = exact.length ? exact : matches;
  return pool.find((v) => v.quality === Speech?.VoiceQuality.Enhanced) ?? pool[0];
}

// The speech engine is one per device, but a feed mounts a player per card.
// Only the instance that started the current utterance may stop it, or a
// card scrolled past pausing itself would silence the one being watched.
let speaker: object | null = null;
const owners = new WeakMap<VideoPlayer, object>();
function stopIfMine(owner: object) {
  if (speaker !== owner) return;
  speaker = null;
  void Speech?.stop();
}

interface VoiceDubOptions {
  player: VideoPlayer | null;
  /** The translated lines, or null while the translation is not ready. */
  segments: TranscriptSegment[] | null;
  /** Language to speak in. */
  lang: string | null;
  enabled: boolean;
  onFailed?: () => void;
}

export function useVoiceDub({ player, segments, lang, enabled, onFailed }: VoiceDubOptions) {
  const master = useMediaVolume();
  const mix = useDubMix();
  const reconcileRef = useRef<(() => void) | null>(null);
  const active = speechAvailable && enabled && !!player && !!lang && !!segments?.length;
  const owner = useRef({}).current;
  const failedRef = useRef(onFailed);
  failedRef.current = onFailed;

  useEffect(() => {
    if (!active || !player || !segments || !lang) return;
    if (owners.has(player)) return;
    owners.set(player, owner);
    // The line most recently started. Reset to -1 whenever speech is cut, so
    // playback resumes with whatever line the playhead is on.
    let spoken = -1;
    // The line the picture reached while an earlier one was still being read.
    let pending = -1;
    let lastT = -1;
    let alive = true;
    let failed = false;
    let voiceReady = false;
    let voice: string | undefined;
    let utterance = 0;
    let spokenChar = 0;
    let resumeWord = { index: -1, offset: 0 };
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let speechVolume = dubVoiceVolume(getVolume());
    const syncVolume = () => {
      setDubMixActive(player, alive && voiceReady && !failed);
      try { applyVideoVolume(player, getVolume()); } catch {}
    };

    const silence = () => {
      if (restartTimer !== null) clearTimeout(restartTimer);
      restartTimer = null;
      utterance++;
      stopIfMine(owner);
      spoken = -1;
      pending = -1;
    };
    const voiceKey = () => `${lang}:${voice ?? ""}`;
    const learn = (chars: number, seconds: number, rate: number) => {
      if (chars < 20 || seconds < 1) return;
      const seen = chars / (seconds * rate);
      if (!(seen > 6 && seen < 30)) return;
      const known = measuredCps.get(voiceKey());
      measuredCps.set(voiceKey(), known ? known * 0.6 + seen * 0.4 : seen);
    };
    const fail = () => {
      failed = true;
      silence();
      syncVolume();
      failedRef.current?.();
    };

    const speakLine = (i: number, t: number, charOffset = 0) => {
      if (!alive || failed || !voiceReady || !Speech || restartTimer !== null || dubVoiceVolume(getVolume()) === 0) return;
      if (i < 0 || i === spoken) return;
      const seg = segments[i];
      if (lineRoom(segments, i, t) < MIN_REMAINING_S) return;
      spoken = i;
      pending = -1;
      spokenChar = charOffset;
      const text = (seg.text ?? "").slice(charOffset).trim();
      if (!text) return;
      const id = ++utterance;
      speaker = owner;
      const current = () => alive && utterance === id;
      const finish = () => {
        if (!current()) return;
        if (speaker === owner) speaker = null;
      };
      void Speech.stop().then(() => {
        if (!current() || speaker !== owner || !player.playing || player.muted) return;
        // Aim to end with the line's own span; a line starting after its span
        // aims for the silence it was given.
        const now = player.currentTime;
        const left = seg.end - now;
        const rate = speechRate(text, left > 0 ? left : lineRoom(segments, i, now), player.playbackRate, measuredCps.get(voiceKey()));
        let startedAt = 0;
        Speech?.speak(text, {
          language: lang,
          voice,
          volume: dubVoiceVolume(getVolume()),
          useApplicationAudioSession: true,
          rate,
          onStart: () => {
            if (!current()) return;
            if (!player.playing || player.muted || dubVoiceVolume(getVolume()) === 0) { silence(); return; }
            startedAt = Date.now();
          },
          onBoundary: (event) => { if (current()) spokenChar = charOffset + event.charIndex; },
          onDone: () => {
            if (!current()) return;
            if (startedAt) learn(text.length, (Date.now() - startedAt) / 1000, rate);
            finish();
            // Whatever the picture reached meanwhile starts now.
            if (player.playing && !player.muted) advance(player.currentTime);
          },
          onStopped: finish,
          onError: () => { if (current()) fail(); },
        });
      }).catch(() => { if (current()) fail(); });
    };
    const speakAt = (t: number, charOffset = 0) => speakLine(segmentIndexAt(segments, t), t, charOffset);

    // A line still being read when the next begins is left to finish: the
    // next one waits its turn and reads faster to catch up. Only a voice that
    // has fallen well behind the picture is cut, and a line with no time left
    // is dropped whole rather than chopped mid-word.
    const advance = (t: number) => {
      const i = segmentIndexAt(segments, t);
      if (speaker === owner && spoken >= 0) {
        if (i === spoken) return;
        if (t - segments[spoken].end <= MAX_LAG_S) {
          if (i >= 0) pending = i;
          return;
        }
        silence();
      }
      if (i >= 0) { speakLine(i, t); return; }
      // Between lines: a line whose span passed while the last one was being
      // finished is read now if the silence leaves room for it.
      if (pending >= 0 && pending !== spoken) {
        const late = pending;
        pending = -1;
        speakLine(late, t);
      }
    };

    const onTime = ({ currentTime }: { currentTime: number }) => {
      const rate = Math.max(1, player.playbackRate || 1);
      const jumped =
        lastT >= 0 && (currentTime < lastT - 0.25 || currentTime - lastT > SEEK_JUMP_S * rate);
      lastT = currentTime;
      if (jumped) silence();
      if (!player.playing || player.muted || dubVoiceVolume(getVolume()) === 0) {
        if (speaker === owner) silence();
        return;
      }
      advance(currentTime);
    };

    const timeSub = player.addListener("timeUpdate", onTime);
    const playSub = player.addListener("playingChange", ({ isPlaying }: { isPlaying: boolean }) => {
      if (!isPlaying) silence();
      else if (!player.muted) advance(player.currentTime);
    });
    const muteSub = player.addListener("mutedChange", ({ muted }: { muted: boolean }) => {
      if (muted) silence();
    });
    const volumeSub = player.addListener("volumeChange", () => {
      syncVolume();
      if (getVolume() === 0 || player.muted) silence();
    });
    const endSub = player.addListener("playToEnd", silence);

    const reconcile = () => {
      syncVolume();
      const next = dubVoiceVolume(getVolume());
      if (next === speechVolume) return;
      const previous = speechVolume;
      speechVolume = next;
      if (speaker === owner) resumeWord = { index: spoken, offset: spokenChar };
      else if (restartTimer === null && previous > 0 && next > 0) return;
      silence();
      if (!next || failed || !player.playing || player.muted) return;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!alive || !player.playing || player.muted) return;
        const i = segmentIndexAt(segments, player.currentTime);
        speakAt(player.currentTime, i === resumeWord.index ? resumeWord.offset : 0);
      }, 120);
    };
    reconcileRef.current = reconcile;

    void findVoice(lang).then((found) => {
      if (!alive) return;
      if (found === null) { fail(); return; }
      voice = found?.identifier;
      voiceReady = true;
      syncVolume();
      if (player.playing && !player.muted) advance(player.currentTime);
    }).catch(() => { if (alive) fail(); });

    return () => {
      alive = false;
      timeSub.remove();
      playSub.remove();
      muteSub.remove();
      volumeSub.remove();
      endSub.remove();
      silence();
      if (reconcileRef.current === reconcile) reconcileRef.current = null;
      syncVolume();
      if (owners.get(player) === owner) owners.delete(player);
    };
  }, [active, player, segments, lang, owner]);
  useEffect(() => { reconcileRef.current?.(); }, [master, mix.voice, mix.original]);
}
