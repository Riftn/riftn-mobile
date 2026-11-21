import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Modal, Platform } from "react-native";
import StoriesHost from "../../components/Stories/StoriesHost";
import StoryViewer from "../../components/Stories/StoryViewer";
import { closeStoryViewer } from "../../store/stories.store";

const mockShow = jest.fn();
jest.mock("react-native-css-interop/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("react-native", () => ({ Modal: "Modal", Platform: { OS: "ios" } }));
jest.mock("valtio", () => ({ useSnapshot: (state: unknown) => state }));
jest.mock("../../store/stories.store", () => ({
  storiesState: { viewer: { entries: [{ items: [{ id: "story" }] }], index: 0 } },
  closeStoryViewer: jest.fn(),
}));
jest.mock("../../context/UserProfileSheetContext", () => ({ useUserProfileSheet: () => ({ showUserProfile: mockShow }) }));
jest.mock("../../components/Stories/StoryViewer", () => () => null);
jest.mock("../../components/Stories/StoryCreator", () => () => null);

it.each(["ios", "android"] as const)("opens the selected profile once on %s", (platform) => {
  Platform.OS = platform;
  jest.clearAllMocks();
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<StoriesHost />); });
  act(() => tree.root.findByType(StoryViewer).props.onOpenProfile("selected-address"));
  expect(closeStoryViewer).toHaveBeenCalledTimes(1);
  if (platform === "ios") expect(mockShow).not.toHaveBeenCalled();
  else expect(mockShow).toHaveBeenCalledTimes(1);
  act(() => tree.root.findByType(Modal).props.onDismiss());
  expect(mockShow).toHaveBeenCalledTimes(1);
  expect(mockShow).toHaveBeenCalledWith("selected-address", { source: "moment" });
  act(() => tree.unmount());
});
