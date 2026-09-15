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
 * The two modifier entries the dialog's dropdown offers alongside the languages.
 * Not language codes — those are all two letters or a script subtag — so one
 * namespace does for both, and a choice is just a string.
 */
var MODIFIER_ANY = "any";
var MODIFIER_NONE = "none";

/** Class of the box the dialog's picker is drawn in, inside Stash's card */
var DIALOG_HOST_CLASS = "manga-tools-dialog-picker-host";

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
function setReactInputValue(input: HTMLInputElement, value: string): void {
  var descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  );
  if (!descriptor || !descriptor.set) return;

  descriptor.set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * The same for the modifier picker, which is a native <select> — and a select
 * reports through `change`, not `input`.
 */
function setReactSelectValue(select: HTMLSelectElement, value: string): void {
  var descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    "value"
  );
  if (!descriptor || !descriptor.set) return;

  descriptor.set.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Drops the language condition this plugin left here before.
 *
 * Stash's editor *appends* a condition every time its confirm button is pressed,
 * so replacing a language without this would leave two EQUALS conditions on one
 * field — which the backend ANDs, matching nothing at all.
 *
 * The criterion is Stash's and there is no handle on it, so the only way to drop
 * a condition is the remove button its own tag carries. Those tags are found by
 * the field name their label starts with: Stash's format string is
 * "{criterion} (custom field) …", and that criterion is the raw field name,
 * untranslated. Requiring the trailing space keeps a field called
 * original_language out of it.
 *
 * It reports what it found, because this is the one step that can only be
 * verified in a browser: if the console says the tags were not there, the class
 * names have moved and this is why a replaced language left two conditions.
 */
function dropPreviousConditions(editor: Element): void {
  // Look in the editor first, then anywhere in the card: Stash's own layout puts
  // the tags beside the editor inside a Form.Group, but that is a detail of its
  // markup rather than a promise, and guessing it wrong is silent.
  var card = editor.closest ? editor.closest(".card") : null;
  var scope: Element = editor;
  var containers = editor.querySelectorAll(".filter-tags");
  if (!containers.length && card) {
    scope = card;
    containers = card.querySelectorAll(".filter-tags");
  }

  var tags = scope.querySelectorAll(".filter-tags .tag-item");
  var removed = 0;
  for (var i = 0; i < tags.length; i++) {
    var text = tags[i].textContent || "";
    // Stash's format string is "{criterion} (custom field) …" and that criterion
    // is the raw field name, untranslated; the trailing space keeps a field
    // called original_language out of it.
    if (text.indexOf(NS.FIELD_NAME + " ") !== 0) continue;

    var remove = tags[i].querySelector("button");
    if (remove) {
      (remove as HTMLElement).click();
      removed++;
    }
  }

  // Said out loud because this is the one step that cannot be verified anywhere
  // but a browser, and getting it wrong leaves two conditions on one field —
  // which the backend ANDs, matching nothing at all. If a replaced language
  // leaves two conditions behind, this line says why.
  console.info(
    "[mangaTools] language conditions: " +
      tags.length +
      " tag(s) in scope, " +
      removed +
      " removed (" +
      containers.length +
      " filter-tags container(s), scoped to " +
      (scope === editor ? "the editor" : "the card") +
      ")"
  );
}
/** Presses the editor's confirm button, once its state has caught up */
function pressConfirm(editor: Element): void {
  // `onConfirm` reads the editor's state, and the events above have only queued
  // updates to it. Clicking in the same tick would submit the empty form.
  window.setTimeout(function () {
    var confirm = editor.querySelector(
      ".custom-field-filter-buttons button.btn-success"
    );
    if (confirm) (confirm as HTMLElement).click();
  }, 0);
}

/**
 * Puts a choice into Stash's criterion by driving Stash's own editor.
 *
 * Driving rather than reimplementing is the whole point. The dialog hands the
 * callback that actually inserts a criterion — `replaceCriterion` — to whichever
 * editor component it picks, and that is the only place the callback goes. So the
 * criterion has to remain a real custom-field one, and the way to give it a value
 * from outside is its own controls. Everything downstream then behaves as if the
 * value had been typed: the criterion is committed, the tag appears above, and
 * Apply and Cancel work because Stash is the one committing.
 *
 * `choice` is a language code, one of the two modifier entries, or null to leave
 * the criterion with nothing at all — which is also how the criterion gets
 * removed, since an empty one fails isValid() and the dialog drops it.
 *
 * The field and value inputs are found by `form-control`, which Form.Control
 * always sets and the react-select beside them does not — so the pair is
 * unambiguous, and in source order: field first, value second. The value input is
 * absent while a modifier is chosen that takes no value, which is why it is the
 * field alone that is required.
 */
function commitThroughStashEditor(
  editor: Element,
  choice: string | null
): boolean {
  var inputs = editor.querySelectorAll("input.form-control");
  var picker = editor.querySelector("select.modifier-selector");
  if (choice !== null && (!inputs.length || !picker)) return false;

  dropPreviousConditions(editor);
  if (choice === null) return true;

  var isModifier = choice === MODIFIER_ANY || choice === MODIFIER_NONE;

  setReactSelectValue(picker as HTMLSelectElement, isModifier ? choice : "EQUALS");
  setReactInputValue(inputs[0] as HTMLInputElement, NS.FIELD_NAME);
  if (!isModifier) setReactInputValue(inputs[1] as HTMLInputElement, choice);

  pressConfirm(editor);
  return true;
}

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

/**
 * react-select, looked up at runtime — a copy of the edit page's, because that
 * one lives in the entry module and importing it back would be a cycle.
 */
var DIALOG_SELECT: any = null;

function resolveSelect(): any {
  if (DIALOG_SELECT) return DIALOG_SELECT;

  var RS = PluginApi.libraries.ReactSelect;
  if (!RS) {
    console.error("[mangaTools] react-select not available");
    return null;
  }

  DIALOG_SELECT = RS.default || RS.Select || RS;
  return DIALOG_SELECT;
}

/** A dropdown option: flag plus localised name, the same renderer the edit page uses */
function formatLanguageOption(option: MangaToolsOption) {
  return (
    <span className="manga-tools-option">
      {NS.showFlags && option.flag ? (
        <Flag flag={option.flag} className="manga-tools-flag" />
      ) : null}
      <span>{option.label}</span>
    </span>
  );
}

/**
 * The value picker inside the filter dialog's card.
 *
 * A dropdown, deliberately, where its neighbours are lists. The criterion
 * underneath is a custom-field one and Stash's editor gives it a single value, so
 * one language is all it can hold; a list of checkboxes would promise several and
 * deliver one. The sidebar owns the multi-value form of this filter — this card
 * is the way in for someone already in the dialog.
 *
 * The value is Stash's, not ours: picking drives Stash's own editor, which is the
 * only thing that can commit a criterion here.
 */
export function DialogLanguageFilter(props: {
  filter: MangaToolsFilterModel;
}) {
  var intl = PluginApi.libraries.Intl.useIntl();
  var Select = resolveSelect();

  var bumpState = React.useState(0);
  var bump = bumpState[1];

  // Read once from the filter the dialog opened with: Stash's editor resets to a
  // blank row after its confirm button is pressed — the value moves into a tag
  // above — so it cannot be read back afterwards.
  var choiceState = React.useState<string | null>(function () {
    var current = readLanguageFilter(props.filter);
    if (current.modifier) return current.modifier;
    if (current.included.length) return current.included[0];
    if (current.excluded.length) return current.excluded[0];
    return null;
  });
  var choice = choiceState[0];
  var setChoice = choiceState[1];

  /**
   * Two moments have to be noticed and neither is ours: opening the card, and
   * clearing it with the ✗ on its header — both are clicks inside the dialog.
   * The tick lets Stash finish writing the box before it is looked for.
   */
  React.useEffect(function () {
    function onClick(event: Event) {
      var clicked = event.target as Element | null;
      if (!clicked || typeof clicked.closest !== "function") return;
      if (!clicked.closest(".edit-filter-dialog")) return;

      // Aliased so the type survives into the callback below: narrowing a
      // captured variable does not carry into a closure.
      var target = clicked;
      window.setTimeout(function () {
        // Clearing the criterion from somewhere else — the ✗ on our card, or the
        // ✗ on the tag Stash renders for it — happens without telling anyone, and
        // the dropdown would otherwise go on showing a value that is no longer
        // filtering anything. Both are clicks inside our card.
        if (
          target.closest(
            '[data-type="' + LANGUAGE_TYPE + '"] .remove-criterion-button'
          )
        ) {
          setChoice(null);
        }

        var tag = target.closest(".tag-item");
        if (tag && (tag.textContent || "").indexOf(NS.FIELD_NAME + " ") === 0) {
          setChoice(null);
        }
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

  var found = dialogEditorBox();
  if (!found) return null;

  // Aliased so the type survives into the callback below: narrowing a captured
  // variable does not carry into a closure.
  var box = found;

  var modifiers: MangaToolsOption[] = [
    {
      value: MODIFIER_ANY,
      label: message(intl, "criterion_modifier_values.any", "Any"),
      flag: null,
    },
    {
      value: MODIFIER_NONE,
      label: message(intl, "criterion_modifier_values.none", "None"),
      flag: null,
    },
  ];

  var options: MangaToolsOption[] = modifiers.concat(
    NS.languageOptions(intl.locale).filter(function (o) {
      return !NS.enabledLanguages || NS.enabledLanguages.has(o.value);
    })
  );

  var chosen: MangaToolsOption | null = null;
  for (var i = 0; i < options.length; i++) {
    if (options[i].value === choice) chosen = options[i];
  }

  // Ahead of everything Stash renders here, so the picker sits above the row of
  // condition tags rather than under it.
  var host = box.querySelector("." + DIALOG_HOST_CLASS);
  if (!host) {
    host = document.createElement("div");
    host.className = DIALOG_HOST_CLASS;
    box.insertBefore(host, box.firstChild);
  }

  return PluginApi.ReactDOM.createPortal(
    <div className="manga-tools-dialog-picker">
      {Select ? (
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          isClearable
          isSearchable={false}
          // The dialog scrolls, so the menu has to escape it.
          menuPortalTarget={document.body}
          placeholder={fieldLabel(intl)}
          value={chosen}
          options={options}
          formatOptionLabel={formatLanguageOption}
          components={{ IndicatorSeparator: () => null }}
          onChange={function (opt: MangaToolsOption | null) {
            var next = opt ? opt.value : null;

            if (!commitThroughStashEditor(box, next)) {
              console.error(
                "[mangaTools] could not reach Stash's filter editor, so the language cannot be set from here"
              );
              return;
            }

            // Adopted only once it was accepted, so the dropdown never claims a
            // value that Stash did not take.
            setChoice(next);
          }}
        />
      ) : null}
    </div>,
    host
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
 * One entry of the candidate list, or of one of the two selected lists.
 *
 * Mirrors SelectedItem/CandidateItem in Stash's SidebarListFilter, including the
 * details that carry meaning: a selected entry's tick becomes a cross on hover
 * (clicking removes it), and a candidate's exclude button stops the click from
 * bubbling into the row's own "include" handler.
 */
function LanguageItem(props: {
  label: string;
  flag?: string | null;
  state: "candidate" | "included" | "excluded";
  modifier?: boolean;
  canExclude?: boolean;
  onClick: () => void;
  onExclude?: () => void;
}) {
  var hover = React.useState(false);
  var hovered = hover[0];
  var setHovered = hover[1];

  var Solid = PluginApi.libraries.FontAwesomeSolid || {};
  var Regular = PluginApi.libraries.FontAwesomeRegular || {};
  var Icon = PluginApi.components.Icon;
  var Bootstrap = PluginApi.libraries.Bootstrap;

  var selected = props.state !== "candidate";
  var excluded = props.state === "excluded";

  function setHover(next: boolean) {
    return function () {
      setHovered(next);
    };
  }

  var icon;
  if (!selected) {
    icon = Solid.faPlus;
  } else if (hovered) {
    // Stash swaps the tick for a cross under the cursor, which is how it says
    // "clicking this takes it away again".
    icon = Regular.faTimesCircle || Solid.faTimesCircle;
  } else {
    icon = excluded ? Solid.faTimesCircle : Solid.faCheckCircle;
  }

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
        <div className="label-group">
          <Icon
            className={"fa-fw " + (excluded ? "exclude-icon" : "include-button")}
            icon={icon}
          />
          {props.flag ? <Flag flag={props.flag} /> : null}
          <span
            className={
              "TruncatedText inline " +
              (selected
                ? excluded
                  ? "excluded-object-label"
                  : "selected-object-label"
                : "unselected-object-label")
            }
          >
            {props.label}
          </span>
        </div>
        {/* Candidates carry this wrapper whether or not there is a button in it;
            the selected and excluded rows have no second column at all. */}
        {selected ? null : (
          <div>
            {props.canExclude && Bootstrap ? (
              <Bootstrap.Button
                className="minimal exclude-button"
                onClick={function (e: { stopPropagation: () => void }) {
                  e.stopPropagation();
                  if (props.onExclude) props.onExclude();
                }}
                onKeyDown={function (e: { stopPropagation: () => void }) {
                  e.stopPropagation();
                }}
              >
                <span className="exclude-button-text">exclude</span>
                <Icon className="fa-fw exclude-icon" icon={Solid.faMinus} />
              </Bootstrap.Button>
            ) : null}
          </div>
        )}
      </a>
    </li>
  );
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

  /**
   * Clicking a chosen value removes it; clicking a candidate adds it.
   *
   * Several values at once, because that is what the studio filter this mirrors
   * allows — and because the backend unions them, so "Japanese or Traditional
   * Chinese" is one condition rather than a contradiction. The two lists are
   * mutually exclusive: a value moves between them rather than sitting in both,
   * which would send EQUALS and NOT_EQUALS for the same language and match
   * nothing at all.
   */
  function toggleInclude(code: string) {
    var already = selection.included.indexOf(code) !== -1;
    update({
      modifier: "",
      included: already
        ? selection.included.filter(function (c) {
            return c !== code;
          })
        : selection.included.concat([code]),
      excluded: selection.excluded.filter(function (c) {
        return c !== code;
      }),
    });
  }

  function toggleExclude(code: string) {
    var already = selection.excluded.indexOf(code) !== -1;
    update({
      modifier: "",
      included: selection.included.filter(function (c) {
        return c !== code;
      }),
      excluded: already
        ? selection.excluded.filter(function (c) {
            return c !== code;
          })
        : selection.excluded.concat([code]),
    });
  }

  // Two actions, not one, exactly as Stash has them: picking a modifier entry
  // sets it (its onSelect), and clicking the same entry once it sits in the
  // chosen list takes it back to the default (its onUnselect — which sets the
  // modifier back rather than toggling, so it cannot be reached from here).
  function setModifier(modifier: "any" | "none") {
    update({ modifier: modifier, included: [], excluded: [] });
  }

  function clearModifier() {
    update({ modifier: "", included: [], excluded: [] });
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
      <LanguageItem
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
              <LanguageItem
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
                <LanguageItem
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
                <LanguageItem
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
                  <LanguageItem
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
