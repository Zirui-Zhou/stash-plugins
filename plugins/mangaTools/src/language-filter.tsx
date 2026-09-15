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
  MangaToolsOption,
} from "./plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
var React = PluginApi.React;

/** The `type` Stash's ListFilterOptions gives the custom-fields criterion */
var CUSTOM_FIELDS_TYPE = "custom_fields";

/**
 * The type this plugin registers its own criterion under, so the "edit filters"
 * dialog can offer a Language card of its own.
 *
 * Deliberately a different type from `custom_fields`, and deliberately not what
 * gets written to the URL — see registerLanguageCriterionOption.
 */
var LANGUAGE_TYPE = "language";

/**
 * What the section is currently asking for.
 *
 * `modifier` is "any" (galleries with a language), "none" (those without), or ""
 * when the include/exclude lists are what matter — matching how Stash's own
 * sidebar filter treats its modifier as one of several candidate values rather
 * than as a separate control.
 *
 * Either list may hold several codes: EQUALS unions them, so "Japanese or
 * Traditional Chinese" is one condition. A code appears in at most one of the
 * two lists, since EQUALS and NOT_EQUALS for the same language would be a
 * contradiction and match nothing.
 */
export interface MangaToolsLanguageSelection {
  modifier: "" | "any" | "none";
  included: string[];
  excluded: string[];
}

var EMPTY_SELECTION: MangaToolsLanguageSelection = {
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
  var options = filter && filter.options && filter.options.criterionOptions;
  if (!options) return;

  var found: MangaToolsCriterionOption | null = null;
  for (var i = 0; i < options.length; i++) {
    // Guarding on the array rather than a flag of our own: it is Stash's list
    // and it outlives this call, so asking it is both simpler and correct even
    // if Stash ever keeps more than one.
    if (options[i].type === LANGUAGE_TYPE) return;
    if (options[i].type === CUSTOM_FIELDS_TYPE) found = options[i];
  }
  if (!found) return;

  // Bound to a const so the closure below keeps the non-null type.
  var customFieldsOption = found;

  var option: MangaToolsCriterionOption = {
    type: LANGUAGE_TYPE,
    messageID: "config.ui.language.heading",
    makeCriterion: function () {
      // A real CustomFieldsCriterion, so CriterionEditor renders the editor
      // Stash wrote for it and the query it produces is the one the sidebar
      // already writes.
      var criterion = customFieldsOption.makeCriterion();

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
  var criteria = (filter && filter.criteria) || [];
  for (var i = 0; i < criteria.length; i++) {
    var option = criteria[i] && criteria[i].criterionOption;
    if (!option) continue;
    if (option.type === CUSTOM_FIELDS_TYPE || option.type === LANGUAGE_TYPE) {
      return criteria[i];
    }
  }
  return null;
}

/** Is this condition about the language field? Field names match case-insensitively. */
function isLanguageCondition(condition: MangaToolsCustomFieldCondition): boolean {
  return !!condition && String(condition.field).toLowerCase() === NS.FIELD_NAME;
}

/** The values of a condition, as codes */
function conditionValues(condition: MangaToolsCustomFieldCondition): string[] {
  var values = condition.value || [];
  return values.map(function (v) {
    return String(v);
  });
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
  var criterion = customFieldsCriterion(filter);
  if (!criterion || !criterion.value) return EMPTY_SELECTION;

  var selection: MangaToolsLanguageSelection = {
    modifier: "",
    included: [],
    excluded: [],
  };

  criterion.value.forEach(function (condition) {
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
  var already = selection.included.indexOf(code) !== -1;

  return {
    modifier: "",
    included: already
      ? selection.included.filter(function (c) {
          return c !== code;
        })
      : selection.included.concat([code]),
    // A language is included or excluded, never both: EQUALS and NOT_EQUALS for
    // one value is a contradiction and matches nothing.
    excluded: selection.excluded.filter(function (c) {
      return c !== code;
    }),
  };
}

/** The same, on the excluded side */
export function toggleExcluded(
  selection: MangaToolsLanguageSelection,
  code: string
): MangaToolsLanguageSelection {
  var already = selection.excluded.indexOf(code) !== -1;

  return {
    modifier: "",
    included: selection.included.filter(function (c) {
      return c !== code;
    }),
    excluded: already
      ? selection.excluded.filter(function (c) {
          return c !== code;
        })
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
  selection: MangaToolsLanguageSelection,
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
  return a.modifier === b.modifier &&
    sameCodes(a.included, b.included) &&
    sameCodes(a.excluded, b.excluded);
}

function sameCodes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;

  var x = a.slice().sort();
  var y = b.slice().sort();
  for (var i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

/**
 * The one-line description of a selection, in Stash's own words.
 *
 * Assembled from Stash's messages rather than written here, so a tag this plugin
 * draws reads exactly like one Stash draws — "Language is Japanese, English",
 * "Language is not null". That means the criterion's localised name and the
 * modifier's own label, which is also why (Any) comes out as "is not null": that
 * is what the modifier it produces means.
 */
export function selectionLabel(
  intl: MangaToolsIntl,
  selection: MangaToolsLanguageSelection
): string {
  var criterion = fieldLabel(intl);
  var names = function (codes: string[]): string {
    return codes
      .map(function (c) {
        return NS.name(c, intl.locale);
      })
      .join(", ");
  };

  if (selection.modifier) {
    return intl.formatMessage(
      { id: "criterion_modifier.format_string" },
      {
        criterion: criterion,
        modifierString: message(
          intl,
          selection.modifier === "any"
            ? "criterion_modifier.not_null"
            : "criterion_modifier.is_null",
          selection.modifier === "any" ? "is not null" : "is null"
        ),
        valueString: "",
      }
    );
  }

  return intl.formatMessage(
    {
      id: selection.excluded.length
        ? "criterion_modifier.format_string_excludes"
        : "criterion_modifier.format_string",
    },
    {
      criterion: criterion,
      modifierString: message(intl, "criterion_modifier.equals", "is"),
      valueString: names(selection.included),
      excludedString: names(selection.excluded),
    }
  );
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

  var conditions: MangaToolsCustomFieldCondition[] = [];
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
  var options = (filter.options && filter.options.criterionOptions) || [];
  var option: MangaToolsCriterionOption | null = null;
  for (var i = 0; i < options.length; i++) {
    if (options[i].type === CUSTOM_FIELDS_TYPE) option = options[i];
    if (options[i].type === LANGUAGE_TYPE) option = options[i];
  }
  if (!option) return null;
  var criterionOption = option;

  var next = filter.clone();
  var criterion = customFieldsCriterion(next);

  var kept: MangaToolsCustomFieldCondition[] = [];
  if (criterion && criterion.value) {
    for (var j = 0; j < criterion.value.length; j++) {
      if (!isLanguageCondition(criterion.value[j])) kept.push(criterion.value[j]);
    }
  }

  var conditions = kept.concat(selectionConditions(selection));

  if (!conditions.length) {
    // Nothing left to say: drop the criterion rather than leave an empty one,
    // which would show as a filter tag with no meaning.
    next.criteria = (next.criteria || []).filter(function (c) {
      return c !== criterion;
    });
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
  var search = languageFilterQuery(filter, selection);
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
NS.selectionLabel = selectionLabel;
NS.readLanguageFilter = readLanguageFilter;
NS.languageFilterQuery = languageFilterQuery;
NS.registerLanguageCriterionOption = registerLanguageCriterionOption;

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
var SECTION_STATE_KEY = "mangaToolsLanguageOpen";

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
var FILTER_HOST_CLASS = "manga-tools-field-host";

/** The mount point, held at module scope so re-renders reuse the same node */
var filterHost: HTMLElement | null = null;

/**
 * Sets a React-controlled input's value the way a person would.
 *
 * Assigning `input.value` directly does not reach React: its onChange is driven
 * by a value tracker that records the last value React wrote, and a plain
 * assignment updates that tracker too — so the change looks like no change.
 * Going through the prototype's setter leaves the tracker alone, and the
 * dispatched event then reads as real input.
 */
/**
 * Sets a React-controlled input's value the way a person would.
 *
 * Assigning `input.value` directly does not reach React: its onChange is driven
 * by a value tracker that records the last value React wrote, and a plain
 * assignment updates that tracker too — so the change looks like no change.
 * Going through the prototype's setter leaves the tracker alone, and the
 * dispatched event then reads as real input.
 */
/**
 * Sets a React-controlled input's value the way a person would.
 *
 * Assigning `input.value` directly does not reach React: its onChange is driven
 * by a value tracker that records the last value React wrote, and a plain
 * assignment updates that tracker too — so the change looks like no change.
 * Going through the prototype's setter leaves the tracker alone, and the
 * dispatched event then reads as real input.
 */
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
  var Solid = PluginApi.libraries.FontAwesomeSolid || {};
  var Regular = PluginApi.libraries.FontAwesomeRegular || {};
  var Icon = PluginApi.components.Icon;
  var Bootstrap = PluginApi.libraries.Bootstrap;
  var intl = PluginApi.libraries.Intl.useIntl();

  var hover = React.useState(false);
  var hovered = hover[0];
  var setHovered = hover[1];

  var selected = props.state !== "candidate";
  var excluded = props.state === "excluded";
  var sidebar = props.variant === "sidebar";

  function setHover(next: boolean) {
    return function () {
      setHovered(next);
    };
  }

  // A plus to add, a tick once added, a cross once excluded — and under the
  // cursor the tick or cross becomes a hollow cross, which is how Stash says
  // that clicking takes it away again.
  var icon = !selected
    ? Solid.faPlus
    : hovered
      ? Regular.faTimesCircle || Solid.faTimesCircle
      : excluded
        ? Solid.faTimesCircle
        : Solid.faCheckCircle;

  var labelClass = excluded
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
            className={"fa-fw " + (excluded ? "exclude-icon" : "include-button")}
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
                onClick={function (e: { stopPropagation: () => void }) {
                  e.stopPropagation();
                  if (props.onExclude) props.onExclude();
                }}
                onKeyDown={function (e: { stopPropagation: () => void }) {
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

/**
 * The tag for a language filter this plugin is holding.
 *
 * Stash draws a tag for every criterion it knows about, and it does not know
 * about ours until Apply writes it into the URL — so this draws the same thing
 * in the same markup: the row is a `wrap-tags filter-tags`, the tag a `tag-item
 * badge badge-secondary`, and the ✗ a `btn btn-secondary` holding an xmark. The
 * text comes from Stash's own messages too (see selectionLabel), so a tag drawn
 * here is indistinguishable from one drawn by Stash.
 */
function LanguageTag(props: { label: string; onRemove: () => void }) {
  var Solid = PluginApi.libraries.FontAwesomeSolid || {};
  var Icon = PluginApi.components.Icon;
  var Bootstrap = PluginApi.libraries.Bootstrap;

  // Deliberately no row around this. When it joins Stash's own row, a wrapper
  // would nest a second flex row inside it, and its margin would inflate the
  // height of the row Stash drew — which stretches the native badges sitting in
  // it and makes them look bigger. Only the fallback row, made below, is a row.
  return (
    <span className="tag-item badge badge-secondary">
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

/** Class of the box the dialog's card is drawn in, inside Stash's editor area */
var DIALOG_HOST_CLASS = "manga-tools-dialog-host";

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

/** Our own tag row, held so the same node is reused and can be taken away again */
var dialogTagsFallback: HTMLElement | null = null;

/**
 * Where a pending tag goes: beside the tags Stash draws for the criteria it
 * knows about, so the dialog has one place that answers "what is in this filter".
 *
 * That row is inside `.dialog-content` and outside `.criterion-list`, which is
 * the point — it is not inside a card, so closing the card cannot take our tag
 * away with it.
 *
 * It exists only while the dialog holds at least one criterion of its own (Stash
 * renders the row under `criteria.length > 0`), and a pending language is not
 * one of those yet, so sometimes there is no row to join and one has to be made.
 *
 * The search deliberately skips rows inside `.criterion-list`: a custom-fields
 * card draws a `.filter-tags` row of its own for its conditions, and joining
 * that one would put our tag inside a card — the very thing this avoids.
 */
function dialogTagsRow(): Element | null {
  var content = document.querySelector(".edit-filter-dialog .dialog-content");
  if (!content) {
    dropFallbackRow();
    return null;
  }

  var rows = content.querySelectorAll(".filter-tags");
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i].closest(".criterion-list")) {
      dropFallbackRow();
      return rows[i];
    }
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
  if (dialogTagsFallback && dialogTagsFallback.parentNode) {
    dialogTagsFallback.parentNode.removeChild(dialogTagsFallback);
  }
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
 * The cost is that Stash cannot show a tag for a selection it does not have yet,
 * so this draws its own — one in the card and one in the dialog's tag row, both
 * appearing only while the selection differs from what is applied.
 */
export function DialogLanguageFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  var intl = PluginApi.libraries.Intl.useIntl();
  var history = PluginApi.libraries.ReactRouterDOM.useHistory();

  var bumpState = React.useState(0);
  var bump = bumpState[1];

  // What is actually applied, read from the model on every render rather than
  // snapshotted once: Apply replaces the model, and a snapshot taken at mount
  // would go on describing the filter as it was before.
  var applied = readLanguageFilter(props.filter);

  // What the reader has chosen here. The two are compared to decide whether
  // there is anything pending — comparing sets, so picking a value and then
  // picking it again leaves no trace.
  var choiceState = React.useState<MangaToolsLanguageSelection>(applied);
  var choice = choiceState[0];
  var setChoice = choiceState[1];

  var queryState = React.useState("");
  var query = queryState[0];
  var setQuery = queryState[1];

  var searchRef = React.useRef<HTMLInputElement | null>(null);

  /**
   * Set when Apply is pressed, cleared once the merge has run.
   *
   * Deliberately not "the model changed": a filter changed from the sidebar
   * while this dialog happens to be open would otherwise have this card's
   * unapplied selection merged into it, which is not what pressing nothing
   * means.
   */
  var applyPending = React.useRef(false);
  var lastModel = React.useRef<MangaToolsFilterModel | null>(null);

  /**
   * Opening the card is Stash's own state change, inside the dialog, so this
   * component does not re-render with it. The moments that matter — opening the
   * card, or choosing it from a tag above — are both clicks inside the dialog.
   */
  React.useEffect(function () {
    function onClick(event: Event) {
      var clicked = event.target as Element | null;
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
        console.info("[mangaTools] Apply pressed");
      }

      window.setTimeout(function () {
        bump(function (v) {
          return v + 1;
        });
      }, 0);
    }

    document.addEventListener("click", onClick, true);
    return function () {
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  /**
   * The merge. Runs when the list's model changes — which is what Apply does —
   * and only then, so Cancel and an unrelated change both leave this alone.
   */
  React.useEffect(
    function () {
      var model = props.filter;
      if (lastModel.current === model) return;

      var previous = lastModel.current;
      lastModel.current = model;

      // Note there is deliberately no "the dialog has closed, so drop the flag"
      // here. Apply *closes the dialog* — that is what pressing it does — so
      // such a check would clear the flag in the one case it exists for, and the
      // merge would silently never run. (It did, for a while.)
      if (!previous || !applyPending.current) return;

      applyPending.current = false;
      var unchanged = sameSelection(choice, readLanguageFilter(model));

      // Every stage is reported, because this is the whole path that can only be
      // checked in a browser: if "Apply pressed" never appears the listener or
      // its selector is wrong; if it appears and this line does not, the filter
      // never changed and the merge had nothing to hook onto; if both appear, the
      // number below says whether there was anything to write.
      console.info(
        "[mangaTools] merge after Apply: unchanged=" +
          unchanged +
          ", included=" +
          choice.included.length +
          ", excluded=" +
          choice.excluded.length +
          ", modifier=" +
          JSON.stringify(choice.modifier)
      );

      if (unchanged) return;

      var search = languageFilterQuery(model, choice);
      if (search === null) {
        console.error(
          "[mangaTools] this list has no custom-fields criterion, so the language filter could not be applied"
        );
        return;
      }

      // Stash reads the URL on every navigation, so this is the whole of it —
      // the same route the sidebar takes. Logged separately from the decision
      // above, so a paste can tell "the merge ran and wrote" from "the merge ran
      // and Stash did not act on it".
      history.replace(Object.assign({}, history.location, { search: search }));
      console.info("[mangaTools] applied the language filter to the URL");
    },
    [props.filter, choice, history]
  );

  // What the list is drawn from, following the sidebar's rules: the enabled
  // languages setting limits the choices, and a value already in use stays
  // visible even if it has since been disabled.
  var options = NS.languageOptions(intl.locale).filter(function (o) {
    return (
      !NS.enabledLanguages ||
      NS.enabledLanguages.has(o.value) ||
      choice.included.indexOf(o.value) !== -1 ||
      choice.excluded.indexOf(o.value) !== -1
    );
  });

  var needle = query.trim().toLowerCase();
  var matches = function (o: MangaToolsOption) {
    if (!needle) return true;
    return (
      o.label.toLowerCase().indexOf(needle) !== -1 ||
      o.value.toLowerCase().indexOf(needle) !== -1
    );
  };

  // Nothing to choose while (Any) or (None) is set: there is no particular value
  // to pick in those states, which is Stash's own rule for its lists.
  var selectable = choice.modifier ? [] : options;

  var chosen = selectable.filter(function (o) {
    return choice.included.indexOf(o.value) !== -1;
  });
  var excludedChosen = selectable.filter(function (o) {
    return choice.excluded.indexOf(o.value) !== -1;
  });
  var candidates = selectable.filter(function (o) {
    return (
      choice.included.indexOf(o.value) === -1 &&
      choice.excluded.indexOf(o.value) === -1 &&
      matches(o)
    );
  });

  var showModifiers = isEmptySelection(choice);

  var flagFor = function (o: MangaToolsOption): string | null {
    return NS.showFlags ? o.flag : null;
  };

  // The card's box, which Stash renders only while the card is open. The tag is
  // *not* gated on it: the tag lives outside the card, and returning early here
  // is what used to make closing the card take the tag with it.
  var box = dialogEditorBox();
  var host: Element | null = null;
  if (box) {
    host = box.querySelector("." + DIALOG_HOST_CLASS);
    if (!host) {
      host = document.createElement("div");
      host.className = DIALOG_HOST_CLASS;
      box.insertBefore(host, box.firstChild);
    }
  }

  var pending = !sameSelection(choice, applied);
  var label = selectionLabel(intl, choice);

  var list = (
    <div className="manga-tools-dialog-card">
      <div className="selectable-filter">
        <div className="clearable-input-group">
          <input
            ref={searchRef}
            className="clearable-text-field form-control"
            value={query}
            placeholder={message(intl, "actions.search", "Search") + "…"}
            onChange={function (e: { target: { value: string } }) {
              setQuery(e.target.value);
            }}
            onKeyDown={function (e: { key?: string }) {
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
              onClick={function () {
                setChoice(withoutModifier(choice));
              }}
            />
          ) : null}
          {chosen.map(function (o) {
            return (
              <LanguageRow
                key={"in-" + o.value}
                variant="dialog"
                state="included"
                label={o.label}
                flag={flagFor(o)}
                onClick={function () {
                  setChoice(toggleIncluded(choice, o.value));
                }}
              />
            );
          })}
          {excludedChosen.map(function (o) {
            return (
              <li key={"ex-" + o.value} className="excluded-object">
                <LanguageRow
                  variant="dialog"
                  state="excluded"
                  label={o.label}
                  flag={flagFor(o)}
                  onClick={function () {
                    setChoice(toggleExcluded(choice, o.value));
                  }}
                />
              </li>
            );
          })}
          {showModifiers ? (
            <LanguageRow
              variant="dialog"
              modifier
              state="candidate"
              canExclude={false}
              label={message(intl, "criterion_modifier_values.any", "Any")}
              onClick={function () {
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
              onClick={function () {
                setChoice(withModifier(choice, "none"));
              }}
            />
          ) : null}
          {candidates.map(function (o) {
            return (
              <LanguageRow
                key={o.value}
                variant="dialog"
                state="candidate"
                label={o.label}
                flag={flagFor(o)}
                canExclude
                onClick={function () {
                  setChoice(toggleIncluded(choice, o.value));
                }}
                onExclude={function () {
                  setChoice(toggleExcluded(choice, o.value));
                }}
              />
            );
          })}
        </ul>
      </div>
      {pending ? (
        <LanguageTag
          label={label}
          onRemove={function () {
            setChoice(applied);
            setQuery("");
          }}
        />
      ) : null}
    </div>
  );

  var tagsRow = dialogTagsRow();

  return (
    <>
      {host ? PluginApi.ReactDOM.createPortal(list, host) : null}
      {/* Beside the tags Stash draws, and only while this one is still only
          ours — once Apply has written it to the URL, Stash draws its own. */}
      {pending && tagsRow
        ? PluginApi.ReactDOM.createPortal(
            <LanguageTag
              label={label}
              onRemove={function () {
                setChoice(applied);
              }}
            />,
            tagsRow
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
  var anchor = document.querySelector(".sidebar-saved-filters");
  if (!anchor || !anchor.parentNode) {
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
 */
export function SidebarLanguageFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  var intl = PluginApi.libraries.Intl.useIntl();
  var history = PluginApi.libraries.ReactRouterDOM.useHistory();

  // Read during the render rather than restored in an effect, so the first paint
  // already has the right answer. Stash restores its sections in a `useEffect`,
  // which is why they can appear to jump on a reload; there is no need to copy
  // that part.
  var openState = React.useState<boolean>(function () {
    var state = history.location.state;
    var stored = state ? state[SECTION_STATE_KEY] : undefined;
    return typeof stored === "boolean" ? stored : false;
  });
  var open = openState[0];
  var setOpen = openState[1];

  var queryState = React.useState("");
  var query = queryState[0];
  var setQuery = queryState[1];

  /** The search box, so focus can be put back into it after a change */
  var searchRef = React.useRef<HTMLInputElement | null>(null);

  // A React re-render can drop the mount point, and the first render never finds
  // it: this component is a sibling rendered before the list that owns the
  // sidebar, so the anchor's element does not exist yet. One extra pass fixes it.
  //
  // A layout effect, so the extra pass is flushed after React writes the DOM but
  // before the browser paints — which means this correction adds no visible step
  // of its own. It does not remove the brief flash the section still shows on
  // load; that has another cause, not identified. See the README.
  var bump = React.useState(0)[1];
  var host = ensureFilterHost();

  React.useLayoutEffect(function () {
    if (ensureFilterHost() !== host) {
      bump(function (v) {
        return v + 1;
      });
    }
  });

  if (!host) return null;

  var Bootstrap = PluginApi.libraries.Bootstrap;
  if (!Bootstrap) {
    console.error(
      "[mangaTools] react-bootstrap not available, cannot draw the language filter"
    );
    return null;
  }

  var Solid = PluginApi.libraries.FontAwesomeSolid || {};
  var Icon = PluginApi.components.Icon;

  var selection = readLanguageFilter(props.filter);

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
  var options = NS.languageOptions(intl.locale).filter(function (o) {
    return (
      !NS.enabledLanguages ||
      NS.enabledLanguages.has(o.value) ||
      selection.included.indexOf(o.value) !== -1 ||
      selection.excluded.indexOf(o.value) !== -1
    );
  });

  // No candidates while (Any) or (None) is chosen: there is no particular value
  // to pick in those states. That is Stash's own rule — its useCandidates returns
  // an empty list for IsNull and NotNull — and it is why choosing (None) in the
  // studio filter makes the studio list disappear. The search box stays, standing
  // over nothing, exactly as it does there.
  var selectable = selection.modifier ? [] : options;

  /** What the reader typed, against both the name and the code */
  var needle = query.trim().toLowerCase();
  var matches = function (o: MangaToolsOption) {
    if (!needle) return true;
    return (
      o.label.toLowerCase().indexOf(needle) !== -1 ||
      o.value.toLowerCase().indexOf(needle) !== -1
    );
  };

  var chosen = options.filter(function (o) {
    return selection.included.indexOf(o.value) !== -1;
  });
  var excludedChosen = options.filter(function (o) {
    return selection.excluded.indexOf(o.value) !== -1;
  });
  var candidates = selectable.filter(function (o) {
    return (
      selection.included.indexOf(o.value) === -1 &&
      selection.excluded.indexOf(o.value) === -1 &&
      matches(o)
    );
  });

  var flagFor = function (o: MangaToolsOption): string | null {
    return NS.showFlags ? o.flag : null;
  };

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
    var next = !open;
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
  var showModifiers =
    !selection.modifier && !selection.included.length && !selection.excluded.length;

  // The section above the fold-away list: whatever is being asked for, in the
  // same "selected-object" shape as a chosen studio. The modifier entries are
  // shown in parentheses, exactly as Stash labels its own.
  var chosenItems: ReactElement[] = [];
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
  chosen.map(function (o) {
    chosenItems.push(
      <LanguageRow
                variant="sidebar"
        key={"in-" + o.value}
        label={o.label}
        flag={flagFor(o)}
        state="included"
        onClick={function () {
          toggleInclude(o.value);
        }}
      />
    );
  });

  var section = (
    <div className="sidebar-section sidebar-list-filter">
      <div className="collapse-header">
        <Bootstrap.Button onClick={toggleOpen} className="minimal collapse-button">
          <Icon icon={open ? Solid.faChevronDown : Solid.faChevronRight} fixedWidth />
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
          {excludedChosen.map(function (o) {
            return (
              <LanguageRow
                variant="sidebar"
                key={"ex-" + o.value}
                label={o.label}
                flag={flagFor(o)}
                state="excluded"
                onClick={function () {
                  toggleExclude(o.value);
                }}
              />
            );
          })}
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
                onChange={function (e: { target: { value: string } }) {
                  setQuery(e.target.value);
                }}
                onKeyDown={function (e: { key?: string }) {
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
                  onClick={function () {
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
                  label={"(" + message(intl, "criterion_modifier_values.any", "Any") + ")"}
                  state="candidate"
                  modifier
                  canExclude={false}
                  onClick={function () {
                    setModifier("any");
                  }}
                />
              ) : null}
              {showModifiers ? (
                <LanguageRow
                variant="sidebar"
                  label={"(" + message(intl, "criterion_modifier_values.none", "None") + ")"}
                  state="candidate"
                  modifier
                  canExclude={false}
                  onClick={function () {
                    setModifier("none");
                  }}
                />
              ) : null}
              {candidates.map(function (o) {
                return (
                  <LanguageRow
                variant="sidebar"
                    key={o.value}
                    label={o.label}
                    flag={flagFor(o)}
                    state="candidate"
                    canExclude
                    onClick={function () {
                      toggleInclude(o.value);
                      setQuery("");
                    }}
                    onExclude={function () {
                      toggleExclude(o.value);
                      setQuery("");
                    }}
                  />
                );
              })}
            </ul>
          </div>
        </div>
      </Bootstrap.Collapse>
    </div>
  );

  return PluginApi.ReactDOM.createPortal(section, host);
}
