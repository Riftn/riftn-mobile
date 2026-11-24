import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAccountProfile } from "../../services/user.service";
import { getAvatarUrl } from "../../libs/misc";
import { usePostOwnBg, useResolvedPostBg } from "./PostBackground";
import type { PostBg } from "../../libs/postBackgrounds";

type PostLike = Parameters<typeof usePostOwnBg>[0] & { minterUser?: { address?: unknown } | null };

/**
 * An opened text post's backdrop, away from the profile (the post screen): the
 * post's own if it has one, else its author's profile backdrop, so the post
 * opens on the same look its profile tile shows. `art` is the author's picture
 * for Profile Echo. Pass null for anything that is not a plain text post.
 */
export function useAuthorPostBg(post: PostLike | null | undefined): { bg: PostBg | null; art: string | null } {
  const own = usePostOwnBg(post);
  const raw = post ? (post.minter ?? post.minterUser?.address) : undefined;
  const minter = typeof raw === "string" && raw ? raw.toLowerCase() : undefined;
  const { data: author } = useQuery({
    queryKey: ["post-author-bg", minter],
    queryFn: () => getAccountProfile(minter!),
    enabled: !!minter && !own,
    staleTime: 5 * 60 * 1000,
  });
  const profileBg = useResolvedPostBg(minter, (author as any)?.customs);
  return useMemo(() => {
    const rawArt = (author as any)?.avatarImageUrl ? getAvatarUrl((author as any).avatarImageUrl, 96) : "";
    return { bg: post ? own ?? profileBg : null, art: /^https?:/.test(rawArt) ? rawArt : null };
  }, [post, own, profileBg, author]);
}
