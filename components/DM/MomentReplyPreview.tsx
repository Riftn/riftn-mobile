import React, { useEffect, useReducer, useRef } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useUser } from '../../context/AuthContext';
import { useKidsModeLock } from '../../hooks/useKidsModeLock';
import { MATURE_CONTENT_ENABLED } from '../../config/storefront';
import { getStory } from '../../services/stories.service';
import { openStoryViewer } from '../../store/stories.store';
import { toastError } from '../../libs/toast';
import { nameOf } from '../Stories/story-utils';
import Icon from '../ui/Icon';

export default function MomentReplyPreview({ id, onLongPress }: { id: string; onLongPress: () => void }) {
  const { t } = useTranslation();
  const user = useUser();
  const address = (user?.walletAddress || user?.address || '').toLowerCase();
  const kidsMode = useKidsModeLock();
  const canSeeMature = MATURE_CONTENT_ENABLED && !!address && user?.showMatureContent === true && !kidsMode;
  const query = useQuery({
    queryKey: ['moment-reply-preview', id, address, canSeeMature],
    queryFn: () => getStory(id, !!address),
    enabled: !!address,
    gcTime: 0,
    retry: false,
  });
  const request = useRef<symbol | null>(null);
  useEffect(() => () => { request.current = null; }, [id, address, canSeeMature]);
  const expires = Date.parse(query.data?.item.expiresAt ?? '');
  const [, onExpiry] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    if (expires > Date.now()) {
      const timer = setTimeout(onExpiry, expires - Date.now() + 1);
      return () => clearTimeout(timer);
    }
  }, [expires]);
  const visible = (item: Awaited<ReturnType<typeof getStory>>['item']) =>
    !item.expired && item.status === 'ready' && Date.parse(item.expiresAt) > Date.now() && (!item.isMature || canSeeMature);
  const current = query.isSuccess && query.data.author && visible(query.data.item) ? query.data : undefined;
  const thumb = current?.item.posterUrl || (current?.item.type === 'photo' ? current.item.mediaUrl : null);
  const open = async () => {
    if (request.current) return;
    const token = Symbol();
    request.current = token;
    const result = await query.refetch();
    if (request.current !== token) return;
    request.current = null;
    if (!result.isSuccess || !result.data.author || !visible(result.data.item)) {
      toastError(t('stories.originalUnavailable', { defaultValue: 'The original moment is no longer available.' }));
      return;
    }
    const { author, item } = result.data;
    openStoryViewer([{ author, own: author.address.toLowerCase() === address, following: false, seen: item.viewed, latestAt: item.createdAt, items: [item] }], 0, true);
  };
  return (
    <TouchableOpacity onPress={open} onLongPress={onLongPress} accessibilityRole="button"
      className="mx-1 mt-1 flex-row items-center gap-2.5 rounded-lg border-l-2 border-white/40 bg-white/10 px-2 py-1.5">
      <View className="h-11 w-8 items-center justify-center overflow-hidden rounded-md bg-zinc-800">
        {thumb ? <Image source={{ uri: thumb }} recyclingKey={thumb} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Icon name="Layers" size={16} color="#fff" />}
      </View>
      <View className="flex-shrink">
        <Text className="text-xs text-theme-neutrals-400">{t('stories.watchOriginal', { defaultValue: 'Watch original moment' })}</Text>
        {current?.author && <Text numberOfLines={1} className="text-sm font-semibold text-theme-neutrals-100">{nameOf(current.author)}</Text>}
      </View>
      <Icon name="ChevronRight" size={14} color="#999" />
    </TouchableOpacity>
  );
}
