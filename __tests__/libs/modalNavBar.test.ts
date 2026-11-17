jest.mock('react-native', () => ({ Platform: { OS: 'android' }, Modal: 'Modal', View: 'View', StyleSheet: { flatten: (s: unknown) => s } }));

const { modalProps } = require('../../libs/jsx/modal');
const { setLightTone } = require('../../libs/jsx/tone');

afterEach(() => setLightTone(false));

it('keeps Android pop-ups off the phone-coloured translucent bar in the dark themes', () => {
  const props = { transparent: true, statusBarTranslucent: true, navigationBarTranslucent: true };
  expect(modalProps('Modal', props)).toEqual({ ...props, navigationBarTranslucent: false });
});

it('leaves System Light, other elements and plain modals alone', () => {
  const props = { navigationBarTranslucent: true };
  setLightTone(true);
  expect(modalProps('Modal', props)).toBe(props);
  setLightTone(false);
  expect(modalProps('View', props)).toBe(props);
  const plain = { transparent: true };
  expect(modalProps('Modal', plain)).toBe(plain);
});
