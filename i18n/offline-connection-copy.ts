import { normalizeLanguageCode } from './language-code';
import bundledCopy from './offline-connection-copy.json';

type OfflineCopy = typeof bundledCopy.en;
const copyByLanguage: Record<string, OfflineCopy> = bundledCopy;

/** Bundled from the mobile locale files so this screen can open without a pack. */
export function offlineConnectionCopy(language: string): OfflineCopy {
  const code = normalizeLanguageCode(language);
  return Object.prototype.hasOwnProperty.call(copyByLanguage, code) ? copyByLanguage[code] : bundledCopy.en;
}
