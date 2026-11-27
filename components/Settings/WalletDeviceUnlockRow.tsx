import { useTranslation as _useCopy } from 'react-i18next';
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useUser } from '../../context/AuthContext';
import {
  BiometricRejectedError,
  BiometricUnavailableError,
  getBiometricCapability,
  requireDeviceOwner,
  type BiometricCapability,
} from '../../libs/biometric-gate';
import { requestWalletUnlock } from '../../libs/wallet-lock';
import {
  hasPrivateKeyForAddress,
  rememberSuccessfulWalletUnlock,
} from '../../libs/wallets.local';
import { toastError, toastInfo, toastSuccess } from '../../libs';
import { SettingsLinkRow } from './SettingsPrimitives';

type State = {
  capability: BiometricCapability;
  hasDeviceKey: boolean;
};

const EMPTY_CAPABILITY: BiometricCapability = {
  usable: false,
  hasHardware: false,
  isEnrolled: false,
  passcodeOnly: false,
};

/**
 * Native biometric wallet access is deliberately device-local. A WebAuthn
 * passkey enrolled on dehub.io cannot release bytes from the APK's SecureStore;
 * the phone needs the wallet password/recovery material once, then the
 * phone’s fingerprint, face or screen lock protects signing on this installation.
 */
const WalletDeviceUnlockRow: React.FC = () => {
  const { t: _copy } = _useCopy();
  const user = useUser();
  const address = (user?.walletAddress || user?.address || '').toLowerCase();
  const [state, setState] = useState<(State & { address: string }) | null>(null);
  const current = state?.address === address ? state : null;
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [capability, key] = await Promise.allSettled([
      getBiometricCapability(),
      hasPrivateKeyForAddress(address),
    ]);
    setState({
      address,
      capability: capability.status === 'fulfilled' && key.status === 'fulfilled'
        ? capability.value
        : { ...EMPTY_CAPABILITY, unavailable: true },
      hasDeviceKey: key.status === 'fulfilled' && key.value,
    });
  }, [address]);

  useFocusEffect(useCallback(() => {
    void refresh();
  }, [refresh]));

  const handlePress = useCallback(async () => {
    if (busy || !address || !current) return;
    const { capability } = current;
    if (capability.unavailable) {
      await refresh();
      return;
    }
    if (!capability.usable) {
      toastInfo(_copy("copy.7c058e0ece4e", { defaultValue: "Set up a fingerprint, face unlock, or screen lock in your phone settings first." }));
      return;
    }

    setBusy(true);
    try {
      if (current.hasDeviceKey) {
        const outcome = await requireDeviceOwner(_copy("copy.37b05565987b", { defaultValue: "Verify Riftn wallet unlock" }));
        if (outcome !== 'verified') throw new BiometricUnavailableError();
        rememberSuccessfulWalletUnlock();
        toastSuccess(_copy('settings.walletDeviceUnlockVerified', { defaultValue: 'Device unlock verified' }));
      } else {
        const unlocked = await requestWalletUnlock(_copy('settings.walletDeviceUnlockSetup', { defaultValue: 'Set up wallet unlock on this phone' }));
        if (!unlocked) return;
        const hasDeviceKey = await hasPrivateKeyForAddress(address);
        if (!hasDeviceKey) {
          throw new Error(
            _copy("copy.646e214f812b", { defaultValue: "The wallet key is not available on this phone yet. Restore this wallet with an existing password, recovery phrase, or private key before enabling device unlock." }),
          );
        }
        const latestCapability = await getBiometricCapability();
        if (!latestCapability.usable) throw new BiometricUnavailableError();
        toastSuccess(_copy('settings.walletDeviceUnlockReady', { defaultValue: 'Device unlock is ready on this phone' }));
      }
      await refresh();
    } catch (error) {
      if (error instanceof BiometricRejectedError) {
        toastInfo(_copy("copy.6100e1990a48", { defaultValue: "Verification cancelled" }));
      } else {
        toastError(error, _copy('settings.walletDeviceUnlockError', { defaultValue: 'Could not set up wallet unlock on this phone' }));
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [address, busy, current, refresh, _copy]);

  const capability = current?.capability;
  let value = _copy("copy.ec963ffc911b", { defaultValue: "Checking…" });
  let description: string | undefined;
  if (capability?.unavailable) {
    value = _copy("copy.942087cc2d41", { defaultValue: "Retry" });
    description = _copy('settings.walletDeviceUnlockUnknown', { defaultValue: 'Couldn’t check wallet unlock on this phone. Tap to try again.' });
  } else if (capability && !capability.usable) {
    value = _copy("copy.d19d9442bb64", { defaultValue: "Device lock needed" });
    description = _copy("copy.2832651739ac", { defaultValue: "Add a fingerprint, face unlock, or screen lock to protect wallet actions." });
  } else if (current?.hasDeviceKey) {
    value = _copy("copy.130011756125", { defaultValue: "On" });
    description = capability?.passcodeOnly
      ? _copy('settings.walletScreenLockActive', { defaultValue: 'This wallet uses your phone’s screen lock for verification. Add a fingerprint or face unlock in your phone settings to use biometrics.' })
      : _copy('settings.walletBiometricDeviceLockActive', { defaultValue: 'This wallet uses fingerprint, face or screen lock verification on this phone. Browser passkeys are set up separately.' });
  } else if (current) {
    value = _copy("copy.4da10f1fbb17", { defaultValue: "Set up" });
    description = _copy("copy.0841e1f9f1c6", { defaultValue: "Restore this wallet on this phone using an existing wallet password, recovery phrase, or private key. Then protect it with your phone’s device lock." });
  }

  return (
    <SettingsLinkRow
      icon="Fingerprint"
      label={_copy('settings.walletDeviceUnlock', { defaultValue: 'Wallet device unlock' })}
      description={description}
      value={value}
      disabled={busy || !address || !current}
      onPress={handlePress}
    />
  );
};

export default WalletDeviceUnlockRow;
