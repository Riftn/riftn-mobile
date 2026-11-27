import { useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import { openBrowserAsync } from "expo-web-browser";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toastError, toastSuccess } from "../libs";
import { withDeHubLanguage } from "../libs/localized-url";
import { changeLiveCoStreamRequest, getLiveCoStreamAction } from "../services/live-costream";

export function useLiveCoStream({
  streamId, owner, wallet, username, enabled, onSignIn,
}: {
  streamId: string | null;
  owner?: string | null;
  wallet: string;
  username?: string | null;
  enabled: boolean;
  onSignIn: () => void;
}) {
  const { t, i18n } = useTranslation();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const host = owner?.toLowerCase();
  const active = enabled && !!streamId && !!host && host !== wallet;
  const query = useQuery({
    queryKey: ["live-costream-action", streamId, host, wallet],
    queryFn: ({ signal }) => getLiveCoStreamAction(streamId!, host!, wallet, signal),
    enabled: active,
    staleTime: 2000,
    retry: false,
    refetchInterval: (current) => current.state.data?.kind === "cancel" ? 3000 : 15_000,
    refetchIntervalInBackground: false,
  });
  const action = query.data;
  if (!active || !action) return null;

  const onPress = async () => {
    if (inFlight.current) return;
    if (!wallet) {
      onSignIn();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      if (action.kind === "join") {
        const url = withDeHubLanguage(`https://dehub.io/app/live/join/${encodeURIComponent(action.roomId)}`, i18n.language);
        if (Platform.OS === "ios") await Linking.openURL(url);
        else await openBrowserAsync(url);
      } else {
        const changed = await changeLiveCoStreamRequest(wallet, action, username);
        if (changed && action.kind === "ask") toastSuccess(t("liveViewer.coStreamRequested"));
      }
    } catch {
      toastError(t("liveViewer.coStreamError"));
    } finally {
      await query.refetch();
      inFlight.current = false;
      setBusy(false);
    }
  };

  const label = action.kind === "ask" ? t("liveViewer.coStreamAsk")
    : action.kind === "cancel" ? t("liveViewer.coStreamCancel") : t("liveViewer.coStreamJoin");
  const icon = action.kind === "ask" ? "Hand" : action.kind === "cancel" ? "X" : "ExternalLink";
  return { label, icon, busy, onPress } as const;
}
