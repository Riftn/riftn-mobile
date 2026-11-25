import { createInstance } from "i18next";
import en from "../../i18n/locales/en.json";
import es from "../../i18n/locales/es.json";
import { describeCallNote, isDmCallNotice, localizeDmCallPreview } from "../../libs/callNote";

describe("localized ended-call previews", () => {
  it("renders the same stored voice call in the current viewer language", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "es",
      resources: { en: { translation: { calls: en.calls } }, es: { translation: { calls: es.calls } } },
    });
    const notice = { content: "📞 Voice call ended · 00:07" };
    expect(localizeDmCallPreview(notice, i18n.t)).toBe("📞 Llamada terminada · 00:07");
    await i18n.changeLanguage("en");
    expect(localizeDmCallPreview(notice, i18n.t)).toBe("📞 Call ended · 00:07");
  });

  it("handles legacy notices without a call emoji or duration", async () => {
    const i18n = createInstance();
    await i18n.init({ lng: "es", resources: { es: { translation: { calls: es.calls } } } });
    expect(isDmCallNotice("Voice call ended")).toBe(true);
    expect(describeCallNote("Voice call ended")).toEqual({ kind: "ended", video: false, duration: null });
    expect(localizeDmCallPreview({ content: "Voice call ended" }, i18n.t)).toBe("📞 Llamada terminada");
    expect(localizeDmCallPreview({ content: "📞 Video call ended · 1:02:03" }, i18n.t))
      .toBe("📹 Llamada terminada · 1:02:03");
  });

  it("leaves ordinary, non-text and unreadable messages to the caller", () => {
    const t = createInstance().t;
    expect(localizeDmCallPreview({ content: "The voice call ended abruptly" }, t)).toBeUndefined();
    expect(localizeDmCallPreview({ content: "📞 See you soon" }, t)).toBeUndefined();
    expect(localizeDmCallPreview({ content: "Voice call ended", msgType: "media" }, t)).toBeUndefined();
    expect(localizeDmCallPreview({ content: "Voice call ended", undecryptable: true }, t)).toBeUndefined();
  });
});
