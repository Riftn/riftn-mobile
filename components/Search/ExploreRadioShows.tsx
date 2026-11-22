/**
 * Explore's Radio row: stages opened as radio shows (see
 * libs/stage-radio-show.ts), live first, then upcoming, plus a way to start
 * one. Twin of web's ExploreRadioShows.
 */
import React, { useCallback, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import Icon from "../ui/Icon";
import SmartImage from "../common/SmartImage";
import { ExploreSection, exploreRowStyles as row } from "./ExploreSection";
import { useStages } from "../../context/StageContext";
import { isRadioShow } from "../../libs/stage-radio-show";
import { formatCount } from "../../libs/format-count";
import { ScreenNames } from "../../navigation/ScreenNames";

const MAX_ROWS = 5;

function ExploreRadioShows({ first }: { first?: boolean }) {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const { liveSpaces, scheduledSpaces, currentSpace, openModal, joinSpace, guestListenSpace } = useStages();

  const shows = useMemo(() => {
    const live = (liveSpaces ?? []).filter(isRadioShow);
    const soon = (scheduledSpaces ?? []).filter(isRadioShow);
    return [...live, ...soon].slice(0, MAX_ROWS);
  }, [liveSpaces, scheduledSpaces]);

  const joiningRef = useRef(false);
  const open = useCallback(
    async (space: (typeof shows)[number]) => {
      if (space.status !== "live") {
        navigation.navigate(ScreenNames.Stages);
        return;
      }
      if (currentSpace?.id === space.id) {
        openModal("live");
        return;
      }
      if (joiningRef.current) return;
      joiningRef.current = true;
      try {
        if ((await joinSpace(space.id)) || (await guestListenSpace(space.id))) openModal("live");
        else openModal("browse");
      } finally {
        joiningRef.current = false;
      }
    },
    [navigation, currentSpace?.id, openModal, joinSpace, guestListenSpace],
  );

  return (
    <ExploreSection
      first={first}
      icon="audio"
      title={t("stages.radioShow.row")}
      action={t("stages.radioShow.start")}
      onAction={() => openModal("create")}
    >
      {shows.length === 0 ? (
        <Text className="text-theme-neutrals-500" style={styles.empty}>
          {t("stages.radioShow.empty")}
        </Text>
      ) : (
        shows.map((space) => {
          const live = space.status === "live";
          return (
            <Pressable key={space.id} onPress={() => void open(space)} style={row.row}>
              {space.host_avatar ? (
                <SmartImage source={{ uri: space.host_avatar }} style={styles.face} />
              ) : (
                <View style={[styles.face, styles.faceEmpty]}>
                  <Icon name="Radio" size={18} color="#A1A1AA" />
                </View>
              )}
              <View style={row.flex}>
                <Text className="text-white" style={row.name} numberOfLines={1}>
                  {space.title}
                </Text>
                <Text className="text-theme-neutrals-500" style={row.sub} numberOfLines={1}>
                  {space.host_username ? `@${space.host_username}` : ""}
                  {live && space.listener_count
                    ? `${space.host_username ? " · " : ""}${t("stages.radioShow.listening", {
                        count: space.listener_count,
                        formatted: formatCount(space.listener_count),
                      })}`
                    : ""}
                </Text>
              </View>
              <View style={[styles.pill, live ? styles.pillLive : null]}>
                <Text style={[styles.pillText, live ? styles.pillTextLive : null]}>
                  {live ? t("stages.radioShow.onAir") : t("stages.radioShow.soon")}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
    </ExploreSection>
  );
}

const styles = StyleSheet.create({
  empty: { fontSize: 13, lineHeight: 18, paddingVertical: 6 },
  face: { width: 40, height: 40, borderRadius: 20 },
  faceEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: "hsla(240, 4%, 46%, 0.18)" },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "hsla(240, 4%, 46%, 0.2)",
  },
  pillLive: { backgroundColor: "hsla(0, 84%, 60%, 0.18)" },
  pillText: { fontSize: 11, fontWeight: "700", color: "hsla(240, 5%, 65%, 1)" },
  pillTextLive: { color: "hsla(0, 91%, 71%, 1)" },
});

export default React.memo(ExploreRadioShows);
