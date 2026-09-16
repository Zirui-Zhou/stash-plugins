/**
 * Manga Tools — the filter model's pure logic, for all three fields.
 *
 * This module holds everything about reading a language, censorship or manga
 * selection out of Stash's filter model and writing it back as query parameters.
 * Nothing here touches the DOM or renders JSX; the two surfaces that use it —
 * the sidebar sections (sidebar-filter.tsx) and the dialog's Language card
 * (dialog-filter.tsx) — import it and keep their own rendering.
 *
 * WHY THERE IS NO URL ENCODING HERE. Stash keeps its filter in the URL, in a `c`
 * query parameter it encodes with a private helper (translateJSON, in
 * models/list-filter/filter.ts) that swaps braces for parentheses. Rebuilding
 * that would mean reimplementing a format whose failure mode is silent — a
 * filter that just does not apply. Instead this clones the live model and asks
 * it for its own query parameters, so the encoding stays Stash's business. All
 * of that is public API on the model: `clone`, `options.criterionOptions`,
 * `makeCriterion` and `makeQueryParameters`.
 *
 * WHAT THE CONDITIONS MEAN, measured against a real library rather than assumed:
 *
 *   EQUALS     [a, b]       matches a OR b          (1 + 3 = 4 of 9 tagged)
 *   NOT_EQUALS [a, b]       excludes both, and ALSO matches galleries with no
 *                           language field at all   (1194 − 1 = 1193 for [a])
 *   NOT_NULL                galleries with a language
 *   IS_NULL                 galleries without one
 *
 * That last row is why the "exclude" here is a verbatim mirror of Stash's own
 * rather than something cleverer: excluding one language on a mostly-untagged
 * library still returns almost everything, and pretending otherwise would be
 * less honest than matching the studio filter and documenting it.
 *
 * Conditions are combined with AND, so include and exclude compose: "equals X
 * AND not-equals Y" is exactly "included X, excluded Y".
 */
import { NS } from "./languages";
import { t } from "./i18n";
import type {
  MangaToolsCriterionOption,
  MangaToolsCustomFieldCondition,
  MangaToolsFilterCriterion,
  MangaToolsFilterModel,
  MangaToolsHistory,
  MangaToolsIntl,
  MangaToolsLanguageSelection,
  MangaToolsMangaState,
} from "./plugin-api";

/** The `type` Stash's ListFilterOptions gives the custom-fields criterion */
const CUSTOM_FIELDS_TYPE = "custom_fields";

/**
 * The type this plugin registers its own criterion under, so the "edit filters"
 * dialog can offer a Language card of its own.
 *
 * Deliberately a different type from `custom_fields`, and deliberately not what
 * gets written to the URL — see registerLanguageCriterionOption.
 */
export const LANGUAGE_TYPE = "language";

export const EMPTY_SELECTION: MangaToolsLanguageSelection = {
  modifier: "",
  included: [],
  excluded: [],
};

/**
 * Adds a Language criterion to Stash's list filter options, so the "edit
 * filters" dialog offers a card for it alongside its own.
 *
 * Why it is reachable at all: the dialog builds its cards from
 * `getFilterOptions(mode).criterionOptions`, a module-level array, and the model
 * reaches it as `filter.options.criterionOptions`. Stash only reads `type`,
 * `messageID` and `makeCriterion` off an option, so one can be added from here
 * without the class it would normally be built from.
 *
 * What it is NOT: a criterion of our own. The card opens Stash's custom-fields
 * editor, because CriterionEditor dispatches on `instanceof CustomFieldsCriterion`
 * and that is what makeCriterion returns. So it saves knowing the field name and
 * typing it — the value is still a code typed by hand. The sidebar is the
 * interface with the dropdown; this is a way in for someone already in the dialog.
 */
export function registerLanguageCriterionOption(
  filter: MangaToolsFilterModel
): void {
  const options = filter?.options?.criterionOptions;
  if (!options) return;

  let found: MangaToolsCriterionOption | null = null;
  for (let i = 0; i < options.length; i++) {
    // Guarding on the array rather than a flag of our own: it is Stash's list
    // and it outlives this call, so asking it is both simpler and correct even
    // if Stash ever keeps more than one.
    if (options[i].type === LANGUAGE_TYPE) return;
    if (options[i].type === CUSTOM_FIELDS_TYPE) found = options[i];
  }
  if (!found) return;

  // Bound to a const so the closure below keeps the non-null type.
  const customFieldsOption = found;

  const option: MangaToolsCriterionOption = {
    type: LANGUAGE_TYPE,
    messageID: "config.ui.language.heading",
    makeCriterion: () => {
      // A real CustomFieldsCriterion, so CriterionEditor renders the editor
      // Stash wrote for it and the query it produces is the one the sidebar
      // already writes.
      const criterion = customFieldsOption.makeCriterion();

      // …relabelled as ours. Stash decides whether the card is in use by
      // comparing the criterion's option *type* against the card's, so without
      // this our card would never light up — worse, it would not open at all,
      // because the card body only renders for the criterion whose type matches.
      criterion.criterionOption = option;

      // Deliberately left with no conditions. Not an oversight: an empty
      // criterion fails isValid(), so simply opening the card cannot add
      // anything to the filter — which matters because a custom-field EQUALS
      // with no value matches *nothing* (measured: 0 of 1194 galleries). The
      // value only appears when the reader picks a language, and it is Stash's
      // own editor that commits it.
      criterion.value = [];

      // Kept off the URL on purpose. Stash decodes the query string inside
      // FilteredGalleryList, before this option can be registered, so a stored
      // type of "language" would fail to resolve on a reload and the filter
      // would vanish silently. The stored type stays "custom_fields", which
      // Stash always understands; only the in-session identity is ours.
      //
      // `this`, not the captured criterion: Stash clones criteria with
      // cloneDeep before committing them, and a closure would keep pointing at
      // the original object and serialise a stale value.
      criterion.toQueryParams = function (this: MangaToolsFilterCriterion) {
        return { type: CUSTOM_FIELDS_TYPE, value: this.value };
      };

      return criterion;
    },
  };

  options.push(option);
}

/**
 * Finds the filter's criterion for language, whether it was made here or typed
 * by hand into the custom-fields card.
 *
 * Both types are accepted because they are the same criterion underneath: one
 * made by the dialog's Language card carries our label, one made by hand carries
 * the generic one. Missing either would let the two surfaces disagree about the
 * filter that is set.
 *
 * Matched on the criterion option's type rather than by importing Stash's
 * CustomFieldsCriterion class, which lives inside its bundle and is not
 * reachable from a plugin.
 */
function customFieldsCriterion(
  filter: MangaToolsFilterModel
): MangaToolsFilterCriterion | null {
  const criteria = filter?.criteria || [];
  for (let i = 0; i < criteria.length; i++) {
    const option = criteria[i]?.criterionOption;
    if (!option) continue;
    if (option.type === CUSTOM_FIELDS_TYPE || option.type === LANGUAGE_TYPE) {
      return criteria[i];
    }
  }
  return null;
}

/** Is this condition about the language field? Field names match case-insensitively. */
function isLanguageCondition(
  condition: MangaToolsCustomFieldCondition
): boolean {
  return !!condition && NS.ownField(condition.field) === NS.FIELD_NAME;
}

/** The values of a condition, as codes */
function conditionValues(condition: MangaToolsCustomFieldCondition): string[] {
  const values = condition.value || [];
  return values.map((v) => String(v));
}

/**
 * Is this criterion, as a whole, the language filter?
 *
 * *All* of its conditions, not any of them: a criterion that also carries another
 * field is not ours, and calling it ours would mislabel it and — worse — hand it
 * to Stash as the Language criterion. An empty one is not ours either; there is
 * nothing in it to recognise.
 *
 * Stricter than readLanguageFilter, which reports whatever it recognises and
 * ignores the rest. That is the right reading for a filter someone built by hand;
 * this one answers the different question "may we call this criterion ours".
 */
function isLanguageCriterion(
  criterion: MangaToolsFilterCriterion | null
): boolean {
  const conditions = criterion?.value || [];
  if (!conditions.length) return false;

  for (let i = 0; i < conditions.length; i++) {
    if (!isLanguageCondition(conditions[i])) return false;
  }

  return true;
}

/** The filter's criterion, if it is ours and nothing else's */
export function languageCriterionOf(
  filter: MangaToolsFilterModel
): MangaToolsFilterCriterion | null {
  const criterion = customFieldsCriterion(filter);
  return criterion && isLanguageCriterion(criterion) ? criterion : null;
}

/**
 * Hands the filter's language criterion over to Stash's own controls.
 *
 * The criterion is stored as a custom field and has to be — the query string is
 * read back before this plugin's option exists, so a stored type of "language"
 * would not resolve (see registerLanguageCriterionOption). But that leaves Stash
 * treating it as a custom field: its tag opens the custom-fields card, our card
 * never shows as the one in use, and it has no ✗ beside it. Two own properties
 * settle all three without touching the stored type.
 *
 *   criterionOption  our Language option, so everything that asks a criterion
 *                    which card it belongs to — the tag's click, the card's
 *                    remove button, the dialog's "is this in use" test — answers
 *                    "language".
 *   toQueryParams    the stored form, back to a custom field. Without it the swap
 *                    above would reach the URL and write `language` there, which
 *                    nothing can read back on a reload.
 *
 * Own properties on the criterion rather than a patch on its class, re-applied on
 * every render: each URL change decodes into fresh criteria, and the dialog works
 * on a cloneDeep of the filter, which carries own properties across.
 *
 * That it can be attached this late — after Stash has long since drawn its tag —
 * is the point: what it changes is read when the user *clicks*, not when Stash
 * renders. The tag's wording cannot rely on that and is repaired in the DOM
 * instead; see relabelTags.
 */
export function adoptLanguageCriterion(filter: MangaToolsFilterModel): void {
  const criterion = languageCriterionOf(filter);
  if (!criterion) return;
  if (
    criterion.criterionOption &&
    criterion.criterionOption.type === LANGUAGE_TYPE
  ) {
    return;
  }

  const options = filter.options?.criterionOptions || [];
  let option: MangaToolsCriterionOption | null = null;
  for (let i = 0; i < options.length; i++) {
    if (options[i].type === LANGUAGE_TYPE) option = options[i];
  }
  if (!option) return;

  criterion.criterionOption = option;
  criterion.toQueryParams = function (this: MangaToolsFilterCriterion) {
    return { type: CUSTOM_FIELDS_TYPE, value: this.value };
  };
}

/**
 * Reads the language part of the filter.
 *
 * Anything this does not recognise — another field, or a modifier that is not
 * one of ours — is simply not reported, which is what makes the section safe to
 * sit alongside a hand-built custom-field filter.
 */
export function readLanguageFilter(
  filter: MangaToolsFilterModel
): MangaToolsLanguageSelection {
  const criterion = customFieldsCriterion(filter);
  if (!criterion?.value) return EMPTY_SELECTION;

  const selection: MangaToolsLanguageSelection = {
    modifier: "",
    included: [],
    excluded: [],
  };

  criterion.value.forEach((condition) => {
    if (!isLanguageCondition(condition)) return;

    if (condition.modifier === "NOT_NULL") selection.modifier = "any";
    else if (condition.modifier === "IS_NULL") selection.modifier = "none";
    else if (condition.modifier === "EQUALS") {
      selection.included = conditionValues(condition);
    } else if (condition.modifier === "NOT_EQUALS") {
      selection.excluded = conditionValues(condition);
    }
  });

  return selection;
}

/**
 * Changes to a selection.
 *
 * Pure functions rather than methods on a component, because two very different
 * surfaces share this state: the sidebar section and the filter dialog's card.
 * They are laid out differently and they commit at different times — the sidebar
 * writes the URL at once, the dialog waits for Apply — but what a click *means*
 * has to be identical in both, or the two drift apart and a filter set in one is
 * not the filter the other shows. Keeping the meaning here and the rendering
 * there is what prevents that.
 */

/** Adds a language to the included list, or takes it out again */
export function toggleIncluded(
  selection: MangaToolsLanguageSelection,
  code: string
): MangaToolsLanguageSelection {
  const already = selection.included.indexOf(code) !== -1;

  return {
    modifier: "",
    included: already
      ? selection.included.filter((c) => c !== code)
      : selection.included.concat([code]),
    // A language is included or excluded, never both: EQUALS and NOT_EQUALS for
    // one value is a contradiction and matches nothing.
    excluded: selection.excluded.filter((c) => c !== code),
  };
}

/** The same, on the excluded side */
export function toggleExcluded(
  selection: MangaToolsLanguageSelection,
  code: string
): MangaToolsLanguageSelection {
  const already = selection.excluded.indexOf(code) !== -1;

  return {
    modifier: "",
    included: selection.included.filter((c) => c !== code),
    excluded: already
      ? selection.excluded.filter((c) => c !== code)
      : selection.excluded.concat([code]),
  };
}

/**
 * (Any) or (None): the two states a language field can be in with no particular
 * value asked for.
 *
 * The lists are dropped rather than kept. They cannot be expressed at the same
 * time as a modifier — only the modifier survives into the query — and quietly
 * discarding them later would be worse than making the choice visible now.
 */
export function withModifier(
  _selection: MangaToolsLanguageSelection,
  modifier: "any" | "none"
): MangaToolsLanguageSelection {
  return { modifier: modifier, included: [], excluded: [] };
}

/** Back to the default, which is "no restriction at all" */
export function withoutModifier(
  selection: MangaToolsLanguageSelection
): MangaToolsLanguageSelection {
  return {
    modifier: "",
    included: selection.included.slice(),
    excluded: selection.excluded.slice(),
  };
}

/** Is this asking for nothing? */
export function isEmptySelection(
  selection: MangaToolsLanguageSelection
): boolean {
  return (
    !selection.modifier &&
    !selection.included.length &&
    !selection.excluded.length
  );
}

/** Are these the same request? Compared as sets, so click order cannot matter */
export function sameSelection(
  a: MangaToolsLanguageSelection,
  b: MangaToolsLanguageSelection
): boolean {
  return (
    a.modifier === b.modifier &&
    sameCodes(a.included, b.included) &&
    sameCodes(a.excluded, b.excluded)
  );
}

function sameCodes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  const x = a.slice().sort();
  const y = b.slice().sort();
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

/**
 * The modifier's own word, taken from Stash's messages so it agrees with the
 * wording Stash puts on the same condition — "is", "is not", "is null", "is not
 * null". An explicit list rather than a message id built from the modifier name:
 * the ids are Stash's, and this is the whole of the set this plugin produces
 * (see selectionConditions). Null for anything else, which leaves that condition
 * to Stash.
 */
function modifierWord(intl: MangaToolsIntl, modifier: string): string | null {
  if (modifier === "IS_NULL") {
    return message(intl, "criterion_modifier.is_null", "is null");
  }
  if (modifier === "NOT_NULL") {
    return message(intl, "criterion_modifier.not_null", "is not null");
  }
  if (modifier === "NOT_EQUALS") {
    return message(intl, "criterion_modifier.not_equals", "is not");
  }
  if (modifier === "EQUALS") {
    return message(intl, "criterion_modifier.equals", "is");
  }
  return null;
}

/**
 * One of the sentences a language filter is made of, in Stash's own words.
 *
 * Per condition rather than per selection, because that is how Stash draws them:
 * a criterion holding one condition gets one tag, and one holding several gets a
 * tag each — which a language filter with both picks and exclusions has. So
 * "Language is Japanese" and "Language is not Korean" are two sentences, and the
 * tag row shows both.
 *
 * Assembled from Stash's messages rather than written here, so a tag reads
 * exactly like one Stash draws. That means the criterion's localised name and the
 * modifier's own label, which is also why (Any) comes out as "is not null": that
 * is what the modifier it produces means.
 *
 * Null when the modifier is not one of ours, so a hand-built condition this
 * plugin does not understand keeps Stash's wording rather than being given one
 * that would say something else.
 */
function languageConditionLabel(
  intl: MangaToolsIntl,
  condition: MangaToolsCustomFieldCondition
): string | null {
  const word = modifierWord(intl, condition.modifier);
  if (word === null) return null;

  return intl.formatMessage(
    { id: "criterion_modifier.format_string" },
    {
      criterion: fieldLabel(intl),
      modifierString: word,
      valueString: conditionValues(condition)
        .map((code) => NS.name(code, intl.locale))
        .join(", "),
    }
  );
}

/**
 * The censorship field's own wording for a condition, in the same shape as the
 * language one — the criterion's name, the modifier's word, the values joined —
 * with the value names taken from censorship.tsx rather than from the language
 * table.
 */
function censorshipConditionLabel(
  intl: MangaToolsIntl,
  condition: MangaToolsCustomFieldCondition
): string | null {
  const word = modifierWord(intl, condition.modifier);
  if (word === null) return null;

  return intl.formatMessage(
    { id: "criterion_modifier.format_string" },
    {
      criterion: censorshipHeading(intl),
      modifierString: word,
      valueString: conditionValues(condition)
        .map((value) => NS.censorshipLabel(intl, value))
        .join(", "),
    }
  );
}

/**
 * The manga mark's wording for a condition.
 *
 * The mark is a presence, so its only two conditions are NOT_NULL and IS_NULL,
 * and the tag should say "marked" / "unmarked" rather than "is (not) null" — the
 * latter is the *mechanism*, and a reader filtering a shelf wants the meaning.
 * Anything else is a condition this plugin does not write, and is left to Stash.
 */
function mangaConditionLabel(
  intl: MangaToolsIntl,
  condition: MangaToolsCustomFieldCondition
): string | null {
  const state =
    condition.modifier === "NOT_NULL"
      ? t(intl, "mangaTools.filter.manga.marked")
      : condition.modifier === "IS_NULL"
        ? t(intl, "mangaTools.filter.manga.unmarked")
        : null;
  if (state === null) return null;

  return intl.formatMessage(
    { id: "criterion_modifier.format_string" },
    {
      criterion: t(intl, "mangaTools.manga.marked"),
      modifierString: message(intl, "criterion_modifier.equals", "is"),
      valueString: state,
    }
  );
}

/**
 * One condition's tag sentence, for whichever of this plugin's fields it names.
 *
 * Dispatches on the field, because the three fields share one criterion and so
 * one criterion can carry conditions for all three. Null for a condition naming
 * a field this plugin does not own, or a modifier it has no wording for, so a
 * hand-built condition keeps Stash's wording rather than being given one that
 * would say something else.
 */
export function conditionLabel(
  intl: MangaToolsIntl,
  condition: MangaToolsCustomFieldCondition
): string | null {
  const field = NS.ownField(condition.field);
  if (field === NS.FIELD_NAME) return languageConditionLabel(intl, condition);
  if (field === NS.CENSORSHIP_FIELD_NAME)
    return censorshipConditionLabel(intl, condition);
  if (field === NS.MANGA_FIELD_NAME)
    return mangaConditionLabel(intl, condition);
  return null;
}

/**
 * What every tag for this criterion should say, in order — or null if any of its
 * conditions is one this plugin has no wording for, in which case the whole
 * criterion is left as Stash drew it.
 */
export function tagLabels(
  intl: MangaToolsIntl,
  criterion: MangaToolsFilterCriterion
): string[] | null {
  const conditions = criterion.value || [];
  const labels: string[] = [];

  for (let i = 0; i < conditions.length; i++) {
    const label = conditionLabel(intl, conditions[i]);
    if (label === null) return null;
    labels.push(label);
  }

  return labels.length ? labels : null;
}

/**
 * One field's tag wordings, in the order Stash draws them — or null when the
 * filter says nothing about that field, or when one of its conditions is one this
 * plugin has no wording for.
 *
 * Per field rather than per criterion, because the three fields share one
 * custom-fields criterion: a filter with a language and a censorship holds both
 * as conditions of the *same* criterion, and Stash draws a tag for each. A
 * section words the tags of its own field, so what it passes here has to be that
 * field's conditions — handing over the whole criterion would put another field's
 * wording on its tag, and requiring the criterion to hold nothing but this field
 * (isLanguageCriterion and its siblings, which adoption needs) would leave every
 * tag as Stash drew it the moment two fields were set at once.
 */
export function fieldTagLabels(
  intl: MangaToolsIntl,
  filter: MangaToolsFilterModel,
  fieldName: string
): string[] | null {
  const criterion = customFieldsCriterion(filter);
  const conditions = criterion?.value || [];
  const labels: string[] = [];

  for (let i = 0; i < conditions.length; i++) {
    if (NS.ownField(conditions[i].field) !== fieldName) continue;

    const label = conditionLabel(intl, conditions[i]);
    if (label === null) return null;
    labels.push(label);
  }

  return labels.length ? labels : null;
}

/** The conditions our selection turns into */
export function selectionConditions(
  selection: MangaToolsLanguageSelection
): MangaToolsCustomFieldCondition[] {
  if (selection.modifier === "any") {
    return [{ field: NS.FIELD_NAME, modifier: "NOT_NULL" }];
  }
  if (selection.modifier === "none") {
    return [{ field: NS.FIELD_NAME, modifier: "IS_NULL" }];
  }

  const conditions: MangaToolsCustomFieldCondition[] = [];
  if (selection.included.length) {
    conditions.push({
      field: NS.FIELD_NAME,
      modifier: "EQUALS",
      value: selection.included.slice(),
    });
  }
  if (selection.excluded.length) {
    conditions.push({
      field: NS.FIELD_NAME,
      modifier: "NOT_EQUALS",
      value: selection.excluded.slice(),
    });
  }
  return conditions;
}

/**
 * The query parameters for the filter with this selection applied, or null when
 * the filter offers no custom-fields criterion to attach it to.
 *
 * Every language condition is replaced and the rest are kept, so this composes
 * with a hand-made custom-field filter instead of discarding it. Case variants
 * of the field name go too, so a criterion a user typed as
 * "plugin.mangaTools.Language" cannot end up holding two conditions for one
 * field.
 *
 * The model is cloned because it is Stash's live state object; mutating it in
 * place would change the filter without telling anything to re-render.
 */
export function languageFilterQuery(
  filter: MangaToolsFilterModel,
  selection: MangaToolsLanguageSelection
): string | null {
  if (!filter || typeof filter.clone !== "function") return null;

  // Ours if the dialog's Language card registered one, so a filter set here
  // shows as that card rather than as a generic custom field. Falls back to the
  // custom-fields option, which is the same criterion underneath.
  const options = filter.options?.criterionOptions || [];
  let option: MangaToolsCriterionOption | null = null;
  for (let i = 0; i < options.length; i++) {
    if (options[i].type === CUSTOM_FIELDS_TYPE) option = options[i];
    if (options[i].type === LANGUAGE_TYPE) option = options[i];
  }
  if (!option) return null;
  const criterionOption = option;

  const next = filter.clone();
  let criterion = customFieldsCriterion(next);

  const kept: MangaToolsCustomFieldCondition[] = [];
  if (criterion?.value) {
    for (let j = 0; j < criterion.value.length; j++) {
      if (!isLanguageCondition(criterion.value[j]))
        kept.push(criterion.value[j]);
    }
  }

  const conditions = kept.concat(selectionConditions(selection));

  if (!conditions.length) {
    // Nothing left to say: drop the criterion rather than leave an empty one,
    // which would show as a filter tag with no meaning.
    next.criteria = (next.criteria || []).filter((c) => c !== criterion);
  } else {
    if (!criterion) {
      criterion = criterionOption.makeCriterion();
      next.criteria = (next.criteria || []).concat([criterion]);
    }
    criterion.value = conditions;
  }

  return next.makeQueryParameters();
}

/**
 * Reports a filter change the way Stash does it: by replacing the URL.
 *
 * Stash's own list hook re-reads the query string on every location change, so
 * this is the supported route into its filter state — and it is what makes the
 * tag, the result count, pagination and a bookmarkable URL all follow along for
 * free. `replace` rather than `push`, matching that hook, so changing a filter
 * does not fill up the back button.
 *
 * The sidebar's own filter sections take a `setFilter` callback instead, which a
 * plugin is never handed; this reaches the same state through the other door.
 */
export function applyLanguage(
  filter: MangaToolsFilterModel,
  history: MangaToolsHistory,
  selection: MangaToolsLanguageSelection
): void {
  const search = languageFilterQuery(filter, selection);
  if (search === null) {
    console.error(
      "[mangaTools] this list has no custom-fields filter, so the language filter is unavailable"
    );
    return;
  }

  history.replace(Object.assign({}, history.location, { search: search }));
}

// ── Censorship: the language filter's shape, on the censorship field ──────
// The censorship filter is the language filter exactly — (Any)/(None) modifiers
// plus include/exclude lists of its two values — so its helpers mirror the
// language ones above, swapping the field and the value names. The operations on
// a selection (toggleIncluded and the rest) are shared verbatim, because they
// never ask which field the codes belong to.

/** Is this condition about the censorship field? */
function isCensorshipCondition(
  condition: MangaToolsCustomFieldCondition
): boolean {
  return (
    !!condition && NS.ownField(condition.field) === NS.CENSORSHIP_FIELD_NAME
  );
}

/** Reads the censorship part of the filter, ignoring whatever else it holds. */
export function readCensorshipFilter(
  filter: MangaToolsFilterModel
): MangaToolsLanguageSelection {
  const criterion = customFieldsCriterion(filter);
  if (!criterion?.value) return EMPTY_SELECTION;

  const selection: MangaToolsLanguageSelection = {
    modifier: "",
    included: [],
    excluded: [],
  };

  criterion.value.forEach((condition) => {
    if (!isCensorshipCondition(condition)) return;

    if (condition.modifier === "NOT_NULL") selection.modifier = "any";
    else if (condition.modifier === "IS_NULL") selection.modifier = "none";
    else if (condition.modifier === "EQUALS") {
      selection.included = conditionValues(condition);
    } else if (condition.modifier === "NOT_EQUALS") {
      selection.excluded = conditionValues(condition);
    }
  });

  return selection;
}

/** The conditions a censorship selection turns into. See selectionConditions. */
function censorshipSelectionConditions(
  selection: MangaToolsLanguageSelection
): MangaToolsCustomFieldCondition[] {
  if (selection.modifier === "any") {
    return [{ field: NS.CENSORSHIP_FIELD_NAME, modifier: "NOT_NULL" }];
  }
  if (selection.modifier === "none") {
    return [{ field: NS.CENSORSHIP_FIELD_NAME, modifier: "IS_NULL" }];
  }

  const conditions: MangaToolsCustomFieldCondition[] = [];
  if (selection.included.length) {
    conditions.push({
      field: NS.CENSORSHIP_FIELD_NAME,
      modifier: "EQUALS",
      value: selection.included.slice(),
    });
  }
  if (selection.excluded.length) {
    conditions.push({
      field: NS.CENSORSHIP_FIELD_NAME,
      modifier: "NOT_EQUALS",
      value: selection.excluded.slice(),
    });
  }
  return conditions;
}

/** The query parameters for the filter with this censorship selection applied. */
export function censorshipFilterQuery(
  filter: MangaToolsFilterModel,
  selection: MangaToolsLanguageSelection
): string | null {
  if (!filter || typeof filter.clone !== "function") return null;

  // Attached to the same custom-fields criterion the language filter uses — there
  // is one criterion per field, not one per type, so the censorship conditions are
  // merged into whichever criterion is already there (or created) rather than a
  // second.
  const options = filter.options?.criterionOptions || [];
  let option: MangaToolsCriterionOption | null = null;
  for (let i = 0; i < options.length; i++) {
    if (options[i].type === CUSTOM_FIELDS_TYPE) option = options[i];
  }
  if (!option) return null;
  const criterionOption = option;

  const next = filter.clone();
  let criterion = customFieldsCriterion(next);

  const kept: MangaToolsCustomFieldCondition[] = [];
  if (criterion?.value) {
    for (let j = 0; j < criterion.value.length; j++) {
      if (!isCensorshipCondition(criterion.value[j]))
        kept.push(criterion.value[j]);
    }
  }

  const conditions = kept.concat(censorshipSelectionConditions(selection));

  if (!conditions.length) {
    next.criteria = (next.criteria || []).filter((c) => c !== criterion);
  } else {
    if (!criterion) {
      criterion = criterionOption.makeCriterion();
      next.criteria = (next.criteria || []).concat([criterion]);
    }
    criterion.value = conditions;
  }

  return next.makeQueryParameters();
}

/** Reports a censorship change the way applyLanguage does, by replacing the URL. */
export function applyCensorship(
  filter: MangaToolsFilterModel,
  history: MangaToolsHistory,
  selection: MangaToolsLanguageSelection
): void {
  const search = censorshipFilterQuery(filter, selection);
  if (search === null) {
    console.error(
      "[mangaTools] this list has no custom-fields filter, so the censorship filter is unavailable"
    );
    return;
  }

  history.replace(Object.assign({}, history.location, { search: search }));
}

// ── Manga mark: a boolean filter, like Stash's organised ──────────────────
// The mark is a presence, so the filter is one choice among two — marked or
// unmarked — plus "neither asked for". No include/exclude, no search box: two
// values need neither.

/** Is this condition about the manga mark? */
function isMangaCondition(condition: MangaToolsCustomFieldCondition): boolean {
  return !!condition && NS.ownField(condition.field) === NS.MANGA_FIELD_NAME;
}

/** Reads the manga mark's state from the filter. */
export function readMangaFilter(
  filter: MangaToolsFilterModel
): MangaToolsMangaState {
  const criterion = customFieldsCriterion(filter);
  if (!criterion?.value) return "";

  let state: MangaToolsMangaState = "";
  criterion.value.forEach((condition) => {
    if (!isMangaCondition(condition)) return;

    if (condition.modifier === "NOT_NULL") state = "marked";
    else if (condition.modifier === "IS_NULL") state = "unmarked";
  });

  return state;
}

/** The condition a manga state turns into, or none for "not asked". */
function mangaSelectionConditions(
  state: MangaToolsMangaState
): MangaToolsCustomFieldCondition[] {
  if (state === "marked") {
    return [{ field: NS.MANGA_FIELD_NAME, modifier: "NOT_NULL" }];
  }
  if (state === "unmarked") {
    return [{ field: NS.MANGA_FIELD_NAME, modifier: "IS_NULL" }];
  }
  return [];
}

/** The query parameters for the filter with this manga state applied. */
export function mangaFilterQuery(
  filter: MangaToolsFilterModel,
  state: MangaToolsMangaState
): string | null {
  if (!filter || typeof filter.clone !== "function") return null;

  const options = filter.options?.criterionOptions || [];
  let option: MangaToolsCriterionOption | null = null;
  for (let i = 0; i < options.length; i++) {
    if (options[i].type === CUSTOM_FIELDS_TYPE) option = options[i];
  }
  if (!option) return null;
  const criterionOption = option;

  const next = filter.clone();
  let criterion = customFieldsCriterion(next);

  const kept: MangaToolsCustomFieldCondition[] = [];
  if (criterion?.value) {
    for (let j = 0; j < criterion.value.length; j++) {
      if (!isMangaCondition(criterion.value[j])) kept.push(criterion.value[j]);
    }
  }

  const conditions = kept.concat(mangaSelectionConditions(state));

  if (!conditions.length) {
    next.criteria = (next.criteria || []).filter((c) => c !== criterion);
  } else {
    if (!criterion) {
      criterion = criterionOption.makeCriterion();
      next.criteria = (next.criteria || []).concat([criterion]);
    }
    criterion.value = conditions;
  }

  return next.makeQueryParameters();
}

/** Reports a manga change the way applyLanguage does, by replacing the URL. */
export function applyManga(
  filter: MangaToolsFilterModel,
  history: MangaToolsHistory,
  state: MangaToolsMangaState
): void {
  const search = mangaFilterQuery(filter, state);
  if (search === null) {
    console.error(
      "[mangaTools] this list has no custom-fields filter, so the manga filter is unavailable"
    );
    return;
  }

  history.replace(Object.assign({}, history.location, { search: search }));
}

/** The language table's own label, from Stash's locale files (see mangaTools.tsx
 *  for the longer note; this is the same message, duplicated so this module
 *  does not have to reach back into the entry file). */
export function fieldLabel(intl: MangaToolsIntl): string {
  return intl.formatMessage({
    id: "config.ui.language.heading",
    defaultMessage: "Language",
  });
}

/** The censorship field's own label — this plugin's word, since Stash has none */
export function censorshipHeading(intl: MangaToolsIntl): string {
  return t(intl, "mangaTools.censorship.heading");
}

/** Stash's own wording for the two list states, so nothing here reads as foreign */
export function message(
  intl: MangaToolsIntl,
  id: string,
  fallback: string
): string {
  return intl.formatMessage({ id: id, defaultMessage: fallback });
}

// Published on the namespace alongside the rest of the plugin's pure logic, so
// the smoke tests can exercise the read/merge rules against a stub filter model
// without rendering anything.
NS.toggleIncluded = toggleIncluded;
NS.toggleExcluded = toggleExcluded;
NS.withModifier = withModifier;
NS.withoutModifier = withoutModifier;
NS.isEmptySelection = isEmptySelection;
NS.sameSelection = sameSelection;
NS.conditionLabel = conditionLabel;
NS.tagLabels = tagLabels;
NS.fieldTagLabels = fieldTagLabels;
NS.readLanguageFilter = readLanguageFilter;
NS.languageFilterQuery = languageFilterQuery;
NS.readCensorshipFilter = readCensorshipFilter;
NS.censorshipFilterQuery = censorshipFilterQuery;
NS.readMangaFilter = readMangaFilter;
NS.mangaFilterQuery = mangaFilterQuery;
NS.registerLanguageCriterionOption = registerLanguageCriterionOption;
NS.adoptLanguageCriterion = adoptLanguageCriterion;
