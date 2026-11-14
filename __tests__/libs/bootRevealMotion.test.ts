import { __resetLaunchMotionForTests, markLaunchMotionStarted, useLaunchMotionStarted } from "../../libs/bootReveal";
import { renderHook, act } from "@testing-library/react-native";

jest.mock("../../libs/minimalBootGuard", () => ({ settleMinimalLaunch: jest.fn() }));

describe("launch motion flag", () => {
  beforeEach(() => __resetLaunchMotionForTests());

  it("starts false and flips once the cover's animation is running", () => {
    const { result } = renderHook(() => useLaunchMotionStarted());
    expect(result.current).toBe(false);
    act(() => markLaunchMotionStarted());
    expect(result.current).toBe(true);
  });

  it("stays true for screens that mount later", () => {
    markLaunchMotionStarted();
    markLaunchMotionStarted();
    const { result } = renderHook(() => useLaunchMotionStarted());
    expect(result.current).toBe(true);
  });
});
