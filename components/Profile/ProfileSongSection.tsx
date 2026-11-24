/**
 * Edit profile > Profile song: one song under your bio. Pick it with the same
 * song picker as posts (free songs and your uploads), choose the part, and
 * whether it plays by itself when people open your profile. Same as web's
 * settings/ProfileSongSetting.
 *
 * Saves on its own, merged into the freshly read `customs` (the API replaces
 * the blob wholesale).
 */
import { useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import CustomSwitch from "../ui/CustomSwitch";
import SoundPickerSheet from "../Post/SoundPickerSheet";
import { SongRow } from "./ProfileSongRow";
import { useUser, useAuthActions } from "../../context/AuthContext";
import { AuthService } from "../../services/auth.service";
import { getAccountProfile } from "../../services/user.service";
import { toastError, toastSuccess } from "../../libs/toast";
import {
  profileSongFromSound,
  profileSongPartLabel,
  readProfileSong,
  withProfileSong,
  type ProfileSong,
} from "../../libs/profileSong";

export default function ProfileSongSection() {
  const { t } = useTranslation();
  const user = useUser();
  const { patchUser } = useAuthActions();
  const [song, setSong] = useState<ProfileSong | null>(() => readProfileSong(user?.customs as Record<string, unknown> | undefined));
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const save = async (next: ProfileSong | null, done?: string) => {
    if (!user?.address || saving) return;
    const before = song;
    setSong(next);
    setSaving(true);
    try {
      const account = await getAccountProfile(user.address);
      const merged = withProfileSong((account?.customs ?? user?.customs) as Record<string, unknown> | undefined, next);
      await AuthService.updateProfile({ customs: JSON.stringify(merged) });
      await patchUser({ customs: merged } as any);
      if (done) toastSuccess(done);
    } catch {
      setSong(before);
      toastError(t("profileSong.saveFailed", { defaultValue: "Could not save your profile song. Try again." }));
    } finally {
      setSaving(false);
    }
  };

  const rowStyle = "flex-row items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-3";

  return (
    <View className="mt-2" testID="edit-profile-song">
      <Text className="text-neutral-400 text-xs font-medium mb-1.5">{t("profileSong.title", { defaultValue: "Profile song" })}</Text>
      <Text className="text-neutral-500 text-xs mb-3">{t("profileSong.hint", { defaultValue: "A song under your bio. People tap it to listen." })}</Text>

      {song ? (
        <View style={{ gap: 10 }}>
          <View style={{ marginTop: -12 }}>
            <SongRow song={song} isOwn autoStart={false} />
          </View>
          <Text className="text-neutral-500 text-xs">{t("profileSong.part", { defaultValue: "Plays {{part}}", part: profileSongPartLabel(song) })}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity activeOpacity={0.8} disabled={saving} onPress={() => setPickerOpen(true)} style={{ flex: 1 }} accessibilityRole="button">
              <View className={rowStyle} style={{ borderRadius: 12 }}>
                <Text className="text-white text-sm">{t("profileSong.change", { defaultValue: "Change song" })}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={saving}
              onPress={() => void save(null, t("profileSong.removed", { defaultValue: "Profile song removed" }))}
              style={{ flex: 1 }}
              accessibilityRole="button"
            >
              <View className={rowStyle} style={{ borderRadius: 12 }}>
                <Text className="text-white text-sm">{t("profileSong.remove", { defaultValue: "Remove" })}</Text>
              </View>
            </TouchableOpacity>
          </View>
          <View className="flex-row items-center gap-4 py-2">
            <View className="flex-1">
              <Text className="text-white text-sm">{t("profileSong.autoplay", { defaultValue: "Play when people visit" })}</Text>
              <Text className="text-neutral-400 text-xs mt-1">
                {t("profileSong.autoplayHint", { defaultValue: "Fades in softly when someone opens your profile. They can stop it with one tap." })}
              </Text>
            </View>
            <CustomSwitch
              accessibilityLabel={t("profileSong.autoplay", { defaultValue: "Play when people visit" })}
              value={song.autoplay}
              disabled={saving}
              onValueChange={(on) => void save({ ...song, autoplay: on })}
            />
          </View>
        </View>
      ) : (
        <TouchableOpacity activeOpacity={0.8} disabled={saving} onPress={() => setPickerOpen(true)} accessibilityRole="button" testID="profile-song-add">
          <View className="flex-row items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name="Music" size={16} color="#FFFFFF" />
              <Text className="text-white text-sm">{t("profileSong.add", { defaultValue: "Add a song" })}</Text>
            </View>
            {saving ? <ActivityIndicator size="small" color="#A1A1AA" /> : <Icon name="ChevronRight" size={16} color="#A1A1AA" />}
          </View>
        </TouchableOpacity>
      )}

      {pickerOpen && (
        <SoundPickerSheet
          visible={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(sound) => {
            setPickerOpen(false);
            const next = profileSongFromSound(sound, song ? song.autoplay : true);
            if (!next) {
              toastError(t("profileSong.cantUse", { defaultValue: "That song can't be used on a profile. Try another one." }));
              return;
            }
            void save(next, t("profileSong.saved", { defaultValue: "Profile song saved" }));
          }}
          opaque
        />
      )}
    </View>
  );
}
