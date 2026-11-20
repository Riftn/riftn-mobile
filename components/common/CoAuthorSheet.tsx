/**
 * Co-authors of one post, hosted once in App so a menu that closes can open it.
 *
 * The creator searches for someone and invites them, and sees who said yes and
 * who has not answered (either can be taken off). The invited person says yes
 * or no; a co-author can step off. Same rules and copy as the web sheet.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import GlassModal from "../ui/GlassModal";
import PrimaryButton from "../ui/PrimaryButton";
import Icon from "../ui/Icon";
import { useUser } from "../../context/AuthContext";
import { toastError, toastSuccess } from "../../libs";
import { usersSearch } from "../../services/user.service";
import { answerCoAuthorInvite, getCoAuthors, inviteCoAuthor, removeCoAuthor } from "../../services/coAuthors.service";
import { closeCoAuthorSheet, coAuthorName, useCoAuthorSheetRequest, useCoAuthorState, type CoAuthorUser } from "../../libs/coAuthors";
import { CoAuthorFace } from "./CoAuthorBits";

const MAX = 3;

function PersonRow({ user, note, action }: { user: CoAuthorUser; note?: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
      <CoAuthorFace user={user} size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="font-semibold" numberOfLines={1} style={{ color: "#F9FBFF", fontSize: 15 }}>{coAuthorName(user)}</Text>
        <Text numberOfLines={1} style={{ color: "#A6A9AC", fontSize: 13 }}>
          {user.username ? `@${user.username}` : user.address}{note ? ` · ${note}` : ""}
        </Text>
      </View>
      {action}
    </View>
  );
}

function SmallButton({ label, onPress, disabled, neutral }: { label: string; onPress: () => void; disabled?: boolean; neutral?: boolean }) {
  return <PrimaryButton title={label} onPress={onPress} disabled={disabled} neutral={neutral} style={{ minWidth: 84 }} />;
}

export default function CoAuthorSheetHost() {
  const tokenId = useCoAuthorSheetRequest();
  if (!tokenId) return null;
  return <CoAuthorSheet key={tokenId} tokenId={tokenId} />;
}

function CoAuthorSheet({ tokenId }: { tokenId: string }) {
  const { t } = useTranslation();
  const user = useUser() as any;
  const me = String(user?.walletAddress || user?.address || "").toLowerCase();
  const state = useCoAuthorState(tokenId);
  const [loaded, setLoaded] = useState(false);
  const [isCreator, setIsCreator] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CoAuthorUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getCoAuthors(tokenId)
      .then((data) => { if (live) { setIsCreator(!!data?.pendingCoAuthorUsers); setLoaded(true); } })
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [tokenId]);

  useEffect(() => {
    const q = query.trim().replace(/^@/, "");
    if (!isCreator || q.length < 2) { setResults([]); return; }
    let live = true;
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
              .filter((u) => u.address && u.address !== me)
              .slice(0, 8),
          );
        })
        .catch(() => { if (live) setResults([]); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [query, isCreator, me]);

  const onPost = useMemo(() => new Set([...state.users, ...(state.pending || [])].map((u) => u.address)), [state]);
  const seatsLeft = MAX - onPost.size;
  const isCoAuthor = state.users.some((u) => u.address === me);

  const run = async (key: string, work: () => Promise<unknown>, done?: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(key);
    try {
      await work();
      if (done) toastSuccess(done);
      return true;
    } catch (error: any) {
      toastError(error?.message || t("coAuthors.failed", "Couldn't do that. Try again."));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const title = !isCreator && state.invited ? t("coAuthors.answerInvite", "Co-author invite") : t("coAuthors.manage", "Co-authors");
  const hint = isCreator
    ? t("coAuthors.creatorHint", "Make this post together. Once they say yes, it shows on their profile too, with both names.")
    : state.invited
      ? t("coAuthors.inviteHint", "You've been asked to co-author this post. Say yes and it shows on your profile too, with both names.")
      : isCoAuthor
        ? t("coAuthors.coAuthorHint", "You're a co-author on this post. It shows on your profile with both names.")
        : "";

  return (
    <GlassModal visible onClose={closeCoAuthorSheet} presentation="bottom" scrollable maxHeight="80%">
      <View className="items-center pt-3 pb-1">
        <View className="w-10 h-1 rounded-full bg-white/20" />
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 24, gap: 8 }} testID="co-author-sheet">
        <Text className="font-semibold" style={{ color: "#F9FBFF", fontSize: 18 }}>{title}</Text>
        {hint ? <Text style={{ color: "#A6A9AC", fontSize: 14, lineHeight: 20 }}>{hint}</Text> : null}

        {!loaded && <ActivityIndicator style={{ marginVertical: 24 }} color="#A6A9AC" />}

        {loaded && !isCreator && state.invited && (
          <View style={{ flexDirection: "row", gap: 8, paddingTop: 8 }}>
            <PrimaryButton
              title={t("coAuthors.accept", "Accept")}
              disabled={!!busy}
              style={{ flex: 1 }}
              onPress={async () => { if (await run("accept", () => answerCoAuthorInvite(tokenId, true), t("coAuthors.accepted", "You're now a co-author"))) closeCoAuthorSheet(); }}
            />
            <PrimaryButton
              title={t("coAuthors.decline", "Decline")}
              neutral
              disabled={!!busy}
              style={{ flex: 1 }}
              onPress={async () => { if (await run("decline", () => answerCoAuthorInvite(tokenId, false))) closeCoAuthorSheet(); }}
            />
          </View>
        )}

        {loaded && isCreator && (
          seatsLeft > 0 ? (
            <View className="bg-theme-neutrals-800 rounded-xl px-3 py-2 flex-row items-center gap-2" style={{ marginTop: 4 }}>
              <Icon name="Search" size={16} color="#A1A1AA" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t("coAuthors.searchPlaceholder", "Search people to invite")}
                accessibilityLabel={t("coAuthors.searchPlaceholder", "Search people to invite")}
                placeholderTextColor="#8B8D90"
                autoCapitalize="none"
                autoCorrect={false}
                className="flex-1 text-theme-neutrals-100 text-sm p-0 m-0"
              />
            </View>
          ) : (
            <Text style={{ color: "#A6A9AC", fontSize: 14 }}>{t("coAuthors.full", { count: MAX, defaultValue: "A post can have up to {{count}} co-authors." })}</Text>
          )
        )}

        {loaded && isCreator && results.map((u) => (
          <PersonRow
            key={u.address}
            user={u}
            action={onPost.has(u.address)
              ? <Text style={{ color: "#A6A9AC", fontSize: 13 }}>{t("coAuthors.alreadyOn", "On this post")}</Text>
              : (
                <SmallButton
                  label={t("coAuthors.inviteButton", "Invite")}
                  disabled={!!busy}
                  onPress={() => run(`invite:${u.address}`, async () => {
                    await inviteCoAuthor(tokenId, u.username || u.address);
                    setQuery("");
                  }, t("coAuthors.invited", { name: coAuthorName(u), defaultValue: "Invite sent to {{name}}" }))}
                />
              )}
          />
        ))}

        {loaded && (state.users.length > 0 || (isCreator && (state.pending?.length ?? 0) > 0)) && (
          <View style={{ paddingTop: 8 }}>
            <Text style={{ color: "#A6A9AC", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 12, paddingBottom: 4 }}>
              {t("coAuthors.alreadyOn", "On this post")}
            </Text>
            {state.users.map((u) => (
              <PersonRow
                key={u.address}
                user={u}
                action={(isCreator || u.address === me) ? (
                  <SmallButton
                    neutral
                    label={u.address === me ? t("coAuthors.leave", "Remove me") : t("coAuthors.remove", "Remove")}
                    disabled={!!busy}
                    onPress={async () => {
                      const ok = await run(`remove:${u.address}`, () => removeCoAuthor(tokenId, u.address));
                      if (ok && u.address === me) closeCoAuthorSheet();
                    }}
                  />
                ) : undefined}
              />
            ))}
            {isCreator && (state.pending || []).map((u) => (
              <PersonRow
                key={u.address}
                user={u}
                note={t("coAuthors.waiting", "Invited")}
                action={<SmallButton neutral label={t("coAuthors.cancelInvite", "Cancel")} disabled={!!busy} onPress={() => run(`cancel:${u.address}`, () => removeCoAuthor(tokenId, u.address))} />}
              />
            ))}
          </View>
        )}

        {loaded && !isCreator && !state.invited && !isCoAuthor && (
          <Text style={{ color: "#A6A9AC", fontSize: 14 }}>{t("coAuthors.nothing", "Nothing to do here.")}</Text>
        )}
      </View>
    </GlassModal>
  );
}

/** The ask on a post you were invited onto, with yes and no. */
export function CoAuthorInviteCard({ tokenId, invited, creatorName }: { tokenId: string | number; invited: boolean; creatorName?: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  if (!invited) return null;
  const answer = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await answerCoAuthorInvite(tokenId, accept);
      if (accept) toastSuccess(t("coAuthors.accepted", "You're now a co-author"));
    } catch (error: any) {
      toastError(error?.message || t("coAuthors.failed", "Couldn't do that. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      testID="co-author-invite"
      style={{ marginHorizontal: 12, marginVertical: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: "hsla(0,0%,50%,0.28)", backgroundColor: "hsla(0,0%,50%,0.08)", gap: 10 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Icon name="UserPlus" size={20} color="#F9FBFF" />
        <Text style={{ color: "#F9FBFF", fontSize: 14, flex: 1, lineHeight: 20 }}>
          {creatorName
            ? t("coAuthors.bannerNamed", { name: creatorName, defaultValue: "{{name}} invited you to co-author this post." })
            : t("coAuthors.banner", "You were invited to co-author this post.")}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <PrimaryButton title={t("coAuthors.accept", "Accept")} disabled={busy} style={{ flex: 1 }} onPress={() => answer(true)} />
        <PrimaryButton title={t("coAuthors.decline", "Decline")} neutral disabled={busy} style={{ flex: 1 }} onPress={() => answer(false)} />
      </View>
    </View>
  );
}

