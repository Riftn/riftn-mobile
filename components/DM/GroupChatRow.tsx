/** A group or channel in the Messages list. Tapping it opens its chat. */

import React from "react";
import { usePurchaseOfferVisible } from "../../config/storefront";
import { View, Text, TouchableOpacity } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import Icon from "../ui/Icon";
import { storageImageSource } from "../../libs/cdnImage";
import { communityKindOf, entryPriceOf } from "../../libs/community-kinds";
import type { Community } from "../../types/community";
import { BulkTick, MarkedUnreadDot } from "./BulkChatBar";
import { ChatCard } from "./ChatCard";
import ReactionAlertBadge, { markChatRow, reactionAlertLine } from "./ReactionAlertBadge";
import type { ChatReactionSummary } from "../../services/dm/dm.api";
import UnreadCountChip from "./UnreadCountChip";
import { formatShortAgo } from "../../libs/date.util";
import { roomPreviewLine } from "../../libs/room-chat-read";
import type { RoomSummary } from "../../hooks/useRoomChatSummaries";

import { formatCount } from '../../libs/format-count';
const DEHUB_COIN = require("../../assets/web-icons/dehub-coin.png");

export default function GroupChatRow({ community, onPress, onLongPress, selecting = false, checked = false, markedUnread = false, reactions = null, summary, me = "" }: {
  community: Community;
  /** Newest line and unread number (hooks/useRoomChatSummaries). */
  summary?: RoomSummary;
  /** Your wallet, so your own newest line reads "You: …". */
  me?: string;
  onPress: () => void;
  /** Hold the row to start picking several chats. */
  onLongPress?: () => void;
  /** Picking several chats: the row shows a tick and a tap toggles it. */
  selecting?: boolean;
  checked?: boolean;
  /** You marked this chat unread yourself. */
  markedUnread?: boolean;
  /** Reactions to your messages here that you haven't seen yet. */
  reactions?: ChatReactionSummary | null;
}) {
  const showPurchaseOffer = usePurchaseOfferVisible();
  markChatRow(`room:${community.id}`);
  const { t } = useTranslation();
  const kind = communityKindOf(community);
  const kindIcon = kind === "channel" ? "Megaphone" : "Users";
  const price = entryPriceOf(community);
  const formattedCount = formatCount(community.member_count ?? 0);
  const subtitle = kind === "channel"
    ? t("communities.newChat.channelRow", { defaultValue: "Channel · {{formattedCount}} members", count: community.member_count ?? 0, formattedCount })
    : t("communities.newChat.groupRow", { defaultValue: "Group · {{formattedCount}} members", count: community.member_count ?? 0, formattedCount });
  const unread = summary?.unread ?? 0;
  const preview = summary?.last ? roomPreviewLine(summary.last, me, t as any) : "";
  const lastAt = summary?.last?.created_at ? formatShortAgo(summary.last.created_at) : "";
  return (
    <ChatCard unread={markedUnread || !!reactions || unread > 0} checked={selecting && checked}>
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      activeOpacity={0.7}
      accessibilityState={selecting ? { selected: checked } : undefined}
      className="flex-row items-center pl-3 pr-3.5 py-3 gap-3"
      style={{ minHeight: 72 }}
      testID={`group-chat-row-${kind}`}
    >
      {selecting && <BulkTick checked={checked} />}
      <View
        style={{ width: 44, height: 44, borderRadius: 12 }}
        className="bg-theme-neutrals-800 items-center justify-center overflow-hidden"
      >
        {community.avatar_url
          ? <Image source={storageImageSource(community.avatar_url, 48)} style={{ width: 44, height: 44 }} contentFit="cover" />
          : <Icon name={kindIcon as any} size={22} color="#d4d4d8" />}
      </View>
      <View className="flex-1 justify-center">
        <View className="flex-row items-center gap-1.5">
          <Icon name={kindIcon as any} size={13} color="#a1a1aa" />
          <Text className="text-theme-neutrals-100 text-[15px] font-semibold flex-shrink" numberOfLines={1}>{community.name}</Text>
          {community.is_private && <Icon name="Lock" size={12} color="#808089" />}
          {!!lastAt && (
            <Text testID="room-last-at" className="text-[12.5px] text-theme-neutrals-500" style={{ marginLeft: "auto", fontVariant: ["tabular-nums"] }}>{lastAt}</Text>
          )}
          {markedUnread && !reactions && !(unread > 0) && <View style={lastAt ? undefined : { marginLeft: "auto" }}><MarkedUnreadDot /></View>}
          {reactions && <View style={lastAt ? undefined : { marginLeft: "auto" }}><ReactionAlertBadge reactions={reactions} rowKey={`room:${community.id}`} /></View>}
          {unread > 0 && <View style={lastAt || reactions ? undefined : { marginLeft: "auto" }}><UnreadCountChip count={unread} /></View>}
        </View>
        {reactions ? (
          <Text testID="reaction-alert-line" className="text-white text-[14px] font-bold mt-0.5" numberOfLines={1}>
            {reactionAlertLine(t as any, reactions, { named: true })}
          </Text>
        ) : preview ? (
          <Text testID="room-preview" className={`text-white text-[14px] mt-0.5 ${unread > 0 ? "font-bold" : "font-normal"}`} numberOfLines={1}>{preview}</Text>
        ) : (
        <View className="flex-row items-center gap-1 mt-0.5">
          <Text className="text-theme-neutrals-400 text-[14px]" numberOfLines={1}>{subtitle}</Text>
          {price > 0 && showPurchaseOffer && (
            <>
              <Text className="text-theme-neutrals-400 text-[14px]">·</Text>
              <Image source={DEHUB_COIN} style={{ width: 12, height: 12 }} contentFit="contain" />
              <Text className="text-theme-neutrals-400 text-[14px]">{price.toLocaleString("en-US")}</Text>
            </>
          )}
        </View>
        )}
      </View>
    </TouchableOpacity>
    </ChatCard>
  );
}
