/**
 * "Ask AI" from somebody else's profile (the ⋮ menu).
 *
 * The menu row swaps the menu for these rows in place. Each row hands a
 * ready-made ask about this person to the Assistant, which opens a fresh chat
 * and sends it at once. It answers with its usual confirm cards (follow, react
 * to every post), so nothing happens until the person taps. Same rows as web.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import AssistantNavIcon from '../ui/AssistantNavIcon';

export function AskAiMenuRow({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} testID="profile-ask-ai" className="mx-3 mb-1">
      {/* Chrome edge: a 1px gradient ring around a dark glass row. */}
      <LinearGradient
        colors={['#ffffff', '#6d6d6d', '#e8e8e8', '#3a3a3a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: 14, padding: 1 }}
      >
        <View className="flex-row items-center px-3 py-3" style={{ borderRadius: 13, backgroundColor: '#1b1b1d' }}>
          <View className="w-8 h-8 rounded-xl bg-white items-center justify-center mr-3">
            <AssistantNavIcon size={16} color="#000" />
          </View>
          <View className="flex-1">
            <Text className="text-white text-[15px] font-semibold">{t('profileAskAi.row', { defaultValue: 'Ask AI' })}</Text>
            <Text className="text-theme-neutrals-500 text-xs mt-0.5" numberOfLines={1}>
              {t('profileAskAi.rowSub', { defaultValue: 'Follow, like everything, catch up' })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.4)" />
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

interface Props {
  username: string;
  avatarUrl?: string;
  isFollowing: boolean;
  postsCount?: number | null;
  onBack: () => void;
  onAsk: (prompt: string) => void;
}

export default function ProfileAskAiRows({ username, avatarUrl, isFollowing, postsCount, onBack, onAsk }: Props) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const handle = username.startsWith('@') ? username : `@${username}`;
  const count = postsCount && postsCount > 0 ? postsCount : null;

  const actions = [
    !isFollowing && {
      key: 'followLikeAll',
      icon: <Ionicons name="add" size={18} color="#fff" />,
      title: t('profileAskAi.followLikeAll', { defaultValue: 'Follow and like everything' }),
      sub: t('profileAskAi.followLikeAllSub', { handle, defaultValue: 'Follows {{handle}}, reacts to every post' }),
      prompt: t('profileAskAi.promptFollowLikeAll', { handle, defaultValue: 'Follow {{handle}} and react to all of their posts' }),
      count,
    },
    {
      key: 'likeAll',
      icon: <Text style={{ fontSize: 15 }}>❤️</Text>,
      title: t('profileAskAi.likeAll', { defaultValue: 'Like all their posts' }),
      sub: t('profileAskAi.likeAllSub', { defaultValue: 'Skips ones you already reacted to' }),
      prompt: t('profileAskAi.promptLikeAll', { handle, defaultValue: 'React to all of the posts by {{handle}}' }),
      count,
    },
    {
      key: 'catchUp',
      icon: <Ionicons name="flash" size={16} color="#fff" />,
      title: t('profileAskAi.catchUp', { defaultValue: 'Catch me up' }),
      sub: t('profileAskAi.catchUpSub', { handle, defaultValue: 'What {{handle}} posted lately, in short' }),
      prompt: t('profileAskAi.promptCatchUp', { handle, defaultValue: 'Catch me up on what {{handle}} has posted lately' }),
      count: null,
    },
    {
      key: 'message',
      icon: <Ionicons name="create-outline" size={16} color="#fff" />,
      title: t('profileAskAi.message', { defaultValue: 'Write them a message' }),
      sub: t('profileAskAi.messageSub', { defaultValue: 'Drafts a message, you send it' }),
      prompt: t('profileAskAi.promptMessage', { handle, defaultValue: 'Help me write a message to {{handle}}' }),
      count: null,
    },
  ].filter(Boolean) as { key: string; icon: React.ReactNode; title: string; sub: string; prompt: string; count: number | null }[];

  const submit = () => {
    const q = question.trim();
    if (!q) return;
    onAsk(t('profileAskAi.promptAbout', { handle, question: q, defaultValue: 'About {{handle}}: {{question}}' }));
  };

  return (
    <View className="px-3" testID="profile-ask-ai-rows">
      <TouchableOpacity onPress={onBack} activeOpacity={0.7} className="flex-row items-center py-2 px-1 self-start">
        <Ionicons name="chevron-back" size={16} color="rgba(255,255,255,0.6)" />
        <Text className="text-white/60 text-sm font-medium ml-1">{t('profileAskAi.back', { defaultValue: 'Back' })}</Text>
      </TouchableOpacity>

      <View className="flex-row items-center px-1 pb-3">
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)' }} />
        ) : (
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.1)' }} />
        )}
        <View className="flex-1 ml-3">
          <Text className="text-white text-base font-semibold" numberOfLines={1}>
            {t('profileAskAi.title', { handle, defaultValue: 'Ask AI about {{handle}}' })}
          </Text>
          <Text className="text-theme-neutrals-500 text-xs mt-0.5">
            {t('profileAskAi.sub', { defaultValue: 'The Assistant does it, you confirm' })}
          </Text>
        </View>
        <AssistantNavIcon size={26} color="#fff" />
      </View>

      {actions.map((a, i) => {
        const primary = i === 0;
        return (
          <TouchableOpacity
            key={a.key}
            testID={`ask-ai-${a.key}`}
            onPress={() => onAsk(a.prompt)}
            activeOpacity={0.8}
            className="flex-row items-center px-3 py-3 rounded-2xl mb-1.5"
            style={primary
              ? { backgroundColor: '#fff' }
              : { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}
          >
            <View
              className="w-8 h-8 rounded-xl items-center justify-center mr-3"
              style={{ backgroundColor: primary ? '#000' : 'rgba(255,255,255,0.1)' }}
            >
              {a.icon}
            </View>
            <View className="flex-1">
              <Text style={{ color: primary ? '#000' : '#fff' }} className="text-[15px] font-semibold">{a.title}</Text>
              <Text style={{ color: primary ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)' }} className="text-xs mt-0.5" numberOfLines={1}>
                {a.sub}
              </Text>
            </View>
            {a.count != null && (
              <View className="ml-2 px-2 py-0.5 rounded-full" style={{ backgroundColor: primary ? '#000' : 'rgba(255,255,255,0.1)' }}>
                <Text className="text-white text-xs font-bold">{a.count}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}

      <View
        className="flex-row items-center mt-1.5 pl-4 pr-1.5 py-1.5 rounded-full"
        style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}
      >
        <TextInput
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={submit}
          returnKeyType="send"
          placeholder={t('profileAskAi.placeholder', { handle, defaultValue: 'Ask anything about {{handle}}…' })}
          placeholderTextColor="rgba(255,255,255,0.4)"
          className="flex-1 text-white text-sm py-1.5"
        />
        <TouchableOpacity
          onPress={submit}
          disabled={!question.trim()}
          accessibilityLabel={t('profileAskAi.send', { defaultValue: 'Send' })}
          className="w-9 h-9 rounded-full bg-white items-center justify-center"
          style={{ opacity: question.trim() ? 1 : 0.4 }}
        >
          <Ionicons name="arrow-up" size={18} color="#000" />
        </TouchableOpacity>
      </View>
    </View>
  );
}
