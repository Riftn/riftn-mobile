jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.19.2' }));

import { nativeCarriesCallRingtone, versionAtLeast } from '../../libs/call-ring-support';

describe('call ringtone support', () => {
  it('compares versions number by number', () => {
    expect(versionAtLeast('1.20.0', '1.20.0')).toBe(true);
    expect(versionAtLeast('1.21', '1.20.0')).toBe(true);
    expect(versionAtLeast('1.19.10', '1.20.0')).toBe(false);
    expect(versionAtLeast('2.0.0', '1.20.0')).toBe(true);
    expect(versionAtLeast(null, '1.20.0')).toBe(false);
  });

  it('is off on builds without the ringtone file', () => {
    expect(nativeCarriesCallRingtone()).toBe(false);
    expect(nativeCarriesCallRingtone('1.20.0')).toBe(true);
  });
});
