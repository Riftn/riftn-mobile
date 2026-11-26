import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Platform } from "react-native";
import LiveChatInput from "../../components/LiveChat/LiveChatInput";

jest.mock("dehub-jsx/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("react-native-css-interop/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("react-native", () => ({
  View: "View", Text: "Text", TextInput: "TextInput", TouchableOpacity: "Button",
  Keyboard: {}, ActivityIndicator: "Spinner", Platform: { OS: "ios" },
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("react-native-reanimated", () => ({ __esModule: true, default: { View: "View" }, FadeIn: {} }));
jest.mock("../../hooks/useKeyboardSwap", () => ({ useKeyboardSwap: () => ({}) }));
jest.mock("../../hooks/useDraftState", () => ({ useDraftState: (_key: string, value: string) => require("react").useState(value) }));
jest.mock("../../hooks/useMentions", () => ({ useMentions: (_text: string, setText: (value: string) => void) => ({ handleChangeText: setText, reset: () => {} }) }));
jest.mock("../../hooks/useComposeTranslate", () => ({ useComposeTranslate: () => ({}) }));
jest.mock("../../components/Comments/VoiceNoteRecorder", () => ({ useVoiceRecorder: () => ({}) }));
jest.mock("../../components/common/SmartImage", () => "Image");
jest.mock("../../components/ui/Icon", () => "Icon");
jest.mock("../../components/LiveChat/LiveChatAttachSheet", () => "AttachmentSheet");
jest.mock("../../components/ui/WhenOpened", () => () => null);
jest.mock("../../components/Upload/EmojiSheet", () => "EmojiSheet");
jest.mock("../../components/common/MentionSuggestions", () => "Suggestions");
jest.mock("../../components/Settings/LanguageSelectModal", () => "LanguageModal");
jest.mock("../../services/ai.service", () => ({}));
jest.mock("../../services/livechat.service", () => ({}));
jest.mock("../../libs/assistant", () => ({ mentionsAssistant: () => false }));
jest.mock("../../libs/ai-consent", () => ({}));
jest.mock("../../libs/chat-gif", () => ({}));
jest.mock("../../libs/toast", () => ({}));

function composer(onSend: jest.Mock, attachmentBusy = false) {
  let tree!: ReactTestRenderer;
  const renderInput = (incomingLink?: string, onIncomingLinkApplied?: () => void) => (
    <LiveChatInput onSend={onSend} canSend isBanned={false}
    onTyping={() => {}} onCancelReply={() => {}} onCancelEdit={() => {}}
    replyingTo={null} editingMessage={null} attachmentBusy={attachmentBusy}
    incomingLink={incomingLink} onIncomingLinkApplied={onIncomingLinkApplied} />
  );
  act(() => { tree = create(renderInput()); });
  const input = () => tree.root.findByType("TextInput" as any);
  return { tree, input, renderInput };
}

it("adds a shared live link to the draft once and waits for Send", async () => {
  const onSend = jest.fn().mockResolvedValue(true);
  const consumed = jest.fn();
  const url = "https://riftn.com/app/post/42";
  const { tree, input, renderInput } = composer(onSend);
  act(() => input().props.onChangeText("Watch this"));
  act(() => tree.update(renderInput(url, consumed)));
  expect(consumed).toHaveBeenCalledTimes(1);
  expect(input().props.value).toBe(`Watch this\n${url}`);
  expect(onSend).not.toHaveBeenCalled();
  act(() => tree.update(renderInput()));
  act(() => tree.update(renderInput(url, consumed)));
  expect(input().props.value).toBe(`Watch this\n${url}`);
  act(() => tree.update(renderInput()));
  await act(async () => { await input().props.onSubmitEditing(); });
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith(`Watch this\n${url}`, undefined);
  act(() => tree.unmount());
});

it("submits from the iOS keyboard and preserves the draft on a failed send", async () => {
  const onSend = jest.fn().mockResolvedValue(false);
  const { tree, input } = composer(onSend);
  expect(input().props.returnKeyType).toBe("send");
  expect(input().props.submitBehavior).toBe("submit");
  await act(async () => { await input().props.onSubmitEditing(); });
  expect(onSend).not.toHaveBeenCalled();
  act(() => input().props.onChangeText("message"));
  await act(async () => { await input().props.onSubmitEditing(); });
  expect(onSend).toHaveBeenCalledWith("message", undefined);
  expect(input().props.value).toBe("message");
  act(() => tree.unmount());
});

it("blocks a keyboard submit while an attachment is busy", async () => {
  const onSend = jest.fn();
  const { tree, input } = composer(onSend, true);
  act(() => input().props.onChangeText("message"));
  await act(async () => { await input().props.onSubmitEditing(); });
  expect(onSend).not.toHaveBeenCalled();
  act(() => tree.unmount());
});

it("preserves the Android multiline return key", () => {
  const original = Platform.OS;
  try {
    Platform.OS = "android";
    const { tree, input } = composer(jest.fn());
    expect(input().props.submitBehavior).toBe("newline");
    expect(input().props.onSubmitEditing).toBeUndefined();
    act(() => tree.unmount());
  } finally { Platform.OS = original; }
});
