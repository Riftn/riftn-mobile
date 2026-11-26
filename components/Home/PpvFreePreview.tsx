import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../libs/api.client';
import GlassModal from '../ui/GlassModal';
import { KitButton } from '../page/PageKit';

export function PpvPreviewButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <View className="absolute bottom-3 left-3">
      <KitButton label={t('ppvPreview.watch', { defaultValue: 'Watch free preview' })} onPress={onPress} style={{ minHeight: 44 }} />
    </View>
  );
}

export function PpvPreviewSheet({ tokenId, signedIn, open, onClose }: {
  tokenId: string;
  signedIn: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <GlassModal visible={open} onClose={onClose} presentation="bottom">
      <View className="gap-3 px-4 pb-4">
        <Text className="text-theme-neutrals-100 text-base font-semibold" accessibilityRole="header">
          {t('ppvPreview.title', { defaultValue: 'Free video preview' })}
        </Text>
        {open && <PreviewPlayer tokenId={tokenId} signedIn={signedIn} />}
        <KitButton label={t('common.close')} onPress={onClose} />
      </View>
    </GlassModal>
  );
}

function PreviewPlayer({ tokenId, signedIn }: { tokenId: string; signedIn: boolean }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onError = useCallback(() => setFailed(true), []);

  useEffect(() => {
    let active = true;
    const endpoint = `/nfts/video/${encodeURIComponent(tokenId)}/preview`;
    apiClient.get<{ url: string }>(endpoint, { isAuthRequired: signedIn, quiet: true }).then(
      result => { if (active) setUrl(result.url); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [tokenId, signedIn, attempt]);

  return (
    <View className="items-center justify-center overflow-hidden rounded-xl bg-theme-neutrals-900" style={{ aspectRatio: 16 / 9 }}>
      {failed ? (
        <View className="gap-2 px-3">
          <Text accessibilityLiveRegion="polite" className="text-center text-sm text-theme-neutrals-100">
            {t('ppvPreview.unavailable', { defaultValue: 'Preview unavailable' })}
          </Text>
          <KitButton
            label={t('ppvPreview.retry', { defaultValue: 'Try again' })}
            onPress={() => { setFailed(false); setUrl(''); setAttempt(value => value + 1); }}
          />
        </View>
      ) : url ? (
        <Clip url={url} onError={onError} />
      ) : (
        <Text accessibilityLiveRegion="polite" className="text-sm text-theme-neutrals-100">
          {t('ppvPreview.loading', { defaultValue: 'Loading preview…' })}
        </Text>
      )}
    </View>
  );
}

function Clip({ url, onError }: { url: string; onError: () => void }) {
  const player = useVideoPlayer(url, instance => { instance.play(); });
  useEffect(() => {
    if (player.status === 'error') onError();
    const status = player.addListener('statusChange', event => {
      if (event.status === 'error') onError();
    });
    return () => status.remove();
  }, [player, onError]);
  return (
    <VideoView
      player={player}
      nativeControls
      surfaceType="textureView"
      contentFit="contain"
      style={{ width: '100%', height: '100%', backgroundColor: '#000' }}
    />
  );
}
