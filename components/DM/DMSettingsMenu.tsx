import MessageSurface from "../DM/MessageSurface";
import React from 'react';
import { Modal, TouchableOpacity, View, Text, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../context/ThemeContext';

export type DMSettingsMenuProps = {
  visible: boolean;
  onClose: () => void;
  /** Left out where a + button already starts a chat. */
  onNewDM?: () => void;
  /** Messages screen: the one menu also holds tabs, select and refresh. */
  onNewTab?: () => void;
  onEditTabs?: () => void;
  onSelect?: () => void;
  onRefresh?: () => void;
  /** Distance from the safe area top to the menu. */
  offsetTop?: number;
  onOpenDmSettings: () => void;
  dnd: boolean;
  onToggleDnd: () => void;
};

const DMSettingsMenu: React.FC<DMSettingsMenuProps> = ({
  visible,
  onClose,
  onNewDM,
  onOpenDmSettings,
  dnd,
  onToggleDnd,
  onNewTab,
  onEditTabs,
  onSelect,
  onRefresh,
  offsetTop = 56,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { skin } = useAppTheme();
  // Stays mounted so closing fades the menu out instead of dropping it.
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onClose}
        // A plain scrim, not `dark-surface`: that kept the white labels white
        // inside the pale System Light panel, so the menu read as blank.
        className="flex-1"
        style={Platform.OS === 'android' ? undefined : { backgroundColor: 'rgba(0,0,0,0.4)' }}
      >
        <View
          style={[{ top: insets.top + offsetTop }, Platform.OS === 'android' && skin && { ...skin.card, backgroundColor: skin.page }]}
          className="absolute right-3 w-52 rounded-xl overflow-hidden"
        >
          <MessageSurface radius={12} />
          {([
            onNewDM && { key: 'dm', icon: 'chatbox-ellipses-outline', label: t('dm.newDm'), onPress: onNewDM },
            onNewTab && { key: 'tab', icon: 'add', label: t('chatTabs.new', { defaultValue: 'New tab' }), onPress: onNewTab },
            onEditTabs && { key: 'tabs', icon: 'albums-outline', label: t('chatTabs.edit', { defaultValue: 'Edit tabs' }), onPress: onEditTabs },
            onSelect && { key: 'select', icon: 'checkmark-done-outline', label: t('chatBulk.select', { defaultValue: 'Select chats' }), onPress: onSelect },
            onRefresh && { key: 'refresh', icon: 'refresh', label: t('dao.refresh'), onPress: onRefresh },
          ].filter(Boolean) as { key: string; icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }[]).map((row) => (
            <React.Fragment key={row.key}>
              <TouchableOpacity
                testID={`dm-menu-${row.key}`}
                className="flex-row items-center px-3 py-3 active:opacity-70"
                onPress={row.onPress}
                accessibilityRole="button"
              >
                <Ionicons name={row.icon} size={18} color="#E5E7EB" />
                <Text className="ml-2 text-theme-neutrals-100 text-sm">{row.label}</Text>
              </TouchableOpacity>
              <View className="h-[1px] bg-theme-neutrals-700/60" />
            </React.Fragment>
          ))}
          <TouchableOpacity
            className="flex-row items-center px-3 py-3 active:opacity-70"
            onPress={onOpenDmSettings}
            accessibilityRole="button"
          >
            <Ionicons name="options-outline" size={18} color="#E5E7EB" />
            <Text className="ml-2 text-theme-neutrals-100 text-sm">{t('dm.dmSettings')}</Text>
          </TouchableOpacity>
          <View className="h-[1px] bg-theme-neutrals-700/60" />
          <TouchableOpacity
            className="flex-row items-center px-3 py-3 active:opacity-70"
            onPress={onToggleDnd}
            accessibilityRole="button"
          >
            <Ionicons name={dnd ? 'moon' : 'moon-outline'} size={18} color={dnd ? '#D4D4D8' : '#E5E7EB'} />
            <Text className="ml-2 text-theme-neutrals-100 text-sm">{dnd ? t('dm.doNotDisturbOn') : t('dm.doNotDisturb')}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

export default DMSettingsMenu;
