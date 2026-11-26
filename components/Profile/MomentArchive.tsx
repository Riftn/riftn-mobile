import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useUser } from '../../context/AuthContext';
import { useKidsModeLock } from '../../hooks/useKidsModeLock';
import { MATURE_CONTENT_ENABLED } from '../../config/storefront';
import { getStory, getStoryArchive } from '../../services/stories.service';
import { storiesState, openStoryViewer, closeStoryViewer } from '../../store/stories.store';
import { toastError } from '../../libs/toast';

export default function MomentArchive() {
  const { t } = useTranslation();
  const user = useUser();
  const address = (user?.walletAddress || user?.address || '').toLowerCase();
  const kidsMode = useKidsModeLock();
  const canSeeMature = MATURE_CONTENT_ENABLED && !!user?.showMatureContent && !kidsMode;
  const [open, setOpen] = useState(false);
  if (!address) return null;
  const title = t('stories.momentArchive', { defaultValue: 'Moment archive' });
  const privacyLabel = t('stories.archiveOnlyYou', { defaultValue: 'Only you can see this' });
  return (
    <View className="mt-3">
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
        accessibilityLabel={`${title}. ${privacyLabel}`}
        className="self-start min-h-11 flex-row items-center gap-2 px-2">
        <Ionicons name="archive-outline" size={17} color="#a1a1aa" />
        <Text className="font-semibold text-theme-neutrals-100">{title}</Text>
        <Ionicons name="lock-closed" size={12} color="#a1a1aa" />
      </Pressable>
      {open && <ArchiveItems key={address + canSeeMature} address={address} canSeeMature={canSeeMature} />}
    </View>
  );
}

function ArchiveItems({ address, canSeeMature }: { address: string; canSeeMature: boolean }) {
  const { t, i18n } = useTranslation();
  const request = useRef<symbol | null>(null);
  const openedViewer = useRef<typeof storiesState.viewer>(null);
  const archive = useInfiniteQuery({
    queryKey: ['moment-archive', address, canSeeMature],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getStoryArchive(pageParam),
    getNextPageParam: page => page.next ?? undefined,
    gcTime: 0,
    retry: false,
  });
  useEffect(() => () => {
    request.current = null;
    if (openedViewer.current && storiesState.viewer === openedViewer.current) closeStoryViewer();
  }, []);
  const open = async (id: string) => {
    const token = Symbol();
    request.current = token;
    try {
      const { author, item } = await getStory(id, true);
      if (request.current !== token) return;
      if (author?.address.toLowerCase() !== address || item.address.toLowerCase() !== address
        || item.status !== 'ready' || (item.isMature && !canSeeMature)) throw new Error();
      openStoryViewer([{ author, own: true, following: false, seen: true, latestAt: item.createdAt, items: [item] }], 0, true);
      openedViewer.current = storiesState.viewer;
    } catch {
      if (request.current === token) {
        toastError(t('stories.originalUnavailable', { defaultValue: 'The original moment is no longer available.' }));
        void archive.refetch();
      }
    }
  };
  const items = archive.data?.pages.flatMap(page => page.items)
    .filter(item => item.address.toLowerCase() === address && (!item.isMature || canSeeMature)) ?? [];
  return (
    <ScrollView horizontal contentContainerStyle={{ alignItems: 'center', gap: 8, paddingVertical: 6 }}>
      {items.map(item => {
        const date = new Date(item.createdAt).toLocaleDateString(i18n.language?.replace('_', '-'));
        return (
          <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={date}
            onPress={() => void open(item.id)} className="h-28 w-20 items-center justify-center overflow-hidden rounded-xl bg-zinc-800">
            <Ionicons name="film-outline" size={22} color="white" />
            <Text className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-1 text-center text-xs text-white">{date}</Text>
          </Pressable>
        );
      })}
      {archive.isLoading && <ActivityIndicator accessibilityLabel={t('common.loading')} />}
      {!items.length && archive.isSuccess && <Text className="text-theme-neutrals-400">{t('nftMarket.noActivity')}</Text>}
      {(archive.isError || archive.hasNextPage) && (
        <Pressable accessibilityRole="button" disabled={archive.isFetching} className="px-3 py-2"
          onPress={() => archive.hasNextPage ? void archive.fetchNextPage() : void archive.refetch()}>
          <Text className="text-theme-neutrals-100">{t(archive.isError ? 'common.retry' : 'common.loadMore')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
