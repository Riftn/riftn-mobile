import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Avatar from '../components/common/Avatar';
import { getAccountSummaries } from '../services/user.service';
import { useUserProfileSheet } from '../context/UserProfileSheetContext';
import ScreenHeader from '../components/ScreenHeader';
import SmartImage from '../components/common/SmartImage';
import ImageViewerModal from '../components/common/ImageViewerModal';
import FeedActionBar from '../components/Home/FeedActionBar';
import CommentItem from '../components/Comments/CommentItem';
import type { Comment } from '../services/nft.service';
import { useUser } from '../context/AuthContext';
import { ScreenNames } from '../navigation/ScreenNames';
import type { AppStackParamList } from '../navigation/types';
import { readGenerations, readGenerationDiscussion, writeGeneration, generationPath, type PublicGeneration, type ThreadCommentRow } from '../services/creator-gallery.service';
import { type PostReaction, type ReactionCounts } from '../libs/reactions';
import { shareWithRef } from '../libs/shareRef';
import { SHARE_ORIGIN } from '../libs/dehub-links';
import { useDraftState } from '../hooks/useDraftState';

function MosaicImage({ item, onPress }: { item: PublicGeneration; onPress: () => void }) {
  const [ratio, setRatio] = useState(item.width && item.height ? item.width / item.height : 1);
  useEffect(() => { if (!item.width || !item.height) Image.getSize(item.image_url, (w, h) => setRatio(w / h), () => {}); }, [item.image_url, item.width, item.height]);
  return <Pressable accessibilityRole="button" accessibilityLabel={item.title || 'View generation'} onPress={onPress} style={{ marginBottom: 8, borderRadius: 12, overflow: 'hidden' }}>
    <SmartImage source={{ uri: item.image_url }} style={{ width: '100%', aspectRatio: ratio }} contentFit="contain" />
  </Pressable>;
}

export default function CreatorGalleryScreen() {
  const { t } = useTranslation();
  const nav = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const route = useRoute<RouteProp<AppStackParamList, ScreenNames.CreatorGallery>>();
  const id = route.params?.id;
  const user = useUser();
  const { showUserProfile } = useUserProfileSheet();
  const wallet = (user?.walletAddress || user?.address || '').toLowerCase();
  const { width } = useWindowDimensions();
  const qc = useQueryClient();
  const scroll = useRef<ScrollView>(null);
  const input = useRef<TextInput>(null);
  const pager = useRef<FlatList<PublicGeneration>>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [reply, setReply] = useState<ThreadCommentRow | null>(null);
  const [editing, setEditing] = useState<ThreadCommentRow | null>(null);
  const [draft, setDraft] = useDraftState(`generation:${wallet}:${id}`, '');
  const [commentY, setCommentY] = useState(0);
  const list = useInfiniteQuery({ queryKey: ['public-generations', 'list', wallet], initialPageParam: 0,
    queryFn: ({ pageParam }) => readGenerations(pageParam, undefined, wallet), getNextPageParam: (page, pages) => page.length === 40 ? pages.length * 40 : undefined });
  const detail = useQuery({ queryKey: ['public-generations', id, wallet], queryFn: () => readGenerations(0, id, wallet), enabled: !!id });
  const discussion = useQuery({ queryKey: ['generation-discussion', id, wallet], queryFn: () => readGenerationDiscussion(id!), enabled: !!id });
  const items = list.data?.pages.flat() ?? [];
  const item = detail.data?.[0];
  const author = useQuery({ queryKey: ['generation-author', item?.owner_wallet], enabled: !!item?.owner_wallet, staleTime: 300_000, queryFn: async () => (await getAccountSummaries([item!.owner_wallet!]))[0] }).data;
  const index = items.findIndex(row => row.id === id);
  useEffect(() => { if (id && list.hasNextPage && !list.isFetchingNextPage && (index < 0 || index >= items.length - 2)) void list.fetchNextPage(); }, [id, index, items.length, list.hasNextPage, list.isFetchingNextPage]);
  useEffect(() => { setReply(null); setEditing(null); setFullscreen(false); if (index >= 0) pager.current?.scrollToIndex({ index, animated: false }); }, [id, index, width]);
  const mutation = useMutation({ mutationFn: ({ action, data }: { action: string; data: Record<string, string | boolean | null> }) => writeGeneration(id!, action, { ...data, username: user?.username ?? null, avatar: user?.avatarImageUrl ?? null }, wallet),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['public-generations'] }); void qc.invalidateQueries({ queryKey: ['generation-discussion', id] }); },
    onError: (error: Error) => Alert.alert(t('common.error', { defaultValue: 'Something went wrong. Please try again.' }), error.message) });
  const act = (action: string, data: Record<string, string | boolean | null>) => { if (!wallet) { nav.navigate(ScreenNames.SignIn); return; } if (!mutation.isPending) mutation.mutate({ action, data }); };
  const showComments = () => { scroll.current?.scrollTo({ y: commentY, animated: true }); input.current?.focus(); };
  const rows = useMemo(() => {
    const source = discussion.data?.comments ?? [];
    const byId = new Map(source.map(row => [row.id, row]));
    const rootOf = (row: ThreadCommentRow) => { const seen = new Set<string>(); let root = row; while (root.parent_id && byId.has(root.parent_id) && !seen.has(root.id)) { seen.add(root.id); root = byId.get(root.parent_id)!; } return root.id; };
    const result: ThreadCommentRow[] = [];
    source.filter(row => !row.parent_id).forEach(root => { result.push(root, ...source.filter(row => row.id !== root.id && rootOf(row) === root.id)); });
    return result;
  }, [discussion.data]);
  const share = () => { void shareWithRef({ message: `${SHARE_ORIGIN}${generationPath(id!)}`, url: `${SHARE_ORIGIN}${generationPath(id!)}` }).catch(() => {}); };
  const button = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} className="rounded-xl border border-theme-neutrals-600 px-4 py-3" style={{ opacity: disabled ? 0.35 : 1 }}><Text className="text-theme-neutrals-100">{label}</Text></Pressable>;
  return <View className="flex-1 bg-theme-neutrals-900">
    <ScreenHeader title={t('creator.madeOnDehub')} />
    {id ? <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 100 }}>
      {detail.isLoading ? <ActivityIndicator /> : detail.isError ? button(t('common.retry', { defaultValue: 'Retry' }), () => void detail.refetch()) : !item ? <Text className="p-4 text-theme-neutrals-100">{t('creator.gallery.missing', { defaultValue: 'This generation is unavailable.' })}</Text> : <>
        <View className="flex-row justify-between px-3 py-2">
          {button(t('common.previous', { defaultValue: 'Previous' }), () => nav.setParams({ id: items[index - 1]?.id, commentId: undefined, comment: undefined }), index <= 0)}
          {button(t('creator.gallery.browse', { defaultValue: 'Browse generations' }), () => nav.setParams({ id: undefined, commentId: undefined, comment: undefined }))}
          {button(t('common.next', { defaultValue: 'Next' }), () => nav.setParams({ id: items[index + 1]?.id, commentId: undefined, comment: undefined }), index < 0 || index >= items.length - 1)}
        </View>
        {index >= 0 ? <FlatList ref={pager} data={items} horizontal pagingEnabled initialScrollIndex={index} keyExtractor={row => row.id} showsHorizontalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })} windowSize={3} initialNumToRender={3}
          onMomentumScrollEnd={event => { const next = items[Math.round(event.nativeEvent.contentOffset.x / width)]; if (next && next.id !== id) nav.setParams({ id: next.id, commentId: undefined, comment: undefined }); }}
          renderItem={({ item: slide }) => <Pressable onPress={() => setFullscreen(true)} accessibilityLabel={t('creator.gallery.fullscreen', { defaultValue: 'View full screen' })} style={{ width, height: width * 0.85, backgroundColor: '#000' }}><SmartImage source={{ uri: slide.image_url }} contentFit="contain" style={{ width, height: '100%' }} /></Pressable>} />
          : <MosaicImage item={item} onPress={() => setFullscreen(true)} />}
        <View className="px-4">{item.owner_wallet && <Pressable onPress={() => showUserProfile(author?.username || item.owner_wallet!)} className="mt-4 flex-row items-center gap-3"><Avatar uri={author?.avatarImageUrl} name={author?.username || item.owner_wallet} size={36} /><Text className="font-bold text-theme-neutrals-100">{author?.displayName || author?.username || item.owner_wallet.slice(0, 6) + '…' + item.owner_wallet.slice(-4)}</Text></Pressable>}<Text className="mt-4 text-lg font-bold text-theme-neutrals-100">{item.title || t('creator.aiGenerationAlt')}</Text>
          <FeedActionBar liked={!!item.my_reaction && item.my_reaction !== 'dislike'} disliked={item.my_reaction === 'dislike'} saved={item.saved} reposted={false}
            reactionCounts={item.reaction_counts} likeCount={item.likes} dislikeCount={item.dislikes} commentCount={item.comments} repostCount={0} tipCount={0} myReaction={item.my_reaction}
            onLike={() => act('react', { reaction: item.my_reaction ? null : 'like' })} onReact={reaction => act('react', { reaction: item.my_reaction === reaction ? null : reaction })}
            onComment={showComments} onShare={share} onSave={() => act('save', { saved: !item.saved })} onInfo={() => Alert.alert(item.title || t('creator.aiGenerationAlt'), new Date(item.created_at).toLocaleString())} />
        </View>
        <View onLayout={event => setCommentY(event.nativeEvent.layout.y)} className="px-3">
          {discussion.isLoading && <ActivityIndicator />}
          {discussion.isError && button(t('common.retry', { defaultValue: 'Retry' }), () => void discussion.refetch())}
          {rows.map((row, i) => {
            const reactions = (discussion.data?.reactions ?? []).filter(r => r.comment_id === row.id);
            const mine = reactions.find(r => r.wallet_address === wallet)?.reaction ?? null;
            const counts: ReactionCounts = {}; reactions.forEach(r => { counts[r.reaction] = (counts[r.reaction] ?? 0) + 1; });
            const comment: Comment = { id: i + 1, content: row.content, address: row.wallet_address, createdAt: row.created_at, user: { address: row.wallet_address, username: row.username ?? undefined, avatarImageUrl: row.avatar ?? undefined }, likeCount: reactions.filter(r => r.reaction !== 'dislike').length, dislikeCount: counts.dislike ?? 0, myReaction: mine, reactionCounts: counts, isLiked: !!mine && mine !== 'dislike', isDisliked: mine === 'dislike' };
            return <View key={row.id} style={{ marginLeft: row.parent_id ? 20 : 0, borderWidth: (route.params?.commentId || route.params?.comment) === row.id ? 1 : 0, borderColor: '#999', borderRadius: 12 }} onLayout={event => { if ((route.params?.commentId || route.params?.comment) === row.id) scroll.current?.scrollTo({ y: commentY + event.nativeEvent.layout.y, animated: true }); }}>
              <CommentItem comment={comment} isReply={!!row.parent_id} onReply={() => { setReply(row); setEditing(null); showComments(); }}
                onReact={async (_, reaction: PostReaction) => { if (!wallet) { nav.navigate(ScreenNames.SignIn); return; } await mutation.mutateAsync({ action: 'comment_react', data: { comment_id: row.id, reaction: mine === reaction ? null : reaction } }); }}
                onEdit={row.wallet_address === wallet ? () => { setEditing(row); setReply(null); setDraft(row.content); showComments(); } : undefined}
                onDelete={row.wallet_address === wallet ? () => act('delete', { comment_id: row.id }) : undefined} />
              {row.wallet_address === wallet && <View className="flex-row gap-3 px-4">{button(t('common.edit', { defaultValue: 'Edit' }), () => { setEditing(row); setReply(null); setDraft(row.content); showComments(); })}{button(t('common.delete'), () => act('delete', { comment_id: row.id }))}</View>}
            </View>;
          })}
          {(reply || editing) && button(t('common.cancel'), () => { setReply(null); setEditing(null); setDraft(''); })}
          {reply && <Text className="text-theme-neutrals-300">{t('governance.discussion.replyingTo', { name: reply.username || reply.wallet_address })}</Text>}
          <TextInput ref={input} multiline maxLength={4000} value={draft} editable={!mutation.isPending} onChangeText={setDraft} placeholder={t('governance.addComment')} placeholderTextColor="#888" className="my-3 rounded-xl border border-theme-neutrals-600 p-3 text-theme-neutrals-100" />
          {button(t('common.send', { defaultValue: 'Send' }), () => {
            if (!wallet) { nav.navigate(ScreenNames.SignIn); return; }
            mutation.mutate({ action: editing ? 'edit' : 'comment', data: { content: draft, parent_id: reply?.id ?? null, comment_id: editing?.id ?? null } }, { onSuccess: () => { setDraft(''); setReply(null); setEditing(null); } });
          }, !draft.trim() || mutation.isPending)}
        </View>
      </>}
    </ScrollView> : <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 100 }}>
      {list.isLoading && <ActivityIndicator />}{list.isError && button(t('common.retry', { defaultValue: 'Retry' }), () => void list.refetch())}
      <View style={{ flexDirection: 'row', gap: 8 }}>{[0, 1].map(column => <View key={column} style={{ flex: 1 }}>{items.filter((_, i) => i % 2 === column).map(row => <MosaicImage key={row.id} item={row} onPress={() => nav.setParams({ id: row.id, commentId: undefined, comment: undefined })} />)}</View>)}</View>
      {list.hasNextPage && button(t('common.loadMore'), () => void list.fetchNextPage(), list.isFetchingNextPage)}
    </ScrollView>}
    <ImageViewerModal images={fullscreen && item ? [item.image_url] : null} onClose={() => setFullscreen(false)} allowDownload />
  </View>;
}
