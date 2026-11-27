/**
 * ChestardScreen
 * ==============
 * Native twin of riftn-web /arcade/chestard: a dice-drop arcade game from the
 * Requests board. Six columns, nine rows. Roll the die and the checker drops
 * into that column. A full bottom row clears like Tetris and pays a bonus; a
 * column that tops out ends the game.
 *
 * Signed in, the server rolls every die (riftn-backend
 * src/games/chestard.service.ts), so the top 10 is games really played.
 * Signed out, the same rules (libs/chestard.ts) run here and nothing is saved.
 *
 * The look is the retro screen the requester drew: magenta checkers, cyan
 * grid, pixel type. Sounds are the same chip-tune clips as the web
 * (assets/sounds/chestard-*.wav) and mix with whatever else is playing; the
 * speaker button mutes them.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Icon from '../components/ui/Icon';
import Avatar from '../components/common/Avatar';
import ScreenHeader from '../components/ScreenHeader';
import { KitButton, PageSection } from '../components/page/PageKit';
import { ScreenNames } from '../navigation/ScreenNames';
import { useAuth } from '../context/AuthContext';
import { toastError } from '../libs/toast';
import ArcadeShareSheet, { type SnapshotFile } from '../components/games/ArcadeShareSheet';
import { optionalSkia } from '../libs/skia';
import { formatCount } from '../libs/format-count';
import { COLS, ROWS, drop, emptyBoard, perDrop, type ChestardBoard } from '../libs/chestard';
import { chestardRoll, chestardStart, chestardState, type ChestardState, type GamePlayer } from '../services/games.service';

// Skia draws the snapshot; binaries without it just don't offer one.
const snapshotLib = optionalSkia(() => require('../libs/chestardSnapshot') as typeof import('../libs/chestardSnapshot'));
type SnapshotRef = React.MutableRefObject<(() => Promise<SnapshotFile | null>) | null>;
const CYAN = 'hsla(180, 100%, 67%, 1)';
const CYAN_DIM = 'hsla(180, 100%, 67%, 0.08)';
const CYAN_FAINT = 'hsla(180, 100%, 67%, 0.3)';
const MAGENTA = 'hsla(300, 100%, 67%, 1)';
const MAGENTA_DEEP = 'hsla(300, 100%, 33%, 1)';
const WHITE = 'hsla(0, 0%, 91%, 1)';
const SCREEN = 'hsla(0, 0%, 2%, 1)';
const SOFT = 'hsla(240, 5%, 65%, 1)';
const MUTED = 'hsla(240, 4%, 46%, 1)';
const PIXEL = 'PressStart2P';
const TUMBLE_MS = 420;
const CLEAR_MS = 300;
const SHIFT_MS = 220;
const GUEST_BEST_KEY = 'chestard.best';
const MUTE_KEY = 'chestard.muted';

type Sound = 'roll' | 'drop' | 'clear' | 'over' | 'best';
const SOUND_FILES: Record<Sound, number> = {
  roll: require('../assets/sounds/chestard-roll.wav'),
  drop: require('../assets/sounds/chestard-drop.wav'),
  clear: require('../assets/sounds/chestard-clear.wav'),
  over: require('../assets/sounds/chestard-over.wav'),
  best: require('../assets/sounds/chestard-best.wav'),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fallMs = (rowsFallen: number) => Math.round(150 + 24 * rowsFallen);
/** Counters read short (1.2K); under 1,000 the score keeps the arcade zeros. */
const scoreText = (n: number) => (n < 1000 ? String(n).padStart(6, '0') : formatCount(n));
const nameOf = (p: GamePlayer) => (p.username ? `@${p.username}` : p.displayName || `${p.address.slice(0, 6)}…`);

function useSounds() {
  const [muted, setMuted] = useState(false);
  const players = useRef<Partial<Record<Sound, AudioPlayer>>>({});
  useEffect(() => {
    void AsyncStorage.getItem(MUTE_KEY).then((v) => setMuted(v === '1')).catch(() => undefined);
    try {
      for (const s of Object.keys(SOUND_FILES) as Sound[]) {
        const p = createAudioPlayer(SOUND_FILES[s]);
        p.volume = 0.5;
        players.current[s] = p;
      }
    } catch {
      // A game sound is never worth an exception.
    }
    return () => {
      for (const p of Object.values(players.current)) {
        try { p?.remove(); } catch { /* already gone */ }
      }
      players.current = {};
    };
  }, []);
  const play = useCallback((s: Sound) => {
    if (muted) return;
    try {
      const p = players.current[s];
      if (!p) return;
      if (p.currentTime > 0) p.seekTo(0);
      p.play();
    } catch { /* never throws */ }
  }, [muted]);
  const toggle = useCallback(() => {
    setMuted((m) => {
      void AsyncStorage.setItem(MUTE_KEY, m ? '0' : '1').catch(() => undefined);
      return !m;
    });
  }, []);
  return { muted, play, toggle };
}

interface Checker { id: number; row: number; state: 'enter' | 'idle' | 'clear'; fall: number }

let nextId = 1;
const stacksFrom = (heights: number[]): Checker[][] =>
  heights.map((h) => Array.from({ length: h }, (_, row) => ({ id: nextId++, row, state: 'idle' as const, fall: 0 })));

function CheckerView({ c, col, cell }: { c: Checker; col: number; cell: number }) {
  const target = (ROWS - 1 - c.row) * cell;
  const top = useSharedValue(c.state === 'enter' ? -cell : target);
  const fade = useSharedValue(1);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (c.state === 'enter') {
      top.value = withSequence(
        withTiming(target, { duration: Math.round(c.fall * 0.86), easing: Easing.in(Easing.quad) }),
        withTiming(target - cell * 0.06, { duration: Math.round(c.fall * 0.07), easing: Easing.out(Easing.quad) }),
        withTiming(target, { duration: Math.round(c.fall * 0.07), easing: Easing.in(Easing.quad) }),
      );
    } else {
      top.value = withTiming(target, { duration: SHIFT_MS, easing: Easing.in(Easing.quad) });
    }
    // Only the row moves a checker; entering runs once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    if (c.state !== 'clear') return;
    fade.value = withSequence(
      withTiming(0.35, { duration: CLEAR_MS * 0.25 }),
      withTiming(1, { duration: CLEAR_MS * 0.25 }),
      withTiming(0, { duration: CLEAR_MS * 0.5 }),
    );
    scale.value = withSequence(withTiming(1, { duration: CLEAR_MS * 0.5 }), withTiming(0.4, { duration: CLEAR_MS * 0.5 }));
  }, [c.state, fade, scale]);

  const style = useAnimatedStyle(() => ({ top: top.value, opacity: fade.value, transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[{ position: 'absolute', left: col * cell, width: cell, height: cell, padding: 3 }, style]}>
      <View style={[styles.checker, { borderRadius: cell }]}>
        <View style={[styles.checkerCore, { borderRadius: cell }]} />
        <View style={[styles.checkerShine, { width: cell * 0.22, height: cell * 0.22, borderRadius: cell, left: cell * 0.2, top: cell * 0.16 }]} />
      </View>
    </Animated.View>
  );
}

function Board({ stacks, column, cell }: { stacks: Checker[][]; column: number | null; cell: number }) {
  return (
    <View>
      <View style={[styles.board, { width: cell * COLS + 6, height: cell * ROWS + 6 }]}>
        <View style={{ width: cell * COLS, height: cell * ROWS, overflow: 'hidden' }}>
          {column != null ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: column * cell, width: cell, backgroundColor: CYAN_DIM }} /> : null}
          {Array.from({ length: ROWS * COLS }, (_, i) => (
            <View key={i} style={[styles.dot, { left: (i % COLS) * cell + cell / 2 - 1.5, top: Math.floor(i / COLS) * cell + cell / 2 - 1.5 }]} />
          ))}
          {stacks.map((stack, col) => stack.map((c) => <CheckerView key={c.id} c={c} col={col} cell={cell} />))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', paddingTop: 8, paddingLeft: 3 }}>
        {Array.from({ length: COLS }, (_, i) => (
          <Text key={i} style={[styles.px, { width: cell, textAlign: 'center', color: CYAN, fontSize: 11 }]}>{i + 1}</Text>
        ))}
      </View>
    </View>
  );
}

function Die({ face, rolling }: { face: number | null; rolling: boolean }) {
  const tilt = useSharedValue(0);
  useEffect(() => {
    if (rolling) {
      tilt.value = withRepeat(withSequence(withTiming(-8, { duration: 35 }), withTiming(8, { duration: 70 }), withTiming(0, { duration: 35 })), -1);
    } else {
      cancelAnimation(tilt);
      tilt.value = withTiming(0, { duration: 80 });
    }
  }, [rolling, tilt]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${tilt.value}deg` }] }));
  return (
    <Animated.View style={[styles.die, style]} accessibilityLiveRegion="polite">
      <Text style={[styles.px, { color: WHITE, fontSize: 24 }]}>{face ?? '?'}</Text>
    </Animated.View>
  );
}

function LineFloat({ text }: { text: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) });
  }, [p]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value < 0.15 ? p.value / 0.15 : 1 - (p.value - 0.15) / 0.85,
    transform: [{ translateY: 10 - 46 * p.value }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.floatWrap, style]}>
      <Text style={[styles.px, styles.floatText]}>{text}</Text>
    </Animated.View>
  );
}

function Stat({ label, value, accent = WHITE }: { label: string; value: string; accent?: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={[styles.px, { color: CYAN, fontSize: 9 }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.px, { color: accent, fontSize: 14, marginTop: 6 }]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function ChestardGame({ wallet, data, snapshotRef, handle }: { wallet: string | null; data: ChestardState | undefined; snapshotRef: SnapshotRef; handle: string | null }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const cell = Math.floor(Math.min((width - 64) / COLS, 48));
  const signedIn = !!wallet;
  const sounds = useSounds();

  const [board, setBoard] = useState<ChestardBoard>(() => (data?.run ? { ...data.run } : emptyBoard()));
  const [stacks, setStacks] = useState<Checker[][]>(() => stacksFrom(data?.run?.heights ?? Array(COLS).fill(0)));
  const [runId, setRunId] = useState<string | null>(data?.run?.id ?? null);
  const [face, setFace] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const [column, setColumn] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(!!data?.run);
  const [float, setFloat] = useState<{ id: number; text: string } | null>(null);
  const [newBest, setNewBest] = useState(false);
  const [guestBest, setGuestBest] = useState(0);
  const busyRef = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    void AsyncStorage.getItem(GUEST_BEST_KEY).then((v) => setGuestBest(Number(v) || 0)).catch(() => undefined);
    return () => { alive.current = false; };
  }, []);

  const best = Math.max(signedIn ? data?.me?.best ?? 0 : guestBest, board.score);
  // The share drawer lives in the screen header; it asks for the board through this.
  snapshotRef.current = snapshotLib
    ? () => snapshotLib.drawChestardSnapshot({
      board,
      best,
      name: handle,
      labels: {
        score: t('games.chestard.score'),
        hi: t('games.chestard.hiScore'),
        lines: t('games.chestard.lines'),
        drops: t('games.chestard.drops'),
        perDrop: t('games.chestard.perDrop'),
        gameOver: t('games.chestard.gameOver'),
      },
    })
    : null;

  const roll = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    let current = board;
    let id = runId;
    try {
      if (current.over) {
        current = emptyBoard();
        id = null;
        setBoard(current);
        setStacks(stacksFrom(Array(COLS).fill(0)));
        setFace(null);
        setColumn(null);
        setNewBest(false);
        setFloat(null);
      }
      if (signedIn && !id) {
        const res = await chestardStart();
        id = res.run.id;
        setRunId(id);
      }
      setStarted(true);
      sounds.play('roll');
      setRolling(true);
      const tumble = setInterval(() => setFace(1 + Math.floor(Math.random() * 6)), 70);
      const began = Date.now();
      let result;
      try {
        result = signedIn ? (await chestardRoll(id!)).roll : { ...drop(current, 1 + Math.floor(Math.random() * 6)), newBest: false };
      } finally {
        await sleep(Math.max(0, TUMBLE_MS - (Date.now() - began)));
        clearInterval(tumble);
        if (alive.current) setRolling(false);
      }
      if (!alive.current) return;
      setFace(result.die);
      setColumn(result.column);

      const fall = fallMs(ROWS - result.landedRow);
      const checker: Checker = { id: nextId++, row: result.landedRow, state: 'enter', fall };
      setStacks((s) => s.map((stack, i) => (i === result.column ? [...stack, checker] : stack)));
      await sleep(fall);
      if (!alive.current) return;
      sounds.play('drop');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      setStacks((s) => s.map((stack) => stack.map((c) => (c.id === checker.id ? { ...c, state: 'idle' } : c))));
      setBoard((b) => ({ ...b, drops: result.drops, score: result.score - result.bonus }));

      if (result.cleared) {
        sounds.play('clear');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        setFloat({ id: nextId++, text: t('games.chestard.lineBonus', { bonus: formatCount(result.bonus) }) });
        setStacks((s) => s.map((stack) => stack.map((c) => (c.row === 0 ? { ...c, state: 'clear' } : c))));
        await sleep(CLEAR_MS);
        if (!alive.current) return;
        setStacks((s) => s.map((stack) => stack.filter((c) => c.row > 0).map((c) => ({ ...c, row: c.row - 1, state: 'idle' }))));
        await sleep(SHIFT_MS);
        if (!alive.current) return;
      }
      const next: ChestardBoard = { heights: result.heights, score: result.score, lines: result.lines, drops: result.drops, over: result.over };
      setBoard(next);

      if (next.over) {
        const beat = signedIn ? result.newBest : next.score > guestBest;
        setNewBest(beat);
        sounds.play(beat ? 'best' : 'over');
        void Haptics.notificationAsync(beat ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        if (!signedIn && beat) {
          setGuestBest(next.score);
          void AsyncStorage.setItem(GUEST_BEST_KEY, String(next.score)).catch(() => undefined);
        }
        setRunId(null);
        if (signedIn) void queryClient.invalidateQueries({ queryKey: ['chestard'] });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toastError(message || t('games.chestard.rollFailed'));
      if (/over|not found/i.test(message)) {
        setRunId(null);
        setBoard((b) => ({ ...b, over: true }));
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }, [board, runId, signedIn, sounds, t, guestBest, queryClient]);

  const boards: { key: string; title: string; description: string | null; rows: ChestardState['leaderboard'] }[] = [{
    key: 'all-time',
    title: t('games.chestard.boardTitle'),
    description: null,
    rows: data?.leaderboard ?? [],
  }];
  if (data?.daily) {
    boards.unshift({
      key: 'daily',
      title: t('games.chestard.dailyTitle', { defaultValue: 'Daily challenge' }),
      description: t('games.chestard.dailyRules', { defaultValue: 'Sign in to compete. Your best score from runs started today counts. Resets at midnight UTC.' }),
      rows: data.daily.leaderboard,
    });
  }
  const rollLabel = board.over ? t('games.chestard.playAgain') : started ? t('games.chestard.roll') : t('games.chestard.start');

  return (
    <View>
      <View style={styles.crt}>
        <View style={styles.statsRow}>
          <Stat label={t('games.chestard.score')} value={scoreText(board.score)} />
          <Stat label={t('games.chestard.lines')} value={String(board.lines).padStart(2, '0')} />
          <Stat label={t('games.chestard.perDrop')} value={`X${perDrop(board.lines)}`} accent={MAGENTA} />
        </View>

        <View style={{ alignItems: 'center', marginTop: 16 }}>
          <View>
            <Board stacks={stacks} column={column} cell={cell} />
            {float ? <LineFloat key={float.id} text={float.text} /> : null}
            {board.over ? (
              <View style={[styles.overlay, { width: cell * COLS + 6, height: cell * ROWS + 6 }]}>
                <Text style={[styles.px, { color: MAGENTA, fontSize: 16 }]}>{t('games.chestard.gameOver')}</Text>
                <Text style={[styles.px, { color: WHITE, fontSize: 14, marginTop: 12 }]}>{scoreText(board.score)}</Text>
                {newBest ? <Text style={[styles.px, { color: CYAN, fontSize: 10, marginTop: 12 }]}>{t('games.chestard.newBest')}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.dieRow}>
          <Die face={face} rolling={rolling} />
          <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
            <Text style={[styles.px, { color: CYAN, fontSize: 10 }]}>
              {t('games.chestard.column')} <Text style={{ color: MAGENTA, fontSize: 14, fontFamily: PIXEL }}>{column != null ? column + 1 : '?'}</Text>
            </Text>
            <Text style={[styles.px, { color: WHITE, fontSize: 10 }]}>{t('games.chestard.drops')} {String(board.drops).padStart(3, '0')}</Text>
            <Text style={[styles.px, { color: WHITE, fontSize: 10 }]}>{t('games.chestard.hi')} {scoreText(best)}</Text>
          </View>
          <Pressable
            onPress={sounds.toggle}
            accessibilityRole="button"
            accessibilityLabel={sounds.muted ? t('games.chestard.soundOn') : t('games.chestard.soundOff')}
            hitSlop={8}
          >
            <View style={styles.mute}>
              <Icon name={(sounds.muted ? 'VolumeX' : 'Volume2') as never} size={18} color={CYAN} />
            </View>
          </Pressable>
        </View>

        <Pressable onPress={() => void roll()} disabled={busy} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 14, opacity: busy ? 0.75 : pressed ? 0.9 : 1 })}>
          <View style={styles.rollButton}>
            <Text style={[styles.px, { color: 'hsla(0, 0%, 0%, 1)', fontSize: 14 }]}>{rollLabel}</Text>
          </View>
        </Pressable>
      </View>

      {!signedIn ? (
        <PageSection>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={styles.note}>{t('games.chestard.signInNote')}</Text>
            <KitButton label={t('games.signIn')} onPress={() => navigation.navigate(ScreenNames.SignIn)} />
          </View>
        </PageSection>
      ) : null}

      {boards.map(({ key, title, description, rows }) => (
        <PageSection key={key} title={title}>
          {description ? <Text style={styles.how}>{description}</Text> : null}
          {rows.length ? (
            <View style={{ gap: 6 }}>
              {rows.map((row) => (
                <View key={row.player.address} style={[styles.boardRow, row.player.address === wallet && styles.boardMine]}>
                  <Text style={styles.rank}>{row.rank}</Text>
                  <Avatar uri={row.player.avatarImageUrl} size={28} name={nameOf(row.player).replace('@', '')} />
                  <Text style={styles.boardName} numberOfLines={1}>{nameOf(row.player)}</Text>
                  <Text style={styles.boardLines}>{t('games.chestard.linesShort', { count: row.lines })}</Text>
                  <Text style={styles.boardScore}>{formatCount(row.best)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.note}>{t('games.chestard.boardEmpty')}</Text>
          )}
        </PageSection>
      ))}

      <PageSection title={t('games.chestard.howTitle')}>
        <Text style={styles.how}>{t('games.chestard.how')}</Text>
      </PageSection>
    </View>
  );
}

const ChestardScreen = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const wallet = (user?.walletAddress || user?.address)?.toLowerCase() ?? null;
  const [fontsLoaded] = useFonts({ [PIXEL]: require('../assets/fonts/PressStart2P-Regular.ttf') });
  const [shareOpen, setShareOpen] = useState(false);
  const snapshotRef: SnapshotRef = useRef(null);
  const handle = user?.username ? `@${String(user.username).replace(/^@+/, '')}` : null;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['chestard', wallet],
    queryFn: () => chestardState(!!wallet),
    staleTime: 15_000,
  });
  const dailyEndsAt = data?.daily?.endsAt;
  useEffect(() => {
    if (!dailyEndsAt) return;
    const timer = setTimeout(() => void refetch(), Math.max(0, Date.parse(dailyEndsAt) - Date.now() + 1000));
    return () => clearTimeout(timer);
  }, [dailyEndsAt, refetch]);

  return (
    <View className="bg-theme-background" style={{ flex: 1 }}>
      <ScreenHeader
        title={t('games.chestard.title')}
        icon="arcade"
        rightContent={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('games.share')}
            hitSlop={8}
            onPress={() => setShareOpen(true)}
          >
            <Icon name="Share2" size={18} color={SOFT} />
          </Pressable>
        )}
      />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 32 }}>
        <Text style={styles.intro}>{t('games.chestard.intro')}</Text>
        {(isLoading && wallet) || !fontsLoaded ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={SOFT} />
        ) : (
          <ChestardGame key={wallet ?? 'guest'} wallet={wallet} data={data} snapshotRef={snapshotRef} handle={handle} />
        )}
      </ScrollView>
      <ArcadeShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        slug="chestard"
        title={t('games.chestard.title')}
        snapshot={snapshotLib ? () => snapshotRef.current?.() ?? Promise.resolve(null) : undefined}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  px: { fontFamily: PIXEL },
  intro: { color: SOFT, fontSize: 12, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 12 },
  crt: { marginHorizontal: 16, marginBottom: 12, padding: 16, borderRadius: 18, backgroundColor: SCREEN, borderWidth: 1, borderColor: CYAN_FAINT },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  board: { borderWidth: 3, borderColor: CYAN, backgroundColor: 'hsla(0, 0%, 0%, 1)' },
  dot: { position: 'absolute', width: 3, height: 3, backgroundColor: CYAN },
  checker: { flex: 1, backgroundColor: 'hsla(0, 0%, 100%, 1)', padding: 2 },
  checkerCore: { flex: 1, backgroundColor: MAGENTA, borderWidth: 2, borderColor: MAGENTA_DEEP },
  checkerShine: { position: 'absolute', backgroundColor: 'hsla(0, 0%, 100%, 1)' },
  overlay: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsla(0, 0%, 0%, 0.75)' },
  floatWrap: { position: 'absolute', left: 0, right: 0, top: '30%', alignItems: 'center' },
  floatText: { color: MAGENTA, fontSize: 14, textShadowColor: 'hsla(300, 100%, 67%, 0.5)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } },
  dieRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  die: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: MAGENTA, borderWidth: 4, borderColor: WHITE },
  mute: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: CYAN_FAINT },
  rollButton: { height: 50, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: CYAN },
  note: { flex: 1, color: SOFT, fontSize: 13, lineHeight: 19 },
  how: { color: SOFT, fontSize: 13, lineHeight: 20 },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10 },
  boardMine: { backgroundColor: 'hsla(300, 100%, 67%, 0.1)', borderWidth: 1, borderColor: 'hsla(300, 100%, 67%, 0.4)' },
  rank: { width: 20, textAlign: 'center', color: MUTED, fontSize: 12, fontWeight: '700' },
  boardName: { flex: 1, minWidth: 0, color: WHITE, fontSize: 14 },
  boardLines: { color: MUTED, fontSize: 12 },
  boardScore: { width: 48, textAlign: 'right', color: MAGENTA, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

export default ChestardScreen;
