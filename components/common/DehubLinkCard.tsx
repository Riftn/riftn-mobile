import SkeletonBlock from '../Feed/SkeletonBlock';
import { useTranslation as _useCopy } from 'react-i18next';
/**
 * Riftn Link Card
 * ===============
 * Turns a parsed Riftn entity link into a card. The mobile counterpart of the
 * web app's DehubLinkEmbed, and the same deal: every surface that shows
 * user-written text renders links through here, so a shop item looks the same
 * in a DM as it does in the feed.
 *
 * Mobile recognised exactly one link shape before this — `/post/<id>` in a DM.
 * A community, a shop item, an event or a profile link arrived as a bare URL
 * everywhere, including in messages sent from the web app where the sender had
 * just watched it render as a card.
 *
 * Cards fall back to a chip that still opens the link. Surfaces strip the URL
 * out of the text on the assumption the card replaces it, so a card that
 * rendered nothing when its entity failed to load would take the link with it.
 */

import React, { memo, useCallback, createContext, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { storageImageSource } from '../../libs/cdnImage';
import { useNavigation, useLinkTo } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import Icon, { type IconName } from '../ui/Icon';
import SharedPostPreview from '../DM/SharedPostPreview';
import { ScreenNames } from '../../navigation/ScreenNames';
import { supabase } from '../../services/supabase';
import { fetchAppBySlug } from '../../services/miniapps.service';
import { getCommunityBySlug, previewCommunityInvite } from '../../services/communities.service';
import { getAccount } from '../../services/user.service';
import { getAvatarUrl } from '../../libs/misc';
import { formatCompactNumber } from '../../libs/numbers.util';
import { dehubLinkLabel, type DehubLinkMatch } from '../../libs/dehub-links';
import { useStages } from '../../context/StageContext';
import { useUserProfileSheet } from '../../context/UserProfileSheetContext';
import StageRecordingPlayer from '../Stages/StageRecordingPlayer';
import GeneratedStageCover from '../Stages/GeneratedStageCover';
import { useWorkJob } from '../../hooks/useWork';
import { appLocale } from "../../libs/date.util";
import { useAppTheme } from '../../context/ThemeContext';
import { fetchTitleOffers } from '../../services/justwatch.service';
import { resolveArticleSlug, resolveNewPost } from '../../services/nft.service';
import { detectLocale } from '../../libs/cinema-locales';
import { minimalFlat } from '../../theme/minimal';
import { useGovernanceProposal } from '../../hooks/useGovernanceDiscussion';
import { useAuthState } from '../../context/AuthContext';
import * as WebBrowser from 'expo-web-browser';
import { useOpenSignIn } from "../../hooks/useOpenSignIn";
import { useFeatureRequest, STATUS_LABELS, featureAttachments, isVideoAttachment } from '../../hooks/useFeatureRequests';
import { linkablePageFor } from '../../libs/linkablePages';
import { LinearGradient } from 'expo-linear-gradient';
import { KeepDarkScope } from '../../libs/jsx/tone';
import { arcadeCard } from '../../services/games.service';
import { arcadeArt, arcadeSlugOf, sharedLink } from '../../libs/arcadeCard';
import { formatCount } from '../../libs/format-count';

/** How many cards one message or caption may draw before the rest stay as text. */
export const MAX_CARDS_PER_MESSAGE = 2;

// ── Shared shell ────────────────────────────────────────────────────────────

/**
 * What the bubble around a card tells it. The per-kind embeds only know how to
 * open their entity, so the long press (reactions, reply, copy) and the bubble
 * geometry reach the shared shell through here instead of through every embed.
 * Without it a long press on a community card in a DM did nothing at all.
 */
const CardHostContext = createContext<{ inBubble: boolean; onLongPress?: () => void }>({
  inBubble: false,
});

interface RowCardProps {
  /** Small label above the title: "Community invite", "Item", … */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  description?: string;
  titleLines?: number;
  meta?: string;
  imageUri?: string | null;
  /** Icon shown when there is no image. */
  fallbackIcon: IconName;
  bannerUri?: string | null;
  /** Drawn in the banner's place when there is no `bannerUri` (a stage's generated poster). */
  bannerFallback?: React.ReactNode;
  dimmed?: boolean;
  /**
   * Controls that live inside the card but are not the card. Rendered under the
   * row and walled off from the card's own press, so a stage recording can be
   * played and scrubbed here without the tap also opening the stage.
   */
  footer?: React.ReactNode;
  /** A pill at the end of the row: "Join" on an invite, "View" on a community. */
  cta?: string;
  onPress: () => void;
  onLongPress?: () => void;
}

const RowCard: React.FC<RowCardProps> = ({
  eyebrow,
  title,
  subtitle,
  description,
  titleLines = 1,
  meta,
  imageUri,
  fallbackIcon,
  bannerUri,
  bannerFallback,
  dimmed,
  footer,
  cta,
  onPress,
  onLongPress: ownLongPress,
}) => {
  const { isMinimal, skin } = useAppTheme();
  const host = useContext(CardHostContext);
  const onLongPress = ownLongPress ?? host.onLongPress;
  // The banner spans the card, which is at most the window's width.
  const { width: windowWidth } = useWindowDimensions();
  // Minimal: no box around the card. The banner spans the text column and the
  // row sits flush with the post text; only the thumb keeps a faint well.
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={[
        styles.card,
        isMinimal && minimalFlat,
        skin?.material === 'glass' && skin.card,
        // Inside a bubble the card is the bubble's top: inset 4 from its edge
        // with a radius 4 under the bubble's 12, so the two corners share a
        // centre instead of a second outlined box floating inside the first.
        host.inBubble && styles.cardInBubble,
        dimmed && styles.cardDimmed,
      ]}
    >
      {/* The cover, whole and uncropped — the same 16:9 contain-on-black
          treatment the stage page itself uses. It used to be a dimmed
          object-cover layer BEHIND the row, which reduced a full graphic to
          ~68px of its middle. */}
      {!!bannerUri && (
        <Image source={storageImageSource(bannerUri, windowWidth)} style={styles.banner} contentFit="contain" />
      )}
      {!bannerUri && bannerFallback}
      <View style={[styles.row, isMinimal && styles.minimalRow]}>
        {/* With the banner showing the artwork in full, repeating it as a 48px
            square is noise — the thumb only earns its place bannerless. */}
        {!bannerUri && !bannerFallback && (
          <View style={[styles.thumbWrap, isMinimal && styles.minimalThumbWrap]}>
            {imageUri ? (
              <Image source={storageImageSource(imageUri, 48)} style={styles.thumb} contentFit="cover" />
            ) : (
              <Icon name={fallbackIcon} size={20} color="#808089" />
            )}
          </View>
        )}
        <View style={styles.body}>
          {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
          <Text style={styles.title} numberOfLines={titleLines}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
          {!!meta && <Text style={styles.meta}>{meta}</Text>}
          {!!description && <Text style={[styles.subtitle, { marginTop: 6 }]} numberOfLines={2}>{description}</Text>}
        </View>
        {!!cta && (
          <View style={styles.cta}>
            <Text style={styles.ctaText} numberOfLines={1}>
              {cta}
            </Text>
          </View>
        )}
      </View>
      {!!footer && (
        // Claims the touch before the card does. Without this every press on the
        // play button and every drag on the scrub bar also opened the stage.
        <View
          style={[styles.footer, isMinimal && styles.minimalFooter]}
          onStartShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
        >
          {footer}
        </View>
      )}
    </TouchableOpacity>
  );
};

const SkeletonCard = () => {
  const { isMinimal } = useAppTheme();
  const { inBubble } = useContext(CardHostContext);
  return <SkeletonBlock style={[styles.skeleton, isMinimal && styles.minimalSkeleton, inBubble && styles.skeletonInBubble]} />;
};

const SkillCardEmbed: React.FC<{ slug: string; onOpen: () => void; fallback: React.ReactElement }> = ({ slug, onOpen, fallback }) => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const openSignIn = useOpenSignIn();
  const { isSignedIn, needsUsername } = useAuthState();
  const { data, isLoading } = useQuery({
    queryKey: ['skill-preview', slug],
    queryFn: async () => {
      const { data, error } = await supabase.from('user_skills')
        .select('name,slug,description,creator_username').eq('slug', slug).maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
  if (isLoading) return <SkeletonCard />;
  if (!data) return fallback;
  return <RowCard
    eyebrow={dehubLinkLabel('skill')}
    title={data.name}
    subtitle={data.creator_username ? `@${data.creator_username}` : undefined}
    description={data.description}
    fallbackIcon="Sparkles"
    cta={t('wallet.view')}
    onPress={onOpen}
    footer={<TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={t('postOptions.share')}
      onPress={() => {
        if (!isSignedIn || needsUsername) { openSignIn(); return; }
        navigation.navigate(ScreenNames.Upload, { initialText: `https://riftn.com/app/assistant?skill=${encodeURIComponent(slug)}` });
      }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 }}
    >
      <Icon name="Share" size={16} color="#a1a1aa" />
      <Text style={styles.subtitle}>{t('postOptions.share')}</Text>
    </TouchableOpacity>}
  />;
};

// ── Per-kind cards ──────────────────────────────────────────────────────────

const CommunityCardEmbed: React.FC<{ slug: string; onOpen: () => void; fallback: React.ReactElement }> = ({
  slug,
  onOpen,
  fallback,
}) => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dehub-link', 'community', slug],
    queryFn: () => getCommunityBySlug(slug),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <SkeletonCard />;
  if (isError || !data) return fallback;

  return (
    <RowCard
      eyebrow={t("upload.community")}
      title={data.name}
      subtitle={data.description || undefined}
      meta={t("linkCard.members", { compact: formatCompactNumber(data.member_count ?? 0) })}
      imageUri={data.avatar_url}
      bannerUri={data.banner_url}
      fallbackIcon="Users"
      cta={t('wallet.view')}
      onPress={onOpen}
    />
  );
};

const InviteCardEmbed: React.FC<{ code: string; onOpen: () => void; fallback: React.ReactElement }> = ({
  code,
  onOpen,
  fallback,
}) => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dehub-link', 'invite', code],
    queryFn: () => previewCommunityInvite(code),
    staleTime: 30_000,
    retry: false,
  });

  if (isLoading) return <SkeletonCard />;
  if (isError || !data) return fallback;

  // An invite that has been revoked, has expired or has hit its cap looks
  // identical to a live one until it is tapped. Say so on the card instead.
  const invalidCopy: Record<string, string> = {
    revoked: t('linkCard.inviteRevoked'),
    expired: t('linkCard.inviteExpired'),
    exhausted: t('linkCard.inviteExhausted'),
    not_found: t('linkCard.inviteNotFound'),
  };

  if (!data.is_valid) {
    return (
      <RowCard
        dimmed
        eyebrow={invalidCopy[data.reason ?? 'not_found'] ?? t('linkCard.inviteUnavailable')}
        title={t('linkCard.inviteCannotBeUsed')}
        fallbackIcon="Ticket"
        onPress={onOpen}
      />
    );
  }

  return (
    <RowCard
      eyebrow={t('linkCard.communityInvite')}
      title={data.name || t('linkCard.aCommunity')}
      subtitle={data.description || undefined}
      meta={[
        typeof data.member_count === 'number' ? t('linkCard.members', { compact: formatCompactNumber(data.member_count) }) : null,
        data.requires_approval ? t('linkCard.approvalNeeded') : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      imageUri={data.avatar_url}
      bannerUri={data.banner_url}
      fallbackIcon="Ticket"
      cta={t('communities.join')}
      onPress={onOpen}
    />
  );
};

const EventCardEmbed: React.FC<{ eventNumber: string; onOpen: () => void; fallback: React.ReactElement }> = ({
  eventNumber,
  onOpen,
  fallback,
}) => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dehub-link', 'event', eventNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('community_events')
        .select('*')
        .eq('event_number', Number(eventNumber))
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    staleTime: 60_000,
  });

  if (isLoading) return <SkeletonCard />;
  if (isError || !data) return fallback;

  const starts = data.starts_at ? new Date(data.starts_at) : null;
  const when = starts
    ? starts.toLocaleDateString(appLocale(), { weekday: 'short', month: 'short', day: 'numeric' })
    : '';
  const time = starts
    ? starts.toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <RowCard
      eyebrow={data.is_private ? t('linkCard.privateEvent') : t('linkCard.event')}
      title={data.title}
      subtitle={[when, time].filter(Boolean).join(' · ') || undefined}
      meta={[
        t('events.goingCount', { count: Number(data.going_count) || 0 }),
        data.location ? String(data.location) : null,
      ]
        .filter(Boolean)
        .join(' · ')}
      imageUri={data.cover_image_url}
      bannerUri={data.cover_image_url}
      fallbackIcon="Calendar"
      onPress={onOpen}
    />
  );
};

/** A governance proposal: what a quoted proposal looks like in a post or DM. */
const ProposalCardEmbed: React.FC<{ proposalId: string; onOpen: () => void; fallback: React.ReactElement }> = ({
  proposalId,
  onOpen,
  fallback,
}) => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useGovernanceProposal(proposalId);

  if (isLoading) return <SkeletonCard />;
  if (isError || !data) return fallback;

  const forW = data.like_count || 0;
  const againstW = data.dislike_count || 0;
  const total = forW + againstW;
  const forPct = total > 0 ? Math.round((forW / total) * 100) : 50;
  const verdict = data.status === 'passed' || (data.status === 'completed' && forW > againstW)
    ? t('governance.passed')
    : data.status === 'rejected' || data.status === 'completed'
      ? t('governance.rejected')
      : null;
  const author = data.author_username
    ? `@${data.author_username}`
    : `${data.author_wallet_address.slice(0, 6)}...${data.author_wallet_address.slice(-4)}`;

  return (
    <RowCard
      eyebrow={[t('governance.title'), verdict].filter(Boolean).join(' · ')}
      title={data.title}
      titleLines={2}
      subtitle={author}
      meta={`${forPct}% ${t('governance.forLabel')} · ${100 - forPct}% ${t('governance.againstLabel')}`}
      description={data.description || undefined}
      imageUri={data.author_avatar ? getAvatarUrl(data.author_avatar) : null}
      fallbackIcon="Vote"
      onPress={onOpen}
    />
  );
};

const StageCardEmbed: React.FC<{
  /** The uuid form (/stage/:id). One of the two ids is always present. */
  stageId?: string;
  /** The short numeric form (/stages/7). */
  stageShortId?: string;
  onOpen: () => void;
  fallback: React.ReactElement;
}> = ({ stageId, stageShortId, onOpen, fallback }) => {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dehub-link', 'stage', stageId ?? `short:${stageShortId}`],
    enabled: !!stageId || !!stageShortId,
    queryFn: async () => {
      const query = supabase.from('audio_spaces').select('*');
      const { data, error } = await (stageId
        ? query.eq('id', stageId)
        : query.eq('short_id', Number(stageShortId))
      ).maybeSingle();
      if (error) throw error;
      return data as any;
    },
    // A scheduled stage's only volatile field is whether it has started, and
    // the card is cheap to be a minute stale about.
    staleTime: 60_000,
  });

  if (isLoading) return <SkeletonCard />;
  if (isError || !data) return fallback;

  const starts = data.scheduled_at ? new Date(data.scheduled_at) : null;
  const isLive = data.status === 'live';
  const isEnded = data.status === 'ended';
  const isOverdue = !!starts && starts.getTime() < Date.now();

  const when = starts
    ? starts.toLocaleDateString(appLocale(), { weekday: 'short', month: 'short', day: 'numeric' })
    : '';
  const time = starts
    ? starts.toLocaleTimeString(appLocale(), { hour: 'numeric', minute: '2-digit' })
    : '';

  // A live stage has already answered "when", and an ended one has nothing to
  // answer — so the subtitle only carries a date while the stage is upcoming.
  const subtitle = isLive
    ? t('linkCard.listening', { count: Math.max(1, (data.speaker_count || 1) + (data.listener_count || 0)) })
    : isEnded
      ? t('linkCard.ended')
      : [when, time].filter(Boolean).join(' · ') || undefined;

  return (
    <RowCard
      eyebrow={isLive ? t('stages.liveNow') : isEnded ? t('linkCard.stage') : isOverdue ? t('stages.startingSoon') : t('linkCard.upcomingStage')}
      title={data.title}
      subtitle={subtitle}
      meta={`@${data.host_username || String(data.host_wallet_address || '').slice(0, 6)}`}
      imageUri={data.cover_image_url}
      bannerUri={data.cover_image_url}
      bannerFallback={<GeneratedStageCover stage={data} />}
      fallbackIcon="Mic"
      dimmed={isEnded}
      // Listen back where the card sits. What you want from a post about a
      // stage that already happened is usually to hear it without leaving the
      // feed, and until now the card offered nothing but a dead-end tap into an
      // empty modal. Web's StageLinkEmbed carries the same player.
      footer={
        isEnded && data.recording_url ? (
          <StageRecordingPlayer
            spaceId={data.id}
            recordingUrl={data.recording_url}
            title={data.title}
            startedAt={data.started_at}
            endedAt={data.ended_at}
            // A feed row unmounts because the list recycled it, not because
            // anybody left — so scrolling past hands the audio to the corner
            // player instead of killing it mid-sentence.
            whenGone="popOut"
          />
        ) : undefined
      }
      // An ended stage has a page of its own now; the hub was a dead end.
      onPress={isEnded ? () => navigation.navigate(ScreenNames.StageRecording, { spaceId: data.id, space: data }) : onOpen}
    />
  );
};

/** A mini app in the store: icon, name, subtitle or domain, opened in the app player. */
const AppCardEmbed: React.FC<{ slug: string; onOpen: () => void; fallback: React.ReactElement }> = ({
  slug,
  onOpen,
  fallback,
}) => {
  const { t } = useTranslation();
  const { data: app, isLoading } = useQuery({
    queryKey: ['miniapp-by-slug', slug],
    queryFn: () => fetchAppBySlug(slug),
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <SkeletonCard />;
  if (!app) return fallback;
  return (
    <RowCard
      eyebrow={t('miniApps.store.title')}
      title={app.name}
      subtitle={app.subtitle ?? app.domain}
      imageUri={app.icon_url}
      fallbackIcon="LayoutGrid"
      onPress={onOpen}
    />
  );
};

const BountyCardEmbed: React.FC<{ jobKey: string; onOpen: () => void; fallback: React.ReactElement }> = ({
  jobKey,
  onOpen,
  fallback,
}) => {
  const { t } = useTranslation();
  const { data: job, isLoading, isError } = useWorkJob(jobKey);

  if (isLoading) return <SkeletonCard />;
  if (isError || !job) return fallback;

  const budget = Number(job.total_budget) || 0;
  const deadline = job.deadline ? new Date(job.deadline) : null;
  const isClosed = job.status === 'completed' || job.status === 'cancelled' || job.status === 'expired';

  return (
    <RowCard
      eyebrow={`${t('work.bounty')} · ${t(`work.status.${job.status}`)} · ${t(`work.types.${job.job_type}`)}`}
      title={job.title}
      titleLines={2}
      description={job.description}
      subtitle={`${budget.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${job.currency}`}
      meta={
        deadline
          ? deadline.toLocaleDateString(appLocale(), { month: 'short', day: 'numeric' })
          : undefined
      }
      bannerUri={job.cover_image_url}
      fallbackIcon="Briefcase"
      dimmed={isClosed}
      onPress={onOpen}
    />
  );
};

/**
 * A /cinema/<type>/<id> link. Until the JustWatch partnership is live the
 * catalogue answers nothing and every one of these is the fallback chip,
 * which still opens the Cinema screen. That is intended.
 */
const FilmCardEmbed: React.FC<{
  filmId: string;
  objectType: 'movie' | 'show';
  onOpen: () => void;
  fallback: React.ReactElement;
}> = ({ filmId, objectType, onOpen, fallback }) => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dehub-link', 'film', objectType, filmId],
    queryFn: async () => fetchTitleOffers(filmId, await detectLocale(), objectType),
    staleTime: 30 * 60_000,
    retry: false,
  });

  if (isLoading) return <SkeletonCard />;
  const title = data?.title;
  if (isError || !title) return fallback;

  const streams = title.offers.filter((o) => o.monetizationType === 'flatrate').length;
  return (
    <RowCard
      eyebrow={t('cinema.title')}
      title={title.title}
      subtitle={[title.year ? String(title.year) : null, objectType === 'show' ? t('cinema.series') : null]
        .filter(Boolean)
        .join(' · ') || undefined}
      meta={streams > 0 ? t('cinema.streamingOn', { count: streams }) : t('cinema.seeWhereToWatch')}
      imageUri={title.poster}
      fallbackIcon="Clapperboard"
      onPress={onOpen}
    />
  );
};

const ProfileCardEmbed: React.FC<{ username: string; onOpen: () => void; fallback: React.ReactElement }> = ({
  username,
  onOpen,
  fallback,
}) => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dehub-link', 'profile', username.toLowerCase()],
    queryFn: () => getAccount(username),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <SkeletonCard />;

  // `/:username` is the web app's catch-all route, so a link to a page that has
  // since been renamed arrives here looking like a person who does not exist.
  // The link is better than a card claiming a stranger.
  const user: any = (data as any)?.result ?? data;
  if (isError || !user || (!user.username && !user.address)) return fallback;

  const handle = String(user.username || username).replace('@', '');
  const followers =
    typeof user.followers === 'number'
      ? user.followers
      : Array.isArray(user.followers)
        ? user.followers.length
        : 0;
  const avatar = user.avatarImageUrl || user.avatarUrl || user.avatar_url;

  return (
    <RowCard
      eyebrow={t("nav.profile")}
      title={user.displayName || user.display_name || handle}
      subtitle={`@${handle}`}
      meta={t("follow.followerCount", { compact: formatCompactNumber(followers) })}
      imageUri={avatar ? getAvatarUrl(avatar) : null}
      fallbackIcon="User"
      onPress={onOpen}
    />
  );
};

// Same keys the Requests board shows its statuses with.
const REQUEST_STATUS_I18N: Record<string, string> = {
  open: 'features.statusOpen',
  under_review: 'features.statusUnderReview',
  planned: 'features.statusPlanned',
  in_progress: 'features.statusInProgress',
  completed: 'features.statusCompleted',
  shipped: 'features.shipped',
  declined: 'copy.2ab63e6ced90',
};

/** A Requests board link (riftn.com/features?feature=<id>), read live. */
const FeatureRequestCardEmbed: React.FC<{ id: string; onOpen: () => void; fallback: React.ReactElement }> = ({
  id,
  onOpen,
  fallback,
}) => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useFeatureRequest(id);

  if (isLoading) return <SkeletonCard />;
  if (isError || !data) return fallback;

  const image = featureAttachments(data).find((url) => !isVideoAttachment(url)) ?? null;
  const status = t(REQUEST_STATUS_I18N[data.status] ?? 'features.statusOpen', STATUS_LABELS[data.status] ?? '');
  const votes = (data as any).like_count ?? (data as any).vote_count ?? 0;
  const comments = (data as any).comment_count ?? 0;
  return (
    <RowCard
      eyebrow={`${t('nav.featureRequests')} · ${status}`}
      title={data.title}
      titleLines={2}
      description={data.description || undefined}
      meta={[
        data.author_username ? `@${data.author_username}` : null,
        t('linkCard.requestVotes', { count: votes, compact: formatCompactNumber(votes), defaultValue: votes === 1 ? '{{compact}} vote' : '{{compact}} votes' }),
        t('linkCard.requestComments', { count: comments, compact: formatCompactNumber(comments), defaultValue: comments === 1 ? '{{compact}} comment' : '{{compact}} comments' }),
      ].filter(Boolean).join(' · ')}
      imageUri={image}
      fallbackIcon="Lightbulb"
      onPress={onOpen}
    />
  );
};

/** First-party games: their names live under games.* */
const ARCADE_TITLES: Record<string, [string, string]> = {
  chestard: ['games.chestard.title', 'Chestard'],
  sillycoin: ['games.sillycoin.title', 'SillyCoin'],
  okey: ['games.okey.title', 'Okey 101'],
  gratitude: ['games.gratitude.title', 'Gratitude pen pals'],
  'correspondence-chess': ['games.chess.title', 'Correspondence chess'],
};
/** Arcade games named by their brand, the same in every language. */
const ARCADE_BRANDS: Record<string, string> = {
  'kings-gambit': "King's Gambit", 'street-slayer': 'Street Slayer', 'gods-eye': "God's Eye", trenchstar: 'Chartopia',
  'jungle-trail': 'Jungle Trail', 'claude-of-duty': 'Claude of Duty', 'love-lock-bridge': 'Love Lock Bridge',
};
const humanize = (slug: string) => slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/**
 * A riftn.com/arcade/<game> link as a score card: the game's art and, when the
 * link names who shared it (`?by=<user>`), their name, best score and rank on
 * the art. The score comes from the game's board, never the link. Posted with
 * a snapshot (`&snap=1`) the post already has its picture, so the card is one
 * row. Same card as the web (ArcadeLinkEmbed).
 */
const ArcadeCardEmbed: React.FC<{ slug: string; pagePath: string; path: string; onOpen: () => void }> = ({ slug, pagePath, path, onOpen }) => {
  const { t } = useTranslation();
  const { by, snap } = sharedLink(path);
  const { data: card } = useQuery({
    queryKey: ['arcade-card', slug, by?.toLowerCase()],
    queryFn: () => arcadeCard(slug, by!),
    enabled: !!by,
    staleTime: 60_000,
  });
  const page = linkablePageFor(pagePath);
  const known = ARCADE_TITLES[slug];
  const own = page && page.path.replace(/^\/app/, '') === pagePath.replace(/^\/app/, '');
  const title = known ? t(known[0], known[1]) : own && page ? t(page.labelKey, page.labelKey) : ARCADE_BRANDS[slug] ?? humanize(slug);
  const player = card?.player ?? null;
  const name = player ? (player.username ? `@${player.username}` : player.displayName || `${player.address.slice(0, 6)}…`) : null;
  const avatar = player?.avatarImageUrl ? getAvatarUrl(player.avatarImageUrl, 36) : null;
  const hasScore = card?.best != null && card.best > 0;
  const scoreLabel = card?.unit === 'coins' ? t('arcadeCard.mined', 'Coins mined') : t('arcadeCard.best', 'Best score');
  const scoreLine = hasScore
    ? card?.rank
      ? t('arcadeCard.rankLine', { defaultValue: '{{label}} · #{{rank}} on the board', label: scoreLabel, rank: formatCount(card.rank) })
      : scoreLabel
    : t('arcadeCard.shared', 'Shared this game');

  if (snap && player) {
    return (
      <RowCard
        title={name ?? title}
        subtitle={hasScore && card?.rank ? `${title} · #${formatCount(card.rank)}` : title}
        meta={hasScore ? `${scoreLabel} ${formatCount(card!.best!)}` : undefined}
        imageUri={avatar}
        fallbackIcon="Gamepad2"
        cta={t('arcadeCard.play', 'Play')}
        onPress={onOpen}
      />
    );
  }

  const banner = (
    <KeepDarkScope>
      <View style={styles.arcadeArt}>
        <Image source={{ uri: arcadeArt(slug) }} style={StyleSheet.absoluteFill} contentFit="cover" />
        {player ? (
          <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)', 'rgba(0,0,0,0.95)']} style={styles.arcadeScrim}>
            {avatar ? (
              <Image source={storageImageSource(avatar, 36)} style={styles.arcadeAvatar} contentFit="cover" />
            ) : (
              <View style={[styles.arcadeAvatar, styles.arcadeAvatarEmpty]}>
                <Text style={styles.arcadeAvatarLetter}>{(name ?? '?').replace('@', '').slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.arcadeName} numberOfLines={1}>{name}</Text>
              <Text style={styles.arcadeLine} numberOfLines={1}>{scoreLine}</Text>
            </View>
            {hasScore ? <Text style={styles.arcadeScore}>{formatCount(card!.best!)}</Text> : null}
          </LinearGradient>
        ) : null}
      </View>
    </KeepDarkScope>
  );

  return (
    <RowCard
      title={title}
      subtitle={`riftn.com${path.split('?')[0]}`}
      fallbackIcon={page?.icon ?? 'Gamepad2'}
      bannerFallback={banner}
      cta={t('arcadeCard.play', 'Play')}
      onPress={onOpen}
    />
  );
};

/** A riftn.com link to one of our pages: its menu name and icon, opens its screen. */
const PageCardEmbed: React.FC<{ pagePath: string; path: string; onOpen: () => void; fallback: React.ReactElement }> = ({
  pagePath,
  path,
  onOpen,
  fallback,
}) => {
  const { t } = useTranslation();
  const page = linkablePageFor(pagePath);
  if (!page) return fallback;
  return (
    <RowCard
      eyebrow="Riftn"
      title={t(page.labelKey, page.labelKey)}
      subtitle={`riftn.com${path}`}
      fallbackIcon={page.icon}
      cta={t('wallet.view')}
      onPress={onOpen}
    />
  );
};

// ── Dispatcher ──────────────────────────────────────────────────────────────

interface DehubLinkCardProps {
  link: DehubLinkMatch;
  /** DM bubbles tint their content to match the sender's side. */
  isMine?: boolean;
  /** Caption that arrived alongside the link — used as a post card's title. */
  fallbackTitle?: string;
  /**
   * Inside a DM bubble, which sizes itself to its content and so gives a
   * full-width child nothing to resolve against. Pins the card to the same
   * width the post card already uses.
   */
  inBubble?: boolean;
  onLongPress?: () => void;
}

/**
 * Open a Riftn link inside the app.
 *
 * Exported because the feed's caption renderer needs the same routing: a
 * dehub.io link there used to be handed to the in-app browser, so tapping a
 * link to our own community loaded a web view of the site inside the app.
 */
export function useOpenDehubLink() {
  const navigation = useNavigation<any>();
  // Pages and requests open through the same router a riftn.com link from
  // outside the app goes through (navigation/linking.config), so every page
  // with a screen opens it, and one without opens on the web in-app.
  const linkTo = useLinkTo();
  const { openModal: openStages, joinSpace, guestListenSpace } = useStages();
  const { showUserProfile } = useUserProfileSheet();

  return useCallback(
    (link: DehubLinkMatch) => {
      switch (link.kind) {
        case 'skill':
          // The web skill runner retains its prompt, model and reference assets.
          void WebBrowser.openBrowserAsync(`https://riftn.com${link.path}`, { createTask: false });
          return;
        case 'post':
          // A readable slug link goes through the resolver, which finds its tokenId.
          if (!link.tokenId && link.articleSlug) {
            navigation.navigate(ScreenNames.PostResolver, { tokenId: link.articleSlug });
            return;
          }
          // An unminted post's number: the resolver looks up its tokenId first.
          if (!link.tokenId && link.newPostId) {
            navigation.navigate(ScreenNames.PostResolverNewPost, { newPostId: link.newPostId });
            return;
          }
          // One entry in the author's thread: the resolver opens the post at it.
          if (link.commentId) {
            navigation.navigate(ScreenNames.PostResolver, { tokenId: link.tokenId, commentId: link.commentId });
            return;
          }
          navigation.navigate(ScreenNames.FeedDetail, { tokenId: link.tokenId });
          return;
        case 'profile':
          // ScreenNames.Profile is your OWN profile and reads no params, so
          // this used to open the tapper's own page whoever the link named.
          // The sheet is the surface for somebody else's profile, and it is
          // what a dehub.io/:username deep link already opens.
          if (link.username) showUserProfile(link.username, { source: 'link-card' });
          return;
        case 'community':
          navigation.navigate(ScreenNames.CommunityDetail, { slug: link.slug });
          return;
        case 'communityInvite':
          navigation.navigate(ScreenNames.CommunityInvite, { code: link.code });
          return;
        case 'event':
          // There is no per-event screen on mobile yet; the list is where an
          // event link can actually land, and it beats a dead tap.
          navigation.navigate(ScreenNames.Events);
          return;
        case 'stage': {
          // There is no per-stage screen, so the hub is where a link lands and
          // joining is attempted on top of it: a live stage is what the link
          // most often points at, joinSpace refuses anything that is not live,
          // and the hub's upcoming and recorded shelves are the right landing
          // spot for a stage that has not started or has already ended.
          openStages('browse');
          void (async () => {
            // A /stages/7 link carries no uuid, and joinSpace keys on one.
            let id = link.stageId;
            if (!id && link.stageShortId) {
              const { data } = await supabase
                .from('audio_spaces')
                .select('id')
                .eq('short_id', Number(link.stageShortId))
                .maybeSingle();
              id = (data as any)?.id;
            }
            if (!id) return;
            // A signed-in wallet can hold a seat; anyone else still gets to
            // listen, matching web's guest-listen invite link.
            if ((await joinSpace(id)) || (await guestListenSpace(id))) openStages('live');
          })();
          return;
        }
        case 'bounty': {
          // A /bounty/<n> link carries the job number, and /work/<uuid> carries
          // the row id directly — either way, resolve to the row's own id
          // before navigating, since WorkJobDetailScreen expects a resolved
          // uuid, not a lookup key.
          const key = link.bountyJobKey!;
          void (async () => {
            const column = /^\d+$/.test(key) ? 'job_number' : 'id';
            const { data } = await supabase
              .from('work_jobs')
              .select('*')
              .eq(column, column === 'job_number' ? Number(key) : key)
              .maybeSingle();
            if (!data) return;
            navigation.navigate(ScreenNames.WorkJobDetail, { jobId: (data as any).id, job: data as any });
          })();
          return;
        }
        case 'app': {
          // The link's own query is a deep link into the app; carry it through.
          const query = link.path.includes('?') ? link.path.slice(link.path.indexOf('?') + 1) : '';
          const room = new URLSearchParams(query);
          room.delete('from');
          navigation.navigate(ScreenNames.MiniApp, {
            slug: link.appSlug,
            from: 'feed',
            ...(room.toString() ? { query: room.toString() } : {}),
          });
          return;
        }
        case 'proposal':
          navigation.navigate(ScreenNames.GovernanceProposal, { proposalId: link.proposalId });
          return;
        case 'featureRequest':
        case 'page':
          try {
            linkTo(link.path.startsWith('/') ? link.path : `/${link.path}`);
          } catch {
            void WebBrowser.openBrowserAsync(`https://riftn.com${link.path}`, { createTask: false });
          }
          return;
        case 'film':
          navigation.navigate(ScreenNames.Cinema, {
            filmType: link.filmObjectType === 'show' ? 'series' : 'film',
            filmId: link.filmId,
          });
          return;
        default:
          return;
      }
    },
    [navigation, linkTo, openStages, joinSpace, guestListenSpace, showUserProfile],
  );
}

/**
 * A post shared by its readable address (/app/post/iron-man-7932). The card
 * keys on a tokenId, so look it up first; until then, and if the slug is
 * unknown, the plain "View post" row stands in.
 */
function SlugSharedPostPreview({
  slug,
  fallback,
  ...rest
}: {
  slug: string;
  fallback: React.ReactElement;
  isMine: boolean;
  fallbackTitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['article-slug', slug],
    queryFn: () => resolveArticleSlug(slug),
    staleTime: 60 * 60 * 1000,
  });
  if (!data?.tokenId) return fallback;
  return <SharedPostPreview tokenId={String(data.tokenId)} {...rest} />;
}

/**
 * A post shared by its unminted number (/newpost/3), the link share buttons
 * hand out before a post is on chain. Same idea as the slug card above.
 */
function NewPostSharedPreview({
  newPostId,
  fallback,
  ...rest
}: {
  newPostId: string;
  fallback: React.ReactElement;
  isMine: boolean;
  fallbackTitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['newpost-token', newPostId],
    queryFn: () => resolveNewPost(newPostId),
    staleTime: 60 * 60 * 1000,
  });
  if (!data?.tokenId) return fallback;
  return <SharedPostPreview tokenId={String(data.tokenId)} {...rest} />;
}

const DehubLinkCardComponent: React.FC<DehubLinkCardProps> = ({
  link,
  isMine = false,
  fallbackTitle,
  inBubble = false,
  onLongPress,
}) => {
  const { t: _copy } = _useCopy();
  const { width: windowWidth } = useWindowDimensions();
  const openLink = useOpenDehubLink();
  const open = useCallback(() => openLink(link), [openLink, link]);

  const fallback = (
    <RowCard
      eyebrow="Riftn"
      title={_copy("copy.9f68c44b21cf", { defaultValue: "View {{value1}}", value1: dehubLinkLabel(link.kind) })}
      subtitle={`riftn.com${link.path}`}
      fallbackIcon="Link"
      onPress={open}
      onLongPress={onLongPress}
    />
  );

  // The post card owns its own box (width, padding) so it can match the bubble
  // exactly; the rest share one shell and get sized here.
  if (link.kind === 'post' && !link.tokenId && link.articleSlug) {
    return (
      <SlugSharedPostPreview
        slug={link.articleSlug}
        isMine={isMine}
        fallbackTitle={fallbackTitle}
        onPress={open}
        onLongPress={onLongPress}
        fallback={fallback}
      />
    );
  }

  if (link.kind === 'post' && !link.tokenId && link.newPostId) {
    return (
      <NewPostSharedPreview
        newPostId={link.newPostId}
        isMine={isMine}
        fallbackTitle={fallbackTitle}
        onPress={open}
        onLongPress={onLongPress}
        fallback={fallback}
      />
    );
  }

  if (link.kind === 'post') {
    return (
      <SharedPostPreview
        tokenId={link.tokenId!}
        isMine={isMine}
        fallbackTitle={fallbackTitle}
        onPress={open}
        onLongPress={onLongPress}
      />
    );
  }

  let card: React.ReactElement;
  switch (link.kind) {
    case 'skill':
      card = <SkillCardEmbed slug={link.skillSlug!} onOpen={open} fallback={fallback} />;
      break;
    case 'profile':
      card = <ProfileCardEmbed username={link.username!} onOpen={open} fallback={fallback} />;
      break;
    case 'community':
      card = <CommunityCardEmbed slug={link.slug!} onOpen={open} fallback={fallback} />;
      break;
    case 'communityInvite':
      card = <InviteCardEmbed code={link.code!} onOpen={open} fallback={fallback} />;
      break;
    case 'event':
      card = <EventCardEmbed eventNumber={link.eventNumber!} onOpen={open} fallback={fallback} />;
      break;
    case 'stage':
      card = (
        <StageCardEmbed
          stageId={link.stageId}
          stageShortId={link.stageShortId}
          onOpen={open}
          fallback={fallback}
        />
      );
      break;
    case 'app':
      card = <AppCardEmbed slug={link.appSlug!} onOpen={open} fallback={fallback} />;
      break;
    case 'proposal':
      card = <ProposalCardEmbed proposalId={link.proposalId!} onOpen={open} fallback={fallback} />;
      break;
    case 'bounty':
      card = <BountyCardEmbed jobKey={link.bountyJobKey!} onOpen={open} fallback={fallback} />;
      break;
    case 'featureRequest':
      card = <FeatureRequestCardEmbed id={link.featureRequestId!} onOpen={open} fallback={fallback} />;
      break;
    case 'page': {
      const arcadeSlug = arcadeSlugOf(link.pagePath!);
      card = arcadeSlug
        ? <ArcadeCardEmbed slug={arcadeSlug} pagePath={link.pagePath!} path={link.path} onOpen={open} />
        : <PageCardEmbed pagePath={link.pagePath!} path={link.path} onOpen={open} fallback={fallback} />;
      break;
    }
    case 'film':
      card = (
        <FilmCardEmbed
          filmId={link.filmId!}
          objectType={link.filmObjectType ?? 'movie'}
          onOpen={open}
          fallback={fallback}
        />
      );
      break;
    default:
      card = fallback;
  }

  return (
    <CardHostContext.Provider value={{ inBubble, onLongPress }}>
      {inBubble ? (
        <View style={[styles.bubbleWrap, { width: bubbleCardWidth(windowWidth) }]}>{card}</View>
      ) : (
        card
      )}
    </CardHostContext.Provider>
  );
};

// Matches SharedPostPreview's card width: the bubble caps at 75% of the row,
// and the card plus its margins has to stay inside that or the bubble's
// overflow-hidden clips its right edge on narrow screens.
const bubbleCardWidth = (windowWidth: number) => Math.min(240, Math.round(windowWidth * 0.75) - 40);

const styles = StyleSheet.create({
  bubbleWrap: { paddingHorizontal: 4, paddingTop: 4 },
  // Transparent, not a faint grey: a pressable with a neutral fill is repainted
  // as a themed button (libs/jsx/controls.js), rim and 12px radius included,
  // which put the outlined box straight back inside the bubble.
  cardInBubble: { marginTop: 0, borderRadius: 8, borderWidth: 0, backgroundColor: 'transparent' },
  skeletonInBubble: { marginTop: 0, borderRadius: 8 },
  cta: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    flexShrink: 0,
  },
  ctaText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  arcadeArt: { width: '100%', aspectRatio: 1200 / 630, backgroundColor: '#000', justifyContent: 'flex-end' },
  arcadeScrim: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingBottom: 12, paddingTop: 40 },
  arcadeAvatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  arcadeAvatarEmpty: { backgroundColor: '#27272a', alignItems: 'center', justifyContent: 'center' },
  arcadeAvatarLetter: { color: '#fff', fontSize: 14, fontWeight: '600' },
  arcadeName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  arcadeLine: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  arcadeScore: { color: '#fff', fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  card: {
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
    position: 'relative',
  },
  cardDimmed: { opacity: 0.65 },
  footer: {
    paddingHorizontal: 10,
    paddingBottom: 10,
    marginTop: -2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
  },
  banner: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  thumbWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: { width: '100%', height: '100%' },
  body: { flex: 1, minWidth: 0 },
  eyebrow: { color: '#808089', fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  title: { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 1 },
  subtitle: { color: '#d4d4d8', fontSize: 12, marginTop: 2 },
  meta: { color: '#a1a1aa', fontSize: 12, marginTop: 3 },
  skeleton: {
    height: 68,
    marginTop: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  minimalRow: { paddingHorizontal: 0 },
  minimalFooter: { paddingHorizontal: 0 },
  minimalThumbWrap: { backgroundColor: 'rgba(255,255,255,0.04)' },
  minimalSkeleton: { backgroundColor: 'rgba(255,255,255,0.04)' },
});

export default memo(DehubLinkCardComponent);

/** Render every card a block of text has earned, capped. */
export const DehubLinkCards: React.FC<{
  links: DehubLinkMatch[];
  isMine?: boolean;
  onLongPress?: () => void;
}> = ({ links, isMine, onLongPress }) => {
  if (links.length === 0) return null;
  return (
    <>
      {links.slice(0, MAX_CARDS_PER_MESSAGE).map((link) => (
        <DehubLinkCardComponent
          key={`${link.kind}-${link.path}`}
          link={link}
          isMine={isMine}
          onLongPress={onLongPress}
        />
      ))}
    </>
  );
};
