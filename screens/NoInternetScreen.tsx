import ThemePanel from '../components/ui/ThemePanel';
import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from '../components/ui/Icon';
import PrimaryButton from '../components/ui/PrimaryButton';
import { colors } from '../theme/colors';
import { isLanguageReady, readPreferredLanguage } from '../i18n';
import { offlineConnectionCopy } from '../i18n/offline-connection-copy';

interface NoInternetScreenProps {
  onRetry: () => Promise<void>;
}

export default function NoInternetScreen({ onRetry }: NoInternetScreenProps) {
  const { i18n } = useTranslation();
  const [initialLanguage, setInitialLanguage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (isLanguageReady()) return;
    let active = true;
    void readPreferredLanguage().then(language => {
      if (active) setInitialLanguage(language);
    });
    return () => { active = false; };
  }, []);
  const language = isLanguageReady() || (i18n.language && i18n.language !== 'en')
    ? i18n.language
    : initialLanguage;
  const copy = language ? offlineConnectionCopy(language) : null;

  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    // Laid over the running app (App.tsx), so the fill must be solid: pinned
    // to the edges it counts as an overlay, and a canvas theme (Hazy, Cosmic,
    // Osaka) does not thin it into the see-through page veil that let the
    // feed show through the text.
    <View className="absolute inset-0 bg-theme-neutrals-900">
      {copy && <SafeAreaView className="flex-1">
        <ScrollView contentContainerClassName="grow justify-center items-center px-6 py-4" alwaysBounceVertical={false}>
          <ThemePanel className="bg-theme-neutrals-800 rounded-2xl p-6 mb-6 relative">
            <Icon
              name="WifiOff"
              size={64}
              color={colors.neutrals[400]}
            />
          </ThemePanel>

          <Text accessibilityRole="header" accessibilityLiveRegion="polite" className="text-theme-neutrals-100 text-2xl font-bold text-center mb-3">
            {copy.noInternetTitle}
          </Text>

          <Text className="text-theme-neutrals-300 text-base text-center mb-8 leading-6 max-w-sm">
            {copy.noInternetBody}
          </Text>

          <ThemePanel className="bg-theme-neutrals-800 rounded-lg p-4 mb-8 w-full max-w-sm">
            <View className="flex-row items-center justify-center">
              <View className="w-3 h-3 bg-white rounded-full mr-3" />
              <Text className="text-theme-neutrals-200 text-sm shrink text-center">
                {copy.noInternetStatus}
              </Text>
            </View>
          </ThemePanel>

          <View className="w-full max-w-sm mb-4">
            <PrimaryButton title={copy.tryAgain} onPress={() => { void retry(); }} icon="RefreshCw" large loading={retrying} />
          </View>

          <Text className="text-theme-neutrals-400 text-sm text-center max-w-xs">
            {copy.noInternetHint.replace('{{action}}', () => copy.tryAgain)}
          </Text>
        </ScrollView>
      </SafeAreaView>}
    </View>
  );
}
