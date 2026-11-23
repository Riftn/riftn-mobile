/**
 * Live Requests comments
 * ======================
 * `feature_request_comments` is not in the database's realtime publication,
 * so there are no row events to listen to. Instead every client that writes a
 * comment, edit, delete or reaction pings a public broadcast topic for that
 * request, and every open thread on it refetches. Web uses the same topic and
 * event, so a comment posted on riftn.com shows up in the app and back.
 *
 * Broadcast has no backlog and older builds do not ping, so the open thread
 * also polls (see useFeatureRequestThread) as a safety net.
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../services/supabase";

export const FEATURE_COMMENTS_EVENT = "changed";
export const featureCommentsTopic = (featureRequestId: string) => `feature-request-comments:${featureRequestId}`;

/** Tell everyone viewing this request that its comments changed. Best-effort. */
export function pingFeatureComments(featureRequestId: string): void {
  try {
    supabase
      .channel(featureCommentsTopic(featureRequestId))
      .send({ type: "broadcast", event: FEATURE_COMMENTS_EVENT, payload: { at: Date.now() } })
      .catch(() => {});
  } catch {
    // A missed ping only means the other side waits for its next poll.
  }
}

/**
 * Call `onChange` whenever someone else changes this request's comments, and
 * once more on every (re)join so anything missed while disconnected is read.
 */
export function watchFeatureComments(featureRequestId: string, onChange: () => void): () => void {
  let joinedOnce = false;
  const channel: RealtimeChannel = supabase
    .channel(featureCommentsTopic(featureRequestId))
    .on("broadcast", { event: FEATURE_COMMENTS_EVENT }, () => onChange());
  channel.subscribe((status) => {
    if (status !== "SUBSCRIBED") return;
    // The first join happens right after the query's own first fetch.
    if (joinedOnce) onChange();
    joinedOnce = true;
  });
  return () => { void supabase.removeChannel(channel).catch(() => undefined); };
}
