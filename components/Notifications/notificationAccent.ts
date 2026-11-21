export function notificationAccentFill(accent: readonly number[]): string {
  // Lift theme tints so dark action labels stay readable even on dark accents.
  const channels = accent.map(channel => Math.round((channel + 255) / 2));
  return `rgb(${channels.join(',')})`;
}
