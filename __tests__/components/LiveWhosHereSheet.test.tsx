import React from "react";
import type { PropsWithChildren } from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import LiveWhosHereSheet from "../../components/LiveViewer/LiveWhosHereSheet";
import type { LiveAudience } from "../../services/live.service";

jest.mock("dehub-jsx/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles, flatten: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("../../context/ThemeContext", () => ({ useAppTheme: () => ({ theme: "system" }) }));
jest.mock("../../components/ui/Icon", () => () => null);
jest.mock("../../components/common/Avatar", () => () => null);
jest.mock("../../components/common/DhbCoin", () => ({ DhbCoin: () => null }));
jest.mock("../../libs/misc", () => ({ getAvatarUrl: () => "" }));
jest.mock("../../components/ui/GlassModal", () => {
  const { Pressable } = require("react-native");
  return ({ children, onDismiss }: PropsWithChildren<{ onDismiss: () => void }>) => (
    <>
      {children}
      <Pressable accessibilityRole="button" accessibilityLabel="Dismissed" onPress={onDismiss} />
    </>
  );
});

const audience: LiveAudience = {
  host: null,
  watching: 2,
  topTippers: [],
  mostActive: [],
  here: [
    { address: "0x1234", username: "@attendee", displayName: "Attendee", joinedAt: new Date().toISOString() },
    { address: "0x9876", displayName: "Wallet only", joinedAt: new Date().toISOString() },
  ],
};

describe("live audience profile navigation", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("waits for the audience modal to dismiss and opens only the selected profile", () => {
    const close = jest.fn();
    const open = jest.fn();
    const view = render(<LiveWhosHereSheet visible onClose={close} onOpenProfile={open} audience={audience} loading={false} />);

    fireEvent.press(view.getByRole("button", { name: "Attendee" }));
    fireEvent.press(view.getByRole("button", { name: "Wallet only" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();

    fireEvent.press(view.getByRole("button", { name: "Dismissed" }));
    act(() => jest.runOnlyPendingTimers());
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("attendee");
  });

  it("cancels a pending profile if the live viewer unmounts first", () => {
    const open = jest.fn();
    const view = render(<LiveWhosHereSheet visible onClose={jest.fn()} onOpenProfile={open} audience={audience} loading={false} />);

    fireEvent.press(view.getByRole("button", { name: "Wallet only" }));
    view.unmount();
    act(() => jest.runOnlyPendingTimers());
    expect(open).not.toHaveBeenCalled();
  });
});
