import { createInstance } from "i18next";
import en from "../../i18n/locales/en.json";
import tr from "../../i18n/locales/tr.json";
import { describeCallNote, endedCallLabel, isDmCallNotice, localizeDmCallPreview } from "../../libs/callNote";

describe("ended DM call notices", () => {
  it("renders the same stored message in the current app language", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "tr",
      resources: { en: { translation: { calls: en.calls } }, tr: { translation: { calls: tr.calls } } },
    });
    const notice = { msgType: "msg", content: "📞 Voice call ended · 00:07" };

    expect(endedCallLabel(i18n.t)).toBe("Arama sona erdi");
    expect(localizeDmCallPreview(notice, i18n.t)).toBe("📞 Sesli arama · Arama sona erdi · 00:07");
    expect(localizeDmCallPreview({ content: "📞 Video call ended · 1:02:03" }, i18n.t))
      .toBe("📹 Görüntülü arama · Arama sona erdi · 1:02:03");
    expect(localizeDmCallPreview({ content: "Voice call ended" }, i18n.t)).toBe("📞 Sesli arama · Arama sona erdi");

    await i18n.changeLanguage("en");
    expect(endedCallLabel(i18n.t)).toBe("Call ended");
    expect(localizeDmCallPreview(notice, i18n.t)).toBe("📞 Voice call · Call ended · 00:07");
  });

  it.each([
    ["Voice call ended", { kind: "ended", video: false, duration: null }],
    ["📞 Video call ended · 04:32", { kind: "ended", video: true, duration: "04:32" }],
    ["📞 Voice call", { kind: "started", video: false, duration: null }],
    ["📵 Missed video call", { kind: "missed", video: true, duration: null }],
    ["📵 Voice call declined", { kind: "declined", video: false, duration: null }],
  ])("recognizes %s", (content, note) => {
    expect(isDmCallNotice(content)).toBe(true);
    expect(describeCallNote(content)).toEqual(note);
  });

  it("leaves ordinary text, media captions and unreadable messages to the caller", () => {
    const t = createInstance().t;
    expect(isDmCallNotice("The voice call ended abruptly")).toBe(false);
    expect(localizeDmCallPreview({ content: "The voice call ended abruptly" }, t)).toBeUndefined();
    expect(localizeDmCallPreview({ content: "📞 See you soon" }, t)).toBeUndefined();
    expect(localizeDmCallPreview({ content: "Voice call ended", msgType: "media" }, t)).toBeUndefined();
    expect(localizeDmCallPreview({ content: "Voice call ended", undecryptable: true }, t)).toBeUndefined();
  });
});
