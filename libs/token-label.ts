import i18n from 'i18next';
import { isDhbSymbol } from './dhb-symbols';

/** Display wording only; callers keep the original symbol for settlement. */
export function tokenLabel(symbol?: string | null): string {
  if (symbol?.trim() && !isDhbSymbol(symbol)) return symbol;
  return i18n.t('tip.tokensUnit', { defaultValue: 'tokens' }) || 'tokens';
}
