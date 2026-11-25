import { usePerfProbe } from "../../libs/perfTrace";
import { useKeyboardSwap } from "../../hooks/useKeyboardSwap";
import { useTranslation as _useCopy } from 'react-i18next';
import { useDraftState } from '../../hooks/useDraftState';
import { DhbCoin } from "../common/DhbCoin";
import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Keyboard,
  AppState,
  Platform,
  ActivityIndicator,
  Pressable,
  ScrollView,
} from "react-native";
import SmartImage from "../common/SmartImage";
import Animated, { FadeIn, FadeOut, SlideInDown } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { localizeDmCallPreview } from "../../libs/callNote";
import Icon from "../ui/Icon";
import { sendAIChat } from "../../services/ai.service";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as VideoThumbnails from "expo-video-thumbnails";
import { toastError, toastInfo } from "../../libs/toast";
import {
  formatAttachmentSize,
  getAttachmentLabel,
  validateAttachment,
} from "../../libs/attachments";
import { runWithPermissions } from "../../libs/permissions.util";
import { clipboardHasImage, clipboardImageFile } from "../../libs/clipboard-image";
import { cleanVideoOptions, type DmVideoOptions } from "../../libs/dm-video-options";
import { withReplay, type DmDestructChoice } from "../../libs/dm-destruct";
import DmVideoStudio from "./DmVideoStudio";
import LockPriceRow from "./LockPriceRow";


/** Per-kind caps, matching the backend's DM limits. */
const DM_ATTACH_LIMITS = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 20 * 1024 * 1024 } as const;
import GifPicker from "./GifPicker";
import type { ChatAttachOption } from "./ChatAttachSheet";
import { useChatCardAccent } from "./ChatCard";
import WhenOpened from "../ui/WhenOpened";
import SmartReplyTray from "./SmartReplyTray";
import { useSmartReplies } from "../../hooks/useSmartReplies";
import { setAppPref, useAppPrefs } from "../../hooks/useAppPrefs";
import { useDraft } from "../../hooks/useDraft";
import type { SmartReplyTurn } from "../../services/ai.service";
import type { DmMessage, DmFee } from "../../services/dm/dm.types";
import { DM_TEXT_MAX_LENGTH } from "../../services/dm/dm.types";
import { haptic } from "../../libs/haptics";
import { useComposeTranslate } from "../../hooks/useComposeTranslate";
import LanguageSelectModal from "../Settings/LanguageSelectModal";
import MentionSuggestions from "../common/MentionSuggestions";
import { useMentions } from "../../hooks/useMentions";
import { optionalSkia } from "../../libs/skia";
import type { StudioResult } from "../Upload/PhotoStudio";
import type { StudioEdits } from "../Upload/studioPaint";
import { stripBold } from "../../libs/bold-markup";

// The post composer's photo editor (crop, looks, adjust, draw, text). Skia,
// so only on builds that carry it.
const PhotoStudio = optionalSkia(
  () => require("../Upload/PhotoStudio").default as typeof import("../Upload/PhotoStudio").default,
);


export type ChatMediaAttachment = {
  type: "image" | "video" | "audio" | "gif" | "file";
  uri: string;
  thumbnailUri?: string;
  mimeType?: string;
  /** Documents only — the picker's filename, needed for the upload and the bubble. */
  name?: string;
  /** Documents only — bytes, so the composer chip can show a size. */
  size?: number;
  /** Videos only — seconds, when the picker reports it. */
  duration?: number;
  /** Pay-to-unlock price (DHB) for a photo or video. */
  lockPrice?: number | null;
  /** Videos only — picked size, so the card and bubble keep the real shape. */
  width?: number;
  height?: number;
  /** Videos only — trim, cover, mirror, rotation and hide from the video sheet. */
  options?: DmVideoOptions;
  /** Self-destruct: gone after one view or a set time. */
  destruct?: DmDestructChoice | null;
  /** On-open timers: one replay allowed (sent folded into `destruct`). */
  destructReplay?: boolean;
  /** Photo editor: the untouched original and the edits over it. */
  editBaseUri?: string;
  studioEdits?: StudioEdits;
};

interface ChatInputBarProps {
  onSendText: (text: string) => Promise<boolean>;
  onSendMedia: (attachment: ChatMediaAttachment, caption?: string) => Promise<boolean>;
  /** Offer "Lock photo" (pay to unlock) on a picked photo or video. 1:1 DMs only. */
  allowLock?: boolean;
  onSendGif: (url: string, caption?: string) => Promise<boolean>;
  onStartVoice: () => void;
  onTypingChange?: (isTyping: boolean) => void;
  disabled?: boolean;
  disabledMessage?: string;
  dmFee?: DmFee | null;
  /** Message being replied to — shows preview strip. */
  replyTo?: DmMessage | null;
  onCancelReply?: () => void;
  /** Goes up by one to open the camera (answering a photo with a photo or video). */
  cameraRequest?: number;
  /** Message being edited — prefills input. */
  editingMessage?: DmMessage | null;
  onCancelEdit?: () => void;
  sending?: boolean;
  /** Current voluntary tip amount set by user (0 = no tip). */
  tipAmount?: number;
  /** Triggered when user taps the tip (💎) button to open the tip sheet. */
  onTipPress?: () => void;
  /** Clear the current voluntary tip. */
  onClearTip?: () => void;
  /** Current DHB balance of the user (for display & validation). */
  dhbBalance?: number | null;
  /**
   * The clock beside the tip gem: send this message later. Handed what is
   * typed and a way to empty the box once it has been scheduled. Left out,
   * there is no clock (paid chats, a chat that does not exist yet).
   */
  onSchedulePress?: (draft: { text: string; hasAttachment: boolean; clear: () => void }) => void;
  /** Messages already waiting in this chat; puts a dot on the clock. */
  scheduledCount?: number;
  /** Trigger poll creation sheet. */
  onPollPress?: () => void;
  /** Opens the Notes sheet (your 24-hour note). */
  onNotePress?: () => void;
  /** Pre-fill the text input on mount (e.g. shared post URL). */
  initialText?: string;
  /** Take the caret as soon as the box can be typed in (chat opened from New message). */
  autoFocus?: boolean;
  /**
   * Recent turns, oldest first. Supplying this turns on the reply orb; leave it
   * off and the composer is exactly what it was.
   */
  thread?: SmartReplyTurn[];
  /** Who the user is talking to — labels the other side for the drafter. */
  peerName?: string;
  /**
   * Scope this composer's text is saved under, so a half-typed message survives
   * backing out of the thread or the app being killed. MUST be stable for the
   * life of the conversation — pass the peer, never the conversation id, which
   * does not exist yet the first time you message someone (see libs/draft-cache).
   * Omit it and the composer behaves as before.
   */
  draftKey?: string | null;
}


const TYPING_IDLE_MS = 5000;

/* Composer metrics. The TextInput's own box is zeroed, Android font padding
 * included, or the text rides high in the field. */
const LINE = 20;
/* The B bar: a squared + (like our buttons), a round field with send inside. */
const PLUS_BOX = { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)" } as const;
const FIELD_BOX = { minHeight: 38, maxHeight: 140, borderRadius: 19, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", paddingLeft: 14, paddingRight: 4 } as const;
const SEND_DOT = { width: 30, height: 30, borderRadius: 15, marginBottom: 3, marginLeft: 6 } as const;
/* The drawer + opens: four squared tiles a row, each with its name. */
const TRAY = { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8, paddingTop: 6, paddingBottom: 10, rowGap: 12 } as const;
const TRAY_CELL = { width: "25%", alignItems: "center" } as const;
const TRAY_TILE = { width: 54, height: 54, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" } as const;
const TRAY_LABEL = { marginTop: 6, fontSize: 11.5, fontWeight: "600", textAlign: "center", lineHeight: 14, paddingHorizontal: 2 } as const;
const INPUT_TEXT = {
  margin: 0,
  padding: 0,
  minHeight: LINE,
  maxHeight: 124,
  includeFontPadding: false,
  textAlignVertical: "top",
} as const;

const ChatInputBarComponent: React.FC<ChatInputBarProps> = ({
  onSendText,
  onSendMedia,
  allowLock = false,
  onSendGif,
  onStartVoice,
  onTypingChange,
  disabled = false,
  disabledMessage,
  dmFee,
  replyTo,
  onCancelReply,
  cameraRequest = 0,
  editingMessage,
  onCancelEdit,
  sending = false,
  tipAmount = 0,
  onTipPress,
  onClearTip,
  dhbBalance,
  onSchedulePress,
  scheduledCount = 0,
  onPollPress,
  onNotePress,
  initialText,
  autoFocus = false,
  thread,
  peerName,
  draftKey,
}) => {
  usePerfProbe("ChatInputBar");
  const { t: _copy } = _useCopy();
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const keyboardSwap = useKeyboardSwap(inputRef);
  // Once, the first time the box is typeable: a new chat starts disabled
  // while it is being created, so focusing on mount alone can miss it.
  const autoFocused = useRef(false);
  useEffect(() => {
    if (!autoFocus || disabled || autoFocused.current) return;
    autoFocused.current = true;
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [autoFocus, disabled]);
  const [ordinaryText, setOrdinaryText] = useDraft(draftKey);
  const [editText, setEditText] = useDraftState(editingMessage && draftKey ? `${draftKey}:edit:${editingMessage._id}` : null, editingMessage?.original?.content || editingMessage?.content || "");
  const text = editingMessage ? editText : ordinaryText;
  const setText = editingMessage ? setEditText : setOrdinaryText;
  const [media, setMedia] = useState<ChatMediaAttachment | null>(null);
  // Photos and videos picked for the edit screen; it is open while any are here.
  const [studio, setStudio] = useState<ChatMediaAttachment[]>([]);
  const [studioActive, setStudioActive] = useState(0);
  // The edit screen opens on a pick; Confirm brings the picks back here as a
  // row above the box. X drops only what was picked since it opened.
  const [studioOpen, setStudioOpen] = useState(false);
  const [photoEditing, setPhotoEditing] = useState(false);
  const studioOpenRef = useRef(false);
  studioOpenRef.current = studioOpen;
  const studioBase = useRef(0);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const accent = useChatCardAccent();
  // The paperclip: one button, then "photo or video" (gallery) or "file or
  // audio" (anything else on the phone).
  const [composerFocused, setComposerFocused] = useState(false);
  // A copied screenshot or picture: offered as "Paste image" while typing
  // and in the attach sheet, since iOS text fields can't paste pictures.
  const [clipImage, setClipImage] = useState(false);
  const refreshClipImage = useCallback(() => {
    void clipboardHasImage().then(setClipImage);
  }, []);
  // Screenshot taken in another app, then back here with the field still open.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") refreshClipImage(); });
    return () => sub.remove();
  }, [refreshClipImage]);
  const [enhancing, setEnhancing] = useState(false);
  // Down for THIS message only - the send handler drops the tray whose
  // drafts the send just invalidated. Switching the feature off is a
  // separate thing, and lives in the smartReplies preference.
  const [trayDismissed, setTrayDismissed] = useState(false);
  const typingRef = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const smartRepliesEnabled = useAppPrefs().smartReplies;
  const smartReplies = useSmartReplies(thread ?? [], peerName);
  const hasThread = !!thread && thread.length > 0;

  // A suggested reply answers an INCOMING message. When the user holds the last
  // word there is nothing to reply to, so the tray stands down rather than
  // drafting follow-ups to oneself — and no model call is spent on it either.
  const awaitingReply = hasThread && thread![thread!.length - 1]?.from === "them";


  // Thread tail a draft has already been spent on. One model call per message,
  // whichever side sent it: re-rendering and re-showing the tray must never
  // re-spend it. A new message changes the key, which re-arms it.
  const draftedFor = useRef<string | null>(null);

  // Read through a ref so the effect below can depend on the one thing that
  // should actually retrigger it — the newest message — instead of re-running
  // on every keystroke and every render of the hook.
  const latest = useRef({ smartReplies, text, hasThread });
  latest.current = { smartReplies, text, hasThread };

  /**
   * The tray is up with a socket and two empty slots, so waiting for a tap
   * into the composer before drafting would leave it showing nothing in the
   * one moment it is being looked at. Spend the call when the thread tail
   * changes instead — held back only when the user has already started typing,
   * because then they know what to say.
   *
   * Only an incoming tail is drafted against: once the user has replied, the
   * tray is gone until the other side speaks again. Mirrors dehubweb's
   * ChatInput.
   */
  useEffect(() => {
    // Switched off is switched off: no tray, and no model call behind it.
    if (!hasThread || !awaitingReply || !smartRepliesEnabled) return;
    const { smartReplies: sr, text: draft } = latest.current;
    if (draft.trim()) return;
    if (draftedFor.current === sr.tailKey) return;
    draftedFor.current = sr.tailKey;
    // 'error' as well as 'idle': the hook only rewinds itself to idle when a
    // SUCCESSFUL draft goes stale, so a single failure would otherwise leave
    // the tray showing that failure for every message after it.
    if (sr.status === "idle" || sr.status === "error") sr.generate();
  }, [hasThread, awaitingReply, smartRepliesEnabled, smartReplies.tailKey]);

  // A new message re-arms the per-message stand-down. It does NOT reopen a
  // tray the user switched off — that is what the preference is for.
  useEffect(() => {
    setTrayDismissed(false);
  }, [smartReplies.tailKey]);

  // The x switches the feature off, in every thread, until it is switched
  // back on. There is no orb anywhere else to press once it is down, so the
  // toast has to say where the switch lives — otherwise this is a control
  // that makes a feature disappear with no way back.
  const handleDismissTray = useCallback(() => {
    setAppPref("smartReplies", false);
    toastInfo(t("messages.smartRepliesOff", "Suggested replies turned off"), {
      description: t(
        "messages.smartRepliesOffWhere",
        "Turn them back on in Settings → Messages.",
      ),
      actionLabel: t("messages.smartRepliesUndo", "Undo"),
      onActionPress: () => setAppPref("smartReplies", true),
    });
  }, [t]);

  /**
   * Drop a suggestion into the composer rather than sending it. The user still
   * owns the send — a drafted line that fires on one tap is how the wrong
   * thing gets sent to the wrong person.
   */
  const handlePickSuggestion = useCallback((suggestion: string) => {
    setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${suggestion}` : suggestion));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [setText]);

  // Pre-fill with shared text on mount — but only into an empty box, so a
  // draft left in this thread days ago is not overwritten by a share.
  useEffect(() => {
    if (!initialText) return;
    let adopted = false;
    setText((prev) => {
      if (prev) return prev;
      adopted = true;
      return initialText;
    });
    if (adopted) requestAnimationFrame(() => inputRef.current?.focus());
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setText]);

  // Pre-fill when editing
  useEffect(() => {
    if (editingMessage) {
      setEditText.initialize(editingMessage.original?.content || editingMessage.content || "");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editingMessage, setEditText]);


  const emitTyping = useCallback(
    (isTyping: boolean) => {
      if (typingRef.current === isTyping) return;
      typingRef.current = isTyping;
      onTypingChange?.(isTyping);
    },
    [onTypingChange],
  );

  const handleTextChange = useCallback(
    (val: string) => {
      if (val.length > DM_TEXT_MAX_LENGTH) return;
      setText(val);
      emitTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => emitTyping(false), TYPING_IDLE_MS);
    },
    [emitTyping, setText],
  );

  const mentions = useMentions(text, handleTextChange);

  // Cleanup typing timer on unmount
  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (typingRef.current) emitTyping(false);
    },
    [emitTyping],
  );


  const sendInFlight = useRef(false);
  // A plain line (no attachment, tip, reply or edit) goes to the send queue,
  // which keeps the order, so the next one need not wait for the server to
  // confirm it. Sending held the box until then, and a second message typed
  // fast was dropped on Send. The same text is never taken twice: a double tap
  // lands before the box has redrawn empty.
  const plainTaken = useRef<string | null>(null);
  if (plainTaken.current !== null && plainTaken.current !== text) plainTaken.current = null;
  const handleSend = useCallback(async () => {
    if (sending || sendInFlight.current) return;
    const plain = !gifUrl && !studio.length && !media && !editingMessage && !tipAmount && !replyTo;
    if (plain) {
      if (!text.trim() || plainTaken.current === text) return;
      plainTaken.current = text;
    } else {
      sendInFlight.current = true;
    }
    try {
    haptic.tap();

    // Whatever is in the tray was drafted against a thread that no longer ends
    // where it did, so it goes down with the send and comes back up on the next
    // tail — as follow-ups, since the user now holds the last word.
    setTrayDismissed(true);

    // GIF with optional caption
    if (gifUrl) {
      const caption = text.trim() || undefined;
      if (!(await onSendGif(gifUrl, caption))) return;
      setGifUrl(null);
      setText.complete(text, "");
      return;
    }

    // Everything in the edit screen: back to the chat at once, then one
    // message per photo/video in order, the caption riding on the first.
    // Whatever fails comes back into the edit screen.
    if (studio.length) {
      const queue = [...studio];
      const caption = text.trim() || undefined;
      setStudioOpen(false);
      setStudio([]);
      setStudioActive(0);
      setText.complete(text, "");
      for (let i = 0; i < queue.length; i++) {
        const m = queue[i];
        const base = m.type === "video" ? { ...m, options: cleanVideoOptions(m.options, m.duration) } : m;
        const out = m.destruct ? { ...base, destruct: withReplay(m.destruct, m.destructReplay) ?? null } : base;
        if (!(await onSendMedia(out, i === 0 ? caption : undefined))) {
          setStudio(queue.slice(i));
          if (i === 0 && caption) setText(caption);
          return;
        }
      }
      return;
    }

    // Audio or a document, with optional caption
    if (media) {
      const caption = text.trim() || undefined;
      const out = media.type === "video" ? { ...media, options: cleanVideoOptions(media.options, media.duration) } : media;
      if (!(await onSendMedia(out, caption))) return;
      setMedia(null);
      setText.complete(text, "");
      return;
    }

    // Text only (or tip-only with no content)
    const trimmed = text.trim();
    // Allow sending if there's text OR if a tip is attached (tip-only send)
    if (!trimmed && !tipAmount) return;
    if (!editingMessage) {
      setOrdinaryText('');
      inputRef.current?.clear();
    }
    let sent = false;
    try { sent = await onSendText(trimmed); } catch { sent = false; }
    if (!sent) {
      if (!editingMessage) setOrdinaryText(current => current.trim() ? current : text);
      return;
    }
    if (editingMessage) setEditText.complete(text, "");
    emitTyping(false);
    } finally {
      if (plain) plainTaken.current = null;
      else sendInFlight.current = false;
    }
  }, [text, media, studio, gifUrl, sending, onSendText, onSendMedia, onSendGif, emitTyping, tipAmount, setText, editingMessage, setEditText, setOrdinaryText, replyTo]);


  /** Picked photos/videos join the edit screen, which opens on the newest. */
  const addToStudio = useCallback((items: ChatMediaAttachment[]) => {
    if (!items.length) return;
    Keyboard.dismiss();
    setGifUrl(null);
    setMedia(null);
    setStudio((prev) => {
      if (!studioOpenRef.current) { studioBase.current = prev.length; studioOpenRef.current = true; }
      setStudioActive(prev.length);
      return [...prev, ...items];
    });
    setStudioOpen(true);
  }, []);
  const openStudioAt = useCallback((i: number) => {
    Keyboard.dismiss();
    studioBase.current = studio.length;
    setStudioActive(i);
    setStudioOpen(true);
  }, [studio.length]);
  const cancelStudio = useCallback(() => {
    setStudioOpen(false);
    setStudio((prev) => prev.slice(0, studioBase.current));
    setStudioActive(0);
  }, []);
  const patchStudio = useCallback((patch: Partial<ChatMediaAttachment>) => {
    setStudio((prev) => prev.map((m, i) => (i === studioActive ? { ...m, ...patch } : m)));
  }, [studioActive]);
  const removeStudioAt = useCallback((at: number) => {
    setStudio((prev) => {
      const next = prev.filter((_, i) => i !== at);
      if (at < studioBase.current) studioBase.current -= 1;
      if (!next.length) setStudioOpen(false);
      setStudioActive((a) => Math.max(0, Math.min(a > at ? a - 1 : a, next.length - 1)));
      return next;
    });
  }, []);
  const removeStudioItem = useCallback(() => removeStudioAt(studioActive), [removeStudioAt, studioActive]);

  /** Photos AND videos from the gallery in one picker. */
  const handlePickGallery = useCallback(async () => {
    await runWithPermissions(["photos"], async () => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.All,
          allowsMultipleSelection: true,
          selectionLimit: 10,
          quality: 0.85,
          videoMaxDuration: 600,
          // iPhone photos come back as JPEG rather than HEIC.
          preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        });
        if (result.canceled || !result.assets?.length) return;
        const picked: ChatMediaAttachment[] = [];
        for (const asset of result.assets) {
          if (asset.type === "video" || (asset.mimeType || "").startsWith("video/")) {
            if (asset.fileSize && asset.fileSize > DM_ATTACH_LIMITS.video) {
              toastError(t("dm.attachTooLarge", { defaultValue: "That file is over the {{size}} MB limit.", size: DM_ATTACH_LIMITS.video / 1024 / 1024 }));
              continue;
            }
            let thumb: string | undefined;
            try {
              thumb = (await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 500 })).uri;
            } catch {
              /* ignore */
            }
            picked.push({
              type: "video",
              uri: asset.uri,
              thumbnailUri: thumb,
              mimeType: asset.mimeType,
              // expo-image-picker reports milliseconds.
              duration: asset.duration ? asset.duration / 1000 : undefined,
              width: asset.width || undefined,
              height: asset.height || undefined,
              size: asset.fileSize || undefined,
            });
            continue;
          }
          if (asset.fileSize && asset.fileSize > DM_ATTACH_LIMITS.image) {
            toastError(t("dm.attachTooLarge", { defaultValue: "That file is over the {{size}} MB limit.", size: DM_ATTACH_LIMITS.image / 1024 / 1024 }));
            continue;
          }
          picked.push({ type: "image", uri: asset.uri, mimeType: asset.mimeType || "image/jpeg", width: asset.width || undefined, height: asset.height || undefined, size: asset.fileSize || undefined });
        }
        addToStudio(picked);
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err?.code !== "E_PICKER_CANCELLED") console.error("[ChatInputBar] gallery picker error", e);
      }
    });
  }, [addToStudio]);

  /**
   * The camera, straight from an "Opened" photo's camera button: what you
   * take joins the edit screen like a picked photo, and goes out as a reply
   * to that photo (the reply is set before this opens).
   */
  const handleCamera = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        toastError(t("stories.cameraOff", { defaultValue: "Camera access is off. Turn it on in Settings, or pick from Photos." }));
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images", "videos"], quality: 0.85, videoMaxDuration: 60 });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      if (asset.type === "video" || (asset.mimeType || "").startsWith("video/")) {
        let thumb: string | undefined;
        try {
          thumb = (await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 500 })).uri;
        } catch {
          /* ignore */
        }
        addToStudio([{
          type: "video",
          uri: asset.uri,
          thumbnailUri: thumb,
          mimeType: asset.mimeType || "video/mp4",
          duration: asset.duration ? asset.duration / 1000 : undefined,
          width: asset.width || undefined,
          height: asset.height || undefined,
          size: asset.fileSize || undefined,
        }]);
        return;
      }
      addToStudio([{ type: "image", uri: asset.uri, mimeType: asset.mimeType || "image/jpeg", width: asset.width || undefined, height: asset.height || undefined, size: asset.fileSize || undefined }]);
    } catch (e) {
      console.error("[ChatInputBar] camera error", e);
    }
  }, [addToStudio, t]);
  const lastCameraRequest = useRef(cameraRequest);
  useEffect(() => {
    if (cameraRequest === lastCameraRequest.current) return;
    lastCameraRequest.current = cameraRequest;
    void handleCamera();
  }, [cameraRequest, handleCamera]);

  const handlePasteImage = useCallback(async () => {
    try {
      const file = await clipboardImageFile();
      setClipImage(false);
      if (!file) return;
      if (file.size && file.size > DM_ATTACH_LIMITS.image) {
        toastError(t("dm.attachTooLarge", { defaultValue: "That file is over the {{size}} MB limit.", size: DM_ATTACH_LIMITS.image / 1024 / 1024 }));
        return;
      }
      haptic.tap();
      addToStudio([{ type: "image", uri: file.uri, mimeType: "image/jpeg", width: file.width, height: file.height, size: file.size }]);
    } catch (e) {
      console.error("[ChatInputBar] paste image error", e);
    }
  }, [addToStudio]);

  /** Any file on the phone: audio, video, a photo or a document. */
  const handlePickAnyFile = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const mime = asset.mimeType || "";
      const top = mime.split("/")[0];
      const size = asset.size ?? 0;
      if (top === "image" || top === "video" || top === "audio") {
        const cap = DM_ATTACH_LIMITS[top];
        if (size > cap) {
          toastError(t("dm.attachTooLarge", { defaultValue: "That file is over the {{size}} MB limit.", size: cap / 1024 / 1024 }));
          return;
        }
        let thumb: string | undefined;
        if (top === "video") {
          try {
            thumb = (await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 500 })).uri;
          } catch {
            /* ignore */
          }
        }
        if (top === "audio") {
          setGifUrl(null);
          setStudio([]);
          setMedia({ type: top, uri: asset.uri, mimeType: mime, name: asset.name || undefined, size });
          return;
        }
        addToStudio([{ type: top, uri: asset.uri, mimeType: mime, name: asset.name || undefined, size, thumbnailUri: thumb }]);
        return;
      }
      const picked = { uri: asset.uri, name: asset.name || "file", mimeType: mime || "application/octet-stream", size };
      const check = validateAttachment(picked);
      if (!check.ok) {
        toastError(check.error!);
        return;
      }
      setGifUrl(null);
      setStudio([]);
      setMedia({ type: "file", uri: picked.uri, mimeType: picked.mimeType, name: picked.name, size: picked.size });
    } catch (e) {
      console.error("[ChatInputBar] file picker error", e);
      toastError(t("dm.attachFailed"));
    }
  }, [addToStudio]);


  const handleGifPicked = useCallback((url: string) => {
    setGifPickerVisible(false);
    setMedia(null); // clear media if any
    setGifUrl(url);
    keyboardSwap.restore();
  }, [keyboardSwap]);

  const handleRemoveMedia = useCallback(() => {
    setMedia(null);
    setGifUrl(null);
  }, []);

  const handleCancelReply = useCallback(() => {
    onCancelReply?.();
  }, [onCancelReply]);

  const handleCancelEdit = useCallback(() => {
    setEditText.clear();
    onCancelEdit?.();
  }, [onCancelEdit, setEditText]);


  const translator = useComposeTranslate(text, setText);

  const handleEnhance = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || enhancing) return;
    setEnhancing(true);
    try {
      const res = await sendAIChat({
        messages: [
          {
            role: 'user',
            content: `Enhance this message to be more engaging, clear, and well-written while keeping the same meaning and tone. Return ONLY the enhanced message text, nothing else.\n\nMessage: ${trimmed}`,
          },
        ],
      });
      if (res.response) setText(res.response);
    } catch (e) {
      console.error('[ChatInputBar] enhance error', e);
    } finally {
      setEnhancing(false);
    }
  }, [text, enhancing, setText]);

  const hasContent = text.trim().length > 0 || !!media || !!gifUrl || studio.length > 0;
  // Show send button when there's content OR a tip is attached (tip-only send)
  const showSendButton = hasContent || tipAmount > 0;
  // The tray is up in every thread whose last word belongs to the other side —
  // the only moment a suggested reply means anything. Whether the drafter found
  // something to say is still a question the tray ANSWERS, with the orb there to
  // press; that check must never gate the mount. Anything the user has already
  // started (text, an attachment, an edit) takes the space back.
  const showTray =
    hasThread && awaitingReply && smartRepliesEnabled && !trayDismissed && !hasContent && !editingMessage && !composerFocused;
  const hasMediaOrGif = !!media || !!gifUrl || studio.length > 0;
  const placeholder = hasMediaOrGif ? t("dm.addCaption") : t("dm.messagePlaceholder");

  // Fee / tip display logic
  const feeRequired = !!dmFee?.required && !dmFee?.hasFreeAccess;
  const hasFreeAccess = !!dmFee?.hasFreeAccess && (dmFee?.fee ?? 0) > 0;
  const effectiveFee = feeRequired ? (dmFee?.fee ?? 0) : 0;
  // When tip covers the fee (tip >= fee), total = tip only (single on-chain tx)
  // Otherwise total = fee (no tip) or just tip (no fee)
  const totalCost =
    tipAmount > 0 && feeRequired
      ? tipAmount // tip covers the fee — single payment
      : effectiveFee + tipAmount;
  const showCostOnSend = totalCost > 0;
  const canAddTip = true; // Tips allowed even with per-message fee (tip must cover the fee)
  // When fee required, tip must be >= fee to cover it
  const tipBelowFee = feeRequired && tipAmount > 0 && tipAmount < effectiveFee;
  const insufficientBalance =
    showCostOnSend && dhbBalance != null && dhbBalance < totalCost;

  // + drops the keyboard and opens the drawer in its place; tapping the
  // field (or + again) closes it.
  const toggleTray = () => {
    haptic.tap();
    if (trayOpen) {
      setTrayOpen(false);
      return;
    }
    Keyboard.dismiss();
    refreshClipImage();
    setTrayOpen(true);
  };
  // Scheduling is for a new message, so the clock steps aside during an edit.
  const canSchedule = !!onSchedulePress && !editingMessage;
  const handleSchedule = () => {
    haptic.tap();
    onSchedulePress?.({
      text: text.trim(),
      hasAttachment: !!(media || studio.length || gifUrl),
      clear: () => setText.complete(text, ""),
    });
  };
  // Everything the composer had as its own button, now behind the +. Each
  // tile runs exactly what its old button ran; one a chat doesn't allow
  // (tips, polls, schedule while editing) is left out.
  const trayOptions: (ChatAttachOption & { onLongPress?: () => void })[] = [
    { key: "gallery", icon: "Image", label: t("dm.attachPhotoOrVideo", { defaultValue: "Photo or video" }), onPress: () => { void handlePickGallery(); } },
    { key: "any", icon: "Paperclip", label: t("dm.attachFileOrAudio", { defaultValue: "File or audio" }), onPress: () => { void handlePickAnyFile(); } },
    { key: "gif", icon: "Smile", label: t("dm.trayGif", { defaultValue: "GIF & emoji" }), onPress: () => setGifPickerVisible(true) },
    { key: "voice", icon: "Mic", label: t("dm.trayVoice", { defaultValue: "Voice note" }), onPress: onStartVoice, disabled: sending },
    ...(canAddTip && onTipPress
      ? [{ key: "tip", icon: "Gem" as const, label: t("dm.trayTip", { defaultValue: "Tip" }), onPress: onTipPress }]
      : []),
    ...(onPollPress
      ? [{ key: "poll", icon: "ChartColumn" as const, label: t("dm.trayPoll", { defaultValue: "Poll" }), onPress: onPollPress }]
      : []),
    ...(canSchedule
      ? [{ key: "schedule", icon: "Clock" as const, label: t("dm.traySchedule", { defaultValue: "Schedule" }), onPress: handleSchedule }]
      : []),
    ...(onNotePress
      ? [{ key: "note", icon: "Quote" as const, label: t("notes.yourNote", { defaultValue: "Your note" }), onPress: onNotePress }]
      : []),
    ...(clipImage
      ? [{ key: "paste", icon: "ClipboardPaste" as const, label: t("dm.pasteImage", { defaultValue: "Paste image" }), onPress: () => { void handlePasteImage(); } }]
      : []),
    // These work on what is already typed, so they stay greyed out until there is some.
    { key: "translate", icon: "Languages", label: t("common.translate"), onPress: () => { void translator.translate(); }, onLongPress: translator.openPicker, disabled: !text.trim() || translator.busy },
    { key: "enhance", icon: "Sparkles", label: t("dm.trayFix", { defaultValue: "Fix with AI" }), onPress: () => { void handleEnhance(); }, disabled: !text.trim() },
  ];

  if (disabled) {
    return (
      <View className="px-4 py-3 bg-theme-neutrals-900 border-t border-theme-neutrals-800">
        <Text className="text-theme-neutrals-500 text-center text-sm">
          {disabledMessage || t("dm.messagingUnavailable")}
        </Text>
      </View>
    );
  }

  return (
    <>
      <View className="border-t border-white/25">
        {/* Reply-to preview */}
        {replyTo && (
          <Animated.View
            entering={SlideInDown.duration(200)}
            exiting={FadeOut.duration(100)}
            className="flex-row items-center px-4 py-2 bg-theme-neutrals-800/50 mx-3 mt-2 rounded-lg"
          >
            <View className="flex-1 mr-2">
              <Text className="text-[11px] text-accent font-medium">
                {t("dm.replyingTo")}
              </Text>
              <Text
                className="text-[13px] text-theme-neutrals-400 mt-0.5"
                numberOfLines={1}
              >
                {localizeDmCallPreview(replyTo, t) || stripBold(replyTo.content) || (replyTo.msgType === "voice" ? t("dm.voiceNoteEmoji") : t("dm.mediaEmoji"))}
              </Text>
            </View>
            <TouchableOpacity onPress={handleCancelReply} hitSlop={8}>
              <Icon name="X" size={18} color="#A6A9AC" />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Edit-mode indicator */}
        {editingMessage && (
          <Animated.View
            entering={SlideInDown.duration(200)}
            exiting={FadeOut.duration(100)}
            className="flex-row items-center px-4 py-2 bg-theme-neutrals-800/50 border-l-2 border-white/20 mx-3 mt-2 rounded-lg"
          >
            <Icon name="Pencil" size={14} color="#D4D4D8" />
            <View className="flex-1 ml-2">
              <Text className="text-[11px] text-white/80 font-medium">
                {t("dm.editingMessage")}
              </Text>
              <Text
                className="text-[13px] text-theme-neutrals-400 mt-0.5"
                numberOfLines={1}
              >
                {editingMessage.original?.content || editingMessage.content}
              </Text>
            </View>
            <TouchableOpacity onPress={handleCancelEdit} hitSlop={8}>
              <Icon name="X" size={18} color="#A6A9AC" />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Voluntary tip badge */}
        {tipAmount > 0 && (
          <Animated.View
            entering={FadeIn.duration(150)}
            exiting={FadeOut.duration(100)}
            className="flex-row items-center mx-3 mt-2 px-3 py-1.5 bg-amber-500/10 rounded-lg self-start"
          >
            <Icon name="Gem" size={12} color="#D4D4D8" />
            <Text className="text-[11px] text-amber-400 font-medium ml-1">{_copy("copy.b74733d38668", { defaultValue: "Tip: " })}{tipAmount} <DhbCoin />
            </Text>
            <TouchableOpacity
              onPress={onClearTip}
              hitSlop={8}
              className="ml-2"
            >
              <Icon name="CircleX" size={14} color="#A6A9AC" />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Balance / validation indicator — shown when a cost is involved */}
        {showCostOnSend && (tipBelowFee || dhbBalance != null) && (
          <Animated.View
            entering={FadeIn.duration(150)}
            className={`flex-row items-center mx-3 mt-1.5 px-3 py-1 rounded-lg self-start ${
              tipBelowFee || insufficientBalance ? "bg-white/10" : "bg-white/5"
            }`}
          >
            <Icon
              name={tipBelowFee ? "CircleAlert" : "Wallet"}
              size={11}
              color={tipBelowFee || insufficientBalance ? "#F4F4F5" : "#A6A9AC"}
            />
            <Text
              className={`text-[12px] font-medium ml-1 ${
                tipBelowFee || insufficientBalance ? "text-white/80" : "text-theme-neutrals-400"
              }`}
            >
              {tipBelowFee
                ? t("dm.tipBelowFee", { amount: effectiveFee })
                : insufficientBalance
                ? t("dm.insufficientTokenBalance", { amount: Number(dhbBalance).toLocaleString() })
                : t("dm.tokenBalance", { amount: Number(dhbBalance!).toLocaleString() })}
            </Text>
          </Animated.View>
        )}

        {/* Photos and videos open straight into the edit screen. */}
        {studio.length > 0 && (() => {
          const cur = studio[Math.min(studioActive, studio.length - 1)];
          return (
            <DmVideoStudio
              visible={studioOpen}
              onClose={cancelStudio}
              onConfirm={() => { setStudioOpen(false); setTimeout(() => inputRef.current?.focus(), 350); }}
              uri={cur.uri}
              kind={cur.type === "video" ? "video" : "image"}
              strip={studio.map((m, i) => ({ key: `${i}:${m.uri}`, uri: m.thumbnailUri || m.uri, kind: m.type === "video" ? "video" : "image", locked: m.lockPrice != null }))}
              active={studioActive}
              onSelect={setStudioActive}
              onAddMore={() => { void handlePickGallery(); }}
              onRemove={removeStudioItem}
              duration={cur.duration}
              width={cur.width}
              height={cur.height}
              size={cur.size}
              options={cur.options ?? {}}
              onOptionsChange={(o: DmVideoOptions) => patchStudio({ options: o })}
              destruct={cur.destruct ?? null}
              onDestructChange={(c: DmDestructChoice | null) => patchStudio({ destruct: c })}
              destructReplay={!!cur.destructReplay}
              onDestructReplayChange={(on: boolean) => patchStudio({ destructReplay: on })}
              onCoverFrame={(uri) => patchStudio({ thumbnailUri: uri })}
              lockPrice={allowLock ? cur.lockPrice ?? null : null}
              onLockPriceChange={allowLock ? (price) => patchStudio({ lockPrice: price }) : undefined}
              onEditPhoto={PhotoStudio && cur.type === "image" && !/gif/i.test(cur.mimeType || "") ? () => {
                setStudioOpen(false);
                setTimeout(() => setPhotoEditing(true), 300);
              } : undefined}
            />
          );
        })()}
        {PhotoStudio && photoEditing && studio.length > 0 && (() => {
          const cur = studio[Math.min(studioActive, studio.length - 1)];
          const back = () => { setPhotoEditing(false); setTimeout(() => setStudioOpen(true), 300); };
          return (
            <PhotoStudio
              photos={[{ baseUri: cur.editBaseUri ?? cur.uri, mimeType: cur.mimeType, edits: cur.studioEdits }]}
              startIndex={0}
              startTab="crop"
              onClose={back}
              onDone={(results: StudioResult[]) => {
                const r = results[0];
                if (r) {
                  patchStudio({
                    editBaseUri: cur.editBaseUri ?? cur.uri,
                    studioEdits: r.edits,
                    uri: r.uri,
                    thumbnailUri: undefined,
                    width: r.width,
                    height: r.height,
                    mimeType: r.mimeType,
                    name: r.fileName,
                    size: undefined,
                  });
                }
                back();
              }}
            />
          );
        })()}
        {studio.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10, paddingHorizontal: 12, paddingTop: 12 }}>
            {studio.map((m, i) => {
              const veiled = m.lockPrice != null || m.options?.hidden === "reveal";
              return (
                <View key={`${i}:${m.uri}`}>
                  <Pressable onPress={() => openStudioAt(i)} accessibilityRole="button"
                    accessibilityLabel={_copy("dmVideo.editItem", { defaultValue: "Edit item {{value1}}", value1: i + 1 })}
                    style={{ width: 64, height: 64, borderRadius: 10, overflow: "hidden" }} className="bg-theme-neutrals-800">
                    <SmartImage source={{ uri: m.thumbnailUri || m.uri }} recyclingKey={m.thumbnailUri || m.uri} blurRadius={veiled ? 12 : undefined} contentFit="cover" style={{ width: 64, height: 64 }} />
                    <View pointerEvents="none" style={{ position: "absolute", left: 4, bottom: 4, flexDirection: "row", gap: 3 }}>
                      {m.type === "video" && <Icon name="Play" size={11} color="#fff" fill="#fff" />}
                      {m.lockPrice != null && <Icon name="Lock" size={11} color="#fff" />}
                      {m.options?.hidden === "reveal" && <Icon name="EyeOff" size={11} color="#fff" />}
                      {m.destruct ? <Icon name="Timer" size={11} color="#fff" /> : null}
                    </View>
                  </Pressable>
                  <TouchableOpacity onPress={() => removeStudioAt(i)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("dm.removeAttachment")}
                    style={{ position: "absolute", right: -6, top: -6, width: 20, height: 20, borderRadius: 6, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="X" size={11} color="#09090B" />
                  </TouchableOpacity>
                </View>
              );
            })}
            <Pressable onPress={() => { void handlePickGallery(); }} accessibilityRole="button"
              accessibilityLabel={_copy("dmVideo.addMore", { defaultValue: "Add photos or videos" })}
              style={{ width: 64, height: 64, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" }} className="border-theme-neutrals-600">
              <Icon name="Plus" size={20} color="#A1A1AA" />
            </Pressable>
          </ScrollView>
        )}

        {/* Selected media / GIF preview */}
        {(media || gifUrl) && (
          <Animated.View
            entering={FadeIn.duration(150)}
            className="px-3 pt-2"
          >
            <View className="relative self-start">
              {media?.type === "file" || media?.type === "audio" ? (
                /* A document has no thumbnail to show, so the chip carries the
                   name and size instead of an 80×80 Image of nothing. */
                <View className="flex-row items-center bg-theme-neutrals-800 border border-theme-neutrals-700 rounded-xl px-3 py-2 max-w-[260px]">
                  <View className="w-9 h-9 rounded-lg bg-theme-neutrals-700 items-center justify-center mr-2.5">
                    <Icon name={media.type === "audio" ? "Music" : "FileText"} size={18} color="#fff" />
                  </View>
                  <View className="flex-1">
                    <Text className="text-white text-[13px] font-medium" numberOfLines={1}>
                      {media.name}
                    </Text>
                    <Text className="text-theme-neutrals-400 text-[11px] mt-0.5">
                      {getAttachmentLabel(media.name || "")}
                      {media.size ? ` · ${formatAttachmentSize(media.size)}` : ""}
                    </Text>
                  </View>
                </View>
              ) : (
                // expo-image takes no className, so the backdrop lives on a wrapper.
                <View className="bg-theme-neutrals-700" style={{ width: 80, height: 80, borderRadius: 12 }}>
                  <SmartImage
                    source={{ uri: media?.thumbnailUri || media?.uri || gifUrl || "" }}
                    style={{ width: 80, height: 80, borderRadius: 12 }}
                    contentFit="cover"
                  />
                </View>
              )}
              {gifUrl && (
                <View className="absolute bottom-1 left-1 dark-surface bg-black/60 rounded px-1">
                  <Text className="text-[11px] text-white font-bold">GIF</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={handleRemoveMedia}
                className="absolute -top-1.5 -right-1.5 bg-white rounded-full w-5 h-5 items-center justify-center"
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={t("dm.removeAttachment")}
              >
                <Icon name="X" size={12} color="#09090B" />
              </TouchableOpacity>
            </View>
            {/* A document can go out locked too: they pay to download it. */}
            {allowLock && media?.type === "file" && (
              <View className="mt-2">
                <LockPriceRow
                  kind="file"
                  value={media.lockPrice ?? null}
                  onChange={(price) => setMedia((m) => (m ? { ...m, lockPrice: price } : m))}
                />
              </View>
            )}
          </Animated.View>
        )}

          {/* @ in a message: people, communities and pages, like web's
              composer. A community or page types its link, which the
              message shows as a card. */}
          {mentions.showSuggestions && (
            <View className="mx-3 mt-2">
              <MentionSuggestions
                visible={mentions.showSuggestions}
                suggestions={mentions.suggestions}
                onSelect={mentions.selectMention}
                loading={mentions.loading}
              />
            </View>
          )}
          {composerFocused && clipImage && !studio.length && !media && !gifUrl && !editingMessage && (
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} className="mx-3 mt-2 flex-row">
              <TouchableOpacity
                onPress={() => void handlePasteImage()}
                activeOpacity={0.7}
                className="flex-row items-center rounded-full px-3 py-1.5 bg-theme-neutrals-800"
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("dm.pasteImage", { defaultValue: "Paste image" })}
              >
                <Icon name="ClipboardPaste" size={14} color="#D4D4D8" />
                <Text className="ml-1.5 text-[13px] font-medium text-white">{t("dm.pasteImage", { defaultValue: "Paste image" })}</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
          {/* One row: + on the left, the field with send inside it. Every other
              button lives behind the +, in the drawer under this row. */}
          <View className="flex-row items-end px-3 pt-2.5 pb-2" style={{ gap: 8 }}>
            <TouchableOpacity
              onPress={toggleTray}
              hitSlop={4}
              activeOpacity={0.7}
              disabled={enhancing}
              accessibilityRole="button"
              accessibilityLabel={t("liveChat.attachTitle")}
              accessibilityState={{ expanded: trayOpen, disabled: enhancing }}
              testID="dm-plus"
            >
              {/* The fill sits on a plain View so System Light's colour pass
                  turns the white of an open + into ink, as it does for chips. */}
              <View className="items-center justify-center" style={[PLUS_BOX, trayOpen ? { backgroundColor: accent } : null]}>
                {enhancing ? (
                  <ActivityIndicator size={18} color="#F4F4F5" />
                ) : (
                  <Icon name={trayOpen ? "X" : "Plus"} size={22} color={trayOpen ? "#0B0B0C" : "#E4E4E7"} />
                )}
              </View>
            </TouchableOpacity>
            <View className="flex-1 flex-row items-end" style={FIELD_BOX}>
              <View className="flex-1" style={{ paddingVertical: 9 }}>
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={mentions.handleChangeText}
                  onSelectionChange={mentions.handleSelectionChange}
                  onFocus={() => { setComposerFocused(true); setTrayOpen(false); refreshClipImage(); }}
                  onBlur={() => setComposerFocused(false)}
                  placeholder={placeholder}
                  placeholderTextColor="#8B8D90"
                  multiline
                  // The web build's textarea starts two rows tall; one, like the phones.
                  {...(Platform.OS === "web" ? { numberOfLines: 1 } : null)}
                  maxLength={DM_TEXT_MAX_LENGTH}
                  className="text-white text-[15px] leading-5"
                  style={INPUT_TEXT}
                />
              </View>
              {(
                showCostOnSend ? (
                  <TouchableOpacity
                    onPress={handleSend}
                    disabled={!showSendButton || sending || enhancing || insufficientBalance || tipBelowFee}
                    activeOpacity={0.7}
                    hitSlop={2}
                    accessibilityRole="button"
                    accessibilityLabel={t("dm.sendMessage")}
                    accessibilityState={{ disabled: !showSendButton || sending || enhancing || insufficientBalance || tipBelowFee }}
                    style={{ height: 30, marginBottom: 3, marginLeft: 6, maxWidth: 88, flexShrink: 1 }}
                    className={`flex-row items-center justify-center rounded-full px-3 ${
                      insufficientBalance || tipBelowFee
                        ? "bg-theme-neutrals-700"
                        : "bg-white/10 border border-white/20"
                    }`}
                  >
                    {sending ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <Icon name="Send" size={14} color={insufficientBalance || tipBelowFee ? "#666" : "#fff"} />
                        <Text className={`text-[11px] font-semibold ml-1 flex-shrink ${insufficientBalance || tipBelowFee ? "text-theme-neutrals-500" : "text-white"}`}>
                          {totalCost} <DhbCoin />
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={handleSend}
                    disabled={!showSendButton || sending || enhancing}
                    style={{ opacity: showSendButton ? 1 : 0.35 }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t("dm.sendMessage")}
                    accessibilityState={{ disabled: !showSendButton || sending || enhancing }}
                  >
                    <View className="items-center justify-center" style={[SEND_DOT, { backgroundColor: accent }]}>
                      {sending ? (
                        <ActivityIndicator size="small" color="#0B0B0C" />
                      ) : (
                        <Icon name="ArrowUp" size={18} color="#0B0B0C" />
                      )}
                    </View>
                  </TouchableOpacity>
                )
              )}
            </View>
          </View>
          {trayOpen ? (
            <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(100)} style={TRAY} testID="dm-tray">
              {trayOptions.map((o) => (
                <TouchableOpacity
                  key={o.key}
                  onPress={() => { haptic.tap(); setTrayOpen(false); o.onPress(); }}
                  onLongPress={o.onLongPress}
                  disabled={o.disabled || enhancing}
                  activeOpacity={0.7}
                  style={TRAY_CELL}
                  accessibilityRole="button"
                  accessibilityLabel={o.label}
                  accessibilityState={{ disabled: !!o.disabled }}
                  testID={`dm-tray-${o.key}`}
                >
                  <View style={[TRAY_TILE, o.disabled ? { opacity: 0.4 } : null]}>
                    <Icon name={o.icon} size={23} color="#F4F4F5" />
                  </View>
                  <Text numberOfLines={2} className="text-white" style={[TRAY_LABEL, o.disabled ? { opacity: 0.5 } : null]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </Animated.View>
          ) : null}
        {/* Up whenever the other side spoke last and the composer is empty,
            beneath the tools row, and stands down while the keyboard owns
            focus. Whether
            there is anything to draft is a question the tray ANSWERS, with the
            orb still there to press, not one that decides whether it exists:
            gating the mount on that check is what made the feature vanish for
            the rest of every conversation. Stands down once there is typed
            text, and on send. */}
        {showTray && (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
            <SmartReplyTray
              status={smartReplies.status}
              suggestions={smartReplies.suggestions}
              error={smartReplies.error}
              onGenerate={() => smartReplies.generate()}
              onPick={handlePickSuggestion}
              onDismiss={handleDismissTray}
              dismissLabel={t("messages.turnOffSmartReplies", "Turn off suggested replies")}
            />
          </Animated.View>
        )}

      </View>

      {/* Each of these is built only once it has been opened: closed, they
          were drawn again on every key typed into the box above. */}
      <WhenOpened open={gifPickerVisible}>
        {() => (
          <GifPicker
            visible={gifPickerVisible}
            onPick={handleGifPicked}
            onClose={() => {
              setGifPickerVisible(false);
              keyboardSwap.restore();
            }}
          />
        )}
      </WhenOpened>

      <WhenOpened open={translator.pickerOpen}>
        {() => (
          <LanguageSelectModal
            visible={translator.pickerOpen}
            onClose={translator.closePicker}
            onSelect={translator.choose}
            selected={translator.lang}
            title={t("common.translate")}
            subtitle=""
          />
        )}
      </WhenOpened>
    </>
  );
};

export default memo(ChatInputBarComponent);
