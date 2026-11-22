/**
 * CorrespondenceChessScreen
 * =========================
 * Native twin of riftn-web /arcade/correspondence-chess. Challenge a friend,
 * then take days, not minutes, over each move; a push arrives when it is your
 * turn (type game_turn, see services/push). `game` opens one board.
 *
 * The server keeps the rules (riftn-backend src/games/chess.service.ts) and
 * sends the legal moves for whoever is on move, so this screen only draws.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Icon from '../components/ui/Icon';
import Avatar from '../components/common/Avatar';
import ScreenHeader from '../components/ScreenHeader';
import { KitButton, PageEmpty, PageSection } from '../components/page/PageKit';
import ChessBoardNative, { type BoardMove } from '../components/games/ChessBoardNative';
import { ScreenNames } from '../navigation/ScreenNames';
import { useAuth } from '../context/AuthContext';
import { toastError, toastSuccess } from '../libs/toast';
import { shareWithRef } from '../libs/shareRef';
import { WEBSITE_LINK } from '../config/links';
import {
  chessAction, chessCreate, chessDraw, chessGet, chessList, chessMove, fenBoard,
  type ChessGame, type GamePlayer,
} from '../services/games.service';

const PAGE_URL = `${WEBSITE_LINK}/arcade/correspondence-chess`;
const DAY_CHOICES = [1, 2, 3, 5, 7];
const MUTED = 'hsla(240, 4%, 46%, 1)';
const SOFT = 'hsla(240, 5%, 65%, 1)';

const nameOf = (p: GamePlayer | null | undefined) => (p ? p.displayName || (p.username ? `@${p.username}` : `${p.address.slice(0, 6)}…`) : '');
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** "2d 4h", "5h 20m", "12m" until the deadline. */
function timeLeft(deadline: string | null, now: number): string {
  if (!deadline) return '';
  const ms = Math.max(0, new Date(deadline).getTime() - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function PlayerChip({ player, active, clock }: { player: GamePlayer | null; active?: boolean; clock?: string }) {
  const name = nameOf(player);
  return (
    <View style={[styles.chip, active && styles.chipActive]}>
      <Avatar uri={player?.avatarImageUrl} size={30} name={name.replace('@', '')} />
      <Text style={styles.chipName} numberOfLines={1}>{name || '…'}</Text>
      {clock ? <Text style={[styles.clock, { color: active ? 'hsla(0, 0%, 100%, 1)' : MUTED }]}>{clock}</Text> : null}
    </View>
  );
}

function ActionButton({ label, onPress, disabled, icon, tone = 'quiet' }: { label: string; onPress: () => void; disabled?: boolean; icon?: string; tone?: 'primary' | 'quiet' | 'danger' }) {
  const ink = tone === 'primary' ? 'hsla(240, 6%, 5%, 1)' : tone === 'danger' ? 'hsla(0, 94%, 82%, 1)' : 'hsla(240, 5%, 90%, 1)';
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}>
      <View style={[styles.action, { backgroundColor: tone === 'primary' ? 'hsla(0, 0%, 100%, 1)' : 'hsla(240, 4%, 16%, 1)' }]}>
        {icon ? <Icon name={icon as never} size={14} color={ink} /> : null}
        <Text style={[styles.actionLabel, { color: ink }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

// --------------------------------------------------------------- one game

function GameView({ id, wallet }: { id: string; wallet: string | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const key = useMemo(() => ['corr-chess', id, wallet], [id, wallet]);
  const { data, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => chessGet(id, !!wallet),
    // Correspondence: nobody needs a live socket, a quiet poll is plenty.
    refetchInterval: (q) => (q.state.data?.game.status === 'active' && !q.state.data.game.yourTurn ? 15_000 : false),
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const game = data?.game;

  const run = useCallback(async (work: () => Promise<{ game: ChessGame }>) => {
    setBusy(true);
    try {
      const next = await work();
      queryClient.setQueryData(key, next);
      void queryClient.invalidateQueries({ queryKey: ['corr-chess-list'] });
    } catch (e) {
      toastError(errorText(e));
      void refetch();
    } finally {
      setBusy(false);
    }
  }, [key, queryClient, refetch]);

  const checkSquare = useMemo(() => {
    if (!game?.inCheck) return null;
    const king = game.turn === 'w' ? 'K' : 'k';
    return fenBoard(game.fen).find((s) => s.piece === king)?.square ?? null;
  }, [game]);

  if (error) return <PageEmpty title={t('games.chess.notFound')} />;
  if (!game) return <ActivityIndicator style={{ marginTop: 80 }} color={SOFT} />;

  const flipped = game.you === 'b';
  const top = flipped ? game.white : game.black;
  const bottom = flipped ? game.black : game.white;
  const topSide = flipped ? 'w' : 'b';
  const clock = game.status === 'active' ? timeLeft(game.moveDeadline, now) : '';
  const opponentOffered = !!game.drawOfferBy && !!wallet && game.drawOfferBy !== wallet;
  const iOffered = !!game.drawOfferBy && !!wallet && game.drawOfferBy === wallet;

  let status = '';
  if (game.status === 'pending') {
    status = game.invitee && wallet === game.invitee.address
      ? t('games.chess.statusInvited', { name: nameOf(game.createdBy), days: game.daysPerMove })
      : t('games.chess.statusWaiting');
  } else if (game.status === 'active') {
    status = game.yourTurn
      ? t('games.chess.statusYourMove', { time: clock })
      : t('games.chess.statusTheirMove', { name: nameOf(game.turn === 'w' ? game.white : game.black), time: clock });
  } else if (game.status === 'finished') {
    const reason = t(`games.chess.end.${game.endReason}`, { defaultValue: game.endReason ?? '' });
    status = game.result === '1/2-1/2'
      ? t('games.chess.statusDraw', { reason })
      : t('games.chess.statusWon', { name: nameOf(game.result === '1-0' ? game.white : game.black), reason });
  } else {
    status = t('games.chess.statusClosed');
  }

  const pairs: Array<[number, string, string | undefined]> = [];
  for (let i = 0; i < game.moves.length; i += 2) pairs.push([i / 2 + 1, game.moves[i], game.moves[i + 1]]);
  const boardSize = Math.min(width - 16, 520);

  return (
    <View style={{ gap: 8 }}>
      <View style={{ paddingHorizontal: 8, gap: 6 }}>
        <PlayerChip player={top} active={game.status === 'active' && game.turn === topSide} clock={game.status === 'active' && game.turn === topSide ? clock : undefined} />
        <ChessBoardNative
          fen={game.fen}
          flipped={flipped}
          legal={game.yourTurn ? game.legal : undefined}
          lastMove={game.lastMove}
          checkSquare={checkSquare}
          disabled={busy || !game.yourTurn}
          size={boardSize}
          onMove={(move: BoardMove) => void run(() => chessMove(id, move))}
        />
        <PlayerChip player={bottom} active={game.status === 'active' && game.turn !== topSide} clock={game.status === 'active' && game.turn !== topSide ? clock : undefined} />
      </View>

      <PageSection>
        <Text className="text-theme-neutrals-100" style={styles.status}>{status}</Text>
        <Text style={styles.sub}>{t('games.chess.daysEach', { days: game.daysPerMove })}</Text>
        <View style={styles.actions}>
          {game.status === 'pending' && wallet && wallet !== game.createdBy?.address && (!game.invitee || game.invitee.address === wallet) ? (
            <>
              <ActionButton tone="primary" label={t('games.chess.accept')} disabled={busy} onPress={() => void run(() => chessAction(id, 'accept'))} />
              {game.invitee?.address === wallet ? (
                <ActionButton label={t('games.chess.decline')} disabled={busy} onPress={() => void run(() => chessAction(id, 'decline'))} />
              ) : null}
            </>
          ) : null}
          {game.status === 'pending' && wallet === game.createdBy?.address ? (
            <ActionButton label={t('games.chess.cancel')} disabled={busy} onPress={() => void run(() => chessAction(id, 'decline'))} />
          ) : null}
          {game.status === 'active' && game.you ? (
            <>
              {opponentOffered ? (
                <>
                  <ActionButton tone="primary" icon="Handshake" label={t('games.chess.acceptDraw')} disabled={busy} onPress={() => void run(() => chessDraw(id, 'accept'))} />
                  <ActionButton label={t('games.chess.declineDraw')} disabled={busy} onPress={() => void run(() => chessDraw(id, 'decline'))} />
                </>
              ) : (
                <ActionButton
                  icon="Handshake"
                  label={iOffered ? t('games.chess.drawOffered') : t('games.chess.offerDraw')}
                  disabled={busy || iOffered}
                  onPress={() => void run(() => chessDraw(id, 'offer'))}
                />
              )}
              <ActionButton
                tone="danger"
                icon="Flag"
                label={t('games.chess.resign')}
                disabled={busy}
                onPress={() => Alert.alert(t('games.chess.resignConfirm'), undefined, [
                  { text: t('games.chess.declineDraw'), style: 'cancel' },
                  { text: t('games.chess.resign'), style: 'destructive', onPress: () => void run(() => chessAction(id, 'resign')) },
                ])}
              />
            </>
          ) : null}
          <ActionButton
            icon="Share2"
            label={t('games.share')}
            onPress={() => void shareWithRef({ url: `${PAGE_URL}?game=${id}`, message: `${t('games.chess.title')} ${PAGE_URL}?game=${id}` }).catch(() => undefined)}
          />
        </View>
      </PageSection>

      {pairs.length ? (
        <PageSection>
          {pairs.map(([n, w, b]) => (
            <View key={n} style={styles.moveRow}>
              <Text style={[styles.moveText, { width: 36, color: MUTED }]}>{n}.</Text>
              <Text style={[styles.moveText, { flex: 1 }]}>{w}</Text>
              <Text style={[styles.moveText, { flex: 1 }]}>{b ?? ''}</Text>
            </View>
          ))}
        </PageSection>
      ) : null}
    </View>
  );
}

// --------------------------------------------------------------- the lobby

function GameRow({ game, wallet, onOpen }: { game: ChessGame; wallet: string | null; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const opponent = game.status === 'pending'
    ? (game.createdBy?.address === wallet ? game.invitee : game.createdBy)
    : (game.white?.address === wallet ? game.black : game.white);
  let note = '';
  if (game.status === 'active') note = game.yourTurn ? t('games.chess.rowYourMove') : t('games.chess.rowTheirMove');
  else if (game.status === 'pending') note = game.createdBy?.address === wallet ? t('games.chess.rowSent') : t('games.chess.rowChallenge');
  else if (game.status === 'finished') note = game.result === '1/2-1/2' ? t('games.chess.rowDraw') : (game.result === '1-0') === (game.white?.address === wallet) ? t('games.chess.rowWon') : t('games.chess.rowLost');
  else note = t('games.chess.rowClosed');
  const hot = game.yourTurn || (game.status === 'pending' && game.createdBy?.address !== wallet);
  return (
    <Pressable onPress={() => onOpen(game.id)} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <View style={styles.row}>
        <Avatar uri={opponent?.avatarImageUrl} size={36} name={nameOf(opponent).replace('@', '')} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-theme-neutrals-100" style={styles.rowTitle} numberOfLines={1}>{opponent ? nameOf(opponent) : t('games.chess.anyone')}</Text>
          <Text style={styles.sub}>
            {t('games.chess.daysEach', { days: game.daysPerMove })}
            {game.status === 'active' ? ` · ${t('games.chess.moveNumber', { n: Math.floor(game.moves.length / 2) + 1 })}` : ''}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: hot ? 'hsla(161, 94%, 30%, 1)' : 'hsla(240, 4%, 16%, 1)' }]}>
          <Text style={[styles.pillText, { color: hot ? 'hsla(0, 0%, 100%, 1)' : 'hsla(240, 5%, 84%, 1)' }]}>{note}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <View style={[styles.choice, { backgroundColor: active ? 'hsla(0, 0%, 100%, 1)' : 'hsla(240, 4%, 16%, 1)' }]}>
        <Text style={[styles.choiceText, { color: active ? 'hsla(240, 6%, 5%, 1)' : 'hsla(240, 5%, 84%, 1)' }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function Lobby({ wallet, onOpen }: { wallet: string; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [opponent, setOpponent] = useState('');
  const [days, setDays] = useState(3);
  const [color, setColor] = useState<'white' | 'black' | 'random'>('random');
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['corr-chess-list', wallet], queryFn: chessList, refetchInterval: 30_000 });

  const send = async () => {
    setBusy(true);
    try {
      const { game } = await chessCreate({ opponent: opponent.trim() || undefined, days, color });
      toastSuccess(opponent.trim() ? t('games.chess.sent') : t('games.chess.openPosted'));
      setOpponent('');
      void queryClient.invalidateQueries({ queryKey: ['corr-chess-list'] });
      onOpen(game.id);
    } catch (e) {
      toastError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const games = data?.games ?? [];
  const sections: Array<[string, ChessGame[]]> = [
    [t('games.chess.yourMove'), games.filter((g) => g.status === 'active' && g.yourTurn)],
    [t('games.chess.challenges'), games.filter((g) => g.status === 'pending')],
    [t('games.chess.waitingOnThem'), games.filter((g) => g.status === 'active' && !g.yourTurn)],
    [t('games.chess.openChallenges'), data?.open ?? []],
    [t('games.chess.finished'), games.filter((g) => !['active', 'pending'].includes(g.status)).slice(0, 15)],
  ];

  return (
    <View>
      <PageSection title={t('games.chess.newGame')}>
        <TextInput
          value={opponent}
          onChangeText={setOpponent}
          placeholder={t('games.chess.opponentPlaceholder')}
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.label}>{t('games.chess.daysLabel')}</Text>
        <View style={styles.chips}>
          {DAY_CHOICES.map((d) => <Chip key={d} label={t('games.chess.dayChip', { days: d })} active={days === d} onPress={() => setDays(d)} />)}
        </View>
        <Text style={styles.label}>{t('games.chess.colorLabel')}</Text>
        <View style={styles.chips}>
          {(['random', 'white', 'black'] as const).map((c) => <Chip key={c} label={t(`games.chess.color.${c}`)} active={color === c} onPress={() => setColor(c)} />)}
        </View>
        <KitButton
          style={{ marginTop: 14 }}
          disabled={busy}
          onPress={() => void send()}
          label={opponent.trim() ? t('games.chess.sendChallenge') : t('games.chess.postOpen')}
        />
      </PageSection>

      {isLoading ? <ActivityIndicator style={{ marginTop: 24 }} color={SOFT} /> : null}
      {sections.map(([title, list]) => (list.length ? (
        <PageSection key={title} title={title}>
          <View style={{ gap: 8 }}>
            {list.map((g) => <GameRow key={g.id} game={g} wallet={wallet} onOpen={onOpen} />)}
          </View>
        </PageSection>
      ) : null))}
      {!isLoading && !games.length && !(data?.open ?? []).length ? <PageEmpty title={t('games.chess.empty')} /> : null}
    </View>
  );
}

const CorrespondenceChessScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const wallet = (user?.walletAddress || user?.address)?.toLowerCase() ?? null;
  const gameId: string | undefined = route.params?.game;
  const open = useCallback((id: string) => navigation.push(ScreenNames.CorrespondenceChess, { game: id }), [navigation]);

  return (
    <View className="bg-theme-background" style={{ flex: 1 }}>
      <ScreenHeader title={t('games.chess.title')} icon="arcade" />
      <ScrollView contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {!gameId ? <Text style={styles.intro}>{t('games.chess.intro')}</Text> : null}
        {gameId ? (
          <GameView id={gameId} wallet={wallet} />
        ) : wallet ? (
          <Lobby wallet={wallet} onOpen={open} />
        ) : (
          <PageEmpty
            icon={<Icon name="Crown" size={40} color={SOFT} />}
            title={t('games.signInToPlay')}
            action={<KitButton label={t('games.signIn')} onPress={() => navigation.navigate(ScreenNames.SignIn)} />}
          />
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  intro: { color: SOFT, fontSize: 12, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  chipActive: { backgroundColor: 'hsla(0, 0%, 100%, 0.1)', borderWidth: 1, borderColor: 'hsla(0, 0%, 100%, 0.25)' },
  chipName: { flex: 1, minWidth: 0, color: 'hsla(0, 0%, 100%, 1)', fontSize: 14, fontWeight: '600' },
  clock: { fontSize: 12, fontVariant: ['tabular-nums'] },
  status: { fontSize: 14, fontWeight: '600' },
  sub: { color: MUTED, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  actionLabel: { fontSize: 12, fontWeight: '600' },
  moveRow: { flexDirection: 'row', paddingVertical: 2 },
  moveText: { color: 'hsla(240, 5%, 84%, 1)', fontSize: 12, fontFamily: 'monospace' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '600' },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: 'hsla(0, 0%, 100%, 1)', backgroundColor: 'hsla(240, 4%, 16%, 1)' },
  label: { color: MUTED, fontSize: 12, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  choiceText: { fontSize: 12, fontWeight: '600' },
});

export default CorrespondenceChessScreen;
