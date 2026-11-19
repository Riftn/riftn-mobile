import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

describe("post detail advertising continuation", () => {
  const detail = readSource("screens/FeedDetailScreen.tsx");
  const continuation = readSource("components/Advertising/PostDetailContinuation.tsx");
  const serving = readSource("hooks/useAdServing.ts");
  const card = readSource("components/Advertising/SponsoredAdCard.tsx");

  it("places the continuation after the detail screen's comments", () => {
    expect(detail).toContain("{showAllCommentsRow}");
    expect(detail).toContain("const continuationLoadSignal = autoMorePosts ? morePostsSignal : undefined;");
    expect(detail).toContain('<PostDetailContinuation currentPostId={String(tokenId)} profileFeed={profileFeed} loadMoreSignal={continuationLoadSignal} drawGate={morePostsGate} />');
    expect(detail).toContain("ListFooterComponent={listFooter}");
    expect(detail.indexOf("{showAllCommentsRow}")).toBeLessThan(detail.indexOf("<PostDetailContinuation"));
  });

  it("puts the ad straight under phone text and image posts and keeps loading posts", () => {
    expect(detail).toContain('const leanPost = !!item && stage && !videoPost && !focusCommentId && resolveContentType(item) === "image";');
    expect(detail).toContain("data={leanPost ? EMPTY_COMMENTS : listComments}");
    expect(detail).toContain("onEndReached={handleEndReached}");
    expect(continuation).toContain("{hasNextPage && !autoLoad && !drawing && (");
  });

  it("draws the posts below one at a time, and asks for no page while it does", () => {
    expect(continuation).toContain("const [drawn, setDrawn] = useState(FIRST_POSTS);");
    expect(continuation).toContain("startTransition(() => setDrawn((n) => n + 1))");
    expect(continuation).toContain("{posts.slice(0, drawn).map((post) => (");
    expect(continuation).toContain("if (!loadMoreSignal || !hasNextPage || isFetchingNextPage || drawing) return;");
  });

  it("draws the posts far below only as the reader nears them", () => {
    expect(continuation).toContain("if (!drawing || !gateOpen) return;");
    expect(detail).toContain("morePostsGate.set(g.content - listBottomPadding < g.y + g.viewport * (1 + MORE_POSTS_AHEAD));");
  });

  it("uses the same served-ad and tracking endpoints as web", () => {
    expect(serving).toContain('supabase.functions.invoke("ads-serve"');
    expect(serving).toContain('supabase.functions.invoke("ads-track"');
    expect(serving).toContain("getAnonViewerId");
    expect(card).toContain('visibleRatio < 0.5');
    expect(card).toContain('>= 1000');
  });

  it("renders the advert before explicitly paginated more posts", () => {
    expect(continuation.indexOf("<SponsoredAdCard")).toBeLessThan(continuation.indexOf('t("ads.morePosts")'));
    expect(continuation).toContain('initialPageParam: 1');
    expect(continuation).toContain('accessibilityLabel={t("ads.loadMorePosts")}');
  });
});
