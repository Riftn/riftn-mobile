/**
 * MemberIdentity
 * ==============
 * A community member drawn exactly like the feed draws a post's author:
 * avatar, display name, badge and @handle, through the feed's own
 * FeedCardHeader. Rows in the Manage sheet pass whatever sits on the right
 * (a Promote button, a chevron) as children.
 *
 * Until the batch lookup answers, or for a wallet with no profile, the name
 * falls back to the short wallet so the row never renders empty.
 */
import React from "react";
import { View } from "react-native";
import { FeedCardHeader } from "../../Home/FeedCardHeader";
import { getAvatarUrl, getBadgeUrlFor } from "../../../libs/misc";
import { shortWallet } from "../../../hooks/useCommunityAdmin";
import type { AccountSummary } from "../../../services/user.service";

const AVATAR_SIZE = 32;

interface Props {
  address: string;
  identity?: AccountSummary;
  /** Shown under the name in place of the @handle, e.g. "3 of 11 rights". */
  children?: React.ReactNode;
  /** Right-hand control: Promote, a chevron, a role chip. */
  trailing?: React.ReactNode;
}

export function MemberIdentity({ address, identity, children, trailing }: Props) {
  const username = identity?.username?.trim() || undefined;
  const displayName = identity?.displayName?.trim() || username || shortWallet(address);
  const avatar = getAvatarUrl(identity?.avatarImageUrl || "");
  const badgeImage = identity ? getBadgeUrlFor(identity) : undefined;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0, paddingTop: 8 }}>
        <FeedCardHeader
          avatarUrl={avatar !== "default-avatar" ? avatar : undefined}
          displayName={displayName}
          username={username}
          address={address}
          badgeImage={badgeImage}
          avatarSize={AVATAR_SIZE}
        />
        {children}
      </View>
      {trailing}
    </View>
  );
}

export default MemberIdentity;
