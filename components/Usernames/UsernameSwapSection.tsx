import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KitButton, PageSection } from '../page/PageKit';
import { usernameMarketService } from '../../services/username-market.service';
import { useAuthActions, useUser } from '../../context/AuthContext';
import { toastError, toastSuccess } from '../../libs';

/**
 * Swap usernames with another account you own, in one step. Start it here,
 * then switch to the other account and accept: the names change places at the
 * same moment, so neither is ever free for someone else to take.
 */
export function UsernameSwapSection() {
  const { t } = useTranslation();
  const user = useUser();
  const { refreshUser } = useAuthActions();
  const client = useQueryClient();
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const swaps = useQuery({
    queryKey: ['username-swaps', user?.username],
    queryFn: () => usernameMarketService.getSwaps(),
    enabled: !!user,
    refetchInterval: 15_000,
  });
  if (!user) return null;

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toastSuccess(done);
      await swaps.refetch();
    } catch (err: any) {
      toastError(err?.message || t('common.tryAgain'));
    } finally {
      setBusy(null);
    }
  };

  const incoming = swaps.data?.incoming ?? [];
  const outgoing = swaps.data?.outgoing ?? [];

  return (
    <PageSection>
      <View style={styles.wrap}>
        <Text style={styles.title}>{t('usernames.swap.title')}</Text>
        <Text style={styles.body}>{t('usernames.swap.body')}</Text>

        {incoming.map((s) => (
          <View key={s.id} style={styles.box}>
            <Text style={styles.line}>{t('usernames.swap.incoming', { from: s.fromUsername, to: s.toUsername })}</Text>
            <View style={styles.buttons}>
              <KitButton
                label={busy === `a${s.id}` ? '…' : t('usernames.swap.accept')}
                disabled={!!busy}
                onPress={() => run(`a${s.id}`, async () => {
                  await usernameMarketService.acceptSwap(s.id);
                  await refreshUser().catch(() => {});
                  void client.invalidateQueries();
                }, t('usernames.swap.done', { name: s.fromUsername }))}
              />
              <KitButton
                variant="quiet"
                label={t('usernames.swap.decline')}
                disabled={!!busy}
                onPress={() => run(`d${s.id}`, () => usernameMarketService.cancelSwap(s.id))}
              />
            </View>
          </View>
        ))}

        {outgoing.map((s) => (
          <View key={s.id} style={styles.box}>
            <Text style={styles.line}>{t('usernames.swap.waiting', { to: s.toUsername })}</Text>
            <View style={styles.buttons}>
              <KitButton
                variant="quiet"
                label={t('common.cancel')}
                disabled={!!busy}
                onPress={() => run(`c${s.id}`, () => usernameMarketService.cancelSwap(s.id))}
              />
            </View>
          </View>
        ))}

        {!outgoing.length && (
          <View style={styles.form}>
            <TextInput
              value={other}
              onChangeText={setOther}
              placeholder={t('usernames.swap.placeholder')}
              placeholderTextColor="hsla(240, 4%, 52%, 1)"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            {busy === 'req' ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <KitButton
                label={t('usernames.swap.start')}
                disabled={!!busy || !other.trim()}
                onPress={() => {
                  const name = other.trim();
                  void run('req', async () => {
                    await usernameMarketService.requestSwap(name);
                    setOther('');
                  }, t('usernames.swap.sent', { name: name.replace(/^@/, '') }));
                }}
              />
            )}
          </View>
        )}
      </View>
    </PageSection>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  body: { color: 'hsla(240, 4%, 52%, 1)', fontSize: 12, lineHeight: 17 },
  box: { gap: 8, paddingVertical: 6 },
  line: { color: '#FFFFFF', fontSize: 14, lineHeight: 19 },
  buttons: { flexDirection: 'row', gap: 8 },
  form: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'hsla(0, 0%, 100%, 0.12)',
    backgroundColor: 'hsla(0, 0%, 100%, 0.05)',
  },
});
