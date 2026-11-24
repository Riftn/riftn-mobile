/**
 * ArcadeScreen
 * ============
 * Native port of the web ArcadePage (/arcade) — the front door to every game
 * playable in the app. Reads `config/arcade-games` and shows all of them; the
 * cards use the same approved branding or game captures as the web cards.
 *
 * The registry is one game long on native and three on web, and the reason is
 * written out in `config/arcade-games.ts`. Nothing here assumes either count:
 * the grid is a list, so restoring a game there is the whole change.
 */
import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Linking } from "react-native";
import { Image } from "expo-image";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import Icon from "../components/ui/Icon";
import ScreenHeader from "../components/ScreenHeader";
import { PageSection } from "../components/page/PageKit";
import { ScreenNames } from "../navigation/ScreenNames";
import { ARCADE_GAMES, type ArcadeGame } from "../config/arcade-games";
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

const FRIEND_GAMES = [
  { screen: ScreenNames.Okey, icon: "Users", title: "games.okey.title", body: "games.okey.cardBlurb", tint: "hsla(155, 55%, 20%, 1)" },
  { screen: ScreenNames.SillyCoin, icon: "Coins", title: "games.sillycoin.title", body: "games.sillycoin.cardBlurb", tint: "hsla(35, 70%, 22%, 1)" },
  { screen: ScreenNames.Chestard, icon: "Gamepad2", title: "games.chestard.title", body: "games.chestard.cardBlurb", tint: "hsla(300, 55%, 22%, 1)" },
  { screen: ScreenNames.Gratitude, icon: "Heart", title: "games.gratitude.title", body: "games.gratitude.cardBlurb", tint: "hsla(265, 45%, 24%, 1)" },
] as const;

const ArcadeScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

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

        {/* Games with friends: native screens, played over days or at a table. */}
        <PageSection title={t("games.withFriends")}>
          <View style={styles.friends}>
            {FRIEND_GAMES.map((g) => (
              <Pressable
                key={g.screen}
                accessibilityRole="button"
                accessibilityLabel={t(g.title)}
                onPress={() => navigation.navigate(g.screen)}
                style={({ pressed }) => [{ flex: 1 }, pressed && styles.cardPressed]}
              >
                <View className="dark-surface" style={[styles.friendCard, { backgroundColor: g.tint }]}>
                  <Icon name={g.icon} size={18} color="#FFFFFF" />
                  <Text style={styles.friendTitle} numberOfLines={1}>{t(g.title)}</Text>
                  <Text style={styles.friendBody} numberOfLines={3}>{t(g.body)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </PageSection>

        {ARCADE_GAMES.map((game) => (
          <GameCard
            key={game.slug}
            game={game}
            onPress={openGame}
            // King's Gambit is the one game with a lobby: a second way in for
            // live duels against other players.
            onPlayOnline={game.slug === "kings-gambit" ? openChessOnline : undefined}
            playOnlineLabel={t("arcade.chessOnline.playOnline")}
            onSlow={game.slug === "kings-gambit" ? openSlowChess : undefined}
            slowLabel={t("games.chess.slowButton")}
          />
        ))}
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
  friends: { flexDirection: "row", gap: 8 },
  friendCard: { flex: 1, gap: 5, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  friendTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  friendBody: { color: "rgba(255,255,255,0.72)", fontSize: 11, lineHeight: 15 },
});

export default ArcadeScreen;
