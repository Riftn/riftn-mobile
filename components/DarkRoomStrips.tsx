import React from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDarkRoomOpen } from "../libs/darkRoomOpen";

/**
 * Black under the status bar and the gesture bar while a dark room is open on
 * a light theme (libs/darkRoomOpen). Drawn behind the navigator, in the two
 * strips the root safe area leaves to the page colour.
 */
const DarkRoomStrips: React.FC = () => {
  const open = useDarkRoomOpen();
  const insets = useSafeAreaInsets();
  if (!open) return null;
  return (
    <>
      <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: insets.top, backgroundColor: "#000" }} />
      <View pointerEvents="none" style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: insets.bottom, backgroundColor: "#000" }} />
    </>
  );
};

export default DarkRoomStrips;
