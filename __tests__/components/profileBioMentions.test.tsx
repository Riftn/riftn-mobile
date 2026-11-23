import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import ProfileBio from "../../components/Profile/ProfileBio";

jest.mock("dehub-jsx/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
jest.mock("react-native", () => ({ Text: "Text", StyleSheet: { flatten: (style: unknown) => style } }));

const mockOpen = jest.fn();
jest.mock("../../context/UserProfileSheetContext", () => ({
  useUserProfileSheet: () => ({ showUserProfile: mockOpen }),
}));

it("opens typed bio handles and leaves addresses, URLs and surrounding punctuation intact", () => {
  const view = render(<ProfileBio text={"Contact me@example.com or https://riftn.com/@else.\n@lastchad, (@Other_User)."} />);
  expect(view.getAllByRole("link")).toHaveLength(2);
  fireEvent.press(view.getByText("@lastchad"), { stopPropagation: jest.fn() });
  expect(mockOpen).toHaveBeenCalledWith("lastchad");
  fireEvent.press(view.getByText("@Other_User"), { stopPropagation: jest.fn() });
  expect(mockOpen).toHaveBeenCalledWith("Other_User");
  view.rerender(<ProfileBio text="Plain bio" />);
  expect(view.queryAllByRole("link")).toHaveLength(0);
  expect(view.getByText("Plain bio")).toBeTruthy();
});
