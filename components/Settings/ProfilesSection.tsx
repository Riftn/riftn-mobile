/**
 * Profiles — every Riftn account saved on this device.
 * ====================================================
 * Mobile counterpart of dehubweb's ProfilesSection (Settings → Profile). Each
 * row switches to that account; the "Add profile" row opens the sign-in sheet
 * so a new profile can be added without signing out first.
 *
 * Switching and snapshotting live in @/libs/profiles; this component only
 * renders the list and reacts to its change subscription.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from '../ui/Icon';
import Avatar from '../common/Avatar';
import RemoveSavedProfileButton from '../common/RemoveSavedProfileButton';
import SavedProfileName from '../common/SavedProfileName';
import { getAvatarUrl } from '../../libs/misc';
import { SettingsSection, Divider } from './SettingsPrimitives';
import { useAuthActions, useUser } from '../../context/AuthContext';
import {
  listProfiles,
  subscribeProfilesChanged,
  type StoredProfile,
} from '../../libs/profiles';

export function ProfilesSection({ onSelect }: { onSelect?: () => void } = {}) {
  const { t } = useTranslation();
  const user = useUser();
  const { switchToProfile, openAddProfile } = useAuthActions();
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const busy = !!switchingId || removing;
  const activeAddress = (user?.walletAddress || user?.address)?.toLowerCase();

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      listProfiles().then((list) => {
        if (!cancelled) setProfiles(list);
      }).catch(() => undefined);
    };
    sync();
    const unsub = subscribeProfilesChanged(sync);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeAddress]);

  const handleSwitch = useCallback(
    async (id: string) => {
      if (busy) return;
      onSelect?.();
      setSwitchingId(id);
      try {
        await switchToProfile(id);
      } finally {
        setSwitchingId(null);
      }
    },
    [busy, switchToProfile, onSelect]
  );

  if (profiles.length === 0 && !user) return null;

  return (
    <SettingsSection
      label={t('settings.profiles', 'Profiles')}
      icon="Users"
      note={t('settings.profilesDesc', 'Accounts saved on this device')}
    >
      {profiles.map((profile, index) => {
        const isActive = profile.address.toLowerCase() === activeAddress;
        return (
          <React.Fragment key={profile.id}>
            {index > 0 ? <Divider /> : null}
            <View className="flex-row items-center pr-2">
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                onPress={() => handleSwitch(profile.id)}
                disabled={isActive || busy}
                activeOpacity={0.7}
                className="flex-1 px-4 py-3 flex-row items-center"
              >
                <View className="mr-3">
                  <Avatar
                    uri={profile.avatarUrl ? getAvatarUrl(profile.avatarUrl) : undefined}
                    size={36}
                    name={profile.name || profile.username || undefined}
                  />
                </View>
                <View className="flex-1 mr-2">
                  <SavedProfileName profile={profile} className="text-white text-base leading-5 font-medium" />
                  {(profile.username || (!profile.session && !isActive)) && (
                    <Text className="text-theme-neutrals-500 text-sm leading-5 mt-0.5" numberOfLines={1}>
                      {[
                        profile.username && `@${profile.username}`,
                        !profile.session && !isActive && t('settings.profileSignedOut', 'sign in to switch'),
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </View>
                {switchingId === profile.id ? (
                  <ActivityIndicator size="small" color="#9ca3af" />
                ) : isActive ? (
                  <Icon name="Check" size={18} color="#F4F4F5" />
                ) : null}
              </TouchableOpacity>
              {!!activeAddress && !isActive && (
                <RemoveSavedProfileButton profile={profile} disabled={busy} onRemovingChange={setRemoving} />
              )}
            </View>
          </React.Fragment>
        );
      })}
      <Divider />
      <TouchableOpacity
        onPress={() => { onSelect?.(); openAddProfile(); }}
        disabled={busy}
        activeOpacity={0.7}
        className="px-4 py-3 flex-row items-center"
      >
        <View className="mr-3 w-9 h-9 rounded-md border border-dashed border-theme-neutrals-500 items-center justify-center">
          <Icon name="Plus" size={16} color="#9ca3af" />
        </View>
        <View className="flex-1">
          <Text className="text-white text-base leading-5 font-medium">
            {t('settings.addProfile', 'Add profile')}
          </Text>
        </View>
      </TouchableOpacity>
    </SettingsSection>
  );
}

export default ProfilesSection;
