import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProfileMuteRow } from '../../components/UserProfile/ProfileMuteRow';
import { getMuteStatus, muteUser, unmuteUser } from '../../services/mute.service';

jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({ Text: 'Text', View: 'View', TouchableOpacity: 'TouchableOpacity' }));
jest.mock('../../services/mute.service', () => ({ getMuteStatus: jest.fn(), muteUser: jest.fn(), unmuteUser: jest.fn() }));
jest.mock('../../libs', () => ({ toastError: jest.fn() }));
jest.mock('@expo/vector-icons/Ionicons', () => () => null);
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('uses the stored relationship and confirms each change before displaying the reverse action', async () => {
  (getMuteStatus as jest.Mock).mockResolvedValue({ status: true, youMuted: true });
  (muteUser as jest.Mock).mockResolvedValue({ status: true });
  (unmuteUser as jest.Mock).mockResolvedValue({ status: true });
  const client = new QueryClient();
  let tree!: ReactTestRenderer;
  const settled = () => new Promise(resolve => setTimeout(resolve, 16));
  await act(async () => {
    tree = create(<QueryClientProvider client={client}><ProfileMuteRow address="author" viewerAddress="viewer" /></QueryClientProvider>);
    await settled();
  });
  const label = () => tree.root.findByType(Text).props.children;
  const press = async () => {
    await act(async () => { tree.root.findByType(TouchableOpacity).props.onPress(); await settled(); });
  };
  for (let n = 0; label() !== 'keywordFilters.remove' && n < 30; n++) await act(settled);
  expect(label()).toBe('keywordFilters.remove');
  await press();
  expect(unmuteUser).toHaveBeenCalledWith('author');
  expect(label()).toBe('keywordFilters.add');
  await press();
  expect(muteUser).toHaveBeenCalledWith('author');
  expect(label()).toBe('keywordFilters.remove');
  act(() => tree.unmount());
  client.clear();
});
