import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import GlassModal from '../ui/GlassModal';
import Icon from '../ui/Icon';
import { useAppTheme } from '../../context/ThemeContext';
import { supabase } from '../../services/supabase';
import { dehubAuthHeaders } from '../../services/ai.service';
import { getNotifications, markNotificationAsRead, type NotificationItem } from '../../services/user.service';
import { postComment } from '../../services/nft.service';
import { ensureAiConsent, requireAiConsent } from '../../libs/ai-consent';
import { isCustomNotificationId, fetchCustomNotifications, markCustomNotificationRead } from '../../libs/custom-notifications';
import { catchUpPrompts } from '../../libs/notification-catch-up';
import { useNotificationCatchUp } from '../../libs/use-notification-catch-up';

type Props = {
  wallet: string;
  dismissedIds: ReadonlySet<string>;
  onOpenNotification: (item: NotificationItem) => void;
  onRefresh: () => void;
};

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} onPress={onPress} disabled={disabled}
      className={`self-start rounded-xl border border-theme-neutrals-700 px-3 py-2 ${disabled ? 'opacity-50' : ''}`}>
      <Text className="text-sm font-semibold text-theme-neutrals-100">{label}</Text>
    </Pressable>
  );
}

export default function NotificationCatchUp({ wallet, dismissedIds, onOpenNotification, onRefresh }: Props) {
  const { t, i18n } = useTranslation();
  const { accent } = useAppTheme();
  const state = useNotificationCatchUp({
    wallet,
    language: i18n.resolvedLanguage || i18n.language || 'en',
    load: async () => {
      const [feed, custom] = await Promise.all([
        getNotifications({ unreadOnly: true, page: 1, limit: 50 }),
        fetchCustomNotifications(wallet, true),
      ]);
      const rows = feed?.data?.result || (feed as unknown as { result?: NotificationItem[] })?.result || [];
      return [...new Map([...rows, ...custom].map(item => [item._id, item])).values()]
        .filter(item => !item.read && !dismissedIds.has(item._id) && item.actorAddress?.toLowerCase() !== wallet.toLowerCase())
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
    analyze: async prompt => {
      await requireAiConsent();
      const headers = await dehubAuthHeaders(wallet);
      const { data, error } = await supabase.functions.invoke('creator-prompt-assistant', {
        headers,
        body: { persona: 'notification-catch-up', prompt },
      });
      if (error || data?.mode !== 'notification-catch-up' || typeof data.text !== 'string') throw new Error('Notification analysis unavailable');
      return data.text;
    },
    markRead: async item => {
      if (isCustomNotificationId(item._id)) await markCustomNotificationRead(item._id, wallet);
      else await markNotificationAsRead(item._id);
    },
    send: async (target, text) => {
      const content = target.username && !text.startsWith('@') ? '@' + target.username + ' ' + text : text;
      await postComment({ streamTokenId: target.tokenId, content, commentId: target.commentId });
    },
    refresh: onRefresh,
  });

  const disabled = state.busy || !!state.pending;
  const status = state.status;
  const statusText = status?.key === 'sent'
    ? t('notifications.catchUp.sent', { defaultValue: '{{count}} sent · {{failed}} failed', count: status.count, failed: status.failed })
    : status?.key === 'cleared'
      ? t('notifications.catchUp.cleared', { defaultValue: '{{count}} marked read · {{failed}} failed', count: status.count, failed: status.failed })
      : status && t('notifications.catchUp.' + status.key, {
        defaultValue: {
          empty: 'You have no unread notifications in this view.',
          askError: 'Could not review your notifications. Try again.',
          undone: 'Cleanup undone.',
          writing: 'Saving changes…',
        }[status.key],
      });
  const title = t('notifications.catchUp.title', { defaultValue: 'Catch me up' });
  const placeholder = t('notifications.catchUp.placeholder', { defaultValue: 'Ask about unread notifications' });

  return (
    <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: state.open }}
        onPress={() => { void ensureAiConsent().then(allowed => { if (allowed) state.setOpen(true); }); }}
        className="my-2 ml-4 flex-row items-center gap-2 self-start rounded-xl border border-theme-neutrals-700 px-3 py-2">
        <Icon name="Sparkles" size={16} color={`rgb(${accent.join(',')})`} />
        <Text className="text-sm font-semibold text-theme-neutrals-100">{title}</Text>
      </Pressable>
      <GlassModal visible={state.open} onClose={() => state.setOpen(false)} presentation="bottom" dismissible={!state.pending} scrollable opaque>
        <View className="gap-4 px-4 pb-5 pt-2">
          <View className="flex-row items-center justify-between gap-3">
            <Text accessibilityRole="header" className="text-lg font-semibold text-theme-neutrals-100">{title}</Text>
            <Action label={t('notifications.catchUp.close', { defaultValue: 'Close' })} onPress={() => state.setOpen(false)} disabled={!!state.pending} />
          </View>
          <Text className="text-sm text-theme-neutrals-400">
            {t('notifications.catchUp.scope', { defaultValue: 'Ask about your 30 most recent unread notifications. Your question and notification previews are used to generate the answer.' })}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {catchUpPrompts.map(prompt => (
              <Action key={prompt.key} label={t('notifications.catchUp.prompt.' + prompt.key, { defaultValue: prompt.label })}
                disabled={disabled} onPress={() => void state.ask(prompt.question, prompt.key === 'cleanup')} />
            ))}
          </View>
          <View className="flex-row items-center gap-2">
            <TextInput className="min-w-0 flex-1 rounded-xl border border-theme-neutrals-700 px-3 py-2 text-theme-neutrals-100"
              value={state.question} onChangeText={state.setQuestion} maxLength={600}
              placeholder={placeholder} accessibilityLabel={placeholder} placeholderTextColor="#8B8D90"
              returnKeyType="send" onSubmitEditing={() => void state.ask(state.question)} />
            <Action label={t('notifications.catchUp.ask', { defaultValue: 'Ask' })} disabled={disabled || !state.question.trim()}
              onPress={() => void state.ask(state.question)} />
          </View>
          {state.pending > 0 && (
            <View className="flex-row items-center justify-between gap-3 rounded-xl border border-theme-neutrals-700 p-3">
              <Text accessibilityLiveRegion="polite" className="flex-1 text-sm text-theme-neutrals-100">
                {t('notifications.catchUp.pending', { defaultValue: 'Marking {{count}} as read in 8 seconds.', count: state.pending })}
              </Text>
              <Action label={t('notifications.catchUp.undo', { defaultValue: 'Undo' })} onPress={state.undo} />
            </View>
          )}
          {(statusText || state.busy) && (
            <Text accessibilityLiveRegion="polite" className="text-sm text-theme-neutrals-400">
              {statusText || t('notifications.catchUp.working', { defaultValue: 'Working…' })}
            </Text>
          )}
          {!!state.result && (
            <>
              {!!state.result.answer && <Text className="text-sm text-theme-neutrals-100">{state.result.answer}</Text>}
              {(['urgent', 'replies'] as const).map(group => state.result?.[group].length ? (
                <View key={group} className="gap-2">
                  <Text accessibilityRole="header" className="text-sm font-semibold text-theme-neutrals-100">
                    {t('notifications.catchUp.prompt.' + group, { defaultValue: group === 'urgent' ? 'Urgent' : 'Needs a reply' })}
                  </Text>
                  {state.result[group].map(({ index, reason }) => {
                    const item = state.items[index];
                    return (
                      <Pressable key={index} accessibilityRole="button" disabled={disabled}
                        onPress={() => { state.setOpen(false); onOpenNotification(item.source); }}
                        className="gap-1 rounded-xl border border-theme-neutrals-700 p-3">
                        {!!item.sender && <Text className="text-sm font-semibold text-theme-neutrals-100">{item.sender}</Text>}
                        <Text className="text-sm text-theme-neutrals-100">{item.preview}</Text>
                        <Text className="text-sm text-theme-neutrals-400">{reason}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null)}
              {state.drafts.length > 0 && (
                <View className="gap-2">
                  <Text accessibilityRole="header" className="text-sm font-semibold text-theme-neutrals-100">
                    {t('notifications.catchUp.drafts', { defaultValue: 'Review replies' })}
                  </Text>
                  {state.drafts.map(draft => (
                    <View key={draft.index} className="gap-2 rounded-xl border border-theme-neutrals-700 p-3">
                      <View className="flex-row items-center justify-between gap-2">
                        <Text className="flex-1 text-sm text-theme-neutrals-100">{state.items[draft.index].sender}</Text>
                        <Action label={t('notifications.catchUp.remove', { defaultValue: 'Remove' })} disabled={disabled}
                          onPress={() => state.removeDraft(draft.index)} />
                      </View>
                      <Text className="text-sm text-theme-neutrals-400">{state.items[draft.index].preview}</Text>
                      <TextInput value={draft.text} multiline editable={!disabled} maxLength={1000}
                        accessibilityLabel={t('notifications.catchUp.editReply', { defaultValue: 'Edit reply to {{name}}', name: state.items[draft.index].sender })}
                        onChangeText={text => state.editDraft(draft.index, text)}
                        className="min-h-16 rounded-lg border border-theme-neutrals-700 p-2 text-sm text-theme-neutrals-100" />
                    </View>
                  ))}
                  <Action label={t('notifications.catchUp.send', { defaultValue: 'Send {{count}} replies', count: state.drafts.filter(draft => draft.text.trim()).length })}
                    disabled={disabled || !state.drafts.some(draft => draft.text.trim())} onPress={() => void state.sendDrafts()} />
                </View>
              )}
              {state.preview ? (
                <View className="gap-2">
                  <Text accessibilityRole="header" className="text-sm font-semibold text-theme-neutrals-100">
                    {t('notifications.catchUp.preview', { defaultValue: 'Cleanup preview' })}
                  </Text>
                  {state.result.cleanup.length ? state.result.cleanup.map(index => {
                    const checked = state.checked.includes(index);
                    return (
                      <Pressable key={index} accessibilityRole="checkbox" accessibilityState={{ checked, disabled }}
                        disabled={disabled} onPress={() => state.toggle(index)}
                        className="flex-row items-start gap-3 rounded-xl border border-theme-neutrals-700 p-3">
                        <View className="h-5 w-5 items-center justify-center rounded border border-theme-neutrals-400">
                          {checked && <Icon name="Check" size={14} color={`rgb(${accent.join(',')})`} />}
                        </View>
                        <Text className="flex-1 text-sm text-theme-neutrals-100">
                          {state.items[index].sender ? state.items[index].sender + ' ' : ''}{state.items[index].preview}
                        </Text>
                      </Pressable>
                    );
                  }) : <Text className="text-sm text-theme-neutrals-400">
                    {t('notifications.catchUp.noCleanup', { defaultValue: 'No low-priority notifications to clear.' })}
                  </Text>}
                  {state.result.cleanup.length > 0 && (
                    <Action label={t('notifications.catchUp.markRead', { defaultValue: 'Mark {{count}} as read', count: state.checked.length })}
                      disabled={disabled || !state.checked.length} onPress={state.clear} />
                  )}
                </View>
              ) : state.result.cleanup.length > 0 && (
                <Action label={t('notifications.catchUp.preview', { defaultValue: 'Cleanup preview' })} disabled={disabled}
                  onPress={() => state.setPreview(true)} />
              )}
            </>
          )}
        </View>
      </GlassModal>
    </>
  );
}
