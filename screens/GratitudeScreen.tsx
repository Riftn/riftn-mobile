/**
 * GratitudeScreen
 * ===============
 * Native twin of riftn-web /arcade/gratitude. Two people take turns writing
 * one thing they are grateful for, with 1 to 7 days per turn. No repeats: the
 * server turns away the same blessing said again (the turn is not used), and
 * whoever lets their turn run out loses. A push arrives when it is your turn
 * (type game_turn, game 'gratitude'). `game` opens one game.
 *
 * The rules live in riftn-backend src/games/gratitude.service.ts.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Icon from '../components/ui/Icon';
import Avatar from '../components/common/Avatar';
import ScreenHeader from '../components/ScreenHeader';
import { KitButton, PageEmpty, PageSection } from '../components/page/PageKit';
import { ScreenNames } from '../navigation/ScreenNames';
import { useAuth } from '../context/AuthContext';
import { useAppTheme } from '../context/ThemeContext';
import { toastError, toastSuccess } from '../libs/toast';
import { shareWithRef } from '../libs/shareRef';
import { formatCount } from '../libs/format-count';
import { WEBSITE_LINK } from '../config/links';
import {
  gratitudeAction, gratitudeCheck, gratitudeCreate, gratitudeGet, gratitudeList, gratitudeWrite,
  type GamePlayer, type GratitudeCheck, type GratitudeGame,
} from '../services/games.service';

const PAGE_URL = `${WEBSITE_LINK}/arcade/gratitude`;
const DAY_CHOICES = [1, 2, 3, 5, 7];
const MUTED = 'hsla(240, 4%, 46%, 1)';
const SOFT = 'hsla(240, 5%, 65%, 1)';
const INK = 'hsla(0, 0%, 100%, 1)';
const FILL = 'hsla(240, 4%, 16%, 1)';

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

/** The theme accent as "r,g,b", for tinted chips and your own lines. */
function useAccentRgb(): string {
  const theme = useAppTheme() as ReturnType<typeof useAppTheme> & { accent?: [number, number, number] };
  if (theme.accent) return theme.accent.join(',');
  const c = String(theme.colors?.accent ?? '');
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }
  const m = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  return m ? `${m[1]},${m[2]},${m[3]}` : '161,161,170';
}

function ActionButton({ label, onPress, disabled, icon, tone = 'quiet' }: { label: string; onPress: () => void; disabled?: boolean; icon?: string; tone?: 'primary' | 'quiet' | 'danger' }) {
  const ink = tone === 'primary' ? 'hsla(240, 6%, 5%, 1)' : tone === 'danger' ? 'hsla(0, 94%, 82%, 1)' : 'hsla(240, 5%, 90%, 1)';
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}>
      <View style={[styles.action, { backgroundColor: tone === 'primary' ? INK : FILL }]}>
        {icon ? <Icon name={icon as never} size={14} color={ink} /> : null}
        <Text style={[styles.actionLabel, { color: ink }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function TurnPill({ label, hot }: { label: string; hot: boolean }) {
  const accent = useAccentRgb();
  return (
    <View style={[styles.pill, hot ? { backgroundColor: `rgba(${accent},0.34)`, borderWidth: 1, borderColor: `rgba(${accent},1)` } : { backgroundColor: FILL }]}>
      <Text style={[styles.pillText, { color: hot ? INK : 'hsla(240, 5%, 84%, 1)' }]}>{label}</Text>
    </View>
  );
}

function Rules() {
  const { t } = useTranslation();
  return (
    <PageSection title={t('games.gratitude.howItWorks')}>
      {[1, 2, 3, 4].map((n) => (
        <View key={n} style={styles.rule}>
          <View style={styles.ruleNum}><Text style={styles.ruleNumText}>{n}</Text></View>
          <Text style={styles.ruleText}>{t(`games.gratitude.rule${n}`)}</Text>
        </View>
      ))}
    </PageSection>
  );
}

// --------------------------------------------------------------- one game

function GameView({ id, wallet }: { id: string; wallet: string | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const accent = useAccentRgb();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [text, setText] = useState('');
  const [hint, setHint] = useState<GratitudeCheck | null>(null);
  const key = useMemo(() => ['gratitude', id, wallet], [id, wallet]);
  const { data, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => gratitudeGet(id, !!wallet),
    // Days per turn: a quiet poll is plenty while waiting on them.
    refetchInterval: (q) => (q.state.data?.game.status === 'active' && !q.state.data.game.yourTurn ? 20_000 : false),
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const game = data?.game;

  // Live "already said" check while typing, so the warning shows before Send.
  useEffect(() => {
    setHint(null);
    const value = text.trim();
    if (!game?.yourTurn || value.length < 8) return;
    const timer = setTimeout(() => {
      gratitudeCheck(id, value).then((r) => setHint(r.ok || r.reason !== 'repeat' ? null : r)).catch(() => undefined);
    }, 700);
    return () => clearTimeout(timer);
  }, [game?.yourTurn, id, text]);

  const run = useCallback(async (work: () => Promise<{ game: GratitudeGame }>) => {
    setBusy(true);
    try {
      const next = await work();
      queryClient.setQueryData(key, next);
      void queryClient.invalidateQueries({ queryKey: ['gratitude-list'] });
      return true;
    } catch (e) {
      const message = errorText(e);
      if (/already said/i.test(message)) setHint({ ok: false, reason: 'repeat', message });
      else toastError(message);
      void refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }, [key, queryClient, refetch]);

  if (error) return <PageEmpty title={t('games.gratitude.notFound')} />;
  if (!game) return <ActivityIndicator style={{ marginTop: 80 }} color={SOFT} />;

  const opponent = game.players.find((p) => p.address !== wallet) ?? (game.createdBy?.address === wallet ? game.invitee : game.createdBy);
  const clock = game.status === 'active' ? timeLeft(game.turnDeadline, now) : '';
  const lines = game.lines ?? [];
  const playing = game.status === 'active' && !!game.you;
  const canAccept = game.status === 'pending' && !!wallet && wallet !== game.createdBy?.address && (!game.invitee || game.invitee.address === wallet);
  const canCancel = game.status === 'pending' && wallet === game.createdBy?.address;
  const send = async () => {
    const value = text.trim();
    if (!value || busy) return;
    if (await run(() => gratitudeWrite(id, value))) {
      setText('');
      setHint(null);
    }
  };

  let status = '';
  if (game.status === 'pending') {
    status = game.invitee && wallet === game.invitee.address
      ? t('games.gratitude.statusInvited', { name: nameOf(game.createdBy), days: game.daysPerTurn })
      : t('games.gratitude.statusWaiting');
  } else if (game.status === 'active') {
    status = game.yourTurn ? t('games.gratitude.statusYourTurn', { time: clock }) : t('games.gratitude.statusTheirTurn', { name: nameOf(game.turn), time: clock });
  } else if (game.status === 'finished') {
    const reason = game.endReason === 'gave_up' ? t('games.gratitude.endGaveUp') : t('games.gratitude.endTimeout');
    status = game.winner?.address === wallet
      ? t('games.gratitude.statusYouWon', { reason, n: formatCount(game.lineCount) })
      : t('games.gratitude.statusTheyWon', { name: nameOf(game.winner), reason, n: formatCount(game.lineCount) });
  } else {
    status = t('games.gratitude.statusClosed');
  }

  return (
    <View>
      <PageSection>
        <View style={styles.head}>
          <Avatar uri={opponent?.avatarImageUrl} size={36} name={nameOf(opponent).replace('@', '')} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text className="text-theme-neutrals-100" style={styles.rowTitle} numberOfLines={1}>{opponent ? nameOf(opponent) : t('games.gratitude.anyone')}</Text>
            <Text style={styles.sub}>{t('games.gratitude.daysEach', { days: game.daysPerTurn })}</Text>
          </View>
          {game.status === 'active' ? (
            <TurnPill hot={game.yourTurn} label={game.yourTurn ? t('games.gratitude.chipYourTurn', { time: clock }) : t('games.gratitude.chipTheirTurn', { time: clock })} />
          ) : null}
        </View>

        <View style={{ gap: 10, marginTop: 14 }}>
          {!lines.length ? (
            <Text style={[styles.sub, { textAlign: 'center', paddingVertical: 24 }]}>
              {game.status === 'active'
                ? (game.yourTurn ? t('games.gratitude.emptyYou') : t('games.gratitude.emptyThem', { name: nameOf(game.turn) }))
                : status}
            </Text>
          ) : null}
          {lines.map((line) => {
            const mine = line.by === wallet;
            const author = game.players.find((p) => p.address === line.by);
            return (
              <View key={line.n} style={[styles.line, mine ? { alignSelf: 'flex-end', flexDirection: 'row-reverse' } : { alignSelf: 'flex-start' }]}>
                <Avatar uri={author?.avatarImageUrl} size={26} name={nameOf(author).replace('@', '')} />
                <View style={{ flexShrink: 1 }}>
                  <View style={[styles.bubble, { backgroundColor: mine ? `rgba(${accent},0.22)` : 'hsla(0, 0%, 100%, 0.06)' }]}>
                    <Text style={styles.lineMeta}>#{line.n} · {mine ? t('games.gratitude.you') : nameOf(author)}</Text>
                    <Text className="text-theme-neutrals-100" style={styles.lineText}>{line.text}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {playing && game.yourTurn ? (
          <View style={{ marginTop: 14, gap: 8 }}>
            {hint?.message ? (
              <View style={[styles.hint, { borderColor: `rgba(${accent},1)` }]}>
                <Text style={styles.hintText}>{hint.message}</Text>
              </View>
            ) : null}
            <View style={styles.composer}>
              <TextInput
                value={text}
                onChangeText={(v) => setText(v.slice(0, game.maxChars))}
                placeholder={t('games.gratitude.placeholder')}
                placeholderTextColor={MUTED}
                multiline
                style={styles.input}
                accessibilityLabel={t('games.gratitude.placeholder')}
              />
              <Pressable onPress={() => void send()} disabled={busy || !text.trim()} accessibilityRole="button" accessibilityLabel={t('games.gratitude.send')}>
                <View style={[styles.send, { opacity: busy || !text.trim() ? 0.4 : 1 }]}>
                  {busy ? <ActivityIndicator size="small" color="hsla(240, 6%, 5%, 1)" /> : <Icon name="ArrowUp" size={18} color="hsla(240, 6%, 5%, 1)" />}
                </View>
              </Pressable>
            </View>
          </View>
        ) : null}
      </PageSection>

      <PageSection>
        <Text className="text-theme-neutrals-100" style={styles.status}>{status}</Text>
        <Text style={styles.sub}>{t('games.gratitude.lineCount', { n: formatCount(game.lineCount) })}</Text>
        <View style={styles.actions}>
          {canAccept ? (
            <>
              <ActionButton tone="primary" label={t('games.gratitude.accept')} disabled={busy} onPress={() => void run(() => gratitudeAction(id, 'accept'))} />
              {game.invitee?.address === wallet ? (
                <ActionButton label={t('games.gratitude.decline')} disabled={busy} onPress={() => void run(() => gratitudeAction(id, 'decline'))} />
              ) : null}
            </>
          ) : null}
          {canCancel ? <ActionButton label={t('games.gratitude.cancel')} disabled={busy} onPress={() => void run(() => gratitudeAction(id, 'decline'))} /> : null}
          {canCancel && !game.invitee ? (
            <ActionButton
              icon="Share2"
              label={t('games.gratitude.shareInvite')}
              onPress={() => void shareWithRef({ url: `${PAGE_URL}?game=${id}`, message: `${t('games.gratitude.title')} ${PAGE_URL}?game=${id}` }).catch(() => undefined)}
            />
          ) : null}
          {playing ? (
            <ActionButton
              tone="danger"
              icon="Flag"
              label={t('games.gratitude.giveUp')}
              disabled={busy}
              onPress={() => Alert.alert(t('games.gratitude.giveUpConfirm', { name: nameOf(opponent) }), undefined, [
                { text: t('games.gratitude.keepGoing'), style: 'cancel' },
                { text: t('games.gratitude.giveUp'), style: 'destructive', onPress: () => void run(() => gratitudeAction(id, 'give-up')) },
              ])}
            />
          ) : null}
        </View>
        {game.status === 'active' ? <Text style={[styles.sub, { marginTop: 12 }]}>{t('games.gratitude.pushNote')}</Text> : null}
      </PageSection>

      <Rules />
    </View>
  );
}

// --------------------------------------------------------------- the lobby

function GameRow({ game, wallet, onOpen }: { game: GratitudeGame; wallet: string; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const opponent = game.players.find((p) => p.address !== wallet) ?? (game.createdBy?.address === wallet ? game.invitee : game.createdBy);
  let note = '';
  let hot = false;
  if (game.status === 'active') {
    hot = game.yourTurn;
    note = game.yourTurn ? t('games.gratitude.rowYourTurn') : t('games.gratitude.rowTheirTurn');
  } else if (game.status === 'pending') {
    hot = game.createdBy?.address !== wallet;
    note = hot ? t('games.gratitude.rowInvite') : t('games.gratitude.rowSent');
  } else if (game.status === 'finished') {
    note = game.winner?.address === wallet ? t('games.gratitude.rowWon') : t('games.gratitude.rowLost');
  } else {
    note = t('games.gratitude.rowClosed');
  }
  return (
    <Pressable onPress={() => onOpen(game.id)} accessibilityRole="button" style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <View style={styles.row}>
        <Avatar uri={opponent?.avatarImageUrl} size={36} name={nameOf(opponent).replace('@', '')} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-theme-neutrals-100" style={styles.rowTitle} numberOfLines={1}>{opponent ? nameOf(opponent) : t('games.gratitude.anyone')}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {game.lastLine ? `#${formatCount(game.lineCount)} ${game.lastLine.text}` : t('games.gratitude.daysEach', { days: game.daysPerTurn })}
          </Text>
        </View>
        <TurnPill hot={hot} label={note} />
      </View>
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
      <View style={[styles.choice, { backgroundColor: active ? INK : FILL }]}>
        <Text style={[styles.choiceText, { color: active ? 'hsla(240, 6%, 5%, 1)' : 'hsla(240, 5%, 84%, 1)' }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function Lobby({ wallet, onOpen }: { wallet: string; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [opponent, setOpponent] = useState('');
  const [days, setDays] = useState(2);
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['gratitude-list', wallet], queryFn: gratitudeList, refetchInterval: 30_000 });

  const create = async () => {
    setBusy(true);
    try {
      const { game } = await gratitudeCreate({ opponent: opponent.trim() || undefined, days });
      toastSuccess(opponent.trim() ? t('games.gratitude.sent') : t('games.gratitude.openPosted'));
      setOpponent('');
      void queryClient.invalidateQueries({ queryKey: ['gratitude-list'] });
      onOpen(game.id);
    } catch (e) {
      toastError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const games = data?.games ?? [];
  const sections: Array<[string, GratitudeGame[]]> = [
    [t('games.gratitude.yourTurn'), games.filter((g) => g.status === 'active' && g.yourTurn)],
    [t('games.gratitude.invites'), games.filter((g) => g.status === 'pending')],
    [t('games.gratitude.waitingOnThem'), games.filter((g) => g.status === 'active' && !g.yourTurn)],
    [t('games.gratitude.openInvites'), data?.open ?? []],
    [t('games.gratitude.finished'), games.filter((g) => !['active', 'pending'].includes(g.status)).slice(0, 15)],
  ];

  return (
    <View>
      <PageSection title={t('games.gratitude.newGame')}>
        <TextInput
          value={opponent}
          onChangeText={setOpponent}
          placeholder={t('games.gratitude.opponentPlaceholder')}
          placeholderTextColor={MUTED}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.field}
        />
        <Text style={styles.label}>{t('games.gratitude.daysLabel')}</Text>
        <View style={styles.chips}>
          {DAY_CHOICES.map((d) => <Chip key={d} label={t('games.gratitude.dayChip', { days: d })} active={days === d} onPress={() => setDays(d)} />)}
        </View>
        <KitButton
          style={{ marginTop: 14 }}
          disabled={busy}
          onPress={() => void create()}
          label={opponent.trim() ? t('games.gratitude.sendInvite') : t('games.gratitude.postOpen')}
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
      {!isLoading && !games.length && !(data?.open ?? []).length ? <PageEmpty title={t('games.gratitude.empty')} /> : null}
      <Rules />
    </View>
  );
}

const GratitudeScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const wallet = (user?.walletAddress || user?.address)?.toLowerCase() ?? null;
  const gameId: string | undefined = route.params?.game;
  const open = useCallback((id: string) => navigation.push(ScreenNames.Gratitude, { game: id }), [navigation]);

  return (
    <View className="bg-theme-background" style={{ flex: 1 }}>
      <ScreenHeader title={t('games.gratitude.title')} icon="arcade" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {!gameId ? <Text style={styles.intro}>{t('games.gratitude.intro')}</Text> : null}
          {gameId ? (
            <GameView id={gameId} wallet={wallet} />
          ) : wallet ? (
            <Lobby wallet={wallet} onOpen={open} />
          ) : (
            <>
              <PageEmpty
                icon={<Icon name="Heart" size={40} color={SOFT} />}
                title={t('games.signInToPlay')}
                action={<KitButton label={t('games.signIn')} onPress={() => navigation.navigate(ScreenNames.SignIn)} />}
              />
              <Rules />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  intro: { color: SOFT, fontSize: 12, lineHeight: 18, paddingHorizontal: 16, paddingBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  status: { fontSize: 14, fontWeight: '600' },
  sub: { color: MUTED, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  actionLabel: { fontSize: 12, fontWeight: '600' },
  line: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '88%' },
  bubble: { borderRadius: 18, paddingHorizontal: 13, paddingVertical: 10, borderWidth: 1, borderColor: 'hsla(0, 0%, 100%, 0.08)' },
  lineMeta: { color: SOFT, fontSize: 10, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  lineText: { fontSize: 15, lineHeight: 20, marginTop: 2 },
  hint: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'hsla(0, 0%, 100%, 0.05)' },
  hintText: { color: 'hsla(240, 5%, 88%, 1)', fontSize: 13, lineHeight: 18 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, borderRadius: 24, paddingLeft: 14, padding: 6, backgroundColor: 'hsla(0, 0%, 100%, 0.06)', borderWidth: 1, borderColor: 'hsla(0, 0%, 100%, 0.1)' },
  input: { flex: 1, minHeight: 38, maxHeight: 120, paddingVertical: 9, fontSize: 15, color: INK },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: INK },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 11, fontWeight: '600' },
  field: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: INK, backgroundColor: FILL },
  label: { color: MUTED, fontSize: 12, marginTop: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  choiceText: { fontSize: 12, fontWeight: '600' },
  rule: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  ruleNum: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsla(0, 0%, 100%, 0.1)' },
  ruleNumText: { color: INK, fontSize: 11, fontWeight: '700' },
  ruleText: { flex: 1, color: 'hsla(240, 5%, 84%, 1)', fontSize: 13, lineHeight: 18 },
});

export default GratitudeScreen;
