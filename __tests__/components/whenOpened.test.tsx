import React from 'react';
import { render } from '@testing-library/react-native';
import WhenOpened from '../../components/ui/WhenOpened';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));

// A host element stands in for the sheet: only whether it is built matters here.
const Sheet = 'Sheet' as unknown as React.FC<{ visible: boolean }>;

it('builds a sheet the first time it is opened and keeps it after it closes', () => {
  const build = jest.fn((open: boolean) => <Sheet visible={open} />);
  const tree = (open: boolean) => <WhenOpened open={open}>{() => build(open)}</WhenOpened>;

  const screen = render(tree(false));
  screen.rerender(tree(false));
  expect(build).not.toHaveBeenCalled();
  expect(screen.UNSAFE_queryByType('Sheet' as any)).toBeNull();

  screen.rerender(tree(true));
  expect(screen.UNSAFE_getByType('Sheet' as any).props.visible).toBe(true);

  // Closed again: still there, so it can animate out and keep its state.
  screen.rerender(tree(false));
  expect(screen.UNSAFE_getByType('Sheet' as any).props.visible).toBe(false);
});

it('builds at once when it starts open', () => {
  const screen = render(<WhenOpened open>{() => <Sheet visible />}</WhenOpened>);
  expect(screen.UNSAFE_getByType('Sheet' as any).props.visible).toBe(true);
});
