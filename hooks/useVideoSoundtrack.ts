import { useEffect } from "react";
import type { VideoPlayer } from "expo-video";
import { useMediaVolume } from "../libs/video-preferences";
import { holdVideoSoundtrack, refreshVideoSoundtrack } from "../libs/videoSoundtrack";

/** The post's song plays with its video. See libs/videoSoundtrack. */
export function useVideoSoundtrack(player: VideoPlayer | null | undefined, url: string | null | undefined): void {
  const master = useMediaVolume();
  useEffect(() => {
    if (!player || !url) return;
    return holdVideoSoundtrack(player, url);
  }, [player, url]);
  useEffect(() => { refreshVideoSoundtrack(player); }, [player, master]);
}
