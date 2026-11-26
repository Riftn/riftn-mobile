import React, { useCallback } from "react";
import { useIsFocused } from "@react-navigation/native";
import UserProfilePageContent from "../components/UserProfile/UserProfilePageContent";
import { ScreenNames } from "../navigation/ScreenNames";
import type { AppStackScreenProps } from "../navigation/types";

const keepProfileInHistory = () => {};

export default function LiveAttendeeProfileScreen({
  navigation,
  route,
}: AppStackScreenProps<ScreenNames.LiveAttendeeProfile>) {
  const focused = useIsFocused();
  const close = useCallback(() => navigation.goBack(), [navigation]);

  return (
    <UserProfilePageContent
      visible={focused}
      usernameOrAddress={route.params.identifier}
      onClose={close}
      onNavigateAway={keepProfileInHistory}
    />
  );
}
