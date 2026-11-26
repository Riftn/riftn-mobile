/**
 * ArcadeScreen
 * ============
 * Native port of the web ArcadePage (/arcade) — the front door to every game
 * playable in the app. Reads `config/arcade-games` and shows all of them; the
 * cards use the same approved branding or game captures as the web cards.
 *
 */
import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Linking, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Avatar from "../components/common/Avatar";
import Icon from "../components/ui/Icon";
import PrimaryButton from "../components/ui/PrimaryButton";
import ScreenHeader from "../components/ScreenHeader";
import { PageSection } from "../components/page/PageKit";
import { ScreenNames } from "../navigation/ScreenNames";
import { ARCADE_GAMES, type ArcadeGame } from "../config/arcade-games";
import { COCHRANIZ3R, groupArcadeGames } from "../config/arcade-creators";
import { useUserProfileSheet } from "../context/UserProfileSheetContext";
import { useUser } from "../context/AuthContext";
import { getAvatarUrl } from "../libs/misc";
import { getAccountSummariesByUsernames } from "../services/user.service";
import { getArcadeListings, setArcadeListing, type ArcadeListingState } from "../services/games.service";
import { toastError } from "../libs/toast";
import { WEBSITE_LINK } from "../config/links";
import { colors } from "../theme/colors";
import { useAppTheme } from '../context/ThemeContext';

const GameCard = ({
  game,
  onPress,
  onPlayOnline,
  playOnlineLabel,
  onSlow,
  slowLabel,
}: {
  game: ArcadeGame;
  onPress: (slug: string) => void;
  onPlayOnline?: () => void;
  playOnlineLabel?: string;
  /** Correspondence play of the same game: days per move against a friend. */
  onSlow?: () => void;
  slowLabel?: string;
}) => {
  const { theme } = useAppTheme();
  const glass = theme === 'glass';
  return (
  <PageSection flush>
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={game.title}
    onPress={() => onPress(game.slug)}
    style={({ pressed }) => [glass && { padding: 10 }, pressed && styles.cardPressed]}
  >
    <View style={[styles.artWrap, glass && { borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(0,16,23,.3)' }]}>
      <Image
        source={game.brand ?? { uri: game.art }}
        accessibilityLabel={game.brand ? game.title : game.artAlt}
        style={StyleSheet.absoluteFill}
        contentFit={game.brand ? "contain" : "cover"}
        // The capture is served with a year of `immutable` (dehubweb's
        // public/_headers), so it is worth holding on disk between sessions.
        cachePolicy="memory-disk"
        transition={200}
      />
      {/* Keeps the title legible over whatever the capture happens to be. */}
      {!game.brand && <>
        <View style={styles.artScrim} pointerEvents="none" />
        <Text style={styles.artTitle} numberOfLines={1}>
          {game.title}
        </Text>
      </>}
    </View>

    <View style={styles.cardBody}>
      <Text style={styles.description}>{game.description}</Text>
      <View style={[styles.playButton, glass && { backgroundColor: 'rgba(220,255,255,.07)', borderWidth: 1, borderColor: 'rgba(220,255,255,.22)', borderRadius: 14 }]}>
        <Icon name="Play" size={13} color={glass ? '#efffff' : colors.accentForeground} />
        <Text style={[styles.playLabel, glass && { color: '#efffff' }]}>{game.action}</Text>
      </View>
      {onPlayOnline ? (
        <Pressable
          accessibilityRole="button"
          onPress={onPlayOnline}
          style={({ pressed }) => [styles.onlineButton, pressed && styles.cardPressed]}
        >
          <Icon name="Users" size={13} color="#FFFFFF" />
          <Text style={styles.onlineLabel}>{playOnlineLabel}</Text>
        </Pressable>
      ) : null}
      {onSlow ? (
        <Pressable
          accessibilityRole="button"
          onPress={onSlow}
          style={({ pressed }) => [pressed && styles.cardPressed]}
        >
          <View style={styles.onlineButton}>
            <Icon name="Hourglass" size={13} color="#FFFFFF" />
            <Text style={styles.onlineLabel}>{slowLabel}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  </Pressable>
  </PageSection>
);
};

const LINK_GAMES = [
  { screen: ScreenNames.Okey, creator: { username: 'galatasaray' }, icon: "Users", title: "games.okey.title", body: "games.okey.cardBlurb", tint: "hsla(155, 55%, 20%, 1)" },
  { screen: ScreenNames.SillyCoin, creator: COCHRANIZ3R, icon: "Coins", title: "games.sillycoin.title", body: "games.sillycoin.cardBlurb", tint: "hsla(35, 70%, 22%, 1)" },
  { screen: ScreenNames.Chestard, creator: COCHRANIZ3R, icon: "Gamepad2", title: "games.chestard.title", body: "games.chestard.cardBlurb", tint: "hsla(300, 55%, 22%, 1)" },
  { screen: ScreenNames.BinaryMetal, creator: COCHRANIZ3R, icon: "Music", title: "binaryMetal.title", body: "binaryMetal.cardBlurb", tint: "hsla(0, 0%, 14%, 1)" },
  { screen: ScreenNames.Gratitude, creator: COCHRANIZ3R, icon: "Heart", title: "games.gratitude.title", body: "games.gratitude.cardBlurb", tint: "hsla(265, 45%, 24%, 1)" },
  { screen: ScreenNames.Spend, creator: COCHRANIZ3R, icon: "Gamepad2", title: "games.spend.title", body: "games.spend.cardBlurb", tint: "hsla(143, 55%, 21%, 1)" },
] as const;

// Linked games use their lowercase screen name as the listing slug. Binary Metal
// keeps the hyphen from its public route.
function arcadeListingSlug(game: ArcadeGame | { screen: ScreenNames }): string | null {
  if (!("screen" in game)) return null;
  return game.screen === ScreenNames.BinaryMetal ? "binary-metal" : game.screen.toLowerCase();
}

const CREATOR_GROUPS = groupArcadeGames([...LINK_GAMES, ...ARCADE_GAMES]);
const CREATOR_USERNAMES = CREATOR_GROUPS.flatMap((group) => group.username ? [group.username] : []);

const ArcadeScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width * 0.82, 344);
  const { showUserProfile } = useUserProfileSheet();
  const wallet = useUser()?.walletAddress?.toLowerCase() ?? null;
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const listingQueryKey = ["arcade-listings"];
  const listings = useQuery({
    queryKey: [...listingQueryKey, wallet],
    queryFn: () => getArcadeListings(Boolean(wallet)),
    enabled: focused,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const changeListing = useMutation({
    mutationFn: ({ slug, hidden }: { slug: string; hidden: boolean }) => setArcadeListing(slug, hidden),
    onSuccess: async ({ slug, hidden }) => {
      await queryClient.cancelQueries({ queryKey: listingQueryKey });
      queryClient.setQueriesData<ArcadeListingState>({ queryKey: listingQueryKey }, (current) => current && ({
        ...current,
        hidden: hidden ? [...new Set([...current.hidden, slug])] : current.hidden.filter((id) => id !== slug),
      }));
      await queryClient.invalidateQueries({ queryKey: listingQueryKey });
    },
    onError: () => toastError(t("arcade.listingUpdateError")),
  });
  const { data: profiles = [] } = useQuery({
    queryKey: ["arcade-creator-profiles", CREATOR_USERNAMES],
    queryFn: () => getAccountSummariesByUsernames(CREATOR_USERNAMES),
    enabled: CREATOR_USERNAMES.length > 0,
    staleTime: 5 * 60_000,
  });

  const openGame = useCallback(
    (slug: string) => navigation.navigate(ScreenNames.ArcadeGame, { slug }),
    [navigation],
  );
  const openSlowChess = useCallback(
    () => navigation.navigate(ScreenNames.CorrespondenceChess),
    [navigation],
  );
  const openChessOnline = useCallback(
    () => navigation.navigate(ScreenNames.ArcadeChessOnline),
    [navigation],
  );

  return (
    <View className="bg-theme-background" style={styles.screen}>
      <ScreenHeader title={t("nav.arcade")} icon="arcade" />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>{t("arcade.intro")}</Text>

        <PageSection>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("arcade.submitAccessibility")}
            onPress={() => Linking.openURL(`${WEBSITE_LINK}/arcade?submit=1`)}
            style={({ pressed }) => [styles.submitCard, pressed && styles.cardPressed]}
          >
            <Text style={styles.submitTitle}>{t("arcade.submitTitle")}</Text>
            <Text style={styles.submitDescription}>{t("arcade.submitDescription")}</Text>
            <Text style={styles.submitAction}>{t("arcade.submitAction")}</Text>
          </Pressable>
        </PageSection>

        {listings.isError && !listings.data && (
          <Text className="text-theme-neutrals-400" style={styles.listingHint}>{t("arcade.listingsLoadError")}</Text>
        )}
        {CREATOR_GROUPS.map((group) => {
          const games = group.games.filter((game) => {
            const slug = arcadeListingSlug(game);
            return !slug || (listings.data && (!listings.data.hidden.includes(slug) || listings.data.editable.includes(slug)));
          });
          if (!games.length) return null;
          const editable = games.some((game) => {
            const slug = arcadeListingSlug(game);
            return slug !== null && listings.data?.editable.includes(slug);
          });
          const profile = group.username ? profiles.find((entry) => entry.username?.toLowerCase() === group.username) : undefined;
          const name = profile?.displayName?.trim() || group.name || (
            group.id === "riftn" ? t("arcade.riftnOriginals") : t("arcade.otherGames")
          );
          const avatarUrl = profile?.avatarImageUrl ? getAvatarUrl(profile.avatarImageUrl, 32) : group.avatarUrl;
          const { username, profileUrl } = group;
          const openProfile = username
            ? () => showUserProfile(profile?.address || username)
            : profileUrl ? () => Linking.openURL(profileUrl) : undefined;
          const identity = (
            <>
              <Avatar uri={avatarUrl === "default-avatar" ? undefined : avatarUrl} name={name.replace(/^@/, "")} size={32} />
              <Text className="text-theme-neutrals-100" style={styles.creatorName} numberOfLines={1}>{name}</Text>
            </>
          );

          return (
            <View key={group.id} style={styles.creatorShelf}>
              <View style={styles.creatorHeader}>
                {openProfile ? (
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={name}
                    onPress={openProfile}
                    style={({ pressed }) => [styles.creatorIdentity, pressed && styles.cardPressed]}
                  >
                    {identity}
                  </Pressable>
                ) : (
                  <View style={styles.creatorIdentity}>{identity}</View>
                )}
                <Text className="text-theme-neutrals-400" style={styles.gameCount}>
                  {t("arcade.gameCount", { count: games.length })}
                </Text>
              </View>
              {editable && (
                <Text className="text-theme-neutrals-400" style={styles.listingHint}>{t("arcade.listingHint")}</Text>
              )}
              <ScrollView
                horizontal
                directionalLockEnabled
                nestedScrollEnabled
                contentContainerStyle={styles.creatorGames}
              >
                {games.map((game) => {
                  const slug = arcadeListingSlug(game);
                  const canEdit = slug !== null && listings.data?.editable.includes(slug);
                  const hidden = slug !== null && Boolean(listings.data?.hidden.includes(slug));
                  const loading = changeListing.isPending && changeListing.variables?.slug === slug;
                  const action = t(hidden ? "arcade.showListing" : "arcade.hideListing");
                  return (
                    <View key={"slug" in game ? game.slug : game.screen} style={[styles.listingCard, { width: cardWidth }]}>
                      {"slug" in game ? (
                        <GameCard
                          game={game}
                          onPress={openGame}
                          onPlayOnline={game.slug === "kings-gambit" ? openChessOnline : undefined}
                          playOnlineLabel={t("arcade.chessOnline.playOnline")}
                          onSlow={game.slug === "kings-gambit" ? openSlowChess : undefined}
                          slowLabel={t("games.chess.slowButton")}
                        />
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t(game.title)}
                          onPress={() => navigation.navigate(game.screen)}
                          style={({ pressed }) => [{ flex: 1 }, pressed && styles.cardPressed]}
                        >
                          <View className="dark-surface" style={[styles.friendCard, { backgroundColor: game.tint }]}>
                            <Icon name={game.icon} size={18} color="#FFFFFF" />
                            <Text style={styles.friendTitle} numberOfLines={1}>{t(game.title)}</Text>
                            <Text style={styles.friendBody} numberOfLines={3}>{t(game.body)}</Text>
                          </View>
                        </Pressable>
                      )}
                      {canEdit && (
                        <PrimaryButton
                          title={action}
                          accessibilityLabel={t("arcade.listingActionLabel", { action, game: "slug" in game ? game.title : t(game.title) })}
                          icon={hidden ? "Eye" : "EyeOff"}
                          loading={loading}
                          disabled={changeListing.isPending && !loading}
                          hitSlop={2}
                          style={styles.listingAction}
                          onPress={() => changeListing.mutate({ slug, hidden: !hidden })}
                        />
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingTop: 4 },
  intro: {
    color: "#A1A1AA",
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  submitCard: { gap: 5 },
  submitTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  submitDescription: { color: "#A1A1AA", fontSize: 12 },
  submitAction: { color: "#FFFFFF", fontSize: 12, fontWeight: "600", marginTop: 5 },
  cardPressed: { opacity: 0.85 },
  artWrap: {
    // The captures are 1280x720. Holding 16/9 means the art is never cropped
    // to a different shape than the one it was framed in.
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
    justifyContent: "flex-end",
  },
  artScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  artTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "600",
    padding: 14,
  },
  cardBody: { padding: 14, gap: 12 },
  description: { color: "#A1A1AA", fontSize: 12, lineHeight: 18 },
  playButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: colors.accent,
  },
  playLabel: {
    color: colors.accentForeground,
    fontSize: 12,
    fontWeight: "600",
  },
  onlineButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: "#27272A",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  onlineLabel: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  creatorShelf: { marginBottom: 10 },
  creatorHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 8, gap: 12 },
  creatorIdentity: { flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  creatorName: { flexShrink: 1, fontSize: 14, fontWeight: "600" },
  gameCount: { fontSize: 12, fontVariant: ["tabular-nums"] },
  creatorGames: { paddingHorizontal: 8, gap: 8 },
  listingCard: { gap: 8 },
  listingAction: { alignSelf: "flex-start" },
  listingHint: { fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginBottom: 8 },
  friendCard: { flex: 1, gap: 5, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  friendTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  friendBody: { color: "rgba(255,255,255,0.72)", fontSize: 11, lineHeight: 15 },
});

export default ArcadeScreen;
