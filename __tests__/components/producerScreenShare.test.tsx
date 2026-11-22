import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ProducerBottomBar from '../../components/LiveProducer/ProducerBottomBar';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../components/ui/cut-icons', () => ({ Radio: 'Radio', Video: 'Video', VideoOff: 'VideoOff', Mic: 'Mic', MicOff: 'MicOff', RefreshCw: 'RefreshCw' }));
jest.mock('lucide-react-native/dist/esm/icons/server', () => 'Server');
jest.mock('lucide-react-native/dist/esm/icons/palette', () => 'Palette');
jest.mock('lucide-react-native/dist/esm/icons/clapperboard', () => 'Clapperboard');
jest.mock('lucide-react-native/dist/esm/icons/screen-share', () => 'ScreenShare');

it('shows where to share before a camera stream and enables the control only once live', () => {
  const toggle = jest.fn();
  const props = { onStart: jest.fn(), onEnd: jest.fn(), micMuted: false, cameraOff: false,
    onToggleMic: jest.fn(), onToggleCamera: jest.fn(), onFlipCamera: jest.fn(), externalMode: false,
    onToggleExternal: jest.fn(), onToggleScreenShare: toggle };
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<ProducerBottomBar {...props} stage="ready" />); });
  const control = () => tree.root.findAllByProps({ onPress: toggle })[0];
  expect(control().props.disabled).toBe(true);
  expect(control().findByType('Text' as any).props.children).toContain('live.screenShare.start');
  act(() => { tree.update(<ProducerBottomBar {...props} stage="live" />); });
  expect(control().props.disabled).toBe(false);
  expect(control().findByType('Text' as any).props.children).toBe('live.screenShare.start');
  act(() => control().props.onPress());
  expect(toggle).toHaveBeenCalledTimes(1);
  act(() => { tree.update(<ProducerBottomBar {...props} stage="live" screenSharing />); });
  expect(control().findByType('Text' as any).props.children).toBe('live.screenShare.stop');
  act(() => { tree.update(<ProducerBottomBar {...props} stage="ended" />); });
  expect(control()).toBeUndefined();
  act(() => { tree.update(<ProducerBottomBar {...props} stage="ready" onToggleScreenShare={undefined} />); });
  expect(tree.root.findAllByType('ScreenShare' as any)).toHaveLength(0);
  act(() => tree.unmount());
});
