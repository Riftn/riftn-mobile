import i18n from "i18next";
import { formatShortAgo } from "../../libs/date.util";
import { ageLabel } from "./story-utils";

type Translate = (key: string, options: { time: string; defaultValue: string }) => string;

/**
 * "5h ago" under a Moment's name, in the reader's language. Other languages
 * bring their own "ago" ("9 sa. önce"), and "now" never takes one.
 */
export function momentAgo(iso: string | null | undefined, t: Translate): string {
  const english = !i18n.language || i18n.language.startsWith("en");
  const short = ageLabel(iso);
  if (!english || short === "now") return iso ? formatShortAgo(iso) : "";
  return t("stories.agoLabel", { time: short, defaultValue: "{{time}} ago" });
}
