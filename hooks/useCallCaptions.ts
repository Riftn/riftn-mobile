/**
 * Live subtitles in calls, phone side. One engine per call (mounted by
 * CallModalsHost so minimising the call keeps it going) does both halves:
 *
 * - Reading: joins the call's private caption channel, shows lines from the
 *   people on the call, in your language once their phone has translated them,
 *   and announces your language so they know what to translate into.
 * - Speaking: while someone else is reading and you are not muted, streams
 *   your microphone to the transcriber, broadcasts what you say, and translates
 *   each finished sentence into the languages the others read.
 *
 * Same channel, events and pacing as the website, so phones and browsers on one
 * call read each other.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";
import { useCall } from "../context/CallContext";
import { useAuth } from "../context/AuthContext";
import { createLogger } from "../libs/logger";
import {
  CAPTION_EVENT, CAPTION_FINAL_TTL_MS, CAPTION_INTERIM_TTL_MS, CAPTION_MAX_LINES, CAPTION_SOURCE_LANGUAGE,
  CAPTION_TRANSLATION_EVENT, type CaptionMessage, type CaptionTranslation,
  dubCaption, fetchCallCaptionTopic, fetchCaptionCredential, frameLevel, newUtteranceId, translateCaption,
  useCallCaptionPrefs,
} from "../libs/callCaptions";

const log = createLogger("callCaptions");

const VOICE_LEVEL = 0.012;
const SILENCE_CLOSE_MS = 45_000;
const PREROLL_FRAMES = 16;
const INTERIM_THROTTLE_MS = 350;
const KEEPALIVE_MS = 8000;
const DUB_AUDIO_EVENT = "caption-audio";

// ─── Lines, shared with the overlay ─────────────────────────────────────────

export interface CaptionLine {
  id: string;
  wallet: string;
  name: string;
  text: string;
  final: boolean;
  at: number;
  translations?: Record<string, string>;
}

let lines: CaptionLine[] = [];
let ready = false;
const lineListeners = new Set<() => void>();
const notify = () => lineListeners.forEach((l) => l());
const subscribeLines = (cb: () => void) => { lineListeners.add(cb); return () => { lineListeners.delete(cb); }; };
function setLines(next: CaptionLine[]) { if (next !== lines) { lines = next; notify(); } }
function setReady(next: boolean) { if (next !== ready) { ready = next; notify(); } }

/** The lines on screen right now. */
export function useCallCaptionLines(): CaptionLine[] {
  return useSyncExternalStore(subscribeLines, () => lines, () => lines);
}

/** True once this call's private caption channel is open (the button shows then). */
export function useCallCaptionsReady(): boolean {
  return useSyncExternalStore(subscribeLines, () => ready, () => ready);
}

/** Preview screens only: put sample lines on screen without a call. */
export function previewCallCaptions(sample: CaptionLine[]) {
  setLines(sample);
  setReady(true);
}

export function foldCaption(prev: CaptionLine[], next: CaptionLine): CaptionLine[] {
  const index = prev.findIndex((line) => line.id === next.id);
  if (index >= 0) {
    const copy = prev.slice();
    copy[index] = { ...next, translations: prev[index].translations ?? next.translations };
    return copy;
  }
  return [...prev, next].slice(-CAPTION_MAX_LINES);
}

export function foldTranslation(prev: CaptionLine[], translation: CaptionTranslation): CaptionLine[] {
  const index = prev.findIndex((line) => line.id === translation.id);
  if (index < 0) return prev;
  const copy = prev.slice();
  copy[index] = { ...prev[index], translations: { ...prev[index].translations, ...translation.translations } };
  return copy;
}

function toLine(message: CaptionMessage): CaptionLine {
  return {
    id: message.id,
    wallet: String(message.wallet || "").toLowerCase(),
    name: message.name || "",
    text: message.text,
    final: !!message.final,
    at: Date.now(),
  };
}

// ─── The engine ─────────────────────────────────────────────────────────────

export function useCallCaptionEngine(selfName: string) {
  const { captionRoom, captionSpeakers, isMuted, tapMicrophone } = useCall();
  const { user } = useAuth();
  const wallet = (user?.walletAddress || user?.address || "").toLowerCase();
  const { show, send, language } = useCallCaptionPrefs();

  const channelRef = useRef<RealtimeChannel | null>(null);
  const audioChannelRef = useRef<RealtimeChannel | null>(null);
  const joinedRef = useRef(false);
  const speakersRef = useRef<Set<string>>(new Set());
  speakersRef.current = new Set(captionSpeakers);
  const languagesRef = useRef<string[]>([]);
  const dubTokensRef = useRef<Record<string, string>>({});
  const nameRef = useRef(selfName);
  nameRef.current = selfName;
  const presenceRef = useRef({ show, language });
  presenceRef.current = { show, language };
  const [readers, setReaders] = useState(0);
  const [room, setRoom] = useState<string | null>(null);

  // Join the call's private channel.
  useEffect(() => {
    if (!captionRoom || !wallet) return;
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let audio: RealtimeChannel | null = null;
    void (async () => {
      const topic = await fetchCallCaptionTopic(captionRoom, wallet).catch(() => null);
      if (disposed || !topic) return;
      channel = supabase.channel(topic, { config: { presence: { key: `phone-${Math.random().toString(36).slice(2, 10)}` } } });
      channel
        .on("broadcast", { event: CAPTION_EVENT }, ({ payload }) => {
          const message = payload as CaptionMessage | undefined;
          if (!message?.id || typeof message.text !== "string") return;
          if (!speakersRef.current.has(String(message.wallet || "").toLowerCase())) return;
          setLines(foldCaption(lines, toLine(message)));
        })
        .on("broadcast", { event: CAPTION_TRANSLATION_EVENT }, ({ payload }) => {
          const translation = payload as CaptionTranslation | undefined;
          if (!translation?.id || !translation.translations) return;
          setLines(foldTranslation(lines, translation));
        })
        .on("presence", { event: "sync" }, () => {
          const state = channel?.presenceState<{ lang?: string; dub?: string }>() ?? {};
          const languages = new Set<string>();
          const tokens: Record<string, string> = {};
          let count = 0;
          for (const entries of Object.values(state)) {
            if (entries.some((entry) => typeof entry.lang === "string")) count += 1;
            for (const entry of entries) {
              if (entry.lang && entry.lang !== CAPTION_SOURCE_LANGUAGE) languages.add(entry.lang);
              if (entry.lang && entry.dub) tokens[entry.lang] = entry.dub;
            }
          }
          languagesRef.current = [...languages];
          dubTokensRef.current = tokens;
          setReaders(count);
        })
        .subscribe((status) => {
          if (status !== "SUBSCRIBED" || disposed) return;
          joinedRef.current = true;
          const { show: showing, language: lang } = presenceRef.current;
          if (showing) void channel?.track({ lang: lang ?? CAPTION_SOURCE_LANGUAGE });
        });
      audio = supabase.channel(`${topic}:audio`);
      audio.subscribe();
      channelRef.current = channel;
      audioChannelRef.current = audio;
      setRoom(captionRoom);
      setReady(true);
    })();
    return () => {
      disposed = true;
      joinedRef.current = false;
      channelRef.current = null;
      audioChannelRef.current = null;
      if (channel) { void channel.untrack().catch(() => {}); void supabase.removeChannel(channel); }
      if (audio) void supabase.removeChannel(audio);
      languagesRef.current = [];
      dubTokensRef.current = {};
      setReaders(0);
      setRoom(null);
      setReady(false);
      setLines([]);
    };
  }, [captionRoom, wallet]);

  // Announce (or withdraw) what this phone is reading.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !joinedRef.current) return;
    if (show) void channel.track({ lang: language ?? CAPTION_SOURCE_LANGUAGE }).catch(() => {});
    else void channel.untrack().catch(() => {});
  }, [show, language, room]);

  // Old lines fade out.
  useEffect(() => {
    if (!room) return;
    const sweeper = setInterval(() => {
      const now = Date.now();
      const kept = lines.filter((line) => now - line.at < (line.final ? CAPTION_FINAL_TTL_MS : CAPTION_INTERIM_TTL_MS));
      if (kept.length !== lines.length) setLines(kept);
    }, 1000);
    return () => clearInterval(sweeper);
  }, [room]);

  // ─── Speaking ───────────────────────────────────────────────────────────
  const othersReading = readers - (show ? 1 : 0) > 0;
  const active = !!room && send && !isMuted && othersReading && !!wallet;

  useEffect(() => {
    if (!active || !room) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    let connecting = false;
    let forceEnglish = false;
    let openedAt = 0;
    let lastVoiceAt = 0;
    let failures = 0;
    const preroll: ArrayBuffer[] = [];
    let utteranceId = newUtteranceId();
    let finalised = "";
    let lastInterimAt = 0;
    let previousFinal = "";

    const broadcast = (event: string, payload: unknown, channel = channelRef.current) => {
      channel?.send({ type: "broadcast", event, payload }).catch(() => { /* the next line is a moment away */ });
    };

    const translate = async (message: CaptionMessage) => {
      const languages = languagesRef.current;
      if (!languages.length) return;
      const context = previousFinal;
      const translations = await translateCaption(room, wallet, message.id, message.text, context, languages);
      if (!translations || !Object.keys(translations).length) return;
      setLines(foldTranslation(lines, { id: message.id, translations }));
      broadcast(CAPTION_TRANSLATION_EVENT, { id: message.id, translations });
      const tokens = dubTokensRef.current;
      const items = Object.entries(tokens)
        .filter(([lang]) => translations[lang])
        .map(([lang, token]) => ({ lang, text: translations[lang], token }));
      if (!items.length) return;
      const clips = await dubCaption(room, wallet, message.id, items);
      for (const [lang, clip] of Object.entries(clips ?? {})) {
        broadcast(DUB_AUDIO_EVENT, { id: message.id, lang, audio: clip }, audioChannelRef.current);
      }
    };

    const emitLine = (text: string, final: boolean) => {
      const message: CaptionMessage = {
        id: utteranceId, wallet, name: nameRef.current, text: text.slice(0, 500), final, kind: "speech", at: Date.now(),
      };
      setLines(foldCaption(lines, toLine(message)));
      broadcast(CAPTION_EVENT, message);
      if (final && message.text) {
        void translate(message);
        previousFinal = message.text;
      }
    };

    const closeSocket = (graceful: boolean) => {
      finalised = "";
      utteranceId = newUtteranceId();
      lastInterimAt = 0;
      if (keepalive) { clearInterval(keepalive); keepalive = null; }
      const s = socket;
      socket = null;
      if (!s) return;
      try {
        if (graceful && s.readyState === WebSocket.OPEN) s.send(JSON.stringify({ type: "CloseStream" }));
        s.close();
      } catch { /* already gone */ }
    };

    const handleResults = (msg: any) => {
      const text = String(msg?.channel?.alternatives?.[0]?.transcript ?? "").trim();
      if (!text) return;
      if (msg.is_final) finalised = finalised ? `${finalised} ${text}` : text;
      const display = msg.is_final ? finalised : finalised ? `${finalised} ${text}` : text;
      if (msg.speech_final) {
        emitLine(display, true);
        finalised = "";
        utteranceId = newUtteranceId();
        lastInterimAt = 0;
        return;
      }
      const now = Date.now();
      if (now - lastInterimAt < INTERIM_THROTTLE_MS) return;
      lastInterimAt = now;
      emitLine(display, false);
    };

    const openSocket = async () => {
      if (disposed || socket || connecting) return;
      connecting = true;
      try {
        const credential = await fetchCaptionCredential(room, wallet);
        if (disposed || !credential) return;
        const params = new URLSearchParams({
          model: "nova-3", language: "multi", encoding: "linear16", sample_rate: "16000", channels: "1",
          interim_results: "true", smart_format: "true", punctuate: "true", endpointing: "300",
          ...credential.params,
        });
        if (forceEnglish) params.set("language", "en");
        const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, [credential.scheme, credential.token]);
        socket = ws;
        openedAt = Date.now();
        ws.onopen = () => {
          if (disposed) { closeSocket(true); return; }
          failures = 0;
          for (const frame of preroll.splice(0)) { try { ws.send(frame); } catch { /* closing */ } }
          keepalive = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ type: "KeepAlive" })); } catch { /* closing */ } }
          }, KEEPALIVE_MS);
        };
        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          try {
            const msg = JSON.parse(event.data);
            if (msg?.type === "Results") handleResults(msg);
          } catch { /* not JSON */ }
        };
        ws.onclose = (event) => {
          if (keepalive) { clearInterval(keepalive); keepalive = null; }
          if (socket === ws) socket = null;
          if (disposed) return;
          const refused = Date.now() - openedAt < 3000 && event.code !== 1000;
          if (refused && !forceEnglish) { forceEnglish = true; void openSocket(); return; }
          if (refused) {
            failures += 1;
            if (failures >= 3) { log.warn("Giving up on call captions after repeated socket failures", event.code); return; }
            setTimeout(() => { void openSocket(); }, 1000 * failures);
          }
        };
      } finally {
        connecting = false;
      }
    };

    const stopTap = tapMicrophone((pcm) => {
      const level = frameLevel(pcm);
      if (level > VOICE_LEVEL) lastVoiceAt = Date.now();
      const frame = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer;
      if (socket && socket.readyState === WebSocket.OPEN) {
        try { socket.send(frame); } catch { /* closing */ }
        return;
      }
      preroll.push(frame);
      if (preroll.length > PREROLL_FRAMES) preroll.shift();
      if (level > VOICE_LEVEL) void openSocket();
    });

    const silence = setInterval(() => {
      if (socket && lastVoiceAt && Date.now() - lastVoiceAt > SILENCE_CLOSE_MS) closeSocket(true);
    }, 5000);

    return () => {
      disposed = true;
      clearInterval(silence);
      stopTap();
      closeSocket(true);
    };
  }, [active, room, wallet, tapMicrophone]);
}
