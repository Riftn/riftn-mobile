/**
 * The NFT market's own Create tab. What is made here is an NFT, not a post:
 * art, a title, how many copies and who earns on resales. It never shows in
 * feeds; it trades on the market. Owner extras and auctions live on its sheet.
 *
 * Published off-chain first (nftOnly), then minted with the creator's copies
 * and royalties, so a mint that fails is finished later from "Your NFTs"
 * without uploading again. Port of web's CreateNftPanel.
 */
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { Image } from "expo-image";
import Icon from "../ui/Icon";
import { PageEmpty } from "../page/PageKit";
import { NftArt } from "./NftTile";
import MintChainSheet from "../common/MintChainSheet";
import { useMintExistingPost } from "../../hooks/useMintExistingPost";
import { useWalletAddress } from "../../hooks/useCommunityAdmin";
import { minNft, type EditionChoice } from "../../services/nft.service";
import { collect, type Creation } from "../../services/collect.service";
import { CHAIN_LABEL, MARKET_CHAINS, type NftTarget } from "../../services/nft-market.service";
import { formatCount } from "../../libs/format-count";
import { toastError, toastSuccess } from "../../libs/toast";

const MAX_ART_BYTES = 42 * 1024 * 1024;
const bpsLabel = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

interface Props {
  onOpen: (target: NftTarget) => void;
  onSignIn: () => void;
  /** Bottom padding so the last row clears the tab bar. */
  bottomInset?: number;
  /** Override for previews. */
  preview?: { creations: Creation[] };
}

interface Art { uri: string; name: string; mimeType: string }

export default function CreateNftPanel({ onOpen, onSignIn, bottomInset = 120, preview }: Props) {
  const { t } = useTranslation();
  const me = useWalletAddress()?.toLowerCase() ?? null;
  const queryClient = useQueryClient();
  const { mint, isMinting } = useMintExistingPost();
  const [art, setArt] = useState<Art | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sheet, setSheet] = useState<{ tokenId: number | null; chainId?: number } | null>(null);
  const [uploading, setUploading] = useState(false);

  const creations = useQuery({
    queryKey: ["nft-creations", me],
    queryFn: () => collect.creations(),
    enabled: !preview && !!me,
    staleTime: 15_000,
    refetchInterval: (q) => ((q.state.data as { items: Creation[] } | undefined)?.items.some((c) => c.minting) ? 10_000 : false),
  });
  const items = preview?.creations ?? creations.data?.items ?? [];
  const busy = uploading || isMinting;
  const ready = !!art && name.trim().length > 0;

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
  };

  const confirm = async (chainId: number, edition: EditionChoice) => {
    if (!sheet || busy) return;
    let tokenId = sheet.tokenId;
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
        // From here the upload is safe: a failed mint is finished from "Your NFTs".
        setArt(null);
        setName("");
        setDescription("");
        setSheet({ tokenId, chainId });
        void queryClient.invalidateQueries({ queryKey: ["nft-creations", me] });
      }
      const ok = await mint(tokenId, chainId, chainId, edition);
      if (ok) {
        setSheet(null);
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
        action={
          <Pressable onPress={onSignIn} style={styles.primary} accessibilityRole="button">
            <Text style={styles.primaryText}>{t("nftMarket.signInToTradeCta", { defaultValue: "Sign in to trade" })}</Text>
          </Pressable>
        }
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.wrap, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled" testID="nft-create">
      <View style={styles.card}>
        <Text style={styles.eyebrow}>{t("nftCreate.eyebrow", { defaultValue: "Create" })}</Text>
        <Text style={styles.title}>{t("nftCreate.title", { defaultValue: "Make an NFT" })}</Text>
        <Text style={styles.muted}>
          {t("nftCreate.intro", { defaultValue: "An NFT is not a post. It lives here on the market: choose how many copies, who earns on resales, and extras only owners can open." })}
        </Text>
        <Pressable onPress={pick} disabled={busy} style={styles.artBox} accessibilityRole="button" accessibilityLabel={t("nftCreate.pickArt", { defaultValue: "Pick the art" })}>
          {art ? (
            <>
              <Image source={{ uri: art.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
              <Pressable onPress={() => setArt(null)} hitSlop={8} style={styles.removeArt} accessibilityRole="button" accessibilityLabel={t("nftCreate.removeArt", { defaultValue: "Remove" })}>
                <Icon name="X" size={16} color="#FFFFFF" />
              </Pressable>
            </>
          ) : (
            <View style={{ alignItems: "center", gap: 8 }}>
              <Icon name="ImagePlus" size={28} color="rgba(255,255,255,0.8)" />
              <Text style={styles.muted}>{t("nftCreate.pickArtHint", { defaultValue: "Picture or GIF, 42 MB max" })}</Text>
            </View>
          )}
        </Pressable>
        <Text style={styles.label}>{t("nftCreate.name", { defaultValue: "Title" })}</Text>
        <TextInput
          value={name}
          onChangeText={(v) => setName(v.slice(0, 120))}
          editable={!busy}
          placeholder={t("nftCreate.namePlaceholder", { defaultValue: "Name your NFT" })}
          placeholderTextColor="rgba(255,255,255,0.3)"
          style={styles.input}
        />
        <Text style={styles.label}>{t("nftCreate.description", { defaultValue: "Description (optional)" })}</Text>
        <TextInput
          value={description}
          onChangeText={(v) => setDescription(v.slice(0, 2000))}
          editable={!busy}
          multiline
          style={[styles.input, { minHeight: 72, textAlignVertical: "top" }]}
        />
        <Pressable
          onPress={() => setSheet({ tokenId: null })}
          disabled={!ready || busy}
          style={[styles.primary, (!ready || busy) && { opacity: 0.5 }]}
          accessibilityRole="button"
        >
          {busy ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.primaryText}>{t("nftCreate.next", { defaultValue: "Choose copies and mint" })}</Text>}
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>{t("nftCreate.yours", { defaultValue: "Your NFTs" })}</Text>
        {creations.isLoading && !preview ? (
          <ActivityIndicator color="#fff" style={{ paddingVertical: 16 }} />
        ) : items.length ? (
          <View style={styles.grid}>
            {items.map((c) => (
              <View key={c.tokenId} style={styles.cell}>
                <Pressable
                  disabled={!c.minted || !c.contract}
                  onPress={() => c.contract && onOpen({ chainId: c.chainId, contract: c.contract, tokenId: String(c.tokenId), standard: "erc1155", name: c.name, image: c.image })}
                  accessibilityRole="button"
                >
                  <NftArt uri={c.image} style={styles.art} />
                </Pressable>
                <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {c.supply === 1 ? t("collect.oneOfOne", { defaultValue: "1 of 1" }) : t("collect.copiesPill", { copies: formatCount(c.supply), defaultValue: "{{copies}} copies" })}
                  {c.royaltyBps > 0 ? ` · ${bpsLabel(c.royaltyBps)}` : ""}
                  {` · ${CHAIN_LABEL[c.chainId] ?? ""}`}
                </Text>
                {c.minted ? null : c.minting ? (
                  <Text style={styles.meta}>{t("nftCreate.minting", { defaultValue: "Minting…" })}</Text>
                ) : (
                  <Pressable onPress={() => setSheet({ tokenId: c.tokenId, chainId: c.chainId })} disabled={busy} style={styles.chip} accessibilityRole="button">
                    <Text style={styles.chipText}>{t("nftCreate.finish", { defaultValue: "Finish minting" })}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        ) : (
          <Text style={[styles.muted, { textAlign: "center", paddingVertical: 12 }]}>{t("nftCreate.none", { defaultValue: "Nothing yet. Your NFTs show up here." })}</Text>
        )}
      </View>

      <MintChainSheet
        visible={!!sheet}
        onClose={() => { if (!busy) setSheet(null); }}
        defaultChainId={sheet?.chainId}
        isMinting={busy}
        onConfirm={(chainId, edition) => void confirm(chainId, edition)}
        editionOpen
        hideAllowance
        onlyChains={MARKET_CHAINS as readonly number[]}
        title={t("nftCreate.sheetTitle", { defaultValue: "Mint NFT" })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  card: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
  eyebrow: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "600", letterSpacing: 1.5 },
  title: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" },
  muted: { color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 18 },
  label: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  artBox: { aspectRatio: 1, width: "100%", borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(255,255,255,0.2)", backgroundColor: "rgba(0,0,0,0.3)", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  removeArt: { position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  input: { color: "#FFFFFF", fontSize: 14, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(0,0,0,0.3)", paddingHorizontal: 12, paddingVertical: 10 },
  primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, alignSelf: "flex-start", paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: "#FFFFFF", marginTop: 4 },
  primaryText: { color: "#000000", fontSize: 14, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  cell: { width: "47%", gap: 4 },
  art: { width: "100%", aspectRatio: 1, borderRadius: 12 },
  name: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  meta: { color: "rgba(255,255,255,0.5)", fontSize: 12 },
  chip: { alignSelf: "flex-start", paddingHorizontal: 12, height: 30, justifyContent: "center", borderRadius: 15, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  chipText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
});
