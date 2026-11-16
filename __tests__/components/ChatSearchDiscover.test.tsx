import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ScrollView: 'ScrollView',
  Share: { share: jest.fn(() => Promise.resolve()) },
  StyleSheet: { create: (s: unknown) => s, absoluteFill: {}, absoluteFillObject: {} },
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../../components/ui/Icon', () => 'Icon');
jest.mock('../../components/common/Avatar', () => 'Avatar');
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../hooks/useDebouncedValue', () => ({ useDebouncedValue: (v: unknown) => v }));
jest.mock('../../libs/misc', () => ({ getAvatarUrl: () => undefined }));
jest.mock('../../libs/cdnImage', () => ({ storageImageSource: () => undefined }));
jest.mock('../../libs/strings.util', () => ({ truncateAddress: (a: string) => a }));
jest.mock('../../services/supabase', () => ({ supabase: {} }));
jest.mock('../../services/user.service', () => ({ usersSearch: jest.fn() }));
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
const mockResults: Record<string, unknown[]> = {};
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: mockResults[queryKey[2] === 'people' ? 'people' : 'communities'], isLoading: false }),
}));
import ChatSearchDiscover from '../../components/DM/ChatSearchDiscover';

const render = (props: Partial<React.ComponentProps<typeof ChatSearchDiscover>> = {}) => {
  const all = { query: 'jake', myAddress: '0xme', knownAddresses: new Set(['0xknown']), onMessageUser: jest.fn(), onNewChat: jest.fn(), onNewGroup: jest.fn(), ...props };
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<ChatSearchDiscover {...all} />); });
  return { tree, ...all };
};
const byTestId = (tree: ReactTestRenderer, id: string) => tree.root.findAll((n) => n.props.testID === id && typeof n.type === 'string');

beforeEach(() => { mockNavigate.mockClear(); });

it('suggests people you have no chat with, matching communities and a full search', () => {
  mockResults.people = [
    { address: '0xA', username: 'jakeriv', displayName: 'Jake Rivers' },
    { address: '0xknown', username: 'already' },
    { address: '0xme', username: 'me' },
    { address: '0xB', username: 'jaket', dmSettings: { disables: ['NEW_DM'] } },
  ];
  mockResults.communities = [{ id: 'c', name: "Jake's Garage", slug: 'garage', member_count: 2400 }];
  const { tree, onMessageUser } = render();
  expect(byTestId(tree, 'chat-search-person-already')).toHaveLength(0);
  expect(byTestId(tree, 'chat-search-person-me')).toHaveLength(0);
  expect(byTestId(tree, 'chat-search-person-jaket')[0].props.disabled).toBe(true);
  act(() => byTestId(tree, 'chat-search-person-jakeriv')[0].props.onPress());
  expect(onMessageUser).toHaveBeenCalledWith(mockResults.people[0]);
  act(() => byTestId(tree, 'chat-search-community-garage')[0].props.onPress());
  expect(mockNavigate).toHaveBeenCalledWith('CommunityDetail', { slug: 'garage', tab: 'chat' });
});

it('still offers ways to start when nothing matches anywhere', () => {
  mockResults.people = [];
  mockResults.communities = [];
  const { tree } = render({ query: 'zzqx' });
  const texts = tree.root.findAll((n) => n.type === ('Text' as any)).map((n) => n.props.children);
  expect(texts).toContain('dm.searchDiscover.nothing');
  expect(texts).toContain('dm.searchDiscover.newChat');
});
