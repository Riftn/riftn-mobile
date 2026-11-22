/**
 * Give some of your fractions of a post to another Riftn account: search a
 * person, pick how many, send. Same flow and copy as the web sheet.
 *
 * The fractions move straight from your wallet to theirs; the server then
 * reads the transfer back and tells the receiver. What you have listed for
 * sale is held back, so a send never leaves a live listing without the
 * fractions behind it.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { FractionSheet, Note, PrimaryButton, QuantityPicker } from "./SheetParts";
import { CoAuthorFace } from "../common/CoAuthorBits";
import { coAuthorName, type CoAuthorUser } from "../../libs/coAuthors";
import { usersSearch } from "../../services/user.service";
import { toastSuccess } from "../../libs/toast";
import { formatCount } from "../../libs/format-count";
import { useSendFractionGift, type PostSnapshot } from "../../hooks/useFractionCheckout";
import { useFractionBalance } from "../../hooks/useFractionPortfolio";
import { TOTAL_FRACTIONS, useFractionListings, useFractionWallet } from "../../hooks/useFractionMarket";

export interface SendTarget {
  tokenId: string;
  chainId: number;
  post: PostSnapshot;
}

interface Props {
  target: SendTarget | null;
  onClose: () => void;
}

const ADDRESS = /^0x[0-9a-f]{40}$/;

const PersonRow: React.FC<{ user: CoAuthorUser; onPress?: () => void; right?: React.ReactNode }> = ({ user, onPress, right }) => {
  const body = (
    <>
      <CoAuthorFace user={user} size={36} />
      <View style={styles.personText}>
        <Text style={styles.personName} numberOfLines={1}>{coAuthorName(user)}</Text>
        <Text style={styles.personHandle} numberOfLines={1}>{user.username ? `@${user.username}` : user.address}</Text>
      </View>
      {right}
    </>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.person, pressed && styles.personPressed]} accessibilityRole="button">
      {body}
    </Pressable>
  ) : (
    <View style={styles.person}>{body}</View>
  );
};

const SendFractionsSheet: React.FC<Props> = ({ target, onClose }) => {
  const { t } = useTranslation();
  const wallet = useFractionWallet();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CoAuthorUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [to, setTo] = useState<CoAuthorUser | null>(null);
  const [quantity, setQuantity] = useState(1);
  const gift = useSendFractionGift();

  const { data: balance, isLoading: loadingBalance } = useFractionBalance(target?.tokenId, target?.chainId);
  const { data: listings = [] } = useFractionListings(target?.tokenId);
  const listed = useMemo(
    () => listings
      .filter((l) => l.status === "active" && l.seller_address.toLowerCase() === wallet)
      .reduce((sum, l) => sum + (l.quantity - l.filled_quantity), 0),
    [listings, wallet],
  );
  const held = balance ?? 0;
  const sendable = Math.max(0, held - listed);

  // A fresh sheet for every post opened.
  useEffect(() => {
    setQuery("");
    setResults([]);
    setTo(null);
    setQuantity(1);
  }, [target?.tokenId, target?.chainId]);

  useEffect(() => {
    setQuantity((q) => Math.min(Math.max(1, q), Math.max(1, sendable)));
  }, [sendable]);

  useEffect(() => {
    const q = query.trim().replace(/^@/, "");
    if (to || q.length < 2) { setResults([]); setSearching(false); return; }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      usersSearch(q)
        .then((res: any) => {
          if (!live) return;
          const rows: any[] = res?.data?.result || res?.result || [];
          setResults(
            rows
              .map((u) => ({
                address: String(u.address || "").toLowerCase(),
                username: u.username || undefined,
                displayName: u.displayName || undefined,
                avatarImageUrl: u.avatarImageUrl || undefined,
              }))
              .filter((u) => ADDRESS.test(u.address) && u.address !== wallet)
              .slice(0, 8),
          );
        })
        .catch(() => { if (live) setResults([]); })
        .finally(() => { if (live) setSearching(false); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query, to, wallet]);

  if (!target) return null;
  const busy = gift.isPending;

  const send = async () => {
    if (!to || busy || quantity < 1 || quantity > sendable) return;
    const done = await gift
      .mutateAsync({ tokenId: target.tokenId, chainId: target.chainId, to: to.address, quantity })
      .catch(() => null);
    if (!done) return;
    toastSuccess(t("fractions.giftSent", { count: quantity, name: coAuthorName(to), defaultValue: "Sent {{count}} to {{name}}" }));
    onClose();
  };

  let amount: React.ReactNode = null;
  if (to) {
    if (loadingBalance) amount = <ActivityIndicator color="#A1A1AA" style={styles.loader} />;
    else if (balance === null) amount = <Note warn text={t("fractions.balanceReadFailed")} />;
    else if (sendable === 0) {
      amount = (
        <Note text={held === 0 ? t("fractions.dontHoldAnyOfPost") : t("fractions.giftListedNote", { count: listed, defaultValue: "{{count}} are listed for sale. Cancel the listing to send those." })} />
      );
    } else {
      amount = (
        <>
          <QuantityPicker
            label={t("fractions.giftHowMany", "How many")}
            hint={t("fractions.giftYouOwn", { count: held, total: formatCount(TOTAL_FRACTIONS), defaultValue: "You own {{count}} of {{total}}" })}
            value={quantity}
            max={sendable}
            onChange={setQuantity}
            disabled={busy}
          />
          <View style={styles.presets}>
            {[0.25, 0.5, 1].map((f) => (
              <Pressable
                key={f}
                style={styles.preset}
                disabled={busy}
                onPress={() => setQuantity(Math.max(1, Math.floor(sendable * f)))}
                accessibilityRole="button"
              >
                <Text style={styles.presetText}>{f === 1 ? t("fractions.giftAll", "All") : `${f * 100}%`}</Text>
              </Pressable>
            ))}
          </View>
          {listed > 0 && (
            <Note text={t("fractions.giftListedNote", { count: listed, defaultValue: "{{count}} are listed for sale. Cancel the listing to send those." })} />
          )}
        </>
      );
    }
  }

  return (
    <FractionSheet visible={!!target} onClose={onClose} busy={busy} title={t("fractions.giftTitle", "Send fractions")}>
      {!!target.post.title && <Text style={styles.subtitle} numberOfLines={1}>{target.post.title}</Text>}
      <Text style={styles.hint}>{t("fractions.giftHint", "They go straight from your wallet to theirs.")}</Text>

      <Text style={styles.label}>{t("fractions.giftTo", "To")}</Text>
      {to ? (
        <View style={styles.picked}>
          <PersonRow
            user={to}
            right={(
              <Pressable onPress={() => { setTo(null); setQuery(""); }} disabled={busy} hitSlop={8} accessibilityRole="button" style={styles.change}>
                <Text style={styles.changeText}>{t("fractions.giftChange", "Change")}</Text>
              </Pressable>
            )}
          />
        </View>
      ) : (
        <>
          <View style={styles.search}>
            <Icon name="Search" size={16} color="#A1A1AA" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("fractions.giftSearch", "Search people")}
              accessibilityLabel={t("fractions.giftSearch", "Search people")}
              placeholderTextColor="#8B8D90"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.searchInput}
            />
            {searching && <ActivityIndicator size="small" color="#A1A1AA" />}
          </View>
          {results.map((u) => (
            <PersonRow key={u.address} user={u} onPress={() => setTo(u)} />
          ))}
          {!searching && results.length === 0 && query.trim().replace(/^@/, "").length >= 2 && (
            <Text style={styles.empty}>{t("fractions.giftNoOne", "No one found")}</Text>
          )}
        </>
      )}

      {amount}

      <PrimaryButton
        icon="Send"
        label={
          busy
            ? t("fractions.giftSending", "Sending…")
            : to
              ? t("fractions.giftButton", { count: quantity, name: coAuthorName(to), defaultValue: "Send {{count}} to {{name}}" })
              : t("fractions.giftTitle", "Send fractions")
        }
        onPress={send}
        loading={busy}
        disabled={!to || loadingBalance || sendable < 1 || quantity < 1 || quantity > sendable}
      />
    </FractionSheet>
  );
};

const styles = StyleSheet.create({
  loader: { paddingVertical: 20 },
  subtitle: { color: "#A1A1AA", fontSize: 13, marginTop: -8 },
  hint: { color: "#A1A1AA", fontSize: 13, lineHeight: 18 },
  label: { color: "#A1A1AA", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  searchInput: { flex: 1, color: "#F4F4F5", fontSize: 15, padding: 0, margin: 0 },
  person: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12 },
  personPressed: { backgroundColor: "rgba(255,255,255,0.06)" },
  personText: { flex: 1, minWidth: 0 },
  personName: { color: "#F9FBFF", fontSize: 15, fontWeight: "600" },
  personHandle: { color: "#A6A9AC", fontSize: 13 },
  picked: { borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  change: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.10)" },
  changeText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600", flexShrink: 0 },
  empty: { color: "#A1A1AA", fontSize: 13, paddingHorizontal: 4 },
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
});

export default SendFractionsSheet;
