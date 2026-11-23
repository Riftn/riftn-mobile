/**
 * List some of your fractions of a post at a fixed price.
 *
 * The cap is read live off the collection contract, less what is already on
 * the book under your address, and the server re-checks both before the row
 * is written. Listing fractions you no longer hold is the fastest way to turn
 * this market into a scam report, so it is checked twice on purpose.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, ActivityIndicator, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { DhbCoin } from "../common/DhbCoin";
import Icon from "../ui/Icon";
import {
  FractionSheet,
  Note,
  NumberField,
  Panel,
  PanelRow,
  PrimaryButton,
  QuantityPicker,
  sheetStyles,
} from "./SheetParts";
import { fmt } from "./fractionFormat";
import { toastSuccess } from "../../libs/toast";
import { useCreateListing, type PostSnapshot } from "../../hooks/useFractionCheckout";
import { useFractionBalance } from "../../hooks/useFractionPortfolio";
import { TOTAL_FRACTIONS, useFractionListings, useFractionWallet } from "../../hooks/useFractionMarket";
import { useTokenPrices } from "../../hooks/useStores";

export interface SellTarget {
  tokenId: string;
  chainId: number;
  post: PostSnapshot;
}

interface Props {
  target: SellTarget | null;
  onClose: () => void;
}

const SellFractionsSheet: React.FC<Props> = ({ target, onClose }) => {
  const { t } = useTranslation();
  const wallet = useFractionWallet();
  const [quantity, setQuantity] = useState(0);
  const [price, setPrice] = useState("");
  const createListing = useCreateListing();
  // "Give away free" lists at price 0: people claim, you approve each one.
  const [free, setFree] = useState(false);
  const { data: balance, isLoading: loadingBalance } = useFractionBalance(target?.tokenId, target?.chainId);
  const { data: listings = [] } = useFractionListings(target?.tokenId);
  const { data: prices } = useTokenPrices();
  const dhbUsd = prices?.DHB ?? 0;

  const alreadyListed = useMemo(
    () =>
      listings
        .filter((l) => l.seller_address.toLowerCase() === wallet)
        .reduce((sum, l) => sum + (l.quantity - l.filled_quantity), 0),
    [listings, wallet],
  );
  const held = balance ?? 0;
  const sellable = Math.max(0, held - alreadyListed);

  // The cheapest ask on this post's book — the closest thing to a spot price.
  const floorPrice = useMemo(() => {
    const asks = listings
      .filter((l) => l.quantity - l.filled_quantity > 0 && l.price_per_fraction > 0)
      .map((l) => l.price_per_fraction);
    return asks.length ? Math.min(...asks) : null;
  }, [listings]);

  // Seed once per opened post, and again when the balance first lands. A
  // tenth of what you hold is a sensible first sale that does not dump a whole
  // position because the slider was dragged too far.
  useEffect(() => {
    if (!target) return;
    setQuantity(sellable > 0 ? Math.max(1, Math.floor(sellable / 10)) : 0);
    setPrice(floorPrice ? String(floorPrice) : "");
    setFree(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.tokenId, balance === undefined]);

  if (!target) return null;

  const prc = free ? 0 : parseFloat(price) || 0;
  const total = quantity * prc;
  const isValid = quantity > 0 && quantity <= sellable && (free || prc > 0);
  const busy = createListing.isPending;

  const handleSubmit = async () => {
    if (!isValid) return;
    const result = await createListing
      .mutateAsync({
        tokenId: target.tokenId,
        quantity,
        pricePerFraction: prc,
        chainId: target.chainId,
        post: target.post,
      })
      .catch(() => null);
    if (!result) return;
    toastSuccess(
      free
        ? t("fractions.giveawayListed", { count: quantity })
        : t("fractions.listedToast", { count: quantity, price: prc }),
    );
    onClose();
  };

  let body: React.ReactNode;
  if (loadingBalance) {
    body = <ActivityIndicator color="#A1A1AA" style={styles.loader} />;
  } else if (balance === null) {
    body = <Note warn text={t("fractions.balanceReadFailed")} />;
  } else if (sellable === 0) {
    body = (
      <Text style={sheetStyles.center}>
        {held === 0 ? t("fractions.dontHoldAnyOfPost") : t("fractions.allAlreadyListed", { count: held })}
      </Text>
    );
  } else {
    body = (
      <>
        <QuantityPicker
          label={t("fractions.howMany")}
          hint={
            t("fractions.availableCount", { count: sellable }) +
            (alreadyListed > 0 ? t("fractions.alsoAlreadyListed", { count: alreadyListed }) : "")
          }
          value={quantity}
          max={sellable}
          onChange={setQuantity}
          disabled={busy}
        />
        <View style={styles.presets}>
          {[0.25, 0.5, 1].map((f) => (
            <Pressable
              key={f}
              style={styles.preset}
              onPress={() => setQuantity(Math.max(1, Math.floor(sellable * f)))}
              accessibilityRole="button"
            >
              <Text style={styles.presetText}>{f === 1 ? t("fractions.all") : `${f * 100}%`}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.modes} accessibilityRole="tablist">
          {[false, true].map((isFree) => {
            const on = free === isFree;
            return (
              <Pressable
                key={String(isFree)}
                onPress={() => setFree(isFree)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={styles.modeTap}
              >
                <View style={[styles.mode, on && styles.modeOn]}>
                  <Icon name={isFree ? "Gift" : "Tag"} size={15} color={on ? "#FFFFFF" : "#A1A1AA"} />
                  <Text style={[styles.modeText, on && styles.modeTextOn]} numberOfLines={1}>
                    {isFree ? t("fractions.modeFree") : t("fractions.modeSell")}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {!free && (
        <NumberField
          label={t("fractions.pricePerFraction")}
          value={price}
          onChange={setPrice}
          decimal
          unit={<DhbCoin size={16} />}
          right={
            floorPrice !== null ? (
              <Pressable onPress={() => setPrice(String(floorPrice))} hitSlop={8} accessibilityRole="button">
                <Text style={sheetStyles.link}>{t("fractions.matchFloor", { price: fmt(floorPrice, 4) })}</Text>
              </Pressable>
            ) : null
          }
        />
        )}

        <Panel>
          <PanelRow label={t("fractions.shareOfPost")}>
            <Text style={sheetStyles.value}>{((quantity / TOTAL_FRACTIONS) * 100).toFixed(1)}%</Text>
          </PanelRow>
          <PanelRow label={t("fractions.youReceive")} strong>
            {free ? (
              <Text style={sheetStyles.valueStrong}>{t("fractions.freeBadge")}</Text>
            ) : (
              <>
                <DhbCoin size={15} />
                <Text style={sheetStyles.valueStrong}>{fmt(total)}</Text>
              </>
            )}
          </PanelRow>
          {dhbUsd > 0 && total > 0 && <Text style={sheetStyles.sub}>≈ ${fmt(total * dhbUsd)}</Text>}
        </Panel>

        <Text style={sheetStyles.footnote}>{free ? t("fractions.freeListNote") : t("fractions.listingFreeNote")}</Text>

        <PrimaryButton
          icon={free ? "Gift" : "Tag"}
          label={
            busy
              ? t("fractions.listingInProgress")
              : free
                ? t("fractions.giveNFree", { count: quantity })
                : t("fractions.listNFractions", { count: quantity })
          }
          onPress={handleSubmit}
          loading={busy}
          disabled={!isValid}
        />
      </>
    );
  }

  return (
    <FractionSheet visible={!!target} onClose={onClose} busy={busy} title={t("fractions.sellFractions")}>
      {!!target.post.title && <Text style={styles.subtitle} numberOfLines={1}>{target.post.title}</Text>}
      {body}
    </FractionSheet>
  );
};

const styles = StyleSheet.create({
  loader: { paddingVertical: 28 },
  subtitle: { color: "#A1A1AA", fontSize: 13, marginTop: -8 },
  presets: { flexDirection: "row", gap: 8 },
  preset: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  presetText: { color: "#D4D4D8", fontSize: 12, fontWeight: "600", flexShrink: 0 },
  modes: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  modeTap: { flex: 1 },
  // Fill on an inner View: Pressable fills get repainted by the controls pass.
  mode: {
    height: 36,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  modeOn: { backgroundColor: "rgba(255,255,255,0.15)" },
  modeText: { color: "#A1A1AA", fontSize: 13, fontWeight: "600", flexShrink: 1 },
  modeTextOn: { color: "#FFFFFF" },
});

export default SellFractionsSheet;
