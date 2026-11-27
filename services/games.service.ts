/**
 * Games with friends
 * ==================
 * Correspondence chess (days per move, a push when it is your turn) and
 * Okey 101 tables (four seats, bots fill the empty ones), plus the BTC / ETH /
 * gold strip in the Money menu. Backend: riftn-backend src/games. The server
 * is the only judge of moves; the screens draw what it says and send what you
 * tap. Nothing here moves money.
 */
import { apiClient } from '../libs/api.client';
import type { SpendAction, SpendCreate, SpendGame, SpendLobby } from '../libs/spend';

function unwrap<T>(response: any): T {
  if (response && response.status === false) throw new Error(response.error || response.message || 'Request failed');
  return (response?.result ?? response) as T;
}
const get = async <T,>(path: string, auth = true) => unwrap<T>(await apiClient.get(path, { isAuthRequired: auth }));
const post = async <T,>(path: string, body: Record<string, unknown> = {}) => unwrap<T>(await apiClient.post(path, body, { isAuthRequired: true }));

export interface ArcadeListingState {
  hidden: string[];
  editable: string[];
}

export const getArcadeListings = (signedIn: boolean) =>
  get<ArcadeListingState>('/games/arcade-listings', signedIn);

export const setArcadeListing = (slug: string, hidden: boolean) =>
  post<{ slug: string; hidden: boolean }>(`/games/arcade-listings/${encodeURIComponent(slug)}`, { hidden });

const SPEND_API = '/games/spend';
const spendApiPath = (id: string) => SPEND_API + '/' + encodeURIComponent(id);
export const spendList = () => get<SpendLobby>(SPEND_API);
export const spendGet = (id: string, signedIn: boolean) => get<{ game: SpendGame }>(spendApiPath(id), signedIn);
export const spendCreate = (body: SpendCreate) => post<{ game: SpendGame }>(SPEND_API, body);
export const spendAction = (id: string, action: SpendAction) =>
  post<{ game: SpendGame }>(spendApiPath(id) + '/' + action.name, 'body' in action ? action.body : {});

export interface GamePlayer {
  address: string;
  username: string | null;
  displayName: string | null;
  avatarImageUrl: string | null;
}

export interface ChessGame {
  id: string;
  status: 'pending' | 'active' | 'finished' | 'declined' | 'cancelled';
  createdBy: GamePlayer | null;
  invitee: GamePlayer | null;
  white: GamePlayer | null;
  black: GamePlayer | null;
  creatorColor: 'white' | 'black' | 'random';
  daysPerMove: number;
  fen: string;
  moves: string[];
  lastMove: { from: string; to: string } | null;
  turn: 'w' | 'b';
  inCheck: boolean;
  moveDeadline: string | null;
  result: '1-0' | '0-1' | '1/2-1/2' | null;
  endReason: string | null;
  drawOfferBy: string | null;
  you: 'w' | 'b' | null;
  yourTurn: boolean;
  legal?: Array<{ from: string; to: string; promotion?: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface ChessList {
  games: ChessGame[];
  open: ChessGame[];
  myTurn: number;
  dayChoices: number[];
}

export const chessList = () => get<ChessList>('/games/chess');
export const chessGet = (id: string, signedIn: boolean) => get<{ game: ChessGame }>(`/games/chess/${encodeURIComponent(id)}`, signedIn);
export const chessCreate = (body: { opponent?: string; days: number; color: 'white' | 'black' | 'random' }) =>
  post<{ game: ChessGame }>('/games/chess', body);
export const chessAction = (id: string, action: 'accept' | 'decline' | 'resign') =>
  post<{ game: ChessGame }>(`/games/chess/${encodeURIComponent(id)}/${action}`);
export const chessMove = (id: string, move: { from: string; to: string; promotion?: string }) =>
  post<{ game: ChessGame }>(`/games/chess/${encodeURIComponent(id)}/move`, move);
export const chessDraw = (id: string, action: 'offer' | 'accept' | 'decline') =>
  post<{ game: ChessGame }>(`/games/chess/${encodeURIComponent(id)}/draw`, { action });

/** Board squares from a FEN, a8 first. */
export function fenBoard(fen: string): Array<{ square: string; piece: string | null }> {
  const rows = fen.split(' ')[0].split('/');
  const out: Array<{ square: string; piece: string | null }> = [];
  rows.forEach((row, r) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) out.push({ square: `${'abcdefgh'[file++]}${8 - r}`, piece: null });
      } else {
        out.push({ square: `${'abcdefgh'[file++]}${8 - r}`, piece: ch });
      }
    }
  });
  return out;
}

// ------------------------------------------------------------------ okey

export interface OkeySeatView {
  seat: number;
  address: string | null;
  bot: boolean;
  name: string | null;
  username: string | null;
  avatarImageUrl: string | null;
  tiles: number;
  opened: false | 'melds' | 'pairs';
  openedPoints: number;
  discards: number[];
  total: number;
  idleTurns: number;
}

export interface OkeyMeld {
  id: number;
  seat: number;
  kind: 'run' | 'set' | 'pair';
  tiles: number[];
  points: number;
}

export interface OkeyTable {
  id: string;
  name: string;
  locked: boolean;
  status: 'waiting' | 'playing' | 'closed';
  host: string;
  youHost: boolean;
  version: number;
  seats: OkeySeatView[];
  mySeat: number | null;
  hand: number[] | null;
  round: {
    number: number;
    dealer: number;
    indicator: number;
    deckCount: number;
    turn: number;
    phase: 'draw' | 'play';
    takenDiscard: number | null;
    melds: OkeyMeld[];
    lastAction: { seat: number; type: string; tile?: number; at: number } | null;
    over: boolean;
    winner: number | null;
    scores: number[] | null;
    turnEndsAt: number | null;
  } | null;
  turnSeconds: number;
  serverTime: number;
}

export interface OkeyLobbyRow {
  id: string;
  name: string;
  locked: boolean;
  status: 'waiting' | 'playing';
  round: number;
  players: number;
  bots: number;
  openSeats: number;
  seats: Array<{ seat: number; bot: boolean; name: string | null; avatarImageUrl: string | null; empty: boolean }>;
  mine: boolean;
  host: boolean;
}

export const okeyLobby = (signedIn: boolean) => get<{ tables: OkeyLobbyRow[]; turnSeconds: number }>('/games/okey/tables', signedIn);
export const okeyCreate = (body: { name?: string; password?: string; withBots?: boolean }) => post<{ table: OkeyTable }>('/games/okey/tables', body);
export const okeyGet = (id: string, signedIn: boolean) => get<{ table: OkeyTable }>(`/games/okey/tables/${encodeURIComponent(id)}`, signedIn);
export const okeyJoin = (id: string, body: { password?: string; seat?: number }) => post<{ table: OkeyTable }>(`/games/okey/tables/${encodeURIComponent(id)}/join`, body);
export const okeyLeave = (id: string) => post<{ ok: boolean }>(`/games/okey/tables/${encodeURIComponent(id)}/leave`);
export const okeyStart = (id: string) => post<{ table: OkeyTable }>(`/games/okey/tables/${encodeURIComponent(id)}/start`);
export const okeyNext = (id: string) => post<{ table: OkeyTable }>(`/games/okey/tables/${encodeURIComponent(id)}/next`);
export type OkeyAction =
  | { type: 'draw'; from: 'deck' | 'discard' }
  | { type: 'putback' }
  | { type: 'lay'; groups: number[][] }
  | { type: 'layoff'; tile: number; meld: number }
  | { type: 'discard'; tile: number };
export const okeyAct = (id: string, action: OkeyAction) => post<{ table: OkeyTable }>(`/games/okey/tables/${encodeURIComponent(id)}/action`, action as unknown as Record<string, unknown>);

/** Colour index 0..3 (red, yellow, blue, black) and number, or a false joker. */
export function tileFace(tile: number): { c: number; n: number; falseJoker: boolean } {
  if (tile >= 104) return { c: -1, n: 0, falseJoker: true };
  return { c: Math.floor(tile / 26), n: (tile % 13) + 1, falseJoker: false };
}

export function okeyOf(indicator: number): { c: number; n: number } {
  const f = tileFace(indicator);
  return { c: f.c, n: f.n === 13 ? 1 : f.n + 1 };
}

export function isOkeyTile(tile: number, indicator: number): boolean {
  if (tile >= 104) return false;
  const f = tileFace(tile);
  const o = okeyOf(indicator);
  return f.c === o.c && f.n === o.n;
}

/** Sort for the rack: by colour then number (runs), or number then colour (sets). */
export function sortTiles(tiles: number[], by: 'runs' | 'sets', indicator?: number): number[] {
  const key = (t: number) => {
    if (indicator !== undefined && t >= 104) {
      const o = okeyOf(indicator);
      return by === 'runs' ? o.c * 100 + o.n : o.n * 10 + o.c;
    }
    const f = tileFace(t);
    if (indicator !== undefined && isOkeyTile(t, indicator)) return 9999;
    return by === 'runs' ? f.c * 100 + f.n : f.n * 10 + f.c;
  };
  return [...tiles].sort((a, b) => key(a) - key(b) || a - b);
}

// ------------------------------------------------------------------ markets

export interface TickerItem {
  id: 'btc' | 'eth' | 'gold';
  label: string;
  price: number;
  change24h: number | null;
}

export const marketTicker = () => get<{ items: TickerItem[]; updatedAt: string }>('/markets/ticker', false);

/**
 * Points of a run or set as the server will count them (preview only; the
 * server decides). Mirrors riftn-backend src/games/okey.engine.ts scoreMeld.
 */
export function meldPoints(tiles: number[], indicator: number): number | null {
  if (tiles.length < 3) return null;
  const wild = tiles.filter((t) => isOkeyTile(t, indicator)).length;
  const fixed = tiles.filter((t) => !isOkeyTile(t, indicator)).map((t) => (t >= 104 ? okeyOf(indicator) : tileFace(t)));
  if (!fixed.length) return null;
  let best: number | null = null;
  if (tiles.length <= 4 && fixed.every((f) => f.n === fixed[0].n) && new Set(fixed.map((f) => f.c)).size === fixed.length) {
    best = fixed[0].n * tiles.length;
  }
  if (fixed.every((f) => f.c === fixed[0].c) && tiles.length <= 13) {
    for (let start = 1; start + tiles.length - 1 <= 14; start++) {
      const free = new Set(Array.from({ length: tiles.length }, (_, i) => start + i));
      let ok = true;
      for (const f of fixed) {
        const slot = f.n === 1 && !free.has(1) && free.has(14) ? 14 : f.n;
        if (!free.has(slot)) { ok = false; break; }
        free.delete(slot);
      }
      if (!ok || free.size !== wild) continue;
      const pts = Array.from({ length: tiles.length }, (_, i) => start + i).reduce((s, v) => s + (v === 14 ? 1 : v), 0);
      if (best === null || pts > best) best = pts;
    }
  }
  return best;
}

export function isPairTiles(tiles: number[], indicator: number): boolean {
  if (tiles.length !== 2) return false;
  const [a, b] = tiles;
  if (isOkeyTile(a, indicator) || isOkeyTile(b, indicator)) return true;
  const fa = a >= 104 ? okeyOf(indicator) : tileFace(a);
  const fb = b >= 104 ? okeyOf(indicator) : tileFace(b);
  return fa.c === fb.c && fa.n === fb.n;
}

// ------------------------------------------------------------------ SillyCoin
// Tap-to-mine idle game. SillyCoins are game points with no value: not a
// token, never connected to a wallet. The server caps taps at 15 a second and
// idle pay at 8 hours (riftn-backend src/games/sillycoin.service.ts).

export type SillyUpgradeKind = 'pick' | 'miner' | 'rig';

export interface SillyUpgrade {
  kind: SillyUpgradeKind;
  level: number;
  cost: number | null;
  maxed: boolean;
  perTap: number;
  perSecond: number;
}

export interface SillyMe {
  balance: number;
  totalMined: number;
  totalSent: number;
  totalReceived: number;
  perTap: number;
  perSecond: number;
  upgrades: SillyUpgrade[];
  awayEarned: number;
  awaySeconds: number;
  serverTime: string;
}

export interface SillyTransfer {
  id: string;
  direction: 'in' | 'out';
  other: GamePlayer;
  amount: number;
  note: string | null;
  createdAt: string;
}

export interface SillyBoardRow {
  rank: number;
  player: GamePlayer;
  totalMined: number;
}

export interface SillyState {
  transferNotificationsEnabled?: boolean;
  rules: { maxTapsPerSecond: number; offlineCapHours: number; maxLevel: number };
  me: SillyMe | null;
  transfers: SillyTransfer[];
  leaderboard: SillyBoardRow[];
}

export const sillyState = (signedIn: boolean) => get<SillyState>('/games/sillycoin', signedIn);
export const sillySetTransferNotifications = (enabled: boolean) =>
  post<{ enabled: boolean }>('/games/sillycoin/transfer-notifications', { enabled });
export const sillyMine = (taps: number) => post<{ me: SillyMe; accepted: number }>('/games/sillycoin/mine', { taps });
export const sillyUpgrade = (kind: SillyUpgradeKind, taps: number) => post<{ me: SillyMe }>('/games/sillycoin/upgrade', { kind, taps });
export const sillySend = (body: { to: string; amount: number; note?: string; taps: number }) =>
  post<{ me: SillyMe; transfer: SillyTransfer }>('/games/sillycoin/send', body);

/** Starting prices, shown to signed-out players (same as the server's). */
export const SILLY_UPGRADES: Record<SillyUpgradeKind, { base: number; perTap: number; perSecond: number }> = {
  pick: { base: 20, perTap: 1, perSecond: 0 },
  miner: { base: 50, perTap: 0, perSecond: 1 },
  rig: { base: 1500, perTap: 0, perSecond: 10 },
};

// ------------------------------------------------------------ Gratitude pen pals
// Two players take turns saying one thing they are grateful for. The server
// turns away repeats (riftn-backend src/games/gratitude.check.ts) without
// using the turn, and whoever lets their turn time run out loses.

export interface GratitudeLine {
  n: number;
  by: string;
  text: string;
  at: string;
}

export interface GratitudeGame {
  id: string;
  status: 'pending' | 'active' | 'finished' | 'declined' | 'cancelled';
  createdBy: GamePlayer | null;
  invitee: GamePlayer | null;
  players: GamePlayer[];
  daysPerTurn: number;
  lineCount: number;
  lines?: GratitudeLine[];
  lastLine: { by: string; text: string; at: string } | null;
  turn: GamePlayer | null;
  turnDeadline: string | null;
  winner: GamePlayer | null;
  endReason: 'timeout' | 'gave_up' | null;
  you: string | null;
  yourTurn: boolean;
  maxChars: number;
  /** Played against the computer (it plays as @assistant). */
  vsComputer?: boolean;
  level?: GratitudeLevel | null;
  /** Turn time in seconds for computer games (60, 300 or 86400). */
  turnSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

export type GratitudeLevel = 'easy' | 'normal' | 'hard';

export interface GratitudeList {
  games: GratitudeGame[];
  open: GratitudeGame[];
  myTurn: number;
  dayChoices: number[];
}

export interface GratitudeCheck {
  ok: boolean;
  reason?: 'empty' | 'short' | 'long' | 'link' | 'repeat';
  repeatOf?: number | null;
  message?: string;
}

const gratitudePath = (id: string, tail = '') => `/games/gratitude/${encodeURIComponent(id)}${tail}`;
export const gratitudeList = () => get<GratitudeList>('/games/gratitude');
export const gratitudeGet = (id: string, signedIn: boolean) => get<{ game: GratitudeGame }>(gratitudePath(id), signedIn);
export const gratitudeCreate = (body: { opponent?: string; days?: number; computer?: boolean; level?: GratitudeLevel; turnSeconds?: number }) => post<{ game: GratitudeGame }>('/games/gratitude', body);
export const gratitudeAction = (id: string, action: 'accept' | 'decline' | 'give-up') => post<{ game: GratitudeGame }>(gratitudePath(id, `/${action}`));
export const gratitudeWrite = (id: string, text: string) => post<{ game: GratitudeGame }>(gratitudePath(id, '/line'), { text });
export const gratitudeCheck = (id: string, text: string) => post<GratitudeCheck>(gratitudePath(id, '/check'), { text });

// ------------------------------------------------------------------ Chestard
// Dice-drop arcade game. The server rolls every die one at a time
// (riftn-backend src/games/chestard.service.ts), so the top 10 is real games.

export interface ChestardRun {
  id: string;
  heights: number[];
  score: number;
  lines: number;
  drops: number;
  over: boolean;
}

export interface ChestardRoll extends ChestardRun {
  die: number;
  column: number;
  landedRow: number;
  points: number;
  cleared: boolean;
  bonus: number;
  newBest: boolean;
}

export interface ChestardBoardRow {
  rank: number;
  player: GamePlayer;
  best: number;
  lines: number;
}

export interface ChestardState {
  rules: { cols: number; rows: number; lineBonus: number };
  me: { best: number; bestLines: number; games: number } | null;
  run: ChestardRun | null;
  leaderboard: ChestardBoardRow[];
  daily?: { endsAt: string; leaderboard: ChestardBoardRow[] };
}

export const chestardState = (signedIn: boolean) => get<ChestardState>('/games/chestard', signedIn);
export const chestardStart = () => post<{ run: ChestardRun }>('/games/chestard/start', {});
export const chestardRoll = (id: string) => post<{ roll: ChestardRoll }>(`/games/chestard/${encodeURIComponent(id)}/roll`, {});

// ------------------------------------------------------------ score cards
// A shared arcade link names who shared it (`?by=<user>`); the feed card reads
// that player's best from the game's own board (riftn-backend
// src/games/arcade-card.service.ts), never from the link.

export interface ArcadeCard {
  game: string;
  player: GamePlayer | null;
  best: number | null;
  rank: number | null;
  unit: 'points' | 'coins' | null;
}

export const arcadeCard = (game: string, player: string) =>
  get<ArcadeCard>(`/games/card?game=${encodeURIComponent(game)}&player=${encodeURIComponent(player)}`, false);
