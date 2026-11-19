/**
 * Group calls
 * ===========
 * A group call is the group's own Agora room, `group-call-<group id>`. Any
 * active member may talk in it (the token function checks membership), so a
 * call one member starts is the call the rest join: by answering the ring, or
 * from the Join button while it is going. Same design as the website
 * (src/lib/group-call.ts there); the two must agree on the channel, the uid
 * and the presence topic.
 *
 * Who is in the room rides one realtime presence channel per group. The join
 * button and the call itself both hold it, so it is shared by count: supabase
 * hands back the same channel object for the same topic, and removing it from
 * one holder would silently close it for the other.
 */
import { useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";

/** Most members one start rings. A bigger group joins from the button. */
export const GROUP_CALL_MAX_RING = 31;

export const groupCallChannel = (groupId: string) => `group-call-${groupId}`;
const presenceTopic = (groupId: string) => `group-call:${groupId}`;

/** The Agora uid a wallet uses in a group room: a function of the wallet, so tiles name themselves. */
export function groupCallUid(wallet: string): number {
  return (parseInt(wallet.slice(2, 10), 16) >>> 1) || 1;
}

export interface GroupCallPresence {
  uid: number;
  wallet: string;
  type: "audio" | "video";
}

type Listener = (roster: GroupCallPresence[]) => void;
interface Held {
  channel: RealtimeChannel;
  holders: number;
  joined: boolean;
  listeners: Set<Listener>;
  roster: GroupCallPresence[];
  /** What this device announces, if it is in the call. Re-sent after a reconnect. */
  mine: GroupCallPresence | null;
}
const held = new Map<string, Held>();

function readRoster(channel: RealtimeChannel): GroupCallPresence[] {
  const seen = new Map<number, GroupCallPresence>();
  for (const entries of Object.values(channel.presenceState() as Record<string, unknown[]>)) {
    for (const raw of entries as Partial<GroupCallPresence>[]) {
      if (typeof raw?.uid !== "number" || typeof raw.wallet !== "string") continue;
      seen.set(raw.uid, { uid: raw.uid, wallet: raw.wallet.toLowerCase(), type: raw.type === "video" ? "video" : "audio" });
    }
  }
  return [...seen.values()];
}

/**
 * Hold a group's presence channel. `onRoster` hears every change; `announce`
 * puts this device in the room until the returned release.
 */
export function holdGroupCallPresence(groupId: string, onRoster: Listener, announce?: GroupCallPresence): () => void {
  const topic = presenceTopic(groupId);
  let entry = held.get(topic);
  if (!entry) {
    const channel = supabase.channel(topic);
    const created: Held = { channel, holders: 0, joined: false, listeners: new Set(), roster: [], mine: null };
    entry = created;
    held.set(topic, created);
    channel.on("presence", { event: "sync" }, () => {
      created.roster = readRoster(channel);
      created.listeners.forEach((listener) => listener(created.roster));
    }).subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      created.joined = true;
      if (created.mine) void channel.track(created.mine);
    });
  }
  const current = entry;
  current.holders += 1;
  current.listeners.add(onRoster);
  onRoster(current.roster);
  if (announce) {
    current.mine = announce;
    if (current.joined) void current.channel.track(announce);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.listeners.delete(onRoster);
    if (announce && current.mine === announce) {
      current.mine = null;
      void current.channel.untrack();
    }
    current.holders -= 1;
    if (current.holders <= 0) {
      held.delete(topic);
      void supabase.removeChannel(current.channel);
    }
  };
}

/** Who is in a group's call right now, for the Join button. */
export function useGroupCallRoster(groupId: string | null | undefined): GroupCallPresence[] {
  const [roster, setRoster] = useState<GroupCallPresence[]>([]);
  useEffect(() => {
    setRoster([]);
    if (!groupId) return;
    return holdGroupCallPresence(groupId, setRoster);
  }, [groupId]);
  return roster;
}
