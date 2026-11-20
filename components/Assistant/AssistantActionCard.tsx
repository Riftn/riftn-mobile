/**
 * The assistant's confirm card (same as the web one). The assistant never
 * acts on its own: for "react ❤️ to every post by @jules", "follow @x" or
 * reading your chats it offers this card, and one tap does it as you.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getAvatarUrl } from '../../libs/misc';
import { openInApp } from '../../libs/links.utils';
import { POST_REACTIONS, reactionMeta, type PostReaction } from '../../libs/reactions';
import {
  cancelAssistantAction,
  confirmAssistantAction,
  getAssistantAction,
  type AssistantAction,
  type AssistantActionPerson,
} from '../../services/assistantActions.service';

type Choice = PostReaction | 'fitting';

const REQUEST_CATEGORY_KEYS = {
  ui_ux: 'features.uiUx',
  performance: 'features.performance',
  new_feature: 'features.newFeature',
  bug_fix: 'features.bugFix',
  integration: 'features.integration',
  other: 'features.other',
} as const;

function Person({ person }: { person: AssistantActionPerson }) {
  const url = person.avatar ? getAvatarUrl(person.avatar, 64) : undefined;
  return (
    <View style={s.person}>
      {url ? (
        <Image source={{ uri: url }} style={s.avatar} />
      ) : (
        <View style={[s.avatar, s.avatarEmpty]}>
          <Text style={s.avatarText}>{(person.username || '?').slice(0, 2).toUpperCase()}</Text>
        </View>
      )}
      <Text style={s.name} numberOfLines={1}>{person.username ? `@${person.username}` : `${person.address.slice(0, 6)}…`}</Text>
    </View>
  );
}

export default function AssistantActionCard({ actionId, initial }: { actionId: string; initial?: AssistantAction }) {
  const { t } = useTranslation();
  const [action, setAction] = useState<AssistantAction | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getAssistantAction(actionId);
      setAction(next);
      setError(null);
      if (next?.status === 'running') poll.current = setTimeout(load, 1200);
    } catch {
      setError(t('assistantCards.loadFailed', { defaultValue: 'This card could not be loaded. Sign in, or ask again.' }));
    }
  }, [actionId, t]);

  useEffect(() => {
    if (!initial) load();
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [load, initial]);

  if (error && !action) return <View style={s.card}><Text style={s.muted}>{error}</Text></View>;
  if (!action) return <View style={[s.card, s.loading]}><ActivityIndicator color="rgba(255,255,255,0.6)" /></View>;

  const { kind, status, preview, result } = action;
  const draft = kind === 'request_post' ? preview.draft : undefined;
  const postedRequestId = result?.requestId;
  const count = preview.count ?? 0;
  const picked: Choice = choice || ((preview.choice as Choice) ?? 'like');

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await confirmAssistantAction(
        action.id,
        kind === 'request_post' ? { requestPost: true } : kind === 'react' ? { reaction: picked } : {},
      );
      setAction(next);
      if (next?.status === 'running') poll.current = setTimeout(load, 1200);
    } catch (e: any) {
      setError(e?.message || t('assistantCards.failed', { defaultValue: 'That did not work. Try again.' }));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      setAction(await cancelAssistantAction(action.id));
    } catch {
      // Leave the card as it was.
    } finally {
      setBusy(false);
    }
  };

  const title =
    kind === 'react'
      ? count === 1
        ? t('assistantCards.reactOne', { defaultValue: 'React to 1 post' })
        : t('assistantCards.reactMany', { count, defaultValue: 'React to {{count}} posts' })
      : kind === 'follow'
        ? t('assistantCards.follow', { count, defaultValue: 'Follow {{count}}' })
        : kind === 'unfollow'
          ? t('assistantCards.unfollow', { count, defaultValue: 'Unfollow {{count}}' })
          : kind === 'request_post'
            ? t('assistantCards.requestDraft', { defaultValue: 'Public request draft' })
            : preview.allow
            ? t('assistantCards.allowChats', { defaultValue: 'Let the assistant read your chats?' })
            : t('assistantCards.stopChats', { defaultValue: 'Stop the assistant reading your chats?' });
  const confirmLabel =
    kind === 'react'
      ? t('assistantCards.confirmReact', { defaultValue: 'React' })
      : kind === 'follow'
        ? t('assistantCards.confirmFollow', { defaultValue: 'Follow' })
        : kind === 'unfollow'
          ? t('assistantCards.confirmUnfollow', { defaultValue: 'Unfollow' })
          : kind === 'request_post'
            ? t('assistantCards.postRequest', { defaultValue: 'Post to Requests' })
            : preview.allow
            ? t('assistantCards.confirmAllow', { defaultValue: 'Allow' })
            : t('assistantCards.confirmStop', { defaultValue: 'Stop' });
  const total = result?.total ?? count;
  const done = result?.done ?? 0;

  return (
    <View style={s.card} testID={`assistant-card-${kind}`}>
      <Text style={s.title}>{title}</Text>

      {draft && (
        <View style={s.draft}>
          <Text style={s.muted}>{t(REQUEST_CATEGORY_KEYS[draft.category])}</Text>
          <Text style={s.name}>{draft.title}</Text>
          <Text style={s.body}>{draft.description}</Text>
          {!!preview.duplicates?.length && status === 'pending' && (
            <View style={s.draft}>
              <Text style={s.muted}>{t('assistantCards.possibleDuplicates', { defaultValue: 'Possible duplicates' })}</Text>
              {preview.duplicates.map((request) => (
                <Text key={request.id} accessibilityRole="link" style={s.link}
                  onPress={() => void openInApp(`https://riftn.com/app/features?request=${encodeURIComponent(request.id)}`)}>
                  {request.title}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      {kind === 'react' && !!preview.author && <Person person={preview.author} />}
      {kind === 'react' && !!preview.alreadyReacted && (
        <Text style={s.muted}>
          {t('assistantCards.skipsAlready', { count: preview.alreadyReacted, defaultValue: 'Skips {{count}} you already reacted to' })}
        </Text>
      )}
      {(kind === 'follow' || kind === 'unfollow') && (preview.people || []).map((p) => <Person key={p.address} person={p} />)}
      {kind === 'chat_access' && preview.allow && (
        <Text style={s.body}>
          {t('assistantCards.allowChatsWhy', {
            defaultValue: 'Only you see what it reads. Direct chats only, and end-to-end encrypted ones stay private. Ask it to stop any time.',
          })}
        </Text>
      )}

      {kind === 'react' && status === 'pending' && (
        <View style={s.chips} accessibilityRole="radiogroup" accessibilityLabel={t('assistantCards.pickReaction', { defaultValue: 'Pick a reaction' })}>
          {[...POST_REACTIONS, 'fitting' as const].map((c) => {
            const disabled = c === 'dislike' && count > 1;
            const selected = picked === c;
            const label = c === 'fitting' ? t('assistantCards.fitting', { defaultValue: 'Fitting' }) : reactionMeta(c).label;
            return (
              <TouchableOpacity
                key={c}
                disabled={disabled}
                onPress={() => setChoice(c)}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled }}
                accessibilityLabel={label}
                style={[s.chip, selected ? s.chipOn : s.chipIdle, disabled && s.chipOff]}
              >
                <Text style={c === 'fitting' ? s.chipWord : s.chipEmoji}>{c === 'fitting' ? label : reactionMeta(c).emoji}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {status === 'running' && (
        <View style={{ gap: 6 }}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${total ? Math.round((done / total) * 100) : 10}%` }]} />
          </View>
          <Text style={s.muted}>{t('assistantCards.progress', { done, total, defaultValue: '{{done}} of {{total}}' })}</Text>
        </View>
      )}
      {status === 'done' && kind === 'request_post' && postedRequestId && (
        <View style={s.doneRow}>
          <Ionicons name="checkmark" size={14} color="rgba(255,255,255,0.85)" />
          <Text accessibilityRole="link" style={s.link}
            onPress={() => void openInApp(`https://riftn.com/app/features?request=${encodeURIComponent(postedRequestId)}`)}>
            {t('assistantCards.viewPostedRequest', { defaultValue: 'View posted request' })}
          </Text>
        </View>
      )}
      {status === 'done' && kind !== 'request_post' && (
        <View style={s.doneRow}>
          <Ionicons name="checkmark" size={14} color="rgba(255,255,255,0.85)" />
          <Text style={s.body}>
            {kind === 'react'
              ? t('assistantCards.doneReact', { count: result?.added ?? 0, defaultValue: 'Reacted to {{count}} posts' })
              : kind === 'chat_access'
                ? result?.allowed
                  ? t('assistantCards.doneAllow', { defaultValue: 'Allowed. Ask your question again.' })
                  : t('assistantCards.doneStop', { defaultValue: 'Stopped. It can no longer read your chats.' })
                : t('assistantCards.doneFollow', { count: result?.ok ?? 0, defaultValue: 'Done for {{count}}' })}
            {kind === 'react' && result?.used ? ` ${Object.keys(result.used).map((r) => reactionMeta(r as PostReaction)?.emoji).join(' ')}` : ''}
          </Text>
        </View>
      )}
      {status === 'expired' && <Text style={s.muted}>{t('assistantCards.expired', { defaultValue: 'This card expired. Ask again.' })}</Text>}
      {status === 'cancelled' && <Text style={s.muted}>{t('assistantCards.cancelled', { defaultValue: 'Cancelled' })}</Text>}
      {status === 'failed' && <Text style={s.muted}>{t('assistantCards.failed', { defaultValue: 'That did not work. Try again.' })}</Text>}
      {!!error && status === 'pending' && <Text style={s.muted}>{error}</Text>}

      {status === 'pending' && (
        <View style={s.row}>
          <TouchableOpacity onPress={confirm} disabled={busy} style={[s.btn, s.primary, busy && { opacity: 0.6 }]} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#000" /> : <Text style={s.primaryText}>{confirmLabel}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={cancel} disabled={busy} style={[s.btn, s.ghost]} accessibilityRole="button">
            <Text style={s.ghostText}>{t('assistantCards.cancel', { defaultValue: 'Not now' })}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 8, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)', padding: 12, gap: 10, alignSelf: 'stretch' },
  loading: { height: 96, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  body: { color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 17, flexShrink: 1 },
  draft: { gap: 6 },
  link: { color: '#FFFFFF', fontSize: 12, textDecorationLine: 'underline' },
  muted: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarEmpty: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'rgba(255,255,255,0.7)', fontSize: 10 },
  name: { color: 'rgba(255,255,255,0.92)', fontSize: 14, flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minWidth: 36, height: 36, paddingHorizontal: 8, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: 'rgba(255,255,255,0.92)', borderWidth: 2, backgroundColor: 'rgba(255,255,255,0.22)', transform: [{ scale: 1.08 }] },
  // Opacity carries the pick: theme colour remapping can flatten a border.
  chipIdle: { opacity: 0.5 },
  chipOff: { opacity: 0.2 },
  chipEmoji: { fontSize: 17 },
  chipWord: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.8)' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { flexDirection: 'row', gap: 8 },
  btn: { alignItems: 'center', justifyContent: 'center', height: 38, borderRadius: 19, paddingHorizontal: 16 },
  primary: { flex: 1, backgroundColor: '#FFFFFF' },
  primaryText: { color: '#000000', fontSize: 14, fontWeight: '600' },
  ghost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  ghostText: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
});
