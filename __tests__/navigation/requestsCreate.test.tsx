import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StackRouter } from '@react-navigation/routers';
import { ScreenNames } from '../../navigation/ScreenNames';
import StandaloneTabBar from '../../navigation/StandaloneTabBar';
import FloatingBottomTabBar from '../../navigation/FloatingBottomTabBar';

jest.mock("react-native-css-interop/jsx-runtime", () => jest.requireActual("react/jsx-runtime"));
const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
let mockRouteName = ScreenNames.FeatureRequests;
jest.mock('../../App', () => ({ navigationRef: {
  isReady: () => true,
  getCurrentRoute: () => ({ name: mockRouteName, key: 'active-board' }),
  navigate: (...args: unknown[]) => mockNavigate(...args),
  dispatch: (...args: unknown[]) => mockDispatch(...args),
} }));
jest.mock('../../navigation/FloatingBottomTabBar', () => () => null);
jest.mock('../../libs/tab-bar-presence', () => ({ useRegisterOwnTabBar: jest.fn() }));
jest.mock('../../context/AuthContext', () => ({
  useAuthState: () => ({ isSignedIn: true }), useAuthActions: () => ({}),
}));

it('targets the existing Requests board and keeps post creation on other pages', () => {
  let tree!: ReactTestRenderer;
  act(() => { tree = create(<StandaloneTabBar appWide />); });
  const tapCreate = () => tree.root.findByType(FloatingBottomTabBar).props.navigation.navigate(ScreenNames.UploadTab);
  tapCreate();
  expect(mockNavigate).not.toHaveBeenCalled();
  const router = StackRouter({});
  const options = { routeNames: [ScreenNames.FeatureRequests], routeParamList: {}, routeGetIdList: {} };
  const state = router.getInitialState(options);
  state.routes[0] = { ...state.routes[0], key: 'active-board', params: { requestId: '42', tab: 'shipped' } };
  const next = router.getStateForAction(state, mockDispatch.mock.calls[0][0], options);
  expect(next?.routes).toEqual([{ ...state.routes[0], params: { requestId: '42', tab: 'shipped', composeRequest: true } }]);
  mockRouteName = ScreenNames.Explore;
  tapCreate();
  expect(mockNavigate).toHaveBeenCalledWith(ScreenNames.Upload);
  act(() => tree.unmount());
});
