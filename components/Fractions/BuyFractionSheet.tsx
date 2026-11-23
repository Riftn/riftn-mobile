/**
 * Buy part or all of a listing.
 *
 * The amount is quoted server-side on every quantity change and the payment is
 * verified server-side before a trade row exists — nothing computed here is
 * signed. The settlement note is not decoration: the fractions do not arrive
 * in the same transaction as the payment, and the buyer has to know that
 * before they pay, not after.
 */
import React, { useEffect, useState } from "react";
import { Text } from "react-native";
import { useTranslation } from "react-i18next";
import { DhbCoin } from "../common/DhbCoin";
import SellerTrustBadge from "./SellerTrustBadge";
import { FractionSheet, Note, Panel, PanelRow, PrimaryButton, QuantityPicker, sheetStyles } from "./SheetParts";
import { fmt, shortAddress } from "./fractionFormat";
import { useFractionPurchase, type FractionQuote } from "../../hooks/useFractionCheckout";
import {
  TOTAL_FRACTIONS,
  useFractionWallet,
  useSellerStats,
  type FractionListing,
} from "../../hooks/useFractionMarket";
import { useTokenPrices } from "../../hooks/useStores";

interface Props {
  listing: FractionListing | null;
  onClose: () => void;
  onSignIn: () => void;
  onMakeOffer: (listing: FractionListing) => void;
}

const BuyFractionSheet: React.FC<Props> = ({ listing, onClose, onSignIn, onMakeOffer }) => {
  const { t } = useTranslation();
  const wallet = useFractionWallet();
  const [quantity, setQuantity] = useState(1);
  const [quote, setQuote] = useState<FractionQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const { getQuote, buy, claim } = useFractionPurchase();
  const { data: sellerStats } = useSellerStats(listing?.seller_address);
  const { data: prices } = useTokenPrices();
  const dhbUsd = prices?.DHB ?? 0;

  const available = listing ? listing.quantity - listing.filled_quantity : 0;
  const isMine = !!wallet && wallet === listing?.seller_address.toLowerCase();
  // A price-0 listing is a giveaway: Claim, and the owner approves it.
  const free = Number(listing?.price_per_fraction) === 0;

  useEffect(() => {
    if (!listing) return;
    setQuantity(Math.max(1, available));
    setQuote(null);
    setQuoteError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id]);

  // Re-quote once the quantity settles. Quoting needs a Riftn token, so a
  // signed-out buyer sees the asking price off the listing and Buy opens
  // sign-in instead.
  useEffect(() => {
    if (!listing || !wallet || isMine || quantity < 1 || quantity > available) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getQuote
        .mutateAsync({ listingId: listing.id, quantity })
        .then((q) => {
          if (!cancelled) {
            setQuote(q);
            setQuoteError(null);
          }
        })
        .catch((err: Error) => {
          if (!cancelled) {
            setQuote(null);
            setQuoteError(err.message);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // getQuote is a fresh mutation object each render; keying on the inputs is
    // what stops this re-firing forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing?.id, quantity, available, wallet, isMine]);

  if (!listing) return null;

  const sharePct = (quantity / TOTAL_FRACTIONS) * 100;
  const total = quote?.dhbAmount ?? quantity * listing.price_per_fraction;
  const busy = buy.isPending || claim.isPending;

  const handleBuy = async () => {
    if (!wallet) return onSignIn();
    if (!quote) return;
    const result = free
      ? await claim.mutateAsync({ listingId: listing.id, quantity }).catch(() => null)
      : await buy.mutateAsync(quote).catch(() => null);
    if (result) onClose();
  };

  const label = busy
    ? free ? t("fractions.claiming") : t("fractions.paying")
    : isMine
      ? t("fractions.ownListing")
      : !wallet
        ? free ? t("fractions.signInToClaim") : t("fractions.signInToBuy")
        : free
          ? t("fractions.claimNFree", { count: quantity })
          : t("fractions.buyForTotal", { quantity, total: fmt(total) });

  return (
    <FractionSheet
      visible={!!listing}
      onClose={onClose}
      busy={busy}
      title={listing.post_title || t("fractions.postNumber", { id: listing.token_id })}
    >
      <QuantityPicker
        label={t("fractions.howMany")}
        hint={t("fractions.availableCount", { count: available })}
        value={quantity}
        max={available}
        onChange={(n) => {
          setQuote(null);
          setQuantity(n);
        }}
        disabled={isMine || busy}
      />

      <Panel>
        <PanelRow label={t("fractions.seller")}>
          <Text style={sheetStyles.value}>{shortAddress(listing.seller_address)}</Text>
          <SellerTrustBadge stats={sellerStats} compact />
        </PanelRow>
        <PanelRow label={t("fractions.pricePerFraction")}>
          {free ? (
            <Text style={sheetStyles.value}>{t("fractions.freeBadge")}</Text>
          ) : (
            <>
              <Text style={sheetStyles.value}>{fmt(listing.price_per_fraction, 4)}</Text>
              <DhbCoin size={13} />
            </>
          )}
        </PanelRow>
        <PanelRow label={t("fractions.shareOfPost")}>
          <Text style={sheetStyles.value}>{sharePct.toFixed(1)}%</Text>
        </PanelRow>
        <PanelRow label={t("fractions.total")} strong>
          {free ? (
            <Text style={sheetStyles.valueStrong}>{t("fractions.freeBadge")}</Text>
          ) : (
            <>
              <DhbCoin size={15} />
              <Text style={sheetStyles.valueStrong}>{fmt(total)}</Text>
            </>
          )}
        </PanelRow>
        {dhbUsd > 0 && !free && <Text style={sheetStyles.sub}>≈ ${fmt(total * dhbUsd)}</Text>}
      </Panel>

      <Note
        text={free ? t("fractions.claimNote") : t("fractions.settlementNote", { hours: quote?.settleWindowHours ?? 24 })}
      />
      {quote?.paymentsFrozen && <Note warn text={t("fractions.paymentsFrozen")} />}
      {!!quote && quote.sellerBalance !== null && quote.sellerBalance < quantity && (
        <Note warn text={t("fractions.sellerOnlyHolds", { count: quote.sellerBalance })} />
      )}
      {!!quoteError && <Note warn text={quoteError} />}

      <PrimaryButton
        label={label}
        icon={free ? "Gift" : "ShoppingCart"}
        onPress={handleBuy}
        loading={busy}
        disabled={isMine || available === 0 || (!!wallet && (!quote || quote.paymentsFrozen))}
      />
      {!isMine && !free && (
        <PrimaryButton
          secondary
          icon="HandCoins"
          label={t("fractions.makeAnOfferAction")}
          disabled={busy}
          onPress={() => (wallet ? onMakeOffer(listing) : onSignIn())}
        />
      )}
    </FractionSheet>
  );
};

export default BuyFractionSheet;
