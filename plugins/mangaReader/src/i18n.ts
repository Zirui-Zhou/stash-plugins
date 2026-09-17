/**
 * The plugin's own strings — all two of them.
 *
 * Everything this plugin draws is Stash's own UI except the switch it adds to the
 * lightbox's options menu, so there is no catalog here worth the name. What there
 * is, is the same lookup mangaTools uses: a tag is cut back subtag by subtag until
 * a catalog answers, and English answers last, so a reader whose language this
 * plugin has not been translated into sees words rather than nothing.
 *
 * The language comes from Stash's own configuration (`configuration.interface.language`)
 * rather than from the page: Stash leaves `html lang` at `en` whatever the
 * interface is set to, so there is nothing in the DOM to read.
 */

type MangaReaderLabelKey = "doublePage" | "offset";

const LABELS: { [locale: string]: { [key in MangaReaderLabelKey]: string } } = {
  en: {
    doublePage: "Double page",
    offset: "Shift the pairing by one page",
  },
  "zh-Hans": { doublePage: "双页阅读", offset: "配对偏移一格" },
  "zh-Hant": { doublePage: "雙頁閱讀", offset: "配對偏移一格" },
};

/**
 * Tags whose own name no catalog uses, mapped to the one that covers them.
 *
 * Chinese needs this: Stash reports a region, while what the reader wants to know
 * is which script. A bare `zh` reads as simplified — the same reading this plugin
 * gives a bare value in mangaTools' language field.
 */
const ALIASES: { [locale: string]: string } = {
  zh: "zh-Hans",
  "zh-CN": "zh-Hans",
  "zh-SG": "zh-Hans",
  "zh-Hans": "zh-Hans",
  "zh-TW": "zh-Hant",
  "zh-HK": "zh-Hant",
  "zh-MO": "zh-Hant",
  "zh-Hant": "zh-Hant",
};

/** One of this plugin's own strings, in the interface's language. */
export function labelFor(
  locale: string | null | undefined,
  key: MangaReaderLabelKey
): string {
  const parts = String(locale || "")
    .replace("_", "-")
    .split("-");

  while (parts.length > 0) {
    const tag = parts.join("-");
    const catalog = LABELS[ALIASES[tag] || tag];
    if (catalog) return catalog[key];

    parts.pop();
  }

  return LABELS.en[key];
}
