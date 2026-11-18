/**
 * Plain helpers for group buy alerts and auto-mod, shared by the card, the
 * settings tab and tests. Same rules as web.
 */

/** One word or phrase per line or comma. */
export function parseBannedWords(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,]+/)) {
    const word = raw.trim().toLowerCase().slice(0, 60);
    if (word) seen.add(word);
  }
  return [...seen].slice(0, 500);
}

/** Block explorer per DexScreener chain id. */
const EXPLORERS: Record<string, string> = {
  base: "https://basescan.org",
  ethereum: "https://etherscan.io",
  bsc: "https://bscscan.com",
  arbitrum: "https://arbiscan.io",
  polygon: "https://polygonscan.com",
  optimism: "https://optimistic.etherscan.io",
  avalanche: "https://snowtrace.io",
};

export function buyAlertExplorer(chainId: string | undefined): string {
  return EXPLORERS[(chainId || "base").toLowerCase()] ?? EXPLORERS.base;
}

export function fmtPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
  const digits = Math.min(12, Math.max(2, 3 - Math.floor(Math.log10(n))));
  return `$${n.toFixed(digits)}`;
}
