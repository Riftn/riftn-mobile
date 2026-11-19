import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALWAYS_OPEN, createDrawGate } from "../../libs/drawGate";

const readSource = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("draw gate", () => {
  it("starts open and tells listeners only when it changes", () => {
    const gate = createDrawGate();
    const heard = jest.fn();
    const stop = gate.subscribe(heard);
    expect(gate.get()).toBe(true);

    gate.set(true);
    expect(heard).not.toHaveBeenCalled();

    gate.set(false);
    expect(gate.get()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);

    stop();
    gate.set(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(gate.get()).toBe(true);
  });

  it("is always open for a list nobody gates", () => {
    ALWAYS_OPEN.set(false);
    expect(ALWAYS_OPEN.get()).toBe(true);
  });
});

describe("pages that keep what they built", () => {
  it("keeps the app-wide bottom bar built and only hides it", () => {
    const bar = readSource("navigation/AppWideTabBar.tsx");
    expect(bar).toContain("if (!standDown) built.current = true;");
    expect(bar).toContain("if (!built.current) return null;");
    expect(bar).toContain('display: "none"');
    expect(bar).toContain('pointerEvents={standDown ? "none" : "box-none"}');
  });

  it("gives the post page's list the same header, footer and padding between keys", () => {
    const detail = readSource("screens/FeedDetailScreen.tsx");
    expect(detail).toContain("const listHeader = useMemo(() => renderHeader(), [renderHeader]);");
    expect(detail).toContain("ListHeaderComponent={listHeader}");
    expect(detail).toContain("contentContainerStyle={listContentStyle}");
    expect(detail).toContain("keyExtractor={commentKey}");
    // Comment rows are heavy: a few at a time, two screens kept each way.
    expect(detail).toContain("initialNumToRender={3}");
    expect(detail).toContain("maxToRenderPerBatch={3}");
    expect(detail).toContain("windowSize={5}");
  });

  it("gives Explore's list one header while the search box is typed in", () => {
    const search = readSource("screens/SearchScreen.tsx");
    expect(search).toContain("ListHeaderComponent={idleHeader}");
    expect(readSource("components/Search/ExploreCleanList.tsx")).toContain("export default memo(ExploreCleanList);");
  });

  it("lets a plain chat line send without waiting for the one before it", () => {
    const box = readSource("components/DM/ChatInputBar.tsx");
    expect(box).toContain("const plain = !gifUrl && !studio.length && !media && !editingMessage && !tipAmount && !replyTo;");
    expect(box).toContain("if (!text.trim() || plainTaken.current === text) return;");
    expect(box).toContain("else sendInFlight.current = false;");
  });
});
