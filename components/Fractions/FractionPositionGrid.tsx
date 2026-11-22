/**
 * Held positions as tiles. `PositionTile` is one cell — the profile's
 * Fractions tab lays those out in its own FlatList, because its parent scrolls
 * it by ref — and `FractionPositionGrid` is the same cells in rows, for the
 * Portfolio tab where the grid sits inside a ScrollView next to other sections.
 */
import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import FractionTile from "./FractionTile";
import { padGrid } from "./fractionFormat";
import type { PortfolioPosition } from "../../hooks/useFractionPortfolio";

interface TileProps {
  position: PortfolioPosition | null;
  onOpen: (tokenId: string) => void;
  /** Omitted on someone else's profile — you can only sell your own. */
  onSell?: (position: PortfolioPosition) => void;
  /** Omitted on someone else's profile — you can only send your own. */
  onSend?: (position: PortfolioPosition) => void;
}

export const PositionTile: React.FC<TileProps> = ({ position: p, onOpen, onSell, onSend }) => {
  const { t } = useTranslation();
  if (!p) return <View style={styles.spacer} />;
  return (
    <FractionTile
      tokenId={p.tokenId}
      title={p.title}
      imageUrl={p.imageUrl}
      postType={p.postType}
      units={p.balance}
      showYours={p.isCreator}
      onPress={() => onOpen(p.tokenId)}
      footer={
        onSell || onSend ? (
          <View style={styles.actions}>
            {onSell && (
              <Pressable
                onPress={() => onSell(p)}
                style={styles.sell}
                accessibilityRole="button"
                accessibilityLabel={t("fractions.sell")}
              >
                <Icon name="Tag" size={13} color="#FFFFFF" />
                <Text style={styles.sellText} numberOfLines={1}>{t("fractions.sell")}</Text>
              </Pressable>
            )}
            {onSend && (
              <Pressable
                onPress={() => onSend(p)}
                style={styles.sell}
                accessibilityRole="button"
                accessibilityLabel={t("fractions.giftSend", "Send")}
                testID="fraction-send"
              >
                <Icon name="Send" size={13} color="#FFFFFF" />
                <Text style={styles.sellText} numberOfLines={1}>{t("fractions.giftSend", "Send")}</Text>
              </Pressable>
            )}
          </View>
        ) : undefined
      }
    >
      <Text style={styles.pct}>{t("fractions.pctOfPost", { pct: p.percentage.toFixed(1) })}</Text>
    </FractionTile>
  );
};

interface GridProps {
  positions: PortfolioPosition[];
  onOpen: (tokenId: string) => void;
  onSell?: (position: PortfolioPosition) => void;
  onSend?: (position: PortfolioPosition) => void;
}

const FractionPositionGrid: React.FC<GridProps> = ({ positions, onOpen, onSell, onSend }) => {
  const cells = padGrid(positions);
  const rows: (PortfolioPosition | null)[][] = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));
  return (
    <View style={styles.grid}>
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {row.map((p, c) => (
            <PositionTile key={p ? `${p.chainId}-${p.tokenId}` : `spacer-${c}`} position={p} onOpen={onOpen} onSell={onSell} onSend={onSend} />
          ))}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: { gap: 12 },
  row: { flexDirection: "row", gap: 12 },
  spacer: { flex: 1 },
  pct: { color: "#A1A1AA", fontSize: 11.5 },
  actions: { flexDirection: "row", gap: 6, marginHorizontal: 10, marginBottom: 10 },
  sell: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 6,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  sellText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600", flexShrink: 0 },
});

export default FractionPositionGrid;
