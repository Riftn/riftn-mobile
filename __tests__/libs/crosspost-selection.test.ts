import { act, renderHook } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { storage } from "../../libs/storage";
import { selectCrossPostAccount, useSelectedCrossPosts } from "../../libs/crosspost-store";

it("migrates only owned accounts and drops disconnected, pending and deselected destinations", async () => {
  storage.clearAll();
  await AsyncStorage.setItem("dehub_crosspost_selected", JSON.stringify(["a", "b", "pending", "stale"]));
  const accounts = [{ id: "a" }, { id: "pending", pending: true }];
  type Props = { wallet: string; connected: { id: string; pending?: boolean }[] };
  const hook = renderHook(({ wallet, connected }: Props) => useSelectedCrossPosts(wallet, connected),
    { initialProps: { wallet: "alice", connected: accounts } });
  await act(async () => { await Promise.resolve(); });
  expect(hook.result.current).toEqual(["a"]);
  act(() => selectCrossPostAccount("alice", "a", false));
  expect(hook.result.current).toEqual([]);
  hook.rerender({ wallet: "bob", connected: [{ id: "b" }] });
  await act(async () => { await Promise.resolve(); });
  expect(hook.result.current).toEqual(["b"]);
  hook.rerender({ wallet: "bob", connected: [] });
  expect(hook.result.current).toEqual([]);
  hook.rerender({ wallet: "alice", connected: accounts });
  expect(hook.result.current).toEqual([]);
});
