import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Icon, { type IconName } from '../ui/Icon';
import GlassModal from '../ui/GlassModal';
import { shareWithRef } from '../../libs/shareRef';
import { toastError } from '../../libs/toast';
import { ScreenNames } from '../../navigation/ScreenNames';
import { useAuth } from '../../context/AuthContext';
import { useOpenSignIn } from '../../hooks/useOpenSignIn';
import { arcadeShareUrl } from '../../libs/arcadeCard';

export interface SnapshotFile {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
  fileName: string;
}

/**
 * The Share drawer on an arcade game, matching web's Share menu:
 *  - Post your score card: the game's link naming you, which the feed draws as
 *    the game's art with your name and best score on it.
 *  - Post a snapshot: a picture of your board right now, with the link under it.
 *  - Share link: the phone's own share sheet.
 */
export default function ArcadeShareSheet({ open, onClose, slug, title, snapshot }: {
  open: boolean;
  onClose: () => void;
  slug: string;
  title: string;
  /** Draws the game as it stands. Leave out for games with no board to picture. */
  snapshot?: () => Promise<SnapshotFile | null>;
}) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const openSignIn = useOpenSignIn();
  const { user } = useAuth();
  const wallet = (user?.walletAddress || user?.address) ?? null;
  const username = (user?.username as string | undefined)?.replace(/^@+/, '') || wallet;
  const [busy, setBusy] = useState(false);
  const plainUrl = arcadeShareUrl(slug);
  const cardUrl = arcadeShareUrl(slug, username);

  // Lets the drawer finish closing before the next screen opens.
  const later = (action: () => void) => {
    onClose();
    setTimeout(action, 300);
  };
  const signedIn = (action: () => void) => {
    if (!wallet) later(openSignIn);
    else action();
  };

  const row = (icon: IconName, label: string, onPress: () => void, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, opacity: disabled ? 0.45 : 1 }}
    >
      <Icon name={icon} size={20} color="#E4E4E7" />
      <Text style={{ color: '#F4F4F5', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );

  const postSnapshot = () => signedIn(() => {
    if (!snapshot || busy) return;
    setBusy(true);
    void snapshot()
      .catch(() => null)
      .then((file) => {
        setBusy(false);
        if (!file) {
          toastError(t('arcadeShare.snapshotFailed'));
          return;
        }
        later(() => navigation.navigate(ScreenNames.Upload, {
          tab: 'feed',
          initialText: `${cardUrl}&snap=1`,
          images: [{ ...file, type: 'image' }],
        }));
      });
  });

  return (
    <GlassModal visible={open} onClose={onClose} presentation="bottom" scrollable maxHeight="70%" blurIntensity={50}>
      <View style={{ padding: 12, paddingBottom: 24 }}>
        <Text numberOfLines={1} style={{ color: '#F4F4F5', fontSize: 16, fontWeight: '600', padding: 14 }}>{title}</Text>
        {row('Trophy', t('arcadeShare.postCard'), () => signedIn(() => later(() => navigation.navigate(ScreenNames.Upload, { tab: 'feed', initialText: cardUrl }))))}
        {snapshot ? row('Camera', t('arcadeShare.postSnapshot'), postSnapshot, busy) : null}
        {row('Share2', t('arcadeShare.shareLink'), () => later(() => {
          void shareWithRef({ url: plainUrl, message: `${title} ${plainUrl}` }).catch(() => undefined);
        }))}
      </View>
    </GlassModal>
  );
}
