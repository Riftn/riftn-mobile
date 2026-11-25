/**
 * Settings → Profile → Badge Museum: the museum's home. Mirrors web's
 * `BadgeMuseumSetting` (src/components/app/settings/BadgeMuseumSetting.tsx).
 *
 * The museum is off by default, so it shows here and nowhere else until "Show
 * Badge Museum on my profile" is switched on. "View my Badge Museum" opens the
 * full museum (earned and locked, with progress) for yourself either way.

 */
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Divider, SettingsLinkRow, SettingsSection, SettingsToggleRow } from './SettingsPrimitives';
import { BadgeMuseumSheet, MedalPodium } from '../Profile/BadgeMuseum';
import { badgeMuseumIsShown, earnedByRarity, useMilestones } from '../../hooks/useMilestones';
import { useUser } from '../../context/AuthContext';
import { AuthService } from '../../services/auth.service';
import { getAccountProfile } from '../../services/user.service';
import { formatCount } from '../../libs/format-count';
import { toastError } from '../../libs/toast';

export default function BadgeMuseumSection() {
  const { t } = useTranslation();
  const user = useUser();
  const queryClient = useQueryClient();
  const address = (user as any)?.address || (user as any)?.walletAddress || null;
  const { data } = useMilestones(address);
  const [preference, setPreference] = useState<{ address: string; shown: boolean } | null>(null);
  const shown = preference?.address === address ? preference?.shown ?? null : null;
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  // The copy on the phone can be days old; ask the server once on open.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getAccountProfile(address)
      .then((account) => {
        if (!cancelled && account) setPreference({ address, shown: badgeMuseumIsShown(account.customs) });
      })
      .catch(() => {
        if (!cancelled) setPreference(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address) return null;

  const toggle = async (next: boolean) => {
    if (shown === null || saving) return;
    const before = shown;
    setPreference({ address, shown: next });
    setSaving(true);
    try {
      await AuthService.updateProfile({ badgeMuseumVisibility: next ? 'public' : 'hidden' });
      void queryClient.invalidateQueries({ queryKey: ['profile-milestones'] });
    } catch (error) {
      setPreference((current) => current?.address === address ? { address, shown: before } : current);
      toastError(error, t('badgeMuseum.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const earned = data ? earnedByRarity(data.milestones) : [];

  return (
    <SettingsSection label={t('badgeMuseum.title')} icon="Landmark" anchor="badge-museum">
      <View className="px-4 py-3.5 flex-row items-center" style={{ gap: 12 }}>
        {/* The section label already says "Badge Museum", so the row leads with the count. */}
        <Text className="flex-1 text-white text-base leading-5 font-medium">
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
        value={!!shown}
        disabled={shown === null || saving}
        onValueChange={(next) => void toggle(next)}
      />
      <Divider />
      <SettingsLinkRow icon="Landmark" label={t('badgeMuseum.viewMine')} onPress={() => setOpen(true)} />
      {open ? <BadgeMuseumSheet address={address} onClose={() => setOpen(false)} /> : null}
    </SettingsSection>
  );
}
