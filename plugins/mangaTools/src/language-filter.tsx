/**
 * Manga Tools — filtering the gallery list by language.
 *
 * A "language" section in the gallery list's filter sidebar: pick a language and
 * the list narrows to it, in the same shape as Stash's own studio section.
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
 * WHY ONE LANGUAGE AT A TIME. The custom-fields criterion holds a list of
 * conditions, and Stash's own editor only ever gives one value to EQUALS — the
 * multi-value case is untested territory, and if those values were ANDed rather
 * than ORed, selecting two languages would silently return nothing. Single
 * selection cannot fail that way, and the alternative (two conditions on the
 * same field) would be ANDed by construction, since the criterion's list is a
 * conjunction.
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
} from "./plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
var React = PluginApi.React;

/** The `type` Stash's ListFilterOptions gives the custom-fields criterion */
var CUSTOM_FIELDS_TYPE = "custom_fields";

/** The modifier meaning "the field equals this value" */
var EQUALS = "EQUALS";

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

/** Is this condition about the language field? Field names are matched case-insensitively. */
function isLanguageCondition(condition: MangaToolsCustomFieldCondition): boolean {
  return (
    !!condition &&
    String(condition.field).toLowerCase() === NS.FIELD_NAME
  );
}

/**
 * The language the gallery list is currently filtered to, or "" for none.
 *
 * Read from the filter model rather than from the URL: the model is the decoded,
 * live form of exactly the same thing, and reading it needs no knowledge of how
 * Stash encodes the URL.
 */
function selectedLanguage(filter: MangaToolsFilterModel): string {
  var criterion = customFieldsCriterion(filter);
  if (!criterion) return "";

  var conditions = criterion.value || [];
  for (var i = 0; i < conditions.length; i++) {
    if (!isLanguageCondition(conditions[i])) continue;
    var values = conditions[i].value;
    if (values && values.length) return String(values[0]);
    return "";
  }
  return "";
}

/**
 * The query parameters for the filter with the language set to `code` (or
 * cleared, for ""). Returns null when the filter offers no custom-fields
 * criterion to attach it to.
 *
 * Everything else is left alone, including other custom-field conditions — the
 * language is merged into the existing criterion rather than replacing it, so a
 * language filter composes with a hand-made custom-field filter instead of
 * discarding it. Case variants of the field name are dropped on the way, so a
 * criterion a user typed as "Language" cannot end up holding two conditions for
 * one field and filtering everything out.
 *
 * The model is cloned because it is Stash's live state object; mutating it in
 * place would change the filter without telling anything to re-render.
 */
function languageFilterQuery(
  filter: MangaToolsFilterModel,
  code: string
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

  if (code) {
    kept.push({ field: NS.FIELD_NAME, modifier: EQUALS, value: [code] });
  }

  if (!kept.length) {
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
    criterion.value = kept;
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
 */
function applyLanguage(
  filter: MangaToolsFilterModel,
  history: MangaToolsHistory,
  code: string
): void {
  var search = languageFilterQuery(filter, code);
  if (search === null) {
    console.error(
      "[mangaTools] this list has no custom-fields filter, so the language filter is unavailable"
    );
    return;
  }

  history.replace(Object.assign({}, history.location, { search: search }));
}

// Published on the namespace alongside the rest of the plugin's pure logic, so
// the smoke tests can exercise the merge rules against a stub filter model
// without rendering anything.
NS.selectedFilterLanguage = selectedLanguage;
NS.filterLanguageQuery = languageFilterQuery;

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
 * One entry of the list. `selected` renders Stash's checked style, `candidate`
 * its "click to add" style — the same two states, and the same class names, as
 * SelectedItem/CandidateItem in its SidebarListFilter.
 *
 * The selected state swaps its icon for a cross on hover, which is how Stash
 * signals that clicking removes the entry rather than adding it.
 */
function LanguageItem(props: {
  name: string;
  flag: string | null;
  selected: boolean;
  onClick: () => void;
}) {
  var state = React.useState(false);
  var hovered = state[0];
  var setHovered = state[1];

  var Solid = PluginApi.libraries.FontAwesomeSolid || {};
  var Regular = PluginApi.libraries.FontAwesomeRegular || {};
  var Icon = PluginApi.components.Icon;

  var icon = props.selected
    ? hovered
      ? Regular.faTimesCircle || Solid.faTimesCircle
      : Solid.faCheckCircle
    : Solid.faPlus;

  function setHover(next: boolean) {
    return function () {
      setHovered(next);
    };
  }

  return (
    <li className={props.selected ? "selected-object" : "unselected-object"}>
      <a
        tabIndex={0}
        onClick={props.onClick}
        onMouseEnter={setHover(true)}
        onMouseLeave={setHover(false)}
        onFocus={setHover(true)}
        onBlur={setHover(false)}
      >
        <div className="label-group">
          <Icon className="fa-fw include-button" icon={icon} />
          {props.flag ? <Flag flag={props.flag} /> : null}
          <span
            className={
              "TruncatedText inline " +
              (props.selected
                ? "selected-object-label"
                : "unselected-object-label")
            }
          >
            {props.name}
          </span>
        </div>
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

  var state = React.useState(true);
  var open = state[0];
  var setOpen = state[1];

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

  var selected = selectedLanguage(props.filter);
  var options = NS.languageOptions(intl.locale).filter(function (o) {
    // Read-only restriction: the same "enabled languages" setting that limits
    // the edit dropdown limits what can be filtered on, so the two never
    // disagree about which languages this library uses. A language already
    // filtered on stays visible even if it has since been disabled.
    return !NS.enabledLanguages || NS.enabledLanguages.has(o.value) || o.value === selected;
  });

  var chosen = options.filter(function (o) {
    return o.value === selected;
  });
  var candidates = options.filter(function (o) {
    return o.value !== selected;
  });

  function select(code: string) {
    applyLanguage(props.filter, history, code === selected ? "" : code);
  }

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
      {chosen.length ? (
        <ul className="selected-list">
          {chosen.map(function (o) {
            return (
              <LanguageItem
                key={o.value}
                name={o.label}
                flag={NS.showFlags ? o.flag : null}
                selected
                onClick={function () {
                  select(o.value);
                }}
              />
            );
          })}
        </ul>
      ) : null}
      <Bootstrap.Collapse in={open} mountOnEnter unmountOnExit>
        <div>
          <div className="queryable-candidate-list">
            <ul>
              {candidates.map(function (o) {
                return (
                  <LanguageItem
                    key={o.value}
                    name={o.label}
                    flag={NS.showFlags ? o.flag : null}
                    selected={false}
                    onClick={function () {
                      select(o.value);
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
