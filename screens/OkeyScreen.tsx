/**
 * OkeyScreen
 * ==========
 * Native twin of riftn-web /arcade/okey: the room list (who sits where, free
 * seats, locked rooms) and, with `table`, the table itself. Four seats; bots
 * fill the empty ones when the host starts, and anyone joining later takes a
 * bot's seat.
 *
 * The rules live on the server (riftn-backend src/games/okey.engine.ts). This
 * screen keeps only your own rack order and the groups you are building before
 * you lay them down. Nothing here moves money.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../components/ui/Icon';
import Avatar from '../components/common/Avatar';
import ScreenHeader from '../components/ScreenHeader';
import { KitButton, PageEmpty, PageSection } from '../components/page/PageKit';
import OkeyTileNative from '../components/games/OkeyTileNative';
import { ScreenNames } from '../navigation/ScreenNames';
import { useAuth } from '../context/AuthContext';
import { toastError } from '../libs/toast';
import { shareWithRef } from '../libs/shareRef';
import { formatCount } from '../libs/format-count';
import { WEBSITE_LINK } from '../config/links';
import {
  isPairTiles, meldPoints, okeyAct, okeyCreate, okeyGet, okeyJoin, okeyLeave, okeyLobby, okeyNext, okeyOf, okeyStart,
  sortTiles, type OkeyAction, type OkeyLobbyRow, type OkeySeatView, type OkeyTable,
} from '../services/games.service';

const PAGE_URL = `${WEBSITE_LINK}/arcade/okey`;
const OPEN_POINTS = 101;
const OPEN_PAIRS = 5;
const MUTED = 'hsla(240, 4%, 46%, 1)';
const SOFT = 'hsla(240, 5%, 65%, 1)';
const WHITE = 'hsla(0, 0%, 100%, 1)';
const FELT_INK = 'hsla(150, 60%, 90%, 0.8)';
const AMBER = 'hsla(43, 96%, 56%, 1)';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const seatName = (s: OkeySeatView | undefined, empty: string) =>
  !s ? empty : s.bot ? `${s.name ?? 'Bot'}` : s.name || (s.username ? `@${s.username}` : s.address ? `${s.address.slice(0, 6)}…` : empty);

function Btn({ label, onPress, disabled, icon, tone = 'dark', small }: { label: string; onPress: () => void; disabled?: boolean; icon?: string; tone?: 'white' | 'dark' | 'amber' | 'felt'; small?: boolean }) {
  const bg = tone === 'white' ? WHITE : tone === 'amber' ? 'hsla(45, 96%, 64%, 1)' : tone === 'felt' ? 'hsla(0, 0%, 0%, 0.3)' : 'hsla(240, 4%, 16%, 1)';
  const ink = tone === 'white' || tone === 'amber' ? 'hsla(0, 0%, 0%, 1)' : tone === 'felt' ? 'hsla(48, 100%, 96%, 1)' : 'hsla(240, 5%, 90%, 1)';
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.85 : 1 })}>
      <View style={[styles.btn, small && styles.btnSmall, { backgroundColor: bg }]}>
        {icon ? <Icon name={icon as never} size={small ? 12 : 15} color={ink} /> : null}
        <Text style={[styles.btnLabel, small && { fontSize: 11 }, { color: ink }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ seats

function SeatBadge({ seat, active, endsAt, offset, compact }: { seat: OkeySeatView; active: boolean; endsAt: number | null; offset: number; compact?: boolean }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active || !endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active, endsAt]);
  const left = active && endsAt ? Math.max(0, Math.ceil((endsAt - (now + offset)) / 1000)) : null;
  const name = seatName(seat, t('games.okey.emptySeat'));
  return (
    <View style={[styles.seat, active && styles.seatActive]}>
      {seat.bot && !seat.avatarImageUrl ? (
        <View style={styles.botAvatar}><Icon name="Bot" size={14} color="hsla(240, 5%, 84%, 1)" /></View>
      ) : (
        <Avatar uri={seat.avatarImageUrl} size={26} name={name.replace('@', '')} />
      )}
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <Text style={styles.seatName} numberOfLines={1}>
          {name}{seat.bot ? <Text style={styles.seatBot}> {t('games.okey.bot')}</Text> : null}
        </Text>
        <Text style={styles.seatMeta} numberOfLines={1}>
          {compact ? '' : t('games.okey.tilesLeft', { n: seat.tiles })}
          {!compact && seat.opened ? ` · ${seat.opened === 'pairs' ? t('games.okey.openedPairs') : t('games.okey.openedPoints', { p: formatCount(seat.openedPoints) })}` : ''}
          {left !== null ? `${compact ? '' : ' · '}${left}s` : ''}
        </Text>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ table

function TableView({ id, wallet }: { id: string; wallet: string | null }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const requestInFlight = useRef(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [groups, setGroups] = useState<number[][]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [password, setPassword] = useState('');
  const key = useMemo(() => ['okey-table', id, wallet], [id, wallet]);

  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => okeyGet(id, !!wallet),
    refetchInterval: (q) => (q.state.data?.table.status === 'playing' ? 1500 : 4000),
  });
  const table = data?.table;
  const offset = table ? table.serverTime - Date.now() : 0;
  const hand = table?.hand ?? null;
  const round = table?.round ?? null;
  const me = table?.mySeat ?? null;
  const roundNumber = round?.number;

  useEffect(() => {
    setOrder([]);
    setSelected([]);
    setGroups([]);
  }, [me, roundNumber]);

  // Keep your own rack order: tiles that stay keep their place, new ones go on the end.
  useEffect(() => {
    if (!hand) { setOrder([]); return; }
    setOrder((prev) => {
      const kept = prev.filter((tile) => hand.includes(tile));
      const added = hand.filter((tile) => !kept.includes(tile));
      return [...kept, ...added];
    });
    setSelected((prev) => prev.filter((tile) => hand.includes(tile)));
    setGroups((prev) => prev.map((g) => g.filter((tile) => hand.includes(tile))).filter((g) => g.length));
  }, [hand, me, roundNumber]);

  const run = useCallback(async (work: () => Promise<{ table: OkeyTable }>, after?: () => void) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    try {
      const next = await work();
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, next);
      after?.();
    } catch (e) {
      toastError(errorText(e));
      void queryClient.invalidateQueries({ queryKey: key });
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }, [key, queryClient]);
  const act = (action: OkeyAction, after?: () => void) => run(() => okeyAct(id, action), after);

  if (error && !table) return <PageEmpty title={t('games.okey.notFound')} />;
  if (!table) return <ActivityIndicator style={{ marginTop: 80 }} color={SOFT} />;

  const base = me ?? 0;
  const seatAt = (shift: number) => table.seats[(base + shift) % 4];
  const myTurn = !!round && !round.over && me !== null && round.turn === me;
  const mySeat = me !== null ? table.seats[me] : null;
  const leftSeat = seatAt(3);
  const offered = leftSeat?.discards[leftSeat.discards.length - 1] ?? null;
  const staged = new Set(groups.flat());
  const rack = order.filter((tile) => !staged.has(tile));
  const indicator = round?.indicator;
  const okey = indicator !== undefined ? okeyOf(indicator) : null;
  const allPairs = groups.length > 0 && groups.every((g) => g.length === 2);
  const stagedPoints = groups.reduce((sum, g) => sum + (meldPoints(g, indicator ?? 0) ?? 0), 0);
  const stagedValid = groups.length > 0 && groups.every((g) => (allPairs ? isPairTiles(g, indicator ?? 0) : meldPoints(g, indicator ?? 0) !== null));
  const canDiscard = myTurn && round?.phase === 'play' && round.takenDiscard === null && selected.length === 1;
  const canLay = myTurn && round?.phase === 'play' && stagedValid && rack.length > 0
    && (allPairs
      ? mySeat?.opened === 'pairs' || (!mySeat?.opened && groups.length >= OPEN_PAIRS)
      : mySeat?.opened === 'melds' || (!mySeat?.opened && stagedPoints >= OPEN_POINTS));
  const canLayOff = (hand?.length ?? 0) > 1 && myTurn && round?.phase === 'play' && !!mySeat?.opened && selected.length === 1;
  const toggle = (tile: number) => setSelected((prev) => (prev.includes(tile) ? prev.filter((x) => x !== tile) : [...prev, tile]));
  const sortBy = (by: 'runs' | 'sets') => setOrder((prev) => sortTiles(prev, by, indicator));
  const seated = me !== null;
  const turnSeat = round ? table.seats[round.turn] : null;
  const active = (s: OkeySeatView | undefined) => !!s && !!round && !round.over && round.turn === s.seat;
  const myDiscard = mySeat ? mySeat.discards[mySeat.discards.length - 1] ?? null : null;

  let statusLine = '';
  if (table.status === 'waiting') statusLine = t('games.okey.waitingForPlayers');
  else if (round && !round.over) {
    statusLine = myTurn
      ? round.phase === 'draw' ? t('games.okey.yourTurnDraw') : t('games.okey.yourTurnPlay')
      : t('games.okey.waitingFor', { name: seatName(turnSeat ?? undefined, '') });
  }

  return (
    <View style={{ gap: 10, paddingHorizontal: 8 }}>
      {/* top strip */}
      <View style={styles.strip}>
        <View style={styles.tag}>
          {table.locked ? <Icon name="Lock" size={11} color={AMBER} /> : null}
          <Text style={styles.tagText} numberOfLines={1}>{table.name}</Text>
        </View>
        {round ? (
          <View style={styles.tag}>
            <Text style={styles.tagText}>{t('games.okey.roundN', { n: round.number })} · {t('games.okey.pileN', { n: formatCount(round.deckCount) })}</Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <Btn small icon="Share2" label={t('games.okey.invite')} onPress={() => void shareWithRef({ url: `${PAGE_URL}?table=${id}`, message: `${table.name} ${PAGE_URL}?table=${id}` }).catch(() => undefined)} />
        {seated ? (
          <Btn small icon="LogOut" label={t('games.okey.leave')} disabled={busy} onPress={() => void okeyLeave(id).then(() => navigation.goBack()).catch((e) => toastError(errorText(e)))} />
        ) : null}
      </View>

      {/* felt */}
      <LinearGradient colors={['hsla(155, 55%, 27%, 1)', 'hsla(155, 59%, 18%, 1)', 'hsla(155, 61%, 13%, 1)']} style={styles.felt}>
        <View style={styles.feltTop}>
          <View style={{ flex: 1 }} />
          {seatAt(2) ? <SeatBadge seat={seatAt(2)} active={active(seatAt(2))} endsAt={round?.turnEndsAt ?? null} offset={offset} /> : null}
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            {round && indicator !== undefined && okey ? (
              <View style={styles.indicator}>
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <OkeyTileNative tile={indicator} size="xs" />
                  <Text style={styles.feltSmall}>{t('games.okey.indicator')}</Text>
                </View>
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <OkeyTileNative tile={okey.c * 26 + okey.n - 1} indicator={indicator} size="xs" />
                  <Text style={styles.feltSmall}>{t('games.okey.okeyLabel')}</Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.feltSides}>
          {leftSeat ? <SeatBadge seat={leftSeat} active={active(leftSeat)} endsAt={round?.turnEndsAt ?? null} offset={offset} compact /> : <View />}
          {seatAt(1) ? <SeatBadge seat={seatAt(1)} active={active(seatAt(1))} endsAt={round?.turnEndsAt ?? null} offset={offset} compact /> : <View />}
        </View>

        {/* table melds */}
        {round ? (
          <View style={styles.melds}>
            {round.melds.map((m) => {
              const glow = canLayOff && m.kind !== 'pair';
              return (
                <Pressable
                  key={m.id}
                  disabled={!glow}
                  onPress={() => void act({ type: 'layoff', tile: selected[0], meld: m.id }, () => setSelected([]))}
                  accessibilityLabel={t('games.okey.addHere')}
                >
                  <View style={[styles.meld, glow && styles.meldGlow]}>
                    {m.tiles.map((tile) => <OkeyTileNative key={tile} tile={tile} indicator={indicator} size="xs" />)}
                  </View>
                </Pressable>
              );
            })}
            {!round.melds.length ? <Text style={[styles.feltSmall, { width: '100%', textAlign: 'center', paddingVertical: 10, fontSize: 12 }]}>{t('games.okey.noMelds')}</Text> : null}
          </View>
        ) : null}

        {/* pile, discards */}
        {round && !round.over ? (
          <View style={styles.pileRow}>
            <View style={styles.pileCol}>
              <Pressable
                disabled={!myTurn || round.phase !== 'draw' || offered === null || busy}
                onPress={() => void act({ type: 'draw', from: 'discard' })}
                accessibilityLabel={t('games.okey.takeDiscard')}
              >
                <OkeyTileNative tile={offered} indicator={indicator} size="sm" />
              </Pressable>
              <Text style={styles.feltSmall}>{t('games.okey.theirDiscard')}</Text>
            </View>
            <View style={styles.pileCol}>
              <Pressable
                disabled={!myTurn || round.phase !== 'draw' || busy}
                onPress={() => void act({ type: 'draw', from: 'deck' })}
                accessibilityLabel={t('games.okey.drawPile')}
              >
                <View style={[styles.pile, myTurn && round.phase === 'draw' && styles.pileHot]}>
                  <Text style={styles.pileText}>{formatCount(round.deckCount)}</Text>
                </View>
              </Pressable>
              <Text style={styles.feltSmall}>{t('games.okey.pile')}</Text>
            </View>
            {mySeat ? (
              <View style={styles.pileCol}>
                <Pressable
                  disabled={!canDiscard || busy}
                  onPress={() => void act({ type: 'discard', tile: selected[0] }, () => setSelected([]))}
                  accessibilityLabel={t('games.okey.discard')}
                >
                  <View style={[styles.throwSlot, canDiscard && styles.pileHot]}>
                    <OkeyTileNative tile={myDiscard} indicator={indicator} size="sm" />
                  </View>
                </Pressable>
                <Text style={styles.feltSmall}>{t('games.okey.yourDiscard')}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {statusLine ? <Text style={styles.statusLine}>{statusLine}</Text> : null}
      </LinearGradient>

      {/* waiting room */}
      {table.status === 'waiting' ? (
        <View style={styles.panel}>
          <Text style={styles.panelMuted}>{t('games.okey.seatsTaken', { n: table.seats.filter((s) => s.address).length })}</Text>
          {table.youHost ? (
            <Btn tone="white" icon="Play" label={t('games.okey.start')} disabled={busy} onPress={() => void run(() => okeyStart(id))} />
          ) : seated ? (
            <Text style={styles.panelMuted}>{t('games.okey.hostStarts')}</Text>
          ) : null}
        </View>
      ) : null}

      {/* sit down */}
      {!seated && table.status !== 'closed' && table.seats.some((s) => !s.address) ? (
        <View style={styles.panel}>
          {table.locked ? (
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t('games.okey.password')}
              placeholderTextColor={MUTED}
              secureTextEntry
              style={styles.input}
            />
          ) : null}
          <Btn
            tone="white"
            icon="Users"
            label={table.status === 'playing' ? t('games.okey.takeBotSeat') : t('games.okey.sitDown')}
            disabled={busy}
            onPress={() => (wallet ? void run(() => okeyJoin(id, { password })) : navigation.navigate(ScreenNames.SignIn))}
          />
        </View>
      ) : null}

      {/* staged groups */}
      {seated && round && !round.over && groups.length ? (
        <View style={styles.panel}>
          <View style={styles.melds}>
            {groups.map((g, i) => (
              <Pressable key={i} onPress={() => setGroups((prev) => prev.filter((_, j) => j !== i))} accessibilityLabel={t('games.okey.removeGroup')}>
                <View style={[styles.meld, { borderWidth: 1, borderColor: 'hsla(0, 0%, 100%, 0.1)' }]}>
                  {g.map((tile) => <OkeyTileNative key={tile} tile={tile} indicator={indicator} size="xs" />)}
                  <Text style={[styles.panelMuted, { paddingHorizontal: 3 }]}>
                    {g.length === 2 ? (isPairTiles(g, indicator ?? 0) ? '✓' : '✕') : meldPoints(g, indicator ?? 0) ?? '✕'}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
          <View style={styles.stagedFoot}>
            <Text style={[styles.panelMuted, { flex: 1 }]}>
              {allPairs
                ? t('games.okey.pairsCount', { n: groups.length })
                : mySeat?.opened
                  ? t('games.okey.stagedPoints', { p: formatCount(stagedPoints) })
                  : t('games.okey.stagedToOpen', { p: formatCount(stagedPoints) })}
            </Text>
            <Btn
              tone="white"
              small
              icon="Layers"
              label={mySeat?.opened ? t('games.okey.lay') : t('games.okey.open')}
              disabled={!canLay || busy}
              onPress={() => void act({ type: 'lay', groups }, () => setGroups([]))}
            />
          </View>
        </View>
      ) : null}

      {/* rack */}
      {seated && round && !round.over ? (
        <LinearGradient colors={['hsla(29, 52%, 36%, 1)', 'hsla(29, 57%, 27%, 1)']} style={styles.rack}>
          <View style={styles.rackTiles}>
            {rack.map((tile) => (
              <OkeyTileNative key={tile} tile={tile} indicator={indicator} selected={selected.includes(tile)} onPress={() => toggle(tile)} />
            ))}
          </View>
          <View style={styles.rackButtons}>
            <Btn tone="felt" small label={t('games.okey.sortRuns')} onPress={() => sortBy('runs')} />
            <Btn tone="felt" small label={t('games.okey.sortSets')} onPress={() => sortBy('sets')} />
            <Btn tone="amber" small icon="Plus" label={t('games.okey.makeGroup')} disabled={selected.length < 2} onPress={() => { setGroups((prev) => [...prev, selected]); setSelected([]); }} />
            {myTurn && round.takenDiscard !== null ? (
              <Btn tone="felt" small label={t('games.okey.putBack')} disabled={busy} onPress={() => void act({ type: 'putback' })} />
            ) : null}
          </View>
          {canLayOff ? <Text style={styles.rackHint}>{t('games.okey.tapToAdd')}</Text> : null}
        </LinearGradient>
      ) : null}

      {/* round over */}
      {round?.over ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>
            {round.winner !== null ? t('games.okey.roundWon', { name: seatName(table.seats[round.winner], '') }) : t('games.okey.roundEmpty')}
          </Text>
          {table.seats.map((s, i) => {
            const score = round.scores?.[i] ?? 0;
            return (
              <View key={i} style={styles.scoreRow}>
                <Text style={[styles.panelText, { flex: 1 }]} numberOfLines={1}>{seatName(s, '')}</Text>
                <Text style={[styles.panelText, { fontFamily: 'monospace' }]}>
                  {score > 0 ? '+' : ''}{score} · {t('games.okey.totalShort')} {s.total + score}
                </Text>
              </View>
            );
          })}
          <Text style={[styles.panelMuted, { fontSize: 11 }]}>{t('games.okey.scoreHelp')}</Text>
          {seated ? <Btn tone="white" label={t('games.okey.nextRound')} disabled={busy} onPress={() => void run(() => okeyNext(id))} /> : null}
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ lobby

function LobbyRow({ row, onOpen }: { row: OkeyLobbyRow; onOpen: (row: OkeyLobbyRow) => void }) {
  const { t } = useTranslation();
  const pillBg = row.mine ? 'hsla(240, 5%, 26%, 1)' : row.openSeats ? 'hsla(161, 94%, 30%, 1)' : 'hsla(240, 4%, 16%, 1)';
  return (
    <Pressable onPress={() => onOpen(row)} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <View style={styles.lobbyRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {row.locked ? <Icon name="Lock" size={12} color={AMBER} /> : null}
            <Text className="text-theme-neutrals-100" style={styles.rowTitle} numberOfLines={1}>{row.name}</Text>
          </View>
          <Text style={styles.rowSub} numberOfLines={1}>
            {row.status === 'waiting' ? t('games.okey.rowWaiting') : t('games.okey.rowPlaying', { n: row.round })}
            {' · '}{t('games.okey.rowPeople', { n: row.players })}
          </Text>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {row.seats.map((s, i) => (
            <View key={s.seat} style={[styles.miniSeat, i > 0 && { marginLeft: -6 }, s.empty && styles.miniSeatEmpty]}>
              {s.avatarImageUrl ? (
                <Avatar uri={s.avatarImageUrl} size={24} radius={12} />
              ) : s.bot ? (
                <Icon name="Bot" size={12} color="hsla(240, 5%, 84%, 1)" />
              ) : s.empty ? null : (
                <Text style={{ color: WHITE, fontSize: 10 }}>{(s.name ?? '?').charAt(0).toUpperCase()}</Text>
              )}
            </View>
          ))}
        </View>
        <View style={[styles.pill, { backgroundColor: pillBg }]}>
          <Text style={[styles.pillText, { color: row.openSeats || row.mine ? WHITE : SOFT }]}>
            {row.mine ? t('games.okey.rejoin') : row.openSeats ? t('games.okey.join') : t('games.okey.watch')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function Lobby({ wallet, onOpen }: { wallet: string | null; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const requestInFlight = useRef(false);
  const { data, isLoading } = useQuery({ queryKey: ['okey-lobby', wallet], queryFn: () => okeyLobby(!!wallet), refetchInterval: 5000 });

  const create = async (withBots: boolean) => {
    if (!wallet) { navigation.navigate(ScreenNames.SignIn); return; }
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true);
    try {
      const { table } = await okeyCreate(withBots ? { withBots: true } : { name: name.trim() || undefined, password: password.trim() || undefined });
      onOpen(table.id);
    } catch (e) {
      toastError(errorText(e));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };

  const tables = data?.tables ?? [];
  return (
    <View>
      <Pressable disabled={busy} onPress={() => void create(true)} accessibilityRole="button" style={({ pressed }) => ({ opacity: busy ? 0.6 : pressed ? 0.9 : 1, marginHorizontal: 8, marginBottom: 10 })}>
        <LinearGradient colors={['hsla(155, 55%, 27%, 1)', 'hsla(155, 61%, 13%, 1)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.quick}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="Bot" size={16} color={WHITE} />
            <Text style={styles.quickTitle}>{t('games.okey.quickPlay')}</Text>
          </View>
          <Text style={styles.quickSub}>{t('games.okey.quickPlayHint')}</Text>
        </LinearGradient>
      </Pressable>

      <PageSection title={t('games.okey.newTable')}>
        <View style={{ gap: 8 }}>
          <TextInput value={name} onChangeText={setName} maxLength={40} placeholder={t('games.okey.tableName')} placeholderTextColor={MUTED} style={styles.input} />
          <TextInput value={password} onChangeText={setPassword} maxLength={40} secureTextEntry placeholder={t('games.okey.lockPassword')} placeholderTextColor={MUTED} style={styles.input} />
          <KitButton disabled={busy} onPress={() => void create(false)} label={password.trim() ? t('games.okey.openLocked') : t('games.okey.openTable')} />
        </View>
      </PageSection>

      <PageSection title={t('games.okey.rooms')}>
        {isLoading ? <ActivityIndicator color={SOFT} /> : null}
        <View style={{ gap: 8 }}>
          {tables.map((row) => <LobbyRow key={row.id} row={row} onOpen={(r) => onOpen(r.id)} />)}
        </View>
        {!isLoading && !tables.length ? <Text style={[styles.rowSub, { textAlign: 'center', paddingVertical: 8 }]}>{t('games.okey.noRooms')}</Text> : null}
      </PageSection>

      <PageSection title={t('games.okey.rulesTitle')}>
        {(['rules1', 'rules2', 'rules3', 'rules4'] as const).map((k) => (
          <Text key={k} style={styles.rules}>{t(`games.okey.${k}`)}</Text>
        ))}
      </PageSection>
    </View>
  );
}

const OkeyScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const wallet = (user?.walletAddress || user?.address)?.toLowerCase() ?? null;
  const tableId: string | undefined = route.params?.table;
  const open = useCallback((id: string) => navigation.push(ScreenNames.Okey, { table: id }), [navigation]);

  return (
    <View className="bg-theme-background" style={{ flex: 1 }}>
      <ScreenHeader title={t('games.okey.title')} icon="arcade" />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {!tableId ? <Text style={styles.intro}>{t('games.okey.intro')}</Text> : null}
        {tableId ? <TableView key={tableId} id={tableId} wallet={wallet} /> : <Lobby wallet={wallet} onOpen={open} />}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  intro: { color: SOFT, fontSize: 12, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  btnSmall: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, gap: 4 },
  btnLabel: { fontSize: 13, fontWeight: '600' },
  strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'hsla(240, 6%, 10%, 1)', maxWidth: 180 },
  tagText: { color: WHITE, fontSize: 11, fontWeight: '600' },
  felt: { borderRadius: 22, padding: 10, gap: 8 },
  feltTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  feltSides: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  feltSmall: { color: FELT_INK, fontSize: 9 },
  indicator: { flexDirection: 'row', gap: 5, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 5, backgroundColor: 'hsla(0, 0%, 0%, 0.25)' },
  seat: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 7, paddingVertical: 5, backgroundColor: 'hsla(0, 0%, 0%, 0.25)', maxWidth: 170 },
  seatActive: { backgroundColor: 'hsla(43, 96%, 56%, 0.15)', borderWidth: 1, borderColor: 'hsla(43, 96%, 56%, 0.6)' },
  botAvatar: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsla(240, 4%, 16%, 1)' },
  seatName: { color: WHITE, fontSize: 11, fontWeight: '600' },
  seatBot: { color: SOFT, fontSize: 9, fontWeight: '400' },
  seatMeta: { color: 'hsla(240, 5%, 84%, 1)', fontSize: 9.5 },
  melds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  meld: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: 8, padding: 3, backgroundColor: 'hsla(0, 0%, 0%, 0.2)' },
  meldGlow: { backgroundColor: 'hsla(45, 96%, 64%, 0.25)', borderWidth: 1, borderColor: 'hsla(45, 96%, 64%, 1)' },
  pileRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', gap: 18, marginTop: 4 },
  pileCol: { alignItems: 'center', gap: 3 },
  pile: { width: 30, height: 42, borderRadius: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsla(155, 70%, 10%, 1)', borderWidth: 1, borderColor: 'hsla(0, 0%, 100%, 0.2)' },
  pileHot: { borderWidth: 2, borderColor: 'hsla(45, 96%, 64%, 1)', borderRadius: 6 },
  pileText: { color: 'hsla(150, 60%, 90%, 1)', fontSize: 11, fontWeight: '700' },
  throwSlot: { borderRadius: 6 },
  statusLine: { color: WHITE, fontSize: 12, fontWeight: '500', textAlign: 'center' },
  panel: { gap: 8, borderRadius: 16, padding: 12, backgroundColor: 'hsla(240, 6%, 10%, 1)', borderWidth: 1, borderColor: 'hsla(0, 0%, 100%, 0.06)' },
  panelTitle: { color: WHITE, fontSize: 14, fontWeight: '600' },
  panelText: { color: 'hsla(240, 5%, 84%, 1)', fontSize: 12 },
  panelMuted: { color: SOFT, fontSize: 12 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stagedFoot: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: WHITE, backgroundColor: 'hsla(240, 4%, 16%, 1)' },
  rack: { borderRadius: 16, padding: 8, paddingTop: 12 },
  rackTiles: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4 },
  rackButtons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 10 },
  rackHint: { color: 'hsla(48, 96%, 89%, 1)', fontSize: 11, textAlign: 'center', marginTop: 6 },
  lobbyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  rowTitle: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  rowSub: { color: MUTED, fontSize: 12 },
  miniSeat: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: 'hsla(240, 5%, 26%, 1)', borderWidth: 2, borderColor: 'hsla(240, 6%, 10%, 1)' },
  miniSeatEmpty: { backgroundColor: 'hsla(240, 6%, 10%, 1)', borderStyle: 'dashed', borderColor: 'hsla(240, 5%, 34%, 1)', borderWidth: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '600' },
  quick: { borderRadius: 16, padding: 16, gap: 4 },
  quickTitle: { color: WHITE, fontSize: 15, fontWeight: '600' },
  quickSub: { color: FELT_INK, fontSize: 12 },
  rules: { color: SOFT, fontSize: 12, lineHeight: 18, marginBottom: 8 },
});

export default OkeyScreen;
