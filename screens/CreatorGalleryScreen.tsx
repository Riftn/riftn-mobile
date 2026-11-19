import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../components/ui/Icon';
import { useChatCardAccent } from '../components/DM/ChatCard';
import { useAppTheme } from '../context/ThemeContext';
import { MINIMAL_HAIRLINE } from '../theme/colors';
import { glassTint } from '../theme/skins';
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

// Chat's glass card (components/DM/ChatCard), so the gallery reads as part of Chat in every theme.
// Written dark; System Light turns the greys around as it renders.
function GalleryCard({ children, radius = 18, style }: { children: React.ReactNode; radius?: number; style?: object }) {
  const { skin, isMinimal, isLight } = useAppTheme();
  const fill = isMinimal ? '#000000' : skin ? glassTint(String(skin.barFill.backgroundColor ?? 'rgb(24,24,27)'), 0.62) : 'rgba(24,24,27,0.78)';
  return <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
    {!isLight && !isMinimal ? <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} /> : null}
    {children}
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: isMinimal ? MINIMAL_HAIRLINE : 'rgba(255,255,255,0.12)' }]} />
  </View>;
}

const compact = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

function MosaicImage({ item, onPress }: { item: PublicGeneration; onPress: () => void }) {
  const [ratio, setRatio] = useState(item.width && item.height ? item.width / item.height : 1);
  useEffect(() => { if (!item.width || !item.height) Image.getSize(item.image_url, (w, h) => setRatio(w / h), () => {}); }, [item.image_url, item.width, item.height]);
  return <Pressable accessibilityRole="button" accessibilityLabel={item.title || 'View generation'} onPress={onPress} style={({ pressed }) => ({ marginBottom: 10, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
    <GalleryCard>
      <SmartImage source={{ uri: item.image_url }} style={{ width: '100%', aspectRatio: ratio }} contentFit="cover" />
      {item.video_url ? <View style={styles.badge}><Icon name="Play" size={11} color="#fff" /></View> : null}
      {item.likes > 0 || item.comments > 0 ? <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.7)']} style={styles.meta}>
        {item.likes > 0 ? <View style={styles.stat}><Icon name="Heart" size={12} color="#fff" /><Text style={styles.statText}>{compact(item.likes)}</Text></View> : null}
        {item.comments > 0 ? <View style={styles.stat}><Icon name="MessageCircle" size={12} color="#fff" /><Text style={styles.statText}>{compact(item.comments)}</Text></View> : null}
      </LinearGradient> : null}
    </GalleryCard>
  </Pressable>;
}

const SKELETONS = [180, 240, 150, 210, 260, 170];
function MosaicSkeleton() {
  return <View style={{ flexDirection: 'row', gap: 10 }}>{[0, 1].map(column => <View key={column} style={{ flex: 1 }}>
    {SKELETONS.filter((_, i) => i % 2 === column).map((height, i) => <GalleryCard key={i} style={{ height, marginBottom: 10, opacity: 0.6 }}><View /></GalleryCard>)}
  </View>)}</View>;
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
  const accent = useChatCardAccent();
  const accentInk = accent === '#FFFFFF' ? '#0B0B0C' : '#FFFFFF';
  const stageWidth = width - 24;
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
    onError: (error: Error) => Alert.alert(t('common.somethingWentWrong'), error.message) });
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
  const button = (label: string, onPress: () => void, disabled = false, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
    style={[styles.pill, primary ? { backgroundColor: accent } : null, { opacity: disabled ? 0.35 : 1 }]}><Text style={[styles.pillText, primary ? { color: accentInk } : null]}>{label}</Text></Pressable>;
  const iconButton = (name: 'ChevronLeft' | 'ChevronRight' | 'LayoutGrid', label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} hitSlop={4}
    style={[styles.iconButton, { opacity: disabled ? 0.3 : 1 }]}><Icon name={name} size={18} color="#E4E4E7" /></Pressable>;
  const goTo = (next?: string) => nav.setParams({ id: next, commentId: undefined, comment: undefined });
  return <View className="flex-1 bg-theme-neutrals-900">
    <ScreenHeader appearance="island" title={id && item ? item.title || t('creator.aiGenerationAlt') : t('creator.madeOnDehub')}
      rightContent={id ? <>{iconButton('ChevronLeft', t('common.previous', { defaultValue: 'Previous' }), () => goTo(items[index - 1]?.id), index <= 0)}
        {iconButton('LayoutGrid', t('creator.gallery.browse', { defaultValue: 'Browse generations' }), () => goTo(undefined))}
        {iconButton('ChevronRight', t('common.next', { defaultValue: 'Next' }), () => goTo(items[index + 1]?.id), index < 0 || index >= items.length - 1)}</> : undefined} />
    {id ? <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 100 }}>
      {detail.isLoading ? <View style={{ padding: 12 }}><GalleryCard style={{ height: width * 0.85, opacity: 0.6 }}><View /></GalleryCard></View> : detail.isError ? button(t('common.retry', { defaultValue: 'Retry' }), () => void detail.refetch()) : !item ? <View style={{ padding: 12 }}><GalleryCard><View style={{ padding: 24, alignItems: 'center', gap: 12 }}><Text style={styles.muted}>{t('creator.gallery.missing', { defaultValue: 'This generation is unavailable.' })}</Text>{button(t('creator.gallery.browse', { defaultValue: 'Browse generations' }), () => goTo(undefined))}</View></GalleryCard></View> : <>
        <View style={{ paddingHorizontal: 12, paddingTop: 4 }}><GalleryCard radius={22}>
        {index >= 0 ? <FlatList ref={pager} data={items} horizontal pagingEnabled initialScrollIndex={index} keyExtractor={row => row.id} showsHorizontalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: stageWidth, offset: stageWidth * i, index: i })} windowSize={3} initialNumToRender={3}
          onMomentumScrollEnd={event => { const next = items[Math.round(event.nativeEvent.contentOffset.x / stageWidth)]; if (next && next.id !== id) nav.setParams({ id: next.id, commentId: undefined, comment: undefined }); }}
          renderItem={({ item: slide }) => <Pressable onPress={() => setFullscreen(true)} accessibilityLabel={t('creator.gallery.fullscreen', { defaultValue: 'View full screen' })} style={{ width: stageWidth, height: stageWidth * 1.05, backgroundColor: 'rgba(0,0,0,0.35)' }}><SmartImage source={{ uri: slide.image_url }} contentFit="contain" style={{ width: stageWidth, height: '100%' }} />
            {slide.video_url ? <View style={styles.badge}><Icon name="Play" size={11} color="#fff" /></View> : null}
            <View style={styles.stageTool}><Icon name="Maximize2" size={16} color="#fff" /></View></Pressable>} />
          : <MosaicImage item={item} onPress={() => setFullscreen(true)} />}
        </GalleryCard></View>
        <View style={{ paddingHorizontal: 12, paddingTop: 10 }}><GalleryCard><View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 }}>{item.owner_wallet && <Pressable onPress={() => showUserProfile(author?.username || item.owner_wallet!)} className="flex-row items-center gap-3"><Avatar uri={author?.avatarImageUrl} name={author?.username || item.owner_wallet} size={36} /><Text className="font-bold text-theme-neutrals-100">{author?.displayName || author?.username || item.owner_wallet.slice(0, 6) + '…' + item.owner_wallet.slice(-4)}</Text></Pressable>}<Text className="mt-3 text-lg font-bold text-theme-neutrals-100">{item.title || t('creator.aiGenerationAlt')}</Text><Text style={styles.muted}>{new Date(item.created_at).toLocaleDateString()}</Text>
          <FeedActionBar liked={!!item.my_reaction && item.my_reaction !== 'dislike'} disliked={item.my_reaction === 'dislike'} saved={item.saved} reposted={false}
            reactionCounts={item.reaction_counts} likeCount={item.likes} dislikeCount={item.dislikes} commentCount={item.comments} repostCount={0} tipCount={0} myReaction={item.my_reaction}
            onLike={() => act('react', { reaction: item.my_reaction ? null : 'like' })} onReact={reaction => act('react', { reaction: item.my_reaction === reaction ? null : reaction })}
            onComment={showComments} onShare={share} onSave={() => act('save', { saved: !item.saved })} onInfo={() => Alert.alert(item.title || t('creator.aiGenerationAlt'), new Date(item.created_at).toLocaleString())} />
        </View></GalleryCard></View>
        <View onLayout={event => setCommentY(event.nativeEvent.layout.y)} style={{ paddingHorizontal: 12, paddingTop: 10 }}><GalleryCard><View style={{ padding: 10 }}>
          {discussion.isLoading && <ActivityIndicator />}
          {discussion.isError && button(t('common.retry', { defaultValue: 'Retry' }), () => void discussion.refetch())}
          {rows.map((row, i) => {
            const reactions = (discussion.data?.reactions ?? []).filter(r => r.comment_id === row.id);
            const mine = reactions.find(r => r.wallet_address === wallet)?.reaction ?? null;
            const counts: ReactionCounts = {}; reactions.forEach(r => { counts[r.reaction] = (counts[r.reaction] ?? 0) + 1; });
            const comment: Comment = { id: i + 1, content: row.content, address: row.wallet_address, createdAt: row.created_at, user: { address: row.wallet_address, username: row.username ?? undefined, avatarImageUrl: row.avatar ?? undefined }, likeCount: reactions.filter(r => r.reaction !== 'dislike').length, dislikeCount: counts.dislike ?? 0, myReaction: mine, reactionCounts: counts, isLiked: !!mine && mine !== 'dislike', isDisliked: mine === 'dislike' };
            return <View key={row.id} style={{ marginLeft: row.parent_id ? 20 : 0, borderWidth: (route.params?.commentId || route.params?.comment) === row.id ? 1 : 0, borderColor: accent, borderRadius: 14 }} onLayout={event => { if ((route.params?.commentId || route.params?.comment) === row.id) scroll.current?.scrollTo({ y: commentY + event.nativeEvent.layout.y, animated: true }); }}>
              <CommentItem comment={comment} isReply={!!row.parent_id} onReply={() => { setReply(row); setEditing(null); showComments(); }}
                onReact={async (_, reaction: PostReaction) => { if (!wallet) { nav.navigate(ScreenNames.SignIn); return; } await mutation.mutateAsync({ action: 'comment_react', data: { comment_id: row.id, reaction: mine === reaction ? null : reaction } }); }}
                onEdit={row.wallet_address === wallet ? () => { setEditing(row); setReply(null); setDraft(row.content); showComments(); } : undefined}
                onDelete={row.wallet_address === wallet ? () => act('delete', { comment_id: row.id }) : undefined} />
              {row.wallet_address === wallet && <View className="flex-row gap-3 px-4">{button(t('common.edit', { defaultValue: 'Edit' }), () => { setEditing(row); setReply(null); setDraft(row.content); showComments(); })}{button(t('common.delete'), () => act('delete', { comment_id: row.id }))}</View>}
            </View>;
          })}
          {(reply || editing) && button(t('common.cancel'), () => { setReply(null); setEditing(null); setDraft(''); })}
          {reply && <Text className="text-theme-neutrals-300">{t('governance.discussion.replyingTo', { name: reply.username || reply.wallet_address })}</Text>}
          <TextInput ref={input} multiline maxLength={4000} value={draft} editable={!mutation.isPending} onChangeText={setDraft} placeholder={t('governance.addComment')} placeholderTextColor="#888" style={styles.field} className="my-3 text-theme-neutrals-100" />
          {button(t('creator.gallery.send'), () => {
            if (!wallet) { nav.navigate(ScreenNames.SignIn); return; }
            mutation.mutate({ action: editing ? 'edit' : 'comment', data: { content: draft, parent_id: reply?.id ?? null, comment_id: editing?.id ?? null } }, { onSuccess: () => { setDraft(''); setReply(null); setEditing(null); } });
          }, !draft.trim() || mutation.isPending, true)}
        </View></GalleryCard></View>
      </>}
    </ScrollView> : <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 100 }} scrollEventThrottle={200}
      onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; if (list.hasNextPage && !list.isFetchingNextPage && contentOffset.y + layoutMeasurement.height > contentSize.height - 800) void list.fetchNextPage(); }}>
      {list.isLoading && <MosaicSkeleton />}
      {list.isError && <GalleryCard><View style={{ padding: 24, alignItems: 'center' }}>{button(t('common.retry', { defaultValue: 'Retry' }), () => void list.refetch())}</View></GalleryCard>}
      {!list.isLoading && !list.isError && !items.length && <GalleryCard><View style={{ padding: 24, alignItems: 'center' }}><Text style={styles.muted}>{t('creator.gallery.empty')}</Text></View></GalleryCard>}
      <View style={{ flexDirection: 'row', gap: 10 }}>{[0, 1].map(column => <View key={column} style={{ flex: 1 }}>{items.filter((_, i) => i % 2 === column).map(row => <MosaicImage key={row.id} item={row} onPress={() => nav.setParams({ id: row.id, commentId: undefined, comment: undefined })} />)}</View>)}</View>
      {list.isFetchingNextPage && <ActivityIndicator style={{ marginTop: 8 }} />}
    </ScrollView>}
    <ImageViewerModal images={fullscreen && item ? [item.image_url] : null} onClose={() => setFullscreen(false)} allowDownload />
  </View>;
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: 8, left: 8, width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  meta: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: 10, paddingTop: 18, paddingBottom: 8 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  stageTool: { position: 'absolute', top: 10, right: 10, width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  iconButton: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pill: { alignSelf: 'flex-start', height: 38, paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.09)' },
  pillText: { color: '#F4F4F5', fontSize: 14, fontWeight: '600' },
  field: { borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  muted: { color: '#A1A1AA', fontSize: 12, marginTop: 2 },
});
