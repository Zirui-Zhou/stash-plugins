/**
 * Manga Tools — language table
 *
 * Pure data plus pure functions. No dependency on PluginApi, no DOM.
 *
 * This is a module now that the plugin is bundled (esbuild — see
 * tools/build.mjs), so mangaTools.tsx imports it rather than reaching through
 * the window. It still publishes itself at window.MangaTools as well: that is
 * the handle the smoke tests use to call these functions directly, and keeping
 * one stable entry point is cheaper than teaching the tests to reach inside a
 * bundle.
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
 */
import type {
  MangaToolsDescription,
  MangaToolsDisplayNames,
  MangaToolsDisplayNamesCtor,
  MangaToolsNamespace,
  MangaToolsOption,
} from "./plugin-api";

// The namespace is filled in immediately below; the cast is only needed
// because window.MangaTools is optional in the type declaration.
window.MangaTools = window.MangaTools || ({} as MangaToolsNamespace);
const NS = window.MangaTools;

/**
 * Canonical code → { flag }
 *
 * Codes follow ISO 639-1. Chinese needs a simplified/traditional distinction,
 * so it uses BCP 47 script subtags (zh-Hans / zh-Hant) — ISO 639-1 alone
 * cannot express that, which is the other way this differs from nationality.
 *
 * This object is the plugin's entire opinionated vocabulary, and it is short on
 * purpose: which languages the dropdown offers, and nothing else. The names are
 * not here — they come from Intl.DisplayNames, so they follow Stash's UI
 * language and cover every locale the engine knows rather than the four this
 * table used to carry. See NS.name.
 *
 * `flag` is an alpha-2 **country** code for flag-icons, not a language code.
 * The language-to-country relation is many-to-one; each entry picks the most
 * common country and that one line can be changed if you disagree. Watch out
 * for the easy mistakes: Vietnam is `vn`, not `vi` (that one is the US Virgin
 * Islands).
 */
NS.LANGUAGES = {
  ja: { flag: "jp" },
  "zh-Hans": { flag: "cn" },
  "zh-Hant": { flag: "tw" },
  en: { flag: "gb" },
  ko: { flag: "kr" },
  es: { flag: "es" },
  fr: { flag: "fr" },
  de: { flag: "de" },
  it: { flag: "it" },
  pt: { flag: "pt" },
  ru: { flag: "ru" },
  th: { flag: "th" },
  vi: { flag: "vn" },
  id: { flag: "id" },
};

/**
 * UI language to fall back to when a name is not available in the requested one.
 *
 * It is no longer a key into a table of ours — there is no name table any more.
 * It is the second entry in the locale list handed to Intl.DisplayNames, which
 * is what keeps the fallback honest: given only the requested locale, an engine
 * that does not know it resolves silently against the *runtime's* default
 * locale, i.e. the browser's, which is a different thing from Stash's UI
 * language and would be invisible if it happened.
 *
 * The grey background used for unrecognised values lives in mangaTools.css
 * under .is-unknown, not here.
 */
NS.FALLBACK_LOCALE = "en";

/**
 * One constructed Intl.DisplayNames per locale.
 *
 * Held at module scope because the dropdown asks for all 14 names on every
 * render, and constructing a formatter is by far the expensive part of that.
 */
const displayNamesCache: { [locale: string]: MangaToolsDisplayNames | null } =
  {};

/**
 * One collator per locale, kept for the same reason as the formatters above:
 * these are built per render, not once.
 */
const collatorCache: { [locale: string]: Intl.Collator } = {};

/**
 * A collator for a UI locale, for ordering the dropdown's options.
 *
 * Unlike Intl.DisplayNames this needs no availability check — Collator predates
 * ES5 and every engine Stash runs in has it. The only way it can fail is a tag
 * the engine considers malformed, which the try/catch turns into the fallback
 * locale rather than an exception in the middle of a render. Stash supports
 * user-supplied custom locales, so an unusual tag is not hypothetical.
 */
function collatorFor(locale: string): Intl.Collator {
  if (!(locale in collatorCache)) {
    try {
      collatorCache[locale] = new Intl.Collator(locale);
    } catch {
      collatorCache[locale] = new Intl.Collator(NS.FALLBACK_LOCALE);
    }
  }

  return collatorCache[locale];
}

/**
 * Builds an Intl.DisplayNames, or returns null if the engine rejects the list.
 *
 * Any malformed entry makes the whole list invalid — a valid fallback beside it
 * does not rescue it — so the fallback has to be requested on its own. That is
 * what the second call is for. Stash supports user-supplied custom locales
 * (App.tsx fetches "customlocales"), and one of those could carry a tag the
 * engine does not accept.
 */
function buildDisplayNames(
  ctor: MangaToolsDisplayNamesCtor,
  locales: string[]
): MangaToolsDisplayNames | null {
  try {
    return new ctor(locales, { type: "language" });
  } catch {
    return null;
  }
}

/**
 * Intl.DisplayNames for a UI locale, or null when the engine has none.
 *
 * The constructor is looked up through a cast rather than read off a lib type:
 * DisplayNames landed in ES2021 and this project compiles against ES2019, and
 * raising the target to get it would drop the downleveling safety net for
 * everything else in the bundle. Declaring the shape we use is the same
 * approach taken for ApolloLink in plugin-api.ts.
 *
 * Absent before Chrome 81 / Firefox 86 / Safari 14.1. Old enough to ignore, but
 * not old enough to crash on: NS.name degrades to the raw code instead.
 */
function displayNamesFor(locale: string): MangaToolsDisplayNames | null {
  if (!(locale in displayNamesCache)) {
    const ctor = (
      Intl as unknown as { DisplayNames?: MangaToolsDisplayNamesCtor }
    ).DisplayNames;

    displayNamesCache[locale] =
      typeof ctor === "function"
        ? buildDisplayNames(ctor, [locale, NS.FALLBACK_LOCALE]) ||
          buildDisplayNames(ctor, [NS.FALLBACK_LOCALE])
        : null;
  }

  return displayNamesCache[locale];
}

/**
 * Case-insensitive lookup in LANGUAGES. Returns the canonical key, or "" if
 * nothing matches.
 */
NS.findCanonical = (code?: string | null): string => {
  if (!code) return "";
  const lower = String(code).trim().toLowerCase();
  if (lower === "") return "";
  const keys = Object.keys(NS.LANGUAGES);
  for (let i = 0; i < keys.length; i++) {
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
 */
NS.normalize = (raw: unknown): string => {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (s === "") return "";

  // Whitespace and case are the only tolerance; there is no alias mapping.
  // Values only ever come from this plugin's dropdown, so they are already
  // canonical. Anything that does not match becomes an unknown value and is
  // returned unchanged, so bad data shows up as a grey "unrecognised" chip
  // instead of being silently corrected.
  return NS.findCanonical(s) || s;
};

/**
 * Localised name for a language, given a code in any spelling normalize accepts.
 *
 * Still mirrors Stash's getCountryByISO — look the name up by UI locale, fall
 * back to English, return the code unchanged if it is not recognised — but the
 * names now come from Intl.DisplayNames rather than from a table here, so the
 * coverage is every locale the engine's CLDR has instead of the four this file
 * used to list. The locale is react-intl's, which Stash sets from
 * Configuration.interface.language, so the names follow the Stash UI language
 * and never the browser's.
 *
 * Three things it deliberately does not do:
 *
 *   - It does not let the engine choose the language. displayNamesFor explains
 *     why the fallback locale is passed explicitly.
 *   - It does not use DisplayNames to decide whether a value is *known*.
 *     Recognition is findCanonical's job and only codes in our own list count;
 *     the platform happily resolves alpha-3 spellings like "chi" and "jpn" that
 *     this plugin treats as unrecognised data.
 *   - It does not invent a name for an unknown value, or hide a failure behind
 *     English: an engine without DisplayNames yields the raw code, which is the
 *     same thing the plugin shows for a value no table recognises.
 */
NS.name = (code: unknown, locale?: string | null): string => {
  // Go through normalize rather than findCanonical directly, so that
  // case-insensitive matches resolve to the canonical code; anything that
  // does not match comes back as the code itself.
  const normalized = NS.normalize(code);
  const canonical = NS.findCanonical(normalized);
  if (!canonical) {
    return normalized;
  }

  const names = displayNamesFor(locale || NS.FALLBACK_LOCALE);
  if (!names) return canonical;

  // of() echoes a code it cannot resolve, so the fallback here covers
  // implementations that return undefined instead of echoing.
  return names.of(canonical) || canonical;
};

/**
 * Describes a language value for rendering. Takes the raw value stored in the
 * custom field.
 *
 * Returns null for an empty value, and a description whose `flag` is null for a
 * value the table does not recognise — the shape itself is MangaToolsDescription
 * in plugin-api.ts.
 */
NS.describe = (
  raw: unknown,
  locale?: string | null
): MangaToolsDescription | null => {
  const code = NS.normalize(raw);
  if (code === "") return null;

  const canonical = NS.findCanonical(code);
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
 * Options for the dropdown, ordered by the name the reader will actually see.
 *
 * There used to be a hand-written order here — ja, zh-Hans, zh-Hant, en, ko, …
 * th, vi, id — which is the author's languages first, then European ones, then
 * the rest. That is a judgement about which languages matter, and nothing needs
 * one: the dropdown is searchable, and the enabled-languages setting usually
 * shortens it anyway.
 *
 * Sorting by the displayed name needs a collator rather than the default
 * comparison. Ordering by code point is arbitrary for Thai, Chinese and
 * Japanese, and would look like no order at all to those readers. The cost is
 * that the order follows the UI language, which is the intent.
 *
 * `label` is the localised name; the flag is rendered separately by the caller
 * from `option.flag` (flag-icons draws with CSS, so it cannot go inside a
 * plain-text label).
 */
NS.languageOptions = (locale?: string | null): MangaToolsOption[] => {
  const uiLocale = locale || NS.FALLBACK_LOCALE;
  const collator = collatorFor(uiLocale);

  return Object.keys(NS.LANGUAGES)
    .map((code) => ({
      value: code,
      label: NS.name(code, uiLocale),
      flag: NS.LANGUAGES[code].flag,
    }))
    .sort((a, b) => collator.compare(a.label, b.label));
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
 * canonical codes, e.g. "ja,en,zh-Hans" — into a Set. Returns null for an
 * empty/unset value, which means "no restriction".
 *
 * Only canonical codes survive: anything that does not resolve through
 * findCanonical is dropped, so a hand-edited value can never corrupt the list,
 * and duplicates collapse to one entry.
 */
NS.parseEnabledLanguages = (raw: unknown): Set<string> | null => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;

  const out = new Set<string>();
  s.split(",").forEach((piece) => {
    const canonical = NS.findCanonical(piece.trim());
    if (canonical) out.add(canonical);
  });

  return out.size ? out : null;
};

/**
 * Serialises a set of enabled codes back into the stored string form — the
 * inverse of parseEnabledLanguages. An empty set serialises to "", which parses
 * back to null ("all").
 *
 * Ordered by code, deliberately not by the name the reader sees: the stored
 * value has to come out the same whoever writes it, and languageOptions' order
 * follows the UI language now. Code order is stable and still readable
 * ("de,en,ja").
 */
NS.serializeEnabledLanguages = (codes: Iterable<string>): string =>
  Array.from(codes).sort().join(",");

/**
 * Whether flags are drawn at all — the cover badge, the dropdowns and the
 * detail row.
 *
 * Like enabledLanguages this is populated by mangaTools.tsx from the plugin
 * settings. Unlike it, it is a plain flag with a default, so an install that
 * predates the setting behaves exactly as before until it is turned off.
 */
NS.showFlags = true;

/**
 * Whether the cover badge is drawn.
 *
 * Deliberately independent of showFlags: with flags off the badge falls back to
 * the language name in a chip, which is what an unrecognised value already
 * does. Someone who finds the flag mapping misleading (a language is not a
 * country) can therefore keep the badge without the flag.
 */
NS.showCoverBadge = true;

/**
 * Reads a boolean setting.
 *
 * Absent — which is what an install predating the setting has — reads as the
 * fallback, i.e. the plugin's default. A real boolean is taken as-is, and a
 * string is understood too, so a value hand-edited in the config cannot
 * silently read as true when false was meant.
 */
NS.parseFlag = (raw: unknown, fallback: boolean): boolean => {
  if (raw === null || raw === undefined || raw === "") return fallback;
  if (typeof raw === "boolean") return raw;

  const s = String(raw).trim().toLowerCase();
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;

  return fallback;
};

export { NS };
