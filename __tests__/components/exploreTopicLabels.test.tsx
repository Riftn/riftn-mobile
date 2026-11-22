jest.mock('react-native', () => ({
  Text: 'Text', View: 'View', Pressable: 'Pressable', StyleSheet: { create: (styles: object) => styles, hairlineWidth: 1, flatten: (style: unknown) => style },
  FlatList: ({ data, renderItem, keyExtractor }: any) => data.map((item: any) =>
    require('react').cloneElement(renderItem({ item }), { key: keyExtractor(item) })),
}));
jest.mock('dehub-jsx/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ExploreCategoryWords } from '../../components/Search/ExploreCleanList';
import tr from '../../i18n/locales/tr.json';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: () => 'Sizin için',
    i18n: {
      language: 'tr',
      getResource: (_lang: string, _namespace: string, key: string) =>
        key.split('.').reduce((node: any, part: string) => node?.[part], require('../../i18n/locales/tr.json')),
    },
  }),
}));
jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ isTranslated: true, translatedTexts: { name: 'Yeni konu' } }),
}));
jest.mock('../../services/supabase', () => ({}));
jest.mock('../../components/Search/ExploreSection', () => ({}));
jest.mock('../../components/Search/TickerLogo', () => () => null);
jest.mock('../../hooks/useTrendingCategories', () => ({}));
jest.mock('../../components/Home/LiveNowBar', () => ({}));
jest.mock('../../components/Home/SuggestedAccountsSection', () => () => null);
jest.mock('../../components/common/NewMembersRail', () => () => null);
jest.mock('../../components/Search/ExploreRadioShows', () => () => null);
jest.mock('../../components/ui/Icon', () => () => null);

it('localizes the pictured headings and preserves the original category on tap', () => {
  const change = jest.fn();
  const view = render(<ExploreCategoryWords categories={['general','funny','humor','meme','riftn','life','unknown']}
    value="humor" onChange={change} />);
  for (const label of ['Sizin için', tr.settings.general, tr.liveStudio.bot.personalities.funny, 'Mizah', 'Meme', 'Riftn', 'Hayat', 'Yeni konu']) {
    expect(view.getByText(label)).toBeTruthy();
  }
  fireEvent.press(view.getByText('Mizah'));
  expect(change).toHaveBeenCalledWith('humor');
  fireEvent.press(view.getByText('Yeni konu'));
  expect(change).toHaveBeenCalledWith('unknown');
});
