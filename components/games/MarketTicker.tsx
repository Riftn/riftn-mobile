/**
 * BTC, ETH and gold (per ounce) in USD at the top of the Money menu group.
 * Prices are money, so they stay exact rather than 1.2K style. Hidden when the
 * price source is down instead of showing an empty strip.
 * Web twin: riftn-web src/components/app/navigation/MarketTicker.tsx.
 */
import React, { useContext } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { marketTicker } from '../../services/games.service';

/** "$97,412" or "$4.21": plain grouping, no Intl dependency. */
function usd(price: number): string {
  const digits = price < 10 ? 2 : 0;
  const [whole, frac] = price.toFixed(digits).split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
}

/** Drawn only under the app's query client (the drawer also renders in tests without one). */
export default function MarketTicker() {
  return useContext(QueryClientContext) ? <Ticker /> : null;
}

function Ticker() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['market-ticker'],
    queryFn: marketTicker,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  if (!data?.items?.length) return null;
  return (
    <View style={styles.row} accessibilityLabel={t('games.markets.label')}>
      {data.items.map((item) => {
        const up = (item.change24h ?? 0) >= 0;
        return (
          <View key={item.id} style={styles.cell}>
            <Text style={styles.label} numberOfLines={1}>{item.id === 'gold' ? t('games.markets.gold') : item.label}</Text>
            <View style={styles.line}>
              <Text style={styles.price} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{usd(item.price)}</Text>
              {item.change24h !== null ? (
                <Text style={[styles.change, { color: up ? 'hsla(152, 69%, 53%, 1)' : 'hsla(0, 91%, 71%, 1)' }]}>
                  {up ? '▲' : '▼'}{Math.abs(item.change24h).toFixed(1)}%
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  cell: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: 'hsla(0, 0%, 100%, 0.06)',
    borderWidth: 1,
    borderColor: 'hsla(0, 0%, 100%, 0.08)',
  },
  label: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', color: 'hsla(240, 5%, 65%, 1)' },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  price: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: 'hsla(0, 0%, 100%, 1)', fontVariant: ['tabular-nums'] },
  change: { fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
