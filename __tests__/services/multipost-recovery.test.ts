import { buyCredits, crossPost } from "../../services/multipost.service";
import { storage } from "../../libs/storage";

const mockInvoke = jest.fn();
const mockPay = jest.fn();
const mockUpload = jest.fn();
const mockAccess = jest.fn();
let mockDigital = true;

jest.mock("../../config/storefront", () => ({ get DIGITAL_PURCHASES_ENABLED() { return mockDigital; } }));
jest.mock("../../libs/toast", () => ({
  toastLoading: jest.fn(), toastInfo: jest.fn(), toastError: jest.fn(),
  toastSuccess: jest.fn(), toastWarning: jest.fn(), dismissToast: jest.fn(),
}));
jest.mock("../../services/ai.service", () => ({ dehubAuthHeaders: async () => ({}) }));
jest.mock("../../services/supabase", () => ({ supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } } }));
jest.mock("../../services/post-quota-payment", () => ({ payPostQuota: (...args: unknown[]) => mockPay(...args) }));
jest.mock("../../services/nft.service", () => ({ getNFT: async () => ({ result: { transcodingStatus: "done" } }) }));
jest.mock("../../libs/video-access", () => ({ fetchVideoAccess: (...args: unknown[]) => mockAccess(...args) }));
jest.mock("expo-file-system/legacy", () => ({ uploadAsync: (...args: unknown[]) => mockUpload(...args) }));

beforeEach(() => {
  jest.clearAllMocks();
  storage.clearAll();
  mockDigital = true;
});

it("confirms the same top-up after a lost reply without opening the wallet again", async () => {
  mockInvoke.mockResolvedValueOnce({ data: { dhb: 1, treasury: "treasury" } })
    .mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce({ data: { credits: 10 } });
  mockPay.mockResolvedValue({ txHash: "paid" });
  await expect(buyCredits("ALICE", 10)).rejects.toThrow("offline");
  await expect(buyCredits("alice", 10)).resolves.toBe(10);
  expect(mockPay).toHaveBeenCalledTimes(1);
  expect(mockInvoke.mock.calls.map(([, { body }]) => body.action)).toEqual(["quote", "topup", "topup"]);
});

it("never quotes or sends a new top-up on iOS", async () => {
  mockDigital = false;
  await expect(buyCredits("alice", 1)).rejects.toThrow();
  expect(mockInvoke).not.toHaveBeenCalled();
  expect(mockPay).not.toHaveBeenCalled();
});

const edited = { wallet: "alice", text: "Published edit", tokenId: 7, editedVideo: true,
  media: [{ uri: "file:///original.mp4", mimeType: "video/mp4" }], accountIds: ["selected", "disconnected"] };
const status = { data: { accounts: [{ id: "selected" }], credits: 4 } };

it("publishes the finished video only to selected, connected destinations", async () => {
  mockInvoke.mockResolvedValueOnce(status).mockResolvedValueOnce({ data: { sent: 1 } });
  mockAccess.mockResolvedValueOnce({ private: false, url: "https://cdn.example/edited.mp4" });
  await crossPost(edited);
  expect(mockInvoke.mock.calls[1][1].body).toMatchObject({ action: "publish", accountIds: ["selected"],
    mediaItems: [{ type: "video", url: "https://cdn.example/edited.mp4" }] });
  expect(mockUpload).not.toHaveBeenCalled();
});

it("keeps private renders and original files out of an external publish", async () => {
  mockInvoke.mockResolvedValueOnce(status);
  mockAccess.mockResolvedValueOnce({ private: true, url: "https://cdn.example/signed.mp4" });
  await crossPost(edited);
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockUpload).not.toHaveBeenCalled();
});
