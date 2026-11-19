/**
 * Moving versions of the common chat reactions: Google's Noto Animated Emoji
 * (CC BY 4.0), 64px animated WebP served by the web app at
 * /emoji/animated/chat/<codepoint>.webp (riftn-web public/emoji/animated/chat).
 * Loaded from there rather than bundled, so the app stays small; expo-image
 * caches each file after its first play. Same list as web
 * src/lib/chat-reaction-motion.ts.
 */
const ORIGIN = 'https://riftn.com';

/** Codepoint -> length of one loop in ms (capped). */
const ANIMATED: Record<string, number> = {
  '1f308': 1810, '1f31a': 2890, '1f37f': 2290, '1f389': 1270, '1f38a': 2170, '1f3af': 2110, '1f3c6': 2050, '1f410': 1870, '1f440': 1360, '1f44b': 1390, '1f44c': 820, '1f44d': 730, '1f44e': 790, '1f44f': 670, '1f47b': 2140, '1f47d': 2740, '1f480': 3600, '1f48e': 1210, '1f494': 2980, '1f496': 910, '1f499': 1660, '1f49a': 1660, '1f49b': 1660, '1f49c': 1660, '1f4a5': 1150, '1f4a9': 2170, '1f4aa': 1420, '1f4af': 1360, '1f4b8': 730, '1f525': 1000, '1f5a4': 1660, '1f600': 2110, '1f601': 2350, '1f602': 1780, '1f605': 1810, '1f606': 2800, '1f607': 2950, '1f608': 3160, '1f609': 1750, '1f60a': 2200, '1f60b': 1300, '1f60d': 1540, '1f60e': 2080, '1f60f': 1540, '1f610': 2260, '1f618': 1600, '1f61c': 1420, '1f621': 2710, '1f622': 1660, '1f624': 1360, '1f62c': 2380, '1f62d': 1810, '1f62e': 2020, '1f631': 1540, '1f633': 1810, '1f634': 1810, '1f636_200d_1f32b_fe0f': 2590, '1f643': 1390, '1f644': 2860, '1f64c': 1420, '1f64f': 760, '1f680': 610, '1f90c': 1930, '1f913': 2710, '1f914': 1810, '1f916': 2470, '1f917': 1600, '1f919': 2320, '1f91d': 1090, '1f91e': 1690, '1f920': 1360, '1f921': 1870, '1f922': 2290, '1f923': 910, '1f924': 1960, '1f928': 1150, '1f929': 1810, '1f92a': 1660, '1f92c': 2260, '1f92d': 1630, '1f92e': 3490, '1f92f': 2500, '1f970': 1480, '1f973': 1630, '1f975': 1270, '1f976': 1840, '1f97a': 3100, '1f9e1': 1660, '1fae0': 3460, '1fae1': 1810, '1fae3': 3490, '1faf6': 1300, '26a1': 1270, '270a': 1210, '270c_fe0f': 1660, '2728': 1840, '2764_fe0f': 1690, '2764_fe0f_200d_1f525': 910, '2b50': 2200,
};

function codepoint(emoji: string): string | null {
  const cps = Array.from(emoji).map((c) => c.codePointAt(0)!.toString(16));
  const tries = [cps.join('_'), cps.filter((c) => c !== 'fe0f').join('_'), `${cps.join('_')}_fe0f`];
  return tries.find((t) => t in ANIMATED) ?? null;
}

export function animatedChatEmoji(emoji: string): { uri: string; ms: number } | null {
  const cp = codepoint(emoji);
  return cp ? { uri: `${ORIGIN}/emoji/animated/chat/${cp}.webp`, ms: ANIMATED[cp] } : null;
}
