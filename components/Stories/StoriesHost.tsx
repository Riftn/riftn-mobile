/**
 * Where the moments viewer and creator open, over whatever screen is up.
 * Mounted once near the app root; renders nothing until one is opened.
 */
import React from "react";
import { Modal } from "react-native";
import { useSnapshot } from "valtio";
import { closeStoryCreator, closeStoryViewer, storiesState } from "../../store/stories.store";
import type { ShelfEntry } from "../../services/stories.service";
import StoryViewer from "./StoryViewer";
import StoryCreator from "./StoryCreator";

export default function StoriesHost() {
  const { viewer, creator } = useSnapshot(storiesState);
  if (!viewer && !creator) return null;

  return (
    <Modal
      visible
      animationType={creator && !creator.remixSource ? "slide" : "fade"}
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={creator ? closeStoryCreator : closeStoryViewer}
    >
      {creator ? (
        <StoryCreator onClose={closeStoryCreator} remixSource={creator.remixSource} />
      ) : viewer ? (
        <StoryViewer
          key={`${viewer.entries[viewer.index]?.items[0]?.id}-${viewer.standalone}`}
          entries={viewer.entries as ShelfEntry[]}
          index={viewer.index}
          onClose={closeStoryViewer}
        />
      ) : null}
    </Modal>
  );
}
