import AsyncStorage from "@react-native-async-storage/async-storage";
import { clearDmStore, dmState, hydrateDmFromStorage, setDmCacheKey } from "../../store/dm.store";

it("keeps an earlier account's delayed cache out of the active inbox", async () => {
  let finish!: (value: string) => void;
  setDmCacheKey("alice");
  jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const late = hydrateDmFromStorage("alice");
  setDmCacheKey("bob");
  clearDmStore();
  await hydrateDmFromStorage("bob");
  finish(JSON.stringify({ contactsById: { private: { _id: "private" } } }));
  await late;
  expect(dmState.contactsById).toEqual({});
  setDmCacheKey(null);
});
