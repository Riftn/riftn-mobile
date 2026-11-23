import { useAppTheme } from '../../context/ThemeContext';
import MessageSurface from "../DM/MessageSurface";
import React from 'react';
import { Modal, Pressable, TouchableOpacity, View, Text, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from '../ui/Icon';
import type { IconName } from '../ui/Icon';

export type ChatMenuProps = {
  visible: boolean;
  onClose: () => void;
  isBlocked?: boolean;
  onBlockUser: () => void;
  onUnblockUser?: () => void;
  onSearchChat?: () => void;
  onManageDmFee?: () => void;
  onClearChat?: () => void;
  /** Turn end-to-end encryption on or off for this chat. */
  onToggleEncryption?: () => void;
  /** Whether "Encrypt chat" is on for this chat. */
  encrypted?: boolean;
  /** Send your messages in the other person's language, or stop. */
  onToggleTranslateOut?: () => void;
  /** Whether "Send in their language" is on for this chat. */
  translateOut?: boolean;
  /** Toggle free access for the peer (creator only). */
  onToggleFreeAccess?: () => void;
  /** Report the person in this chat (App Review 1.2). */
  onReportUser?: () => void;
  /** Whether the peer currently has free access. */
  peerHasFreeAccess?: boolean;
  isCreator?: boolean;
};

type MenuRowProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  foreground: string;
};

const MenuRow: React.FC<MenuRowProps> = ({ icon, label, onPress, foreground }) => (
  <TouchableOpacity
    className="flex-row items-center px-3 py-3 active:opacity-70"
    onPress={onPress}
    accessibilityRole="button"
  >
    <Icon name={icon} size={18} color={foreground} />
    <Text className="ml-2 text-sm" style={{ color: foreground }}>{label}</Text>
  </TouchableOpacity>
);

const ChatMenu: React.FC<ChatMenuProps> = ({
  visible,
  onClose,
  isBlocked,
  onBlockUser,
  onUnblockUser,
  onSearchChat,
  onManageDmFee,
  onClearChat,
  onToggleEncryption,
  encrypted,
  onToggleTranslateOut,
  translateOut,
  onToggleFreeAccess,
  peerHasFreeAccess,
  isCreator,
  onReportUser,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  // Stays mounted so closing fades the menu out instead of dropping it.
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1 }}
        className="bg-black/40"
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ top: insets.top + 56 }}
          className="absolute right-3 w-52 rounded-xl overflow-hidden"
        >
          <MessageSurface radius={12} />
          <ScrollView bounces={false}>
            {onSearchChat && (
              <>
                <MenuRow
                  foreground={colors.foreground}
                  icon="Search"
                  label={t('dm.searchInChat')}
                  onPress={() => { onClose(); onSearchChat(); }}
                />
                <View className="h-[1px]" style={{ backgroundColor: colors.border }} />
              </>
            )}

            {onToggleEncryption && (
              <>
                <MenuRow
                  foreground={colors.foreground}
                  icon={encrypted ? "LockOpen" : "Lock"}
                  label={encrypted
                    ? t('messages.encryptChatOff', { defaultValue: 'Turn off encryption' })
                    : t('messages.encryptChat', { defaultValue: 'Encrypt chat' })}
                  onPress={() => { onClose(); onToggleEncryption(); }}
                />
                <View className="h-[1px]" style={{ backgroundColor: colors.border }} />
              </>
            )}

            {onToggleTranslateOut && (
              <>
                <MenuRow
                  foreground={colors.foreground}
                  icon="Languages"
                  label={translateOut
                    ? t('dm.translateOutOff', { defaultValue: 'Send as I type' })
                    : t('dm.translateOut', { defaultValue: 'Send in their language' })}
                  onPress={() => { onClose(); onToggleTranslateOut(); }}
                />
                <View className="h-[1px]" style={{ backgroundColor: colors.border }} />
              </>
            )}

            {onClearChat && (
              <>
                <MenuRow
                  foreground={colors.foreground}
                  icon="Trash2"
                  label={t('dm.clearMessages')}
                  onPress={() => { onClose(); onClearChat(); }}
                />
                <View className="h-[1px]" style={{ backgroundColor: colors.border }} />
              </>
            )}

            {isCreator && onToggleFreeAccess && (
              <>
                <MenuRow
                  foreground={colors.foreground}
                  icon={peerHasFreeAccess ? "CircleMinus" : "ShieldCheck"}
                  label={peerHasFreeAccess ? t('dm.removeFreeAccess') : t('dm.grantFreeAccess')}
                  onPress={() => { onClose(); onToggleFreeAccess(); }}

                />
                <View className="h-[1px]" style={{ backgroundColor: colors.border }} />
              </>
            )}

            {isCreator && onManageDmFee && (
              <>
                <MenuRow
                  foreground={colors.foreground}
                  icon="Coins"
                  label={t('dm.feeSettings')}
                  onPress={() => { onClose(); onManageDmFee(); }}
                />
                <View className="h-[1px]" style={{ backgroundColor: colors.border }} />
              </>
            )}

            {onReportUser && (
              <>
                <MenuRow
                  foreground={colors.foreground}
                  icon="Flag"
                  label={t('postOptions.reportUser')}
                  onPress={() => { onClose(); onReportUser(); }}
                />
                <View className="h-[1px]" style={{ backgroundColor: colors.border }} />
              </>
            )}

            <MenuRow
              foreground={colors.foreground}
              icon={isBlocked ? "CircleMinus" : "Ban"}
              label={isBlocked ? t('dm.unblockUser') : t('dm.blockUser')}
              onPress={isBlocked ? (onUnblockUser || onClose) : onBlockUser}


            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default ChatMenu;
