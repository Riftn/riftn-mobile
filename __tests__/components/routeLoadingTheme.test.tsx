import React from "react";
import { act, create } from "react-test-renderer";
import { LinearGradient } from "expo-linear-gradient";
import RouteLoadingShell from "../../navigation/RouteLoadingShell";

jest.mock("dehub-jsx/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ canGoBack: () => false }) }));
jest.mock("react-native", () => ({
  View: "View", Pressable: "Pressable", Platform: { OS: "ios" },
  StyleSheet: { absoluteFill: {} },
  useWindowDimensions: () => ({ width: 360 }),
  AccessibilityInfo: {},
  Easing: { linear: jest.fn() },
  Animated: {
    View: "AnimatedView",
    Value: jest.fn(() => ({ interpolate: jest.fn() })),
    timing: jest.fn(),
    loop: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
  },
}));

let mockIsLight = true;
jest.mock("../../context/ThemeContext", () => ({
  useAppTheme: () => ({
    isLight: mockIsLight,
    pageColors: { background: mockIsLight ? "#fafafa" : "#09090b" },
  }),
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));

it("uses the active page background in light and dark mode", () => {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<RouteLoadingShell />); });
  expect(tree.root.findByProps({ testID: "route-loading-shell" }).props.style.backgroundColor).toBe("#fafafa");
  expect(tree.root.findAllByType(LinearGradient)).toHaveLength(1);

  mockIsLight = false;
  act(() => tree.update(<RouteLoadingShell />));
  expect(tree.root.findByProps({ testID: "route-loading-shell" }).props.style.backgroundColor).toBe("#09090b");
  expect(tree.root.findAllByType(LinearGradient)).toHaveLength(1);
  act(() => tree.unmount());
});
