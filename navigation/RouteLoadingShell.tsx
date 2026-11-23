import React from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import ScreenBones, { screenBonesFor } from '../components/skeleton/ScreenBones';
import SkeletonBlock from '../components/Feed/SkeletonBlock';
import Shine from '../components/skeleton/Shine';
import { useAppTheme } from '../context/ThemeContext';

/**
 * What a page shows while it opens, before its own code has run: the page's
 * measured layout as grey shapes (components/skeleton/ScreenBones), so the
 * shell has the shape of the page that replaces it. A page with no measured
 * layout gets a header row and a few lines.
 *
 * Native-stack can animate this before evaluating the destination module.
 */
export default function RouteLoadingShell({ onBack, profile = false, route }: {
  onBack?: () => void;
  profile?: boolean;
  route?: { name?: string };
}) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { pageColors } = useAppTheme();
  const { t } = useTranslation();
  const canBack = !!onBack || navigation.canGoBack?.();
  const bones = profile ? undefined : screenBonesFor(route?.name);
  return (
    <View testID="route-loading-shell" style={{ flex: 1, paddingTop: insets.top, backgroundColor: pageColors.background }}>
      {bones ? <ScreenBones entry={bones} /> : (
        <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flex: 1 }}>
          <View style={{ height: 64, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <SkeletonBlock style={{ width: 36, height: 36, borderRadius: 18 }} />
            <SkeletonBlock style={{ width: 132, height: 16 }} />
          </View>
          <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 14 }}>
            <SkeletonBlock style={{ height: profile ? 140 : 96, borderRadius: 12 }} />
            <SkeletonBlock style={{ height: 14, width: '84%' }} />
            <SkeletonBlock style={{ height: 14, width: '58%' }} />
            <SkeletonBlock style={{ height: 14, width: '72%' }} />
          </View>
          <Shine />
        </View>
      )}
      {/* Back works from the first frame, where the page's own arrow lands. */}
      {canBack ? <Pressable testID="route-loading-back" accessibilityRole="button"
        accessibilityLabel={t('common.goBack')} hitSlop={8}
        onPress={onBack ?? (() => navigation.goBack())}
        style={{ position: 'absolute', top: insets.top + 8, left: 8, width: 48, height: 48 }} /> : null}
    </View>
  );
}
