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
 * The field that makes a gallery manga: this plugin's entry point.
 *
 * Everything else this plugin does appears only on a gallery that carries it. A
 * gallery without it is a plain Stash gallery as far as the plugin is concerned —
 * the only thing it shows there is the switch that sets this.
 *
 * It is not a boolean value so much as a presence: the key being there *is* the
 * mark, and clearing it removes the key. That is the same "absent means not set"
 * shape the other two fields use for their unset state, so there is one rule
 * about absence rather than two.
 */
NS.MANGA_FIELD_NAME = "plugin.mangaTools.manga";

/** The value written when a gallery is marked. Presence is what is read. */
NS.MANGA_VALUE = "true";

/**
 * Whether a gallery's custom fields mark it as manga.
 *
 * Any non-empty value counts. The alternative — only the exact string "true" —
 * would mean a key someone set by hand to "yes" leaves the gallery looking
 * unflagged while its custom fields plainly show otherwise, and the mark is
 * meant to be readable at a glance rather than parsed.
 */
NS.isManga = (customFields: unknown): boolean =>
  NS.pickField(customFields, NS.MANGA_FIELD_NAME) !== "";

/**
 * Which of this plugin's fields a custom-field key names, or "" for any other.
 *
 * One list, asked by everything that has to recognise a key of ours. It exists
 * because that list has to *agree*: when the third field was added, two of the
 * places that recognise keys were not updated, and the symptoms were a raw
 * `plugin.mangaTools.manga` row in the edit form and a value the plugin could not
 * see. A field added to the three names below is a field every one of those
 * places knows about, because the list they ask is this one.
 *
 * The canonical name comes back rather than the key, so a caller can compare
 * against the name it already has instead of inventing a second vocabulary for
 * the same three things.
 */
NS.ownField = (key: unknown): string => {
  const k = String(key ?? "")
    .trim()
    .toLowerCase();
  if (k === "") return "";

  const names = [NS.FIELD_NAME, NS.CENSORSHIP_FIELD_NAME, NS.MANGA_FIELD_NAME];
  for (let i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() === k) return names[i];
  }
  return "";
};

/** Whether a key names one of this plugin's fields, in any spelling */
NS.isOwnField = (key: unknown): boolean => NS.ownField(key) !== "";

/**
 * The keys to remove when a gallery stops being manga.
 *
 * Unmarking takes this plugin's fields with it, because a gallery it no longer
 * manages should not be left carrying half its data — values that nothing
 * displays and nothing explains. Which is a decision about *this* plugin's fields
 * rather than about absence, so it is a list of names rather than a sweep.
 *
 * The spelling matters. The API removes by exact key, so a removal naming the
 * canonical form would leave a key that had drifted in case behind — and the
 * gallery would keep showing a language it was supposed to have forgotten. The
 * canonical name is the fallback for a gallery that somehow has none of them,
 * which is the state an unmark can still be issued from.
 */
NS.fieldsToClear = (customFields: unknown): string[] => {
  const map = (customFields || {}) as MangaToolsCustomFields;
  if (!map || typeof map !== "object") return [NS.MANGA_FIELD_NAME];

  const keys = Object.keys(map).filter((key) => NS.isOwnField(key));

  return keys.length ? keys : [NS.MANGA_FIELD_NAME];
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
