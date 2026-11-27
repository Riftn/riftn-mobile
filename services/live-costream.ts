import { supabase, walletScopedClient } from "./supabase";

type SeatStatus = "requested" | "invited" | "accepted" | "declined" | "left" | "removed";
type Seat = { id: string; status: SeatStatus; stream_id: string | null };
type Room = { id: string; host_wallet: string; accepting_requests: boolean };
const ROOM_COLUMNS = "id, host_wallet, accepting_requests";

export type LiveCoStreamAction =
  | { kind: "ask"; roomId: string; seat?: Seat }
  | { kind: "cancel"; seatId: string }
  | { kind: "join"; roomId: string };

export function liveCoStreamAction(room: Room, wallet: string, seat: Seat | null): LiveCoStreamAction | null {
  if (room.host_wallet === wallet) return null;
  if (seat?.status === "requested") return { kind: "cancel", seatId: seat.id };
  if (seat?.status === "invited" || (seat?.status === "accepted" && !seat.stream_id)) {
    return { kind: "join", roomId: room.id };
  }
  if (room.accepting_requests && (!seat || seat.status === "declined" || seat.status === "left")) {
    return { kind: "ask", roomId: room.id, ...(seat ? { seat } : {}) };
  }
  return null;
}

export async function getLiveCoStreamAction(streamId: string, owner: string, wallet: string, signal: AbortSignal) {
  const { data: hosted, error: hostError } = await supabase.from("live_costreams").select(ROOM_COLUMNS)
    .eq("host_stream_id", streamId).eq("host_wallet", owner).eq("status", "active").abortSignal(signal).maybeSingle();
  if (hostError) throw hostError;
  let room = hosted as Room | null;

  if (!room) {
    const { data, error } = await supabase.from("live_costream_guests")
      .select("room:live_costreams!inner(id, host_wallet, accepting_requests)")
      .eq("stream_id", streamId).eq("wallet", owner).eq("status", "accepted").eq("room.status", "active")
      .limit(1).abortSignal(signal).maybeSingle();
    if (error) throw error;
    // This foreign key points to exactly one room.
    room = (data?.room as unknown as Room | null) ?? null;
  }
  if (!room || room.host_wallet === wallet) return null;
  if (!wallet) return liveCoStreamAction(room, wallet, null);

  const { data, error } = await supabase.from("live_costream_guests").select("id, status, stream_id")
    .eq("costream_id", room.id).eq("wallet", wallet).abortSignal(signal).maybeSingle();
  if (error) throw error;
  return liveCoStreamAction(room, wallet, data as Seat | null);
}

export async function changeLiveCoStreamRequest(
  wallet: string,
  action: Exclude<LiveCoStreamAction, { kind: "join" }>,
  username?: string | null,
): Promise<boolean> {
  const seats = walletScopedClient(wallet).from("live_costream_guests");
  if (action.kind === "cancel") {
    const { data, error } = await seats.update({ status: "left" })
      .eq("id", action.seatId).eq("wallet", wallet).eq("status", "requested").select("id").maybeSingle();
    if (error) throw error;
    return !!data;
  }

  const request = { status: "requested", username: username || null, stream_id: null };
  if (action.seat) {
    const { data, error } = await seats.update(request)
      .eq("id", action.seat.id).eq("wallet", wallet).eq("status", action.seat.status).select("id").maybeSingle();
    if (error) throw error;
    return !!data;
  }
  const { error } = await seats.insert({ ...request, costream_id: action.roomId, wallet });
  if (error?.code === "23505") return false;
  if (error) throw error;
  return true;
}
