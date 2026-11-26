import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Linking, type AppStateStatus } from "react-native";
import ReviewPromptCard from "../../components/Home/ReviewPromptCard";

jest.mock("dehub-jsx/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("@react-navigation/native", () => ({ NavigationContext: require("react").createContext(null) }));
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { currentState: "active", addEventListener: jest.fn() },
  Linking: { openURL: jest.fn() },
  StyleSheet: { flatten: (style: unknown) => style },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
}));
jest.mock("expo-application", () => ({
  getInstallationTimeAsync: async () => new Date("2026-11-01T12:00:00Z"),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
jest.mock("../../context/ThemeContext", () => ({
  useAppTheme: () => ({ colors: { accent: "#fff", neutrals: { 500: "#777" } } }),
}));
jest.mock("../../context/AuthContext", () => ({ useAuthState: () => ({ isSignedIn: true }) }));
jest.mock("../../context/OnboardingChecklistContext", () => ({ useOnboarding: jest.fn() }));
jest.mock("../../components/ui/Icon", () => () => null);
jest.mock("../../libs/analytics", () => ({ track: jest.fn() }));

import { useOnboarding } from "../../context/OnboardingChecklistContext";

afterEach(async () => {
  AppState.currentState = "active";
  await AsyncStorage.clear();
  jest.useRealTimers();
});

it("counts foreground visits on a mounted Home even when onboarding has the card slot", async () => {
  jest.useFakeTimers();
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.mocked(AppState.addEventListener).mockImplementation((_event, listener) => {
    listeners.add(listener);
    return { remove: () => { listeners.delete(listener); } };
  });
  const setAppState = (state: AppStateStatus) => {
    AppState.currentState = state;
    listeners.forEach((listener) => listener(state));
  };

  jest.setSystemTime(new Date(2026, 10, 20, 12));
  (useOnboarding as jest.Mock).mockReturnValue({ active: true, progress: {} });
  const home = render(<ReviewPromptCard />);
  await act(async () => {});

  for (let date = 21; date <= 23; date++) {
    await act(async () => setAppState("background"));
    jest.setSystemTime(new Date(2026, 10, date, 12));
    await act(async () => setAppState("active"));
  }
  await act(async () => { jest.advanceTimersByTime(6000); });
  expect(home.queryByLabelText("Rate")).toBeNull();

  (useOnboarding as jest.Mock).mockReturnValue(null);
  home.rerender(<ReviewPromptCard />);
  await act(async () => { jest.advanceTimersByTime(6000); });
  await act(async () => { fireEvent.press(home.getByLabelText("Rate")); });
  expect(Linking.openURL).toHaveBeenCalledWith("itms-apps://apps.apple.com/app/id6770382811?action=write-review");
});
