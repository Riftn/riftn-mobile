/**
 * Quick account switcher in the menu header.
 *
 * A small pill beside your name: the faces of the other accounts saved on this
 * device, your own last, and a chevron. Tapping it lists every saved account
 * so you can jump between them without leaving the menu for Settings.
 *
 * Switching itself lives in AuthContext (switchToProfile) and libs/profiles;
 * this only reads the registry and hands over an id. No keys pass through it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from '../ui/Icon';
import Avatar from '../common/Avatar';
import GlassModal from '../ui/GlassModal';
import { useAuthActions } from '../../context/AuthContext';
import { getAvatarUrl } from '../../libs/misc';
import { listProfiles, subscribeProfilesChanged, type StoredProfile } from '../../libs/profiles';

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Faces shown in the pill besides your own. */
const MAX_OTHERS = 2;
const FACE = 22;

interface MenuAccountSwitcherProps {
  /** Your own avatar and name, as the header above shows them. */
  avatarUrl?: string;
  name?: string;
  activeAddress?: string | null;
  /** The sheet colour behind the pill, so overlapping faces read as separate. */
  ringColor: string;
  square?: boolean;
  /** Close the menu once an account is picked. */
  onPicked: () => void;
}

export default function MenuAccountSwitcher({
  avatarUrl,
  name,
  activeAddress,
  ringColor,
  square,
  onPicked,
}: MenuAccountSwitcherProps) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<StoredProfile[]>([]);
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const { switchToProfile, openAddProfile } = useAuthActions();

  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      listProfiles().then((list) => {
        if (!cancelled) setProfiles(list);
      }).catch(() => undefined);
    };
    sync();
    const unsub = subscribeProfilesChanged(sync);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [activeAddress]);

  const active = activeAddress?.toLowerCase();
  const others = profiles.filter((p) => p.address.toLowerCase() !== active).slice(0, MAX_OTHERS);

  const close = useCallback(() => setOpen(false), []);
  const switchTo = useCallback(async (id: string) => {
    if (switchingId) return;
    setSwitchingId(id);
    try {
      setOpen(false);
      onPicked();
      await switchToProfile(id);
    } finally {
      setSwitchingId(null);
    }
  }, [switchingId, switchToProfile, onPicked]);
  const addProfile = useCallback(() => {
    setOpen(false);
    onPicked();
    openAddProfile();
  }, [onPicked, openAddProfile]);
  const me = profiles.find((p) => p.address.toLowerCase() === active);
  const rows = me ? [me, ...profiles.filter((p) => p !== me)] : profiles;

  const faces: { key: string; uri?: string; name?: string }[] = [
    ...others.map((p) => ({
      key: p.id,
      uri: p.avatarUrl ? getAvatarUrl(p.avatarUrl) : undefined,
      name: p.name || p.username || undefined,
    })),
    { key: 'me', uri: avatarUrl, name },
  ];

  return (
    <>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('settings.switchAccount')}
        testID="menu-account-switcher"
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        style={[styles.pill, others.length === 0 && styles.pillIcon, square && styles.square]}
      >
        {others.length === 0 ? (
          <Icon name="SwitchAccounts" size={18} color="#E4E4E7" />
        ) : (
          <View style={styles.faces}>
            {faces.map((face, index) => (
              <View
                key={face.key}
                style={[
                  styles.face,
                  { borderColor: ringColor, marginLeft: index === 0 ? 0 : -7, zIndex: index },
                  square && styles.faceSquare,
                ]}
              >
                <Avatar uri={face.uri} size={FACE} radius={square ? 4 : FACE / 2} name={face.name} />
              </View>
            ))}
          </View>
        )}
        <Icon name="ChevronDown" size={15} color="#A1A1AA" />
      </TouchableOpacity>

      <GlassModal visible={open} onClose={close} presentation="bottom" scrollable>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('settings.switchAccount')}</Text>
          {rows.map((profile) => {
            const isActive = profile === me;
            const label = profile.name || profile.username || shortAddress(profile.address);
            return (
              <TouchableOpacity
                key={profile.id}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                onPress={() => { if (!isActive) void switchTo(profile.id); }}
                disabled={!!switchingId}
                activeOpacity={0.7}
                style={styles.row}
              >
                <Avatar
                  uri={profile.avatarUrl ? getAvatarUrl(profile.avatarUrl) : isActive ? avatarUrl : undefined}
                  size={40}
                  radius={square ? 6 : 20}
                  name={label}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>{label}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {profile.username ? `@${profile.username}` : shortAddress(profile.address)}
                    {!profile.session && !isActive ? ` · ${t('settings.profileSignedOut')}` : ''}
                  </Text>
                </View>
                {switchingId === profile.id ? (
                  <ActivityIndicator size="small" color="#A1A1AA" />
                ) : isActive ? (
                  <Icon name="Check" size={18} color="#FFFFFF" />
                ) : null}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            accessibilityRole="button"
            onPress={addProfile}
            disabled={!!switchingId}
            activeOpacity={0.7}
            style={styles.row}
          >
            <View style={[styles.addIcon, { borderRadius: square ? 6 : 20 }]}>
              <Icon name="Plus" size={16} color="#A1A1AA" />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowName}>{t('settings.addProfile')}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </GlassModal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 34,
    paddingLeft: 6,
    paddingRight: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  pillIcon: {
    paddingLeft: 10,
  },
  square: {
    borderRadius: 4,
  },
  faces: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  face: {
    borderWidth: 1.5,
    borderRadius: FACE / 2 + 1.5,
    overflow: 'hidden',
  },
  faceSquare: {
    borderRadius: 5,
  },
  sheet: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 20,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  rowSub: {
    color: '#A1A1AA',
    fontSize: 13,
    marginTop: 1,
  },
  addIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.28)',
  },
});
