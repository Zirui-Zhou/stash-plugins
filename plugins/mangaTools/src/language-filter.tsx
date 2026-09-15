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
 * Finds the filter's custom-fields criterion, if it has one.
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
    if (option && option.type === CUSTOM_FIELDS_TYPE) return criteria[i];
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

  var options = (filter.options && filter.options.criterionOptions) || [];
  var option = null;
  for (var i = 0; i < options.length; i++) {
    if (options[i].type === CUSTOM_FIELDS_TYPE) option = options[i];
  }
  if (!option) return null;

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
      criterion = option.makeCriterion();
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
function Flag(props: { flag: string }): ReactElement {
  return <span className={"fi fi-" + props.flag + " manga-tools-flag"} />;
}

/** Stash's own wording for the two list states, so nothing here reads as foreign */
function message(intl: MangaToolsIntl, id: string, fallback: string): string {
  return intl.formatMessage({ id: id, defaultMessage: fallback });
}

/** Class name of the section's mount point */
var FILTER_HOST_CLASS = "manga-tools-field-host";

/** The mount point, held at module scope so re-renders reuse the same node */
var filterHost: HTMLElement | null = null;

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

  var openState = React.useState(true);
  var open = openState[0];
  var setOpen = openState[1];

  var queryState = React.useState("");
  var query = queryState[0];
  var setQuery = queryState[1];

  // A browser re-render can drop the mount point; one extra pass restores it,
  // the same dance LanguageRow does for the edit page's field.
  var bump = React.useState(0)[1];
  var host = ensureFilterHost();

  React.useEffect(function () {
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

  function setModifier(modifier: "any" | "none") {
    update({
      modifier: selection.modifier === modifier ? "" : modifier,
      included: [],
      excluded: [],
    });
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
  var candidates = options.filter(function (o) {
    return (
      selection.included.indexOf(o.value) === -1 &&
      selection.excluded.indexOf(o.value) === -1 &&
      matches(o)
    );
  });

  var flagFor = function (o: MangaToolsOption): string | null {
    return NS.showFlags ? o.flag : null;
  };

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
        <a tabIndex={0} onClick={function () { setModifier(selection.modifier as "any"); }}>
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
        <Bootstrap.Button
          onClick={function () {
            setOpen(!open);
          }}
          className="minimal collapse-button"
        >
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
                className="clearable-text-field form-control"
                value={query}
                placeholder={message(intl, "actions.search", "Search") + "…"}
                onChange={function (e: { target: { value: string } }) {
                  setQuery(e.target.value);
                }}
              />
              {query ? (
                <Bootstrap.Button
                  className="clearable-text-field-clear"
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
                    }}
                    onExclude={function () {
                      toggleExclude(o.value);
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
