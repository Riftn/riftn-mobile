import { readStoredSessionUserId, restoreSavedSession } from "../../libs/supabase-session";

const store = (value: string | null) => ({ getItem: jest.fn().mockResolvedValue(value) });

describe("readStoredSessionUserId", () => {
  it("reads the user id from the stored session without touching the network", async () => {
    const s = store(JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "uid-1" } }));
    await expect(readStoredSessionUserId(s, "sb-proj-auth-token")).resolves.toBe("uid-1");
    expect(s.getItem).toHaveBeenCalledWith("sb-proj-auth-token");
  });

  it("returns null when there is no usable stored session", async () => {
    await expect(readStoredSessionUserId(store(null), "k")).resolves.toBeNull();
    await expect(readStoredSessionUserId(store("{oops"), "k")).resolves.toBeNull();
    await expect(readStoredSessionUserId(store(JSON.stringify({ user: {} })), "k")).resolves.toBeNull();
    await expect(readStoredSessionUserId(store("x"), undefined)).resolves.toBeNull();
  });
});

describe("restoring a saved profile", () => {
  const session = { user: { id: "selected" } };

  it("accepts a confirmed session, including profiles saved before a user ID was recorded", async () => {
    for (const id of ["selected", null]) {
      await expect(restoreSavedSession(Promise.resolve({ data: { session }, error: null }), id)).resolves.toBeUndefined();
    }
  });

  it("rejects a resolved SDK error so the caller rolls back the account switch", async () => {
    const error = new Error("Saved session has expired");
    await expect(restoreSavedSession(Promise.resolve({ data: { session: null }, error }), "selected")).rejects.toBe(error);
  });

  it("rejects a missing session or a session belonging to a different account", async () => {
    for (const value of [null, session]) {
      await expect(restoreSavedSession(Promise.resolve({ data: { session: value }, error: null }), "different")).rejects.toThrow("not restored");
    }
  });
});
