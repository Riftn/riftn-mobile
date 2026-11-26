import type { MonetizationState } from '../components/Upload/MonetizationPanel';

/** Blank and zero both leave the preview off. */
export function parsePpvPreviewSeconds(value: string | undefined): number | null {
  const input = value?.trim();
  if (!input) return 0;
  if (!/^\d{1,2}$/.test(input)) return null;
  const seconds = Number(input);
  return seconds <= 30 ? seconds : null;
}

export function canConfigurePpvPreview(
  hasVideo: boolean,
  restricted: boolean,
  { bountyEnabled, tokenGatedEnabled, subscribersEnabled }: MonetizationState,
): boolean {
  return hasVideo && !restricted && !bountyEnabled && !tokenGatedEnabled && !subscribersEnabled;
}
