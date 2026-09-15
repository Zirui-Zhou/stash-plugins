/**
 * Manga Tools — the custom fields this plugin owns
 *
 * Pure data plus pure functions, like languages.ts: no PluginApi, no DOM. The
 * smoke tests call these directly rather than through a rendered component,
 * which is the only way to check the read and write rules on their own.
 *
 * WHY THE FIELD NAMES LIVE HERE AND NOT WITH THEIR VALUES. languages.ts holds
 * the language table, which is a table of codes and flags; the *name* of the
 * gallery field that holds one of those codes is a fact about galleries, not
 * about languages. It used to live there because there was only one field. Now
 * there are two, and a third would otherwise mean a third place to look.
 *
 * Names are prefixed, because a gallery's custom fields are a shared namespace:
 * `language` on its own is a name any other plugin, or the reader, might
 * reasonably want, and nothing on the field says who put it there. These name
 * their owner, and leave room for the fields this plugin may add later.
 *
 * `plugin.mangaTools.language` is a hard contract — it is what the query in
 * mangaTools.tsx spells and what every existing gallery carries. It was renamed
 * once (from a bare `language`), by hand, with no compatibility branch.
 */
import { NS } from "./languages";
import type { MangaToolsCustomFields } from "./plugin-api";

/**
 * The language field. Its value is a code from NS.LANGUAGES — see languages.ts
 * for the table and for what an unrecognised value means.
 */
NS.FIELD_NAME = "plugin.mangaTools.language";

/**
 * The censorship field: whether the comic is censored or not.
 *
 * A separate field rather than a flag on the language one, because the two are
 * independent: an uncensored Japanese volume is a perfectly ordinary thing.
 *
 * Its value is one of CENSORSHIP_VALUES below. Absence is the third state —
 * "not marked" — which is why the two values are not a boolean: a key that is
 * absent, a key set to "false", and a key with junk in it would then all have to
 * be told apart, and only the first is a state the reader chose.
 */
NS.CENSORSHIP_FIELD_NAME = "plugin.mangaTools.censorship";

/**
 * The values the field takes, in the order the toolbar button cycles through
 * them. Both are lower case; matching is case-insensitive like everything else.
 */
NS.CENSORSHIP_VALUES = ["censored", "uncensored"];

/**
 * Normalises a stored censorship value to one of CENSORSHIP_VALUES, or "" when
 * it is not one of them.
 *
 * Unlike NS.normalize for languages, an unrecognised value is *not* echoed
 * back: with exactly two values and no aliases, there is nothing it could mean,
 * and the button has no way to draw it. It reads as "not marked" instead, and
 * stays in the gallery until something writes over it — the plugin never
 * rewrites data it did not put there.
 */
NS.normalizeCensorship = (raw: unknown): string => {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim().toLowerCase();
  if (s === "") return "";

  const values = NS.CENSORSHIP_VALUES;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === s) return values[i];
  }
  return "";
};

/**
 * Reads a named field out of a custom_fields map. The name is matched
 * case-insensitively, and the stored spelling is what comes back out of the map.
 * @returns "" when there is no such field, or it holds nothing
 */
NS.pickField = (customFields: unknown, name: string): string => {
  if (!customFields || typeof customFields !== "object") return "";

  const map = customFields as MangaToolsCustomFields;
  const key = name.toLowerCase();
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === key) {
      const v = map[keys[i]];
      if (v === null || v === undefined) return "";
      return String(v);
    }
  }
  return "";
};

/**
 * Writes a named field into a copy of a custom_fields map (the input is not
 * mutated). An empty value removes every case variant of the key — matching the
 * delete semantics of Stash's native CustomFieldInput.
 *
 * The key is written in the canonical spelling whatever variant was there
 * before, so a key that has drifted in case is corrected by the next write.
 */
NS.setField = (
  customFields: unknown,
  name: string,
  value: string
): MangaToolsCustomFields => {
  const next = Object.assign({}, customFields || {}) as MangaToolsCustomFields;
  const key = name.toLowerCase();
  Object.keys(next).forEach((k) => {
    if (k.toLowerCase() === key) delete next[k];
  });
  if (value) next[name] = value;
  return next;
};

export { NS };
