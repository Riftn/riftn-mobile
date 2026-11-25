import { useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useUser, type User } from '../../context/AuthContext';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { getAvatarUrl } from '../../libs/misc';
import { truncateAddress } from '../../libs/strings.util';
import { toastError, toastSuccess } from '../../libs/toast';
import { addFreeAccess, getFreeAccessList, removeFreeAccess, type FreeAccessUser } from '../../services/dm/dm.api';
import { usersSearch } from '../../services/user.service';
import Avatar from '../common/Avatar';
import GlassModal from '../ui/GlassModal';
import Icon from '../ui/Icon';
import PrimaryButton from '../ui/PrimaryButton';

export default function FreeDmAccessSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const currentUser = useUser();
  const owner = currentUser?.address || currentUser?.walletAddress || '';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const term = search.trim().replace(/^@/, '').toLowerCase();
  const debouncedTerm = useDebouncedValue(term, 250);
  const listKey = ['free-dm-access', owner] as const;
  const currentSearch = term.length >= 2 && term === debouncedTerm;
  const searchLabel = t('settings.freeDmSearch', 'Search by username');
  const close = () => {
    setSearch('');
    onClose();
  };

  const list = useQuery({
    queryKey: listKey,
    queryFn: () => getFreeAccessList(owner),
    enabled: visible && Boolean(owner),
  });
  const matches = useQuery({
    queryKey: ['free-dm-access-search', owner, debouncedTerm],
    queryFn: async () => {
      const response = await usersSearch(debouncedTerm);
      const accounts = response?.data?.result ?? (response as typeof response & { result?: User[] })?.result;
      if (!Array.isArray(accounts)) throw new Error('Could not search usernames');
      return accounts.flatMap(user => {
        const address = user.address || user.walletAddress;
        if (!address || address.toLowerCase() === owner.toLowerCase() || !user.username?.toLowerCase().includes(debouncedTerm)) {
          return [];
        }
        return [{ address, username: user.username, displayName: user.displayName, avatarImageUrl: user.avatarImageUrl }];
      });
    },
    enabled: visible && Boolean(owner) && currentSearch,
  });

  const changeAccess = useMutation({
    mutationFn: async ({ user, grant }: { user: FreeAccessUser; grant: boolean }) => {
      await (grant ? addFreeAccess(user.address) : removeFreeAccess(user.address));
      await queryClient.cancelQueries({ queryKey: listKey, exact: true });
      queryClient.setQueryData<FreeAccessUser[]>(listKey, previous => {
        const remaining = (previous ?? []).filter(item => item.address.toLowerCase() !== user.address.toLowerCase());
        return grant ? [user, ...remaining] : remaining;
      });
    },
    onSuccess: (_, { grant }) => toastSuccess(grant
      ? t('dm.freeAccessGranted')
      : t('screens.freeAccessRevoked')),
    onError: (error, { grant }) => toastError(error, grant
      ? t('settings.freeDmGrantFailed', 'Failed to grant access')
      : t('screens.failedToRevoke')),
  });

  const grantedUsers = list.data ?? [];
  const grantedAddresses = new Set(grantedUsers.map(user => user.address.toLowerCase()));
  const searching = Boolean(term);
  const users = searching ? (currentSearch ? matches.data ?? [] : []) : grantedUsers;
  const loading = list.isLoading || (term.length >= 2 && (!currentSearch || matches.isLoading));
  const failedQuery = list.isError ? list : currentSearch && matches.isError ? matches : null;

  return (
    <GlassModal
      visible={visible}
      onClose={close}
      presentation="bottom"
      maxHeight="70%"
      panelHeight="70%"
    >
      <View className="flex-1">
        <View className="flex-row items-center justify-between px-5 pt-4 pb-3">
          <Text className="flex-1 text-white font-bold text-base" accessibilityRole="header">
            {t('screens.freeDmAccessList')}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('common.close', 'Close')}
            onPress={close}
            hitSlop={8}
          >
            <Icon name="X" size={20} />
          </TouchableOpacity>
        </View>

        <View className="mx-5 flex-row items-center gap-2 rounded-xl border border-theme-neutrals-700 bg-theme-neutrals-800/60 px-3">
          <Icon name="Search" size={18} />
          <TextInput
            className="flex-1 min-h-11 text-white text-sm placeholder:text-theme-neutrals-400"
            value={search}
            onChangeText={setSearch}
            placeholder={searchLabel}
            accessibilityLabel={searchLabel}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel={t('sidebar.clearSearch')} hitSlop={8}>
              <Icon name="X" size={16} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text className="text-theme-neutrals-400 text-xs px-5 pt-3 pb-1">
          {t('screens.freeDmAccessModalDesc')}
        </Text>

        {loading ? (
          <View className="items-center py-6"><ActivityIndicator /></View>
        ) : failedQuery ? (
          <View className="items-center gap-2 py-6">
            <Text className="text-theme-neutrals-400 text-sm">{t('common.failedToLoad', 'Failed to load')}</Text>
            <PrimaryButton neutral title={t('common.retry', 'Retry')} onPress={() => void failedQuery.refetch()} />
          </View>
        ) : (
          <FlatList<FreeAccessUser>
            data={users}
            keyExtractor={user => user.address.toLowerCase()}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 8 }}
            ListEmptyComponent={(
              <View className="items-center gap-2 py-6">
                {!searching && <Icon name="Gift" size={30} />}
                <Text className="px-4 text-center text-theme-neutrals-400 text-sm" accessibilityLiveRegion="polite">
                  {!searching ? t('settings.freeDmEmpty', 'No users have free access yet. Search for a username to add someone.')
                    : term.length < 2 ? t('settings.freeDmSearchMin', 'Enter at least two characters.')
                      : t('settings.freeDmNoMatches', 'No matching users.')}
                </Text>
              </View>
            )}
            renderItem={({ item: user }) => {
              const name = user.displayName || user.username || truncateAddress(user.address, 8, 6);
              const selected = searching && grantedAddresses.has(user.address.toLowerCase());
              const busy = changeAccess.isPending && changeAccess.variables?.user.address === user.address;

              return (
                <View className={`flex-row items-center gap-3 rounded-xl border px-3 py-2 ${selected ? 'border-theme-accent/30 bg-theme-accent/10' : 'border-theme-neutrals-700 bg-theme-neutrals-800/60'}`}>
                  <Avatar uri={getAvatarUrl(user.avatarImageUrl)} size={36} name={name} />
                  <View className="flex-1">
                    <Text className="text-white text-sm font-semibold" numberOfLines={1}>{name}</Text>
                    {user.username && <Text className="text-theme-neutrals-400 text-xs" numberOfLines={1}>@{user.username}</Text>}
                  </View>
                  {selected ? (
                    <View className="flex-row items-center gap-1.5 rounded-full bg-theme-accent/15 px-3 py-2">
                      <Icon name="Check" size={14} />
                      <Text className="text-theme-accent text-xs font-semibold">{t('settings.freeDmSelected', 'Selected')}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      accessibilityRole="button"
                      onPress={() => changeAccess.mutate({ user, grant: searching })}
                      disabled={!owner || changeAccess.isPending}
                      className="min-h-9 min-w-16 items-center justify-center rounded-full border border-theme-neutrals-600 px-3"
                    >
                      {busy ? <ActivityIndicator size="small" /> : (
                        <Text className="text-white text-xs font-semibold">
                          {searching ? t('settings.freeDmSelect', 'Select') : t('common.remove', 'Remove')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            }}
          />
        )}
      </View>
    </GlassModal>
  );
}
