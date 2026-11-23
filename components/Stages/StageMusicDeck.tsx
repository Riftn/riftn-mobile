/**
 * StageMusicDeck: the host's own songs, played to the whole room.
 *
 * Same folder web's radio panel uses (`soundboard-sounds/<wallet>/music/`), so
 * a song added on either side shows on both. Playback rides playSoundEffect
 * (Agora audio mixing), so listeners hear it even with the host's mic off.
 * While a song is on, the room is told what is playing (the same
 * `stage-radio:{spaceId}` now-playing beat web sends) and the stage's idle
 * clock is kept awake so a music-only show is not ended for silence.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { supabase, walletScopedClient } from "../../services/supabase";
import { uploadLocalFileToBucket } from "../../libs/storage-upload";
import { withWalletHeader } from "../../libs/supabase-wallet-client";
import { useStages } from "../../context/StageContext";
import { useAuth } from "../../context/AuthContext";
import { toastError } from "../../libs";
import { createLogger } from "../../libs/logger";
import { isRadioShow } from "../../libs/stage-radio-show";

const log = createLogger("StageMusicDeck");

const BUCKET = "soundboard-sounds";
const MAX_SONGS = 12;
const MAX_SONG_MB = 15;
const BEAT_MS = 10_000;
const AWAKE_MS = 60_000;

interface Song {
  id: string;
  name: string;
  url: string;
  path: string;
}

function prettySongName(fileName: string): string {
  return fileName.replace(/^\d+-/, "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || fileName;
}

const StageMusicDeck: React.FC = () => {
  const { t } = useTranslation();
  const { currentSpace, playingSoundId, playSoundEffect, stopSoundEffect } = useStages();
  const { user } = useAuth();
  const wallet = (user?.walletAddress || user?.address || "").toLowerCase();
  const folder = wallet ? `${wallet}/music` : null;
  const [songs, setSongs] = useState<Song[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [open, setOpen] = useState(() => isRadioShow(currentSpace));

  const loadSongs = useCallback(async () => {
    if (!folder) return;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(folder, { limit: MAX_SONGS, sortBy: { column: "created_at", order: "asc" } });
    if (error || !data) return;
    setSongs(
      data
        .filter((f) => f.id !== null && f.name !== ".emptyFolderPlaceholder")
        .map((f) => {
          const path = `${folder}/${f.name}`;
          return {
            id: `music-${path}`,
            name: prettySongName(f.name),
            url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
            path,
          };
        }),
    );
  }, [folder]);

  useEffect(() => {
    void loadSongs();
  }, [loadSongs]);

  const onAir = useMemo(() => songs.find((s) => s.id === playingSoundId) ?? null, [songs, playingSoundId]);
  const spaceId = currentSpace?.id;

  // Tell the room what is playing, on change and on a heartbeat, so people
  // who join mid-song still see it. Listeners drop the label after missed
  // beats. The channel is shared with StageRadioNowPlaying (same topic), so
  // it is never removed here; an unjoined channel sends over REST.
  const wasOnAirRef = useRef(false);
  useEffect(() => {
    if (!spaceId) return;
    if (!onAir && !wasOnAirRef.current) return;
    wasOnAirRef.current = !!onAir;
    const label = onAir ? { id: onAir.path, name: onAir.name, kind: "track" as const } : null;
    const send = () => {
      supabase
        .channel(`stage-radio:${spaceId}`)
        .send({ type: "broadcast", event: "now-playing", payload: { station: label } })
        .catch(() => {});
    };
    send();
    if (!label) return;
    const beat = setInterval(send, BEAT_MS);
    return () => clearInterval(beat);
  }, [spaceId, onAir]);

  // Music on air counts as the room being used, even with every mic muted.
  useEffect(() => {
    if (!onAir || !spaceId || !wallet) return;
    const touch = () => {
      void (async () => {
        const { error } = await withWalletHeader(
          supabase.rpc("touch_stage_speech" as never, { space_id: spaceId } as never) as never,
          wallet,
        );
        if (error) log.warn("touch_stage_speech failed", error);
      })();
    };
    touch();
    const timer = setInterval(touch, AWAKE_MS);
    return () => clearInterval(timer);
  }, [onAir, spaceId, wallet]);

  const play = useCallback(
    async (song: Song) => {
      if (playingSoundId === song.id) {
        stopSoundEffect();
        return;
      }
      try {
        await playSoundEffect(song.url, song.id);
      } catch {
        toastError(t("stages.radioShow.playFailed"));
      }
    },
    [playSoundEffect, stopSoundEffect, playingSoundId, t],
  );

  const addSong = useCallback(async () => {
    if (!folder) return;
    if (songs.length >= MAX_SONGS) {
      toastError(t("stages.maxSounds", { max: MAX_SONGS }));
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: "audio/*", copyToCacheDirectory: true });
      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];
      if ((asset.size ?? 0) > MAX_SONG_MB * 1024 * 1024) {
        toastError(t("stages.radioShow.tooBig", { max: MAX_SONG_MB }));
        return;
      }
      setIsUploading(true);
      const safeName = (asset.name || "song").replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
      await uploadLocalFileToBucket({
        bucket: BUCKET,
        path: `${folder}/${Date.now()}-${safeName}`,
        uri: asset.uri,
        contentType: asset.mimeType || "audio/mpeg",
      });
      await loadSongs();
    } catch (err) {
      log.error("Song upload failed:", err);
      toastError(t("stages.uploadFailed"));
    } finally {
      setIsUploading(false);
    }
  }, [folder, songs.length, loadSongs, t]);

  const removeSong = useCallback(
    (song: Song) => {
      Alert.alert(t("stages.deleteSoundTitle"), t("stages.deleteSoundBody", { name: song.name }), [
        { text: t("stages.keepIt"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: async () => {
            if (!wallet) return;
            if (playingSoundId === song.id) stopSoundEffect();
            const { data, error } = await walletScopedClient(wallet).storage.from(BUCKET).remove([song.path]);
            if (error || !data?.length) {
              toastError(t("stages.deleteFailed"));
              return;
            }
            setSongs((prev) => prev.filter((s) => s.path !== song.path));
          },
        },
      ]);
    },
    [wallet, playingSoundId, stopSoundEffect, t],
  );

  if (!folder) return null;

  const pad = (active: boolean) => ({
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: active ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: active ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.1)",
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 5,
  });

  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 8,
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.06)",
      }}
    >
      <TouchableOpacity
        onPress={() => setOpen((v) => !v)}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        accessibilityRole="button"
        accessibilityLabel={t("stages.radioShow.myMusic")}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name="Music" size={12} color="rgba(255,255,255,0.5)" />
          <Text
            style={{
              color: "rgba(255,255,255,0.4)",
              fontSize: 10,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {t("stages.radioShow.myMusic")}
          </Text>
          {!!onAir && (
            <Text numberOfLines={1} style={{ color: "#F4F4F5", fontSize: 11, fontWeight: "600", maxWidth: 160 }}>
              {`· ${t("stages.radioShow.onAir")}: ${onAir.name}`}
            </Text>
          )}
        </View>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} color="rgba(255,255,255,0.5)" />
      </TouchableOpacity>

      {open && (
        <>
          <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 6, marginBottom: 8 }}>
            {songs.length ? t("stages.radioShow.myMusicHint") : t("stages.radioShow.noSongs")}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
            {songs.map((song) => {
              const active = playingSoundId === song.id;
              return (
                <TouchableOpacity
                  key={song.path}
                  onPress={() => void play(song)}
                  onLongPress={() => removeSong(song)}
                  style={pad(active)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={song.name}
                >
                  <Icon name={active ? "Square" : "Play"} size={11} color={active ? "#fff" : "rgba(255,255,255,0.6)"} />
                  <Text
                    numberOfLines={1}
                    style={{ color: active ? "#fff" : "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "500", maxWidth: 140 }}
                  >
                    {song.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => void addSong()}
              disabled={isUploading}
              style={[pad(false), { opacity: isUploading ? 0.5 : 1 }]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t("stages.radioShow.addSong")}
            >
              {isUploading ? (
                <ActivityIndicator size="small" color="rgba(255,255,255,0.6)" />
              ) : (
                <Icon name="Plus" size={12} color="rgba(255,255,255,0.6)" />
              )}
              <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "500" }}>
                {isUploading ? t("stages.uploading") : t("stages.radioShow.addSong")}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </>
      )}
    </View>
  );
};

export default StageMusicDeck;
