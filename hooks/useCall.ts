import { ensureWalletSession } from '../libs/wallet-session';
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Platform, PermissionsAndroid, AppState } from "react-native";
import createAgoraRtcEngine, {
  type IRtcEngine, type IRtcEngineEventHandler, type VideoCanvas,
  VideoSourceType, LocalVideoStreamState, RenderModeType, ChannelProfileType, ClientRoleType, RawAudioFrameOpModeType,
  BackgroundSourceType, BackgroundBlurDegree, SegModelType, FeatureType, type VirtualBackgroundSource,
} from "react-native-agora";
import { CALL_BACKGROUNDS, colorNumber, loadCallBackground, loadCallBackgroundPhoto, pathFromUri, saveCallBackground, type CallBackgroundId } from "../libs/callBackground";
import { supabase, fetchAgoraToken, walletScopedClient } from "../services/supabase";
import { useAuth } from "../context/AuthContext";
import { createLogger } from "../libs/logger";
import { apiClient } from "../libs/api.client";
import { formatCallDuration } from "../libs/callDuration";
import { visualActivity } from "../libs/visualActivity";
import { revokeAudioFocus } from "../libs/audioFocus";
import { revokeAllFeedVideo } from "../libs/feedVideoFocus";
import { moderateCall, NO_CALL_MODERATION, readCallModeration, removedMinutesLeft, type CallModAction, type GroupCallModeration } from "../libs/groupCallModeration";
import { holdGroupCallPresence, sendGroupCallMod, updateGroupCallPresence, readGroupCallRoster, groupCallLoad, groupCallChannel, groupCallUid, GROUP_CALL_MAX_RING } from "../libs/groupCall";
import { stopCallRingtone } from "../libs/call-ringtone";
import { toastError, toastInfo, toastWarning } from "../libs/toast";
import i18n from "i18next";

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
  /** A moderator muted them: nobody in the call hears them until a moderator unmutes them. */
  modMuted?: boolean;
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
  /** Every camera slot in this group call is taken by someone else: yours stays off until one frees up. */
  groupCamerasFull: boolean;
  /**
   * Ring the group's members (notification + incoming screen) and open its
   * room. Refused with a toast when the room is full; a video call starts
   * with the camera off when the cameras are.
   */
  startGroupCall: (group: GroupCallTarget, members: string[], callType?: "audio" | "video") => Promise<void>;
  /** Step into a group's room without ringing anyone (Public Chat, or a call already going). Same limits. */
  joinGroupCall: (group: GroupCallTarget, callType?: "audio" | "video") => Promise<void>;
  /** Latest voice levels (0..1) in a group call: each uid heard, and you as 0. */
  readGroupLevels: () => Map<number, number>;
  /** Who the chat's moderators muted or removed in this group call, and whether you are one of them. */
  groupModeration: GroupCallModeration;
  /** A moderator muted you: the mic stays off until one unmutes you. */
  modMuted: boolean;
  moderateGroupMember: (wallet: string, action: CallModAction) => Promise<boolean>;
  /** The caller's side while the other phone is still ringing. */
  isRinging: boolean;
  callSummary: CallSummary | null; dismissCallSummary: () => void;
  isCallActive: boolean; isIncoming: boolean; currentCall: CallSession | null;
  isConnecting: boolean; isMuted: boolean; isSpeakerOn: boolean; isCameraOff: boolean;
  callStartedAt: number | null; remoteUid: number | null; peerAddress: string;
  localCanvas: VideoCanvas; remoteCanvas: VideoCanvas; localVideoEpoch: number; remoteVideoEpoch: number;
  startCall: (recipientAddress: string, callType?: "audio" | "video") => Promise<void>;
  endCall: () => void; acceptCall: () => void; rejectCall: () => void;
  /** Answer from the phone's call screen (CallKit / Android call notification), even with the app in the background. */
  acceptCallById: (sessionId: string) => Promise<void>;
  /** Decline from the phone's call screen. */
  declineCallById: (sessionId: string) => Promise<void>;
  setNativeMute: (sessionId: string, muted: boolean) => boolean;
  toggleMute: () => void; toggleSpeaker: () => void; toggleCamera: () => void; switchCamera: () => void;
  setCallMessageHandler: (handler: ((content: string) => void) | null) => void;
  isMinimized: boolean; setMinimized: (minimized: boolean) => void;
  /** The call's room once it is live (`dm-call-<id>` or `group-call-<group>`), for subtitles. */
  captionRoom: string | null;
  /** Wallets whose subtitles this call shows: the two people, or everyone in the group room. */
  captionSpeakers: string[];
  /**
   * Raw 16 kHz mono 16-bit microphone frames, for live subtitles. Returns a
   * stop function. Frames keep coming while muted; the caller gates on that.
   */
  tapMicrophone: (onFrame: (pcm: Uint8Array) => void) => () => void;
  /** Everyone else's volume (100 = normal), lowered under a dubbed line. */
  setCallVolume: (volume: number) => void;
  /** What is behind you on a video call: off, blur, a scene or your photo. Remembered between calls. */
  callBackground: CallBackgroundId;
  /** Whether this phone can run the background effect (known once a video call has started). */
  callBackgroundSupported: boolean;
  /** Pick a background. `photo` is a file:// uri, for 'photo'. */
  setCallBackground: (id: CallBackgroundId, photo?: string | null) => void;
}
const LOCAL_CANVAS: VideoCanvas = {
  uid: 0, sourceType: VideoSourceType.VideoSourceCamera, renderMode: RenderModeType.RenderModeHidden,
};
type GroupRemote = { audio: boolean; video: boolean; silenced?: boolean };
type CallMedia = {
  engine: IRtcEngine; handler: IRtcEngineEventHandler; closed: boolean;
  remotes: Map<number, GroupRemote>; releasePresence: (() => void) | null;
  /** Re-reads who the moderators muted or removed (group calls). */
  modTimer?: ReturnType<typeof setInterval> | null;
  microphonePublicationPaused?: boolean;
  channelJoining?: boolean;
};
/** The starter's own side of a group call has no row of its own. */
const isSessionId = (id: string) => id !== "pending" && !id.startsWith("group:");

export function useCall(): UseCallReturn {
  const [isCallActive, setIsCallActive] = useState(false);
  const [isIncoming, setIsIncoming] = useState(false);
  const [currentCall, setCurrentCall] = useState<CallSession | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  const setIsMuted = useCallback((muted: boolean) => {
    mutedRef.current = muted;
    setMutedState(muted);
  }, []);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const speakerRef = useRef(false);
  const [isCameraOff, setIsCameraOff] = useState(true);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  // Bumped when the other person's video starts decoding. The remote surface
  // is keyed on it: a surface attached before the first frame could stay black
  // until the call was minimised and reopened (which remounted it).
  const [remoteVideoEpoch, setRemoteVideoEpoch] = useState(0);
  const [localVideoEpoch, setLocalVideoEpoch] = useState(0);
  const [isMinimized, setMinimized] = useState(false);
  const [callSummary, setCallSummary] = useState<CallSummary | null>(null);
  const [groupParticipants, setGroupParticipants] = useState<GroupParticipant[]>([]);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [groupCamerasFull, setGroupCamerasFull] = useState(false);
  const camerasFullRef = useRef(false);
  /** Set for a group video call joined while every camera slot was taken. */
  const startCameraOffRef = useRef(false);
  /** Your camera is being sent. Group calls announce it so others can count cameras. */
  const camOnRef = useRef(false);
  /** What this device announces in its group room, re-sent when the camera changes. */
  const groupPresenceRef = useRef<{ groupId: string; uid: number; wallet: string; type: "audio" | "video" } | null>(null);
  /** Reading a room before stepping in: a second tap waits for it. */
  const joiningGroupRef = useRef(false);
  const [callBackground, setCallBackgroundState] = useState<CallBackgroundId>(() => loadCallBackground());
  const [callBackgroundSupported, setCallBackgroundSupported] = useState(true);
  const callBackgroundRef = useRef<{ id: CallBackgroundId; photo: string | null } | null>(null);
  if (!callBackgroundRef.current) {
    const id = loadCallBackground();
    callBackgroundRef.current = { id, photo: id === "photo" ? loadCallBackgroundPhoto() : null };
  }
  const rosterRef = useRef<Map<number, string>>(new Map());
  const [groupModeration, setGroupModeration] = useState<GroupCallModeration>(NO_CALL_MODERATION);
  const moderationRef = useRef<GroupCallModeration>(NO_CALL_MODERATION);
  const [modMuted, setModMuted] = useState(false);
  const modMutedRef = useRef(false);
  const speakingRef = useRef<Set<number>>(new Set());
  const levelsRef = useRef<Map<number, number>>(new Map());
  /** When the others' report last came in: a stale one (nobody heard since) reads as quiet. */
  const levelsAtRef = useRef(0);
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
    if (!call || !currentCallRef.current) {
      speakerRef.current = !!call && (call.call_type === "video" || !!call.group_id);
      setIsSpeakerOn(speakerRef.current);
      setIsMuted(false);
    }
    currentCallRef.current = call;
    setCurrentCall(call);
  }, [setIsMuted]);
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
    if (media.modTimer) clearInterval(media.modTimer);
    media.modTimer = null;
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
  const finishCall = useCallback(async (reason?: Exclude<CallOutcome, "ended">, notifyPeer = true) => {
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
    setIsCameraOff(true);
    setGroupParticipants([]); setSelfSpeaking(false); setGroupCamerasFull(false);
    camerasFullRef.current = false; startCameraOffRef.current = false; camOnRef.current = false; groupPresenceRef.current = null;
    rosterRef.current = new Map(); speakingRef.current = new Set(); levelsRef.current = new Map();
    moderationRef.current = NO_CALL_MODERATION; setGroupModeration(NO_CALL_MODERATION);
    modMutedRef.current = false; setModMuted(false);
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
    if (notifyPeer) await markEnded(call, startedAt != null);
  }, [publishCall, clearTimeouts, disposeMedia, markEnded, userAddress]);
  const endCall = useCallback(() => finishCall(), [finishCall]);
  const finishCallRef = useRef(finishCall);
  finishCallRef.current = finishCall;
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
    const { muted, removed } = moderationRef.current;
    const now = Date.now();
    const out = new Set(removed.filter(entry => new Date(entry.until).getTime() > now).map(entry => entry.wallet));
    const people: GroupParticipant[] = [];
    for (const [uid, remote] of media.remotes) {
      const wallet = roster.get(uid) ?? null;
      const silenced = !!wallet && (muted.includes(wallet) || out.has(wallet));
      // Muted or removed by a moderator: silent on every phone, not just theirs.
      if (silenced !== !!remote.silenced) {
        remote.silenced = silenced;
        try { media.engine.muteRemoteAudioStream(uid, silenced); } catch (error) { log.warn("Remote mute failed", error); }
      }
      if (wallet && out.has(wallet)) continue;
      people.push({
        uid, wallet, audio: remote.audio && !silenced, video: remote.video, speaking: speaking.has(uid) && !silenced,
        modMuted: !!wallet && muted.includes(wallet),
      });
    }
    setGroupParticipants(people);
  }, []);

  /**
   * What the chat's moderators decided for this call: a removed person leaves,
   * a muted one has their mic held off, and every other phone silences and
   * hides them too.
   */
  const applyModeration = useCallback((media: CallMedia, next: GroupCallModeration) => {
    if (media.closed || mediaRef.current !== media) return;
    moderationRef.current = next;
    setGroupModeration(next);
    const me = userAddress?.toLowerCase() ?? "";
    if (me && removedMinutesLeft(next, me) > 0) {
      toastInfo(i18n.t("calls.removedByMod", "A moderator removed you from this call"));
      void finishCallRef.current();
      return;
    }
    const muted = !!me && next.muted.includes(me);
    if (muted !== modMutedRef.current) {
      modMutedRef.current = muted;
      setModMuted(muted);
      if (muted) {
        try { media.engine.muteLocalAudioStream(true); } catch (error) { log.warn("Mod mute failed", error); }
        setIsMuted(true);
        toastInfo(i18n.t("calls.mutedByMod", "A moderator muted you"));
      } else {
        toastInfo(i18n.t("calls.unmutedByMod", "A moderator unmuted you. Tap the mic to talk."));
      }
    }
    syncGroup(media);
  }, [userAddress, syncGroup, setIsMuted]);
  const refreshModeration = useCallback((media: CallMedia, groupId: string) => {
    readCallModeration(groupId).then(next => applyModeration(media, next)).catch(error => log.warn("Call moderation read failed", error));
  }, [applyModeration]);

  /**
   * Puts the chosen background on the camera, or takes it off. Agora's virtual
   * background runs inside the call SDK on the phone, before the picture is
   * sent, so the other side sees the effect and nothing else changes. A phone
   * the SDK says cannot run it gets `false` and the picker hides.
   */
  const applyBackground = useCallback((engine: IRtcEngine): boolean => {
    const { id, photo } = callBackgroundRef.current ?? { id: "none" as const, photo: null };
    try {
      if (id === "none") { engine.enableVirtualBackground(false, {}, {}); return true; }
      const choice = CALL_BACKGROUNDS.find(entry => entry.id === id);
      const source: VirtualBackgroundSource = id === "blur"
        ? { background_source_type: BackgroundSourceType.BackgroundBlur, blur_degree: BackgroundBlurDegree.BlurDegreeHigh }
        : id === "photo" && photo
          ? { background_source_type: BackgroundSourceType.BackgroundImg, source: pathFromUri(photo) }
          : id === "photo"
            ? { background_source_type: BackgroundSourceType.BackgroundBlur, blur_degree: BackgroundBlurDegree.BlurDegreeHigh }
            : { background_source_type: BackgroundSourceType.BackgroundColor, color: colorNumber(choice?.color ?? "#111318") };
      const result = engine.enableVirtualBackground(true, source, { modelType: SegModelType.SegModelAi });
      if (result < 0) log.warn("Virtual background refused", { result, id });
      return result >= 0;
    } catch (error) {
      log.warn("Virtual background failed", error);
      return false;
    }
  }, []);
  const joinChannel = useCallback(async (call: CallSession, generation: number): Promise<boolean> => {
    const current = () => generationRef.current === generation && currentCallRef.current?.id === call.id;
    const groupId = call.group_id || null;
    const channelName = groupId ? groupCallChannel(groupId) : `dm-call-${call.id}`;
    const ownUid = groupId && userAddress ? groupCallUid(userAddress) : 0;
    let media: CallMedia | null = null;
    try {
      if (groupId && userAddress) {
        // Removed by a moderator a moment ago: stay out until the time is up.
        const standing = await readCallModeration(groupId).catch(() => null);
        if (!current()) return false;
        const minutes = standing ? removedMinutesLeft(standing, userAddress) : 0;
        if (minutes > 0) {
          toastWarning(i18n.t("calls.removedByMod", "A moderator removed you from this call"), {
            description: i18n.t("calls.removedFor", { count: minutes, defaultValue: "You can join again in {{count}} min." }),
          });
          return false;
        }
        if (standing) {
          moderationRef.current = standing; setGroupModeration(standing);
          if (standing.muted.includes(userAddress.toLowerCase())) { modMutedRef.current = true; setModMuted(true); }
        }
      }
      const token = await fetchAgoraToken(channelName, "publisher", ownUid, userAddress);
      if (!current()) return false;
      if (!token?.appId) throw new Error("Call credentials unavailable");
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
          // Two reports per interval: yours alone (uid 0), then the loudest others.
          const levels = levelsRef.current;
          const local = (speakers ?? []).some(speaker => !speaker.uid);
          if (local) {
            // Your report says nothing about the others: leave their outlines alone.
            const volume = speakers?.find(speaker => !speaker.uid)?.volume ?? 0;
            levels.set(0, Math.min(1, volume / 255));
            const self = volume >= 20;
            setSelfSpeaking(previous => (previous === self ? previous : self));
            return;
          }
          levelsAtRef.current = Date.now();
          for (const key of [...levels.keys()]) if (key !== 0) levels.delete(key);
          for (const speaker of speakers ?? []) if (speaker.uid) levels.set(speaker.uid, Math.min(1, (speaker.volume ?? 0) / 255));
          const next = new Set<number>();
          for (const speaker of speakers ?? []) {
            if ((speaker.volume ?? 0) < 20 || !speaker.uid) continue;
            next.add(speaker.uid);
          }
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
        // Reattach the preview if it mounted before the camera started capturing.
        onLocalVideoStateChanged: (source, state) => {
          if (!current() || media?.closed || source !== VideoSourceType.VideoSourceCamera ||
              state !== LocalVideoStreamState.LocalVideoStreamStateCapturing) return;
          setLocalVideoEpoch(n => n + 1);
        },
        // Decoding (2): the first frames are arriving, so redraw the surface.
        onRemoteVideoStateChanged: (_connection, _uid, state) => {
          if (!current() || state !== 2) return;
          setRemoteVideoEpoch(n => n + 1);
        },
        onUserOffline: () => { if (current()) void endCall(); },
      };
      media = { engine, handler, closed: false, remotes: new Map(), releasePresence: null };
      mediaRef.current = media;
      const initialized = engine.initialize({ appId: token.appId });
      if (initialized < 0) throw new Error(`Call initialization failed: ${initialized}`);
      engine.registerEventHandler(handler);
      engine.setChannelProfile(ChannelProfileType.ChannelProfileCommunication);
      engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engine.enableAudio();
      engine.enableLocalAudio(true);
      // Muted by a moderator before (re)joining: the mic starts off.
      if (modMutedRef.current) setIsMuted(true);
      if (groupId) engine.enableAudioVolumeIndication(200, 3, true);
      // A group call plays out loud like a video call: several voices to one earpiece is hard to follow.
      engine.setDefaultAudioRouteToSpeakerphone(speakerRef.current);
      engine.setEnableSpeakerphone(speakerRef.current);
      if (call.call_type === "video") {
        setIsCameraOff(false);
        // Let the call modal commit its local surface before preview begins.
        await new Promise(resolve => setTimeout(resolve, 300));
        if (!current() || media.closed) { disposeMedia(media); return false; }
        engine.enableVideo();
        engine.enableLocalVideo(true);
        engine.startPreview();
        engine.muteLocalVideoStream(false);
        camOnRef.current = true;
        // Every camera slot is taken: you are in, heard and seeing everyone, with yours off.
        if (groupId && startCameraOffRef.current) {
          engine.muteLocalVideoStream(true);
          engine.stopPreview();
          camOnRef.current = false;
          setIsCameraOff(true);
        }
        let supported = true;
        try { supported = engine.isFeatureAvailableOnDevice(FeatureType.VideoVirtualBackground) !== false; } catch { supported = true; }
        setCallBackgroundSupported(supported);
        // The background picked on an earlier call comes back on its own.
        if (supported && callBackgroundRef.current?.id !== "none" && !applyBackground(engine)) setCallBackgroundSupported(false);
      }
      if (!current() || media.closed) { disposeMedia(media); return false; }
      // Joining with publication off guarantees that a pre-muted direct call
      // cannot send audio before the SDK has entered the channel.
      media.microphonePublicationPaused = !groupId && mutedRef.current;
      engine.muteLocalAudioStream(modMutedRef.current || mutedRef.current);
      media.channelJoining = true;
      const joined = engine.joinChannel(token.token, channelName, groupId ? ownUid : token.uid ?? 0, {
        publishMicrophoneTrack: !media.microphonePublicationPaused, publishCameraTrack: call.call_type === "video",
        autoSubscribeAudio: true, autoSubscribeVideo: call.call_type === "video",
      });
      if (joined < 0) throw new Error(`Call join failed: ${joined}`);
      if (groupId && userAddress) {
        const owned = media;
        groupPresenceRef.current = { groupId, uid: ownUid, wallet: userAddress, type: call.call_type };
        owned.releasePresence = holdGroupCallPresence(groupId, roster => {
          if (owned.closed) return;
          rosterRef.current = new Map(roster.map(entry => [entry.uid, entry.wallet]));
          const { camerasFull } = groupCallLoad(roster.filter(entry => entry.uid !== ownUid), null);
          camerasFullRef.current = camerasFull;
          setGroupCamerasFull(camerasFull);
          syncGroup(owned);
        }, { uid: ownUid, wallet: userAddress, type: call.call_type, cam: camOnRef.current },
        // A moderator acted: read the list again (the message itself is only a nudge).
        () => refreshModeration(owned, groupId));
        refreshModeration(owned, groupId);
        owned.modTimer = setInterval(() => refreshModeration(owned, groupId), 20_000);
      }
      return true;
    } catch (error) {
      disposeMedia(media);
      if (current()) log.error("Call connection failed", error);
      return false;
    }
  }, [clearTimeouts, publishCall, disposeMedia, endCall, userAddress, syncGroup, applyBackground, refreshModeration, setIsMuted]);

  /** Nobody answered the ring: a group room you are alone in closes after the ring window. */
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
    setIsCameraOff(true);
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
    if (!userAddress || currentCallRef.current || joiningGroupRef.current) return;
    // Read the room first, so a full one says so before any call screen opens.
    joiningGroupRef.current = true;
    let load: ReturnType<typeof groupCallLoad>;
    try { load = groupCallLoad(await readGroupCallRoster(group.id), userAddress); } finally { joiningGroupRef.current = false; }
    if (currentCallRef.current) return;
    if (load.full) {
      toastWarning(i18n.t("calls.callFull", "This call is full"), {
        description: i18n.t("calls.callFullHint", "It already has the most people a call can take. You can join once someone leaves."),
      });
      return;
    }
    const cameraOff = callType === "video" && load.camerasFull;
    if (cameraOff) {
      toastInfo(i18n.t("calls.camerasFull", "Cameras full"), {
        description: i18n.t("calls.camerasFullJoin", "You're in with your camera off. You can turn it on when someone turns theirs off."),
      });
    }
    dismissCallSummary();
    const generation = ++generationRef.current;
    startCameraOffRef.current = cameraOff;
    camerasFullRef.current = load.camerasFull; setGroupCamerasFull(load.camerasFull);
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
      let rang = false;
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
          rang = true;
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
      // A rung group stops ringing after the ring window. An open room (Public
      // Chat, or joining a call already going) stays up while you wait.
      if (rang && startedAtRef.current == null) armGroupTimeout(generation, "no_answer");
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
    if (!call.group_id) {
      callTimeoutRef.current = setTimeout(() => {
        if (generationRef.current === generation && startedAtRef.current == null) void endCall();
      }, 30_000);
    }
    try {
      const { data, error } = await callClient.from("call_sessions").update({ status: "connected" })
        .eq("id", call.id).eq("status", "ringing").select("id").maybeSingle();
      if (generationRef.current !== generation) return;
      if (error) throw error;
      if (!data) { await finishCall(undefined, false); return; }
      publishCall({ ...call, status: "connected" });
      const joined = await joinChannel(call, generation);
      if (generationRef.current === generation && !joined) await endCall();
      // Answered after everyone else had already gone: do not sit in an empty room.
      else if (joined && call.group_id && startedAtRef.current == null) armGroupTimeout(generation, "missed");
    } catch (error) {
      if (generationRef.current === generation) { log.error("Call accept failed", error); await endCall(); }
    } finally { if (generationRef.current === generation) joiningRef.current = false; }
  }, [callClient, clearTimeouts, publishCall, joinChannel, endCall, finishCall, armGroupTimeout]);

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

  const applyMicrophoneMute = useCallback((muted: boolean) => {
    const media = mediaRef.current;
    if (media?.channelJoining) {
      if (media.engine.muteLocalAudioStream(muted) !== 0) return false;
      if (!muted && media.microphonePublicationPaused) {
        if (media.engine.updateChannelMediaOptions({ publishMicrophoneTrack: true }) !== 0) return false;
        media.microphonePublicationPaused = false;
      }
    }
    setIsMuted(muted);
    return true;
  }, [setIsMuted]);

  const setNativeMute = useCallback((sessionId: string, muted: boolean) => {
    const engine = mediaRef.current?.engine;
    if (currentCallRef.current?.id !== sessionId || !engine) return false;
    // Muted by a moderator: the phone's call screen can't turn the mic back on.
    if (!muted && modMutedRef.current) return false;
    try { return applyMicrophoneMute(muted); } catch { return false; }
  }, [applyMicrophoneMute]);
  const toggleMute = useCallback(() => {
    // Muted by a moderator: the mic stays off until one of them unmutes you.
    if (modMutedRef.current) {
      toastInfo(i18n.t("calls.mutedByMod", "A moderator muted you"), {
        description: i18n.t("calls.mutedByModHint", "You can talk again once a moderator unmutes you."),
      });
      return;
    }
    if (currentCallRef.current) applyMicrophoneMute(!mutedRef.current);
  }, [applyMicrophoneMute]);
  /** A moderator mutes, unmutes or removes someone in this group call. */
  const moderateGroupMember = useCallback(async (wallet: string, action: CallModAction) => {
    const media = mediaRef.current;
    const groupId = currentCallRef.current?.group_id;
    if (!media || !groupId) return false;
    try {
      await moderateCall(groupId, wallet.toLowerCase(), action);
    } catch (error) {
      toastError((error instanceof Error && error.message) || i18n.t("calls.modFailed", "Couldn't do that. Try again."));
      return false;
    }
    // Tell everyone in the room to read the list again.
    sendGroupCallMod(groupId, { target: wallet.toLowerCase(), action });
    refreshModeration(media, groupId);
    return true;
  }, [refreshModeration]);
  const toggleSpeaker = useCallback(() => {
    const engine = mediaRef.current?.engine;
    if (!currentCallRef.current) return;
    speakerRef.current = !speakerRef.current;
    if (engine) {
      engine.setDefaultAudioRouteToSpeakerphone(speakerRef.current);
      engine.setEnableSpeakerphone(speakerRef.current);
    }
    setIsSpeakerOn(speakerRef.current);
  }, []);
  const toggleCamera = useCallback(() => {
    const engine = mediaRef.current?.engine;
    if (!engine) return;
    const on = !camOnRef.current;
    const presence = groupPresenceRef.current;
    // A group call with every camera slot taken: say why instead of doing nothing.
    if (on && presence && camerasFullRef.current) {
      toastInfo(i18n.t("calls.camerasFull", "Cameras full"), {
        description: i18n.t("calls.camerasFullHint", "You can turn yours on when someone turns theirs off."),
      });
      return;
    }
    if (on) { engine.enableVideo(); engine.enableLocalVideo(true); engine.startPreview(); engine.muteLocalVideoStream(false); }
    else { engine.muteLocalVideoStream(true); engine.stopPreview(); }
    camOnRef.current = on;
    setIsCameraOff(!on);
    if (presence) updateGroupCallPresence(presence.groupId, { uid: presence.uid, wallet: presence.wallet, type: presence.type, cam: on });
  }, []);
  const switchCamera = useCallback(() => { mediaRef.current?.engine.switchCamera(); }, []);
  const setCallBackground = useCallback((id: CallBackgroundId, photo?: string | null) => {
    const nextPhoto = id === "photo" ? photo ?? loadCallBackgroundPhoto() : null;
    const next = { id: id === "photo" && !nextPhoto ? "blur" as const : id, photo: nextPhoto };
    callBackgroundRef.current = next;
    setCallBackgroundState(next.id);
    saveCallBackground(next.id);
    const media = mediaRef.current;
    if (!media || media.closed) return;
    if (!applyBackground(media.engine)) {
      setCallBackgroundSupported(false);
      callBackgroundRef.current = { id: "none", photo: null };
      setCallBackgroundState("none");
      saveCallBackground("none");
      toastError(i18n.t("calls.backgroundFailed", "Background effects can't run on this device."));
    }
  }, [applyBackground]);
  const peerAddress = currentCall
    ? currentCall.caller_address === userAddress ? currentCall.recipient_address : currentCall.caller_address : "";
  const remoteCanvas = useMemo<VideoCanvas>(() => ({
    uid: remoteUid ?? 0, sourceType: VideoSourceType.VideoSourceRemote, renderMode: RenderModeType.RenderModeFit,
  }), [remoteUid]);
  const isRinging = !!currentCall && isConnecting && !isCallActive && currentCall.status === "ringing"
    && currentCall.caller_address === userAddress;
  const isGroupCall = !!currentCall?.group_id;
  const captionRoom = !currentCall || !isCallActive
    ? null
    : currentCall.group_id ? groupCallChannel(currentCall.group_id) : isSessionId(currentCall.id) ? `dm-call-${currentCall.id}` : null;
  const captionSpeakers = useMemo(() => {
    if (!currentCall) return [];
    const wallets = currentCall.group_id
      ? [userAddress, ...groupParticipants.map((p) => p.wallet ?? "")]
      : [currentCall.caller_address, currentCall.recipient_address];
    return [...new Set(wallets.map((w) => (w || "").toLowerCase()).filter(Boolean))];
  }, [currentCall, groupParticipants, userAddress]);
  const tapMicrophone = useCallback((onFrame: (pcm: Uint8Array) => void) => {
    const media = mediaRef.current;
    if (!media) return () => {};
    const engine = media.engine;
    const observer = {
      onRecordAudioFrame: (_channel: string, frame: { buffer?: Uint8Array }) => {
        if (frame?.buffer) onFrame(frame.buffer);
      },
    };
    try {
      // 1024 samples a call = 64 ms frames, the same pacing as the website.
      engine.setRecordingAudioFrameParameters(16000, 1, RawAudioFrameOpModeType.RawAudioFrameOpModeReadOnly, 1024);
      engine.getMediaEngine().registerAudioFrameObserver(observer);
    } catch (error) {
      log.warn("Microphone tap failed", error);
      return () => {};
    }
    return () => {
      try { engine.getMediaEngine().unregisterAudioFrameObserver(observer); } catch { /* engine already released */ }
    };
  }, []);
  const readGroupLevels = useCallback(() => {
    const levels = new Map(levelsRef.current);
    if (Date.now() - levelsAtRef.current > 1000) for (const key of [...levels.keys()]) if (key !== 0) levels.set(key, 0);
    return levels;
  }, []);
  const setCallVolume = useCallback((volume: number) => {
    try { mediaRef.current?.engine.adjustPlaybackSignalVolume(volume); } catch { /* call already over */ }
  }, []);
  return useMemo(() => ({
    captionRoom, captionSpeakers, tapMicrophone, setCallVolume,
    isGroupCall, groupParticipants, selfSpeaking, groupCamerasFull, startGroupCall, joinGroupCall, readGroupLevels,
    groupModeration, modMuted, moderateGroupMember,
    isRinging, callSummary, dismissCallSummary,
    isCallActive, isIncoming, currentCall, isConnecting, isMuted, isSpeakerOn, isCameraOff,
    callStartedAt, remoteUid, peerAddress, localCanvas: LOCAL_CANVAS, remoteCanvas, localVideoEpoch, remoteVideoEpoch,
    startCall, endCall, acceptCall, rejectCall: endCall, acceptCallById, declineCallById, setNativeMute, toggleMute, toggleSpeaker, toggleCamera,
    switchCamera, setCallMessageHandler, isMinimized, setMinimized,
    callBackground, callBackgroundSupported, setCallBackground,
  }), [callBackground, callBackgroundSupported, setCallBackground, captionRoom, captionSpeakers, tapMicrophone, setCallVolume, isGroupCall, groupParticipants, selfSpeaking, groupCamerasFull, startGroupCall, joinGroupCall, readGroupLevels,
    groupModeration, modMuted, moderateGroupMember,
    isRinging, callSummary, dismissCallSummary, isCallActive, isIncoming, currentCall, isConnecting, isMuted, isSpeakerOn, isCameraOff,
    callStartedAt, remoteUid, peerAddress, remoteCanvas, localVideoEpoch, remoteVideoEpoch, startCall, endCall, acceptCall, acceptCallById, declineCallById,
    setNativeMute, toggleMute, toggleSpeaker, toggleCamera, switchCamera, setCallMessageHandler, isMinimized]);
}
