import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StreamChatRewards } from '../../components/LiveViewer/StreamChatRewards';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({ ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (styles: unknown) => styles } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }) }));
jest.mock('../../components/LiveViewer/PointsIcon', () => ({ PointsIcon: () => null }));

it('shows offers, costs and earlier redemptions below chat, and hides the strip in an empty room', () => {
  const summary = {
    live: true, creator: 'host', rewards: [{ id: '1', title: 'Choose a track', cost: 150, enabled: true, needsText: true }],
    recentRedemptions: [{ id: 'r1', title: 'Hydrate' }],
    giving: { enabled: false, dailyCap: 500 },
  };
  let view!: ReactTestRenderer;
  act(() => { view = create(<StreamChatRewards summary={summary} />); });
  const text = view.root.findAll(n => String(n.type) === 'Text').map(n => n.props.children);
  expect(text).toEqual(expect.arrayContaining(['Choose a track', '150', 'Hydrate']));
  act(() => { view.update(<StreamChatRewards summary={{ ...summary, rewards: [], recentRedemptions: [] }} />); });
  expect(view.toJSON()).toBeNull();
  act(() => { view.unmount(); });
});
