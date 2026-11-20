/**
 * Which glyph the post Share button uses (Settings > Appearance), same choice
 * and storage key as web (lib/share-icon-style):
 * - classic:    the usual three-dot share icon (default)
 * - distribute: a person in a ring with arrows pointing out
 */
export type ShareIconStyle = 'classic' | 'distribute';

export function isShareIconStyle(value: unknown): value is ShareIconStyle {
  return value === 'classic' || value === 'distribute';
}
