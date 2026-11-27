import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import { useTranslation } from 'react-i18next';
import ScreenHeader from '../components/ScreenHeader';
import { PageTabs } from '../components/page/PageKit';
import PrimaryButton from '../components/ui/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { DarkRoomProvider, useAppTheme } from '../context/ThemeContext';
import { SPLURGE_ITEM_LIMIT, useSplurge, type SplurgeMode } from '../hooks/use-splurge';
import { formatSplurgeAmount, splurgeCurrency } from '../libs/splurge-currency';
import { ScreenNames } from '../navigation/ScreenNames';
import type { AppStackParamList } from '../navigation/types';
import { FIELD_TEXT } from '../theme/inputs';

const CRT = {
  background: '#21160f',
  foreground: '#ffca82',
  mutedForeground: '#e7ba86',
  border: '#785632',
  field: '#1a120c',
  fieldBorder: '#916239',
};

function SplurgeGame({ address }: { address: string | null }) {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { pageColors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const region = getLocales()[0];
  const locale = region?.languageTag ?? 'en-US';
  const currency = splurgeCurrency(locale, region?.regionCode);
  const game = useSplurge(address, currency, randomUUID);
  const { history } = game;
  const crt = game.mode === 'crt';
  const tone = crt ? CRT : pageColors;
  const mono = crt ? styles.mono : undefined;
  const [focused, setFocused] = useState(false);
  const money = (amount: number, code = currency) => formatSplurgeAmount(amount, code, locale);
  const historyLoading = !!address && history.isPending;
  const historyError = !!address && history.isError && !history.data;
  const submit = () => void game.submit();
  const modes: { id: SplurgeMode; label: string }[] = [
    { id: 'modern', label: t('games.splurge.modern') },
    { id: 'crt', label: t('games.splurge.crt') },
  ];

  const play = (
    <View style={[
      styles.play,
      { borderColor: tone.border },
      crt && styles.crt,
    ]}>
      <Text style={[styles.caption, mono, { color: tone.mutedForeground }]}>{t('games.splurge.budget')}</Text>
      <Text accessibilityLiveRegion="polite" style={[styles.amount, mono, { color: tone.foreground }]}>{money(game.amount)}</Text>
      <Text style={[styles.prompt, mono, { color: tone.foreground }]}>{t('games.splurge.prompt')}</Text>
      <TextInput
        value={game.item}
        maxLength={SPLURGE_ITEM_LIMIT}
        accessibilityLabel={t('games.splurge.prompt')}
        placeholder={t('games.splurge.placeholder')}
        placeholderTextColor={tone.mutedForeground}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChangeText={text => {
          if (!game.saving && !game.saveError) game.setItem(text);
        }}
        onSubmitEditing={submit}
        submitBehavior="submit"
        returnKeyType="go"
        style={[
          styles.field, mono,
          {
            color: tone.foreground,
            backgroundColor: crt ? CRT.field : pageColors.background,
            borderColor: focused ? tone.foreground : crt ? CRT.fieldBorder : pageColors.accentSecondary,
            borderWidth: focused ? 2 : 1,
          },
        ]}
      />
      <PrimaryButton
        title={game.saveError ? t('games.splurge.retry') : t('games.splurge.spend')}
        onPress={submit}
        disabled={!game.canSubmit}
        loading={game.saving}
        large
      />
      {game.saveError && (
        <Text accessibilityRole="alert" style={[styles.caption, mono, { color: tone.foreground }]}>{t('games.splurge.saveError')}</Text>
      )}

      <View style={[styles.history, { borderColor: tone.border }]}>
        <Text accessibilityRole="header" style={[styles.heading, mono, { color: tone.foreground }]}>{t('games.splurge.history')}</Text>
        {historyLoading && <Text accessibilityLiveRegion="polite" style={[styles.caption, mono, { color: tone.mutedForeground }]}>{t('games.splurge.loading')}</Text>}
        {historyError && (
          <>
            <Text accessibilityRole="alert" style={[styles.caption, mono, { color: tone.foreground }]}>{t('games.splurge.historyError')}</Text>
            <PrimaryButton title={t('games.splurge.retry')} onPress={() => void history.refetch()} neutral large />
          </>
        )}
        {!historyLoading && !historyError && game.entries.length === 0 &&
          <Text style={[styles.caption, mono, { color: tone.mutedForeground }]}>{t('games.splurge.empty')}</Text>}
        {game.entries.map(entry => (
          <View key={entry.turnId} style={[styles.entry, { borderColor: tone.border }]}>
            <Text style={[styles.entryItem, mono, { color: tone.foreground }]}>{entry.item}</Text>
            <Text style={[styles.entryAmount, mono, { color: tone.foreground }]}>{money(entry.amount, entry.currency)}</Text>
          </View>
        ))}
        {history.isFetchNextPageError &&
          <Text accessibilityRole="alert" style={[styles.caption, mono, { color: tone.foreground }]}>{t('games.splurge.historyError')}</Text>}
        {history.hasNextPage &&
          <PrimaryButton
            title={history.isFetchNextPageError ? t('games.splurge.retry') : t('games.splurge.more')}
            onPress={() => void history.fetchNextPage()}
            loading={history.isFetchingNextPage}
            neutral
            large
          />}
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={[styles.caption, { color: pageColors.mutedForeground }]}>{t('games.splurge.intro')}</Text>
        <PageTabs<SplurgeMode> tabs={modes} value={game.mode} onChange={game.setMode} style={styles.tabs} />
        {crt ? <DarkRoomProvider>{play}</DarkRoomProvider> : play}
        {!address && (
          <View style={styles.guest}>
            <Text style={[styles.caption, { color: pageColors.mutedForeground }]}>{t('games.splurge.guest')}</Text>
            <PrimaryButton title={t('games.signIn')} onPress={() => navigation.navigate(ScreenNames.SignIn)} neutral large />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function SplurgeScreen() {
  const { t } = useTranslation();
  const { user, isSignedIn, isBootLoading, isLoading } = useAuth();
  const { pageColors } = useAppTheme();
  const address = isSignedIn ? (user?.walletAddress || user?.address)?.toLowerCase() ?? null : null;
  return (
    <View className="flex-1 bg-theme-background">
      <ScreenHeader title={t('games.splurge.title')} icon="arcade" />
      {isBootLoading || isLoading ? (
        <Text accessibilityLiveRegion="polite" style={[styles.loading, { color: pageColors.mutedForeground }]}>{t('games.splurge.loading')}</Text>
      ) : <SplurgeGame key={address ?? 'guest'} address={address} />}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { width: '100%', maxWidth: 660, alignSelf: 'center', paddingHorizontal: 16, gap: 12 },
  tabs: { paddingHorizontal: 0, minHeight: 44 },
  play: { paddingVertical: 18, gap: 8, borderTopWidth: 1, borderBottomWidth: 1 },
  crt: {
    paddingHorizontal: 16, paddingVertical: 18, backgroundColor: CRT.background,
    borderWidth: 1, borderRadius: 22,
  },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  caption: { fontSize: 14, lineHeight: 20 },
  amount: { fontSize: 46, fontWeight: '600', fontVariant: ['tabular-nums'], marginBottom: 12 },
  prompt: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  field: {
    ...FIELD_TEXT, minHeight: 48, paddingHorizontal: 12, fontSize: 16,
    borderRadius: 12,
  },
  history: { borderTopWidth: 1, marginTop: 12, paddingTop: 14, gap: 8 },
  heading: { fontSize: 15, fontWeight: '600' },
  entry: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderBottomWidth: 1, paddingVertical: 8 },
  entryItem: { flex: 1, fontSize: 14, lineHeight: 20, writingDirection: 'auto' },
  entryAmount: { flexShrink: 0, fontSize: 14, lineHeight: 20, fontVariant: ['tabular-nums'] },
  guest: { gap: 8, alignItems: 'flex-start' },
  loading: { paddingHorizontal: 16, fontSize: 14 },
});
