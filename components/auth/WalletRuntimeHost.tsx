import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { claimWalletPickerHost, useAppKitReady, useWalletPickerOwner } from '../../config/reown.config';
import { forgetDeviceVerification } from '../../libs/wallets.local';

function renderPicker() {
  const AppKit = require('@reown/appkit-ethers5-react-native').AppKit;
  return <AppKit />;
}

export default function WalletRuntimeHost() {
  const ready = useAppKitReady();
  const owner = useWalletPickerOwner();
  useEffect(() => {
    // A biometric sheet can make iOS inactive; only a real background transition
    // ends the grace period, so verification cannot invalidate itself.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') forgetDeviceVerification();
    });
    return () => subscription.remove();
  }, []);
  // A page presented above the root view draws the picker itself (see
  // claimWalletPickerHost in reown.config); one picker on screen at a time.
  if (!ready || owner) return null;
  return renderPicker();
}

/**
 * The wallet picker drawn inside a page that iOS presents as a native modal,
 * so it opens on top of that page instead of behind it. Place it last in the
 * page, outside anything that scrolls or drags.
 */
export function ScreenWalletPicker() {
  const ready = useAppKitReady();
  const owner = useWalletPickerOwner();
  const [token] = useState(() => Symbol('screen-wallet-picker'));
  useEffect(() => claimWalletPickerHost(token), [token]);
  if (!ready || owner !== token) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {renderPicker()}
    </View>
  );
}
