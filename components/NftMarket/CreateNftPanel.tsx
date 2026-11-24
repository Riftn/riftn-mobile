/**
 * The NFT market's own Create tab. It opens on your NFTs as market tiles with
 * "New NFT" first; that opens one screen where the art is shown as the tile
 * buyers will see, and copies, resale earnings and the chain sit under it with
 * one button to mint. What is made here is an NFT, not a post: it never shows
 * in feeds.
 *
 * Published off-chain first (nftOnly), then minted with the creator's copies
 * and royalties, so a mint that fails is finished later from its tile without
 * uploading again. Port of web's CreateNftPanel.
 */
import React, { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator, Image as RNImage, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { LinearGradient } from "expo-linear-gradient";
import Icon from "../ui/Icon";
import { KitButton, PageEmpty, useKitColors } from "../page/PageKit";
import NftTile, { NftArt } from "./NftTile";
import { describeCost } from "../common/MintChainSheet";
import { useMintExistingPost } from "../../hooks/useMintExistingPost";
import { useWalletAddress } from "../../hooks/useCommunityAdmin";
import { getMintFee, minNft, type MintFeeQuoteResponse } from "../../services/nft.service";
import { collect, type Creation } from "../../services/collect.service";
import { MARKET_CHAINS, type NftTarget } from "../../services/nft-market.service";
import { chainIcons, supportedChainIdsForMinting } from "../../config/constants";
import { TIP_CHAIN_NAMES } from "../../libs/tip-funding";
import { getAuthMethod } from "../../libs/auth.utils";
import { getDefaultChainId } from "../../libs/defaultChain";
import { KeepDarkScope } from "../../libs/jsx/tone";
import { formatCount } from "../../libs/format-count";
import { toastError, toastSuccess } from "../../libs/toast";

const MAX_ART_BYTES = 42 * 1024 * 1024;
const MAX_SUPPLY = 1_000_000_000;
const MAX_ROYALTY_BPS = 1000;
const COPY_CHOICES = [1, 10, 100, 1000];
const EARN_CHOICES = [0, 250, 500, 1000];
const CHAIN_DOT: Record<number, string> = { 56: "#F0B90B", 8453: "#0052FF", 1: "#8A92B2", 4663: "#CCFF00" };
const CHAINS = (supportedChainIdsForMinting as number[]).filter((c) => (MARKET_CHAINS as readonly number[]).includes(c));
const pctLabel = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

interface Props {
  onOpen: (target: NftTarget) => void;
  onSignIn: () => void;
  /** Bottom padding so the last row clears the tab bar. */
  bottomInset?: number;
  /** Override for previews. */
  preview?: { creations: Creation[]; making?: boolean; art?: string; quotes?: Record<number, MintFeeQuoteResponse> };
}

interface Art { uri: string; name: string; mimeType: string }

function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  const c = useKitColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {/* The inner view keeps theme material separate from the pressable, as in PageTabs. */}
      <View style={[styles.chip, { backgroundColor: on ? c.activeBg : c.chipBg, borderWidth: c.isMinimal && !on ? 1 : 0, borderColor: c.hairline }]}>
        <Text style={[styles.chipText, { color: on ? c.activeInk : c.chipInk }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

export default function CreateNftPanel({ onOpen, onSignIn, bottomInset = 120, preview }: Props) {
  const { t } = useTranslation();
  const kit = useKitColors();
  const { width } = useWindowDimensions();
  const tileSize = Math.floor((width - 32 - 16) / 3);
  const me = useWalletAddress()?.toLowerCase() ?? null;
  const queryClient = useQueryClient();
  const { mint, isMinting } = useMintExistingPost();

  const defaultChain = CHAINS.includes(getDefaultChainId()) ? getDefaultChainId() : CHAINS[0];
  const [making, setMaking] = useState(!!preview?.making);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [art, setArt] = useState<Art | null>(null);
  const [artUri, setArtUri] = useState<string | null>(preview?.art ?? null);
  const [name, setName] = useState(preview?.making ? "Neon harbour" : "");
  const [description, setDescription] = useState("");
  const [supply, setSupply] = useState(1);
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [earnBps, setEarnBps] = useState(500);
  const [chainId, setChainId] = useState<number>(defaultChain);
  const [uploading, setUploading] = useState(false);
  const [sponsored, setSponsored] = useState(!!preview);

  useEffect(() => {
    if (preview) return;
    getAuthMethod().then(({ method }) => setSponsored(method === "local")).catch(() => {});
  }, [preview]);

  const creations = useQuery({
    queryKey: ["nft-creations", me],
    queryFn: () => collect.creations(),
    enabled: !preview && !!me,
    staleTime: 15_000,
    refetchInterval: (q) => ((q.state.data as { items: Creation[] } | undefined)?.items.some((c) => c.minting) ? 10_000 : false),
  });
  const items = preview?.creations ?? creations.data?.items ?? [];

  const quotes = useQueries({
    queries: CHAINS.map((id) => ({
      queryKey: ["mint-fee", id],
      queryFn: () => getMintFee(id),
      enabled: making && !preview,
      staleTime: 55_000,
      refetchInterval: making && !preview ? 60_000 : (false as const),
    })),
  });
  const costOf = (id: number) => {
    const q = preview?.quotes?.[id] ?? quotes[CHAINS.indexOf(id)]?.data;
    return q ? describeCost(q, sponsored, t) : null;
  };

  const busy = uploading || isMinting;
  const typed = Number(otherText);
  const copies = otherOpen ? (Number.isInteger(typed) && typed >= 1 && typed <= MAX_SUPPLY ? typed : null) : supply;
  const ready = !!copies && earnBps <= MAX_ROYALTY_BPS && (pendingId != null || ((!!art || !!preview) && name.trim().length > 0));
  const chainName = TIP_CHAIN_NAMES[chainId] ?? "";
  const cost = costOf(chainId);
  const copiesText = copies === 1
    ? t("collect.oneOfOne", { defaultValue: "1 of 1" })
    : t("collect.copiesPill", { copies: formatCount(copies ?? 0), defaultValue: "{{copies}} copies" });

  const reset = () => {
    setArt(null);
    setArtUri(null);
    setName("");
    setDescription("");
    setSupply(1);
    setOtherOpen(false);
    setOtherText("");
    setEarnBps(500);
    setPendingId(null);
  };

  const startNew = () => {
    if (!me && !preview) { onSignIn(); return; }
    reset();
    setChainId(defaultChain);
    setMaking(true);
  };

  const finish = (c: Creation) => {
    reset();
    setPendingId(c.tokenId);
    setName(c.name);
    setArtUri(c.image);
    setChainId(CHAINS.includes(c.chainId) ? c.chainId : defaultChain);
    setMaking(true);
  };

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1, allowsEditing: false });
    const a = res.canceled ? null : res.assets?.[0];
    if (!a) return;
    if ((a.fileSize ?? 0) > MAX_ART_BYTES) {
      toastError(t("nftCreate.tooBig", { defaultValue: "That file is over 42 MB" }));
      return;
    }
    const mimeType = a.mimeType || "image/jpeg";
    setArt({ uri: a.uri, name: a.fileName || `nft.${mimeType.split("/")[1] || "jpg"}`, mimeType });
    setArtUri(a.uri);
  };

  const confirm = async () => {
    if (!ready || busy || !copies || preview) return;
    const edition = { supply: copies, royalties: me && earnBps > 0 ? [{ address: me, bps: earnBps }] : [] };
    let tokenId = pendingId;
    try {
      if (tokenId == null) {
        if (!art || !me) return;
        setUploading(true);
        const fd = new FormData();
        fd.append("idempotencyKey", Crypto.randomUUID());
        fd.append("name", name.trim());
        fd.append("description", description.trim());
        fd.append("chainId", String(chainId));
        fd.append("category", "[]");
        fd.append("postType", "feed-images");
        // @ts-ignore RN FormData file shape
        fd.append("feed-images", { uri: art.uri, name: art.name, type: art.mimeType } as any);
        fd.append("streamInfo", "{}");
        fd.append("plans", "[]");
        fd.append("address", me);
        fd.append("mintOptOut", "true");
        fd.append("nftOnly", "true");
        const res = await minNft(fd);
        tokenId = Number(res?.createdTokenId);
        setUploading(false);
        if (!Number.isFinite(tokenId) || tokenId <= 0) throw new Error(res?.msg || t("nftCreate.failed", { defaultValue: "Could not create the NFT" }));
        // From here the upload is safe: a failed mint is finished from its tile.
        setPendingId(tokenId);
        void queryClient.invalidateQueries({ queryKey: ["nft-creations", me] });
      }
      const ok = await mint(tokenId, chainId, chainId, edition);
      if (ok) {
        reset();
        setMaking(false);
        toastSuccess(t("nftCreate.minted", { defaultValue: "NFT minted. It shows on the market in a minute." }));
      }
    } catch (e) {
      setUploading(false);
      toastError((e as Error)?.message || t("nftCreate.failed", { defaultValue: "Could not create the NFT" }));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["nft-creations", me] });
      void queryClient.invalidateQueries({ queryKey: ["nft-market"] });
    }
  };

  if (!me && !preview) {
    return (
      <PageEmpty
        icon="nfts"
        title={t("nftCreate.signIn", { defaultValue: "Sign in to create an NFT" })}
        action={<KitButton label={t("nftMarket.signIn", { defaultValue: "Sign in" })} onPress={onSignIn} />}
      />
    );
  }

  if (!making) {
    return (
      <ScrollView contentContainerStyle={[styles.wrap, { paddingBottom: bottomInset }]} testID="nft-create">
        <View style={styles.grid}>
          <Pressable
            onPress={startNew}
            accessibilityRole="button"
            testID="nft-create-new"
            style={({ pressed }) => [styles.newTile, { width: tileSize, height: tileSize, backgroundColor: kit.card, borderColor: kit.hairline, opacity: pressed ? 0.85 : 1 }, kit.cardMaterial]}
          >
            <View style={styles.plus}><Icon name="Plus" size={20} color="#FFFFFF" /></View>
            <Text style={styles.newText}>{t("nftCreate.newNft", { defaultValue: "New NFT" })}</Text>
          </Pressable>
          {creations.isLoading && !preview
            ? [0, 1, 2, 3, 4].map((i) => <View key={i} style={[styles.skeleton, { width: tileSize, height: tileSize }]} />)
            : items.map((c) => (
              <View key={c.tokenId} style={{ width: tileSize }}>
                <NftTile
                  compact
                  artWidth={tileSize}
                  name={c.name}
                  image={c.image}
                  chainId={c.chainId}
                  priceLabel={
                    c.minted
                      ? (c.supply === 1 ? t("collect.oneOfOne", { defaultValue: "1 of 1" }) : t("collect.copiesPill", { copies: formatCount(c.supply), defaultValue: "{{copies}} copies" }))
                      : c.minting ? t("nftCreate.minting", { defaultValue: "Minting…" }) : t("nftCreate.finish", { defaultValue: "Finish minting" })
                  }
                  dimmed={c.minting}
                  onPress={() => {
                    if (c.minted && c.contract) onOpen({ chainId: c.chainId, contract: c.contract, tokenId: String(c.tokenId), standard: "erc1155", name: c.name, image: c.image });
                    else if (!c.minting && !busy) finish(c);
                  }}
                />
              </View>
            ))}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.wrap, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled" testID="nft-create-making">
      <Pressable onPress={() => { if (!busy) { reset(); setMaking(false); } }} hitSlop={8} style={styles.back} accessibilityRole="button">
        <Icon name="ChevronLeft" size={16} color="rgba(255,255,255,0.7)" />
        <Text style={styles.backText}>{t("nftCreate.yours", { defaultValue: "Your NFTs" })}</Text>
      </Pressable>

      <Pressable onPress={pick} disabled={busy || pendingId != null} style={styles.tile} accessibilityRole="button" accessibilityLabel={t("nftCreate.pickArt", { defaultValue: "Pick the art" })}>
        <KeepDarkScope>
          <View style={StyleSheet.absoluteFill}>
            {artUri ? <NftArt uri={artUri} style={StyleSheet.absoluteFill} /> : (
              <View style={styles.addArt}>
                <Icon name="ImagePlus" size={28} color="rgba(255,255,255,0.6)" />
                <Text style={styles.addArtText}>{t("nftCreate.addArt", { defaultValue: "Add a picture or GIF" })}</Text>
                <Text style={styles.addArtHint}>{t("nftCreate.pickArtHint", { defaultValue: "Picture or GIF, 42 MB max" })}</Text>
              </View>
            )}
            <View style={[styles.dot, { backgroundColor: CHAIN_DOT[chainId] ?? "#FFFFFF" }]} />
            <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.82)"]} style={styles.overlay} pointerEvents="none">
              <Text numberOfLines={1} style={styles.overlayName}>{name.trim() || t("nftCreate.untitled", { defaultValue: "Untitled" })}</Text>
              <Text numberOfLines={1} style={styles.overlayMeta}>
                {copies ? copiesText : "-"}
                {earnBps > 0 ? ` · ${t("nftCreate.tileEarn", { pct: pctLabel(earnBps), defaultValue: "{{pct}} to you on resales" })}` : ""}
              </Text>
            </LinearGradient>
          </View>
        </KeepDarkScope>
      </Pressable>

      {pendingId != null ? null : (
        <>
          <View style={styles.field}>
            <Text style={styles.label}>{t("nftCreate.name", { defaultValue: "Title" })}</Text>
            <TextInput
              value={name}
              onChangeText={(v) => setName(v.slice(0, 120))}
              editable={!busy}
              placeholder={t("nftCreate.namePlaceholder", { defaultValue: "Name your NFT" })}
              placeholderTextColor="rgba(255,255,255,0.35)"
              style={[styles.input, { borderColor: kit.hairline }]}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t("nftCreate.description", { defaultValue: "Description (optional)" })}</Text>
            <TextInput
              value={description}
              onChangeText={(v) => setDescription(v.slice(0, 2000))}
              editable={!busy}
              multiline
              style={[styles.input, { minHeight: 64, textAlignVertical: "top", borderColor: kit.hairline }]}
            />
          </View>
        </>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>{t("collect.copiesLabel", { defaultValue: "How many copies" })}</Text>
        <View style={styles.chips}>
          {COPY_CHOICES.map((n) => (
            <Chip key={n} label={n === 1 ? t("collect.oneOfOne", { defaultValue: "1 of 1" }) : formatCount(n)} on={!otherOpen && supply === n} disabled={busy} onPress={() => { setOtherOpen(false); setSupply(n); }} />
          ))}
          <Chip label={t("nftCreate.otherCopies", { defaultValue: "Other" })} on={otherOpen} disabled={busy} onPress={() => setOtherOpen(true)} />
        </View>
        {otherOpen ? (
          <TextInput
            autoFocus
            keyboardType="number-pad"
            value={otherText}
            onChangeText={(v) => setOtherText(v.replace(/[^\d]/g, "").slice(0, 10))}
            editable={!busy}
            placeholder={t("nftCreate.otherPlaceholder", { defaultValue: "Any number, like 250 or 50000" })}
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[styles.input, { marginTop: 8, borderColor: kit.hairline }]}
          />
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("collect.yourRoyalty", { defaultValue: "You earn on every resale" })}</Text>
        <View style={styles.chips}>
          {EARN_CHOICES.map((bps) => (
            <Chip key={bps} label={bps === 0 ? t("collect.noRoyalty", { defaultValue: "Nothing" }) : pctLabel(bps)} on={earnBps === bps} disabled={busy} onPress={() => setEarnBps(bps)} />
          ))}
        </View>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t("nftCreate.chain", { defaultValue: "Chain" })}</Text>
        <View style={{ gap: 8 }} accessibilityRole="radiogroup">
          {CHAINS.map((id, i) => {
            const on = id === chainId;
            const q = quotes[i];
            const rowCost = costOf(id);
            return (
              <Pressable
                key={id}
                onPress={() => !busy && setChainId(id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                style={[styles.chainRow, { borderColor: on ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.10)", backgroundColor: on ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)" }]}
              >
                <RNImage source={chainIcons[id]} style={styles.chainIcon} />
                <Text style={styles.chainName} numberOfLines={1}>{TIP_CHAIN_NAMES[id] ?? String(id)}</Text>
                <View style={{ alignItems: "flex-end" }}>
                  {q?.isLoading && !preview ? (
                    <View style={styles.costSkeleton} />
                  ) : rowCost ? (
                    <>
                      <Text style={styles.costPrimary}>{rowCost.primary}</Text>
                      <Text style={styles.costSecondary}>{rowCost.secondary}</Text>
                    </>
                  ) : (
                    <Text style={styles.costSecondary}>{t("mintChain.priceUnavailable", { defaultValue: "Price unavailable" })}</Text>
                  )}
                </View>
                <View style={{ width: 20, alignItems: "center" }}>{on ? <Icon name="Check" size={18} color="#FFFFFF" /> : null}</View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <KitButton
        label={busy ? t("nftCreate.minting", { defaultValue: "Minting…" }) : cost
          ? t("mintChain.confirmWithCost", { defaultValue: "Mint on {{chain}} · {{cost}}", chain: chainName, cost: cost.primary })
          : t("mintChain.confirm", { defaultValue: "Mint on {{chain}}", chain: chainName })}
        icon={busy ? <ActivityIndicator size="small" color="#0B0B0C" /> : undefined}
        disabled={!ready || busy}
        onPress={() => void confirm()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  newTile: { borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  plus: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  newText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  skeleton: { borderRadius: 12, backgroundColor: "rgba(255,255,255,0.05)" },
  back: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginBottom: -4 },
  backText: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "500" },
  tile: { width: "100%", aspectRatio: 1, borderRadius: 12, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.05)" },
  addArt: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  addArtText: { color: "rgba(255,255,255,0.7)", fontSize: 13 },
  addArtHint: { color: "rgba(255,255,255,0.45)", fontSize: 11 },
  dot: { position: "absolute", left: 10, top: 10, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: "rgba(0,0,0,0.4)" },
  overlay: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 40, paddingBottom: 10, gap: 2 },
  overlayName: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  overlayMeta: { color: "rgba(255,255,255,0.75)", fontSize: 12 },
  field: { gap: 6 },
  label: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "500" },
  input: { color: "#FFFFFF", fontSize: 15, borderRadius: 10, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 12, paddingVertical: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  chipText: { fontSize: 13, fontWeight: "600" },
  chainRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  chainIcon: { width: 28, height: 28, borderRadius: 8 },
  chainName: { flex: 1, color: "#FFFFFF", fontSize: 14, fontWeight: "500" },
  costPrimary: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  costSecondary: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
  costSkeleton: { height: 14, width: 64, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.1)" },
});
