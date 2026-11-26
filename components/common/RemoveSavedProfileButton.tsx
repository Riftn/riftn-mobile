import React from 'react';
import { Alert, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { removeSavedProfile, type StoredProfile } from '../../libs/profiles';
import Icon from '../ui/Icon';

export default function RemoveSavedProfileButton({ profile, disabled, onRemovingChange }: {
  profile: StoredProfile;
  disabled: boolean;
  onRemovingChange: (removing: boolean) => void;
}) {
  const { t } = useTranslation();
  const name = profile.username ? `@${profile.username}` : profile.name || profile.address;
  const label = t('settings.profileRemoveNamed', 'Remove {{name}}', { name });

  const remove = async () => {
    onRemovingChange(true);
    try {
      await removeSavedProfile(profile.address);
    } catch {
      Alert.alert(t('settings.profileRemoveFailed', 'Could not remove the saved account. Try again.'));
    } finally {
      onRemovingChange(false);
    }
  };

  const confirm = () => Alert.alert(
    label,
    t('settings.profileRemoveDescription', 'This removes the saved sign-in from this device. You can add the account again by signing in.'),
    [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.profileRemoveAction', 'Remove'), style: 'destructive', onPress: () => void remove() },
    ],
  );

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={confirm}
      style={styles.button}
    >
      <Icon name="X" size={17} color="#A1A1AA" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
