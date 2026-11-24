/**
 * SillyCoinScreen
 * ===============
 * Native twin of riftn-web /arcade/sillycoin: a tap-to-mine idle game. Tap
 * the coin, buy a bigger pick and auto-miners, send coins to friends, climb
 * the top 10.
 *
 * SillyCoins are just for fun and have no value: not a token, never connected
 * to a wallet. The server keeps the count (riftn-backend
 * src/games/sillycoin.service.ts). Taps are batched and synced every few
 * seconds; the server accepts at most 15 a second and pays auto-miners for at
 * most 8 hours away, so this screen counts the same way.
 *
 * Signed out, the coin still taps (nothing is saved) and the screen asks to
 * sign in to keep the coins and send them.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, LinearGradient, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import Icon from '../components/ui/Icon';
import Avatar from '../components/common/Avatar';
import ScreenHeader from '../components/ScreenHeader';
import { KitButton, PageSection } from '../components/page/PageKit';
import { ScreenNames } from '../navigation/ScreenNames';
import { useAuth } from '../context/AuthContext';
import { toastError, toastSuccess } from '../libs/toast';
import ArcadeShareSheet from '../components/games/ArcadeShareSheet';
import { formatCount } from '../libs/format-count';
import {
  SILLY_UPGRADES, sillyMine, sillySend, sillyState, sillyUpgrade,
  type GamePlayer, type SillyMe, type SillyState, type SillyUpgrade, type SillyUpgradeKind,
} from '../services/games.service';

const MAX_TAPS_PER_SECOND = 15;
const SYNC_MS = 3000;
const NOTE_MAX = 80;
const COIN = 200;

const WHITE = 'hsla(0, 0%, 100%, 1)';
const MUTED = 'hsla(240, 4%, 46%, 1)';
const SOFT = 'hsla(240, 5%, 65%, 1)';
const GOLD = 'hsla(43, 96%, 56%, 1)';
const GOLD_SOFT = 'hsla(45, 97%, 75%, 1)';
const INK = 'hsla(240, 6%, 5%, 1)';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const short = (n: number) => formatCount(Math.floor(n));
const nameOf = (p: GamePlayer | null | undefined) =>
  !p ? '' : p.username ? `@${p.username}` : p.displayName || `${p.address.slice(0, 6)}…`;
const UPGRADE_ICONS: Record<SillyUpgradeKind, string> = { pick: 'Hammer', miner: 'Bot', rig: 'Zap' };

function CoinArt() {
  return (
    <Svg width={COIN} height={COIN} viewBox="0 0 200 200">
      <Defs>
        <RadialGradient id="face" cx="38%" cy="32%" r="75%">
          <Stop offset="0%" stopColor="#FFF3B0" />
          <Stop offset="45%" stopColor="#FBBF24" />
          <Stop offset="100%" stopColor="#D97706" />
        </RadialGradient>
        <LinearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#F59E0B" />
          <Stop offset="100%" stopColor="#92400E" />
        </LinearGradient>
      </Defs>
      <Circle cx="100" cy="100" r="96" fill="url(#rim)" />
      <Circle cx="100" cy="100" r="84" fill="url(#face)" />
      <Circle cx="100" cy="100" r="68" fill="none" stroke="#B45309" strokeOpacity={0.55} strokeWidth={3} />
      <SvgText x="102" y="134" textAnchor="middle" fontSize="92" fontWeight="900" fill="#92400E" fillOpacity={0.55}>S</SvgText>
      <SvgText x="99" y="130" textAnchor="middle" fontSize="92" fontWeight="900" fill="#FFF7D6">S</SvgText>
      <Ellipse cx="72" cy="52" rx="26" ry="11" fill="hsla(0, 0%, 100%, 1)" fillOpacity={0.35} transform="rotate(-28 72 52)" />
    </Svg>
  );
}

interface Floater { id: number; x: number; y: number; n: number }

function FloatingGain({ f, onDone }: { f: Floater; onDone: (id: number) => void }) {
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(onDone)(f.id);
    });
  }, [f.id, lift, onDone]);
  const style = useAnimatedStyle(() => ({
    opacity: lift.value < 0.15 ? lift.value / 0.15 : 1 - (lift.value - 0.15) / 0.85,
    transform: [{ translateY: -70 * lift.value }, { scale: 0.85 + 0.3 * lift.value }],
  }));
  return (
    <Animated.Text pointerEvents="none" style={[styles.floater, { left: f.x - 24, top: f.y - 16 }, style]}>
      +{short(f.n)}
    </Animated.Text>
  );
}

function UpgradeRow({ u, affordable, busy, signedIn, onBuy }: { u: SillyUpgrade; affordable: boolean; busy: boolean; signedIn: boolean; onBuy: () => void }) {
  const { t } = useTranslation();
  const disabled = u.maxed || busy || (signedIn && !affordable);
  return (
    <View style={styles.upgradeRow}>
      <View style={styles.upgradeIcon}><Icon name={UPGRADE_ICONS[u.kind] as never} size={18} color={GOLD} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.upgradeName} numberOfLines={1}>
          {t(`games.sillycoin.upgrade.${u.kind}`)}
          <Text style={styles.upgradeLevel}>{'  '}{t('games.sillycoin.level', { level: u.level })}</Text>
        </Text>
        <Text style={styles.upgradeEffect} numberOfLines={1}>
          {u.perTap
            ? t('games.sillycoin.effectTap', { n: short(u.perTap) })
            : t('games.sillycoin.effectSecond', { n: short(u.perSecond) })}
        </Text>
      </View>
      <Pressable onPress={onBuy} disabled={disabled} accessibilityRole="button" style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.85 : 1 })}>
        <View style={styles.buyButton}>
          {busy ? <ActivityIndicator size="small" color={INK} /> : null}
          <Text style={styles.buyLabel}>{u.maxed ? t('games.sillycoin.maxed') : short(u.cost ?? 0)}</Text>
        </View>
      </Pressable>
    </View>
  );
}

function SillyGame({ wallet, data }: { wallet: string | null; data: SillyState | undefined }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const signedIn = !!wallet;

  const [base, setBase] = useState<{ me: SillyMe; at: number } | null>(null);
  const pending = useRef(0);
  const inflight = useRef(0);
  const [pendingShown, setPendingShown] = useState(0);
  const tapTimes = useRef<number[]>([]);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const floaterId = useRef(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [demoCoins, setDemoCoins] = useState(0);
  const awayShown = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const scale = useSharedValue(1);
  const coinStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    if (!data?.me) return;
    setBase({ me: data.me, at: Date.now() });
    if (!awayShown.current && data.me.awayEarned > 0) {
      awayShown.current = true;
      const hours = Math.max(1, Math.round(data.me.awaySeconds / 3600));
      toastSuccess(t('games.sillycoin.awayToast', { coins: short(data.me.awayEarned), hours }));
    }
  }, [data?.me, t]);

  const me = base?.me ?? null;
  useEffect(() => {
    if (!me || me.perSecond <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [me]);
  const live = me
    ? me.balance + (me.perSecond * Math.max(0, now - (base?.at ?? now))) / 1000 + pendingShown * me.perTap
    : demoCoins;

  const apply = useCallback((next: SillyMe) => setBase({ me: next, at: Date.now() }), []);
  const takeTaps = useCallback(() => {
    const taps = pending.current;
    pending.current = 0;
    inflight.current = taps;
    return taps;
  }, []);
  const doneTaps = useCallback((taps: number, ok: boolean) => {
    inflight.current = 0;
    if (!ok) pending.current += taps;
    setPendingShown(pending.current);
  }, []);

  const flush = useCallback(async () => {
    if (!signedIn || pending.current <= 0 || inflight.current > 0) return;
    const taps = takeTaps();
    try {
      const res = await sillyMine(taps);
      apply(res.me);
      doneTaps(taps, true);
    } catch {
      doneTaps(taps, false);
    }
  }, [signedIn, apply, takeTaps, doneTaps]);

  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(() => void flush(), SYNC_MS);
    const sub = AppState.addEventListener('change', (state) => { if (state !== 'active') void flush(); });
    return () => {
      clearInterval(timer);
      sub.remove();
      void flush();
    };
  }, [signedIn, flush]);

  const removeFloater = useCallback((id: number) => setFloaters((list) => list.filter((f) => f.id !== id)), []);

  const tap = (event: GestureResponderEvent) => {
    const at = Date.now();
    tapTimes.current = tapTimes.current.filter((x) => at - x < 1000);
    const counted = tapTimes.current.length < MAX_TAPS_PER_SECOND;
    scale.value = withSequence(withTiming(0.9, { duration: 60 }), withSpring(1, { damping: 8, stiffness: 400 }));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (!counted) return;
    tapTimes.current.push(at);
    if (signedIn) {
      pending.current += 1;
      setPendingShown(pending.current + inflight.current);
    } else {
      setDemoCoins((c) => c + 1);
    }
    const id = ++floaterId.current;
    const { locationX, locationY } = event.nativeEvent;
    setFloaters((list) => [...list.slice(-12), { id, x: locationX || COIN / 2, y: locationY || COIN / 3, n: me?.perTap ?? 1 }]);
  };

  const signIn = () => navigation.navigate(ScreenNames.SignIn);

  const buy = async (kind: SillyUpgradeKind) => {
    if (!signedIn) return signIn();
    if (inflight.current > 0) return;
    setBusy(kind);
    const taps = takeTaps();
    try {
      const res = await sillyUpgrade(kind, taps);
      apply(res.me);
      doneTaps(taps, true);
      toastSuccess(t(`games.sillycoin.bought.${kind}`));
    } catch (e) {
      doneTaps(taps, false);
      toastError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const send = async () => {
    if (!signedIn) return signIn();
    const n = Math.floor(Number(amount));
    if (!to.trim() || !Number.isFinite(n) || n < 1) {
      toastError(t('games.sillycoin.sendMissing'));
      return;
    }
    if (inflight.current > 0) return;
    setBusy('send');
    const taps = takeTaps();
    try {
      const res = await sillySend({ to: to.trim(), amount: n, note: note.trim() || undefined, taps });
      apply(res.me);
      doneTaps(taps, true);
      toastSuccess(t('games.sillycoin.sent', { coins: short(n), name: nameOf(res.transfer.other) }));
      setAmount('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['sillycoin'] });
    } catch (e) {
      doneTaps(taps, false);
      toastError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const upgrades: SillyUpgrade[] = me?.upgrades ?? (Object.keys(SILLY_UPGRADES) as SillyUpgradeKind[]).map((kind) => ({
    kind, level: 0, cost: SILLY_UPGRADES[kind].base, maxed: false, perTap: SILLY_UPGRADES[kind].perTap, perSecond: SILLY_UPGRADES[kind].perSecond,
  }));
  const transfers = data?.transfers ?? [];
  const board = data?.leaderboard ?? [];

  return (
    <View>
      <PageSection>
        <View style={styles.hero}>
          <Text style={styles.balanceLabel}>{t('games.sillycoin.balanceLabel')}</Text>
          <Text style={styles.balance} accessibilityLiveRegion="polite">{short(live)}</Text>
          <Text style={styles.rates}>
            {t('games.sillycoin.rates', { tap: short(me?.perTap ?? 1), second: short(me?.perSecond ?? 0) })}
          </Text>
          <Pressable
            onPressIn={tap}
            accessibilityRole="button"
            accessibilityLabel={t('games.sillycoin.tapLabel')}
            style={styles.coinWrap}
          >
            <Animated.View style={coinStyle}>
              <CoinArt />
            </Animated.View>
            <View pointerEvents="none" style={styles.pick}>
              <Icon name="Hammer" size={40} color="hsla(240, 5%, 90%, 1)" />
            </View>
            {floaters.map((f) => <FloatingGain key={f.id} f={f} onDone={removeFloater} />)}
          </Pressable>
          <Text style={styles.hint}>{t('games.sillycoin.tapHint')}</Text>
          {!signedIn ? (
            <View style={styles.signInBox}>
              <Text style={styles.signInText}>{t('games.sillycoin.signInPrompt')}</Text>
              <KitButton label={t('games.signIn')} onPress={signIn} />
            </View>
          ) : null}
        </View>
      </PageSection>

      <PageSection title={t('games.sillycoin.upgradesTitle')}>
        <View style={{ gap: 8 }}>
          {upgrades.map((u) => (
            <UpgradeRow
              key={u.kind}
              u={u}
              signedIn={signedIn}
              busy={busy === u.kind}
              affordable={!!me && u.cost !== null && live >= u.cost}
              onBuy={() => void buy(u.kind)}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('games.sillycoin.idleNote')}</Text>
      </PageSection>

      <PageSection title={t('games.sillycoin.sendTitle')}>
        <View style={{ gap: 8 }}>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder={t('games.sillycoin.toPlaceholder')}
            placeholderTextColor={MUTED}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <TextInput
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/[^\d]/g, ''))}
            placeholder={t('games.sillycoin.amountPlaceholder')}
            placeholderTextColor={MUTED}
            keyboardType="number-pad"
            style={styles.input}
          />
          <TextInput
            value={note}
            onChangeText={(v) => setNote(v.slice(0, NOTE_MAX))}
            placeholder={t('games.sillycoin.notePlaceholder')}
            placeholderTextColor={MUTED}
            maxLength={NOTE_MAX}
            style={styles.input}
          />
          <KitButton
            label={t('games.sillycoin.sendButton')}
            disabled={busy === 'send'}
            onPress={() => void send()}
            icon={busy === 'send' ? <ActivityIndicator size="small" color={INK} /> : <Icon name="Send" size={14} color={INK} />}
          />
        </View>
        <Text style={styles.note}>{t('games.sillycoin.sendNote')}</Text>
        {transfers.length ? (
          <View style={{ gap: 6, marginTop: 10 }}>
            {transfers.slice(0, 6).map((tr) => (
              <View key={tr.id} style={styles.transfer}>
                <Icon name={tr.direction === 'in' ? 'ArrowDownLeft' : 'ArrowUpRight'} size={14} color={tr.direction === 'in' ? 'hsla(152, 69%, 52%, 1)' : SOFT} />
                <Text style={styles.transferText} numberOfLines={1}>
                  {tr.direction === 'in'
                    ? t('games.sillycoin.fromLine', { name: nameOf(tr.other) })
                    : t('games.sillycoin.toLine', { name: nameOf(tr.other) })}
                  {tr.note ? <Text style={{ color: MUTED }}>{` · ${tr.note}`}</Text> : null}
                </Text>
                <Text style={[styles.transferAmount, { color: tr.direction === 'in' ? 'hsla(152, 69%, 52%, 1)' : SOFT }]}>
                  {tr.direction === 'in' ? '+' : '−'}{short(tr.amount)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </PageSection>

      <PageSection title={t('games.sillycoin.boardTitle')}>
        {board.length ? (
          <View style={{ gap: 6 }}>
            {board.map((row) => (
              <View key={row.player.address} style={[styles.boardRow, row.player.address === wallet && styles.boardMine]}>
                <Text style={styles.rank}>{row.rank}</Text>
                <Avatar uri={row.player.avatarImageUrl} size={28} name={nameOf(row.player).replace('@', '')} />
                <Text style={styles.boardName} numberOfLines={1}>{nameOf(row.player)}</Text>
                <Text style={styles.boardCoins}>{short(row.totalMined)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.note}>{t('games.sillycoin.boardEmpty')}</Text>
        )}
      </PageSection>
    </View>
  );
}

const SillyCoinScreen = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const wallet = (user?.walletAddress || user?.address)?.toLowerCase() ?? null;
  const { data, isLoading } = useQuery({
    queryKey: ['sillycoin', wallet],
    queryFn: () => sillyState(!!wallet),
    staleTime: 15_000,
  });
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <View className="bg-theme-background" style={{ flex: 1 }}>
      <ScreenHeader
        title={t('games.sillycoin.title')}
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
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('games.sillycoin.intro')}</Text>
        {isLoading && wallet ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={SOFT} />
        ) : (
          <SillyGame key={wallet ?? 'guest'} wallet={wallet} data={data} />
        )}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerText}>{t('games.sillycoin.disclaimer')}</Text>
        </View>
      </ScrollView>
      <ArcadeShareSheet open={shareOpen} onClose={() => setShareOpen(false)} slug="sillycoin" title={t('games.sillycoin.title')} />
    </View>
  );
};

const styles = StyleSheet.create({
  intro: { color: SOFT, fontSize: 12, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 12 },
  hero: { alignItems: 'center', paddingVertical: 6 },
  balanceLabel: { color: GOLD_SOFT, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  balance: { color: WHITE, fontSize: 40, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },
  rates: { color: SOFT, fontSize: 12, marginTop: 2 },
  coinWrap: { width: COIN, height: COIN, marginTop: 16 },
  pick: { position: 'absolute', right: -6, top: -6, transform: [{ rotate: '12deg' }] },
  floater: { position: 'absolute', width: 48, textAlign: 'center', color: GOLD_SOFT, fontSize: 18, fontWeight: '800', textShadowColor: 'hsla(0, 0%, 0%, 0.7)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 2 } },
  hint: { color: MUTED, fontSize: 12, marginTop: 12, textAlign: 'center' },
  signInBox: { marginTop: 14, alignItems: 'center', gap: 10, paddingHorizontal: 8 },
  signInText: { color: SOFT, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  upgradeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9, backgroundColor: 'hsla(0, 0%, 0%, 0.25)' },
  upgradeIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsla(43, 96%, 56%, 0.15)' },
  upgradeName: { color: WHITE, fontSize: 14, fontWeight: '600' },
  upgradeLevel: { color: MUTED, fontSize: 12, fontWeight: '400' },
  upgradeEffect: { color: SOFT, fontSize: 12, marginTop: 1 },
  buyButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: GOLD },
  buyLabel: { color: INK, fontSize: 12, fontWeight: '800' },
  note: { color: MUTED, fontSize: 12, lineHeight: 17, marginTop: 10 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: WHITE, backgroundColor: 'hsla(240, 4%, 16%, 1)' },
  transfer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  transferText: { flex: 1, minWidth: 0, color: 'hsla(240, 5%, 84%, 1)', fontSize: 12 },
  transferAmount: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  boardMine: { backgroundColor: 'hsla(43, 96%, 56%, 0.1)', borderWidth: 1, borderColor: 'hsla(43, 96%, 56%, 0.4)' },
  rank: { width: 20, textAlign: 'center', color: MUTED, fontSize: 12, fontWeight: '700' },
  boardName: { flex: 1, minWidth: 0, color: WHITE, fontSize: 14 },
  boardCoins: { color: GOLD_SOFT, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  disclaimer: { marginHorizontal: 16, marginTop: 14, borderRadius: 12, padding: 12, backgroundColor: 'hsla(43, 96%, 56%, 0.1)', borderWidth: 1, borderColor: 'hsla(43, 96%, 56%, 0.2)' },
  disclaimerText: { color: GOLD_SOFT, fontSize: 12, lineHeight: 18, textAlign: 'center' },
});

export default SillyCoinScreen;
