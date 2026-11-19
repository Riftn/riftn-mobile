import { ensureWalletSession } from '../libs/wallet-session';
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Platform, PermissionsAndroid, AppState } from "react-native";
import createAgoraRtcEngine, {
  type IRtcEngine, type IRtcEngineEventHandler, type VideoCanvas,
  VideoSourceType, RenderModeType, ChannelProfileType, ClientRoleType,
} from "react-native-agora";
import { supabase, fetchAgoraToken, walletScopedClient } from "../services/supabase";
import { AGORA_APP_ID } from "../config/agora.config";
import { useAuth } from "../context/AuthContext";
import { createLogger } from "../libs/logger";
import { apiClient } from "../libs/api.client";
import { formatCallDuration } from "../libs/callDuration";
import { visualActivity } from "../libs/visualActivity";
import { revokeAudioFocus } from "../libs/audioFocus";
import { revokeAllFeedVideo } from "../libs/feedVideoFocus";
import { holdGroupCallPresence, groupCallChannel, groupCallUid, GROUP_CALL_MAX_RING } from "../libs/groupCall";
import { stopCallRingtone } from "../libs/call-ringtone";

const log = createLogger("useCall");
export interface CallSession {
  id: string; caller_address: string; recipient_address: string;
  status: "ringing" | "connected" | "ended"; call_type: "audio" | "video";
  signaling_data?: any; created_at: string;
  /** Set on a group call: the group whose room this is. */
  group_id?: string | null; group_name?: string | null;
}
/** Someone else in a group call's room. */
export interface GroupParticipant {
  uid: number;
  /** From the room's presence; null for the moment between joining and announcing. */
  wallet: string | null;
  audio: boolean; video: boolean; speaking: boolean;
}
export interface GroupCallTarget { id: string; name: string }
/** How a call finished, kept briefly so the stage can say so and offer a way back. */
export type CallOutcome = "ended" | "declined" | "no_answer" | "missed";
export interface CallSummary {
  peerAddress: string; callType: "audio" | "video"; outcome: CallOutcome;
  /** Formatted length of a call that connected; null for one that never did. */
  duration: string | null;
  /** Set when it was a group call: the group's name stands in for the peer. */
  groupName?: string | null;
}
export interface UseCallReturn {
  isGroupCall: boolean;
  groupParticipants: GroupParticipant[];
  /** Is your own microphone picking up speech right now (group tiles). */
  selfSpeaking: boolean;
  /** Ring every member of a group and open its room. */
  startGroupCall: (group: GroupCallTarget, members: string[], callType?: "audio" | "video") => Promise<void>;
  /** Step into a group call that is already going. */
  joinGroupCall: (group: GroupCallTarget, callType?: "audio" | "video") => Promise<void>;
  /** The caller's side while the other phone is still ringing. */
  isRinging: boolean;
  callSummary: CallSummary | null; dismissCallSummary: () => void;
  isCallActive: boolean; isIncoming: boolean; currentCall: CallSession | null;
  isConnecting: boolean; isMuted: boolean; isSpeakerOn: boolean; isCameraOff: boolean;
  callStartedAt: number | null; remoteUid: number | null; peerAddress: string;
  localCanvas: VideoCanvas; remoteCanvas: VideoCanvas;
  startCall: (recipientAddress: string, callType?: "audio" | "video") => Promise<void>;
  endCall: () => void; acceptCall: () => void; rejectCall: () => void;
  /** Answer from the phone's call screen (CallKit / Android call notification), even with the app in the background. */
  acceptCallById: (sessionId: string) => Promise<void>;
  /** Decline from the phone's call screen. */
  declineCallById: (sessionId: string) => Promise<void>;
  toggleMute: () => void; toggleSpeaker: () => void; toggleCamera: () => void; switchCamera: () => void;
  setCallMessageHandler: (handler: ((content: string) => void) | null) => void;
  isMinimized: boolean; setMinimized: (minimized: boolean) => void;
}
const LOCAL_CANVAS: VideoCanvas = {
  uid: 0, sourceType: VideoSourceType.VideoSourceCamera, renderMode: RenderModeType.RenderModeHidden,
};
type GroupRemote = { audio: boolean; video: boolean };
type CallMedia = {
  engine: IRtcEngine; handler: IRtcEngineEventHandler; closed: boolean;
  remotes: Map<number, GroupRemote>; releasePresence: (() => void) | null;
};
/** The starter's own side of a group call has no row of its own. */
const isSessionId = (id: string) => id !== "pending" && !id.startsWith("group:");

export function useCall(): UseCallReturn {
  const [isCallActive, setIsCallActive] = useState(false);
  const [isIncoming, setIsIncoming] = useState(false);
  const [currentCall, setCurrentCall] = useState<CallSession | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  const [isMinimized, setMinimized] = useState(false);
  const [callSummary, setCallSummary] = useState<CallSummary | null>(null);
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipant[]>([]);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const rosterRef = useRef<Map<number, string>>(new Map());
  const speakingRef = useRef<Set<number>>(new Set());
  /** Ring rows a group call's starter wrote, so an unanswered start can stop the phones. */
  const groupRingIdsRef = useRef<string[]>([]);
  const summaryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissCallSummary = useCallback(() => {
    if (summaryTimerRef.current) clearTimeout(summaryTimerRef.current);
    summaryTimerRef.current = null;
    setCallSummary(null);
  }, []);
  const { user } = useAuth();
  const userAddress = (user?.walletAddress || user?.address || "").toLowerCase();
  const callClient = useMemo(() => userAddress ? walletScopedClient(userAddress) : supabase, [userAddress]);
  const currentCallRef = useRef<CallSession | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const ringCheckRef = useRef<{ wallet: string; generation: number; recover: boolean } | null>(null);
  const joiningRef = useRef(false);
  const mediaRef = useRef<CallMedia | null>(null);
  const callTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callMessageHandlerRef = useRef<((content: string) => void) | null>(null);
  const setCallMessageHandler = useCallback((handler: ((content: string) => void) | null) => {
    callMessageHandlerRef.current = handler;
  }, []);
  const publishCall = useCallback((call: CallSession | null) => {
    currentCallRef.current = call;
    setCurrentCall(call);
  }, []);
  const clearTimeouts = useCallback(() => {
    if (callTimeoutRef.current) clearTimeout(callTimeoutRef.current);
    callTimeoutRef.current = null;
  }, []);
  const markEnded = useCallback(async (call: CallSession | null, answered = true) => {
    if (!call) return;
    const ringIds = groupRingIdsRef.current;
    groupRingIdsRef.current = [];
    try {
      // A group call nobody picked up stops every phone it set ringing. Once
      // somebody is in the room, leaving it is just leaving; the rest carry on.
      if (call.group_id && ringIds.length && !answered) {
        await callClient.from("call_sessions").update({ status: "ended" }).in("id", ringIds).eq("status", "ringing");
      }
      if (!isSessionId(call.id)) return;
      await callClient.from("call_sessions").update({ status: "ended" }).eq("id", call.id);
    }
    catch (error) { log.warn("Call status update failed", error); }
  }, [callClient]);
  const disposeMedia = useCallback((media: CallMedia | null) => {
    if (!media || media.closed) return;
    media.closed = true;
    try { media.releasePresence?.(); } catch (error) { log.warn("Group presence release failed", error); }
    media.releasePresence = null;
    media.remotes.clear();
    const engine = media.engine;
    // Each operation is independent: one native failure must not skip release.
    const operations = [
      () => engine.unregisterEventHandler(media.handler),
      () => engine.stopPreview(),
      () => engine.muteLocalVideoStream(true),
      () => engine.enableLocalVideo(false),
      () => engine.muteLocalAudioStream(true),
      () => engine.enableLocalAudio(false),
      () => engine.leaveChannel(),
      () => engine.release(),
    ];
    operations.forEach(operation => { try { operation(); } catch (error) { log.warn("Call teardown error", error); } });
  }, []);
  const finishCall = useCallback(async (reason?: Exclude<CallOutcome, "ended">) => {
    const call = currentCallRef.current;
    const startedAt = startedAtRef.current;
    generationRef.current += 1;
    joiningRef.current = false;
    stopCallRingtone();
    publishCall(null);
    clearTimeouts();
    const media = mediaRef.current;
    mediaRef.current = null;
    disposeMedia(media);
    startedAtRef.current = null;
    setCallStartedAt(null); setRemoteUid(null); setIsCallActive(false);
    setIsIncoming(false); setIsConnecting(false); setMinimized(false);
    setIsMuted(false); setIsSpeakerOn(false); setIsCameraOff(true);
    setGroupParticipants([]); setSelfSpeaking(false);
    rosterRef.current = new Map(); speakingRef.current = new Set();
    visualActivity.setCall(false, false);
    // The chat note handler belongs to whichever direct chat is open, so a
    // group call never writes into it.
    if (call && startedAt != null && !call.group_id) {
      callMessageHandlerRef.current?.(`📞 ${call.call_type === "video" ? "Video" : "Voice"} call ended · ${formatCallDuration(startedAt)}`);
    }
    const outcome: CallOutcome | null = startedAt != null ? "ended" : reason ?? null;
    if (call && outcome) {
      if (summaryTimerRef.current) clearTimeout(summaryTimerRef.current);
      setCallSummary({
        peerAddress: call.group_id ? call.caller_address
          : call.caller_address === userAddress ? call.recipient_address : call.caller_address,
        callType: call.call_type, outcome,
        duration: startedAt != null ? formatCallDuration(startedAt) : null,
        groupName: call.group_id ? call.group_name || "" : null,
      });
      summaryTimerRef.current = setTimeout(() => { summaryTimerRef.current = null; setCallSummary(null); }, 6000);
    }
    await markEnded(call, startedAt != null);
  }, [publishCall, clearTimeouts, disposeMedia, markEnded, userAddress]);
  const endCall = useCallback(() => finishCall(), [finishCall]);
  /** The far side closed the call. Before anyone answered, that is a decline (ours) or a missed call (theirs). */
  const remoteClosed = useCallback(() => {
    const call = currentCallRef.current;
    if (!call) return;
    if (call.group_id) {
      // One member hanging up is not the end of a group call. The only ping
      // that matters is the starter cancelling while this phone still rings.
      if (startedAtRef.current == null && !joiningRef.current && call.status === "ringing"
        && call.recipient_address === userAddress) void finishCall("missed");
      return;
    }
    if (startedAtRef.current != null || joiningRef.current || call.status !== "ringing") { void finishCall(); return; }
    if (call.caller_address === userAddress) {
      callMessageHandlerRef.current?.(call.call_type === "video" ? "📵 Video call declined" : "📵 Voice call declined");
      void finishCall("declined");
    } else void finishCall("missed");
  }, [finishCall, userAddress]);
  const remoteClosedRef = useRef(remoteClosed);
  remoteClosedRef.current = remoteClosed;

  /** Push the room's remotes, names and talkers into render state. */
  const syncGroup = useCallback((media: CallMedia) => {
    if (media.closed) return;
    const roster = rosterRef.current;
    const speaking = speakingRef.current;
    setGroupParticipants([...media.remotes.entries()].map(([uid, remote]) => ({
      uid, wallet: roster.get(uid) ?? null, audio: remote.audio, video: remote.video, speaking: speaking.has(uid),
    })));
  }, []);

  const joinChannel = useCallback(async (call: CallSession, generation: number): Promise<boolean> => {
    const current = () => generationRef.current === generation && currentCallRef.current?.id === call.id;
    const groupId = call.group_id || null;
    const channelName = groupId ? groupCallChannel(groupId) : `dm-call-${call.id}`;
    const ownUid = groupId && userAddress ? groupCallUid(userAddress) : 0;
    let media: CallMedia | null = null;
    try {
      const token = groupId
        ? await fetchAgoraToken(channelName, "publisher", ownUid, userAddress)
        : await fetchAgoraToken(channelName);
      if (!current()) return false;
      if (!token || !AGORA_APP_ID) throw new Error("Call credentials unavailable");
      if (Platform.OS === "android") {
        const permissions = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ...(call.call_type === "video" ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
        const granted = await PermissionsAndroid.requestMultiple(permissions);
        if (!current()) return false;
        if (permissions.some(permission => granted[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
          throw new Error("Call media permission denied");
        }
      }
      if (!current()) return false;
      revokeAllFeedVideo(); revokeAudioFocus();
      const engine = createAgoraRtcEngine();
      /** Somebody is on the other end: the call is live and its clock starts. */
      const markLive = () => {
        clearTimeouts();
        publishCall({ ...currentCallRef.current!, status: "connected" });
        setIsCallActive(true); setIsConnecting(false);
        if (startedAtRef.current == null) {
          startedAtRef.current = Date.now();
          setCallStartedAt(startedAtRef.current);
        }
      };
      const remoteOf = (uid: number) => {
        const remotes = media!.remotes;
        let remote = remotes.get(uid);
        if (!remote) { remote = { audio: true, video: false }; remotes.set(uid, remote); }
        return remote;
      };
      const handler: IRtcEngineEventHandler = groupId ? {
        onUserJoined: (_connection, uid) => {
          if (!current() || !media || media.closed) return;
          remoteOf(uid);
          syncGroup(media);
          markLive();
        },
        onUserOffline: (_connection, uid) => {
          if (!current() || !media || media.closed) return;
          media.remotes.delete(uid);
          speakingRef.current.delete(uid);
          syncGroup(media);
          // Last one out: nobody left to talk to.
          if (!media.remotes.size && startedAtRef.current != null) void endCall();
        },
        onUserMuteAudio: (_connection, uid, muted) => {
          if (!current() || !media || media.closed) return;
          remoteOf(uid).audio = !muted;
          syncGroup(media);
        },
        // Stopped (0) and failed (4) are off; starting, decoding and a frozen frame are on.
        onRemoteVideoStateChanged: (_connection, uid, state) => {
          if (!current() || !media || media.closed) return;
          remoteOf(uid).video = state === 1 || state === 2 || state === 3;
          syncGroup(media);
        },
        onAudioVolumeIndication: (_connection, speakers) => {
          if (!current() || !media || media.closed) return;
          const next = new Set<number>();
          let self = false;
          for (const speaker of speakers ?? []) {
            if ((speaker.volume ?? 0) < 20) continue;
            if (!speaker.uid) self = true; else next.add(speaker.uid);
          }
          setSelfSpeaking(previous => (previous === self ? previous : self));
          const before = speakingRef.current;
          if (next.size === before.size && [...next].every(uid => before.has(uid))) return;
          speakingRef.current = next;
          syncGroup(media);
        },
      } : {
        onUserJoined: (_connection, uid) => {
          if (!current()) return;
          setRemoteUid(uid);
          markLive();
        },
        onUserOffline: () => { if (current()) void endCall(); },
      };
      media = { engine, handler, closed: false, remotes: new Map(), releasePresence: null };
      mediaRef.current = media;
      const initialized = engine.initialize({ appId: AGORA_APP_ID });
      if (initialized < 0) throw new Error(`Call initialization failed: ${initialized}`);
      engine.registerEventHandler(handler);
      engine.setChannelProfile(ChannelProfileType.ChannelProfileCommunication);
      engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engine.enableAudio();
      engine.enableLocalAudio(true);
      engine.muteLocalAudioStream(false);
      if (groupId) engine.enableAudioVolumeIndication(400, 3, true);
      // A group call plays out loud like a video call: several voices to one earpiece is hard to follow.
      const speaker = call.call_type === "video" || !!groupId;
      engine.setDefaultAudioRouteToSpeakerphone(speaker);
      engine.setEnableSpeakerphone(speaker);
      setIsSpeakerOn(speaker);
      if (call.call_type === "video") {
        setIsCameraOff(false);
        // Let the call modal commit its local surface before preview begins.
        await new Promise(resolve => setTimeout(resolve, 300));
        if (!current() || media.closed) { disposeMedia(media); return false; }
        engine.enableVideo();
        engine.enableLocalVideo(true);
        engine.startPreview();
        engine.muteLocalVideoStream(false);
      }
      if (!current() || media.closed) { disposeMedia(media); return false; }
      const joined = engine.joinChannel(token.token, channelName, groupId ? ownUid : token.uid ?? 0, {
        publishMicrophoneTrack: true, publishCameraTrack: call.call_type === "video",
        autoSubscribeAudio: true, autoSubscribeVideo: call.call_type === "video",
      });
      if (joined < 0) throw new Error(`Call join failed: ${joined}`);
      if (groupId && userAddress) {
        const owned = media;
        owned.releasePresence = holdGroupCallPresence(groupId, roster => {
          if (owned.closed) return;
          rosterRef.current = new Map(roster.map(entry => [entry.uid, entry.wallet]));
          syncGroup(owned);
        }, { uid: ownUid, wallet: userAddress, type: call.call_type });
      }
      return true;
    } catch (error) {
      disposeMedia(media);
      if (current()) log.error("Call connection failed", error);
      return false;
    }
  }, [clearTimeouts, publishCall, disposeMedia, endCall, userAddress, syncGroup]);

  /** Nobody came: a group room you are alone in closes itself after the ring window. */
  const armGroupTimeout = useCallback((generation: number, outcome: "no_answer" | "missed") => {
    clearTimeouts();
    callTimeoutRef.current = setTimeout(() => {
      if (generationRef.current !== generation || startedAtRef.current != null) return;
      void finishCall(outcome);
    }, 45_000);
  }, [clearTimeouts, finishCall]);

  const checkForRing = useCallback(async (recover = false): Promise<void> => {
    if (!userAddress || currentCallRef.current || AppState.currentState !== "active") return;
    const generation = generationRef.current;
    const pending = ringCheckRef.current;
    if (pending?.wallet === userAddress && pending.generation === generation) {
      // A ring may have been inserted after the running query took its snapshot.
      pending.recover ||= recover;
      return;
    }
    const request = { wallet: userAddress, generation, recover: false };
    ringCheckRef.current = request;
    try {
      const { data } = await callClient.from("call_sessions").select("id,caller_address,recipient_address,status,call_type,created_at,group_id,group_name")
        .eq("recipient_address", userAddress).eq("status", "ringing")
        .order("created_at", { ascending: false }).limit(1).single();
      if (!data || generationRef.current !== generation || currentCallRef.current || AppState.currentState !== "active") return;
      const age = Date.now() - new Date(data.created_at).getTime();
      if (!Number.isFinite(age) || age > 45_000) return;
      const ringGeneration = ++generationRef.current;
      publishCall(data as CallSession);
      setIsIncoming(true); setMinimized(false);
      visualActivity.setCall(true, true);
      revokeAllFeedVideo(); revokeAudioFocus();
      callTimeoutRef.current = setTimeout(() => {
        if (generationRef.current === ringGeneration && !joiningRef.current) void finishCall("missed");
      }, Math.max(0, 45_000 - age));
    } catch (error) {
      log.warn("Incoming call check failed", error);
    } finally {
      if (ringCheckRef.current === request) {
        ringCheckRef.current = null;
        if (request.recover && generationRef.current === generation) void checkRef.current();
      }
    }
  }, [userAddress, callClient, publishCall, finishCall]);
  const checkRef = useRef(checkForRing);
  checkRef.current = checkForRing;

  useEffect(() => {
    if (!userAddress) return;
    const channel = supabase.channel(`call:${userAddress}`, { config: { private: true } })
      .on("broadcast", { event: "call" }, message => {
        const ping = message.payload as Pick<CallSession, "id" | "status"> | undefined;
        if (ping?.status === "ringing") void checkForRing(true);
        else if (ping?.status === "ended" && ping.id === currentCallRef.current?.id) remoteClosedRef.current();
      }).subscribe(status => { if (status === "SUBSCRIBED") void checkForRing(); });
    const poll = () => { if (AppState.currentState === "active") void checkForRing(); };
    const interval = setInterval(poll, 60_000);
    const app = AppState.addEventListener("change", state => { if (state === "active") poll(); });
    poll();
    return () => { clearInterval(interval); app.remove(); void supabase.removeChannel(channel); };
  }, [userAddress, checkForRing]);
  useEffect(() => {
    publishCall(null);
    dismissCallSummary();
    joiningRef.current = false;
    startedAtRef.current = null;
    setCallStartedAt(null); setRemoteUid(null); setIsCallActive(false);
    setIsIncoming(false); setIsConnecting(false); setMinimized(false);
    setIsMuted(false); setIsSpeakerOn(false); setIsCameraOff(true);
    return () => {
    generationRef.current += 1;
    clearTimeouts();
    const call = currentCallRef.current;
    currentCallRef.current = null;
    disposeMedia(mediaRef.current);
    mediaRef.current = null;
    visualActivity.setCall(false, false);
    void markEnded(call);
    };
  }, [userAddress, clearTimeouts, disposeMedia, markEnded, publishCall, dismissCallSummary]);

  const startCall = useCallback(async (recipientAddress: string, callType: "audio" | "video" = "audio") => {
    if (!userAddress || currentCallRef.current) return;
    dismissCallSummary();
    const generation = ++generationRef.current;
    const pending: CallSession = {
      id: "pending", caller_address: userAddress, recipient_address: recipientAddress.toLowerCase(),
      status: "ringing", call_type: callType, created_at: new Date().toISOString(),
    };
    publishCall(pending);
    setIsConnecting(true); setMinimized(false);
    visualActivity.setCall(true, true);
    revokeAllFeedVideo(); revokeAudioFocus();
    try {
      const { data, error } = await callClient.from("call_sessions").insert({
        caller_address: pending.caller_address, recipient_address: pending.recipient_address,
        status: "ringing", call_type: callType,
      }).select().single();
      if (error || !data) throw error ?? new Error("Could not initiate call");
      const call = data as CallSession;
      if (generationRef.current !== generation) { await markEnded(call); return; }
      publishCall(call);
      void ensureWalletSession(call.caller_address).then(session => {
        if (!session) throw new Error("Signed call session unavailable");
        return apiClient.post("/push/call-ring", { sessionId: call.id, walletSession: session.token }, { isAuthRequired: true });
      })
        .catch(error => log.warn("Call ring push failed", error));
      callMessageHandlerRef.current?.(callType === "video" ? "📹 Video call" : "📞 Voice call");
      const joined = await joinChannel(call, generation);
      if (generationRef.current !== generation) return;
      if (!joined) { await endCall(); return; }
      if (startedAtRef.current == null) {
        callTimeoutRef.current = setTimeout(() => {
          if (generationRef.current !== generation || startedAtRef.current != null) return;
          callMessageHandlerRef.current?.(callType === "video" ? "📵 Missed video call" : "📵 Missed voice call");
          void finishCall("no_answer");
        }, 30_000);
      }
    } catch (error) {
      if (generationRef.current === generation) { log.error("Call start failed", error); await endCall(); }
    }
  }, [userAddress, callClient, publishCall, markEnded, joinChannel, endCall, finishCall, dismissCallSummary]);

  const openGroupRoom = useCallback(async (group: GroupCallTarget, callType: "audio" | "video", members: string[] | null) => {
    if (!userAddress || currentCallRef.current) return;
    dismissCallSummary();
    const generation = ++generationRef.current;
    const call: CallSession = {
      id: `group:${group.id}:${Date.now()}`, caller_address: userAddress, recipient_address: userAddress,
      status: "ringing", call_type: callType, created_at: new Date().toISOString(),
      group_id: group.id, group_name: group.name,
    };
    groupRingIdsRef.current = [];
    publishCall(call);
    setIsConnecting(true); setMinimized(false);
    visualActivity.setCall(true, true);
    revokeAllFeedVideo(); revokeAudioFocus();
    try {
      if (members) {
        const others = [...new Set(members.map(member => member.toLowerCase()))]
          .filter(member => member !== userAddress).slice(0, GROUP_CALL_MAX_RING);
        if (others.length) {
          const { data, error } = await callClient.from("call_sessions").insert(others.map(recipient => ({
            caller_address: userAddress, recipient_address: recipient, call_type: callType, status: "ringing",
            group_id: group.id, group_name: group.name,
          }))).select("id");
          if (error) throw error;
          const ids = (data ?? []).map((row: { id: string }) => row.id);
          if (generationRef.current !== generation) {
            await callClient.from("call_sessions").update({ status: "ended" }).in("id", ids);
            return;
          }
          groupRingIdsRef.current = ids;
          void ensureWalletSession(userAddress).then(session => {
            if (!session) throw new Error("Signed call session unavailable");
            return Promise.allSettled(ids.map(sessionId =>
              apiClient.post("/push/call-ring", { sessionId, walletSession: session.token }, { isAuthRequired: true })));
          }).catch(error => log.warn("Group ring push failed", error));
        }
      }
      const joined = await joinChannel(call, generation);
      if (generationRef.current !== generation) return;
      if (!joined) { await endCall(); return; }
      if (startedAtRef.current == null) armGroupTimeout(generation, "no_answer");
    } catch (error) {
      if (generationRef.current === generation) { log.error("Group call start failed", error); await endCall(); }
    }
  }, [userAddress, callClient, publishCall, joinChannel, endCall, dismissCallSummary, armGroupTimeout]);
  const startGroupCall = useCallback((group: GroupCallTarget, members: string[], callType: "audio" | "video" = "audio") =>
    openGroupRoom(group, callType, members), [openGroupRoom]);
  const joinGroupCall = useCallback((group: GroupCallTarget, callType: "audio" | "video" = "audio") =>
    openGroupRoom(group, callType, null), [openGroupRoom]);

  const acceptCall = useCallback(async () => {
    const call = currentCallRef.current;
    if (!call || joiningRef.current || call.status !== "ringing") return;
    const generation = generationRef.current;
    joiningRef.current = true;
    clearTimeouts();
    // Silence the ring before the call takes the microphone and speaker.
    stopCallRingtone();
    setIsIncoming(false); setIsConnecting(true);
    try {
      const { error } = await callClient.from("call_sessions").update({ status: "connected" }).eq("id", call.id);
      if (generationRef.current !== generation) { await markEnded(call); return; }
      if (error) throw error;
      publishCall({ ...call, status: "connected" });
      const joined = await joinChannel(call, generation);
      if (generationRef.current === generation && !joined) await endCall();
      // Answered after everyone else had already gone: do not sit in an empty room.
      else if (joined && call.group_id && startedAtRef.current == null) armGroupTimeout(generation, "missed");
    } catch (error) {
      if (generationRef.current === generation) { log.error("Call accept failed", error); await endCall(); }
    } finally { if (generationRef.current === generation) joiningRef.current = false; }
  }, [callClient, clearTimeouts, publishCall, joinChannel, endCall, markEnded, armGroupTimeout]);

  const acceptRef = useRef(acceptCall);
  acceptRef.current = acceptCall;
  const acceptCallById = useCallback(async (sessionId: string) => {
    const existing = currentCallRef.current;
    if (existing?.id === sessionId) {
      if (existing.status === "ringing") await acceptRef.current();
      return;
    }
    if (existing || !userAddress) return;
    try {
      const { data } = await callClient.from("call_sessions").select("id,caller_address,recipient_address,status,call_type,created_at,group_id,group_name")
        .eq("id", sessionId).eq("recipient_address", userAddress).maybeSingle();
      if (!data || data.status !== "ringing" || currentCallRef.current) return;
      generationRef.current += 1;
      dismissCallSummary();
      // Straight to joining: the phone's call screen already rang and was answered.
      publishCall(data as CallSession);
      setMinimized(false);
      visualActivity.setCall(true, true);
      revokeAllFeedVideo(); revokeAudioFocus();
      await acceptRef.current();
    } catch (error) {
      log.warn("Answer from call screen failed", error);
    }
  }, [userAddress, callClient, publishCall, dismissCallSummary]);
  const declineCallById = useCallback(async (sessionId: string) => {
    if (currentCallRef.current?.id === sessionId) { await finishCall(); return; }
    if (!userAddress) return;
    try {
      await callClient.from("call_sessions").update({ status: "ended" })
        .eq("id", sessionId).eq("recipient_address", userAddress).eq("status", "ringing");
    } catch (error) {
      log.warn("Decline from call screen failed", error);
    }
  }, [userAddress, callClient, finishCall]);

  const toggleMute = useCallback(() => {
    const engine = mediaRef.current?.engine;
    if (engine) setIsMuted(previous => { engine.muteLocalAudioStream(!previous); return !previous; });
  }, []);
  const toggleSpeaker = useCallback(() => {
    const engine = mediaRef.current?.engine;
    if (engine) setIsSpeakerOn(previous => { engine.setEnableSpeakerphone(!previous); return !previous; });
  }, []);
  const toggleCamera = useCallback(() => {
    const engine = mediaRef.current?.engine;
    if (!engine) return;
    setIsCameraOff(previous => {
      if (previous) { engine.enableVideo(); engine.enableLocalVideo(true); engine.startPreview(); engine.muteLocalVideoStream(false); }
      else { engine.muteLocalVideoStream(true); engine.stopPreview(); }
      return !previous;
    });
  }, []);
  const switchCamera = useCallback(() => { mediaRef.current?.engine.switchCamera(); }, []);
  const peerAddress = currentCall
    ? currentCall.caller_address === userAddress ? currentCall.recipient_address : currentCall.caller_address : "";
  const remoteCanvas = useMemo<VideoCanvas>(() => ({
    uid: remoteUid ?? 0, sourceType: VideoSourceType.VideoSourceRemote, renderMode: RenderModeType.RenderModeFit,
  }), [remoteUid]);
  const isRinging = !!currentCall && isConnecting && !isCallActive && currentCall.status === "ringing"
    && currentCall.caller_address === userAddress;
  const isGroupCall = !!currentCall?.group_id;
  return useMemo(() => ({
    isGroupCall, groupParticipants, selfSpeaking, startGroupCall, joinGroupCall,
    isRinging, callSummary, dismissCallSummary,
    isCallActive, isIncoming, currentCall, isConnecting, isMuted, isSpeakerOn, isCameraOff,
    callStartedAt, remoteUid, peerAddress, localCanvas: LOCAL_CANVAS, remoteCanvas,
    startCall, endCall, acceptCall, rejectCall: endCall, acceptCallById, declineCallById, toggleMute, toggleSpeaker, toggleCamera,
    switchCamera, setCallMessageHandler, isMinimized, setMinimized,
  }), [isGroupCall, groupParticipants, selfSpeaking, startGroupCall, joinGroupCall,
    isRinging, callSummary, dismissCallSummary, isCallActive, isIncoming, currentCall, isConnecting, isMuted, isSpeakerOn, isCameraOff,
    callStartedAt, remoteUid, peerAddress, remoteCanvas, startCall, endCall, acceptCall, acceptCallById, declineCallById,
    toggleMute, toggleSpeaker, toggleCamera, switchCamera, setCallMessageHandler, isMinimized]);
}
