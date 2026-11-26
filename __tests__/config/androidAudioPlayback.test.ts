import { readFileSync } from 'fs';
import { join } from 'path';

it('registers the Expo Audio service for background playback in the checked-in Android app', () => {
  const manifest = readFileSync(join(__dirname, '../../android/app/src/main/AndroidManifest.xml'), 'utf8');
  const service = manifest.match(/<service\b(?=[^>]*\bandroid:name="expo\.modules\.audio\.service\.AudioControlsService")[^>]*>[\s\S]*?<\/service>/)?.[0];

  expect(service).toContain('android:exported="false"');
  expect(service).toContain('android:foregroundServiceType="mediaPlayback"');
  expect(service).toContain('android:name="androidx.media3.session.MediaSessionService"');
  expect(manifest).toContain('android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"');
});
