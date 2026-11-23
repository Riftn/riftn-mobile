/**
 * Auctions inside the NFT sheet. A bid is a DHB offer that meets the auction's
 * minimum, so the money stays in the bidder's wallet until the seller accepts
 * the winner. Android trades; elsewhere it shows the auction without buttons.
 */
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ethers } from "ethers";
import { Panel, PanelRow, PrimaryButton, NumberField, sheetStyles } from "../Fractions/SheetParts";
import { formatPrice } from "./NftTile";
import { toastError, toastSuccess } from "../../libs/toast";
import { formatCount } from "../../libs/format-count";
import { fillOrder, nftMarket, offerOnNft, tokenBalance, type MarketCurrency, type MarketOrder, type NftTarget, type Signer } from "../../services/nft-market.service";
import { buildOffer } from "../../libs/market/seaport";
import { collect, timeLeft, type Auction } from "../../services/collect.service";

const DURATIONS = [24, 72, 168] as const;

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

const parse = (value: string, decimals: number) => {
  if (!value || !/^\d*\.?\d*$/.test(value)) return 0n;
  try {
    return BigInt(ethers.utils.parseUnits(value, decimals).toString());
  } catch {
    return 0n;
  }
};

interface Props {
  target: NftTarget;
  signer: Signer | null;
  canTrade: boolean;
  holds: boolean;
  standard: "erc721" | "erc1155";
  dhb: MarketCurrency | undefined;
  offers: MarketOrder[];
  name: string;
  image: string | null;
  disabled?: boolean;
}

const AuctionBox: React.FC<Props> = ({ target, signer, canTrade, holds, standard, dhb, offers, name, image, disabled }) => {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ["nft-market", "auction", target.chainId, target.contract.toLowerCase(), target.tokenId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => collect.auctionForNft(target.chainId, target.contract, target.tokenId),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const auction: Auction | null = query.data?.auction ?? null;
  const bids = query.data?.bids ?? [];
  const now = useNow(!!auction && auction.status === "live");
  const [form, setForm] = useState<"none" | "start" | "bid">("none");
  const [price, setPrice] = useState("");
  const [hours, setHours] = useState<number>(72);
  const [busy, setBusy] = useState<string | null>(null);
  const me = signer?.account?.toLowerCase() ?? "";

  const decimals = auction?.currencyDecimals ?? dhb?.decimals ?? 18;
  const symbol = auction?.currencySymbol ?? dhb?.symbol ?? "DHB";
  const fmt = (wei: string | null | undefined) => (wei ? `${formatPrice(wei, decimals)} ${symbol}` : "—");
  const amount = parse(price, decimals);
  const minimum = auction ? BigInt(auction.minimumBid ?? auction.startPrice) : 0n;

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    try {
      await fn();
      toastSuccess(done);
      setForm("none");
      setPrice("");
      void qc.invalidateQueries({ queryKey: ["nft-market"] });
    } catch (e) {
      const msg = (e as Error)?.message || t("nftMarket.failed", { defaultValue: "That didn't go through. Try again." });
      toastError(/user rejected|denied|cancel/i.test(msg) ? t("nftMarket.cancelled", { defaultValue: "Cancelled" }) : msg);
    } finally {
      setBusy(null);
    }
  };

  const start = () => run("start", async () => {
    if (!dhb || amount <= 0n) return;
    await collect.startAuction({
      chainId: target.chainId, contract: target.contract, tokenId: target.tokenId, amount: "1",
      currency: dhb.address, startPrice: amount.toString(), durationHours: hours, nftName: name, nftImage: image,
    });
  }, t("collect.auctionStarted", { defaultValue: "Auction started. We will tell you about every bid." }));

  const bid = () => run("bid", async () => {
    if (!signer || !auction || amount < minimum) return;
    const balance = await tokenBalance(auction.currency, me, auction.chainId);
    if (balance < amount) throw new Error(t("nftMarket.notEnough", { symbol, defaultValue: "Not enough {{symbol}} in your wallet" }));
    const terms = await nftMarket.terms({ chainId: auction.chainId, contract: auction.contract, tokenId: auction.tokenId, price: amount.toString(), currency: auction.currency });
    if (!terms.feeRecipient) throw new Error(t("collect.marketOff", { defaultValue: "The market is not open on this chain yet." }));
    const days = Math.max(1, Math.ceil((Date.parse(auction.endsAt) - Date.now()) / 86_400_000) + 3);
    const order = await offerOnNft(signer, auction.currency, amount, (counter) => buildOffer({
      buyer: me,
      nft: { contract: auction.contract, tokenId: auction.tokenId, standard, amount: auction.amount || "1" },
      currency: auction.currency,
      price: amount,
      terms: { feeRecipient: terms.feeRecipient, feeBps: terms.feeBps, royalty: terms.royalty },
      days,
      counter,
      holder: auction.seller,
    }));
    await collect.bidPosted(auction.id, order.orderHash).catch(() => undefined);
  }, t("collect.bidPlaced", { defaultValue: "Bid placed. Your DHB stays in your wallet until the seller accepts." }));

  const acceptTop = () => run("accept", async () => {
    if (!signer || !auction) return;
    const order = offers.find((o) => o.orderHash === bids[0]?.orderHash);
    if (!order) throw new Error(t("collect.bidGone", { defaultValue: "That bid is no longer valid. Close this and open it again." }));
    await fillOrder(signer, order, auction.tokenId);
    await collect.settle(auction.id, order.orderHash).catch(() => undefined);
  }, t("collect.auctionSold", { defaultValue: "Sold to the top bidder. The DHB is in your wallet." }));

  const cancel = () => run("cancel", async () => auction && collect.cancelAuction(auction.id),
    t("collect.auctionCancelled", { defaultValue: "Auction ended without a sale" }));

  const locked = !!busy || !!disabled;

  if (!auction) {
    if (!canTrade || !signer || !holds || !dhb) return null;
    if (form !== "start") {
      return <PrimaryButton secondary icon="Hammer" label={t("collect.startAuction", { defaultValue: "Start an auction" })} onPress={() => setForm("start")} disabled={locked} />;
    }
    return (
      <View style={{ gap: 12 }}>
        <Text style={styles.title}>{t("collect.startAuction", { defaultValue: "Start an auction" })}</Text>
        <NumberField label={t("collect.startPrice", { defaultValue: "Lowest bid you accept (DHB)" })} value={price} onChange={setPrice} decimal unit={<Text style={styles.unit}>DHB</Text>} />
        <View style={styles.chips}>
          {DURATIONS.map((h) => (
            <Pressable key={h} onPress={() => setHours(h)} style={[styles.chip, hours === h && styles.chipActive]} accessibilityRole="button" accessibilityState={{ selected: hours === h }}>
              <Text style={[styles.chipText, hours === h && styles.chipTextActive]}>{t("collect.nDays", { n: h / 24, defaultValue: "{{n}} days" })}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={sheetStyles.footnote}>
          {t("collect.auctionHow", { defaultValue: "Each new bid must beat the last by 5%. When time is up you pick the winner and the NFT and DHB swap in one step." })}
        </Text>
        <PrimaryButton label={t("collect.start", { defaultValue: "Start" })} onPress={start} loading={busy === "start"} disabled={locked || amount <= 0n} />
        <PrimaryButton secondary label={t("nftMarket.back", { defaultValue: "Back" })} onPress={() => setForm("none")} disabled={!!busy} />
      </View>
    );
  }

  const left = Date.parse(auction.endsAt) - now;
  const ended = auction.status !== "live" || left <= 0;
  const isSeller = auction.seller.toLowerCase() === me;

  return (
    <Panel>
      <PanelRow strong label={auction.topBid ? t("collect.topBid", { defaultValue: "Top bid" }) : t("collect.startsAt", { defaultValue: "Bids start at" })}>
        <Text style={sheetStyles.valueStrong}>{fmt(auction.topBid ?? auction.startPrice)}</Text>
      </PanelRow>
      <PanelRow label={ended ? t("collect.auctionEnded", { defaultValue: "Ended" }) : t("collect.endsIn", { defaultValue: "Ends in" })}>
        <Text style={sheetStyles.value}>{ended ? "" : timeLeft(left)}</Text>
      </PanelRow>
      <Text style={styles.meta}>{t("collect.bidCount", { n: formatCount(auction.bidCount ?? bids.length), defaultValue: "{{n}} bids" })}</Text>
      {bids.slice(0, 5).map((b) => (
        <View key={b.orderHash} style={styles.bidRow}>
          <Text style={styles.meta}>{b.makerProfile?.username ? `@${b.makerProfile.username}` : `${b.maker.slice(0, 6)}…${b.maker.slice(-4)}`}</Text>
          <Text style={sheetStyles.value}>{fmt(b.price)}</Text>
        </View>
      ))}
      {canTrade && signer && form === "bid" ? (
        <View style={{ gap: 10 }}>
          <NumberField
            label={t("collect.minBid", { price: fmt(minimum.toString()), defaultValue: "At least {{price}}" })}
            value={price}
            onChange={setPrice}
            decimal
            unit={<Text style={styles.unit}>{symbol}</Text>}
          />
          <PrimaryButton label={t("collect.placeBid", { defaultValue: "Place bid" })} onPress={bid} loading={busy === "bid"} disabled={locked || amount < minimum || amount <= 0n} />
          <PrimaryButton secondary label={t("nftMarket.back", { defaultValue: "Back" })} onPress={() => setForm("none")} disabled={!!busy} />
        </View>
      ) : canTrade && signer ? (
        <View style={{ gap: 8 }}>
          {!isSeller && !ended ? (
            <PrimaryButton icon="Hammer" label={t("collect.bid", { defaultValue: "Bid" })} onPress={() => { setPrice(formatPrice(minimum.toString(), decimals).replace(/,/g, "")); setForm("bid"); }} disabled={locked} />
          ) : null}
          {isSeller && auction.topBid ? (
            <PrimaryButton label={t("collect.acceptTop", { defaultValue: "Sell to top bid" })} onPress={acceptTop} loading={busy === "accept"} disabled={locked} />
          ) : null}
          {isSeller && auction.status === "live" ? (
            <PrimaryButton secondary label={t("collect.endAuction", { defaultValue: "End without selling" })} onPress={cancel} loading={busy === "cancel"} disabled={locked} />
          ) : null}
        </View>
      ) : null}
    </Panel>
  );
};

const styles = StyleSheet.create({
  title: { color: "#FFFFFF", fontSize: 15, fontWeight: "600" },
  meta: { color: "#808089", fontSize: 12 },
  bidRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  unit: { color: "#A1A1AA", fontSize: 14, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, height: 30, justifyContent: "center", borderRadius: 8, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  chipActive: { backgroundColor: "rgba(255,255,255,0.16)", borderColor: "rgba(255,255,255,0.5)" },
  chipText: { color: "#A1A1AA", fontSize: 12, lineHeight: 16, fontWeight: "600" },
  chipTextActive: { color: "#FFFFFF" },
});

export default AuctionBox;
