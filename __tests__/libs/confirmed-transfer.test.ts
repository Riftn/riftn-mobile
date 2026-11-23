import { confirmTransfer, pendingTransfers } from "../../libs/confirmed-transfer";
import { storage } from "../../libs/storage";

beforeEach(() => storage.clearAll());

it("shares an in-flight payment and resumes its confirmation after relaunch", async () => {
  const operation = ["fraction", "alice", "confirm", 8453, "listing", 2];
  const send = jest.fn(async (remember: (hash: string) => void) => {
    remember("receipt");
    return "receipt";
  });
  const confirm = jest.fn().mockRejectedValueOnce(new Error("offline"));
  const first = confirmTransfer(operation, send, confirm);
  expect(confirmTransfer(operation, send, confirm)).toBe(first);
  await expect(first).rejects.toThrow("offline");
  expect(pendingTransfers("Bob")).toEqual([]);
  expect(pendingTransfers("ALICE")).toEqual([operation]);

  let reopened!: typeof import("../../libs/confirmed-transfer");
  jest.isolateModules(() => {
    // Both JS runtimes use the same underlying native store.
    jest.doMock("../../libs/storage", () => ({ storage }));
    reopened = require("../../libs/confirmed-transfer");
  });
  confirm.mockResolvedValueOnce("credited");
  await expect(reopened.confirmTransfer(operation, send, confirm)).resolves.toBe("credited");
  expect(send).toHaveBeenCalledTimes(1);
  expect(confirm).toHaveBeenLastCalledWith("receipt");
  expect(reopened.pendingTransfers("alice")).toEqual([]);
});

it("keeps a broadcast receipt when waiting for the block fails", async () => {
  const operation = ["multipost", "bob", 5];
  await expect(confirmTransfer(operation, async remember => {
    remember("broadcast");
    throw Error("offline");
  }, jest.fn())).rejects.toThrow("offline");
  const send = jest.fn();
  await expect(confirmTransfer(operation, send, async hash => hash)).resolves.toBe("broadcast");
  expect(send).not.toHaveBeenCalled();
});
