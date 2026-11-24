/**
 * Group calls
 * ===========
 * A group call is the group's own Agora room, `group-call-<group id>`. Any
 * active member may talk in it (the token function checks membership), so a
 * call one member starts is the call the rest join: by answering the ring, or
 * from the Join pill while it is going. Riftn's main chat (Public Chat) is the
 * exception: nobody is rung there, people join from the pill. Same design as the website
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

/**
 * The Public Chat's call room. Public Chat is the Riftn community's chat
 * (RIFTN_COMMUNITY_ID in community-kinds), so its call is that community's
 * group room. Anyone signed in and not banned from it may talk there, and
 * nobody is rung: people join from the pill. Same id as the website.
 */
export const PUBLIC_CHAT_CALL_ID = "03826b47-f2ff-4707-b76c-818791a9b632";

/** Most people in one call room. The next one sees "Call full". Same as the website. */
export const GROUP_CALL_MAX_PEOPLE = 128;
/** Members one start rings: everyone the room could hold besides the caller. */
export const GROUP_CALL_MAX_RING = GROUP_CALL_MAX_PEOPLE - 1;
/** Most cameras on at once in one call. Past it you join, or stay, with yours off. */
export const GROUP_CALL_MAX_CAMERAS = 17;

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
  /** Their camera is on right now. Older builds leave it out: a video call then counts as on. */
  cam: boolean;
}

type Listener = (roster: GroupCallPresence[]) => void;
interface Held {
  channel: RealtimeChannel;
  holders: number;
  joined: boolean;
  /** The first presence sync has arrived, so `roster` is the real room. */
  synced: boolean;
  listeners: Set<Listener>;
  roster: GroupCallPresence[];
  /** What this device announces, if it is in the call. Re-sent after a reconnect. */
  mine: GroupCallPresence | null;
  /** Told when a moderator acted in this room (only a nudge to read the list again). */
  mods: Set<() => void>;
}
const held = new Map<string, Held>();

function readRoster(channel: RealtimeChannel): GroupCallPresence[] {
  const seen = new Map<number, GroupCallPresence>();
  for (const entries of Object.values(channel.presenceState() as Record<string, unknown[]>)) {
    for (const raw of entries as Partial<GroupCallPresence>[]) {
      if (typeof raw?.uid !== "number" || typeof raw.wallet !== "string") continue;
      const type = raw.type === "video" ? "video" : "audio";
      seen.set(raw.uid, { uid: raw.uid, wallet: raw.wallet.toLowerCase(), type, cam: typeof raw.cam === "boolean" ? raw.cam : type === "video" });
    }
  }
  return [...seen.values()];
}

/**
 * Hold a group's presence channel. `onRoster` hears every change; `announce`
 * puts this device in the room until the returned release.
 */
export function holdGroupCallPresence(groupId: string, onRoster: Listener, announce?: GroupCallPresence, onMod?: () => void): () => void {
  const topic = presenceTopic(groupId);
  let entry = held.get(topic);
  if (!entry) {
    const channel = supabase.channel(topic);
    const created: Held = { channel, holders: 0, joined: false, synced: false, listeners: new Set(), roster: [], mine: null, mods: new Set() };
    entry = created;
    held.set(topic, created);
    channel.on("presence", { event: "sync" }, () => {
      created.roster = readRoster(channel);
      created.synced = true;
      created.listeners.forEach((listener) => listener(created.roster));
    }).on("broadcast", { event: "mod" }, () => {
      created.mods.forEach((listener) => listener());
    }).subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      created.joined = true;
      if (created.mine) void channel.track(created.mine);
    });
  }
  const current = entry;
  current.holders += 1;
  current.listeners.add(onRoster);
  if (onMod) current.mods.add(onMod);
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
    if (onMod) current.mods.delete(onMod);
    if (announce && current.mine?.uid === announce.uid) {
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

/** Re-announce this device in a room it is already in (the camera went on or off). */
export function updateGroupCallPresence(groupId: string, mine: GroupCallPresence): void {
  const entry = held.get(presenceTopic(groupId));
  if (!entry || entry.mine?.uid !== mine.uid) return;
  entry.mine = mine;
  if (entry.joined) void entry.channel.track(mine);
}

/** How full a room is, for everyone but `me`. */
export function groupCallLoad(roster: GroupCallPresence[], me: string | null | undefined) {
  const others = roster.filter((entry) => entry.wallet !== (me ?? "").toLowerCase());
  const cameras = others.filter((entry) => entry.cam).length;
  return { people: others.length, cameras, full: others.length >= GROUP_CALL_MAX_PEOPLE, camerasFull: cameras >= GROUP_CALL_MAX_CAMERAS };
}

/**
 * Who is in a room, read once before stepping in. A channel the Join pill
 * already holds answers at once; a fresh one waits for its first sync, at
 * most `waitMs`.
 */
export function readGroupCallRoster(groupId: string, waitMs = 1500): Promise<GroupCallPresence[]> {
  return new Promise((resolve) => {
    let release: (() => void) | null = null;
    let done = false;
    let latest: GroupCallPresence[] = [];
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      release?.();
      resolve(latest);
    };
    const timer = setTimeout(finish, waitMs);
    release = holdGroupCallPresence(groupId, (roster) => {
      latest = roster;
      if (held.get(presenceTopic(groupId))?.synced) finish();
    });
    if (done) release();
  });
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

/** Tell everyone in a group's call that a moderator acted, so they read the list again. */
export function sendGroupCallMod(groupId: string, payload: { target: string; action: string }) {
  const entry = held.get(presenceTopic(groupId));
  if (!entry) return;
  void entry.channel.send({ type: "broadcast", event: "mod", payload }).catch(() => { /* the 20 s re-read catches up */ });
}
