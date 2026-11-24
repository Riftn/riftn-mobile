import React from 'react';
import { act, create } from 'react-test-renderer';

// The real styling runtime needs a device; what is under test is the pass.
jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native-css-interop', () => ({ createInteropElement: jest.requireActual('react').createElement }));
jest.mock('react-native', () => ({ Text: 'Text', View: 'View', TextInput: 'TextInput', Modal: 'Modal', Platform: { OS: 'android' }, StyleSheet: { flatten: (s: unknown) => s } }));
jest.mock('react-native-gesture-handler', () => ({ TextInput: 'GestureTextInput' }));

const { setLightTone, tone } = require('../../libs/jsx/tone');
const { caretProps } = require('../../libs/jsx/caret');

afterEach(() => setLightTone(false));

function render(type: string, props: Record<string, unknown>) {
  const [t, p] = tone(type, caretProps(type, props));
  let tree: any;
  act(() => { tree = create(React.createElement(t, p)); });
  return tree;
}

it('leaves the dark themes alone', () => {
  const props = { value: 'hi' };
  expect(caretProps('TextInput', props)).toBe(props);
});

it('draws the typing line in ink on System Light', () => {
  setLightTone(true);
  const tree = render('TextInput', { value: 'hi' });
  expect(tree.root.findByType('TextInput' as any).props.cursorColor).toBe('hsla(0,0%,4.3%,1)');
  const gesture = render('GestureTextInput', { value: 'hi' });
  expect(gesture.root.findByType('GestureTextInput' as any).props.cursorColor).toBe('hsla(0,0%,4.3%,1)');
});

it('keeps the line white over a picture or live video', () => {
  setLightTone(true);
  const [field, fieldProps] = tone('TextInput', caretProps('TextInput', { value: 'hi' }));
  const [dark, darkProps] = tone('View', { className: 'dark-surface', children: React.createElement(field, fieldProps) });
  let tree: any;
  act(() => { tree = create(React.createElement(dark, darkProps)); });
  expect(tree.root.findByType('TextInput' as any).props.cursorColor).toBe('#FFFFFF');
});

it('keeps a colour a field already chose, and leaves other elements alone', () => {
  setLightTone(true);
  const own = { cursorColor: '#ef4444' };
  expect(caretProps('TextInput', own)).toBe(own);
  const text = { children: 'hi' };
  expect(caretProps('Text', text)).toBe(text);
});
