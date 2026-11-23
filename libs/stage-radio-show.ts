/**
 * Radio shows: a stage that is music first. Twin of web's
 * src/lib/stage-radio-show.ts.
 *
 * A radio show is an ordinary stage whose host opened it as a radio show. The
 * mark is the channel name's prefix, minted once when the stage is created
 * and never changed, so no table change is needed. The Agora token function
 * looks channels up by exact name, so the prefix changes nothing about who
 * may speak.
 */
export const RADIO_CHANNEL_PREFIX = "radio_";

export function newStageChannelName(radio = false): string {
  return `${radio ? RADIO_CHANNEL_PREFIX : "stage_"}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function isRadioShow(space?: { channel_name?: string | null } | null): boolean {
  return !!space?.channel_name && space.channel_name.startsWith(RADIO_CHANNEL_PREFIX);
}
