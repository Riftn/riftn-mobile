/**
 * OG Holder Challenge: who brought the most original DHB holders to Riftn.
 *
 * An OG holder joined with your invite link (a row in `affiliate_referrals`)
 * and holds DHB in their Riftn wallet (the holdings board's on-chain cache).
 * Rows come out in the affiliate board's shape (`directReferrals` = OG holders
 * brought), ties broken on the DHB they hold. Same ranking as web
 * (lib/api/og-challenge-leaderboard).
 */
import { supabase } from './supabase';
import { getAccountSummaries, type AccountSummary } from './user.service';
import { getLeaderboard, type LeaderboardPeriod, type LeaderboardUser } from './leaderboard.service';
import { rankOgHolders, type OgReferral } from '../libs/ogChallengeRank';

const MAX_REFERRAL_ROWS = 10_000;
const MAX_PROFILE_LOOKUPS = 50;

const PERIOD_DAYS: Record<Exclude<LeaderboardPeriod, 'all'>, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

export interface OgChallengeEntry extends LeaderboardUser {
  directReferrals: number;
  secondaryReferrals: number;
  /** DHB the OG holders this account brought hold now (hidden balances left out). */
  ogDhb: number;
}

export async function getOgChallengeLeaderboard(period: LeaderboardPeriod = 'all'): Promise<OgChallengeEntry[]> {
  // @ts-ignore - affiliate_referrals not in generated Database types
  let query = supabase
    .from('affiliate_referrals' as never)
    .select('owner_address, referred_address, created_at')
    .order('created_at', { ascending: true })
    .limit(MAX_REFERRAL_ROWS);
  if (period !== 'all') {
    query = query.gte('created_at', new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString());
  }

  const [referrals, holdings] = await Promise.all([
    query as unknown as Promise<{ data: OgReferral[] | null; error: any }>,
    getLeaderboard({ sort: 'holdings', period: 'all' }),
  ]);
  if (referrals.error) throw referrals.error;
  const ranked = rankOgHolders(referrals.data ?? [], holdings.data?.result?.byWalletBalance ?? []);

  const profiles: AccountSummary[] = await getAccountSummaries(
    ranked.slice(0, MAX_PROFILE_LOOKUPS).map((row) => row.account),
  ).catch(() => [] as AccountSummary[]);
  const byAddress = new Map<string, AccountSummary>();
  for (const profile of profiles) if (profile?.address) byAddress.set(profile.address.toLowerCase(), profile);

  return ranked
    .map((row) => {
      const profile = byAddress.get(row.account);
      return {
        account: row.account,
        total: row.count,
        username: profile?.username ?? undefined,
        userDisplayName: profile?.displayName ?? undefined,
        avatarUrl: profile?.avatarImageUrl ?? undefined,
        badgeBalance: profile?.badgeBalance ?? undefined,
        sentTips: 0,
        receivedTips: 0,
        followers: 0,
        likes: 0,
        directReferrals: row.count,
        secondaryReferrals: 0,
        ogDhb: row.dhb,
        isBanned: profile?.isBanned === true,
      };
    })
    .filter((entry) => !entry.isBanned)
    .map(({ isBanned: _isBanned, ...entry }) => entry);
}
