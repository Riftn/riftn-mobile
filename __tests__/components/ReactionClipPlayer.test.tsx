import { act, renderHook } from "@testing-library/react-native";

// Animated that keeps time with jest's timers: a timing lands after its duration.
jest.mock("react-native", () => {
  class Value {
    v: number;
    constructor(v: number) { this.v = v; }
    setValue(v: number) { this.v = v; }
    stopAnimation() {}
  }
  const timing = (value: Value, cfg: { toValue: number; duration: number }) => ({
    start: (done?: (r: { finished: boolean }) => void) => { setTimeout(() => { value.setValue(cfg.toValue); done?.({ finished: true }); }, cfg.duration); },
  });
  const parallel = (list: Array<{ start: (d?: () => void) => void }>) => ({
    start: (done?: (r: { finished: boolean }) => void) => { let left = list.length; list.forEach((a) => a.start(() => { left -= 1; if (!left) done?.({ finished: true }); })); },
  });
  const ease = () => (t: number) => t;
  return { Animated: { Value, timing, parallel }, Easing: { in: ease, out: ease, quad: (t: number) => t } };
});

import { useClipPlayer } from "../../components/ChatReactions/useClipPlayer";

const art = { uri: "https://riftn.com/emoji/animated/chat/1f4af.webp", ms: 1360 };

describe("the moving emoji in a reaction chip", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("waits for the file to be drawn, plays to its reported end, then hands back", () => {
    const { result } = renderHook(() => useClipPlayer());
    let armed = false;
    act(() => { armed = result.current.prepare(art); });
    expect(armed).toBe(true);
    const key = result.current.clip!.key;
    expect(result.current.playing).toBe(false);

    // Landed before the file was drawn: nothing starts yet.
    act(() => result.current.begin(true));
    expect(result.current.playing).toBe(false);
    act(() => result.current.onReady(key));
    expect(result.current.playing).toBe(true);

    // Its own length passing is not the end; only the reported last frame is.
    act(() => { jest.advanceTimersByTime(art.ms + 300); });
    expect(result.current.clip).not.toBeNull();
    expect(result.current.playing).toBe(true);

    act(() => result.current.onEnd(key));
    act(() => { jest.advanceTimersByTime(1000); });
    expect(result.current.clip).toBeNull();
    expect(result.current.playing).toBe(false);
  });

  it("lets a play finish when more reactions pile on", () => {
    const { result } = renderHook(() => useClipPlayer());
    act(() => { result.current.prepare(art); });
    const key = result.current.clip!.key;
    act(() => result.current.onReady(key));
    act(() => result.current.begin(false));
    expect(result.current.playing).toBe(true);

    let again = true;
    act(() => { again = result.current.prepare(art); });
    expect(again).toBe(false);
    expect(result.current.clip!.key).toBe(key);
    expect(result.current.playing).toBe(true);
  });

  it("brings the still emoji back if the end is never reported", () => {
    const { result } = renderHook(() => useClipPlayer());
    act(() => { result.current.prepare(art); });
    const key = result.current.clip!.key;
    act(() => result.current.onReady(key));
    act(() => result.current.begin(false));
    act(() => { jest.advanceTimersByTime(art.ms + 2500 + 1000); });
    expect(result.current.clip).toBeNull();
  });

  it("drops a file that never arrives", () => {
    const { result } = renderHook(() => useClipPlayer());
    act(() => { result.current.prepare(art); });
    act(() => result.current.begin(true));
    act(() => { jest.advanceTimersByTime(5100); });
    expect(result.current.clip).toBeNull();
    expect(result.current.playing).toBe(false);
  });
});
