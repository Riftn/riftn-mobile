/** Matches riftn-web's chat embed snippet. */
export function chatEmbedCode(slug?: string): string {
  const path = slug ? `/chat/embed/${encodeURIComponent(slug)}` : '/chat/embed';
  return `<iframe src="https://riftn.com${path}" title="Riftn Chat" width="480" height="560" style="max-width: 100%; border: 0" loading="lazy" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe>`;
}
