import React from "react";
import { act, create } from "react-test-renderer";
import { ScrollView, Text } from "react-native";
import LiveViewerPills from "../../components/LiveViewer/LiveViewerPills";

jest.mock("dehub-jsx/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("react-native", () => ({
  View: "View", Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView",
  StyleSheet: { create: (styles: object) => styles },
}));
jest.mock("../../libs", () => ({ apiClient: {} }));
jest.mock("../../components/common/ViewerChrome", () => ({ EDGE: 16, TEXT_SHADOW: {} }));
jest.mock("../../components/common/Avatar", () => "Avatar");
jest.mock("../../components/common/DhbCoin", () => ({ DhbCoin: "DhbCoin" }));
jest.mock("../../components/ui/Icon", () => "Icon");
jest.mock("../../components/LiveViewer/PointsIcon", () => ({ PointsIcon: "PointsIcon" }));

it("keeps the coin count and spendable points outside the scrolling stream details", () => {
  const onPointsPress = jest.fn();
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<LiveViewerPills isLive isPaused={false} isEnded={false} title="Stream title"
      giftTotal={123} pointsBalance={0} onPointsPress={onPointsPress} />);
  });

  const details = tree.root.findByType(ScrollView);
  expect(details.findAllByType(Text).map(node => node.props.children)).toContain("Stream title");
  expect(details.findAllByType(Text).map(node => node.props.children)).not.toContain("123");
  expect(details.findAllByProps({ testID: "live-points-button" })).toHaveLength(0);
  expect(tree.root.findAllByType(Text).map(node => node.props.children)).toContain("123");

  const points = tree.root.findByProps({ testID: "live-points-button" });
  expect(points.findByType(Text).props.children).toBe("0");
  act(() => points.props.onPress());
  expect(onPointsPress).toHaveBeenCalledTimes(1);
  act(() => tree.unmount());
});
