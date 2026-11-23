import { useEffect, useMemo, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { supabase } from "../services/supabase";
import { useUser } from "../context/AuthContext";
import {
  ONLINE_PRESENCE_TOPIC,
  getShowOnline,
  onlineFromChannel,
  publishOnline,
  usePresenceReaders,
} from "../libs/online-presence";
import { SEEN_PING_MS, getShowLastSeen, pingSeen } from "../libs/last-seen";

/**
 * Joins the shared presence channel when opted in or a focused dot needs it,
 * and tracks this account only while the switch is on
 * and the app is in the foreground — backgrounding untracks straight away
 * rather than leaving a dot lit until the OS kills the socket.
 */
export function useOnlinePresence() {
  const user = useUser() as any;
  const me = ((user?.walletAddress || user?.address || "") as string).toLowerCase() || null;
  const optIns = useMemo(() => {
    const raw = user?.customs;
    let customs = raw;
    if (typeof raw === "string") {
      try { customs = JSON.parse(raw); } catch { customs = null; }
    }
    return { online: getShowOnline(customs), lastSeen: getShowLastSeen(customs) };
  }, [user?.customs]);
  const showOnline = optIns.online;
  const showLastSeen = optIns.lastSeen;
  const [active, setActive] = useState(AppState.currentState === "active");
  const hasReaders = usePresenceReaders();
  const needed = showOnline || hasReaders;

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!me || !active || !needed) return;
    const channel = supabase.channel(ONLINE_PRESENCE_TOPIC, { config: { presence: { key: me } } });
    channel
      .on("presence", { event: "sync" }, () => publishOnline(onlineFromChannel(channel)))
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (showOnline) void channel.track({ at: new Date().toISOString() });
      });
    return () => {
      void supabase.removeChannel(channel);
      publishOnline(new Set());
    };
  }, [me, showOnline, active, needed]);

  // "Last seen": while opted in, tell the API we're here every few minutes
  // and once more as the app goes to the background.
  useEffect(() => {
    if (!me || !showLastSeen) return;
    void pingSeen();
    if (!active) return;
    const timer = setInterval(() => void pingSeen(), SEEN_PING_MS);
    return () => clearInterval(timer);
  }, [me, showLastSeen, active]);
}
