import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { renderLinkEmojis, LINK_EMOJI } from '../../components/common/LinkEmoji';
import { openInApp } from '../../libs/links.utils';

jest.mock('dehub-jsx/jsx-runtime', () => require('react/jsx-runtime'));
jest.mock('react-native', () => ({ Text: 'Text', StyleSheet: { flatten: (s: unknown) => (Array.isArray(s) ? Object.assign({}, ...s) : s) } }));
jest.mock('../../libs/links.utils', () => ({ openInApp: jest.fn() }));

describe('renderLinkEmojis', () => {
  beforeEach(() => jest.clearAllMocks());

  it('swaps a link for a tappable 🔗 and keeps the words around it', () => {
    const { getByText, getByLabelText } = render(<Text>{renderLinkEmojis('look https://github.com/riftn now')}</Text>);
    expect(getByText(LINK_EMOJI)).toBeTruthy();
    expect(getByText(/look/)).toBeTruthy();
    fireEvent.press(getByLabelText('https://github.com/riftn'));
    expect(openInApp).toHaveBeenCalledWith('https://github.com/riftn');
  });

  it('shows a <link> as its short address instead of the 🔗', () => {
    const { getByText, queryByText } = render(<Text>{renderLinkEmojis('go to <https://www.riftn.com/app/features>')}</Text>);
    expect(getByText('riftn.com/app/features')).toBeTruthy();
    expect(queryByText(LINK_EMOJI)).toBeNull();
  });

  it('leaves text with no link as plain strings', () => {
    expect(renderLinkEmojis('just words')).toEqual(['just words']);
  });
});
