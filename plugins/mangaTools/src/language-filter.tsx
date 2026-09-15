/**
 * Manga Tools — filtering the gallery list by language.
 *
 * A "language" section in the gallery list's filter sidebar, built to work like
 * Stash's own studio section: a searchable list of candidates offering both
 * "include" and "exclude", a chosen value shown above the fold-away list, and
 * two modifier entries — (Any) for galleries that have any language at all, and
 * (None) for those that have none.
 *
 * WHY THE SIDEBAR AND NOT THE FILTER DIALOG. Stash's "edit filters" dialog is
 * the obvious home for a new criterion, and it is not reachable. The dialog's
 * list of criteria is built from a module-level array inside Stash's bundle
 * (models/list-filter/galleries.ts); `PluginApi` can register routes and
 * components but nothing for filters; and every component in that path
 * (EditFilterDialog, CriterionEditor, CustomFieldsFilter) is a plain React.FC,
 * so patching one would silently do nothing. The sidebar is reachable, and it
 * is also the better fit: a pinned sidebar section applies immediately, whereas
 * the dialog's changes only take effect on Apply — state a plugin cannot join,
 * because the dialog keeps it privately.
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
import { requirePluginApi } from "./plugin-api";
import type { ReactElement } from "react";
import type {
  MangaToolsCriterionOption,
  MangaToolsCustomFieldCondition,
  MangaToolsFilterCriterion,
  MangaToolsFilterModel,
  MangaToolsHistory,
  MangaToolsIntl,
  MangaToolsLanguageSelection,
  MangaToolsOption,
} from "./plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/** The `type` Stash's ListFilterOptions gives the custom-fields criterion */
const CUSTOM_FIELDS_TYPE = "custom_fields";

/**
 * The type this plugin registers its own criterion under, so the "edit filters"
 * dialog can offer a Language card of its own.
 *
 * Deliberately a different type from `custom_fields`, and deliberately not what
 * gets written to the URL — see registerLanguageCriterionOption.
 */
const LANGUAGE_TYPE = "language";

const EMPTY_SELECTION: MangaToolsLanguageSelection = {
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
  return !!condition && String(condition.field).toLowerCase() === NS.FIELD_NAME;
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
function languageCriterionOf(
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
function adoptLanguageCriterion(filter: MangaToolsFilterModel): void {
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
function readLanguageFilter(
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
export function conditionLabel(
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

/** The conditions our selection turns into */
function selectionConditions(
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
 * of the field name go too, so a criterion a user typed as "Language" cannot end
 * up holding two conditions for one field.
 *
 * The model is cloned because it is Stash's live state object; mutating it in
 * place would change the filter without telling anything to re-render.
 */
function languageFilterQuery(
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
function applyLanguage(
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
NS.readLanguageFilter = readLanguageFilter;
NS.languageFilterQuery = languageFilterQuery;
NS.registerLanguageCriterionOption = registerLanguageCriterionOption;
NS.adoptLanguageCriterion = adoptLanguageCriterion;
NS.relabelTags = relabelTags;
NS.manageDialogTags = manageDialogTags;
NS.ownTagLabels = ownTagLabels;
NS.clickedTagRemove = clickedTagRemove;

/** The language table's own label, from Stash's locale files (see mangaTools.tsx
 *  for the longer note; this is the same message, duplicated so this module
 *  does not have to reach back into the entry file). */
function fieldLabel(intl: MangaToolsIntl): string {
  return intl.formatMessage({
    id: "config.ui.language.heading",
    defaultMessage: "Language",
  });
}

/** A regional flag, drawn by flag-icons' CSS — the same markup the dropdowns use */
function Flag(props: { flag: string; className?: string }): ReactElement {
  return (
    <span
      className={
        "fi fi-" + props.flag + (props.className ? " " + props.className : "")
      }
    />
  );
}

/** Stash's own wording for the two list states, so nothing here reads as foreign */
function message(intl: MangaToolsIntl, id: string, fallback: string): string {
  return intl.formatMessage({ id: id, defaultMessage: fallback });
}

/**
 * Where the section's open/closed state is kept: the history entry's own state,
 * which is where Stash keeps the same thing for its sections — under a
 * `sectionOpen` object it owns. A separate key avoids colliding with it.
 *
 * The choice of place matters. `history.state` survives a reload, so a reader
 * who opened the section to pick a language finds it still open afterwards,
 * which is the behaviour Stash's own sections have. It is also readable
 * synchronously on the first render, so there is nothing to correct afterwards
 * and the section does not visibly move.
 */
const SECTION_STATE_KEY = "mangaToolsLanguageOpen";

/**
 * Whether the reader is on a touch device.
 *
 * Mirrors Stash's ScreenUtils.isTouch, which its own sidebar filters consult
 * before moving focus back to their search box: on a touch screen that would
 * raise the keyboard after every tap, which is worse than the convenience is
 * worth.
 */
function isTouchDevice(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

/** Class name of the section's mount point */
const FILTER_HOST_CLASS = "manga-tools-field-host";

/** The mount point, held at module scope so re-renders reuse the same node */
let filterHost: HTMLElement | null = null;

/**
 * One row of a language list.
 *
 * Shared by the sidebar section and the dialog's card, because the two draw the
 * same four things: a value that can be picked, one that has been picked, one
 * that has been excluded, and the two modifier entries. What differs is only the
 * wrapper — Stash's sidebar list puts the label in a `label-group` and wraps it
 * in a truncated span, while its dialog list uses bare divs and gives a picked
 * row an extra empty div — so that is what `variant` selects. Rendering them
 * separately is how the two drifted apart before.
 */
function LanguageRow(props: {
  label: string;
  state: "candidate" | "included" | "excluded";
  variant: "sidebar" | "dialog";
  flag?: string | null;
  modifier?: boolean;
  canExclude?: boolean;
  onClick: () => void;
  onExclude?: () => void;
}) {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Regular = PluginApi.libraries.FontAwesomeRegular || {};
  const Icon = PluginApi.components.Icon;
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const intl = PluginApi.libraries.Intl.useIntl();

  const hover = React.useState(false);
  const hovered = hover[0];
  const setHovered = hover[1];

  const selected = props.state !== "candidate";
  const excluded = props.state === "excluded";
  const sidebar = props.variant === "sidebar";

  function setHover(next: boolean) {
    return () => {
      setHovered(next);
    };
  }

  // A plus to add, a tick once added, a cross once excluded — and under the
  // cursor the tick or cross becomes a hollow cross, which is how Stash says
  // that clicking takes it away again.
  const icon = !selected
    ? Solid.faPlus
    : hovered
      ? Regular.faTimesCircle || Solid.faTimesCircle
      : excluded
        ? Solid.faTimesCircle
        : Solid.faCheckCircle;

  const labelClass = excluded
    ? "excluded-object-label"
    : selected
      ? "selected-object-label"
      : "unselected-object-label";

  return (
    <li
      className={
        (selected ? "selected-object" : "unselected-object") +
        (props.modifier ? " modifier-object" : "")
      }
    >
      <a
        tabIndex={0}
        onClick={props.onClick}
        onMouseEnter={setHover(true)}
        onMouseLeave={setHover(false)}
        onFocus={setHover(true)}
        onBlur={setHover(false)}
      >
        <div className={sidebar ? "label-group" : undefined}>
          <Icon
            className={
              "fa-fw " + (excluded ? "exclude-icon" : "include-button")
            }
            icon={icon}
          />
          {props.flag ? <Flag flag={props.flag} /> : null}
          {sidebar ? (
            <span className={"TruncatedText inline " + labelClass}>
              {props.label}
            </span>
          ) : (
            <span className={labelClass}>{props.label}</span>
          )}
        </div>
        {!selected || !sidebar ? (
          <div>
            {props.canExclude && !selected && Bootstrap ? (
              <Bootstrap.Button
                // Without this the exclude button is a solid blue block: see the
                // note on the search box's clear button.
                variant="secondary"
                className="minimal exclude-button"
                onClick={(e: { stopPropagation: () => void }) => {
                  e.stopPropagation();
                  if (props.onExclude) props.onExclude();
                }}
                onKeyDown={(e: { stopPropagation: () => void }) => {
                  e.stopPropagation();
                }}
              >
                <span className="exclude-button-text">
                  {sidebar
                    ? "exclude"
                    : message(intl, "actions.exclude_lowercase", "exclude")}
                </span>
                <Icon className="fa-fw exclude-icon" icon={Solid.faMinus} />
              </Bootstrap.Button>
            ) : null}
          </div>
        ) : null}
      </a>
    </li>
  );
}

/** Every tag Stash draws, in both of the rows that show a filter's criteria */
const TAG_SELECTOR = ".filter-tags .tag-item";

/**
 * Set on a Stash tag this plugin has worded, holding the wording it put there.
 *
 * Needed because a tag that has been re-worded is no longer recognisable by its
 * text — in most UI languages the wording written here does not open with the raw
 * field name — and the dialog's tags have to be found again on later renders: to
 * be shown again when the card falls back into line with the applied filter, and
 * to be hidden again after Stash has re-rendered them.
 *
 * Holding the label rather than being an empty marker is what makes it safe.
 * React can reuse an element for another criterion's tag, where Stash's own tag
 * keys collide; when it does, it rewrites the text and the attribute no longer
 * matches it — so the tag is treated as whatever it now is.
 */
const TAG_MARK = "data-manga-tools-language";

/** And this one, on the tags this plugin draws itself, so it never mistakes them for Stash's */
const OWN_TAG_MARK = "data-manga-tools-own-tag";

/**
 * Is this tag Stash's tag for the language criterion?
 *
 * Recognised by its text, there being no attribute on a tag saying which criterion
 * it came from. Every one of Stash's formats opens with the field name and then a
 * space — "{criterion} (custom field) …" for a criterion's own tag, "{criterion} …"
 * for the pills beside the editor — so that much is matched, and not the bare
 * name: the field is called "language", which another field called "languageNotes"
 * would otherwise start with too. See TAG_MARK for the tag that has already been
 * re-worded and so no longer says that.
 */
function isLanguageTag(tag: Element): boolean {
  // The label is the tag's first child — `{label}` ahead of the ✗ button.
  const text = tag.firstChild;
  if (text?.nodeType !== 3 /* TEXT_NODE */) return false;

  const value = String(text.nodeValue).trim();
  if (tag.getAttribute(TAG_MARK) === value) return true;

  const prefix = NS.FIELD_NAME.toLowerCase() + " ";
  return value.toLowerCase().indexOf(prefix) === 0;
}

/** The text node holding a language tag's label */
function tagText(tag: Element): Node {
  return tag.firstChild as Node;
}

/**
 * The language tags in the list's own row — that is, everything outside the
 * dialog.
 *
 * The dialog's row is excluded on purpose, because the two rows mean different
 * things: this one reports the filter the list is *applied* to, which is what the
 * labels this plugin builds describe, while the dialog's reports the dialog's
 * working copy, which may be ahead of it. See manageDialogTags for that one.
 */
function listLanguageTags(): Element[] {
  const all = document.querySelectorAll(TAG_SELECTOR);
  const ours: Element[] = [];

  for (let i = 0; i < all.length; i++) {
    if (all[i].closest(".edit-filter-dialog")) continue;
    if (isLanguageTag(all[i])) ours.push(all[i]);
  }

  return ours;
}

/**
 * The language tags in the dialog's row.
 *
 * The pills a card draws beside its own editor are skipped: they are inside
 * `.criterion-list`, hidden by CSS, and are Stash's record of what the criterion
 * holds rather than part of the row that reports the filter.
 */
function dialogLanguageTags(): HTMLElement[] {
  const all = document.querySelectorAll(TAG_SELECTOR);
  const ours: HTMLElement[] = [];

  for (let i = 0; i < all.length; i++) {
    if (!all[i].closest(".edit-filter-dialog")) continue;
    if (all[i].closest(".criterion-list")) continue;
    // Never the tags this plugin draws: they are the ones that must stay visible
    // when Stash's step aside, and in an English UI they look enough like Stash's
    // to be mistaken for them.
    if (all[i].hasAttribute(OWN_TAG_MARK)) continue;
    // A tag is a span, so the element Stash makes is always an HTMLElement —
    // which is what hiding one needs.
    if (isLanguageTag(all[i])) ours.push(all[i] as HTMLElement);
  }

  return ours;
}

/** Writes labels into tags, in order, one per tag */
function writeTagLabels(tags: Element[], labels: string[]): void {
  for (let i = 0; i < tags.length && i < labels.length; i++) {
    tagText(tags[i]).nodeValue = labels[i];
    tags[i].setAttribute(TAG_MARK, labels[i]);
  }
}

/**
 * Re-words the tags in the list's row, which report the applied filter.
 *
 * Stash draws a tag per criterion out of `criterion.getLabel`, and this criterion
 * gets the generic custom-field sentence with the raw field name in it —
 * "language (custom field) is ja, en". Everything else about the tag is right: it
 * opens our card, its ✗ removes the filter (see adoptLanguageCriterion). Only the
 * words are wrong, so only the words are replaced.
 *
 * In the DOM rather than through getLabel, because of *when* each is read. Stash
 * renders its tag row before this plugin is mounted — that row belongs to the
 * component that owns the filter, and this plugin mounts inside the list, which
 * itself only renders once the first query has come back. An override attached
 * during our render therefore cannot affect the tag already built in that same
 * pass, and nothing would re-render it afterwards to pick the override up. A
 * layout effect, by contrast, runs after React has written the DOM and before the
 * browser paints, which is the one moment that can still change what is on
 * screen. (It cannot change the first paint of a page *load*, which happens
 * before this plugin is mounted at all: the tag is briefly Stash's own wording
 * and is corrected when the list appears.)
 *
 * React does not undo this. On a later render it compares its own previous output
 * with the new one, so while the label it computes is unchanged it never touches
 * the text node we rewrote; and when the label does change it writes its own
 * version, which the next layout effect repairs in the same commit.
 *
 * Labels are taken in order, one per tag, because that is how Stash draws them: a
 * tag for each of the criterion's conditions, in their order.
 */
function relabelTags(labels: string[]): void {
  writeTagLabels(listLanguageTags(), labels);
}

/** Class of the box the dialog's card is drawn in, inside Stash's editor area */
const DIALOG_HOST_CLASS = "manga-tools-dialog-host";

/**
 * The box Stash renders for our criterion's editor — and only while the card is
 * open, which makes it both the anchor and the signal that there is something
 * to draw.
 */
function dialogEditorBox(): Element | null {
  return document.querySelector(
    '.criterion-list [data-type="' + LANGUAGE_TYPE + '"] .criterion-editor'
  );
}

/** Our own row, held so the same node is reused and can be taken away again */
let dialogTagsFallback: HTMLElement | null = null;

/**
 * The row Stash draws for the criteria it knows about, or null if there is none.
 *
 * Deliberately find-only: manageDialogTags needs to know whether Stash's row is
 * there, and making one as a side effect of asking is how the plugin would end up
 * with a row it does not need.
 *
 * Our own row is skipped by reference — it carries the same classes, so nothing
 * else would tell the two apart, and taking it for Stash's is what would have
 * this module remove the very row it is about to draw into.
 */
function stashDialogTagsRow(): Element | null {
  const content = document.querySelector(".edit-filter-dialog .dialog-content");
  if (!content) return null;

  const rows = content.querySelectorAll(".filter-tags");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] === dialogTagsFallback) continue;
    if (!rows[i].closest(".criterion-list")) return rows[i];
  }

  return null;
}

/**
 * Where the dialog's tags go: Stash's row when it has one, and one of our own
 * when it does not.
 *
 * That row is inside `.dialog-content` and outside `.criterion-list`, which is
 * the point — it is not inside a card, so closing the card cannot take a tag away
 * with it.
 *
 * Stash renders its row only while the dialog holds at least one criterion, and a
 * dialog whose filter is empty has none: a language picked in that state would
 * then have nowhere to be shown, which is the case this exists for.
 */
function dialogTagsRow(): Element | null {
  const stash = stashDialogTagsRow();
  if (stash) {
    dropFallbackRow();
    return stash;
  }

  const content = document.querySelector(".edit-filter-dialog .dialog-content");
  if (!content) {
    dropFallbackRow();
    return null;
  }

  if (!dialogTagsFallback) {
    dialogTagsFallback = document.createElement("div");
    // The classes Stash's own tag row carries — not the pill row's
    // (`d-flex justify-content-center mb-2`), which is a different element
    // inside a card and would space this one differently.
    dialogTagsFallback.className = "wrap-tags filter-tags";
  }

  if (dialogTagsFallback.parentNode !== content) {
    content.appendChild(dialogTagsFallback);
  }

  return dialogTagsFallback;
}

/** Takes our row away again once Stash is drawing one of its own */
function dropFallbackRow(): void {
  if (dialogTagsFallback?.parentNode) {
    dialogTagsFallback.parentNode.removeChild(dialogTagsFallback);
  }
}

/**
 * Words the dialog's tags from the card.
 *
 * This is the one place the plugin writes to the dialog's row rather than the
 * list's, and the reason is that the two rows mean different things. The list's
 * row reports the filter the list is *applied* to. The dialog's reports the
 * dialog's *working copy* — which is why Stash's own criteria update it the
 * moment they are edited, several clicks before Apply. A language filter's
 * working copy lives in this plugin's card rather than in Stash's copy, so this
 * has to say for it what Stash says for its own criteria.
 *
 * Stash's tags are the ones written into, one label per tag, because a tag is
 * already a working, clickable piece of Stash's own UI and re-wording it is all
 * that is wrong with it. A tag is hidden only when the card has nothing to say
 * in its place — an emptied card, or fewer conditions than the dialog's copy
 * holds — and never for any other reason, so nothing here alternates from one
 * render to the next.
 *
 * Hidden rather than removed: it is Stash's element, React is entitled to
 * re-render it, and one it still owns is one it will not miss.
 */
function manageDialogTags(labels: string[]): void {
  const tags = dialogLanguageTags();

  for (let i = 0; i < tags.length; i++) {
    const label = i < labels.length ? labels[i] : null;

    const text = tagText(tags[i]);
    if (label !== null && text.nodeValue !== label) {
      text.nodeValue = label;
      tags[i].setAttribute(TAG_MARK, label);
    }

    const display = label === null ? "none" : "";
    if (tags[i].style.display !== display) tags[i].style.display = display;
  }
}

/**
 * The labels the card has to draw itself: those the dialog has no tag for.
 *
 * Stash draws a tag per condition of the criterion in its copy, so the first
 * tags are the ones that already have somewhere to go and are handled by
 * manageDialogTags. What is left over is a condition the dialog's copy does not
 * have — the first language picked into a dialog that had none at all.
 */
function ownTagLabels(labels: string[]): string[] {
  return labels.slice(dialogLanguageTags().length);
}

/**
 * Was the ✗ of a language tag in the dialog's row just clicked?
 *
 * Stash's ✗ takes the criterion out of the dialog's working copy. The card is
 * what Apply merges, and it would otherwise go on showing a language the dialog
 * has dropped, so the two have to move together — which is what the listener
 * using this does.
 *
 * Only the ✗: the tag's label is Stash's way into the card, and clicking it
 * changes nothing.
 */
function clickedTagRemove(target: Element | null): boolean {
  if (!target || typeof target.closest !== "function") return false;
  if (!target.closest(".edit-filter-dialog")) return false;
  if (!target.closest(".filter-tags .tag-item button")) return false;

  const tag = target.closest(".tag-item");
  return !!tag && !tag.closest(".criterion-list") && isLanguageTag(tag);
}

/**
 * The tag the card draws itself, for a language Stash has no tag to show.
 *
 * The same markup as Stash's own down to the ✗ — a `tag-item badge` with a
 * `btn-secondary` button — so one drawn here is indistinguishable from one of
 * Stash's. That is not only for looks: it is why the dialog's row does not jump
 * when a card edit turns Stash's tag into ours.
 *
 * It is not clickable, unlike Stash's. There is nowhere for it to go: it only
 * appears while the dialog is open, with the card right beside it.
 */
function LanguageTag(props: { label: string; onRemove: () => void }) {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Bootstrap = PluginApi.libraries.Bootstrap;

  // Deliberately no row around this. It joins Stash's own row, and a wrapper
  // would nest a second flex row inside it, whose margin would inflate the height
  // of the row Stash drew — which stretches the native badges sitting in it and
  // makes them look bigger. Only the fallback row, made above, is a row.
  return (
    <span
      className="tag-item badge badge-secondary"
      // So that dialogLanguageTags never mistakes this for one of Stash's
      data-manga-tools-own-tag=""
    >
      {props.label}
      {Bootstrap ? (
        // `variant` alone: adding the class names as well is how this came out
        // as `btn btn-secondary btn btn-secondary`.
        <Bootstrap.Button variant="secondary" onClick={props.onRemove}>
          <Icon icon={Solid.faXmark || Solid.faTimes} />
        </Bootstrap.Button>
      ) : null}
    </span>
  );
}

/**
 * What of the dialog's DOM this component draws into, as one comparable value.
 *
 * Three things, and each has to be noticed separately: the dialog appearing, the
 * card's body being mounted or unmounted inside it, and the tag row coming and
 * going — the last of which changes on its own, since Stash renders that row only
 * while the dialog's copy holds a criterion. Any of the three appearing or
 * disappearing means there is something (or nothing) to draw.
 *
 * The dialog is asked first because the other two cannot exist without it, which
 * keeps the common case — no dialog open — to a single query on every mutation.
 */
function dialogDomState(): string {
  const dialog = document.querySelector(".edit-filter-dialog");
  if (!dialog) return "";

  return (
    (dialogEditorBox() ? "card " : "") + (stashDialogTagsRow() ? "tags" : "")
  );
}

/**
 * The language card inside Stash's "edit filters" dialog.
 *
 * The list is ours and so is the state behind it; nothing of Stash's editor is
 * touched. An earlier version drove that editor — filling its inputs, setting
 * its modifier select and pressing its confirm button — and it was the wrong
 * approach three times over: it produced a condition with an empty modifier that
 * the backend rejected outright, it left a replaced language in place, and it
 * could not express more than one language at all, because that editor appends
 * one condition per press and two conditions on a field are ANDed.
 *
 * So the selection is kept here, in the same shape the sidebar uses, and applied
 * by merging it into the URL at the moment Apply is pressed — see the effect
 * below. That is the sidebar's mechanism, and it brings the sidebar's abilities
 * with it: several languages, exclusions, and the two modifier entries.
 *
 * The tag is Stash's own, not one of ours: the criterion is handed to Stash as
 * the Language criterion (see adoptLanguageCriterion) and only its wording is
 * repaired (see relabelTags). So the tag appears in both tag rows, opens this
 * card when clicked and clears the filter when its ✗ is pressed — all of which
 * an earlier version of this component had to draw itself, in a second tag that
 * sat beside Stash's.
 */
export function DialogLanguageFilter(props: { filter: MangaToolsFilterModel }) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const history = PluginApi.libraries.ReactRouterDOM.useHistory();

  const bumpState = React.useState(0);
  const bump = bumpState[1];

  // What is applied right now, read from the model on every render rather than
  // snapshotted once: Apply replaces the model, and a snapshot taken at mount
  // would go on describing the filter as it was before.
  const applied = readLanguageFilter(props.filter);

  // What the reader has chosen here, which is what the list below draws and what
  // Apply writes. Both are compared as sets, so picking a value and then picking
  // it again leaves no trace.
  const choiceState = React.useState<MangaToolsLanguageSelection>(applied);
  const choice = choiceState[0];
  const setChoice = choiceState[1];

  const queryState = React.useState("");
  const query = queryState[0];
  const setQuery = queryState[1];

  const searchRef = React.useRef<HTMLInputElement | null>(null);

  /**
   * Set when Apply is pressed, cleared once the merge has run.
   *
   * Deliberately not "the model changed": a filter changed from the sidebar
   * while this dialog happens to be open would otherwise have this card's
   * unapplied selection merged into it, which is not what pressing nothing
   * means.
   */
  const applyPending = React.useRef(false);

  /**
   * What this component draws depends on DOM Stash owns and React never reports:
   * the card's body, which is mounted by an effect inside the dialog rather than
   * by the render that mounts this component, and the dialog's tag row, which is
   * rendered by another component entirely.
   *
   * Watching for clicks is not enough. The click that opens the card is not always
   * ours to catch — the tag above opens the dialog *onto* this card
   * (`editingCriterion`) — and the row is rendered in the same commit as the
   * dialog itself, so a render that runs before that commit cannot see it. Without
   * this the card could open empty, with no search box and no languages, and the
   * dialog's tags could go unworded.
   *
   * So the mount points are watched rather than predicted. A mutation callback is
   * a microtask, which is before the browser paints, and React renders a state
   * change made outside an event handler synchronously — so what this asks for is
   * in place before any of it is on screen.
   */
  const dialogDom = React.useRef("");
  React.useEffect(() => {
    if (typeof MutationObserver !== "function") return;

    const observer = new MutationObserver(() => {
      const state = dialogDomState();
      if (state === dialogDom.current) return;

      dialogDom.current = state;
      bump((v) => v + 1);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, []);

  /** Apply, and the ways Stash itself takes the language away */
  React.useEffect(() => {
    function onClick(event: Event) {
      const clicked = event.target as Element | null;
      if (!clicked || typeof clicked.closest !== "function") return;
      if (!clicked.closest(".edit-filter-dialog")) return;

      // Apply, as Stash draws it: the one primary button in the dialog's footer.
      //
      // On the *capture* phase, deliberately, so this runs before React's own
      // handler and therefore before the render that follows it. The flag only
      // has to be standing by the time the merge effect runs, and capture is the
      // ordering that guarantees it — on the bubble phase it is set after React
      // has already re-rendered, and the effect may well have run by then, in
      // which case it sees nothing pending and the merge never happens again.
      if (clicked.closest(".modal-footer button.btn-primary")) {
        applyPending.current = true;

        // A deadline, because the wait in the merge below has no other way out,
        // and it reports a case worth knowing about rather than a bug: Apply
        // commits Stash's own filter, which this card's selection is not part of.
        // Choosing a language and nothing else leaves that filter untouched, so
        // there is nothing for the merge to wait for and the language is not
        // applied. Changing it from the sidebar is what works.
        window.setTimeout(() => {
          if (!applyPending.current) return;
          applyPending.current = false;

          console.warn(
            "[mangaTools] Apply changed nothing in Stash's filter, so the language " +
              "picked in the card was not applied. Pick it in the sidebar instead."
          );
        }, 2000);
      }

      // Every way Stash itself takes the language away — the ✗ on the card, the
      // ✗ on the dialog's tag, and "clear all" — edits the dialog's working copy
      // rather than this card's state. Apply then commits a filter with no
      // language in it, and the merge would read our own still-standing selection
      // as the newer of the two and write it straight back. Emptying it here is
      // what makes those buttons mean what they say, and what keeps the card
      // showing the same filter the dialog does.
      if (
        clicked.closest(".clear-all-button") ||
        clicked.closest(
          '.criterion-list [data-type="' +
            LANGUAGE_TYPE +
            '"] .remove-criterion-button'
        ) ||
        clickedTagRemove(clicked)
      ) {
        setChoice(EMPTY_SELECTION);
        setQuery("");
      }
    }

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  /**
   * The merge.
   *
   * It waits for the list's filter to become what Apply committed, and only then
   * writes.
   *
   * That wait is the whole of it. Apply commits the dialog's *copy*, and the
   * filter this component is rendered with is the list's, which becomes that copy
   * a commit later, when Stash's own hook re-reads the URL Apply wrote. Merging
   * before that writes a third filter — neither the one committed nor the one in
   * hand — and then the URL and the filter describe different things. Stash's URL
   * handling has no way back from that: its one reconciliation is "decode the URL,
   * take it as the filter, and re-encode it if the string differs", which cannot
   * tell a different filter from a correction, so the URL and the filter state go
   * on rewriting each other until React throws.
   *
   * Merging *after* the wait is safe for the opposite reason: what gets written
   * is then that same filter with only the language changed — exactly the string
   * Stash's own encoder would produce for it, which is the one thing its
   * reconciliation recognises as already agreeing. And it comes out right as
   * well: by then the filter holds everything else the dialog did, so a criterion
   * removed there stays removed.
   *
   * The wait is short and always ends: the model this component is handed is
   * replaced whenever the URL changes, because the criterion carries the Language
   * identity and so never compares equal to a freshly decoded one. If it somehow
   * does not arrive, the timer says so rather than merging later and wrongly.
   */
  const lastModel = React.useRef<MangaToolsFilterModel | null>(null);
  React.useEffect(() => {
    const model = props.filter;
    const previous = lastModel.current;
    lastModel.current = model;

    if (!applyPending.current) return;

    // Still waiting: the filter has not become what Apply committed yet. This is
    // checked on every render rather than once, because how many renders the wait
    // lasts is Stash's business — a fresh page has more of them, which is why the
    // first Apply after a reload is the one that used to miss.
    if (!previous || previous === model) return;

    applyPending.current = false;
    const unchanged = sameSelection(choice, readLanguageFilter(model));

    if (unchanged) return;

    const search = languageFilterQuery(model, choice);
    if (search === null) {
      console.error(
        "[mangaTools] this list has no custom-fields criterion, so the language filter could not be applied"
      );
      return;
    }

    // Stash reads the URL on every navigation, so this is the whole of it — the
    // same route the sidebar takes.
    history.replace(Object.assign({}, history.location, { search: search }));
  });

  // The dialog's tags, and what is left for the card to draw itself — see
  // manageDialogTags and ownTagLabels. The labels are the card's own, because the
  // dialog's row is the one that reports the working copy; an empty card has
  // nothing to say, which is what takes the tags away.
  //
  // Worked out above the effect that uses them rather than further down with the
  // rest of what the card draws: they were `var`s once and only reachable from
  // the effect because of hoisting, which is exactly the kind of thing that stops
  // being true the moment the declaration changes.
  const dialogTagLabels = isEmptySelection(choice)
    ? []
    : tagLabels(intl, { value: selectionConditions(choice) }) || [];
  const ownTags = ownTagLabels(dialogTagLabels);
  const ownTagsRow = ownTags.length ? dialogTagsRow() : null;

  /**
   * The dialog's tags, worded from the card — and its row taken away again when
   * the card has nothing of its own to draw.
   *
   * A layout effect rather than the render body because it writes to DOM React
   * owns; a layout effect runs after React has written that DOM and before the
   * browser paints, so the wording is still what the card's first paint shows. It
   * runs on every commit, which is what keeps the row up to date as the card is
   * edited, and every write in it is guarded on the value actually changing — so
   * a commit that has nothing to do leaves the DOM alone.
   */
  React.useLayoutEffect(() => {
    manageDialogTags(dialogTagLabels);
    if (!ownTagsRow) dropFallbackRow();
  });

  /**
   * What the card starts from, re-read from the filter each time the dialog opens.
   *
   * Stash snapshots the filter when its dialog mounts — `cloneDeep` in
   * EditFilterDialog, and a fresh dialog is mounted for every open — so its cards
   * always describe the filter as it stands. This component cannot do that by
   * existing: it is mounted for as long as the gallery list is, so its state
   * would otherwise go on describing whichever filter was in place when the page
   * first loaded.
   *
   * Once per dialog, counted rather than flagged, so opening the card, closing it
   * and opening it again cannot discard a selection that has not been applied
   * yet. A layout effect so the card's first paint already shows the right rows.
   */
  const sessionRef = React.useRef(0);
  const syncedRef = React.useRef(-1);
  React.useLayoutEffect(() => {
    if (!document.querySelector(".edit-filter-dialog")) {
      sessionRef.current += 1;
      syncedRef.current = -1;
      return;
    }

    if (syncedRef.current === sessionRef.current) return;
    syncedRef.current = sessionRef.current;

    // A functional update that hands back the state it was given when the
    // selection has not in fact moved, so this effect cannot ask for a re-render
    // it does not need — a setState in a layout effect is a synchronous render,
    // and one that changes nothing every time is a loop.
    const applied = readLanguageFilter(props.filter);
    setChoice((previous) =>
      sameSelection(previous, applied) ? previous : applied
    );
    setQuery("");
  });

  // What the list is drawn from, following the sidebar's rules: the enabled
  // languages setting limits the choices, and a value already in use stays
  // visible even if it has since been disabled.
  const options = NS.languageOptions(intl.locale).filter(
    (o) =>
      !NS.enabledLanguages ||
      NS.enabledLanguages.has(o.value) ||
      choice.included.indexOf(o.value) !== -1 ||
      choice.excluded.indexOf(o.value) !== -1
  );

  const needle = query.trim().toLowerCase();
  const matches = (o: MangaToolsOption) => {
    if (!needle) return true;
    return (
      o.label.toLowerCase().indexOf(needle) !== -1 ||
      o.value.toLowerCase().indexOf(needle) !== -1
    );
  };

  // Nothing to choose while (Any) or (None) is set: there is no particular value
  // to pick in those states, which is Stash's own rule for its lists.
  const selectable = choice.modifier ? [] : options;

  const chosen = selectable.filter(
    (o) => choice.included.indexOf(o.value) !== -1
  );
  const excludedChosen = selectable.filter(
    (o) => choice.excluded.indexOf(o.value) !== -1
  );
  const candidates = selectable.filter(
    (o) =>
      choice.included.indexOf(o.value) === -1 &&
      choice.excluded.indexOf(o.value) === -1 &&
      matches(o)
  );

  const showModifiers = isEmptySelection(choice);

  const flagFor = (o: MangaToolsOption): string | null =>
    NS.showFlags ? o.flag : null;

  // The card's box, which Stash renders only while the card is open.
  const box = dialogEditorBox();
  let host: Element | null = null;
  if (box) {
    host = box.querySelector("." + DIALOG_HOST_CLASS);
    if (!host) {
      host = document.createElement("div");
      host.className = DIALOG_HOST_CLASS;
      box.insertBefore(host, box.firstChild);
    }
  }

  const list = (
    <div className="manga-tools-dialog-card">
      <div className="selectable-filter">
        <div className="clearable-input-group">
          <input
            ref={searchRef}
            className="clearable-text-field form-control"
            value={query}
            placeholder={message(intl, "actions.search", "Search") + "…"}
            onChange={(e: { target: { value: string } }) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e: { key?: string }) => {
              if (e.key === "Escape") {
                if (searchRef.current) searchRef.current.blur();
                return;
              }

              // Enter takes the one value left, as Stash's own list does.
              if (e.key !== "Enter" || candidates.length !== 1) return;
              setChoice(toggleIncluded(choice, candidates[0].value));
              setQuery("");
            }}
          />
        </div>
        <ul>
          {choice.modifier ? (
            <LanguageRow
              variant="dialog"
              modifier
              state="included"
              label={
                choice.modifier === "any"
                  ? message(intl, "criterion_modifier_values.any", "Any")
                  : message(intl, "criterion_modifier_values.none", "None")
              }
              onClick={() => {
                setChoice(withoutModifier(choice));
              }}
            />
          ) : null}
          {chosen.map((o) => (
            <LanguageRow
              key={"in-" + o.value}
              variant="dialog"
              state="included"
              label={o.label}
              flag={flagFor(o)}
              onClick={() => {
                setChoice(toggleIncluded(choice, o.value));
              }}
            />
          ))}
          {excludedChosen.map((o) => (
            <li key={"ex-" + o.value} className="excluded-object">
              <LanguageRow
                variant="dialog"
                state="excluded"
                label={o.label}
                flag={flagFor(o)}
                onClick={() => {
                  setChoice(toggleExcluded(choice, o.value));
                }}
              />
            </li>
          ))}
          {showModifiers ? (
            <LanguageRow
              variant="dialog"
              modifier
              state="candidate"
              canExclude={false}
              label={message(intl, "criterion_modifier_values.any", "Any")}
              onClick={() => {
                setChoice(withModifier(choice, "any"));
              }}
            />
          ) : null}
          {showModifiers ? (
            <LanguageRow
              variant="dialog"
              modifier
              state="candidate"
              canExclude={false}
              label={message(intl, "criterion_modifier_values.none", "None")}
              onClick={() => {
                setChoice(withModifier(choice, "none"));
              }}
            />
          ) : null}
          {candidates.map((o) => (
            <LanguageRow
              key={o.value}
              variant="dialog"
              state="candidate"
              label={o.label}
              flag={flagFor(o)}
              canExclude
              onClick={() => {
                setChoice(toggleIncluded(choice, o.value));
              }}
              onExclude={() => {
                setChoice(toggleExcluded(choice, o.value));
              }}
            />
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <>
      {host ? PluginApi.ReactDOM.createPortal(list, host) : null}
      {/* And, when the card has something Stash has no tag for, the tags of its
          own — one per condition, in the place Stash's would have been. */}
      {ownTagsRow
        ? PluginApi.ReactDOM.createPortal(
            ownTags.map((label, index) => (
              <LanguageTag
                key={index}
                label={label}
                onRemove={() => {
                  setChoice(EMPTY_SELECTION);
                  setQuery("");
                }}
              />
            )),
            ownTagsRow
          )
        : null}
    </>
  );
}

/**
 * Finds (creating if needed) the mount point for the language section,
 * positioned as the first of the sidebar's filter sections.
 *
 * Anchored on `.sidebar-saved-filters`, which Stash renders whether or not the
 * user has any saved filters and which sits directly above the pinned-criteria
 * sections — the position its own studio section occupies. One class rather
 * than two: it appears exactly once, and a single class is what this plugin's
 * other anchors use.
 *
 * Mirrors ensureHostAfter in mangaTools.tsx rather than sharing it: the two live
 * in different modules, and extracting the helper would mean moving code out of
 * the entry file in the same change that adds a feature. Worth doing when a
 * third caller appears.
 */
function ensureFilterHost(): HTMLElement | null {
  const anchor = document.querySelector(".sidebar-saved-filters");
  if (!anchor?.parentNode) {
    filterHost = null;
    return null;
  }

  if (!filterHost) {
    filterHost = document.createElement("div");
    filterHost.className = FILTER_HOST_CLASS;
  }

  // A React re-render may displace it; keep it directly after the anchor.
  if (
    filterHost.parentNode !== anchor.parentNode ||
    anchor.nextElementSibling !== filterHost
  ) {
    anchor.parentNode.insertBefore(filterHost, anchor.nextElementSibling);
  }

  return filterHost;
}

/**
 * The gallery list's language filter, rendered through a portal into the
 * sidebar.
 *
 * Reads the current selection from the filter model it is handed, and reports
 * changes by rewriting the URL — see applyLanguage for why that is the route in.
 *
 * It also repairs the two things about the filter that belong to Stash and that
 * this plugin has to make say what they mean: the criterion's identity and its
 * tag. Both are in a layout effect below.
 */
export function SidebarLanguageFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const history = PluginApi.libraries.ReactRouterDOM.useHistory();

  // Read during the render rather than restored in an effect, so the first paint
  // already has the right answer. Stash restores its sections in a `useEffect`,
  // which is why they can appear to jump on a reload; there is no need to copy
  // that part.
  const openState = React.useState<boolean>(() => {
    const state = history.location.state;
    const stored = state ? state[SECTION_STATE_KEY] : undefined;
    return typeof stored === "boolean" ? stored : false;
  });
  const open = openState[0];
  const setOpen = openState[1];

  const queryState = React.useState("");
  const query = queryState[0];
  const setQuery = queryState[1];

  /** The search box, so focus can be put back into it after a change */
  const searchRef = React.useRef<HTMLInputElement | null>(null);

  // A React re-render can drop the mount point, and the first render never finds
  // it: this component is a sibling rendered before the list that owns the
  // sidebar, so the anchor's element does not exist yet. One extra pass fixes it.
  //
  // A layout effect, so the extra pass is flushed after React writes the DOM but
  // before the browser paints — which means this correction adds no visible step
  // of its own. It does not remove the brief flash the section still shows on
  // load; that has another cause, not identified. See the README.
  const bump = React.useState(0)[1];
  const host = ensureFilterHost();

  const selection = readLanguageFilter(props.filter);

  // Stash's tags for this criterion, re-worded as this plugin words them. Only
  // for a criterion that is wholly ours: a hand-built one that carries another
  // field as well keeps Stash's wording, which says everything it holds, rather
  // than labels that would hide the rest.
  const criterion = languageCriterionOf(props.filter);
  const tagLabelsFor = criterion ? tagLabels(intl, criterion) : null;

  // Both of the repairs to the filter Stash owns live here, in the one surface
  // that is mounted for as long as the list is: the criterion is handed over to
  // Stash's controls (see adoptLanguageCriterion) and its tag is re-worded (see
  // relabelTags). Every change to the filter decodes into fresh criterion
  // objects, so both are repeated on each commit.
  React.useLayoutEffect(() => {
    adoptLanguageCriterion(props.filter);
    if (tagLabelsFor) relabelTags(tagLabelsFor);

    if (ensureFilterHost() !== host) {
      bump((v) => v + 1);
    }
  });

  if (!host) return null;

  const Bootstrap = PluginApi.libraries.Bootstrap;
  if (!Bootstrap) {
    console.error(
      "[mangaTools] react-bootstrap not available, cannot draw the language filter"
    );
    return null;
  }

  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;

  function update(next: MangaToolsLanguageSelection) {
    applyLanguage(props.filter, history, next);

    // Every change funnels through here, which is this component's equivalent of
    // Stash's selectHook and unselectHook both ending in setInputFocus(): the
    // cursor stays in the box so a second language can be typed straight away.
    if (!isTouchDevice() && searchRef.current) {
      searchRef.current.focus();
    }
  }

  // Thin wrappers around the shared operations, which are what actually define
  // what a click means — the dialog's card uses the same ones, so the two
  // surfaces cannot drift apart.
  function toggleInclude(code: string) {
    update(toggleIncluded(selection, code));
  }

  function toggleExclude(code: string) {
    update(toggleExcluded(selection, code));
  }

  // Two actions, not one, exactly as Stash has them: picking a modifier entry
  // sets it (its onSelect), and clicking the same entry once it sits in the
  // chosen list takes it back to the default (its onUnselect — which sets the
  // modifier back rather than toggling, so it cannot be reached from here).
  function setModifier(modifier: "any" | "none") {
    update(withModifier(selection, modifier));
  }

  function clearModifier() {
    update(withoutModifier(selection));
  }

  // The same "enabled languages" setting that limits the edit dropdown limits
  // what can be filtered on, so the two never disagree about which languages
  // this library uses. A value already in use stays visible even if it has since
  // been disabled, since otherwise the list would be filtered by something
  // invisible.
  const options = NS.languageOptions(intl.locale).filter(
    (o) =>
      !NS.enabledLanguages ||
      NS.enabledLanguages.has(o.value) ||
      selection.included.indexOf(o.value) !== -1 ||
      selection.excluded.indexOf(o.value) !== -1
  );

  // No candidates while (Any) or (None) is chosen: there is no particular value
  // to pick in those states. That is Stash's own rule — its useCandidates returns
  // an empty list for IsNull and NotNull — and it is why choosing (None) in the
  // studio filter makes the studio list disappear. The search box stays, standing
  // over nothing, exactly as it does there.
  const selectable = selection.modifier ? [] : options;

  /** What the reader typed, against both the name and the code */
  const needle = query.trim().toLowerCase();
  const matches = (o: MangaToolsOption) => {
    if (!needle) return true;
    return (
      o.label.toLowerCase().indexOf(needle) !== -1 ||
      o.value.toLowerCase().indexOf(needle) !== -1
    );
  };

  const chosen = options.filter(
    (o) => selection.included.indexOf(o.value) !== -1
  );
  const excludedChosen = options.filter(
    (o) => selection.excluded.indexOf(o.value) !== -1
  );
  const candidates = selectable.filter(
    (o) =>
      selection.included.indexOf(o.value) === -1 &&
      selection.excluded.indexOf(o.value) === -1 &&
      matches(o)
  );

  const flagFor = (o: MangaToolsOption): string | null =>
    NS.showFlags ? o.flag : null;

  /**
   * Opens or closes the section, and records the choice where Stash records its
   * own — so it survives a reload, which is what makes the section feel like it
   * remembers rather than resetting every time.
   *
   * Deliberately *not* opened just because the filter is set. Stash does no such
   * thing — nothing in it writes a section's open state except the reader's own
   * click — and deriving it here would both diverge and flicker, since a filter
   * arriving from the URL is known a render later than the first paint.
   */
  function toggleOpen() {
    const next = !open;
    setOpen(next);
    history.replace(
      Object.assign({}, history.location, {
        state: Object.assign({}, history.location.state, {
          [SECTION_STATE_KEY]: next,
        }),
      })
    );
  }

  // (Any) and (None) are the two states a language field can be in before any
  // particular language is chosen, so Stash offers them only while nothing is
  // chosen — confirmed against a real section, where choosing two studios and
  // excluding a third left just the one hierarchical entry and neither of
  // these. Once one is picked it shows above, in the chosen list.
  const showModifiers =
    !selection.modifier &&
    !selection.included.length &&
    !selection.excluded.length;

  // The section above the fold-away list: whatever is being asked for, in the
  // same "selected-object" shape as a chosen studio. The modifier entries are
  // shown in parentheses, exactly as Stash labels its own.
  const chosenItems: ReactElement[] = [];
  if (selection.modifier) {
    chosenItems.push(
      <li className="selected-object modifier-object" key="modifier">
        <a tabIndex={0} onClick={clearModifier}>
          <div className="label-group">
            <Icon className="fa-fw include-button" icon={Solid.faCheckCircle} />
            <span className="TruncatedText inline selected-object-label">
              {"(" +
                message(
                  intl,
                  "criterion_modifier_values." + selection.modifier,
                  selection.modifier === "any" ? "Any" : "None"
                ) +
                ")"}
            </span>
          </div>
        </a>
      </li>
    );
  }
  chosen.forEach((o) => {
    chosenItems.push(
      <LanguageRow
        variant="sidebar"
        key={"in-" + o.value}
        label={o.label}
        flag={flagFor(o)}
        state="included"
        onClick={() => {
          toggleInclude(o.value);
        }}
      />
    );
  });

  const section = (
    <div className="sidebar-section sidebar-list-filter">
      <div className="collapse-header">
        <Bootstrap.Button
          onClick={toggleOpen}
          className="minimal collapse-button"
        >
          <Icon
            icon={open ? Solid.faChevronDown : Solid.faChevronRight}
            fixedWidth
          />
          <span>{fieldLabel(intl)}</span>
        </Bootstrap.Button>
      </div>

      {/* Outside the collapse, like Stash's own sections: what is selected stays
          visible even when the list of choices is folded away. */}
      {chosenItems.length ? (
        <ul className="selected-list">{chosenItems}</ul>
      ) : null}
      {excludedChosen.length ? (
        <ul className="selected-list excluded-list">
          {excludedChosen.map((o) => (
            <LanguageRow
              variant="sidebar"
              key={"ex-" + o.value}
              label={o.label}
              flag={flagFor(o)}
              state="excluded"
              onClick={() => {
                toggleExclude(o.value);
              }}
            />
          ))}
        </ul>
      ) : null}

      <Bootstrap.Collapse in={open} mountOnEnter unmountOnExit>
        <div>
          <div className="queryable-candidate-list">
            {/* Stash searches its candidates server-side and debounces the input;
                these fourteen are already in memory, so filtering is immediate. */}
            <div className="clearable-input-group">
              <input
                ref={searchRef}
                className="clearable-text-field form-control"
                value={query}
                placeholder={message(intl, "actions.search", "Search") + "…"}
                onChange={(e: { target: { value: string } }) => {
                  setQuery(e.target.value);
                }}
                onKeyDown={(e: { key?: string }) => {
                  // Enter takes the one candidate the search has narrowed to,
                  // as Stash's onEnter does. Deliberately the candidates rather
                  // than the modifier entries listed above them, which is what
                  // Stash does too.
                  if (e.key !== "Enter" || candidates.length !== 1) return;
                  toggleInclude(candidates[0].value);
                  setQuery("");
                }}
              />
              {query ? (
                <Bootstrap.Button
                  // "secondary", not the react-bootstrap default of "primary":
                  // Stash's ClearableInput asks for secondary, and the primary
                  // button paints this one with a solid blue background that
                  // Stash's own .clearable-text-field-clear does not undo.
                  variant="secondary"
                  className="clearable-text-field-clear"
                  title={message(intl, "actions.clear", "Clear")}
                  onClick={() => {
                    setQuery("");
                  }}
                >
                  <Icon icon={Solid.faTimes} />
                </Bootstrap.Button>
              ) : null}
            </div>
            <ul>
              {showModifiers ? (
                <LanguageRow
                  variant="sidebar"
                  label={
                    "(" +
                    message(intl, "criterion_modifier_values.any", "Any") +
                    ")"
                  }
                  state="candidate"
                  modifier
                  canExclude={false}
                  onClick={() => {
                    setModifier("any");
                  }}
                />
              ) : null}
              {showModifiers ? (
                <LanguageRow
                  variant="sidebar"
                  label={
                    "(" +
                    message(intl, "criterion_modifier_values.none", "None") +
                    ")"
                  }
                  state="candidate"
                  modifier
                  canExclude={false}
                  onClick={() => {
                    setModifier("none");
                  }}
                />
              ) : null}
              {candidates.map((o) => (
                <LanguageRow
                  variant="sidebar"
                  key={o.value}
                  label={o.label}
                  flag={flagFor(o)}
                  state="candidate"
                  canExclude
                  onClick={() => {
                    toggleInclude(o.value);
                    setQuery("");
                  }}
                  onExclude={() => {
                    toggleExclude(o.value);
                    setQuery("");
                  }}
                />
              ))}
            </ul>
          </div>
        </div>
      </Bootstrap.Collapse>
    </div>
  );

  return PluginApi.ReactDOM.createPortal(section, host);
}
