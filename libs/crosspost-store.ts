import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import { useMMKVString } from "react-native-mmkv";
import { storage } from "./storage";

const legacyKey = "dehub_crosspost_selected";
const keyFor = (wallet: string) => legacyKey + ":" + wallet.toLowerCase();

function ids(raw?: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter(id => typeof id === "string") : [];
  } catch { return []; }
}

type Account = { id: string; pending?: boolean };

export function useSelectedCrossPosts(wallet: string | null, accounts?: Account[]) {
  const key = keyFor(wallet ?? "");
  const [raw] = useMMKVString(key, storage);
  useEffect(() => {
    if (!wallet || !accounts?.length || storage.contains(key)) return;
    let current = true;
    void AsyncStorage.getItem(legacyKey).then(value => {
      if (!current || storage.contains(key)) return;
      const legacy = ids(value);
      const owned = accounts.filter(account => !account.pending && legacy.includes(account.id));
      storage.set(key, JSON.stringify(owned.map(account => account.id)));
    }).catch(() => {});
    return () => { current = false; };
  }, [key, wallet, accounts]);
  const selected = ids(raw);
  return wallet ? (accounts ?? []).filter(a => !a.pending && selected.includes(a.id)).map(a => a.id) : [];
}

export function selectCrossPostAccount(wallet: string | null, id: string, enabled: boolean) {
  if (!wallet) return;
  const key = keyFor(wallet);
  const selected = new Set(ids(storage.getString(key)));
  if (enabled) selected.add(id);
  else selected.delete(id);
  storage.set(key, JSON.stringify([...selected]));
}
