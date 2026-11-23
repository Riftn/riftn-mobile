import React from 'react';
import { Image, Text, View, type TextStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getBadgeUrlFor } from '../../libs/misc';
import { useAccountBadge } from '../../hooks/useAccountBadge';
import type { StoredProfile } from '../../libs/profiles';

export default function SavedProfileName({ profile, className, style, badgeSize = 14 }: {
  profile: StoredProfile;
  className?: string;
  style?: TextStyle;
  badgeSize?: number;
}) {
  const { t } = useTranslation();
  const lookedUpBadge = useAccountBadge(profile.hideBadgeAndBalance === undefined ? profile.address : undefined);
  const badge = profile.hideBadgeAndBalance === false ? getBadgeUrlFor(profile) : lookedUpBadge;
  return (
    <View className="flex-row items-center gap-1">
      <Text className={className} style={[{ flexShrink: 1 }, style]} numberOfLines={1}>
        {profile.name || profile.username || t('nav.profile')}
      </Text>
      {badge ? <Image source={badge} style={{ width: badgeSize, height: badgeSize }} resizeMode="contain" /> : null}
    </View>
  );
}
