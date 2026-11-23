jest.mock("../../libs/storage", () => {
  const data = new Map<string, string>();
  return { storage: { getString: (k: string) => data.get(k), set: (k: string, v: string) => data.set(k, v) } };
});
import { hideLineForMe, readHiddenLines } from "../../libs/public-chat-hidden";

test("a line deleted for me stays hidden for that account only", () => {
  expect(readHiddenLines("0xAA").size).toBe(0);
  hideLineForMe("0xAA", "m1");
  hideLineForMe("0xaa", "m1");
  expect([...readHiddenLines("0xaa")]).toEqual(["m1"]);
  expect(readHiddenLines("0xbb").size).toBe(0);
  expect(readHiddenLines(null).size).toBe(0);
});
