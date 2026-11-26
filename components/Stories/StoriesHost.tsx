/**
 * Where the moments viewer and creator open, over whatever screen is up.
 * Mounted once near the app root; renders nothing until one is opened.
 */
import React, { useRef } from "react";
import { Modal, Platform } from "react-native";
import { useSnapshot } from "valtio";
import { closeStoryCreator, closeStoryViewer, storiesState } from "../../store/stories.store";
import type { ShelfEntry } from "../../services/stories.service";
import { useUserProfileSheet } from "../../context/UserProfileSheetContext";
import StoryViewer from "./StoryViewer";
import StoryCreator from "./StoryCreator";

export default function StoriesHost() {
  const { viewer, creator } = useSnapshot(storiesState);
  const { showUserProfile } = useUserProfileSheet();
  const pendingProfile = useRef<string | null>(null);

  const showPendingProfile = () => {
    const address = pendingProfile.current;
    pendingProfile.current = null;
    if (address) showUserProfile(address, { source: "moment" });
  };
  const openProfile = (address: string) => {
    pendingProfile.current = address;
    closeStoryViewer();
    // UIKit finishes dismissing its full-screen modal before presenting a profile.
    if (Platform.OS !== "ios") showPendingProfile();
  };

  return (
    <Modal
      visible={!!viewer || !!creator}
      onDismiss={showPendingProfile}
      animationType={creator && !creator.remixSource && creator.postTokenId == null ? "slide" : "fade"}
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={creator ? closeStoryCreator : closeStoryViewer}
    >
      {creator ? (
        <StoryCreator onClose={closeStoryCreator} remixSource={creator.remixSource} postTokenId={creator.postTokenId} />
      ) : viewer ? (
        <StoryViewer
          key={`${viewer.entries[viewer.index]?.items[0]?.id}-${viewer.standalone}-${viewer.openComments}`}
          entries={viewer.entries as ShelfEntry[]}
          index={viewer.index}
          openComments={viewer.openComments}
          onOpenProfile={openProfile}
          onClose={closeStoryViewer}
        />
      ) : null}
    </Modal>
  );
}
