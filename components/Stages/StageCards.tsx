/**
 * Stage cards — one shape per state, shared by every stage surface
 * ================================================================
 * The three cards the Stages screen is built from, plus the reminder bell they
 * share. Ported from dehubweb's StagesPage / PastStageCard so a stage reads the
 * same on both platforms.
 *
 * The thing that changed from the old bottom-sheet versions: **the cover
 * graphic leads the card**. It used to be a cropped fill *behind* the text
 * under a black gradient — so a host's artwork was cut off and dimmed at the
 * same time — and an ended stage had no artwork at all, which is why recorded
 * stages were an anonymous list of rows. Covers now go through StageCoverArt:
 * a thumbnail for live rooms and the full 16:9 cover for upcoming and recorded stages.
 *
 * @module components/Stages/StageCards
 */

import { countdownParts, useMinuteTick } from "../../libs/countdown";
import React, { useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { shareWithRef } from "../../libs/shareRef";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";

import Avatar from "../common/Avatar";
import Icon from "../ui/Icon";
import StageCoverArt from "./StageCoverArt";
import StageRecordingPlayer from "./StageRecordingPlayer";
import StageRecordingLanguage from './StageRecordingLanguage';
import { storedAvatarSources } from "../../libs/misc";
import { radius } from "../../theme/radius";
import { ShareLinks } from "../../navigation/linking.config";
import { useStageReminder, useStageReminderFaces } from "../../hooks/useStageReminder";
import { addStageToCalendar } from "../../libs/stage-calendar";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import type { AudioSpace } from "../../hooks/useStages";
import { appLocale } from "../../libs/date.util";
import { useAppTheme } from "../../context/ThemeContext";
import { MINIMAL_HAIRLINE, MINIMAL_INSET, MINIMAL_WASH } from "../../theme/minimal";
import { KitButton, PageSection } from "../page/PageKit";
import { ScreenNames } from "../../navigation/ScreenNames";
import { translateCopy as _translateCopy } from "../../i18n/copy";

import { formatCount } from '../../libs/format-count';
import { isRadioShow } from '../../libs/stage-radio-show';
import { supabase } from '../../services/supabase';
/** How long the stage ran, from its own timestamps. Mirrors web's row. */
export function stageDuration(space: AudioSpace): string | null {
  if (!space.started_at || !space.ended_at) return null;
  const secs = Math.round(
    (new Date(space.ended_at).getTime() - new Date(space.started_at).getTime()) / 1000,
  );
  if (secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Dates go through the device's own formatter rather than a translated
 * template: every locale this app ships already knows how to write a date, and
 * a hand-built one would need a new key per shape in all 110 of them.
 */
export function formatStageDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    return new Date(dateStr).toLocaleDateString(appLocale(), {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatScheduledFor(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const day = d.toLocaleDateString(appLocale(), {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const time = d.toLocaleTimeString(appLocale(), { hour: "numeric", minute: "2-digit" });
    return `${day} · ${time}`;
  } catch {
    return "";
  }
}

export const shareStage = (space: AudioSpace, when?: string) => {
  const headline = when
    ? _translateCopy("copy.cc68579c7d58", { defaultValue: "🎙️ {{value1}} — live on Stages {{value2}}", value1: space.title, value2: when })
    : _translateCopy("copy.775b9e99d10c", { defaultValue: "🎙️ {{value1}} — live on Stages", value1: space.title });
  shareWithRef({
    message: `${headline}\n\n${ShareLinks.stage(space)}`,
  }, undefined, "stage").catch(() => {});
};

const hostHandle = (space: AudioSpace, fallback: string) =>
  space.host_username ||
  (space.host_wallet_address ? `${space.host_wallet_address.slice(0, 6)}…` : fallback);

/**
 * "Remind me" on an announced stage.
 *
 * Its own component because `useStageReminder` is a hook and each card watches
 * its own row — one query per visible announcement, which at the volume this
 * feature sees is a handful. Signed-out users get nothing rather than a control
 * that would fail: the row is keyed by wallet.
 */
export const StageReminderBell: React.FC<{ spaceId: string }> = ({ spaceId }) => {
  const { t } = useTranslation();
  const { isMinimal } = useAppTheme();
  const { hasReminder, canRemind, toggleReminder, isToggling } = useStageReminder(spaceId);
  if (!canRemind) return null;
  const label = hasReminder ? t("stages.removeReminder") : t("stages.remindMe");
  return (
    <TouchableOpacity
      onPress={toggleReminder}
      disabled={isToggling}
      hitSlop={8}
      style={[styles.iconBtn, isMinimal && m.outline]}
      accessibilityRole="button"
      accessibilityState={{ selected: hasReminder, disabled: isToggling }}
      accessibilityLabel={label}
    >
      <Icon
        name={hasReminder ? "BellRing" : "Bell"}
        size={15}
        color={hasReminder ? "#FAFAFA" : "rgba(255,255,255,0.6)"}
      />
    </TouchableOpacity>
  );
};

/**
 * Who said they're coming: a facepile of the people holding a reminder plus
 * the total, the same row web shows under a stage. Each face opens that
 * person's profile; the press stays on the face, so on the live card it
 * never also opens the room. Renders nothing when nobody has reminded.
 */
export const StageReminderFaces: React.FC<{ spaceId: string }> = ({ spaceId }) => {
  const { t } = useTranslation();
  const { showUserProfile } = useUserProfileSheet();
  const { faces, total } = useStageReminderFaces(spaceId);
  if (total === 0) return null;
  const hidden = Math.max(0, total - faces.length);
  return (
    <View style={styles.facesRow}>
      {faces.length > 0 && (
        <View style={styles.faces}>
          {faces.map((face, i) => (
            <TouchableOpacity
              key={face.address}
              // By address: it cannot drift the way a username can.
              onPress={() => showUserProfile(face.address, { source: "stage-reminders" })}
              hitSlop={{ top: 8, bottom: 8 }}
              activeOpacity={0.7}
              style={[styles.face, i > 0 && styles.faceOverlap, { zIndex: faces.length - i }]}
              accessibilityRole="link"
              accessibilityLabel={t("liveViewer.openProfileOf", {
                name: face.username ? `@${face.username}` : face.address.slice(0, 6),
              })}
            >
              <Avatar
                {...storedAvatarSources(face.avatarUrl, face.address, 24)}
                size={22}
                name={face.username || face.address}
                borderWidth={1}
                borderColor="rgba(0,0,0,0.4)"
              />
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.facesCount}>
        <Icon name="Bell" size={12} color="#A1A1AA" />
        <Text style={styles.facesCountText}>{hidden > 0 ? `+${hidden}` : total}</Text>
      </View>
    </View>
  );
};

export const HostRow: React.FC<{ space: AudioSpace }> = ({ space }) => {
  const { t } = useTranslation();
  return (
    <View style={styles.hostRow}>
      <Avatar
        {...storedAvatarSources(space.host_avatar, space.host_wallet_address, 40)}
        size={40}
        name={space.host_username || space.host_wallet_address}
        borderWidth={2}
        borderColor="rgba(255,255,255,0.2)"
      />
      <View style={styles.hostText}>
        <Text style={styles.hostedBy}>{t("stages.hostedBy")}</Text>
        <Text style={styles.hostName} numberOfLines={1}>
          @{hostHandle(space, t("common.anonymous"))}
        </Text>
      </View>
    </View>
  );
};

// ── Live ────────────────────────────────────────────────────────────────────

export const LiveStageCard: React.FC<{
  space: AudioSpace;
  isCurrent: boolean;
  isMine: boolean;
  /** Joining this room. The card is inert and says so rather than doing nothing. */
  isBusy?: boolean;
  onOpen: () => void;
  /** Present only for a host looking at their own room from outside it. */
  onEnd?: () => void;
}> = ({ space, isCurrent, isMine, isBusy = false, onOpen, onEnd }) => {
  const { t } = useTranslation();
  const { isMinimal } = useAppTheme();
  const heads = Math.max(1, (space.speaker_count || 1) + (space.listener_count || 0));
  const isRadio = isRadioShow(space);
  const action = isCurrent ? t("stages.returnToStage") : t("stages.join");
  const { data: participants = [] } = useQuery({
    queryKey: ["stage-list-faces", space.id, space.speaker_count, space.listener_count],
    enabled: heads > 1,
    placeholderData: (previous) => previous,
    staleTime: 20_000,
    queryFn: async (): Promise<{ id: string; wallet_address: string; username: string | null; avatar: string | null }[]> => {
      const { data, error } = await supabase.from("space_participants")
        .select("id, wallet_address, username, avatar")
        .eq("space_id", space.id)
        .neq("role", "host")
        .is("left_at", null)
        .order("joined_at", { ascending: false })
        .limit(4);
      if (error) throw error;
      return data ?? [];
    },
  });

  const confirmEnd = useCallback(() => {
    Alert.alert(t("stages.endThisStage"), t("stages.endSpaceConfirm", { title: space.title }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("stages.end"), style: "destructive", onPress: onEnd },
    ]);
  }, [onEnd, space.title, t]);

  return (
    <PageSection flush style={isMine ? (isMinimal ? m.cardMine : styles.cardMine) : undefined}>
      <View style={[styles.liveRow, isMinimal && m.body]}>
        <View style={styles.liveArtwork}>
          <StageCoverArt uri={space.cover_image_url} stage={space} />
        </View>
        <View style={styles.liveInfo}>
          <Text style={styles.title} numberOfLines={2}>{space.title}</Text>
          <View style={styles.liveHost}>
            <Avatar {...storedAvatarSources(space.host_avatar, space.host_wallet_address, 20)}
              size={20} name={space.host_username || space.host_wallet_address} />
            <Text style={styles.hostedBy} numberOfLines={1}>
              @{hostHandle(space, t("common.anonymous"))}
            </Text>
          </View>
          {!!space.description && <Text style={styles.description} numberOfLines={1}>{space.description}</Text>}
        </View>
        <View style={styles.liveActions}>
          <KitButton label={action} onPress={onOpen} disabled={isBusy}
            icon={isBusy ? <ActivityIndicator size="small" /> : undefined} />
          <View style={styles.topActions}>
            <TouchableOpacity onPress={() => shareStage(space)} hitSlop={8}
              style={[styles.iconBtn, isMinimal && m.outline]} accessibilityRole="button"
              accessibilityLabel={t("stages.shareStage")}>
              <Icon name="Share2" size={15} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
            {!!onEnd && (
              <TouchableOpacity onPress={confirmEnd} hitSlop={8}
                style={[styles.endBtn, isMinimal && m.outline]} accessibilityRole="button"
                accessibilityLabel={t("stages.endThisStage")}>
                <Text style={styles.endText}>{t("stages.end")}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
      <View style={[styles.liveMeta, isMinimal && m.body]}>
        <View style={[styles.liveChip, isRadio && styles.radioChip]}>
          <View style={[styles.liveDot, isRadio && styles.radioDot]} />
          <Text style={[styles.liveChipText, isRadio && styles.radioText]}>
            {isRadio ? t("stages.liveRadio") : t("stages.live")}
          </Text>
        </View>
        <View style={styles.countRow} accessible accessibilityLabel={t("stages.stageHeadcount", { count: heads })}>
          <Icon name="Users" size={13} color="rgba(255,255,255,0.65)" />
          <Text style={styles.countText}>{formatCount(heads)}</Text>
        </View>
        {heads > 1 && participants.length > 0 && (
          <View style={styles.liveFaces} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {participants.map((person) => (
              <View key={person.id} style={styles.liveFace}>
                <Avatar {...storedAvatarSources(person.avatar, person.wallet_address, 22)}
                  size={22} name={person.username || person.wallet_address} borderColor="#17171A" borderWidth={1} />
              </View>
            ))}
          </View>
        )}
      </View>
    </PageSection>
  );
};

// ── Upcoming ────────────────────────────────────────────────────────────────

export const ScheduledStageCard: React.FC<{
  space: AudioSpace;
  isMine: boolean;
  /** Starting or cancelling this stage; both controls go inert while it runs. */
  isBusy?: boolean;
  onStart: () => void;
  onCancel: () => void;
}> = ({ space, isMine, isBusy = false, onStart, onCancel }) => {
  const { t } = useTranslation();
  const { isMinimal } = useAppTheme();
  const startsAt = space.scheduled_at ? new Date(space.scheduled_at) : null;
  const now = useMinuteTick();
  const isOverdue = !!startsAt && startsAt.getTime() < now;
  const countdown = countdownParts(startsAt, now);
  const when = formatScheduledFor(space.scheduled_at);

  const confirmCancel = useCallback(() => {
    Alert.alert(t("common.cancel"), t("stages.cancelConfirm", { title: space.title }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.confirm"), style: "destructive", onPress: onCancel },
    ]);
  }, [onCancel, space.title, t]);

  return (
    <PageSection flush>
      <StageCoverArt uri={space.cover_image_url} title={space.title} stage={space} />

      <View style={[styles.body, isMinimal && m.body]}>
        <View style={styles.topRow}>
          <View style={[styles.chip, isMinimal && m.outline]}>
            <Icon name="CalendarDays" size={12} color="#D4D4D8" />
            <Text style={styles.chipText}>
              {isOverdue || !countdown ? t("stages.startingSoon") : t("whenSheet.startsIn", { defaultValue: "Starts in {{time}}", time: countdown })}
            </Text>
          </View>
          <View style={styles.topActions}>
            {/* The host is already going; a bell on your own stage is noise. */}
            {!isMine && <StageReminderBell spaceId={space.id} />}
            {!!space.scheduled_at && (
              <TouchableOpacity
                onPress={() => void addStageToCalendar(space).catch(() => {})}
                hitSlop={8}
                style={[styles.iconBtn, isMinimal && m.outline]}
                accessibilityRole="button"
                accessibilityLabel={t("stages.addToCalendar")}
              >
                <Icon name="CalendarDays" size={15} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => shareStage(space, when)}
              hitSlop={8}
              style={[styles.iconBtn, isMinimal && m.outline]}
              accessibilityRole="button"
              accessibilityLabel={t("stages.shareStage")}
            >
              <Icon name="Share2" size={15} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
          </View>
        </View>

        <HostRow space={space} />

        <Text style={styles.title} numberOfLines={2}>
          {space.title}
        </Text>
        {!!when && (
          <View style={styles.metaRow}>
            <Icon name="CalendarDays" size={12} color="#D4D4D8" />
            <Text style={styles.metaText} numberOfLines={1}>
              {when}
            </Text>
          </View>
        )}
        {!!space.description && (
          <Text style={styles.description} numberOfLines={2}>
            {space.description}
          </Text>
        )}

        <StageReminderFaces spaceId={space.id} />

        {isMine && (
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onStart}
              disabled={isBusy}
              style={[styles.primaryBtn, isBusy && styles.btnBusy]}
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy }}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#09090B" />
              ) : (
                <Icon name="Radio" size={15} color="#09090B" />
              )}
              <Text style={styles.primaryBtnText}>{t("stages.startNow")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={confirmCancel}
              disabled={isBusy}
              style={[styles.secondaryBtn, isMinimal && m.outline, isBusy && styles.btnBusy]}
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy }}
            >
              <Text style={styles.secondaryBtnText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </PageSection>
  );
};

// ── Recorded ────────────────────────────────────────────────────────────────

export const RecordedStageCard: React.FC<{
  space: AudioSpace;
  isMine: boolean;
  onOpenTranscript: () => void;
  onDelete: () => void;
}> = ({ space, isMine, onOpenTranscript, onDelete }) => {
  const { t } = useTranslation();
  const { isMinimal } = useAppTheme();
  const heads = Math.max(1, (space.speaker_count || 0) + (space.listener_count || 0));
  const duration = stageDuration(space);
  const hasRecording = !!space.recording_url;
  const meta = [formatStageDate(space.ended_at), duration].filter(Boolean).join(" · ");
  const navigation = useNavigation<any>();

  const confirmDelete = useCallback(() => {
    Alert.alert(t("stages.deleteStage"), t("stages.deleteRecordingConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.delete"), style: "destructive", onPress: onDelete },
    ]);
  }, [onDelete, t]);

  // The art and details open the stage's own page. The player below sits
  // outside this touchable on purpose: a drag on the bar is a scrub, never a
  // tap that leaves the list.
  const openStage = useCallback(
    () => navigation.navigate(ScreenNames.StageRecording, { spaceId: space.id, space }),
    [navigation, space],
  );

  return (
    <PageSection flush>
      <TouchableOpacity onPress={openStage} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={space.title}>
        <StageCoverArt uri={space.cover_image_url} title={space.title} stage={space} />

        <View style={[styles.body, isMinimal && m.body, (hasRecording || isMine) && styles.bodyTop]}>
          <View style={styles.topRow}>
            <View style={[styles.chip, isMinimal && m.outline]}>
              <Icon name="Clock" size={12} color="#D4D4D8" />
              <Text style={styles.chipText}>{t("stages.ended")}</Text>
            </View>
            <View style={styles.topActions}>
              <View style={styles.countRow}>
                <Icon name="Users" size={13} color="rgba(255,255,255,0.5)" />
                <Text style={styles.countText}>{formatCount(heads)}</Text>
              </View>
              <Icon name="ChevronRight" size={16} color="rgba(255,255,255,0.45)" />
            </View>
          </View>

          <Text style={styles.title} numberOfLines={2}>
            {space.title}
          </Text>

          <HostRow space={space} />

          {!!meta && (
            <Text style={styles.metaText} numberOfLines={1}>
              {meta}
            </Text>
          )}
        </View>
      </TouchableOpacity>

      <View style={[styles.body, isMinimal && m.body, styles.bodyBottom, !(hasRecording || isMine) && styles.bodyNone]}>

        {/* The player is its own line rather than a chip in the title row: web
            stacks the same way at phone widths, and a 90-bar scrub bar needs
            the whole width to be worth dragging.

            `whenGone="popOut"` because this row lives in a FlatList: scrolling
            a playing recording out of the window unmounts it, and stopping the
            audio for that would read as the list eating your playback. The
            corner player picks it up instead. */}
        {hasRecording && (
          <StageRecordingPlayer
            spaceId={space.id}
            recordingUrl={space.recording_url}
            title={space.title}
            startedAt={space.started_at}
            endedAt={space.ended_at}
            whenGone="popOut"
            style={styles.player}
          />
        )}

        <View style={styles.actions}>
          {hasRecording && <StageRecordingLanguage space={space} />}
          {hasRecording && (
            <TouchableOpacity
              onPress={onOpenTranscript}
              style={[styles.secondaryBtn, isMinimal && m.outline]}
              accessibilityRole="button"
            >
              <Icon name="FileText" size={13} color="#FFFFFF" />
              <Text style={styles.secondaryBtnText}>{t("stages.viewTranscript")}</Text>
            </TouchableOpacity>
          )}
          {isMine && (
            <TouchableOpacity
              onPress={confirmDelete}
              style={styles.deleteBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("stages.deleteStage")}
            >
              <Icon name="Trash2" size={15} color="rgba(255,255,255,0.45)" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </PageSection>
  );
};

const styles = StyleSheet.create({
  cardMine: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  btnBusy: {
    opacity: 0.6,
  },
  body: {
    padding: 16,
    gap: 10,
  },
  /** The recorded card splits its body in two (details / player); these close the seam. */
  bodyTop: {
    paddingBottom: 0,
  },
  bodyBottom: {
    paddingTop: 10,
  },
  bodyNone: {
    padding: 0,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  chipText: {
    color: "#D4D4D8",
    fontSize: 11,
    fontWeight: "600",
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    paddingBottom: 4,
  },
  liveArtwork: {
    width: 64,
    borderRadius: 8,
    overflow: "hidden",
  },
  liveInfo: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  liveHost: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  liveActions: {
    alignItems: "flex-end",
    gap: 6,
  },
  liveMeta: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 9,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  liveFaces: {
    flexDirection: "row",
    paddingLeft: 5,
  },
  liveFace: {
    marginLeft: -5,
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.md,
    backgroundColor: "rgba(244,63,94,0.15)",
  },
  radioChip: { backgroundColor: "rgba(56,189,248,0.15)" },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FB7185",
  },
  radioDot: { backgroundColor: "#38BDF8" },
  liveChipText: {
    color: "#FDA4AF",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  radioText: { color: "#7DD3FC" },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  countText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  endBtn: {
    paddingHorizontal: 10,
    height: 28,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  endText: {
    color: "#FAFAFA",
    fontSize: 11,
    fontWeight: "700",
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  hostText: {
    flex: 1,
    minWidth: 0,
  },
  hostedBy: {
    color: "#71717A",
    fontSize: 10,
  },
  hostName: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  description: {
    color: "#A1A1AA",
    fontSize: 12,
    lineHeight: 17,
  },
  facesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  faces: {
    flexDirection: "row",
    alignItems: "center",
  },
  face: {
    borderRadius: 6,
    overflow: "hidden",
  },
  faceOverlap: {
    marginLeft: -7,
  },
  facesCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  facesCountText: {
    color: "#A1A1AA",
    fontSize: 11,
    fontWeight: "500",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  metaText: {
    color: "#A1A1AA",
    fontSize: 12,
    flex: 1,
  },
  player: {
    marginTop: 2,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 11,
    borderRadius: radius.lg,
    backgroundColor: "#FFFFFF",
  },
  primaryBtnText: {
    color: "#09090B",
    fontSize: 13,
    fontWeight: "700",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  secondaryBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
});

/**
 * Minimal (web's html[data-theme="minimal"]): a stage is a list row, not a
 * card — no fill or outline, one hairline under it, text inset from the screen
 * edge, the cover still full width above. Your own live stage keeps a faint
 * wash, and the small filled chips and buttons become 1px outlines. The white
 * primary button keeps its fill: it is the one real call to action.
 */
const m = StyleSheet.create({
  cardMine: { backgroundColor: MINIMAL_WASH },
  body: { paddingHorizontal: MINIMAL_INSET },
  outline: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: MINIMAL_HAIRLINE,
  },
});
