const mockStore = new Map<string, string>();
jest.mock("../../libs/storage", () => ({
  storage: {
    getString: (k: string) => mockStore.get(k),
    set: (k: string, v: string) => { mockStore.set(k, v); },
  },
}));
jest.mock("../../i18n", () => ({
  SUPPORTED_LANGUAGES: [
    { code: "en", name: "English", nativeName: "English" },
    { code: "tr", name: "Turkish", nativeName: "Türkçe" },
    { code: "ar", name: "Arabic", nativeName: "العربية" },
    { code: "de", name: "German", nativeName: "Deutsch" },
  ],
}));
const mockTranslateText = jest.fn();
jest.mock("../../services/translation.service", () => ({ translateText: (...a: unknown[]) => mockTranslateText(...a) }));

import { orderedTranslateLanguages, rememberTranslateLang, rememberedTranslateLang, translateDraft, translateLanguageName } from "../../libs/post-translate";

describe("post draft translate", () => {
  beforeEach(() => { mockStore.clear(); mockTranslateText.mockReset(); });

  it("translates the draft as private text and keeps the language it came from", async () => {
    mockTranslateText.mockResolvedValue({ translatedText: "We cover a year of road in a day", sourceLang: "tr", sameLanguage: false });
    const out = await translateDraft(" Bir günde bir yıllık yol ilerliyoruz ", "en");
    expect(mockTranslateText).toHaveBeenCalledWith("Bir günde bir yıllık yol ilerliyoruz", "en", "auto", { isPublic: false });
    expect(out).toEqual({ text: "We cover a year of road in a day", from: "tr", same: false });
    expect(translateLanguageName(out.from)).toBe("Türkçe");
  });

  it("says when the draft is already in that language", async () => {
    mockTranslateText.mockResolvedValue({ translatedText: "Hello", sourceLang: null, sameLanguage: true });
    expect((await translateDraft("Hello", "en")).same).toBe(true);
  });

  it("lists the last language first, then English and the app language", () => {
    expect(rememberedTranslateLang()).toBe("en");
    rememberTranslateLang("de");
    expect(orderedTranslateLanguages("tr", rememberedTranslateLang()).map((l) => l.code)).toEqual(["de", "en", "tr", "ar"]);
  });
});
