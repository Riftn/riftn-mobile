/**
 * Share a moment in the background: the creator closes at once and "Your
 * day" on the shelf fills as it uploads. A failure leaves the tile with a
 * retry, so nothing typed is lost. Same flow as web's story-upload.
 */
import { createStory, getStory, uploadStoryClip, type CreateStoryFields, type StoryItem } from "../../services/stories.service";
import { setPendingMoment } from "../../store/stories.store";
import { toastError, toastSuccess } from "../../libs/toast";
import { translateCopy as _translateCopy } from "../../i18n/copy";

export interface MomentToShare {
  kind: "photo" | "video";
  /** Photo: the flattened JPEG. Video: the clip as picked, or "" for a video post (the server cuts it from the post). */
  uri: string;
  mimeType: string;
  overlayUri?: string | null;
  preview: string;
  fields: Omit<CreateStoryFields, "draftVideoId">;
}

const POLL_MS = 2000;
const POLL_LIMIT_MS = 4 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function shareMoment(moment: MomentToShare, onDone: () => void) {
  const key = `${Date.now()}`;
  let pendingPostStory: StoryItem | undefined;
  let running = false;
  const update = (patch: Partial<{ progress: number; state: "uploading" | "processing" | "failed"; error: string; retry: () => void }>) =>
    setPendingMoment((p) => (p && p.key === key ? { ...p, ...patch } : p));

  const run = async () => {
    if (running) return;
    running = true;
    setPendingMoment({ key, preview: moment.preview, progress: 0.02, state: "uploading" });
    try {
      let created: StoryItem;
      if (moment.kind === "photo") {
        created = await createStory(
          moment.fields,
          { photo: { uri: moment.uri, name: "moment.jpg", type: moment.mimeType || "image/jpeg" } },
          (f) => update({ progress: Math.max(0.02, f) }),
        );
      } else if (!moment.uri && moment.fields.postTokenId != null) {
        created = pendingPostStory ?? await createStory(
          { ...moment.fields, type: "video" },
          { overlay: moment.overlayUri ? { uri: moment.overlayUri, name: "layer.png", type: "image/png" } : null },
          (f) => update({ progress: Math.max(0.02, f * 0.92) }),
        );
        pendingPostStory = created;
        update({ state: "processing", progress: 1 });
        const started = Date.now();
        while (created.status === "processing" && Date.now() - started < POLL_LIMIT_MS) {
          await sleep(POLL_MS);
          created = await getStory(created.id, true).then((r) => r.item).catch(() => created);
        }
        // After a timeout, retry checking the same Moment so late completion cannot create a duplicate.
        pendingPostStory = created.status === "processing" ? created : undefined;
        if (created.status !== "ready") throw new Error(created.error || "Moment video is not ready");
      } else {
        const ext = moment.mimeType.includes("quicktime") ? "mov" : "mp4";
        const draftId = await uploadStoryClip(
          { uri: moment.uri, name: `moment.${ext}`, mimeType: moment.mimeType || "video/mp4" },
          (f) => update({ progress: Math.max(0.02, f * 0.92) }),
        );
        created = await createStory(
          { ...moment.fields, draftVideoId: draftId },
          { overlay: moment.overlayUri ? { uri: moment.overlayUri, name: "layer.png", type: "image/png" } : null },
        );
        update({ state: "processing", progress: 1 });
        const started = Date.now();
        while (created.status === "processing" && Date.now() - started < POLL_LIMIT_MS) {
          await sleep(POLL_MS);
          created = await getStory(created.id, true).then((r) => r.item).catch(() => created);
        }
        if (created.status === "failed") throw new Error(created.error || "failed");
      }
      setPendingMoment((p) => (p && p.key === key ? null : p));
      onDone();
      toastSuccess(_translateCopy("stories.momentPublished", { defaultValue: "Your moment is up" }));
    } catch (err) {
      const e = err as { status?: number; message?: string } | null;
      const message =
        e?.status === 413 || /413|too large/i.test(String(e?.message))
          ? _translateCopy("stories.tooLarge", { defaultValue: "That file is too large." })
          : _translateCopy("stories.shareFailed", { defaultValue: "Your moment didn't go up. Tap your tile to try again." });
      update({ state: "failed", error: message, retry: () => void run() });
      toastError(message);
      onDone();
    } finally {
      running = false;
    }
  };
  void run();
}
