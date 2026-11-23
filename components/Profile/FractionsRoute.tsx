/**
 * The Fractions tab on a profile.
 *
 * Reads the same on-chain portfolio as the Fractions screen's Portfolio tab.
 * It used to sum bought minus sold over trade rows, which showed a creator
 * none of the 1000 fractions they were minted and kept showing a position
 * after it had moved on-chain. On your own profile every tile is a shortcut
 * into selling it, and the empty state points at the market.
 */
import { DIGITAL_PURCHASES_ENABLED } from "../../config/storefront";
import Animated from "react-native-reanimated";
import React, { useCallback, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { DeHubLoader } from "../DeHubLoader";
import { DeHubRefreshControl, DeHubRefreshMark } from "../Feed/DeHubRefreshControl";
import Icon from "../ui/Icon";
import ProfileEmptyState from "./ProfileEmptyState";
import { PositionTile } from "../Fractions/FractionPositionGrid";
import SellFractionsSheet, { type SellTarget } from "../Fractions/SellFractionsSheet";
import { padGrid } from "../Fractions/fractionFormat";
import { ScreenNames } from "../../navigation/ScreenNames";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import { useFractionPortfolio, livePositions, type PortfolioPosition } from "../../hooks/useFractionPortfolio";
import { PaneAnimatedFlatList, PaneAnimatedScrollView } from "./profilePaneScroll";

interface FractionsRouteProps {
  address?: string;
  listRef?: React.RefObject<import("react-native").FlatList<any> | null>;
  isOwnProfile?: boolean;
  listHeader?: React.ReactElement | null;
  onScroll?: any;
}

const FractionsRoute: React.FC<FractionsRouteProps> = ({
  address,
  listRef,
  isOwnProfile,
  listHeader,
  onScroll,
}) => {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { hideUserProfile } = useUserProfileSheet();
  const [selling, setSelling] = useState<SellTarget | null>(null);
  const { data: allPositions, isLoading, isError, refetch, isRefetching } = useFractionPortfolio(address);
  const everything = useMemo(() => livePositions(allPositions || []), [allPositions]);
  const [shelf, setShelf] = useState<"all" | "created" | "collected">("all");
  const created = useMemo(() => everything.filter((p) => p.isCreator), [everything]);
  const collected = useMemo(() => everything.filter((p) => !p.isCreator), [everything]);
  const positions = shelf === "created" ? created : shelf === "collected" ? collected : everything;

  const openPost = useCallback(
    (tokenId: string) => {
      hideUserProfile();
      navigation.navigate(ScreenNames.FeedDetail as never, { postId: tokenId } as never);
    },
    [navigation, hideUserProfile],
  );

  const openMarket = useCallback(() => {
    hideUserProfile();
    navigation.navigate(ScreenNames.Fractions as never);
  }, [navigation, hideUserProfile]);

  const sell = useCallback((p: PortfolioPosition) => {
    setSelling({
      tokenId: p.tokenId,
      chainId: p.chainId,
      post: { title: p.title || undefined, imageUrl: p.imageUrl || undefined, type: p.postType || undefined },
    });
  }, []);

  if (isLoading) {
    return (
      <PaneAnimatedScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        {listHeader}
        <View style={styles.center}>
          <DeHubLoader size={56} />
        </View>
      </PaneAnimatedScrollView>
    );
  }

  if (isError) {
    return (
      <PaneAnimatedScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        {listHeader}
        <View style={styles.center}>
          <Icon name="CircleAlert" size={40} color="#4B5563" />
          <Text style={styles.errorText}>{t("fractions.loadFailed")}</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.retryBtn}>
            <Text style={styles.retryText}>{t("common.retry")}</Text>
          </TouchableOpacity>
        </View>
      </PaneAnimatedScrollView>
    );
  }

  if (!address || everything.length === 0) {
    return (
      <PaneAnimatedScrollView onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        {listHeader}
        <ProfileEmptyState
          kind="fractions"
          title={t("fractions.noFractionsYet")}
          subtitle={t(isOwnProfile ? "fractions.profileEmptyOwn" : "fractions.profileEmptyOther")}
        />
        {isOwnProfile && (
          <TouchableOpacity onPress={openMarket} style={styles.marketBtn}>
            <Text style={styles.retryText}>{t("fractions.browseTheMarket")}</Text>
          </TouchableOpacity>
        )}
      </PaneAnimatedScrollView>
    );
  }

  const totalHeld = positions.reduce((sum, p) => sum + p.balance, 0);

  return (
    <View style={{ flex: 1 }}>
      <PaneAnimatedFlatList
        ref={listRef}
        onScroll={onScroll}
        scrollEventThrottle={16}
        data={padGrid(positions)}
        keyExtractor={(p, i) => (p ? `${p.chainId}-${p.tokenId}` : `spacer-${i}`)}
        renderItem={({ item }) => (
          <PositionTile position={item} onOpen={openPost} onSell={isOwnProfile && DIGITAL_PURCHASES_ENABLED ? sell : undefined} />
        )}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        ListHeaderComponent={
          <>
            {listHeader}
            {created.length > 0 && collected.length > 0 ? (
              <View style={styles.shelves} accessibilityRole="tablist">
                {([
                  ["all", t("collect.shelfAll", { defaultValue: "All" })],
                  ["created", t("collect.shelfCreated", { defaultValue: "Created" })],
                  ["collected", t("collect.shelfCollected", { defaultValue: "Collected" })],
                ] as const).map(([id, label]) => (
                  <TouchableOpacity
                    key={id}
                    onPress={() => setShelf(id)}
                    style={[styles.shelf, shelf === id && styles.shelfActive]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: shelf === id }}
                  >
                    <Text style={[styles.shelfText, shelf === id && styles.shelfTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <Text style={styles.count}>
              {t("fractions.fractionCount", { count: totalHeld })}{" "}
              {t("fractions.acrossPosts", { count: positions.length })}
            </Text>
          </>
        }
        refreshControl={<DeHubRefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor="#fff" />}
        showsVerticalScrollIndicator={false}
      />
      <DeHubRefreshMark refreshing={isRefetching} />
      {isOwnProfile && <SellFractionsSheet target={selling} onClose={() => setSelling(null)} />}
    </View>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  grid: { padding: 16, paddingBottom: 80, gap: 12 },
  row: { gap: 12 },
  count: { color: "#A6A9AC", fontSize: 12, marginBottom: 12 },
  shelves: { flexDirection: "row", gap: 8, marginBottom: 12 },
  shelf: { paddingHorizontal: 14, height: 32, justifyContent: "center", borderRadius: 16, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  shelfActive: { backgroundColor: "#FFFFFF", borderColor: "#FFFFFF" },
  shelfText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  shelfTextActive: { color: "#000000" },
  errorText: { color: "#8B8D90", fontSize: 14, textAlign: "center" },
  retryBtn: { backgroundColor: "rgba(255,255,255,0.10)", borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  marketBtn: {
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
});

export default FractionsRoute;
