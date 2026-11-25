/** Match content and interface language codes while keeping Traditional Chinese distinct. */
export function normalizeLanguageCode(language: string): string {
  const tag = language.toLowerCase().replace(/_/g, '-');
  if (/^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(tag)) return 'zh_tw';
  return tag.split('-')[0];
}
