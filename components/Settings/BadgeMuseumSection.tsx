/**
 * Settings → Profile → Badge Museum: the museum's home. Mirrors web's
 * `BadgeMuseumSetting` (src/components/app/settings/BadgeMuseumSetting.tsx).
 *
 * The museum is off by default, so it shows here and nowhere else until "Show
 * Badge Museum on my profile" is switched on. "View my Badge Museum" opens the
 * full museum (earned and locked, with progress) for yourself either way.
 *
 * The switch saves on its own, merged into a fresh copy of `customs` read from
 * the server, so no other setting is lost (the API replaces the whole blob).
 */
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Divider, SettingsLinkRow, SettingsSection, SettingsToggleRow } from './SettingsPrimitives';
import { BadgeMuseumSheet, MedalPodium } from '../Profile/BadgeMuseum';
import { BADGE_MUSEUM_VISIBILITY_KEY, badgeMuseumIsShown, earnedByRarity, useMilestones } from '../../hooks/useMilestones';
import { useAuthActions, useUser } from '../../context/AuthContext';
import { AuthService } from '../../services/auth.service';
import { getAccountProfile } from '../../services/user.service';
import { formatCount } from '../../libs/format-count';
import { toastError } from '../../libs/toast';

export default function BadgeMuseumSection() {
  const { t } = useTranslation();
  const user = useUser();
  const { patchUser } = useAuthActions();
  const queryClient = useQueryClient();
  const address = (user as any)?.address || (user as any)?.walletAddress || null;
  const { data } = useMilestones(address);
  const [shown, setShown] = useState(() => badgeMuseumIsShown(user?.customs as Record<string, unknown> | undefined));
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  // The copy on the phone can be days old; ask the server once on open.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    getAccountProfile(address)
      .then((account) => {
        if (!cancelled && account) setShown(badgeMuseumIsShown(account.customs as Record<string, unknown> | undefined));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address) return null;

  const toggle = async (next: boolean) => {
    const before = shown;
    setShown(next);
    setSaving(true);
    try {
      const account = await getAccountProfile(address);
      if (!account) throw new Error(t('settings.updateFailed'));
      const merged = {
        ...((account.customs as Record<string, unknown> | undefined) ?? {}),
        [BADGE_MUSEUM_VISIBILITY_KEY]: next ? 'public' : 'hidden',
      };
      await AuthService.updateProfile({ customs: JSON.stringify(merged) });
      await patchUser({ customs: merged } as any);
      void queryClient.invalidateQueries({ queryKey: ['profile-milestones'] });
    } catch (error) {
      setShown(before);
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
        value={shown}
        disabled={saving}
        onValueChange={(next) => void toggle(next)}
      />
      <Divider />
      <SettingsLinkRow icon="Landmark" label={t('badgeMuseum.viewMine')} onPress={() => setOpen(true)} />
      {open ? <BadgeMuseumSheet address={address} onClose={() => setOpen(false)} /> : null}
    </SettingsSection>
  );
}
