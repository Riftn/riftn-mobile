import { PROFILE_COVER_HEIGHT, useProfileIdentityLayout } from '../Profile/useProfileCollapse';
import { useTranslation as _useCopy } from 'react-i18next';
import BadgeArtwork from "../common/BadgeArtwork";
import React, { useCallback, useMemo, useRef } from "react";
import { View, Text, TouchableOpacity, Pressable, ActivityIndicator, StyleSheet, useWindowDimensions, Linking } from "react-native";
import { readAccountCategory, readContactEmail } from "../../libs/account-type";
import Animated from "react-native-reanimated";
import { openBadgeShowcase } from "../../libs/badgeShowcase";
import SmartImage from "../common/SmartImage";
import { storageImage } from "../../libs/cdnImage";
import { ProfilePullRing, useProfileAvatarPop, useProfileCoverHidden } from "../Profile/ProfilePullRefresh";
import { LinearGradient } from "expo-linear-gradient";
import Avatar from "../common/Avatar";
import ProfileImageMenu, { useProfileImageMenu } from "../Profile/ProfileImageMenu";
import Icon from "../ui/Icon";
import { copyToClipboard, getBadgeHoverOpticalStyle as getBadgeOpticalStyle } from "../../libs";
import { toastSuccess } from "../../libs/toast";
import { ensProfileUrl } from "../../libs/ens-handle";
import { useTranslation } from "../../hooks/useTranslation";
import { TranslateButton } from "../ui/TranslateButton";
import MutualFollowers from "./MutualFollowers";
import StreamerLevelCard from "../Live/StreamerLevelCard";
import ProfilePetCard from "../Pet/PetCard";
import StreamerBadge from "../Live/StreamerBadge";
import BadgePatronChip from "../common/BadgePatronChip";
import EarlySupporterChip from "../common/EarlySupporterChip";
import MilestoneChips, { BadgeMuseumPanel } from "../Profile/BadgeMuseum";
import { useTranslation as useI18n } from "react-i18next";
import { formatCount } from "../../libs/format-count";
import type { FollowListItem } from "../../services/user.service";
import ProfileBio from "../Profile/ProfileBio";
import TotalReachPill from "../Profile/TotalReachPill";
import ProfileLinksPill from "../Profile/ProfileLinksPill";
import { useAppTheme } from "../../context/ThemeContext";
import { useCinematicPhone } from "../../hooks/useCinematicPhone";
import { useLiveTarget } from "../../hooks/useIsUserLive";
import { openLiveTarget } from "../../libs/openLiveTarget";
import { MINIMAL_HAIRLINE } from "../../theme/minimal";
import type { Community } from "../../types/community";
import { PinnedCommunityWash } from "../Communities/PinnedCommunityStage";
import ProfileFieldsList, { type ProfileField } from "../Profile/ProfileFieldsList";
import { localTimeLine, useProfileLocalTime } from "../../hooks/useProfileLocalTime";

const GLASS_GRADIENT: [string, string, string] = [
  "rgba(255,255,255,0.20)",
  "rgba(255,255,255,0.10)",
  "rgba(255,255,255,0.05)",
];
const BTN_RADIUS = 12;
const BTN_H = 36;

export interface UserProfileHeaderProps {
  onIdentityBottom?: (bottom: number) => void;
  onActionsBottom?: (bottom: number) => void;
  featuredCommunity?: Community | null;
  avatarUrl?: string | null;
  /** Untouched original avatar, for Copy on the hold menu. */
  avatarFullUrl?: string | null;
  coverUrl?: string | null;
  displayName: string;
  badge?: string | null;
  badgeImage?: number | undefined;
  address?: string;
  shortAddr?: string;
  username?: string | null;
  /** A verified `.eth` name, shown beside the handle. Never instead of it. */
  ensName?: string | null;
  hasUsername: boolean;
  joinedDate?: string | null;
  followsYou?: boolean;
  isPrivate?: boolean;
  canViewContent?: boolean;
  bio?: string | null;
  /** ISO 639-1 the backend detected for the bio, so a bio already in the
   *  reader's language costs no request at all. */
  bioLanguage?: string | null;
  /** Label/value lines under the bio — see ProfileFieldsList. */
  profileFields?: ProfileField[] | null;
  publicTimeZone?: string;
  /** The profile's `customs`: account type, category and business contact email. */
  customs?: Record<string, unknown>;
  isFollowing?: boolean;
  isFollowRequestPending?: boolean;
  followLoading?: boolean;
  disableActions?: boolean;
  isOwnProfile?: boolean;
  isBlocked?: boolean;
  onFollow?: () => void;
  onOpenUnfollow?: () => void;
  onOpenImage: (type: "avatar" | "cover") => void;
  onShare: () => void;
  onMessage?: () => void;
  onOpenOptions?: () => void;
  onEditProfile?: () => void;
  stats?: { key: string; label: string; value: number }[];
  onStatPress?: (key: string) => void;
  FallbackAvatar: any;
  FallbackBanner: any;
  socials?: Partial<Record<string, string>>;
  mutuals?: FollowListItem[];
  /** True number of mutual followers (`mutuals` holds the first few faces). */
  mutualsTotal?: number;
  /** The creator has published at least one subscription plan. */
  hasPlans?: boolean;
  /** True while the creator's plans are still loading — reserves the
   *  Subscribe button's height instead of popping it in once known. */
  plansLoading?: boolean;
  onSubscribe?: () => void;
}

const UserProfileHeader: React.FC<UserProfileHeaderProps> = ({
  featuredCommunity,
  onIdentityBottom,
  onActionsBottom,
  avatarUrl,
  avatarFullUrl,
  coverUrl,
  displayName,
  badge,
  badgeImage,
  address,
  shortAddr,
  username,
  ensName,
  hasUsername,
  joinedDate,
  followsYou,
  isPrivate,
  bio,
  bioLanguage,
  profileFields,
  publicTimeZone,
  customs,
  isFollowing = false,
  isFollowRequestPending = false,
  followLoading = false,
  disableActions = false,
  isOwnProfile = false,
  isBlocked = false,
  onFollow,
  onOpenUnfollow,
  onOpenImage,
  onShare,
  onMessage,
  onOpenOptions,
  onEditProfile,
  stats,
  onStatPress,
  FallbackAvatar,
  FallbackBanner,
  socials,
  mutuals,
  mutualsTotal,
  hasPlans = false,
  plansLoading = false,
  onSubscribe,
}) => {
  const { t: _copy } = _useCopy();
  const { t } = useI18n();
  const { isMinimal, skin, colors } = useAppTheme();
  const coverHidden = useProfileCoverHidden();
  const avatarPop = useProfileAvatarPop();
  const cinematicPhone = useCinematicPhone();
  const { width: windowWidth } = useWindowDimensions();
  const badgeRef = useRef<View>(null);
  const liveTarget = useLiveTarget(address, username);
  const live = !!liveTarget;
  // Bios go through the shared hook rather than a private translateText call,
  // which is what gets them auto-translation, the persisted cache and — the
  // reason the old code was wrong — the reader's CHOSEN language. It targeted
  // the device locale, so a Turkish reader on an English handset was served
  // "translations" back into English.
  const bioTexts = useMemo(() => ({ bio: bio || "" }), [bio]);
  const {
    isTranslated: isBioTranslated,
    translatedTexts: translatedBioTexts,
    isLoading: isTranslatingBio,
    handleTranslate: handleTranslateBio,
    handleShowOriginal: handleShowOriginalBio,
    shouldShow: showBioTranslate,
  } = useTranslation(bioTexts, bioLanguage, true, true);
  const displayBio = isBioTranslated ? translatedBioTexts.bio || bio : bio;
  const localTime = useProfileLocalTime(publicTimeZone);

  const handleCopyUsername = useCallback(() => {
    if (username) copyToClipboard(username);
  }, [username]);

  // The chip hands over the .eth URL rather than the bare name, because that
  // is the thing worth showing off and the only half a recipient can act on.
  const handleCopyEns = useCallback(() => {
    if (!ensName) return;
    copyToClipboard(ensProfileUrl(ensName));
    toastSuccess(t("profile.ensUrlCopied"));
  }, [ensName]);

  // The glass fill every header button is painted with. Minimal drops it for a
  // 1px outline (s.minimalBtn), and grows the box to 44pt so the tap target
  // does not shrink with the slab.
  const glassLayers = isMinimal ? null : skin ? (
    <View style={[StyleSheet.absoluteFill, skin.centre]} />
  ) : (
    <>
      <View style={[StyleSheet.absoluteFill, { borderRadius: BTN_RADIUS, backgroundColor: "#18181B" }]} />
      <LinearGradient colors={GLASS_GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: BTN_RADIUS }]} />
      <View style={[StyleSheet.absoluteFill, s.glassOverlay]} />
    </>
  );
  const btn = isMinimal ? [s.glassBtn, s.minimalBtn] : [s.glassBtn, skin?.centre];

  const followingItem = stats?.find((s) => s.key === "following");
  const followersItem = stats?.find((s) => s.key === "followers");

  const { profileRef, identityRef, actionsRef, measureIdentity } = useProfileIdentityLayout(onIdentityBottom, onActionsBottom);

  const renderFollowButton = () => {
    if (isOwnProfile) {
      return (
        <TouchableOpacity
          onPress={onEditProfile}
          activeOpacity={0.7}
          style={btn}
        >
          {glassLayers}
          <View style={s.glassBtnContent}>
            <Icon name="Pencil" size={14} color="#fff" />
            <Text style={s.glassBtnLabel}>{t("screens.editProfile")}</Text>
          </View>
        </TouchableOpacity>
      );
    }

    if (followLoading) {
      return (
        <View style={[btn, { opacity: 0.6 }]}>
          {glassLayers}
          <View style={s.glassBtnContent}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        </View>
      );
    }

    if (isFollowRequestPending) {
      return (
        <TouchableOpacity
          onPress={() => !disableActions && onOpenUnfollow?.()}
          disabled={disableActions}
          activeOpacity={0.7}
          style={[btn, disableActions && { opacity: 0.4 }]}
        >
          {glassLayers}
          <View style={s.glassBtnContent}>
            <Icon name="Clock" size={14} color="#fff" />
            <Text style={s.glassBtnLabel}>{t("follow.requested")}</Text>
          </View>
        </TouchableOpacity>
      );
    }

    if (isFollowing) {
      return (
        <TouchableOpacity
          onPress={() => !disableActions && onOpenUnfollow?.()}
          disabled={disableActions}
          activeOpacity={0.7}
          style={[btn, disableActions && { opacity: 0.4 }]}
        >
          {glassLayers}
          <View style={s.glassBtnContent}>
            <Text style={s.glassBtnLabel}>{t("filters.following")}</Text>
            {/* The tick sits inset in its box: pull it in so both sides of the pill match. */}
            <View style={s.followingTick}>
              <Icon name="Check" size={14} color="#fff" />
            </View>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        onPress={disableActions ? undefined : onFollow}
        disabled={disableActions}
        activeOpacity={0.7}
        style={[btn, disableActions && { opacity: 0.4 }]}
      >
        {glassLayers}
        <View style={s.glassBtnContent}>
          <Icon name="UserPlus" size={14} color="#fff" />
          <Text style={s.glassBtnLabel}>
            {followsYou && !isFollowing ? _copy("copy.fd3fdb5a65ea", { defaultValue: "Follow Back" }) : _copy("copy.641d1ef657bd", { defaultValue: "Follow" })}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  // Hold the picture or banner to copy it.
  const imageMenu = useProfileImageMenu();

  return (
    <View ref={profileRef} collapsable={false} onLayout={measureIdentity}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => onOpenImage("cover")}
        onLongPress={() => imageMenu.open("cover")}
        delayLongPress={450}
        accessibilityRole="button"
        accessibilityLabel={t("profile.viewCoverImage")}
      >
        {/* Align the cover with the full-width details and pinned community. */}
        <View
          ref={imageMenu.coverRef}
          collapsable={false}
          className={isMinimal || cinematicPhone ? "overflow-hidden" : "rounded-t-xl overflow-hidden"}
          style={{ height: PROFILE_COVER_HEIGHT }}
        >
          {/* coverUrl is the unsized original (the viewer opens it too); expo-image
              decodes it at banner size where ImageBackground decoded every pixel.
              A cover in Supabase Storage is fetched at banner width as well. */}
          <Animated.View style={[StyleSheet.absoluteFill, coverHidden]}>
          <SmartImage
            source={
              coverUrl === "default-banner"
                ? FallbackBanner
                : { uri: storageImage(coverUrl as string, windowWidth) }
            }
            recyclingKey={coverUrl}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
          />
          </Animated.View>
        </View>
      </TouchableOpacity>

      <View className={featuredCommunity?.banner_url ? 'dark-surface' : undefined} style={{ paddingHorizontal: cinematicPhone ? 16 : 20, paddingBottom: featuredCommunity ? 16 : undefined }}>
        <PinnedCommunityWash community={featuredCommunity} />
        <View className="flex-row items-start justify-between" style={{ marginTop: -48 }}>
          <Animated.View ref={imageMenu.avatarRef as any} collapsable={false} style={avatarPop}>
          <Avatar
            uri={avatarUrl || undefined}
            name={displayName}
            size={96}
            style={{ borderWidth: 1.5, borderColor: "#18181b", backgroundColor: "#18181b" }}
            live={live}
            liveQuiet
            onPress={liveTarget ? () => openLiveTarget(liveTarget) : () => onOpenImage("avatar")}
            onLongPress={() => imageMenu.open("avatar")}
          />
          <ProfilePullRing size={96} radius={Math.round(96 * 0.16)} color={colors.accent} />
          </Animated.View>
          {(!isBlocked || !!onOpenOptions) && (
            <View ref={actionsRef} collapsable={false} onLayout={measureIdentity} className="flex-row items-center gap-2 self-start" style={{ marginTop: 60, marginRight: cinematicPhone ? -4 : -8 }}>
              {!isBlocked && renderFollowButton()}
              {!isBlocked && !!onMessage && (
                <TouchableOpacity
                  onPress={onMessage}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t("profile.messageUser")}
                  style={[btn, s.iconBtn, isMinimal && s.minimalIconBtn]}
                >
                  {glassLayers}
                  <View style={s.glassBtnContent}>
                    <Icon name="MessageEnvelope" size={16} color="#fff" />
                  </View>
                </TouchableOpacity>
              )}
              {!isBlocked && !isOwnProfile && !!readContactEmail(customs) && (
                <TouchableOpacity
                  onPress={() => { void Linking.openURL(`mailto:${readContactEmail(customs)}`); }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t("accountType.contact")}
                  style={[btn, s.iconBtn, isMinimal && s.minimalIconBtn]}
                >
                  {glassLayers}
                  <View style={s.glassBtnContent}>
                    <Icon name="Mail" size={16} color="#fff" />
                  </View>
                </TouchableOpacity>
              )}
              {!!onOpenOptions && (
                <TouchableOpacity
                  onPress={onOpenOptions}
                  activeOpacity={0.7}
                  testID="profile-options"
                  accessibilityRole="button"
                  accessibilityLabel={t("profileOptions.a11yLabel")}
                  style={[btn, s.iconBtn, isMinimal && s.minimalIconBtn]}
                >
                  {glassLayers}
                  <View style={s.glassBtnContent}>
                    <Icon name="EllipsisVertical" size={16} color="#fff" />
                  </View>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        <View className="mt-2">
          {/* The name owns the full width and may take two lines. Social
              links used to share this row and cut a long name to one line;
              they now live in the Links pill at the bottom of the header. */}
          <View className="flex-row items-center gap-1.5">
            <Text ref={identityRef} onLayout={measureIdentity} className="text-white font-bold" numberOfLines={2} style={{ flexShrink: 1, fontSize: 24, lineHeight: 30 }}>{displayName}</Text>
            {badge && badgeImage && (
              <Pressable ref={badgeRef} style={{ alignSelf: "flex-end", height: 28, justifyContent: "center" }} hitSlop={8} onPress={() => openBadgeShowcase(badge, badgeRef.current)}>
                <BadgeArtwork source={badgeImage} style={[getBadgeOpticalStyle(badgeImage, 20), { marginLeft: 0 }]} contentFit="contain" />
              </Pressable>
            )}
            <StreamerBadge address={address} canSelect={isOwnProfile} fontSize={24} lineHeight={30} />
          </View>

          {/* Wraps, so a long handle plus the .eth / follows-you / patron
              chips drop to a second line instead of running off the edge, and
              a handle too long for a line on its own truncates. */}
          <View className="flex-row flex-wrap items-center mt-0.5 gap-2">
            {!!username && (
              <TouchableOpacity onPress={handleCopyUsername} activeOpacity={0.7} style={{ flexShrink: 1, maxWidth: "100%" }}>
                <Text className="text-zinc-400" style={{ fontSize: 16, lineHeight: 22 }} numberOfLines={1}>@{username}</Text>
              </TouchableOpacity>
            )}
            {/* Beside the handle, never instead of it: the username is what
                this account is called, while the .eth name is a claim on
                something that can be sold or left to expire. */}
            {!!ensName && (
              <TouchableOpacity
                onPress={handleCopyEns}
                activeOpacity={0.7}
                accessibilityLabel={t("profile.verifiedEnsName", { name: ensName })}
                className="px-2 py-0.5 bg-theme-neutrals-800 rounded-md flex-row items-center"
              >
                <Icon name="Globe" size={11} color="#A1A1AA" />
                <Text className="text-theme-neutrals-300 text-[11px] font-medium ml-1">
                  {ensName}
                </Text>
              </TouchableOpacity>
            )}
            {followsYou && (
              <View className="px-2 py-0.5 bg-theme-neutrals-800 rounded">
                <Text className="text-theme-neutrals-400 text-[11px] font-medium">{t("follow.followsYou")}</Text>
              </View>
            )}
            {/* A lent badge draws like any other badge everywhere else; this is
                the one place that says whose it is. */}
            <BadgePatronChip lookupId={address || username} />
            {/* One of their requests on the Requests board shipped. */}
            <EarlySupporterChip address={address} username={username} />
            {/* Badge Museum: their three rarest milestone badges. Tapping one
                opens the whole museum. */}
            <MilestoneChips address={address || username} own={isOwnProfile} />
          </View>

          {!!displayBio && (
            <View className="mt-3">
              <ProfileBio text={displayBio} />
            </View>
          )}

          {/* Creator or Business category, Instagram style. */}
          {!!readAccountCategory(customs) && (
            <Text className="mt-2 text-sm text-zinc-400">{t(`accountType.cat.${readAccountCategory(customs)}`)}</Text>
          )}
          <ProfileFieldsList fields={profileFields} />
          {localTime ? (
            <Text className="mt-1 text-sm text-zinc-400">
              {localTimeLine(t as never, localTime, publicTimeZone)}
            </Text>
          ) : null}

          {/* Joined, with the bio's translate control beside it, as on web. */}
          {(!!joinedDate || (!!bio && showBioTranslate)) && (
            <View className="flex-row flex-wrap items-center mt-3" style={{ columnGap: 8 }}>
              {!!joinedDate && <Text className="text-zinc-400 text-sm">{t("profile.joined")} {joinedDate}</Text>}
              {!!bio && showBioTranslate && (
                <TranslateButton
                  isTranslated={isBioTranslated}
                  isLoading={isTranslatingBio}
                  onTranslate={handleTranslateBio}
                  onShowOriginal={handleShowOriginalBio}
                  inline
                />
              )}
            </View>
          )}

          {(followingItem || followersItem) ? (
            <View className="flex-row flex-wrap items-center gap-4 mt-3">
              {followingItem && (
                <TouchableOpacity
                  onPress={onStatPress ? () => onStatPress("following") : undefined}
                  activeOpacity={onStatPress ? 0.7 : 1}
                >
                  <Text style={{ fontSize: 16, lineHeight: 22 }}>
                    <Text className="text-white font-bold">{formatCount(followingItem.value)}</Text>
                    <Text className="text-zinc-400"> {t("profile.following")}</Text>
                  </Text>
                </TouchableOpacity>
              )}
              {followersItem && (
                <TouchableOpacity
                  onPress={onStatPress ? () => onStatPress("followers") : undefined}
                  activeOpacity={onStatPress ? 0.7 : 1}
                >
                  <Text style={{ fontSize: 16, lineHeight: 22 }}>
                    <Text className="text-white font-bold">{formatCount(followersItem.value)}</Text>
                    <Text className="text-zinc-400"> {t("profile.followers")}</Text>
                  </Text>
                </TouchableOpacity>
              )}
              {/* `socials` is the whole account record, so the self-reported
                  counts under its `customs` come along with the links. */}
              {followersItem && (
                <TotalReachPill
                  wallet={address}
                  source={socials as Record<string, unknown> | undefined}
                  followers={followersItem.value}
                />
              )}
              {/* The links ride at the end of the counts line and only wrap
                  below when the line is genuinely full. */}
              <ProfileLinksPill source={socials as Record<string, unknown> | undefined} style={{ marginLeft: "auto" }} />
            </View>
          ) : null}
        </View>

        {/* Mutual followers. Nothing is reserved while the request runs: a
            profile with no mutuals must not show an empty bar under the
            counts, so the row only appears once there is someone to show. */}
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <View className="flex-1" style={{ minWidth: 0 }}>
            <MutualFollowers mutuals={mutuals || []} totalCount={mutualsTotal} />
          </View>
          {/* Counts hidden: the links fall back to this corner. */}
          {!(followingItem || followersItem) && (
            <View style={{ marginTop: 12 }}>
              <ProfileLinksPill source={socials as Record<string, unknown> | undefined} />
            </View>
          )}
        </View>

        {/* Badge Museum: every earned badge in a framed grid under the
            counts. Nothing until one is earned, or when the owner hides it. */}
        {!isBlocked && <BadgeMuseumPanel address={address || username} own={isOwnProfile} />}

        {/* The streamer ladder. Renders nothing until a stream has ended,
            so a non-streamer's profile is unchanged. */}
        {isOwnProfile && !isBlocked && <StreamerLevelCard address={address} className="mt-3" />}

        {/* The creator's stream pet, for everyone. Nothing for someone without one. */}
        {!isBlocked && <ProfilePetCard address={address} own={isOwnProfile} className="mt-3" />}

        {/* Followers can subscribe to the creator's pinned plans. */}
        {!isOwnProfile && !isBlocked && isFollowing && plansLoading && !hasPlans ? (
          <View style={[btn, s.subscribePlaceholder]} />
        ) : (
          !isOwnProfile && !isBlocked && isFollowing && hasPlans && !!onSubscribe && (
            <TouchableOpacity
              onPress={onSubscribe}
              activeOpacity={0.7}
              style={[btn, { marginTop: 12, paddingHorizontal: 0 }]}
            >
              {glassLayers}
              <View style={s.glassBtnContent}>
                <Icon name="Star" size={14} color="#fff" />
                <Text style={s.glassBtnLabel}>{t("profile.subscribeNow")}</Text>
              </View>
            </TouchableOpacity>
          )
        )}

        {!hasUsername && (
          <View className="mt-3 bg-theme-neutrals-800/60 rounded-lg p-3">
            <Text className="text-theme-neutrals-200 text-xs leading-4">
              {t("profile.notFullyJoined")}
            </Text>
          </View>
        )}
      </View>
      <ProfileImageMenu
        target={imageMenu.target}
        onClose={imageMenu.close}
        canEdit={false}
        imageUrl={(kind) => {
          const url = kind === "avatar" ? (avatarFullUrl || avatarUrl) : coverUrl;
          return url && !url.startsWith("default") ? url : undefined;
        }}
        hasImage={() => false}
      />
    </View>
  );
};

const s = StyleSheet.create({
  glassBtn: {
    height: BTN_H,
    paddingHorizontal: 16,
    borderRadius: BTN_RADIUS,
    overflow: "hidden",
  },
  // Same box the real row/button occupies, so the mutuals-loading and
  // plans-loading states don't change the header's height once real content
  // (or nothing) replaces them.
  subscribePlaceholder: {
    marginTop: 12,
    paddingHorizontal: 0,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  iconBtn: {
    width: BTN_H,
    paddingHorizontal: 0,
  },
  minimalBtn: {
    height: 44,
    borderWidth: 1,
    borderColor: MINIMAL_HAIRLINE,
  },
  minimalIconBtn: {
    width: 44,
  },
  glassOverlay: {
    backgroundColor: "rgba(24,24,27,0.3)",
    borderRadius: BTN_RADIUS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  glassBtnContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  followingTick: {
    marginRight: -1,
  },
  glassBtnLabel: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});

export default UserProfileHeader;
