import { MediaControlIcon } from '../components/common/MediaControlGlyph';
import { VIDEO_CONTROL_STRIP_HEIGHT } from '../components/Home/VideoScrubZone';
import { useTranslation as _useCopy } from 'react-i18next';
import { useVideoDownload } from "../context/VideoDownloadContext";
import { PersistentVideoView } from '../components/common/PersistentVideoView';
import { isPictureInPicturePlayer, canStartVideo } from '../libs/pictureInPicture';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { runWhenSettled } from "../libs/run-when-settled";
import { warmShortsFeed } from "../navigation/warmShortsFeed";
import {
  View,
  Text,
  Pressable,
  StatusBar,
  useWindowDimensions,
  StyleSheet,
  ActivityIndicator,
  PanResponder,
} from "react-native";
import { useBackPress } from "../hooks/useBackPress";
import { useRoute, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { VideoView } from "expo-video";
import { usePostVideoPlayer } from "../hooks/usePostVideoPlayer";
import { useVideoSoundtrack } from "../hooks/useVideoSoundtrack";
import { hasHlsFailed, markHlsFailed, useHlsFallback } from "../libs/hls-fallback";
import PictureInPictureButton from "../components/common/PictureInPictureButton";
import { FULLSCREEN_BUFFER_OPTIONS } from "../libs/videoBuffering";
import {
  configureForBackgroundPlayback,
  releaseBackgroundPlayback,
} from "../libs/audioSession";
import * as ScreenOrientation from "expo-screen-orientation";
import { noteFullscreenClosedUpright } from "../libs/turned-fullscreen";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
  Extrapolation,
  runOnJS,
  withDelay,
  Easing,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Icon from "../components/ui/Icon";
import {
  requestAudioFocus,
  releaseAudioFocus,
} from "../libs/audioFocus";
import {
  requestFeedVideoFocus,
  releaseFeedVideoFocus,
} from "../libs/feedVideoFocus";
import { createViewRecorder } from "../services/view.service";
import { getCachedMuted, setMutedState } from "../libs/videoMutedState";
import { useVolumeUpUnmute } from "../libs/volumeKeyUnmute";
import { PLAYER_CONSTANTS } from "../components/VideoPlayerCore/utils";
import { isBrainrotSwipe } from "../libs/brainrotFeed";
import { useAppPrefs } from "../hooks/useAppPrefs";
import { ScreenNames } from "../navigation/ScreenNames";
import { getIsLooping, useMediaLooping, getVolume, setVolume as persistVolume, useMediaVolume } from '../libs/video-preferences';
import { applyVideoVolume } from '../libs/dub-mix';
import { useFeedVolumeResponder } from '../libs/feed-volume-responder';
import VolumeLevelTrack from '../components/VideoPlayerCore/VolumeLevelTrack';
import { toStoryboard } from '../libs/storyboard';
import StoryboardPreview from '../components/VideoPlayerCore/StoryboardPreview';

const DISMISS_THRESHOLD = 150;
/** The clip growing out of its box into full screen, and back. */
const GROW_MS = 260;
const SHRINK_MS = 240;
const FADE_MS = 180;

const isRect = (value: any): value is { x: number; y: number; width: number; height: number } =>
  !!value && [value.x, value.y, value.width, value.height].every((n) => typeof n === 'number' && Number.isFinite(n)) && value.width > 0 && value.height > 0;
const CONTROLS_TIMEOUT = PLAYER_CONSTANTS.HIDE_CONTROLS_DELAY;

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const FullscreenVideoScreen = () => {
  const { t: _copy } = _useCopy();
  const { t } = useTranslation();
  const downloadVideo = useVideoDownload();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  const {
    videoUrl: handedUrl,
    downloadUrl,
    startTime = 0,
    isMuted: initialMuted = false,
    thumbnail,
    tokenId,
    isSignedIn = false,
    creatorUsername,
    downloadTitle,
    storyboard: rawStoryboard,
    soundtrackUrl,
    landscape: opensSideways = false,
    turned = false,
    // Where the clip sat on the page it was opened from. Full screen grows out
    // of that box and shrinks back into it on the way out.
    from,
    // Clips that are not posts (a Requests attachment) don't lead on to Shorts.
    noShorts = false,
  } = (route?.params as any) || {};
  const storyboard = useMemo(() => toStoryboard(rawStoryboard), [rawStoryboard]);
  /** The storyboard tile shows while a finger is dragging the timeline. */
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  // The feed hands over its own source, the HLS ladder when the post has one,
  // so the player carries straight over. downloadUrl is the MP4: what the
  // download saves, and what plays here if the ladder fails.
  const videoUrl: string | undefined = useHlsFallback(() =>
    downloadUrl && hasHlsFailed(handedUrl) ? downloadUrl : handedUrl);

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(() => getCachedMuted());
  const [currentTime, setCurrentTime] = useState(startTime);
  const [videoDuration, setVideoDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  // Opened from a wide clip's full screen button: the picture turns to fill
  // the screen straight away, either way up.
  // Opened by turning the phone: it keeps following the phone, and turning it
  // upright again closes full screen.
  const closeScreenRef = useRef<() => void>(() => {});
  const closing = useRef(false);
  const origin = isRect(from) ? from : null;
  useEffect(() => {
    if (!opensSideways) return;
    if (!turned) {
      // The picture grows out of its box first, then the screen turns with
      // it, so the turn never lands on a half-drawn page.
      const timer = setTimeout(() => {
        if (closing.current) return;
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      }, origin ? GROW_MS : 0);
      return () => clearTimeout(timer);
    }
    let sub: { remove(): void } | null = null;
    try {
      ScreenOrientation.unlockAsync().catch(() => {});
      sub = ScreenOrientation.addOrientationChangeListener((event) => {
        if (closing.current || event.orientationInfo.orientation !== ScreenOrientation.Orientation.PORTRAIT_UP) return;
        noteFullscreenClosedUpright();
        closeScreenRef.current();
      });
    } catch {}
    return () => { try { sub?.remove(); } catch {} };
  }, [opensSideways, turned]);

  const isPlayingRef = useRef(true);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTrackWidthRef = useRef(0);

  const viewRecorderRef = useRef(
    tokenId != null
      ? createViewRecorder({ tokenId, isSignedIn })
      : null
  );

  // Re-arm on unmount so reopening this video counts as another view. The
  // recorder guards a WATCH, not the post — see resetRecordedView.
  useEffect(() => () => viewRecorderRef.current?.reset(), []);

  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);
  const isDismissing = useRef(false);
  const isInPiPRef = useRef(false);
  const videoViewRef = useRef<VideoView>(null);

  // Set up audio mode for background play/PiP.
  // Routed through libs/audioSession so this screen is not a fourth place
  // writing the global category by hand — and so it stops passing
  // `interruptionModeAndroid`, which expo-audio deprecated in favour of
  // `interruptionMode` working on both platforms.
  useEffect(() => {
    configureForBackgroundPlayback().catch((error) => {
      console.warn('[FullscreenVideoScreen] configureForBackgroundPlayback failed:', error);
    });

    return () => {
      releaseBackgroundPlayback().catch(() => {});
    };
  }, []);

  const { width: screenW, height: screenH } = useWindowDimensions();
  const winW = useSharedValue(screenW);
  const winH = useSharedValue(screenH);
  useEffect(() => { winW.value = screenW; winH.value = screenH; }, [screenW, screenH, winW, winH]);
  const isLandscape = screenW > screenH;
  const fade = useSharedValue(1);

  // 0 = the clip in its box on the page behind, 1 = filling the screen.
  const grow = useSharedValue(origin ? 0 : 1);
  // Controls and backdrop fade rather than pop.
  const chrome = useSharedValue(0);
  const fromX = useSharedValue(origin?.x ?? 0);
  const fromY = useSharedValue(origin?.y ?? 0);
  const fromW = useSharedValue(origin?.width ?? screenW);
  const fromH = useSharedValue(origin?.height ?? screenH);
  useEffect(() => {
    const ease = Easing.bezier(0.2, 0, 0, 1);
    if (origin) grow.value = withTiming(1, { duration: GROW_MS, easing: ease });
    chrome.value = withDelay(origin ? GROW_MS * 0.6 : 0, withTiming(1, { duration: FADE_MS }));
  }, []);

  const { player, session, ownsPlayer, active: ownsVideo } = usePostVideoPlayer(videoUrl || null, (p) => {
    p.loop = getIsLooping();
    p.muted = getCachedMuted();
    applyVideoVolume(p, getVolume());
    p.timeUpdateEventInterval = 0.5;
    if (startTime > 0) p.currentTime = startTime;
    // The audio mode above already allows background playback, but that only
    // grants permission — the player still opts in per instance, and without
    // this it pauses the moment the app is backgrounded regardless.
    p.staysActiveInBackground = true;
    // Lock-screen artwork and transport controls. Background audio with no way
    // to pause it without reopening the app is half a feature; this is the
    // other half. iOS only surfaces it while the session is doNotMix or auto,
    // which is what the effect above sets.
    p.showNowPlayingNotification = true;
    p.bufferOptions = FULLSCREEN_BUFFER_OPTIONS;
  });
  useVideoSoundtrack(videoUrl ? player : null, soundtrackUrl);

  // The player may come from a feed card that pauses in the background.
  useEffect(() => {
    if (!ownsVideo) return;
    player.staysActiveInBackground = true;
    player.showNowPlayingNotification = true;
  }, [player, ownsVideo]);

  const isLooping = useMediaLooping();
  useEffect(() => {
    if (ownsVideo) player.loop = isLooping;
  }, [player, ownsVideo, isLooping]);

  useLayoutEffect(() => {
    if (!ownsVideo) return;
    isPlayingRef.current = player.playing;
    setIsPlaying(player.playing);
    setIsMuted(player.muted);
    setCurrentTime(player.currentTime);
    setVideoDuration(player.duration);
  }, [ownsVideo, player]);

  const stopPlayback = useCallback(() => {
    if (ownsPlayer() && !isPictureInPicturePlayer(player)) { try { player.pause(); } catch {} }
  }, [player, ownsPlayer]);

  useEffect(() => {
    if (!player || !ownsVideo || !canStartVideo(player)) return;
    requestFeedVideoFocus(stopPlayback);
    if (!player.muted) requestAudioFocus(stopPlayback);
    if (!session.userPaused) player.play();

    return () => {
      releaseFeedVideoFocus(stopPlayback);
      releaseAudioFocus(stopPlayback);
    };
  }, [player, ownsVideo, session, stopPlayback]);

  useEffect(() => {
    if (!player) return;
    const subs: Array<{ remove: () => void }> = [];
    try {
      subs.push(player.addListener("playingChange", ({ isPlaying: p }) => {
        if (!ownsPlayer()) return;
        isPlayingRef.current = p;
        setIsPlaying(p);
      }));
    } catch {}
    try {
      subs.push(player.addListener("statusChange", ({ status }) => {
        if (!ownsPlayer()) return;
        setIsBuffering(status === "loading");
        if (status === "readyToPlay" && player.duration > 0) setVideoDuration(player.duration);
        // Nothing here retries, so a ladder that errors is retired at once and
        // the MP4 gets a fresh player (and the card behind follows it).
        if (status === "error") markHlsFailed(videoUrl);
      }));
    } catch {}
    try {
      subs.push(player.addListener("timeUpdate", ({ currentTime: ct }: any) => {
        if (!ownsPlayer()) return;
        setCurrentTime(ct ?? 0);
        if (ct != null && viewRecorderRef.current) {
          viewRecorderRef.current.onProgress(
            ct * 1000,
            player.duration > 0 ? player.duration * 1000 : undefined
          );
        }
      }));
    } catch {}
    return () => { subs.forEach((s) => { try { s.remove(); } catch {} }); };
  }, [player, ownsPlayer, videoUrl]);

  useEffect(() => {
    StatusBar.setHidden(true);
    return () => {
      StatusBar.setHidden(false);
      // The orientation lock is process-wide and outlives this screen. The
      // interactive back gesture pops without closeScreen, which used to leave
      // the whole app in landscape.
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  const leave = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  // One way out, whichever way up: turn upright first, then shrink back into
  // the box the clip came from (or fade, when there is none), then go.
  const closeScreen = useCallback((alreadyGone = false) => {
    if (closing.current && !alreadyGone) return;
    closing.current = true;
    StatusBar.setHidden(false);
    chrome.value = withTiming(0, { duration: FADE_MS });
    const sideways = (winW.value > winH.value);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    if (alreadyGone) { leave(); return; }
    const shrink = () => {
      const ease = Easing.bezier(0.2, 0, 0, 1);
      if (origin) {
        grow.value = withTiming(0, { duration: SHRINK_MS, easing: ease }, (done) => { if (done) runOnJS(leave)(); });
      } else {
        opacity.value = withTiming(0, { duration: FADE_MS });
        fade.value = withTiming(0, { duration: FADE_MS }, (done) => { if (done) runOnJS(leave)(); });
      }
    };
    if (!sideways) { shrink(); return; }
    // Wait for the phone's turn to land, so the shrink runs upright.
    let done = false;
    const go = () => { if (done) return; done = true; try { sub?.remove(); } catch {} ; clearTimeout(timer); shrink(); };
    let sub: { remove(): void } | null = null;
    try { sub = ScreenOrientation.addOrientationChangeListener(() => setTimeout(go, 60)); } catch {}
    const timer = setTimeout(go, 500);
  }, [leave, origin, chrome, grow, opacity, fade, winW, winH]);

  closeScreenRef.current = closeScreen;
  useBackPress(useCallback(() => closeScreen(), [closeScreen]));

  const resetControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), CONTROLS_TIMEOUT);
  }, []);

  useEffect(() => {
    resetControlsTimer();
    return () => { if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); };
  }, [resetControlsTimer]);

  const handleScreenTap = useCallback(() => {
    setShowControls((prev) => {
      const next = !prev;
      if (next) resetControlsTimer();
      return next;
    });
  }, [resetControlsTimer]);

  const handleTogglePlay = useCallback(() => {
    if (!player) return;
    if (isPlayingRef.current) {
      session.userPaused = true;
      player.pause();
    } else {
      session.userPaused = false;
      player.play();
    }
    resetControlsTimer();
  }, [player, resetControlsTimer]);

  // The phone's volume-up key unmutes the video.
  useVolumeUpUnmute(() => {
    if (!player || !player.muted) return;
    player.muted = false;
    setIsMuted(false);
    requestAudioFocus(stopPlayback);
  });

  const handleToggleMute = useCallback(() => {
    if (!player) return;
    const newMuted = !isMuted;
    player.muted = newMuted;
    setIsMuted(newMuted);
    setMutedState(newMuted);
    if (!newMuted) requestAudioFocus(stopPlayback);
    else releaseAudioFocus(stopPlayback);
    resetControlsTimer();
  }, [player, isMuted, resetControlsTimer, stopPlayback]);

  // The saved level, the same one the feed card and Shorts play at. Press and
  // hold the speaker, then drag up or down, to change it; a tap still mutes.
  const volume = useMediaVolume();
  const volumeRef = useRef(volume);
  const [volumeAdjusting, setVolumeAdjusting] = useState(false);
  useEffect(() => {
    volumeRef.current = volume;
    if (ownsVideo) { try { applyVideoVolume(player, volume); } catch {} }
  }, [player, ownsVideo, volume]);

  const applyVolume = useCallback((next: number) => {
    const level = Math.max(0, Math.min(1, next));
    volumeRef.current = level;
    persistVolume(level);
    try { applyVideoVolume(player, level); } catch {}
    // Down to nothing is muted, and off the bottom is sound again, so the
    // icon never disagrees with the level.
    const shouldMute = level === 0;
    if (shouldMute !== isMuted) {
      player.muted = shouldMute;
      setIsMuted(shouldMute);
      setMutedState(shouldMute);
      if (shouldMute) releaseAudioFocus(stopPlayback);
      else requestAudioFocus(stopPlayback);
    }
  }, [player, isMuted, stopPlayback]);

  const volumePanResponder = useFeedVolumeResponder({
    onHoldStart: () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      setVolumeAdjusting(true);
      return isMuted ? 0 : volumeRef.current;
    },
    onVolume: applyVolume,
    onTap: handleToggleMute,
    onEnd: () => {
      setVolumeAdjusting(false);
      resetControlsTimer();
    },
  });

  // Minimise always leaves full screen. It used to turn a sideways clip
  // upright and stay in full screen, which read as the screen flipping.
  const handleMinimise = useCallback(() => closeScreen(), [closeScreen]);

  const handleSeek = useCallback(
    (locationX: number) => {
      if (!player || videoDuration <= 0 || progressTrackWidthRef.current <= 0) return;
      const ratio = Math.max(0, Math.min(1, locationX / progressTrackWidthRef.current));
      const newTime = ratio * videoDuration;
      player.currentTime = newTime;
      setCurrentTime(newTime);
      resetControlsTimer();
    },
    [player, videoDuration, resetControlsTimer]
  );

  const progressPercent = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0;

  // Swiping UP is "scroll down" — on to the next video, as in every
  // short-video app: this one closes into the brainrot shorts feed
  // (libs/brainrotFeed). Replaced rather than pushed, so Back from the shorts
  // lands where the video was opened from. Off for anyone who hid Shorts.
  const shortsPref = useAppPrefs().shorts;
  const shortsEnabled = shortsPref && !noShorts;
  // One swipe away: have the next clips loading before it.
  useEffect(() => {
    if (!shortsEnabled) return;
    return runWhenSettled(() => warmShortsFeed(isSignedIn), 1500);
  }, [shortsEnabled, isSignedIn]);
  const openShorts = useCallback(() => {
    try { player?.pause(); } catch {}
    navigation.replace(ScreenNames.ShortsViewer, {
      feedParams: { brainrot: true, fromId: tokenId },
    });
  }, [player, navigation, tokenId]);

  const panGesture = Gesture.Pan()
    .activeOffsetY(shortsEnabled ? [-15, 15] : 15)
    .failOffsetX([-10, 10])
    .onUpdate((e) => {
      if (isDismissing.current) return;
      if (e.translationY < 0) {
        if (isLandscape) return;
        // Follows the finger up with some resistance, as a hint of what's next.
        translateY.value = shortsEnabled ? e.translationY * 0.35 : 0;
        return;
      }
      const dy = e.translationY;
      translateY.value = dy;
      opacity.value = interpolate(dy, [0, DISMISS_THRESHOLD * 2], [1, 0.3], Extrapolation.CLAMP);
    })
    .onEnd((e) => {
      if (isDismissing.current) return;
      if (shortsEnabled && !isLandscape && isBrainrotSwipe(e.translationY, e.velocityY)) {
        isDismissing.current = true;
        translateY.value = withTiming(-screenH, { duration: 200 }, () => {
          runOnJS(openShorts)();
        });
        return;
      }
      if (e.translationY > DISMISS_THRESHOLD) {
        isDismissing.current = true;
        translateY.value = withTiming(screenH, { duration: 200 });
        opacity.value = withTiming(0, { duration: 200 }, () => {
          runOnJS(closeScreen)(true);
        });
      } else {
        translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
        opacity.value = withSpring(1);
      }
    });

  // Drag-to-scrub on the progress track. The track lives in the controls
  // overlay, outside the swipe-to-dismiss detector, so the two never compete;
  // failOffsetY lets a vertical swipe that starts on the track fall through.
  const scrubGesture = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-15, 15])
    .onStart((e) => {
      runOnJS(setIsScrubbing)(true);
      runOnJS(handleSeek)(e.x);
    })
    .onUpdate((e) => {
      runOnJS(handleSeek)(e.x);
    })
    .onFinalize(() => {
      runOnJS(setIsScrubbing)(false);
    });

  const animContainer = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const animBg = useAnimatedStyle(() => ({
    opacity: opacity.value * grow.value,
  }));

  // The picture's box: from the clip's box on the page to the whole screen.
  const animVideo = useAnimatedStyle(() => {
    const g = grow.value;
    if (g >= 1) return { opacity: fade.value, left: 0, top: 0, width: winW.value, height: winH.value - VIDEO_CONTROL_STRIP_HEIGHT };
    return {
      opacity: fade.value,
      left: fromX.value * (1 - g),
      top: fromY.value * (1 - g),
      width: fromW.value + (winW.value - fromW.value) * g,
      height: fromH.value + (winH.value - VIDEO_CONTROL_STRIP_HEIGHT - fromH.value) * g,
    };
  });
  const animChrome = useAnimatedStyle(() => ({ opacity: chrome.value }));
  const controlsShown = useSharedValue(1);
  const animTopClose = useAnimatedStyle(() => ({ opacity: chrome.value * controlsShown.value }));
  useEffect(() => {
    controlsShown.value = withTiming(showControls ? 1 : 0, { duration: FADE_MS });
  }, [showControls, controlsShown]);

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000" }, animBg]} />

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[{ flex: 1 }, animContainer]}>
          <Pressable onPress={handleScreenTap} style={StyleSheet.absoluteFill} />
          <Animated.View style={[styles.videoWrap, animVideo]} pointerEvents="none">
            {player && (
              <PersistentVideoView
                ref={videoViewRef}
                player={player}
                contentFit="contain"
                nativeControls={false}
                allowsPictureInPicture={true}
                // Leaving the app mid-video pops the player out into a floating
                // window instead of stopping it. allowsPictureInPicture alone
                // only permits PiP, it never enters it — which is why PiP has
                // been technically enabled here and invisible in practice.
                // Android 12+ and iOS; a no-op everywhere else.
                startsPictureInPictureAutomatically={isPlaying}
                onPictureInPictureStart={() => {
                  isInPiPRef.current = true;
                }}
                onPictureInPictureStop={() => {
                  isInPiPRef.current = false;
                }}
                style={{ width: "100%", height: "100%" }}
              />
            )}
          </Animated.View>
        </Animated.View>
      </GestureDetector>

      <Animated.View style={[styles.topClose, animTopClose]} pointerEvents={showControls ? 'box-none' : 'none'}>
        <Pressable onPress={handleMinimise} style={styles.plainButton} hitSlop={8}
          accessibilityRole="button" accessibilityLabel={t('player.closeVideo')}>
          <MediaControlIcon name="X" />
        </Pressable>
      </Animated.View>
      <Animated.View style={[styles.splitStrip, animChrome]}>
        <GestureDetector gesture={scrubGesture}>
          <Animated.View style={styles.bottomSeek}>
            <Pressable style={styles.progressTrackPress}
              onPress={event => handleSeek(event.nativeEvent.locationX)}
              onLayout={event => {
                progressTrackWidthRef.current = event.nativeEvent.layout.width;
                setTrackWidth(event.nativeEvent.layout.width);
              }}
              accessibilityRole="adjustable" accessibilityLabel={t('player.videoProgress', { percent: Math.round(progressPercent) })}
              accessibilityHint={t('player.tapToSeek')}>
              <View style={styles.bottomLine}><View style={[styles.progressFill, { width: `${progressPercent}%` }]} /></View>
            </Pressable>
          </Animated.View>
        </GestureDetector>
        <View style={styles.splitRow}>
          <View style={styles.splitGroup}>
            <Pressable onPress={handleTogglePlay} style={styles.plainButton}
              accessibilityRole="button" accessibilityLabel={t(isPlaying ? 'audioPost.pause' : 'audioPost.play')}>
              <MediaControlIcon name={isPlaying ? 'Pause' : 'Play'} plain />
            </Pressable>
            <View style={styles.plainButton} {...volumePanResponder.panHandlers}
              accessible accessibilityRole="button" accessibilityLabel={t(isMuted ? 'common.unmute' : 'common.mute')}
              accessibilityActions={[{ name: 'activate' }, { name: 'increment' }, { name: 'decrement' }]}
              onAccessibilityAction={event => {
                const action = event.nativeEvent.actionName;
                if (action === 'activate') handleToggleMute();
                else if (action === 'increment') applyVolume((isMuted ? 0 : volumeRef.current) + 0.1);
                else if (action === 'decrement') applyVolume((isMuted ? 0 : volumeRef.current) - 0.1);
              }}>
              <MediaControlIcon name={isMuted ? 'VolumeX' : 'Volume2'} plain />
            </View>
            <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
          </View>
          <View style={styles.splitGroup}>
            <PictureInPictureButton videoRef={videoViewRef} plain />
            {!!(downloadUrl ?? videoUrl) && <Pressable style={styles.plainButton} accessibilityRole="button"
              accessibilityLabel={t('postOptions.download')}
              onPress={() => { player.pause(); void downloadVideo({ url: downloadUrl ?? videoUrl, title: downloadTitle || 'video', username: creatorUsername }); }}>
              <MediaControlIcon name="Download" plain />
            </Pressable>}
            <Pressable onPress={handleMinimise} style={styles.plainButton}
              accessibilityRole="button" accessibilityLabel={t('player.closeVideo')}>
              <MediaControlIcon name="Minimize" plain />
            </Pressable>
          </View>
        </View>
      </Animated.View>

      {/* Siblings of the strip rather than its children, so Android cannot clip them. */}
      {volumeAdjusting && <VolumeLevelTrack level={isMuted ? 0 : volume} style={styles.volumeTrack} />}
      <StoryboardPreview
        storyboard={storyboard}
        fraction={videoDuration > 0 ? currentTime / videoDuration : 0}
        duration={videoDuration}
        trackWidth={trackWidth}
        visible={isScrubbing}
        bottom={VIDEO_CONTROL_STRIP_HEIGHT + 8}
      />

      {isBuffering && (
        <View style={styles.bufferingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // See-through while the clip grows out of its box on the page behind.
    backgroundColor: "transparent",
  },
  videoWrap: {
    position: "absolute",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  splitStrip: { position: 'absolute', left: 0, right: 0, bottom: 0, height: VIDEO_CONTROL_STRIP_HEIGHT, backgroundColor: '#000' },
  splitRow: { height: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitGroup: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  plainButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  // Rises above the speaker: row padding 8, Play 36, gap 2, then centred on the 36pt speaker.
  volumeTrack: { left: 8 + 36 + 2 + 2, bottom: VIDEO_CONTROL_STRIP_HEIGHT + 6 },
  topClose: { position: 'absolute', left: 12, top: 12 },
  bottomSeek: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 24 },
  bottomLine: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: '#444' },
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
  },
  topButtonGroup: {
    flexDirection: "row",
    gap: 8,
  },
  glassButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  glassPlayButton: {
    width: 64,
    height: 64,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#1D1F21",
  },
  centerControls: {
    alignItems: "center",
    justifyContent: "center",
  },
  bottomBar: {
    paddingBottom: 4,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  timeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
    minWidth: 36,
    textAlign: "center",
  },
  progressTrack: {
    flex: 1,
    height: 32,
    justifyContent: "center",
  },
  progressTrackPress: {
    height: 32,
    justifyContent: "center",
  },
  progressTrackInner: {
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    overflow: "visible",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#F4F4F5",
    borderRadius: 2,
  },
  progressThumb: {
    position: "absolute",
    top: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#F4F4F5",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  bufferingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default FullscreenVideoScreen;
