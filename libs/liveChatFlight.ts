/**
 * Sending in a live chat: your words leave the box and fly into their line in
 * the chat (concept "B Fold in"). The box launches a flight, LiveChatFlyer
 * draws the line in the air, and LiveViewerChat hands over to the real line
 * the moment the copy lands on it, so the line is never drawn twice.
 *
 * The real line only exists once the server echoes it back; until then the
 * copy waits where the newest line goes.
 */
export type FlightPoint = { x: number; y: number };
export type Flight = {
  id: number;
  text: string;
  /** Where the words started in the box (window coordinates). */
  from: FlightPoint;
  startedAt: number;
  /** Where the real line sits, once it is drawn (window coordinates). */
  row: FlightPoint | null;
  /** The copy has reached its spot. */
  arrived: boolean;
  /** The real line has been shown and the copy is gone. */
  done: boolean;
  /** A line in the chat has taken this flight. */
  claimed?: boolean;
};

type Listener = (flight: Flight | null) => void;
let current: Flight | null = null;
let nextId = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((fn) => fn(current));

export function subscribeFlight(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function currentFlight(): Flight | null {
  return current;
}

export function launchFlight(text: string, from: FlightPoint): void {
  current = { id: nextId++, text: text.trim(), from, startedAt: Date.now(), row: null, arrived: false, done: false };
  emit();
}

/** A new line of yours arrived: is it the one in the air? */
export function claimFlight(text: string): Flight | null {
  if (!current || current.done || current.claimed) return null;
  if (Date.now() - current.startedAt > 6000) return null;
  if (current.text !== String(text || "").trim()) return null;
  current.claimed = true;
  return current;
}

export function reportRow(id: number, at: FlightPoint): void {
  if (!current || current.id !== id) return;
  current = { ...current, row: at };
  emit();
}

export function markArrived(id: number): void {
  if (!current || current.id !== id) return;
  current = { ...current, arrived: true };
  emit();
}

export function finishFlight(id: number): void {
  if (!current || current.id !== id) return;
  current = { ...current, done: true };
  emit();
  current = null;
  emit();
}

/**
 * Where the newest chat line goes: the bottom-left of the chat's content, and
 * its width (window coordinates). Registered by LiveViewerChat.
 */
export type ChatAnchor = { x: number; y: number; width: number };
let anchorMeasure: ((cb: (a: ChatAnchor | null) => void) => void) | null = null;
export function setChatAnchor(fn: typeof anchorMeasure): void {
  anchorMeasure = fn;
}
export function measureChatAnchor(cb: (a: ChatAnchor | null) => void): void {
  if (!anchorMeasure) { cb(null); return; }
  anchorMeasure(cb);
}
