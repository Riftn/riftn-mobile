import React from 'react';
import { Pressable } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { FeedCardHeader } from '../../components/Home/FeedCardHeader';
import { useLiveTarget } from '../../hooks/useIsUserLive';
import { openLiveTarget } from '../../libs/openLiveTarget';
import { MomentAvatarOutline, useFaceMoment, useOpenMoments } from '../../components/Stories/MomentPeek';

jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  StyleSheet: { flatten: (style: unknown) => style },
}));
jest.mock('react-native-reanimated', () => ({}));
jest.mock('react-native-svg', () => ({}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../context/ThemeContext', () => ({ useAppTheme: () => ({ isLight: false }) }));
jest.mock('../../hooks/useAmbientMotion', () => ({ useAmbientMotion: () => false }));
jest.mock('../../libs/perfTrace', () => ({ usePerfProbe: jest.fn() }));
jest.mock('../../components/common/Avatar', () => 'Avatar');
jest.mock('../../components/common/BadgeArtwork', () => 'BadgeArtwork');
jest.mock('../../components/common/NewMemberChip', () => 'NewMemberChip');
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('../../libs/misc', () => ({}));
jest.mock('../../libs/badgeShowcase', () => ({}));
jest.mock('../../hooks/useUserProfileData', () => ({ prefetchUserProfile: jest.fn() }));
jest.mock('../../hooks/useIsUserLive', () => ({
  useLiveTarget: jest.fn((address?: string) => address ? { kind: 'live' } : null),
}));
jest.mock('../../libs/openLiveTarget', () => ({ openLiveTarget: jest.fn() }));
jest.mock('../../components/common/CoAuthorBits', () => ({ CoAuthorAvatarBadge: () => null, CoAuthorNames: () => null }));
jest.mock('../../components/Stories/MomentPeek', () => ({
  MomentAvatarOutline: jest.fn(() => null),
  useFaceMoment: jest.fn(() => null),
  useOpenMoments: jest.fn(() => jest.fn()),
}));

it('uses the profile handler for a post avatar even when its author is live in the feed', () => {
  const showProfile = jest.fn();
  const props = { displayName: 'Araf', username: 'araf', address: 'author', onUserPress: showProfile };
  const view = render(<FeedCardHeader {...props} postPage />);

  fireEvent.press(view.getByLabelText('liveViewer.openProfileOf'));
  expect(showProfile).toHaveBeenCalledTimes(1);
  expect(useLiveTarget).toHaveBeenLastCalledWith(undefined, undefined);
  expect(openLiveTarget).not.toHaveBeenCalled();

  view.rerender(<FeedCardHeader {...props} />);
  fireEvent.press(view.UNSAFE_getAllByType(Pressable)[0]);
  expect(openLiveTarget).toHaveBeenCalledTimes(1);
  expect(showProfile).toHaveBeenCalledTimes(1);
});

it('uses the full avatar outline to open an active Moment from a feed card', () => {
  const moment: NonNullable<ReturnType<typeof useFaceMoment>> = { state: 'unseen', count: 2, cover: null };
  const openMoment = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useLiveTarget).mockReturnValueOnce(null);
  jest.mocked(useFaceMoment).mockReturnValueOnce(moment);
  jest.mocked(useOpenMoments).mockReturnValueOnce(openMoment);
  const view = render(<FeedCardHeader displayName="Araf" username="araf" address="author" avatarSize={36} />);

  expect(jest.mocked(MomentAvatarOutline).mock.lastCall?.[0]).toEqual({ peek: moment, radius: 6 });
  fireEvent.press(view.UNSAFE_getAllByType(Pressable)[0]);
  expect(openMoment).toHaveBeenCalledTimes(1);
});
