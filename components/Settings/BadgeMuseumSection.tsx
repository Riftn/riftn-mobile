/**
 * Settings → Profile → Badge Museum: the museum's home. Mirrors web's
 * `BadgeMuseumSetting` (src/components/app/settings/BadgeMuseumSetting.tsx).
 *
 * The museum is off by default, so it shows here and nowhere else until "Show
 * Badge Museum on my profile" is switched on. "View my Badge Museum" opens the
 * full museum (earned and locked, with progress) for yourself either way.
 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { Divider, SettingsLinkRow, SettingsSection, SettingsToggleRow } from './SettingsPrimitives';
import { BadgeMuseumSheet, MedalPodium } from '../Profile/BadgeMuseum';
import { earnedByRarity, useMilestones } from '../../hooks/useMilestones';
import { useUser } from '../../context/AuthContext';
import { AuthService } from '../../services/auth.service';
import { useAppTheme } from '../../context/ThemeContext';
import { formatCount } from '../../libs/format-count';
import { toastError } from '../../libs/toast';

export default function BadgeMuseumSection() {
  const { t } = useTranslation();
  const user = useUser();
  const { colors } = useAppTheme();
  const queryClient = useQueryClient();
  const address = user?.address || user?.walletAddress;
  const { data, isFetching, isError } = useMilestones(address, { refreshOnMount: true });
  const [open, setOpen] = useState(false);
  const mutationKey = ['badge-museum-visibility', address?.toLowerCase()];
  const saving = useIsMutating({ mutationKey }) > 0;
  const busy = isFetching || saving;
  const disabled = busy || isError || typeof data?.hidden !== 'boolean';
  const { mutate } = useMutation({
    mutationKey,
    mutationFn: ({ viewer, show }: { viewer: string; show: boolean }) => AuthService.updateProfile({
      badgeMuseumVisibility: show ? 'public' : 'hidden',
      badgeMuseumViewer: viewer,
    }),
    onError: (error) => toastError(error, t('badgeMuseum.saveFailed')),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['profile-milestones'] }),
  });

  if (!address) return null;

  const toggle = (next: boolean) => {
    if (!disabled && !queryClient.isMutating({ mutationKey })) {
      mutate({ viewer: address, show: next });
    }
  };

  const earned = data ? earnedByRarity(data.milestones) : [];

  return (
    <SettingsSection label={t('badgeMuseum.title')} icon="Landmark" anchor="badge-museum">
      <View className="px-4 py-3.5 flex-row items-center" style={{ gap: 12 }}>
        {/* The section label already says "Badge Museum", so the row leads with the count. */}
        <Text className="flex-1 text-base leading-5 font-medium" style={{ color: colors.foreground }}>
          {data
            ? t('badgeMuseum.summary', { earned: formatCount(data.earned), total: formatCount(data.total) })
            : t('badgeMuseum.loading')}
        </Text>
        {earned.length ? <MedalPodium medals={earned.slice(0, 3)} sizes={[28, 36]} /> : null}
      </View>
      <Divider />
      <SettingsToggleRow
        icon="Eye"
        label={t('badgeMuseum.showSetting')}
        description={t('badgeMuseum.showSettingHint')}
        value={data?.hidden === false}
        disabled={disabled}
        busy={busy}
        onValueChange={toggle}
      />
      <Divider />
      <SettingsLinkRow icon="Landmark" label={t('badgeMuseum.viewMine')} onPress={() => setOpen(true)} />
      {open ? <BadgeMuseumSheet address={address} onClose={() => setOpen(false)} /> : null}
    </SettingsSection>
  );
}
