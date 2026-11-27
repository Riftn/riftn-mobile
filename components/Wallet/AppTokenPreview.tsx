import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from '../ui/Icon';
import { KitButton } from '../page/PageKit';
import { useAppTokenPreview } from '../../hooks/useAppTokens';

const format = (value: string) => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 6 })} RIFT`;

export function AppTokenPreview() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data, isError, isFetching, refetch } = useAppTokenPreview(open);
  const title = t('appTokens.previewTitle', '$RIFT off-chain preview');
  const readOnly = t('appTokens.previewReadOnly', 'Read only');

  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={readOnly} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.trigger}>
        <View style={styles.label}>
          <Text style={styles.heading}>{title}</Text>
          <Text style={styles.muted}>{readOnly}</Text>
        </View>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} color="#aaa" />
      </Pressable>
      {open && <View style={styles.content}>
        <Text style={styles.muted}>{t('appTokens.previewExplanation', 'Credit amounts show past activity and are already reflected in your in-app balance.')}</Text>
        {isError && <View style={styles.line}>
          <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('appTokens.previewUnavailable', 'RIFT preview unavailable.')}</Text>
          <KitButton label={t('common.retry')} variant="quiet" disabled={isFetching} onPress={() => void refetch()} />
        </View>}
        {!data && !isError && <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('common.loading')}</Text>}
        {data && !isError && <>
          <View style={styles.line}>
            <Text style={styles.labelText}>{t('appTokens.previewBalance', 'Available in-app balance')}</Text>
            <Text style={styles.heading}>{format(data.balance)}</Text>
          </View>
          <View style={styles.credits}>
            <Text style={styles.heading}>{t('appTokens.previewCredits', 'Recent transfers received and account credits')}</Text>
            {data.credits.length ? data.credits.map((entry, index) => {
              const sender = entry.counterparty;
              const who = sender?.username ? `@${sender.username}` : sender?.address;
              return (
                <View key={`${entry.at}-${index}`} style={[styles.line, styles.credit]}>
                  <View style={styles.label}>
                    <Text style={styles.labelText}>
                      {entry.kind === 'adjust' ? t('appTokens.previewAccountCredit', 'Account credit')
                        : who ? t('appTokens.previewReceivedFrom', { defaultValue: 'Received from {{name}}', name: who })
                          : t('appTokens.previewReceived', 'Transfer received')}
                    </Text>
                    <Text style={styles.muted}>{new Date(entry.at).toLocaleDateString()}</Text>
                  </View>
                  <Text style={styles.labelText}>+{format(entry.amount)}</Text>
                </View>
              );
            }) : <Text style={styles.muted}>{t('appTokens.previewNoCredits', 'No recent transfers or account credits.')}</Text>}
          </View>
        </>}
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff22', borderRadius: 12, backgroundColor: '#ffffff0c' },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  label: { flex: 1, minWidth: 0 },
  heading: { color: '#fff', fontSize: 14, fontWeight: '600' },
  muted: { color: '#aaa', fontSize: 12 },
  labelText: { color: '#ddd', fontSize: 14, flexShrink: 1 },
  content: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff22', padding: 12, gap: 12 },
  line: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12 },
  credits: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff22', paddingTop: 12, gap: 4 },
  credit: { paddingVertical: 6 },
});
