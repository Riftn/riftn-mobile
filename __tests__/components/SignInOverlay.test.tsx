import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { SignInOverlay } from '../../screens/auth/SignInScreen';
import { useAuthActions, useAuthState } from '../../context/AuthContext';

jest.mock('react-native-css-interop/jsx-runtime', () => jest.requireActual('react/jsx-runtime'));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', Modal: 'NativeSheet', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' },
  StyleSheet: { create: (styles: unknown) => styles },
}));
jest.mock('../../context/AuthContext', () => ({ useAuthActions: jest.fn(), useAuthState: jest.fn() }));
jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: 'GestureDetector', GestureHandlerRootView: 'GestureRoot', ScrollView: 'ScrollView',
}));
jest.mock('react-native-reanimated', () => ({ __esModule: true, default: { View: 'AnimatedView' } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@react-navigation/native', () => ({}));
jest.mock('../../hooks/useComposerSheet', () => ({ useComposerSheet: () => ({}) }));
jest.mock('../../hooks/useKeyboardLayout', () => ({ useKeyboardOffset: () => 0 }));
jest.mock('../../components/auth/WalletRuntimeHost', () => ({ ScreenWalletPicker: 'WalletPicker' }));
jest.mock('../../libs/oauth-cold-start', () => ({ takeHeldCallback: () => null }));
jest.mock('../../components/auth/UsernameRequiredForm', () => ({ UsernameRequiredForm: 'ProfileForm' }));
jest.mock('../../components/auth/AuthControls', () => ({ AuthButton: 'Button', AuthErrorNotice: 'Error', authColors: {}, authText: {} }));
jest.mock('../../components/auth/SocialLoginIcons', () => 'SocialLogin');
jest.mock('../../components/auth/EmailCodeEntry', () => 'EmailCode');
jest.mock('../../components/auth/SignInSavedProfiles', () => 'SavedProfiles');
jest.mock('../../components/auth/LoginShortsStack', () => 'LoginShortsStack');
jest.mock('../../components/auth/WalletSetupScreen', () => 'WalletSetup');
jest.mock('../../components/auth/SignInHandoff', () => ({ SignInWaitVeil: 'Loader' }));
jest.mock('../../hooks/useWalletAuth', () => ({ useWalletAuth: () => ({ isWalletLoading: false, isWalletSheetOpen: false }) }));
jest.mock('../../hooks/useScrollFieldIntoView', () => ({ useScrollFieldIntoView: () => ({ scrollViewProps: {} }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }), Trans: 'Trans' }));
jest.mock('../../config/constants', () => ({ ChainId: { BASE_MAINNET: 8453 } }));
jest.mock('../../libs/links.utils', () => ({}));
jest.mock('../../libs/auth.utils', () => ({}));
jest.mock('../../services/auth/supabaseAuth.service', () => ({}));
jest.mock('../../libs/identity-wallet', () => ({}));
jest.mock('../../libs/provision-and-sign-in', () => ({}));
jest.mock('../../libs/wallet-core/crypto', () => ({}));
jest.mock('../../libs/wallet-core/store', () => ({}));
jest.mock('../../libs/wallet-core/replacement', () => ({}));
jest.mock('../../libs/wallet-core/derive', () => ({}));
jest.mock('../../libs/wallet-core/assert-wallet-address', () => ({}));
jest.mock('../../services/localwallet.provider', () => ({}));
jest.mock('../../libs/provider.registry', () => ({}));
jest.mock('../../libs/wallet-core/smart-account', () => ({}));
jest.mock('../../services', () => ({}));

it('keeps the same native sheet open through signup and locks backdrop dismissal', () => {
  const completeUsername = jest.fn();
  const signOut = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  (useAuthActions as jest.Mock).mockReturnValue({ completeUsername, signOut });
  (useAuthState as jest.Mock).mockReturnValue({ needsUsername: false, isLoading: false });
  const screen = render(<SignInOverlay onClose={onClose} />);
  const sheet = screen.UNSAFE_getByType('NativeSheet' as any);
  expect(sheet.props.visible).toBe(true);
  expect(sheet.props.allowSwipeDismissal).toBe(true);
  expect(screen.UNSAFE_queryAllByType('SocialLogin' as any)).toHaveLength(1);
  expect(screen.queryByText('common.cancel')).toBeNull();
  fireEvent(sheet, 'requestClose');
  expect(onClose).toHaveBeenCalledTimes(1);
  onClose.mockClear();

  const provisionalUser = { address: 'new-account' };
  (useAuthState as jest.Mock).mockReturnValue({ needsUsername: true, provisionalUser, isLoading: false });
  screen.rerender(<SignInOverlay onClose={onClose} />);
  expect(screen.UNSAFE_getByType('NativeSheet' as any)).toBe(sheet);
  expect(sheet.props.visible).toBe(true);
  expect(sheet.props.allowSwipeDismissal).toBe(false);
  fireEvent(sheet, 'requestClose');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.UNSAFE_queryAllByType('SocialLogin' as any)).toHaveLength(0);
  const form = screen.UNSAFE_getByType('ProfileForm' as any);
  expect(form.props.provisionalUser).toBe(provisionalUser);
  const finalUser = { ...provisionalUser, username: 'newuser' };
  fireEvent(form, 'complete', finalUser);
  expect(completeUsername).toHaveBeenCalledWith(finalUser);
  fireEvent(form, 'signOut');
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
});
