/**
 * A plain 2D chess board for correspondence games. The server sends the legal
 * moves for the player on move, so this draws dots where a tapped piece can go
 * and hands the chosen move back. No chess rules live here.
 * Web twin: riftn-web src/components/app/games/ChessBoard2D.tsx.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { fenBoard } from '../../services/games.service';

// U+FE0E keeps the text glyph: without it phones draw the pawn as a colour emoji.
const GLYPH: Record<string, string> = { k: '♚︎', q: '♛︎', r: '♜︎', b: '♝︎', n: '♞︎', p: '♟︎' };
const LIGHT = 'hsla(37, 64%, 82%, 1)';
const DARK = 'hsla(27, 36%, 55%, 1)';
const SELECTED = 'hsla(60, 88%, 69%, 1)';
const LAST_LIGHT = 'hsla(63, 52%, 62%, 1)';
const LAST_DARK = 'hsla(56, 49%, 45%, 1)';

export interface BoardMove { from: string; to: string; promotion?: string }

export default function ChessBoardNative({
  fen,
  flipped,
  legal,
  lastMove,
  checkSquare,
  disabled,
  size,
  onMove,
}: {
  fen: string;
  flipped: boolean;
  legal?: BoardMove[];
  lastMove?: { from: string; to: string } | null;
  checkSquare?: string | null;
  disabled?: boolean;
  size: number;
  onMove: (move: BoardMove) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const squares = useMemo(() => {
    const all = fenBoard(fen);
    return flipped ? [...all].reverse() : all;
  }, [fen, flipped]);
  const targets = useMemo(() => new Set((legal ?? []).filter((m) => m.from === selected).map((m) => m.to)), [legal, selected]);
  const movable = useMemo(() => new Set((legal ?? []).map((m) => m.from)), [legal]);
  const cell = Math.floor(size / 8);
  const board = cell * 8;

  const tap = (square: string) => {
    if (disabled) return;
    if (selected && targets.has(square)) {
      const options = (legal ?? []).filter((m) => m.from === selected && m.to === square);
      if (options.some((m) => m.promotion)) setPromo({ from: selected, to: square });
      else onMove({ from: selected, to: square });
      setSelected(null);
      return;
    }
    setSelected(movable.has(square) && selected !== square ? square : null);
  };

  const whiteToMove = fen.split(' ')[1] === 'w';
  return (
    <View style={{ width: board, height: board, alignSelf: 'center' }} accessibilityLabel={t('games.chess.boardLabel')}>
      <View style={[styles.grid, { width: board, height: board }]}>
        {squares.map(({ square, piece }) => {
          const file = square.charCodeAt(0) - 97;
          const rank = Number(square[1]);
          const dark = (file + rank) % 2 === 0;
          const isLast = !!lastMove && (lastMove.from === square || lastMove.to === square);
          const isTarget = targets.has(square);
          const white = piece ? piece === piece.toUpperCase() : false;
          const showFile = flipped ? rank === 8 : rank === 1;
          const showRank = flipped ? file === 7 : file === 0;
          const bg = selected === square ? SELECTED : isLast ? (dark ? LAST_DARK : LAST_LIGHT) : dark ? DARK : LIGHT;
          return (
            <Pressable
              key={square}
              onPress={() => tap(square)}
              accessibilityRole="button"
              accessibilityLabel={`${square}${piece ? ` ${piece}` : ''}`}
              style={{ width: cell, height: cell }}
            >
              <View style={[styles.square, { backgroundColor: bg }]}>
                {checkSquare === square ? <View style={styles.check} pointerEvents="none" /> : null}
                {piece ? (
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.piece,
                      { fontSize: cell * 0.78, lineHeight: cell * 0.95, color: white ? 'hsla(60, 20%, 98%, 1)' : 'hsla(24, 10%, 10%, 1)' },
                      white ? styles.whiteShadow : styles.blackShadow,
                    ]}
                  >
                    {GLYPH[piece.toLowerCase()]}
                  </Text>
                ) : null}
                {isTarget ? (
                  <View
                    pointerEvents="none"
                    style={piece
                      ? [StyleSheet.absoluteFillObject, styles.captureRing, { borderRadius: cell / 2, margin: 3 }]
                      : { width: cell * 0.28, height: cell * 0.28, borderRadius: cell, backgroundColor: 'hsla(0, 0%, 0%, 0.25)' }}
                  />
                ) : null}
                {showFile ? <Text allowFontScaling={false} style={[styles.coord, styles.file, { color: dark ? LIGHT : DARK }]}>{square[0]}</Text> : null}
                {showRank ? <Text allowFontScaling={false} style={[styles.coord, styles.rank, { color: dark ? LIGHT : DARK }]}>{rank}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {promo ? (
        <View style={styles.promoBackdrop}>
          <View style={styles.promoCard}>
            {['q', 'r', 'b', 'n'].map((p) => (
              <Pressable
                key={p}
                accessibilityRole="button"
                onPress={() => {
                  onMove({ ...promo, promotion: p });
                  setPromo(null);
                }}
              >
                <View style={styles.promoButton}>
                  <Text allowFontScaling={false} style={[styles.promoGlyph, { color: whiteToMove ? 'hsla(60, 20%, 98%, 1)' : 'hsla(30, 6%, 64%, 1)' }]}>{GLYPH[p]}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 12, overflow: 'hidden' },
  square: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  check: { ...StyleSheet.absoluteFillObject, backgroundColor: 'hsla(0, 73%, 51%, 0.55)' },
  piece: { textAlign: 'center', includeFontPadding: false },
  whiteShadow: { textShadowColor: 'hsla(0, 0%, 0%, 0.9)', textShadowRadius: 1.5, textShadowOffset: { width: 0, height: 0.5 } },
  blackShadow: { textShadowColor: 'hsla(0, 0%, 100%, 0.25)', textShadowRadius: 1, textShadowOffset: { width: 0, height: 0.5 } },
  captureRing: { borderWidth: 4, borderColor: 'hsla(0, 0%, 0%, 0.25)' },
  coord: { position: 'absolute', fontSize: 9, fontWeight: '600' },
  file: { bottom: 1, right: 3 },
  rank: { top: 1, left: 3 },
  promoBackdrop: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsla(0, 0%, 0%, 0.6)', borderRadius: 12 },
  promoCard: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 14, backgroundColor: 'hsla(240, 6%, 10%, 1)' },
  promoButton: { width: 56, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'hsla(240, 4%, 16%, 1)' },
  promoGlyph: { fontSize: 38 },
});
