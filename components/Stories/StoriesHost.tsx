/**
 * Where the moments viewer and creator open, over whatever screen is up.
 * Mounted once near the app root; renders nothing until one is opened.
 */
import React from "react";
import { useSnapshot } from "valtio";
import { closeStoryCreator, closeStoryViewer, storiesState } from "../../store/stories.store";
import { StoryViewerModal } from "./StoryViewer";
import { StoryCreatorModal } from "./StoryCreator";

export default function StoriesHost() {
  const { viewer, creatorOpen } = useSnapshot(storiesState);
  return (
    <>
      {viewer ? <StoryViewerModal entries={viewer.entries as any} index={viewer.index} onClose={closeStoryViewer} /> : null}
      {creatorOpen ? <StoryCreatorModal onClose={closeStoryCreator} /> : null}
    </>
  );
}
