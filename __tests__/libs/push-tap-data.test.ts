import { readNotificationData } from "../../libs/push-tap-data";

const tap = (data: unknown, trigger: unknown = null) =>
  ({ request: { identifier: "x", content: { data }, trigger } }) as any;

describe("readNotificationData", () => {
  it("reads the payload from content.data", () => {
    expect(readNotificationData(tap({ type: "new_message", conversationId: "c1" }))).toEqual({
      type: "new_message",
      conversationId: "c1",
    });
  });

  it("falls back to the Android FCM body string when content.data is empty", () => {
    const trigger = { type: "push", remoteMessage: { data: { body: JSON.stringify({ type: "new_message", conversationId: "c2" }) } } };
    expect(readNotificationData(tap({}, trigger))?.conversationId).toBe("c2");
  });

  it("falls back to the iPhone payload body", () => {
    const trigger = { type: "push", payload: { body: { type: "like", tokenId: 5 } } };
    expect(readNotificationData(tap(null, trigger))?.tokenId).toBe(5);
  });

  it("returns null when nothing names a type", () => {
    expect(readNotificationData(tap({}, { remoteMessage: { data: { body: "not json" } } }))).toBeNull();
    expect(readNotificationData(undefined)).toBeNull();
  });
});
