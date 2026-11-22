import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import StoryCreator from "../../components/Stories/StoryCreator";
import { composePhoto } from "../../components/Stories/story-compose";
import { shareMoment } from "../../components/Stories/story-upload";
import { mentionSearch, type MentionUser } from "../../services/mention.service";

jest.mock("react-native-css-interop/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("react-native", () => ({
  View: "View",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  Pressable: "Pressable",
  TouchableOpacity: "TouchableOpacity",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Keyboard: { dismiss: jest.fn() },
  PanResponder: { create: (handlers: Record<string, unknown>) => ({ panHandlers: { onResponderGrant: handlers.onPanResponderGrant, onResponderMove: handlers.onPanResponderMove, onResponderRelease: handlers.onPanResponderRelease } }) },
  Platform: { OS: "ios", select: (options: any) => options.ios },
  StyleSheet: { create: (value: object) => value, flatten: (value: object) => Array.isArray(value) ? Object.assign({}, ...value) : value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 390, height: 844 }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 40, bottom: 30 }) }));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
jest.mock("@react-native-community/slider", () => "Slider");
jest.mock("expo-image", () => ({ Image: "Image" }));
jest.mock("expo-video", () => ({ useVideoPlayer: () => ({}), VideoView: "VideoView" }));
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: async () => ({ assets: [{ uri: "file:///photo.jpg", type: "image" }], canceled: false }),
}));
jest.mock("expo-file-system/legacy", () => ({}));
jest.mock("../../components/ui/Icon", () => "Icon");
jest.mock("../../components/common/MentionSuggestions", () => {
  const { createElement } = jest.requireActual("react");
  return ({ suggestions, onSelect }: { suggestions: MentionUser[]; onSelect: (user: MentionUser) => void }) =>
    suggestions.map((user) => createElement("Pressable", {
      key: user.address, accessibilityLabel: user.username, onPress: () => onSelect(user),
    }));
});
jest.mock("../../context/ThemeContext", () => ({ DarkRoomProvider: ({ children }: React.PropsWithChildren) => children }));
jest.mock("../../libs/skia", () => ({ optionalSkia: (load: () => unknown) => load() }));
jest.mock("../../libs/toast", () => ({ toastError: jest.fn() }));
jest.mock("../../services/stories.service", () => ({ getStoryShelf: async () => ({ shelf: [], supportsCustomAudience: true, supportsPhotoDuration: true }) }));
jest.mock("../../services/mention.service", () => ({ mentionSearch: jest.fn() }));
jest.mock("../../components/Stories/story-upload", () => ({ shareMoment: jest.fn() }));
jest.mock("@shopify/react-native-skia", () => ({
  FontSlant: { Upright: 0, Italic: 1 },
  ImageFormat: { JPEG: 0 },
  Skia: {
    Color: (color: string) => color,
    ParagraphBuilder: { Make: () => ({
      pushStyle: () => {},
      addText: () => {},
      pop: () => {},
      build: () => ({ layout: () => {}, getLongestLine: () => 216 }),
    }) },
  },
}));
jest.mock("../../components/Stories/story-compose", () => ({
  ...jest.requireActual("../../components/Stories/story-compose"),
  composePhoto: jest.fn(async () => "file:///moment.jpg"),
}));

const address = "0x0000000000000000000000000000000000000001";

it("exports a person selected in the Moment editor as a linked label", async () => {
  jest.mocked(mentionSearch).mockResolvedValue([
    { address, username: "alice", displayName: "Alice", avatarImageUrl: "", isFollowing: false },
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const editor = render(<QueryClientProvider client={client}><StoryCreator onClose={jest.fn()} /></QueryClientProvider>);
  fireEvent.press(editor.getByText("Pick from device"));
  fireEvent.press(await editor.findByLabelText("Mention"));
  fireEvent.changeText(editor.getByPlaceholderText("Search"), "@ali");
  fireEvent.press(await editor.findByLabelText("alice"));
  expect(editor.getByText("@alice")).toBeTruthy();
  fireEvent.press(editor.getByText("Share"));
  await waitFor(() => expect(shareMoment).toHaveBeenCalledTimes(1));
  const [draft] = jest.mocked(shareMoment).mock.calls[0];
  expect(draft.uri).toBe("file:///moment.jpg");
  expect(draft.fields.mentions).toHaveLength(1);
  const target = draft.fields.mentions![0];
  expect(target.address).toBe(address);
  expect(target.x + target.w / 2).toBeCloseTo(0.5);
  expect(target.y + target.h / 2).toBeCloseTo(0.6);
  expect(target.w).toBeGreaterThan(0.2);
});

it("keeps the full photo visible and lets the author close the editor without sharing", async () => {
  const onClose = jest.fn();
  jest.mocked(shareMoment).mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const editor = render(<QueryClientProvider client={client}><StoryCreator onClose={onClose} /></QueryClientProvider>);
  fireEvent.press(editor.getByText("Pick from device"));
  await editor.findByText("Share");
  const close = editor.getByLabelText("Close");
  expect(editor.UNSAFE_getAllByType(require("expo-image").Image).at(-1)?.props.contentFit).toBe("contain");
  fireEvent.press(close);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(shareMoment).not.toHaveBeenCalled();
});

it("tracks one gesture across multiple text position updates and publishes the final position", async () => {
  jest.mocked(shareMoment).mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const editor = render(<QueryClientProvider client={client}><StoryCreator onClose={() => {}} /></QueryClientProvider>);
  fireEvent.press(editor.getByText("Pick from device"));
  fireEvent.press(await editor.findByLabelText("Mention"));
  fireEvent.changeText(editor.getByPlaceholderText("Search"), "@ali");
  fireEvent.press(await editor.findByLabelText("alice"));
  const layer = () => editor.getByLabelText("@alice");
  const move = layer().props.onResponderMove;
  act(() => layer().props.onResponderGrant());
  act(() => move({}, { dx: 15, dy: 20 }));
  expect(layer().props.onResponderMove).toBe(move);
  act(() => move({}, { dx: 60, dy: 90 }));
  act(() => layer().props.onResponderRelease({}, { dx: 60, dy: 90 }));
  fireEvent.press(editor.getByText("Share"));
  await waitFor(() => expect(shareMoment).toHaveBeenCalledTimes(1));
  const box = jest.mocked(shareMoment).mock.calls[0][0].fields.mentions![0];
  expect(box.x + box.w / 2).toBeGreaterThan(0.6);
  expect(box.y + box.h / 2).toBeGreaterThan(0.7);
  editor.unmount();
  client.clear();
});

it("keeps a text layer's chosen orientation through editing and export", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const editor = render(<QueryClientProvider client={client}><StoryCreator onClose={() => {}} /></QueryClientProvider>);
  fireEvent.press(editor.getByText("Pick from device"));
  fireEvent.press(await editor.findByLabelText("Text"));
  fireEvent.changeText(editor.getByPlaceholderText("Type something"), "Upward");
  for (let i = 0; i < 6; i++) fireEvent.press(editor.getByLabelText("Rotate"));
  fireEvent.press(editor.getByLabelText("Done"));
  expect(editor.getByLabelText("Upward").props.style.transform).toContainEqual({ rotate: "270deg" });
  fireEvent.press(editor.getByText("Share"));
  await waitFor(() => expect(composePhoto).toHaveBeenCalledWith("file:///photo.jpg", [
    expect.objectContaining({ text: "Upward", rotation: 270, x: 0.5, y: 0.42 }),
  ]));
  editor.unmount();
  client.clear();
});

it.each(["Only selected people", "Hide from selected people"])("publishes %s using chosen account addresses", async (mode) => {
  jest.mocked(shareMoment).mockClear();
  jest.mocked(mentionSearch).mockResolvedValue([{ address, username: "alice", displayName: "Alice", avatarImageUrl: "", isFollowing: false }]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const editor = render(<QueryClientProvider client={client}><StoryCreator onClose={jest.fn()} /></QueryClientProvider>);
  fireEvent.press(editor.getByText("Pick from device"));
  fireEvent.press(await editor.findByText("Everyone"));
  fireEvent.press(await editor.findByText(mode));
  fireEvent.press(editor.getByText("Done"));
  fireEvent.press(editor.getByText("Share"));
  expect(shareMoment).not.toHaveBeenCalled();
  fireEvent.press(editor.getByText(mode));
  fireEvent.press(editor.getByText("Search"));
  fireEvent.changeText(editor.getByPlaceholderText("Search"), "@ali");
  fireEvent.press(await editor.findByLabelText("alice"));
  expect(editor.getByText("@alice ×")).toBeTruthy();
  fireEvent.press(editor.getByText("Done"));
  fireEvent.press(editor.getByText("Share"));
  await waitFor(() => expect(shareMoment).toHaveBeenCalledTimes(1));
  expect(jest.mocked(shareMoment).mock.calls[0][0].fields).toMatchObject({
    audience: mode === "Only selected people" ? "selected" : "except", audienceAddresses: [address],
  });
  editor.unmount();
  client.clear();
});

it("passes a chosen photo playback timer to the upload", async () => {
  jest.mocked(shareMoment).mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const editor = render(<QueryClientProvider client={client}><StoryCreator onClose={jest.fn()} /></QueryClientProvider>);
  fireEvent.press(editor.getByText("Pick from device"));
  fireEvent.press(await editor.findByLabelText("Seconds on screen"));
  const slider = editor.UNSAFE_getByType(require("@react-native-community/slider"));
  expect(slider.props.value).toBe(5);
  expect(slider.props.maximumValue).toBe(60);
  fireEvent(slider, "valueChange", 37);
  fireEvent.press(editor.getByText("Done"));
  fireEvent.press(editor.getByText("Share"));
  await waitFor(() => expect(shareMoment).toHaveBeenCalledTimes(1));
  expect(jest.mocked(shareMoment).mock.calls[0][0].fields.photoDurationSeconds).toBe(37);
  editor.unmount();
  client.clear();
});

it("applies the chosen caption font and size to the placed text and upload", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const editor = render(<QueryClientProvider client={client}><StoryCreator onClose={jest.fn()} /></QueryClientProvider>);
  fireEvent.press(editor.getByText("Pick from device"));
  fireEvent.press(await editor.findByLabelText("Text"));
  fireEvent.changeText(editor.getByPlaceholderText("Type something"), "Hello");
  fireEvent.press(editor.getByLabelText("Caption font"));
  expect(editor.getAllByRole("radio")).toHaveLength(12);
  fireEvent.press(editor.getByText("Typewriter"));
  fireEvent(editor.getByLabelText("Text size"), "valueChange", 0.1);
  expect(editor.getByPlaceholderText("Type something")).toHaveStyle({ fontStyle: "italic" });
  fireEvent.press(editor.getByLabelText("Done"));
  expect(editor.getByText("Hello")).toHaveStyle({ fontStyle: "italic" });
  fireEvent.press(editor.getByText("Share"));
  await waitFor(() => expect(composePhoto).toHaveBeenCalledWith("file:///photo.jpg", [
    expect.objectContaining({ font: "typewriter", size: 0.1, text: "Hello" }),
  ]));
  editor.unmount();
  client.clear();
});
