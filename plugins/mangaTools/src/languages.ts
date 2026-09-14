/**
 * Manga Tools — language table
 *
 * Pure data plus pure functions. No dependency on PluginApi, no DOM.
 * On load it attaches itself to window.MangaTools for mangaTools.js.
 *
 * The approach mirrors how Stash handles performer nationality:
 *   store a canonical code → look up a localised name when rendering →
 *   fall back to showing the raw value
 * (see ui/v2.5/src/utils/country.ts and CountryLabel.tsx in the Stash repo)
 *
 * Two things differ from nationality:
 *   1. Values are only ever written by this plugin's own dropdown, so the table
 *      holds canonical codes only — there is no alias mapping. If a value ever
 *      does not match, it surfaces as a grey "unrecognised" chip rather than
 *      being silently corrected.
 *   2. Languages have no flag, so each one is paired with a **regional flag**
 *      (a flag-icons alpha-2 *country* code). That mapping is lossy — a language
 *      is not a country. See the per-entry notes below.
 *
 * NOTE: the strings inside `names` below are display data, not comments. They
 * are the whole point of the localisation — do not translate them.
 *
 * If a build step is introduced later, this file can become an ES module and the
 * global object can go away without touching any business logic.
 */
(function () {
  "use strict";

  // The namespace is filled in immediately below; the cast is only needed
  // because window.MangaTools is optional in the type declaration.
  var NS = (window.MangaTools =
    window.MangaTools || ({} as MangaToolsNamespace));

  /**
   * Canonical code → { flag, names }
   *
   * Codes follow ISO 639-1. Chinese needs a simplified/traditional distinction,
   * so it uses BCP 47 script subtags (zh-Hans / zh-Hant) — ISO 639-1 alone
   * cannot express that, which is the other way this differs from nationality.
   *
   * `flag` is an alpha-2 **country** code for flag-icons, not a language code.
   * The language-to-country relation is many-to-one; each entry picks the most
   * common country and that one line can be changed if you disagree. Watch out
   * for the easy mistakes: Vietnam is `vn`, not `vi` (that one is the US Virgin
   * Islands).
   *
   * `names` is keyed by Stash's UI locale (see NS.localeCode) and falls back to
   * English. Only the common UI languages are covered here — Stash ships around
   * 40, and this is a hand-written table, so matching them all is not realistic.
   * Add more keys to this object if you need them.
   */
  NS.LANGUAGES = {
    ja: {
      flag: "jp",
      names: { zh: "日语", tw: "日語", en: "Japanese", ja: "日本語" },
    },
    "zh-Hans": {
      flag: "cn",
      names: {
        zh: "简体中文",
        tw: "簡體中文",
        en: "Chinese (Simplified)",
        ja: "中国語（簡体）",
      },
    },
    "zh-Hant": {
      // Traditional Chinese is used in Taiwan, Hong Kong and Macau. This picks
      // the Taiwan flag; change the one line to "hk" if you prefer.
      flag: "tw",
      names: {
        zh: "繁体中文",
        tw: "繁體中文",
        en: "Chinese (Traditional)",
        ja: "中国語（繁体）",
      },
    },
    en: {
      flag: "gb",
      names: { zh: "英语", tw: "英語", en: "English", ja: "英語" },
    },
    ko: {
      flag: "kr",
      names: { zh: "韩语", tw: "韓語", en: "Korean", ja: "韓国語" },
    },
    es: {
      flag: "es",
      names: { zh: "西班牙语", tw: "西班牙語", en: "Spanish", ja: "スペイン語" },
    },
    fr: {
      flag: "fr",
      names: { zh: "法语", tw: "法語", en: "French", ja: "フランス語" },
    },
    de: {
      flag: "de",
      names: { zh: "德语", tw: "德語", en: "German", ja: "ドイツ語" },
    },
    it: {
      flag: "it",
      names: { zh: "意大利语", tw: "義大利語", en: "Italian", ja: "イタリア語" },
    },
    pt: {
      flag: "pt",
      names: { zh: "葡萄牙语", tw: "葡萄牙語", en: "Portuguese", ja: "ポルトガル語" },
    },
    ru: {
      flag: "ru",
      names: { zh: "俄语", tw: "俄語", en: "Russian", ja: "ロシア語" },
    },
    th: {
      flag: "th",
      names: { zh: "泰语", tw: "泰語", en: "Thai", ja: "タイ語" },
    },
    vi: {
      flag: "vn",
      names: { zh: "越南语", tw: "越南語", en: "Vietnamese", ja: "ベトナム語" },
    },
    id: {
      flag: "id",
      names: { zh: "印尼语", tw: "印尼語", en: "Indonesian", ja: "インドネシア語" },
    },
  };

  /**
   * Order used by the dropdown (common languages first). Does not affect the badge.
   */
  NS.ORDER = [
    "ja",
    "zh-Hans",
    "zh-Hant",
    "en",
    "ko",
    "es",
    "fr",
    "de",
    "it",
    "pt",
    "ru",
    "th",
    "vi",
    "id",
  ];

  /**
   * UI language to fall back to when an entry has no name for the current one.
   * The grey background used for unrecognised values lives in mangaTools.css
   * under .is-unknown, not here.
   */
  NS.FALLBACK_LOCALE = "en";

  /**
   * Normalises a react-intl locale into a key of `names`.
   *
   * Deliberately matches Stash's getLocaleCode (src/locales/index.ts):
   * zh-CN → zh, zh-TW → tw, otherwise the first two characters. Keeping them
   * aligned means this table can follow Stash's own locale files.
   *
   * @param {string} [locale] e.g. "zh-CN" / "zh-TW" / "en-US" / "ja-JP"
   * @returns {string}
   */
  NS.localeCode = function (locale?: string | null): string {
    if (!locale) return NS.FALLBACK_LOCALE;
    var code = String(locale);
    if (code === "zh-CN") return "zh";
    if (code === "zh-TW") return "tw";
    return code.slice(0, 2);
  };

  /**
   * Case-insensitive lookup in LANGUAGES. Returns the canonical key, or "" if
   * nothing matches.
   * @param {string} code
   * @returns {string}
   */
  NS.findCanonical = function (code?: string | null): string {
    if (!code) return "";
    var lower = String(code).trim().toLowerCase();
    if (lower === "") return "";
    var keys = Object.keys(NS.LANGUAGES);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lower) return keys[i];
    }
    return "";
  };

  /**
   * Normalises a stored value into a canonical code.
   *
   * Only leading/trailing whitespace and letter case are tolerated. Anything
   * that matches no language is returned as-is (trimmed) and described as
   * unknown — the plugin does not guess intent, and does not quietly rewrite
   * your library.
   *
   * @param {*} raw
   * @returns {string}
   */
  NS.normalize = function (raw: unknown): string {
    if (raw === null || raw === undefined) return "";
    var s = String(raw).trim();
    if (s === "") return "";

    // Whitespace and case are the only tolerance; there is no alias mapping.
    // Values only ever come from this plugin's dropdown, so they are already
    // canonical. Anything that does not match becomes an unknown value and is
    // returned unchanged, so bad data shows up as a grey "unrecognised" chip
    // instead of being silently corrected.
    return NS.findCanonical(s) || s;
  };

  /**
   * Localised name for a language.
   *
   * Mirrors Stash's getCountryByISO: look the name up by UI locale, fall back to
   * English, and if the code is not recognised at all return it unchanged
   * (the equivalent of CountryLabel.tsx's `fromISO ?? country`).
   *
   * @param {string} code language code, in any accepted spelling
   * @param {string} [locale] react-intl locale
   * @returns {string}
   */
  NS.name = function (code: unknown, locale?: string | null): string {
    // Go through normalize rather than findCanonical directly, so that
    // case-insensitive matches resolve to the canonical code; anything that
    // does not match comes back as the code itself.
    var normalized = NS.normalize(code);
    var canonical = NS.findCanonical(normalized);
    if (!canonical) {
      return normalized;
    }

    var names = NS.LANGUAGES[canonical].names;
    return (
      names[NS.localeCode(locale)] || names[NS.FALLBACK_LOCALE] || canonical
    );
  };

  /**
   * Describes a language value for rendering.
   *
   * @param {*} raw the raw value stored in the custom field
   * @param {string} [locale] react-intl locale
   * @returns {{code: string, flag: string|null, name: string, known: boolean} | null}
   *          null for an empty value; `flag` is null for unknown values
   */
  NS.describe = function (
    raw: unknown,
    locale?: string | null
  ): MangaToolsDescription | null {
    var code = NS.normalize(raw);
    if (code === "") return null;

    var canonical = NS.findCanonical(code);
    if (canonical) {
      return {
        code: canonical,
        flag: NS.LANGUAGES[canonical].flag,
        name: NS.name(canonical, locale),
        known: true,
      };
    }

    // Unknown value: no flag to show, so the raw code is displayed as-is.
    return { code: code, flag: null, name: code, known: false };
  };

  /**
   * Options for the dropdown.
   *
   * `label` is the localised name; the flag is rendered separately by the caller
   * from `option.flag` (flag-icons draws with CSS, so it cannot go inside a
   * plain-text label).
   *
   * @param {string} [locale]
   * @returns {Array<{value: string, label: string, flag: string}>}
   */
  NS.languageOptions = function (locale?: string | null): MangaToolsOption[] {
    return NS.ORDER.filter(function (code) {
      return !!NS.LANGUAGES[code];
    }).map(function (code) {
      return {
        value: code,
        label: NS.name(code, locale),
        flag: NS.LANGUAGES[code].flag,
      };
    });
  };

  /**
   * The set of languages the edit-page dropdown is limited to, or null to show
   * every language.
   *
   * This is the only mutable field on the namespace. It is populated by
   * mangaTools.tsx from the plugin settings (Configuration.plugins.mangaTools.
   * enabledLanguages) and read back by the dropdown and the settings UI. null is
   * both the initial value and the "no restriction" value, so a null can never
   * hide a language before the settings have been fetched.
   */
  NS.enabledLanguages = null;

  /**
   * Parses the stored `enabledLanguages` setting — a comma-separated string of
   * canonical codes — into a Set. Returns null for an empty/unset value, which
   * means "no restriction".
   *
   * Only canonical codes survive: anything that does not resolve through
   * findCanonical is dropped, so a hand-edited value can never corrupt the list,
   * and duplicates collapse to one entry.
   *
   * @param {*} raw e.g. "ja,en,zh-Hans"
   * @returns {Set<string>|null}
   */
  NS.parseEnabledLanguages = function (raw: unknown): Set<string> | null {
    if (raw === null || raw === undefined) return null;
    var s = String(raw).trim();
    if (s === "") return null;

    var out = new Set<string>();
    s.split(",").forEach(function (piece) {
      var canonical = NS.findCanonical(piece.trim());
      if (canonical) out.add(canonical);
    });

    return out.size ? out : null;
  };

  /**
   * Serialises a set of enabled codes back into the stored string form — the
   * inverse of parseEnabledLanguages. An empty set serialises to "", which
   * parses back to null ("all"). The codes are ordered by NS.ORDER, so the
   * stored value is stable and readable regardless of the selection order.
   *
   * @param {Iterable<string>} codes
   * @returns {string}
   */
  NS.serializeEnabledLanguages = function (codes: Iterable<string>): string {
    return Array.from(codes)
      .sort(function (a, b) {
        return NS.ORDER.indexOf(a) - NS.ORDER.indexOf(b);
      })
      .join(",");
  };

  /**
   * Name of the custom field this plugin reads and writes. Changing it here is
   * all that is needed to use a different field (e.g. splitting into
   * original_language / translated_language later). Both reads and writes treat
   * it case-insensitively.
   */
  NS.FIELD_NAME = "language";
})();
