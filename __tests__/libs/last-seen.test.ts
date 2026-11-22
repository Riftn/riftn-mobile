jest.mock("../../libs/api.client", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
import { getShowLastSeen, lastSeenWhen } from "../../libs/last-seen";

test("off unless turned on", () => {
  expect(getShowLastSeen(undefined)).toBe(false);
  expect(getShowLastSeen({ showLastSeen: "off" })).toBe(false);
  expect(getShowLastSeen({ showLastSeen: "on" })).toBe(true);
});

test("reads short and relative", () => {
  const now = Date.UTC(2026, 10, 22, 18, 0);
  expect(lastSeenWhen(now - 20_000, "en", now)).toBeNull();
  expect(lastSeenWhen(now - 5 * 60_000, "en", now)).toMatch(/5 min/);
  expect(lastSeenWhen(now - 3 * 3600_000, "en", now)).toMatch(/3 hr/);
});
