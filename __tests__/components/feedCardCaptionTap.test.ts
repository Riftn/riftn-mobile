/**
 * A tap on a post's caption opens the post page for every kind of post. On a
 * video only the picture goes to the player; a cut-off caption opens the rest
 * of its text on the first tap and the post on the next.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const card = readFileSync(resolve(__dirname, "../../components/Home/FeedCard.tsx"), "utf8");
const caption = readFileSync(resolve(__dirname, "../../components/Home/FeedCaption.tsx"), "utf8");

describe("tapping a caption in a post card", () => {
  it("only sends a video to the player when the tap was on the picture", () => {
    expect(card).toContain("if (toViewer && isVideo && !isLive && videoViewerReady) {");
    expect(card).toContain("const handleCardPress = useCallback(() => openPost(true), [openPost]);");
  });

  it("expands a cut-off caption before it opens the post", () => {
    const start = card.indexOf("const handleCaptionPress = useCallback(");
    const handler = card.slice(start, card.indexOf("}, [", start));
    expect(handler.indexOf("captionTapExpand.current?.()")).toBeGreaterThan(-1);
    expect(handler.indexOf("captionTapExpand.current?.()")).toBeLessThan(handler.indexOf("openPost(false)"));
  });

  it("gives every caption surface the caption handler", () => {
    const surfaces = card.split("<PostTapSurface").slice(1).map((part) => part.slice(0, part.indexOf("</PostTapSurface>")));
    const withCaption = surfaces.filter((part) => part.includes("<FeedCaption"));
    expect(withCaption.length).toBeGreaterThan(0);
    for (const part of withCaption) {
      expect(part).toContain("handleCaptionPress");
      expect(part).toContain("tapExpand={captionTapExpand}");
    }
  });

  it("lets the caption under a video open too", () => {
    expect(caption).toContain("numberOfLines={expanded ? MEDIA_OPEN_LINES : 2}");
  });
});
