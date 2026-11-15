import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Shorts audio ownership', () => {
  const source = readFileSync(
    resolve(__dirname, '../../screens/ShortsViewerScreen.tsx'),
    'utf8',
  );

  it('uses one stable stop callback for both focus managers', () => {
    expect(source).toContain('requestFeedVideoFocus(stopPlayback);');
    expect(source).toContain('requestAudioFocus(stopPlayback);');
    expect(source).toContain('releaseFeedVideoFocus(stopPlayback);');
    expect(source).toContain('releaseAudioFocus(stopPlayback);');
  });

  it('rejects native playback events after a short becomes inactive', () => {
    expect(source).toContain('if (playing && ((!isActiveRef.current && !peekingRef.current && !isPictureInPicturePlayer(player)) || !canStartVideo(player)))');
    expect(source).toContain('if ((!isActiveRef.current && !isPictureInPicturePlayer(player)) || !canStartVideo(player))');
    expect(source).toMatch(/return \(\) => \{[\s\S]{0,200}?stopPlayback\(\);\s*releaseFeedVideoFocus/);
  });

  it('lets only the drag peek play ahead, and keeps it playing as it becomes active', () => {
    // The cleanup skips its pause only on the way from inactive to active.
    expect(source).toContain('if (!isActive && peekingRef.current) return;');
    // Only a loaded player is started early, silently.
    expect(source).toContain('if (player.status !== "readyToPlay" || player.playing) return;');
    expect(source).toContain('player.muted = true;');
    // A short being left gets the viewer's sound setting back when it stops.
    expect(source).toContain('player.muted = isMutedRef.current;');
  });
});
