import { translateCopy as _translateCopy } from '../i18n/copy';
import "@walletconnect/react-native-compat";
// Reown AppKit (WalletConnect) setup for the "Connect Wallet" sign-in option —
// lets a user authenticate with an EXTERNAL wallet app (MetaMask, Trust
// Wallet, Coinbase Wallet, Rainbow, ...) instead of Riftn provisioning one.
// Imported once, for its side effect (createAppKit), from index.ts.
//
// Side-effect imports for walletconnect & ethers shims are already loaded once in index.ts.
// Avoid duplicating them here to prevent multiple relayer/event listener registrations.
import {
  createAppKit,
  defaultConfig,
} from "@reown/appkit-ethers5-react-native";
import env from "./env";
import { appScheme, supportedNetworks } from "./web3.constants";
import { createLogger } from "../libs/logger";

const log = createLogger("reown.config");

export const projectId = env.REOWN_PROJECT_ID;

/**
 * Whether the "Connect Wallet" option is usable in this build.
 *
 * This module is a side-effect import from index.ts, which runs before
 * registerRootComponent — so anything it throws happens before React exists, let
 * alone the ErrorBoundary. A missing REOWN_PROJECT_ID (or a malformed
 * supportedNetworks) used to take the whole app down to a white screen with no
 * message, on a build where every other sign-in method would have worked fine.
 *
 * Connect Wallet is one of five sign-in options. Losing it is a degraded build;
 * losing boot is a dead one. Callers gate on this instead.
 */
export let isWalletConnectAvailable = false;

if (!projectId) {
  log.error(
    "REOWN_PROJECT_ID is missing — Connect Wallet will be unavailable in this build",
  );
}

export const metadata = {
  name: "Riftn.io",
  get description() { return _translateCopy("copy.273655f6d663", { defaultValue: "Riftn.io Mobile" }); },
  url: "https://dehub.io",
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
  redirect: {
    native: `${appScheme}://`,
    universal: "https://dehub.io",
  },
};

export const config = defaultConfig({ metadata });

// Wallets pinned to the top of the picker, in this order. The first four show
// on the opening screen; the rest lead the "All wallets" list, which also
// carries every other WalletConnect wallet and a search box.
//
// The picker used to be limited to these few with includeWalletIds, to mirror
// the web sign-in list. On a phone that left any other wallet with no way in:
// the only fallback is a QR code, which cannot be scanned when the wallet is
// on the same device.
//
// Left out on purpose: Phantom and Coinbase/Base Wallet. Neither is offered
// over WalletConnect on mobile (no deep link in the wallet directory), so a
// row for them could only fail.
const FEATURED_WALLET_IDS = [
  "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
  "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust Wallet
  "0b415a746fb9ee99cce155c2ceca0c6f6061b1dbca2d722b3ba16381d0562150", // SafePal
  "8a0ee50d1f22f6651afcae7eb4253e52a3310b90af5daef78a8c4929a9bb99d4", // Binance Wallet
  "971e689d0a5be527bac79629b4ee9b925e82208e5168b733496a09c0faed0709", // OKX Wallet
  "38f5d18bd8522c244bdd70cb4a68e0e718865155811c043f052fb9f1c51de662", // Bitget Wallet
  "20459438007b75f4f4acb98bf29aa3b800550309646d375da5fd4aac6c2a2c66", // TokenPocket
  "18388be9ac2d02726dbac9777c96efaac06d744b2f6d580fccdd4127a6d01fd1", // Rabby
  "ecc4036f814562b41a5268adc86270fba1365471402006302e70169465b7ac18", // Zerion
  "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369", // Rainbow
];

// The chains AppKit offers to connect on — must match this app's own
// supportedNetworks (config/web3.constants.ts), the same list every other
// signed-in flow (chain switcher, balances, contracts) uses. An earlier
// version of this file validated supportedNetworks and then discarded the
// result in favor of a hardcoded [Ethereum mainnet, Polygon] — chains the
// rest of the app has no contracts on — which would have offered a
// wallet-connect flow that could never actually complete a Riftn sign-in.
//
// Returns null rather than throwing, for the same reason as the projectId check
// above: this runs at module scope during boot, where a throw is a white screen.
function resolveChains() {
  if (!Array.isArray(supportedNetworks) || supportedNetworks.length === 0) {
    log.error("supportedNetworks is empty or invalid — cannot configure AppKit chains");
    return null;
  }
  for (let index = 0; index < supportedNetworks.length; index++) {
    const network = supportedNetworks[index];
    if (!network || typeof network !== "object") {
      log.error(`Invalid network at index ${index}: not an object`);
      return null;
    }
    if (!network.chainId || !network.name || !network.currency) {
      log.error(`Invalid network at index ${index}: missing required properties`);
      return null;
    }
  }
  return supportedNetworks.map((n) => ({
    chainId: n.chainId,
    name: n.name,
    currency: n.currency,
    explorerUrl: n.explorerUrl,
    rpcUrl: n.rpcUrl,
  }));
}

const chains = resolveChains();

// Guard against multiple inits on Fast Refresh / repeated imports.
const APPKIT_GLOBAL_KEY = "__REOWN_APPKIT_INITIALIZED__" as const;
const APPKIT_INSTANCE_KEY = "__REOWN_APPKIT_INSTANCE__" as const;

if (!projectId || !chains) {
  // Already logged above. Leaves isWalletConnectAvailable false, so App.tsx
  // skips <AppKit /> and the sign-in sheet hides the Connect Wallet button.
} else if (!(globalThis as any)[APPKIT_GLOBAL_KEY]) {
  try {
    const instance = createAppKit({
      projectId,
      metadata,
      chains,
      // New WalletConnect sessions start on BNB Chain.
      defaultChain: chains.find((c) => c.chainId === 56),
      config,
      enableAnalytics: false,
      featuredWalletIds: FEATURED_WALLET_IDS,
    });
    (globalThis as any)[APPKIT_GLOBAL_KEY] = true;
    (globalThis as any)[APPKIT_INSTANCE_KEY] = instance;
    isWalletConnectAvailable = true;
    log.info("AppKit initialized", { chainsCount: chains.length });
  } catch (e) {
    // createAppKit reaches the WalletConnect relay and the wallet explorer at
    // construction time. Whatever it dislikes, it must not be the reason the
    // app fails to start.
    log.error("AppKit failed to initialize — Connect Wallet unavailable", e);
  }
} else {
  isWalletConnectAvailable = true;
  log.debug("AppKit already initialized, skipping");
}

/**
 * The live AppKit instance, for callers that need to act on it outside a
 * component (e.g. disconnecting the WalletConnect session on Riftn sign-out —
 * see useAuthSession.ts's signOut). Kept off the global key rather than a
 * plain module-level variable so it survives Fast Refresh re-evaluating this
 * file's top level without losing the original instance.
 */
export function getAppKitInstance(): ReturnType<typeof createAppKit> | undefined {
  return (globalThis as any)[APPKIT_INSTANCE_KEY];
}
