import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
  type DimensionValue,
} from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import ScreenHeader from '../components/ScreenHeader';
import { KitButton, PageEmpty, PageSection } from '../components/page/PageKit';
import { WEBSITE_LINK } from '../config/links';
import { useUser } from '../context/AuthContext';
import { ScreenNames } from '../navigation/ScreenNames';
import { spendAction, spendCreate, spendGet, spendList } from '../services/games.service';
import {
  SPEND_BOARD, SPEND_COMPUTER_SECONDS, SPEND_LEVELS, SPEND_LIVE_SECONDS, SPEND_PALS_DAYS, SPEND_PATH, SPEND_PAWNS,
  spendMoney, spendName, spendPoll, spendSecondsLeft, spendSpace, spendTime,
  type SpendAction, type SpendCreate, type SpendGame, type SpendLevel, type SpendMode,
} from '../libs/spend';

const percent = (span: number): DimensionValue => ((span * 100 / 6) + '%') as DimensionValue;

function Board({ game }: { game?: SpendGame }) {
  const { t } = useTranslation();
  const acting = game?.status === 'active' ? game.seats[game.acting] : undefined;

  return (
    <View accessibilityLabel={t('games.spend.board')} className="dark-surface" style={styles.board}>
      <View style={styles.boardCenter}>
        <Text style={styles.boardTitle}>{t('games.spend.boardMark')}</Text>
        <Text style={styles.boardSubtitle}>
          {game?.million ? t('games.spend.millionRound') : game?.lastRoll ? t('games.spend.rolled', {
            name: spendName(game.seats[game.lastRoll.seat]?.player), die: game.lastRoll.value,
          }) : t('games.spend.credit')}
        </Text>
      </View>
      {(game?.board ?? SPEND_BOARD).map((amount, index) => {
        const spot = spendSpace(index);
        const seats = game?.seats.filter(seat => !seat.out && seat.pos === index) ?? [];
        const highlighted = acting?.pos === index;
        return (
          <View key={amount} style={[
            styles.space, { top: percent(spot.row), left: percent(spot.column), height: percent(spot.height) },
            highlighted && styles.activeSpace,
          ]}>
            <Text style={[styles.amount, highlighted && styles.inverse]}>
              {index === 0 ? t('games.spend.startSpace') : spendMoney(amount)}
            </Text>
            {seats.length > 0 && (
              <View style={styles.boardPawns}>
                {seats.map(seat => (
                  <Text accessibilityLabel={spendName(seat.player)} key={seat.player.address}
                    style={[styles.pawn, { backgroundColor: SPEND_PAWNS[seat.index] }]}>{seat.index + 1}</Text>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Choices<T extends string | number>({ label, values, selected, pick, format }: {
  label: string; values: readonly T[]; selected: T; pick: (value: T) => void; format: (value: T) => string;
}) {
  return (
    <View style={styles.stack}>
      <Text className="text-theme-neutrals-300" style={styles.meta}>{label}</Text>
      <View style={styles.row}>
        {values.map(value => (
          <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: value === selected }}
            className={value === selected ? 'bg-theme-neutrals-100' : 'bg-theme-neutrals-800'}
            style={styles.choice} onPress={() => pick(value)}>
            <Text className={value === selected ? 'text-theme-neutrals-900' : 'text-theme-neutrals-100'}
              style={styles.strong}>{format(value)}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Lobby({ wallet, open }: { wallet: string; open: (id: string) => void }) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const client = useQueryClient();
  const [mode, setMode] = useState<SpendMode>('pals');
  const [opponent, setOpponent] = useState('');
  const [days, setDays] = useState(2);
  const [liveSeconds, setLiveSeconds] = useState(60);
  const [computerSeconds, setComputerSeconds] = useState(300);
  const [level, setLevel] = useState<SpendLevel>('normal');
  const listKey = ['spend', 'lobby', wallet];
  const list = useQuery({ queryKey: listKey, queryFn: spendList, refetchInterval: focused ? 20_000 : false, enabled: focused });
  const create = useMutation({
    mutationFn: spendCreate,
    onSuccess: ({ game }) => {
      void client.invalidateQueries({ queryKey: listKey });
      open(game.id);
    },
  });

  const submit = () => {
    if (create.isPending) return;
    let input: SpendCreate;
    if (mode === 'pals') {
      input = { mode, days, opponent: opponent.trim().replace(/^@/, '') || undefined };
    } else if (mode === 'live') {
      input = { mode, turnSeconds: liveSeconds };
    } else {
      input = { mode, turnSeconds: computerSeconds, level };
    }
    create.mutate(input);
  };

  return (
    <>
      <PageSection>
        <View style={styles.stack}>
          <Choices<SpendMode> label={t('games.spend.mode')} values={['pals', 'live', 'computer']} selected={mode}
            pick={value => { if (!create.isPending) { setMode(value); create.reset(); } }} format={value => t('games.spend.mode_' + value)} />
          {mode === 'pals' && (
            <View style={styles.stack}>
              <Text className="text-theme-neutrals-300" style={styles.meta}>{t('games.spend.invitee')}</Text>
              <TextInput
                className="bg-theme-neutrals-800 text-theme-neutrals-100" style={styles.input}
                accessibilityLabel={t('games.spend.invitee')} placeholder={t('games.spend.usernamePlaceholder')} placeholderTextColor="#82828a"
                value={opponent} onChangeText={setOpponent} autoCapitalize="none" autoCorrect={false}
              />
              <Choices<number> label={t('games.spend.turnTime')} values={SPEND_PALS_DAYS} selected={days}
                pick={setDays} format={value => t('games.spend.days', { count: value })} />
            </View>
          )}
          {mode === 'live' && (
            <Choices<number> label={t('games.spend.turnTime')} values={SPEND_LIVE_SECONDS} selected={liveSeconds}
              pick={setLiveSeconds} format={value => t('games.spend.seconds', { count: value })} />
          )}
          {mode === 'computer' && (
            <>
              <Choices<number> label={t('games.spend.turnTime')} values={SPEND_COMPUTER_SECONDS} selected={computerSeconds}
                pick={setComputerSeconds} format={value => value === 86_400 ? t('games.spend.days', { count: 1 }) : t('games.spend.minutes', { count: value / 60 })} />
              <Choices<SpendLevel> label={t('games.spend.difficulty')} values={SPEND_LEVELS} selected={level}
                pick={setLevel} format={value => t('games.spend.level_' + value)} />
            </>
          )}
          {create.isError && <Text accessibilityLiveRegion="polite" className="text-theme-neutrals-100">{create.error.message}</Text>}
          <View style={styles.row}>
            <KitButton label={t('games.spend.create_' + mode)} onPress={submit} disabled={create.isPending} />
          </View>
        </View>
      </PageSection>
      {list.isPending && <ActivityIndicator />}
      {list.isError && (
        <PageSection><KitButton label={t('games.spend.retryList')} onPress={() => void list.refetch()} /></PageSection>
      )}
      {list.data && (['games', 'open'] as const).map(key => (
        <PageSection key={key} title={t('games.spend.list_' + key)}>
          {list.data[key].length === 0 && <Text className="text-theme-neutrals-400">{t('games.spend.empty_' + key)}</Text>}
          {list.data[key].map(game => {
            const gameMode = game.seats.some(seat => seat.player.computer) && game.mode === 'pals' ? 'computer' : game.mode;
            return (
              <Pressable key={game.id} accessibilityRole="button" style={styles.gameRow} onPress={() => open(game.id)}>
                <Text className="text-theme-neutrals-100" style={styles.strong}>
                  {t('games.spend.mode_' + gameMode)} · {game.yourTurn ? t('games.spend.yourTurn') : t('games.spend.status_' + game.status)}
                </Text>
                <Text className="text-theme-neutrals-400">{game.seats.map(seat => spendName(seat.player)).join(', ')}</Text>
              </Pressable>
            );
          })}
        </PageSection>
      ))}
    </>
  );
}

function Game({ id, wallet, signIn }: { id: string; wallet: string | null; signIn: () => void }) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const client = useQueryClient();
  const key = ['spend', 'game', id, wallet];
  const [text, setText] = useState('');
  const [level, setLevel] = useState<SpendLevel>('normal');
  const [now, setNow] = useState(Date.now);
  const detail = useQuery({
    queryKey: key,
    queryFn: () => spendGet(id, !!wallet),
    refetchInterval: query => focused ? spendPoll(query.state.data?.game) : false,
    enabled: focused,
    retry: false,
  });
  const action = useMutation({
    mutationFn: (move: SpendAction) => spendAction(id, move),
    onMutate: () => client.cancelQueries({ queryKey: key }),
    onSuccess: ({ game }, move) => {
      client.setQueryData(key, { game });
      if (move.name === 'buy') setText('');
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ['spend', 'lobby', wallet] });
    },
  });
  const game = detail.data?.game;
  const deadline = game?.turnDeadline;
  useEffect(() => {
    if (!deadline || !focused) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [deadline, focused]);

  if (!game) {
    if (!detail.isError) return <ActivityIndicator />;
    return (
      <PageEmpty title={t('games.spend.unavailable')} action={
        <View style={styles.row}>
          {!wallet && <KitButton label={t('games.signIn')} onPress={signIn} />}
          <KitButton variant="quiet" label={t('games.spend.retry')} onPress={() => void detail.refetch()} />
        </View>
      } />
    );
  }

  const remaining = spendSecondsLeft(game, detail.dataUpdatedAt, now);
  const pending = game.status === 'pending';
  const active = game.status === 'active';
  const currentSeat = game.seats[game.you];
  const acting = game.seats[game.acting];
  const canJoin = pending && game.you === -1 && game.seats.length < game.maxSeats &&
    (!game.invitee || game.invitee.address.toLowerCase() === wallet);
  const canLeave = pending && (game.you >= 0 || game.invitee?.address.toLowerCase() === wallet);
  const act = (move: SpendAction) => { if (!action.isPending) action.mutate(move); };
  const buy = () => {
    if (text.trim() && remaining !== 0) act({ name: 'buy', body: { text: text.trim() } });
  };
  const share = () => {
    const link = WEBSITE_LINK + SPEND_PATH + '?game=' + encodeURIComponent(id);
    void Share.share({ message: link }).catch(() => Alert.alert(t('games.spend.shareError')));
  };

  return (
    <>
      <View style={styles.status}>
        <Text className="text-theme-neutrals-100" accessibilityLiveRegion="polite" style={[styles.strong, styles.statusText]}>
          {active ? game.yourTurn ? t('games.spend.yourTurn') : t('games.spend.playersTurn', { name: spendName(acting?.player) })
            : game.winner ? t('games.spend.won', { name: spendName(game.winner) }) : t('games.spend.status_' + game.status)}
        </Text>
        {remaining !== null && active && (
          <Text className="text-theme-neutrals-100" accessibilityLabel={t('games.spend.timeLeft') + ' ' + spendTime(remaining)}
            style={styles.strong}>{spendTime(remaining)}</Text>
        )}
        {(pending || game.mode === 'live') && <KitButton variant="quiet" label={t('games.spend.share')} onPress={share} />}
      </View>
      <Board game={game} />
      <PageSection>
        <View style={styles.stack}>
          {game.seats.map(seat => (
            <View key={seat.player.address} style={styles.row}>
              <Text style={[styles.pawn, { backgroundColor: SPEND_PAWNS[seat.index] }]}>{seat.index + 1}</Text>
              <Text className="text-theme-neutrals-100" style={styles.seatName}>
                {spendName(seat.player)}{seat.index === game.you ? ' (' + t('games.spend.you') + ')' : ''}
                {seat.out ? ' · ' + t(seat.outReason === 'timeout' ? 'games.spend.timedOut' : 'games.spend.out') : ''}
              </Text>
              {pending && game.host && seat.player.computer && (
                <KitButton variant="quiet" label={t('games.spend.remove')} disabled={action.isPending}
                  onPress={() => act({ name: 'computer', body: { remove: seat.player.address } })} />
              )}
            </View>
          ))}
          {!wallet && pending && <KitButton label={t('games.signIn')} onPress={signIn} />}
          {wallet && pending && (
            <>
              {game.mode === 'live' && game.host && game.seats.length < game.maxSeats && (
                <Choices<SpendLevel> label={t('games.spend.difficulty')} values={SPEND_LEVELS} selected={level}
                  pick={setLevel} format={value => t('games.spend.level_' + value)} />
              )}
              <View style={styles.row}>
                {canJoin && <KitButton label={t('games.spend.join')} disabled={action.isPending} onPress={() => act({ name: 'join' })} />}
                {game.mode === 'live' && game.host && (
                  <>
                    {game.seats.length < game.maxSeats && <KitButton variant="quiet" label={t('games.spend.addComputer')}
                      disabled={action.isPending} onPress={() => act({ name: 'computer', body: { level } })} />}
                    <KitButton label={t('games.spend.startTable')} disabled={action.isPending || game.seats.length < 2}
                      onPress={() => act({ name: 'start' })} />
                  </>
                )}
                {canLeave && <KitButton variant="quiet"
                  label={t(game.host ? 'games.spend.cancelGame' : game.mode === 'pals' ? 'games.spend.decline' : 'games.spend.leave')}
                  disabled={action.isPending} onPress={() => act({ name: 'leave' })} />}
              </View>
            </>
          )}
          {active && game.yourTurn && (
            game.phase === 'roll' ? (
              <View style={styles.row}><KitButton label={t('games.spend.roll')} disabled={action.isPending || remaining === 0}
                onPress={() => act({ name: 'roll' })} /></View>
            ) : (
              <>
                <Text className="text-theme-neutrals-100" style={styles.strong}>{t('games.spend.prompt', { amount: spendMoney(game.amount) })}</Text>
                <TextInput className="bg-theme-neutrals-800 text-theme-neutrals-100" style={styles.input}
                  accessibilityLabel={t('games.spend.prompt', { amount: spendMoney(game.amount) })}
                  maxLength={game.maxChars} value={text} onChangeText={setText} onSubmitEditing={buy} returnKeyType="send" />
                <View style={styles.row}>
                  <KitButton label={t('games.spend.buy')} disabled={action.isPending || remaining === 0 || !text.trim()} onPress={buy} />
                  {!currentSeat?.saved && <KitButton variant="quiet" label={t('games.spend.save')} disabled={action.isPending || remaining === 0}
                    onPress={() => act({ name: 'save' })} />}
                </View>
              </>
            )
          )}
          {active && currentSeat && !currentSeat.out && (
            <View style={styles.row}><KitButton variant="quiet" label={t('games.spend.giveUp')} disabled={action.isPending}
              onPress={() => Alert.alert(t('games.spend.confirmGiveUp'), undefined, [
                { text: t('games.spend.keepPlaying'), style: 'cancel' },
                { text: t('games.spend.giveUp'), style: 'destructive', onPress: () => act({ name: 'give-up' }) },
              ])} /></View>
          )}
          {action.isError && <Text accessibilityLiveRegion="polite" className="text-theme-neutrals-100">{action.error.message}</Text>}
          {detail.isError && <KitButton variant="quiet" label={t('games.spend.retry')} onPress={() => void detail.refetch()} />}
        </View>
      </PageSection>
      {!!game.buys?.length && (
        <PageSection title={t('games.spend.history')}>
          {[...game.buys].reverse().map(entry => (
            <View key={entry.n} style={styles.gameRow}>
              <Text className="text-theme-neutrals-100" style={styles.strong}>
                {spendName(game.seats[entry.seat]?.player)} · {spendMoney(entry.amount)}
              </Text>
              <Text className="text-theme-neutrals-400">{entry.saved ? t('games.spend.saved') : entry.text}</Text>
            </View>
          ))}
        </PageSection>
      )}
    </>
  );
}

export default function SpendScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const user = useUser() as { walletAddress?: string; address?: string } | null;
  const wallet = (user?.walletAddress || user?.address)?.toLowerCase() ?? null;
  const gameId = typeof route.params?.game === 'string' ? route.params.game : undefined;
  const [showRules, setShowRules] = useState(false);
  const signIn = () => navigation.navigate(ScreenNames.SignIn);

  return (
    <View className="bg-theme-background" style={styles.screen}>
      <ScreenHeader title={t('games.spend.title')} icon="arcade" />
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          <Text className="text-theme-neutrals-400" style={styles.disclaimer}>{t('games.spend.disclaimer')}</Text>
          {gameId ? <Game key={gameId + ':' + (wallet ?? '')} id={gameId} wallet={wallet} signIn={signIn} /> : (
            <>
              <Board />
              {wallet ? <Lobby key={wallet} wallet={wallet} open={id => navigation.push(ScreenNames.Spend, { game: id })} /> : (
                <PageEmpty title={t('games.signInToPlay')} action={<KitButton label={t('games.signIn')} onPress={signIn} />} />
              )}
            </>
          )}
          <PageSection>
            <Pressable style={styles.gameRow} accessibilityRole="button" accessibilityState={{ expanded: showRules }}
              onPress={() => setShowRules(value => !value)}>
              <Text className="text-theme-neutrals-100" style={styles.strong}>{t('games.spend.rules')}</Text>
            </Pressable>
            {showRules && <Text className="text-theme-neutrals-300" style={styles.rules}>{t('games.spend.ruleText')}</Text>}
          </PageSection>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  stack: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  status: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginHorizontal: 16, marginBottom: 10, gap: 8 },
  statusText: { flexGrow: 1, flexShrink: 1 },
  meta: { fontSize: 13 },
  strong: { fontSize: 14, fontWeight: '600' },
  choice: { justifyContent: 'center', minHeight: 44, borderRadius: 22, paddingHorizontal: 12 },
  input: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  rules: { fontSize: 14, lineHeight: 20 },
  disclaimer: { marginHorizontal: 16, marginVertical: 10, fontSize: 13 },
  gameRow: { minHeight: 44, justifyContent: 'center', gap: 3, paddingVertical: 8 },
  board: { direction: 'ltr', position: 'relative', aspectRatio: 6 / 5, overflow: 'hidden', borderRadius: 18, marginHorizontal: 16, marginBottom: 12, backgroundColor: '#13663b', borderWidth: 1, borderColor: '#13663b' },
  boardCenter: { position: 'absolute', top: '16.6667%', left: '16.6667%', bottom: '16.6667%', right: '16.6667%', backgroundColor: '#e2f2dc', alignItems: 'center', justifyContent: 'center', padding: 8 },
  boardTitle: { color: '#123c25', fontSize: 34, fontWeight: '900', letterSpacing: 2 },
  boardSubtitle: { color: '#123c25', fontSize: 12, textAlign: 'center', marginTop: 4 },
  space: { position: 'absolute', width: '16.6667%', backgroundColor: '#f1f9ed', borderWidth: 0.5, borderColor: '#13663b', alignItems: 'center', justifyContent: 'center', gap: 2 },
  activeSpace: { backgroundColor: '#12643a' },
  amount: { color: '#123c25', fontWeight: '700', fontSize: 11 },
  inverse: { color: '#ffffff' },
  boardPawns: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', maxWidth: 45, gap: 1 },
  pawn: { color: '#ffffff', fontWeight: '700', fontSize: 10, textAlign: 'center', lineHeight: 14, height: 14, width: 14, borderRadius: 7, overflow: 'hidden' },
  seatName: { flexGrow: 1, flexShrink: 1 },
});
