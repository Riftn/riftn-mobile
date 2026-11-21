// First, so it timestamps the start of our JavaScript before anything else runs.
import "./libs/launchTiming";
import "react-native-gesture-handler";
import "react-native-get-random-values";
import "react-native-url-polyfill/auto";
import "@ethersproject/shims";
// import "react-native-reanimated";
import "react-native-gesture-handler";
import "react-native-worklets";

import "./globals";
import "./i18n";

// Installs Manrope — the app typeface — over the JSX runtime, so every
// <Text>/<TextInput> in the app gets it without a per-file edit. Imported for
// its side effect and imported *here* rather than in App.tsx: it has to be in
// place before the first element is created, and an effect in App runs after
// the tree below it has already rendered in the platform font.
import "./libs/globalFont";

// Silence noisy deprecation warning from transitive deps in dev
//   LogBox.ignoreLogs(["SafeAreaView has been deprecated", "Failed to obtain view for PanGestureHandler"]);
// LogBox.ignoreLogs(["Failed to obtain view for PanGestureHandler"]);

import { AppRegistry, Platform } from "react-native";
import { registerRootComponent } from "expo";
import { applyHardwareImageDecode } from "./libs/hardwareImageDecode";

import App from "./App";
import { installGlobalErrorHandler } from "./libs/errorReporter";
import { reportProcessExits } from "./libs/processExit";

// Catches uncaught JS errors and ships them to client_error_logs, and uploads
// whatever the last run died holding. Here rather than in an App effect: it has
// to be in place before the first render, since a fault while the tree is
// mounting is exactly the one nobody can otherwise see.
installGlobalErrorHandler();

// As early as possible: pictures that load before it resolves keep the old path.
void applyHardwareImageDecode();

// How the previous run ended, if it did not end by choice. A native crash or
// an OOM kills the process without the handler above ever running; Android
// keeps the record, and this ships it with the next launch.
reportProcessExits();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
if (Platform.OS === "android") {
  AppRegistry.registerHeadlessTask("RiftnDeclineCall", () => async ({ sessionId, workId }) => {
    const { completeNativeDecline } = await import("./modules/call-screen");
    let success = false;
    try {
      const { getAuthUser } = await import("./libs/auth.utils");
      const user = await getAuthUser();
      const wallet = (user?.walletAddress || user?.address)?.toLowerCase();
      if (wallet) {
        const { walletScopedClient } = await import("./services/supabase");
        const client = walletScopedClient(wallet);
        const { data, error } = await client.from("call_sessions")
          .update({ status: "ended" }).eq("id", sessionId).eq("recipient_address", wallet).eq("status", "ringing")
          .select("id").maybeSingle();
        if (!error && data) success = true;
        else if (!error) {
          // The live handler may already have ended this call. A different
          // wallet sees no row and must leave the request queued for its owner.
          const previous = await client.from("call_sessions").select("status")
            .eq("id", sessionId).eq("recipient_address", wallet).maybeSingle();
          success = !previous.error && !!previous.data && previous.data.status !== "ringing";
        }
      }
    } finally {
      await completeNativeDecline(workId, success);
    }
  });
}

registerRootComponent(App);
