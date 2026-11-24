/**
 * The main language of a country, for the first-run language step.
 *
 * A phone set to English in Türkiye still means a Turkish reader most of the
 * time, so setup starts on the country's language and the reader confirms or
 * changes it. Only countries with one clear main language the app ships are
 * listed: countries where English is official, or several languages share
 * the role (Switzerland, Belgium, India, Nigeria...), are left out so setup
 * stays on the phone's language there.
 */
const COUNTRY_LANGUAGE: Record<string, string> = {
  // Europe
  TR: 'tr', DE: 'de', AT: 'de', LI: 'de', FR: 'fr', MC: 'fr', ES: 'es', PT: 'pt', IT: 'it', SM: 'it',
  NL: 'nl', PL: 'pl', RU: 'ru', UA: 'uk', BY: 'be', GR: 'el', CY: 'el', BG: 'bg', RO: 'ro', MD: 'ro',
  CZ: 'cs', SK: 'sk', HU: 'hu', HR: 'hr', RS: 'sr', SE: 'sv', NO: 'no', DK: 'da', FI: 'fi', EE: 'et',
  LV: 'lv', LT: 'lt', AL: 'sq', XK: 'sq',
  // Americas
  MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', VE: 'es', EC: 'es', GT: 'es', CU: 'es', BO: 'es',
  DO: 'es', HN: 'es', PY: 'es', SV: 'es', NI: 'es', CR: 'es', PA: 'es', UY: 'es', BR: 'pt',
  // Middle East and North Africa
  SA: 'ar', AE: 'ar', EG: 'ar', IQ: 'ar', JO: 'ar', KW: 'ar', QA: 'ar', BH: 'ar', OM: 'ar', YE: 'ar',
  SY: 'ar', LB: 'ar', LY: 'ar', SD: 'ar', DZ: 'ar', MA: 'ar', TN: 'ar', PS: 'ar', IR: 'fa', IL: 'he',
  // Asia
  JP: 'ja', KR: 'ko', CN: 'zh', TW: 'zh', VN: 'vi', TH: 'th', ID: 'id', MY: 'ms', BN: 'ms', PK: 'ur',
  BD: 'bn', NP: 'ne', MM: 'my', KH: 'km', LA: 'lo', MN: 'mn', KZ: 'kk', UZ: 'uz', AZ: 'az', GE: 'ka',
  AM: 'hy', KG: 'ky', TJ: 'tg', TM: 'tk',
  // Africa
  AO: 'pt', MZ: 'pt', ET: 'am', SO: 'so', TZ: 'sw', ER: 'ti',
};

/** The main language for a two-letter country code, or null when there isn't one clear choice. */
export function languageForCountry(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRY_LANGUAGE[country.toUpperCase()] ?? null;
}
