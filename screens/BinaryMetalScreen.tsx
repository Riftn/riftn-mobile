/**
 * BinaryMetalScreen
 * =================
 * Native twin of riftn-web /music/binary-metal ("Riff Lab"), from the Requests
 * board. Type anything: every character becomes its UTF-8 bytes, every byte a
 * bar of eight notes. On the low string 0 plays open and 1 the first fret, with
 * bass, kick, snare and crash to match. Play it, save WAV or MP3, or post it.
 *
 * The bits, tab and playhead come from libs/binaryMetal.ts. The sound is drawn
 * by the web engine itself in a hidden WebView (riftn.com/binary-metal/
 * render.html), which hands the file back in base64 chunks that are written
 * straight to the cache folder. So the app and the site sound the same and
 * nothing is uploaded unless the person posts it.
 */
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import Icon from '../components/ui/Icon';
import ScreenHeader from '../components/ScreenHeader';
import { KitButton, PageSection, PageTabs, useKitColors } from '../components/page/PageKit';
import { ScreenNames } from '../navigation/ScreenNames';
import { useAuth } from '../context/AuthContext';
import { toastError, toastSuccess } from '../libs/toast';
import { shareWithRef } from '../libs/shareRef';
import { requestAudioFocus, releaseAudioFocus } from '../libs/audioFocus';
import { WEBSITE_LINK } from '../config/links';
import {
  MAX_BPM, MAX_CHARS, MIN_BPM, STYLE_BPM, STYLE_IDS, TUNING_IDS, TUNING_STRINGS,
  bytesOf, clip, fileName, formatClock, isStyle, positionAt, settingsOf, tabBars, timeline,
  type BinaryMetalOptions, type BinaryMetalStyle,
} from '../libs/binaryMetal';

const PAGE_URL = `${WEBSITE_LINK}/music/binary-metal`;
const RENDER_URL = `${WEBSITE_LINK}/binary-metal/render.html`;
const SOFT = 'hsla(240, 5%, 65%, 1)';
const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const DEFAULT_TEXT = 'Riftn rules';

type Format = 'wav' | 'mp3';
interface Rendered { uri: string; duration: number; mime: string }

const pageLink = (text: string, style: BinaryMetalStyle) =>
  `${PAGE_URL}?text=${encodeURIComponent(clip(text))}&style=${style}`;

/* ---------------------------------------------------------------- renderer */

interface RendererHandle {
  render: (text: string, opts: BinaryMetalOptions, format: Format, onProgress?: (f: number) => void) => Promise<Rendered>;
}

interface Job {
  id: string;
  payload: Record<string, unknown>;
  file: string;
  mime: string;
  writes: Promise<unknown>;
  onProgress?: (f: number) => void;
  resolve: (r: Rendered) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

const DIR = `${FileSystem.cacheDirectory ?? ''}binary-metal/`;
const JOB_TIMEOUT = 180_000;

/**
 * The web engine in a WebView. It stays on screen but nearly invisible, like
 * the editor's turntable recorder, because some phones pause off-screen views.
 */
const RiffRenderer = forwardRef<RendererHandle>(function RiffRenderer(_, ref) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const queue = useRef<Job[]>([]);
  const current = useRef<Job | null>(null);
  const [generation, setGeneration] = useState(0);

  const finish = useCallback((job: Job, error?: Error, result?: Rendered) => {
    if (job.timer) clearTimeout(job.timer);
    if (current.current === job) current.current = null;
    if (error) {
      job.reject(error);
      void FileSystem.deleteAsync(job.file, { idempotent: true }).catch(() => undefined);
    } else if (result) job.resolve(result);
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pump = useCallback(() => {
    if (!ready.current || current.current) return;
    const job = queue.current.shift();
    if (!job) return;
    current.current = job;
    job.timer = setTimeout(() => finish(job, new Error('timeout')), JOB_TIMEOUT);
    web.current?.injectJavaScript(`window.renderBinaryMetal && window.renderBinaryMetal(${JSON.stringify(job.payload)}); true;`);
  }, [finish]);

  useImperativeHandle(ref, () => ({
    render: (text, opts, format, onProgress) => new Promise<Rendered>((resolve, reject) => {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const file = `${DIR}${id}.${format}`;
      const job: Job = {
        id, file, onProgress, resolve, reject,
        mime: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
        payload: { id, text, style: opts.style, bpm: opts.bpm, tuning: opts.tuning, power: opts.power, format },
        writes: FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined),
      };
      queue.current.push(job);
      pump();
    }),
  }), [pump]);

  const restart = useCallback(() => {
    ready.current = false;
    const job = current.current;
    if (job) finish(job, new Error('renderer stopped'));
    setGeneration((g) => g + 1);
  }, [finish]);

  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.renderer}>
      <WebView
        key={generation}
        ref={web}
        source={{ uri: RENDER_URL }}
        javaScriptEnabled
        originWhitelist={[WEBSITE_LINK]}
        onError={restart}
        onContentProcessDidTerminate={restart}
        onRenderProcessGone={restart}
        onMessage={(event) => {
          let m: { type?: string; ready?: boolean; id?: string; error?: string; progress?: number; index?: number; total?: number; chunk?: string; duration?: number };
          try { m = JSON.parse(event.nativeEvent.data); } catch { return; }
          if (m.type !== 'binary-metal') return;
          if (m.ready) { ready.current = true; pump(); return; }
          const job = current.current;
          if (!job || m.id !== job.id) return;
          if (m.error) { finish(job, new Error(m.error)); return; }
          if (typeof m.progress === 'number') { job.onProgress?.(m.progress); return; }
          if (typeof m.chunk !== 'string' || typeof m.index !== 'number' || typeof m.total !== 'number') return;
          const { chunk, index, total } = m;
          job.writes = job.writes.then(() => FileSystem.writeAsStringAsync(job.file, chunk, { encoding: FileSystem.EncodingType.Base64, append: index > 0 }));
          if (index === total - 1) {
            const duration = Number(m.duration) || 0;
            job.writes.then(
              () => finish(job, undefined, { uri: job.file, duration, mime: job.mime }),
              (e: unknown) => finish(job, e instanceof Error ? e : new Error(String(e))),
            );
          }
        }}
      />
    </View>
  );
});

/* ---------------------------------------------------------------- pieces */

const ByteChip = memo(function ByteChip({ ch, bits, active, bit }: { ch: string; bits: string; active: boolean; bit: number }) {
  const c = useKitColors();
  return (
    <View style={[styles.byte, { backgroundColor: active ? c.activeBg : c.chipBg, borderColor: c.hairline }]}>
      <Text numberOfLines={1} style={[styles.byteChar, { color: active ? c.activeInk : undefined }]} className={active ? undefined : 'text-theme-neutrals-100'}>
        {ch === ' ' ? '␣' : ch}
      </Text>
      <Text style={[styles.byteBits, { color: active ? c.activeInk : SOFT }]}>
        {active ? Array.from(bits).map((b, i) => (
          <Text key={i} style={i === bit ? styles.byteBitLit : undefined}>{b}</Text>
        )) : bits}
      </Text>
    </View>
  );
});

const TabBar = memo(function TabBar({ strings, active, bit }: { strings: string[][]; active: boolean; bit: number }) {
  const c = useKitColors();
  return (
    <View style={[styles.tabBar, { borderColor: c.hairline }]}>
      {strings.map((frets, row) => (
        <View key={row} style={styles.tabRow}>
          {frets.map((f, col) => {
            const lit = active && col === bit && f !== '-';
            const wash = active && col === bit;
            return (
              <View key={col} style={[styles.tabCell, wash && { backgroundColor: c.chipBg }, lit && { backgroundColor: c.activeBg, borderRadius: 4 }]}>
                <Text style={[styles.tabFret, { color: lit ? c.activeInk : f === '-' ? 'rgba(160,160,170,0.45)' : undefined }]} className={lit || f === '-' ? undefined : 'text-theme-neutrals-100'}>
                  {f}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
});

/* ---------------------------------------------------------------- screen */

const BinaryMetalScreen = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useAuth();
  const c = useKitColors();

  const startStyle: BinaryMetalStyle = isStyle(route.params?.style) ? route.params.style : 'thrash';
  const [text, setText] = useState(() => clip(typeof route.params?.text === 'string' && route.params.text ? route.params.text : DEFAULT_TEXT));
  const [opts, setOpts] = useState<BinaryMetalOptions>(() => settingsOf({ style: startStyle, bpm: STYLE_BPM[startStyle] }));

  const bytes = useMemo(() => bytesOf(text), [text]);
  const bars = useMemo(() => tabBars(text, opts), [text, opts]);
  const tl = useMemo(() => timeline(text, opts), [text, opts]);
  const strings = TUNING_STRINGS[opts.tuning];

  const renderer = useRef<RendererHandle>(null);
  const cache = useRef(new Map<string, Promise<Rendered>>());
  const player = useRef<AudioPlayer | null>(null);
  const raf = useRef<number | null>(null);
  const [busy, setBusy] = useState<null | 'play' | Format | 'post'>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [clock, setClock] = useState(0);

  const keyOf = useCallback((format: Format) => `${format}|${clip(text)}|${opts.style}|${opts.bpm}|${opts.tuning}|${opts.power ? 1 : 0}`, [text, opts]);

  const get = useCallback((format: Format) => {
    const key = keyOf(format);
    let job = cache.current.get(key);
    if (!job) {
      setProgress(0);
      job = renderer.current
        ? renderer.current.render(clip(text), opts, format, (f) => setProgress(f))
        : Promise.reject(new Error('renderer missing'));
      job.catch(() => cache.current.delete(key));
      cache.current.set(key, job);
    }
    return job;
  }, [keyOf, text, opts]);

  const stop = useCallback(() => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
    const p = player.current;
    player.current = null;
    if (p) { try { p.pause(); p.remove(); } catch { /* already gone */ } }
    setPlaying(false);
    setClock(0);
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const focusStop = useCallback(() => stopRef.current(), []);

  // A new riff (text or settings) stops the old one.
  useEffect(() => { stop(); releaseAudioFocus(focusStop); }, [text, opts, stop, focusStop]);
  useEffect(() => () => { stop(); releaseAudioFocus(focusStop); }, [stop, focusStop]);

  const play = useCallback(async () => {
    if (playing) { stop(); releaseAudioFocus(focusStop); return; }
    if (!bytes.length || busy) return;
    setBusy('play');
    try {
      const riff = await get('mp3');
      stop();
      const p = createAudioPlayer({ uri: riff.uri });
      player.current = p;
      requestAudioFocus(focusStop);
      p.play();
      setPlaying(true);
      const end = riff.duration || tl.duration;
      const tick = () => {
        if (player.current !== p) return;
        const now = p.currentTime || 0;
        setClock(now);
        if (now >= end - 0.05 || (!p.playing && now > 0.5 && now >= end - 0.5)) { stop(); releaseAudioFocus(focusStop); return; }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch {
      toastError(t('binaryMetal.playFailed'));
    } finally {
      setBusy(null);
    }
  }, [playing, bytes.length, busy, get, stop, focusStop, tl.duration, t]);

  const save = useCallback(async (format: Format) => {
    if (!bytes.length || busy) return;
    setBusy(format);
    try {
      const riff = await get(format);
      const name = fileName(text, opts, format);
      if (Platform.OS === 'android') {
        const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permission.granted) return;
        const dest = await FileSystem.StorageAccessFramework.createFileAsync(permission.directoryUri, name.replace(/\.\w+$/, ''), riff.mime);
        const info = await FileSystem.getInfoAsync(riff.uri);
        const size = info.exists && !info.isDirectory ? info.size ?? 0 : 0;
        const chunk = 3 * 256 * 1024;
        for (let pos = 0; pos < size; pos += chunk) {
          const part = await FileSystem.readAsStringAsync(riff.uri, { encoding: FileSystem.EncodingType.Base64, position: pos, length: Math.min(chunk, size - pos) });
          await FileSystem.writeAsStringAsync(dest, part, { encoding: FileSystem.EncodingType.Base64, append: pos > 0 });
        }
        toastSuccess(t('binaryMetal.saved'));
      } else {
        // iOS shares a copy with the tidy name, so Files and AirDrop show it.
        const named = `${DIR}${name}`;
        await FileSystem.deleteAsync(named, { idempotent: true }).catch(() => undefined);
        await FileSystem.copyAsync({ from: riff.uri, to: named });
        await Share.share({ url: named });
      }
    } catch {
      toastError(t('binaryMetal.exportFailed'));
    } finally {
      setBusy(null);
    }
  }, [bytes.length, busy, get, text, opts, t]);

  const post = useCallback(async () => {
    if (!bytes.length || busy) return;
    if (!user) { navigation.navigate(ScreenNames.SignIn); return; }
    setBusy('post');
    try {
      const riff = await get('mp3');
      const name = fileName(text, opts, 'mp3');
      navigation.navigate(ScreenNames.Upload, {
        initialText: t('binaryMetal.postCaption', { text: clip(text), url: pageLink(text, opts.style) }),
        audio: { uri: riff.uri, name, mimeType: 'audio/mpeg', durationMs: Math.round((riff.duration || tl.duration) * 1000) },
      });
    } catch {
      toastError(t('binaryMetal.exportFailed'));
    } finally {
      setBusy(null);
    }
  }, [bytes.length, busy, user, navigation, get, text, opts, tl.duration, t]);

  const share = useCallback(() => {
    const url = pageLink(text, opts.style);
    void shareWithRef({ url, message: `${t('binaryMetal.title')} ${url}` }).catch(() => undefined);
  }, [text, opts.style, t]);

  // Playhead and auto-scroll.
  const at = playing ? positionAt(text, opts, clock) : null;
  const tabScroll = useRef<ScrollView>(null);
  const byteScroll = useRef<ScrollView>(null);
  const BAR_W = 8 * 16 + 10;
  const BYTE_W = 76;
  useEffect(() => {
    if (!at) return;
    tabScroll.current?.scrollTo({ x: Math.max(0, at.byte * BAR_W - 40), animated: true });
    byteScroll.current?.scrollTo({ x: Math.max(0, at.byte * BYTE_W - 40), animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at?.byte]);

  const setStyle = (style: BinaryMetalStyle) => setOpts((o) => ({ ...o, style, bpm: STYLE_BPM[style] }));
  const nudge = (d: number) => setOpts((o) => ({ ...o, bpm: Math.max(MIN_BPM, Math.min(MAX_BPM, o.bpm + d)) }));
  const nextTuning = () => setOpts((o) => ({ ...o, tuning: TUNING_IDS[(TUNING_IDS.indexOf(o.tuning) + 1) % TUNING_IDS.length] }));

  const total = tl.duration;
  const fraction = playing && total ? Math.min(1, clock / total) : 0;
  const making = busy === 'play' || (busy && busy !== 'post');
  const pct = Math.round(progress * 100);
  const primaryInk = c.primaryMaterial ? c.primaryInk : '#0B0B0C';

  return (
    <View className="bg-theme-background" style={{ flex: 1 }}>
      <ScreenHeader
        title={t('binaryMetal.title')}
        icon="audio"
        rightContent={(
          <Pressable accessibilityRole="button" accessibilityLabel={t('binaryMetal.share')} hitSlop={8} onPress={share}>
            <Icon name="Share2" size={18} color={SOFT} />
          </Pressable>
        )}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 32 }}>
        <PageSection eyebrow={t('binaryMetal.typeLabel')}>
          <View style={[styles.inputBox, { borderColor: c.hairline, backgroundColor: c.chipBg }]}>
            <TextInput
              value={text}
              onChangeText={(v) => setText(clip(v))}
              placeholder={t('binaryMetal.placeholder')}
              placeholderTextColor={SOFT}
              multiline
              className="text-theme-neutrals-100"
              style={styles.input}
              accessibilityLabel={t('binaryMetal.typeLabel')}
            />
          </View>
          <Text style={styles.count}>{`${Array.from(text).length}/${MAX_CHARS}`}</Text>
        </PageSection>

        {bytes.length ? (
          <>
            <PageSection eyebrow={t('binaryMetal.binaryEyebrow')} flush>
              <ScrollView ref={byteScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bytesRow}>
                {bytes.map((b, i) => (
                  <ByteChip key={i} ch={b.ch} bits={b.bits} active={at?.byte === i} bit={at?.byte === i ? at.bit : -1} />
                ))}
              </ScrollView>
            </PageSection>

            <PageSection eyebrow={t('binaryMetal.tabEyebrow')} flush>
              <View style={styles.tabWrap}>
                <View style={styles.tabNames}>
                  {strings.map((s, i) => <Text key={i} style={styles.tabName}>{s}</Text>)}
                </View>
                <ScrollView ref={tabScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 16 }}>
                  {bars.map((bar, i) => (
                    <TabBar key={i} strings={bar} active={at?.byte === i} bit={at?.byte === i ? at.bit : -1} />
                  ))}
                </ScrollView>
              </View>
            </PageSection>
          </>
        ) : (
          <PageSection>
            <Text style={styles.note}>{t('binaryMetal.empty')}</Text>
          </PageSection>
        )}

        <PageSection eyebrow={t('binaryMetal.styleEyebrow')} flush>
          <PageTabs
            size="sm"
            tabs={STYLE_IDS.map((id) => ({ id, label: t(`binaryMetal.styles.${id}`) }))}
            value={opts.style}
            onChange={setStyle}
            style={{ paddingHorizontal: 16 }}
          />
          <View style={styles.controls}>
            <View style={styles.tempo}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('binaryMetal.slower')} onPress={() => nudge(-10)} disabled={opts.bpm <= MIN_BPM} hitSlop={6}>
                <View style={[styles.square, { backgroundColor: c.chipBg, borderColor: c.hairline, opacity: opts.bpm <= MIN_BPM ? 0.4 : 1 }]}>
                  <Icon name="Minus" size={16} color={SOFT} />
                </View>
              </Pressable>
              <Text className="text-theme-neutrals-100" style={styles.bpm}>{t('binaryMetal.bpm', { bpm: opts.bpm })}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('binaryMetal.faster')} onPress={() => nudge(10)} disabled={opts.bpm >= MAX_BPM} hitSlop={6}>
                <View style={[styles.square, { backgroundColor: c.chipBg, borderColor: c.hairline, opacity: opts.bpm >= MAX_BPM ? 0.4 : 1 }]}>
                  <Icon name="Plus" size={16} color={SOFT} />
                </View>
              </Pressable>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('binaryMetal.tuning')}: ${t(`binaryMetal.tunings.${opts.tuning}`)}`} onPress={nextTuning}>
              <View style={[styles.chip, { backgroundColor: c.chipBg, borderColor: c.hairline }]}>
                <Text className="text-theme-neutrals-100" style={styles.chipText}>{t(`binaryMetal.tunings.${opts.tuning}`)}</Text>
              </View>
            </Pressable>
          </View>
          <View style={[styles.powerRow, { borderTopColor: c.hairline }]}>
            <Text className="text-theme-neutrals-100" style={styles.powerLabel}>{t('binaryMetal.power')}</Text>
            <Switch value={opts.power} onValueChange={(power) => setOpts((o) => ({ ...o, power }))} accessibilityLabel={t('binaryMetal.power')} />
          </View>
        </PageSection>

        <PageSection>
          <View style={styles.clockRow}>
            <Text className="text-theme-neutrals-100" style={styles.clock}>{formatClock(playing ? clock : 0)}</Text>
            <Text style={styles.clockTotal}>{formatClock(total)}</Text>
          </View>
          <View style={[styles.track, { backgroundColor: c.chipBg }]}>
            <View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: c.activeBg }]} />
          </View>
          <KitButton
            label={making ? `${t('binaryMetal.making')}${pct > 0 && pct < 100 ? ` ${pct}%` : '…'}` : playing ? t('binaryMetal.pause') : t('binaryMetal.play')}
            onPress={() => void play()}
            disabled={!bytes.length || (!!busy && busy !== 'play')}
            icon={busy === 'play' ? <ActivityIndicator size="small" color={primaryInk} /> : <Icon name={playing ? 'Pause' : 'Play'} size={16} color={primaryInk} />}
            style={{ marginTop: 14 }}
          />
          <View style={styles.actions}>
            {(['wav', 'mp3'] as const).map((f) => (
              <KitButton
                key={f}
                variant="quiet"
                label={f.toUpperCase()}
                onPress={() => void save(f)}
                disabled={!bytes.length || !!busy}
                icon={busy === f ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Icon name="Download" size={15} color="#FFFFFF" />}
                style={{ flex: 1 }}
              />
            ))}
            <KitButton
              variant="quiet"
              label={t('binaryMetal.post')}
              onPress={() => void post()}
              disabled={!bytes.length || !!busy}
              icon={busy === 'post' ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Icon name="Send" size={15} color="#FFFFFF" />}
              style={{ flex: 1 }}
            />
          </View>
          <Text style={styles.note}>{t('binaryMetal.onDevice')}</Text>
        </PageSection>

        <PageSection eyebrow={t('binaryMetal.howEyebrow')}>
          <Text style={styles.how}>{t('binaryMetal.how')}</Text>
        </PageSection>
      </ScrollView>
      <RiffRenderer ref={renderer} />
    </View>
  );
};

const styles = StyleSheet.create({
  renderer: { position: 'absolute', left: 0, bottom: 0, width: 48, height: 48, opacity: 0.01 },
  inputBox: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  input: { minHeight: 44, maxHeight: 120, paddingVertical: 10, fontSize: 16 },
  count: { color: SOFT, fontSize: 11, textAlign: 'right', marginTop: 6 },
  bytesRow: { gap: 6, paddingHorizontal: 16, paddingBottom: 16 },
  byte: { width: 70, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, alignItems: 'center' },
  byteChar: { fontSize: 16, fontWeight: '700' },
  byteBits: { fontFamily: MONO, fontSize: 10, letterSpacing: 0.5, marginTop: 2 },
  byteBitLit: { fontWeight: '800', textDecorationLine: 'underline' },
  tabWrap: { flexDirection: 'row', paddingLeft: 16, paddingBottom: 16 },
  tabNames: { paddingRight: 6, paddingTop: 4 },
  tabName: { fontFamily: MONO, fontSize: 12, height: 18, lineHeight: 18, color: SOFT, textAlign: 'right' },
  tabBar: { paddingHorizontal: 4, paddingVertical: 4, borderLeftWidth: 1, borderRightWidth: 0 },
  tabRow: { flexDirection: 'row', height: 18 },
  tabCell: { width: 16, height: 18, alignItems: 'center', justifyContent: 'center' },
  tabFret: { fontFamily: MONO, fontSize: 12, fontWeight: '600' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 10 },
  tempo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  square: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  bpm: { fontSize: 14, fontWeight: '700', minWidth: 72, textAlign: 'center' },
  chip: { height: 32, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '600' },
  powerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  powerLabel: { fontSize: 14, fontWeight: '600' },
  clockRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  clock: { fontFamily: MONO, fontSize: 22, fontWeight: '700' },
  clockTotal: { fontFamily: MONO, fontSize: 13, color: SOFT },
  track: { height: 4, borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  note: { color: SOFT, fontSize: 12, lineHeight: 17, marginTop: 10 },
  how: { color: SOFT, fontSize: 13, lineHeight: 19 },
});

export default BinaryMetalScreen;
