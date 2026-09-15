/**
 * Manga Tools — a toolbox that adapts Stash galleries to manga/comic management.
 *
 * Everything goes through the UI plugin API; no Stash core code is modified, so
 * Stash upgrades never produce merge conflicts.
 *
 * The language attribute lives in the Gallery's custom fields
 * (custom_fields.language). What is stored is the canonical code, not the
 * display name, and the name is looked up only when rendering — the same
 * approach Stash takes for performer nationality. It surfaces in five places:
 *
 *   - a flag badge on the bottom of the gallery card cover
 *   - a dropdown on the gallery edit page, so you never type a code by hand
 *   - the same dropdown in the bulk edit dialog, riding along with Apply
 *   - a localised name (plus flag) on the gallery detail page, instead of the
 *     raw code
 *   - a filter section in the gallery list's sidebar (language-filter.tsx),
 *     which narrows the list to one language
 *
 * `languages.ts` holds the codes and their flags; `language-filter.tsx` holds
 * the sidebar filter. Everything else is below.
 *
 * New features should keep the same shape: patches that hand anything they do
 * not own straight back to the original component, and shared data in a module
 * rather than on the window.
 *
 * The plugin is one bundled file. languages.ts is imported below and inlined
 * into it, so Stash loads exactly the one file ui.javascript names in
 * mangaTools.yml and there is no load order left to get wrong.
 */
import { NS } from "./languages";
import { requirePluginApi } from "./plugin-api";
import {
  DialogLanguageFilter,
  registerLanguageCriterionOption,
  SidebarLanguageFilter,
} from "./language-filter";
import type { MangaToolsFilterModel } from "./plugin-api";
import type {
  MangaToolsApolloOperation,
  MangaToolsIntl,
  MangaToolsOption,
} from "./plugin-api";

// Throws if Stash has not injected its API, the one thing that can go wrong at
// load time. Binding the result once gives every reference below a
// non-optional type without a single non-null assertion later on.
const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
var React = PluginApi.React;

var FIELD_NAME = NS.FIELD_NAME;
var PLUGIN_ID = "mangaTools";

/**
 * Anchors for the two places a language field is inserted.
 *
 * Both are rows Stash itself tags with data-field, so the anchor survives
 * markup changes:
 *   - the gallery edit panel uses renderField, which tags the studio row
 *     `studio_id`
 *   - the bulk edit dialog uses BulkUpdateFormGroup, which tags it `studio`
 *
 * They are deliberately different strings, so the two lookups can never
 * match each other's row.
 */
var EDIT_ANCHOR = '.form-group[data-field="studio_id"]';
var BULK_ANCHOR = '[data-field="studio"]';

var REFRESH_MS = 60000;

/** The Gallery custom_fields map as it comes back from GraphQL */
type CustomFieldsMap = { [key: string]: unknown };

/** Column class names copied off a native form row */
type NativeFieldClasses = { group: string; label: string; control: string };

/**
 * Pulls the original component out of a patch.instead callback's arguments.
 *
 * The official example writes `function (props, _, original)`, but the number
 * of arguments passed depends on whether React supplies the legacy context, so
 * a hard-coded index can come back undefined. The last argument is always the
 * original component — reading it that way is safe either way.
 */
function originalFrom(args: unknown[]): any {
  return args[args.length - 1];
}

function argsToArray(args: IArguments): unknown[] {
  return Array.prototype.slice.call(args) as unknown[];
}

/**
 * Records the first time a patch is actually invoked.
 *
 * Patching a component name that does not exist does not raise an error — it
 * simply never runs, leaving no trace to debug from. (This really happened:
 * CustomField looks like a patchable component but is a plain React.FC.)
 * This log is direct evidence that a patch took effect; it fires once per
 * target.
 */
var firedOnce: { [target: string]: boolean } = {};

function noteFired(target: string): void {
  if (firedOnce[target]) return;
  firedOnce[target] = true;
  console.info("[mangaTools] patch active: " + target);
}

// ───────────────────────────── State ─────────────────────────────

/** galleryId -> the raw language value from custom fields */
var store: Map<string, string> = new Map();

/** Subscribers: re-render when the store or the route changes */
var listeners: Set<() => void> = new Set();

var inFlight: Promise<unknown> | null = null;
var started = false;
var lastLoggedSize = -1;

/**
 * Current path. CustomFieldsInput is shared by every entity type, so this is
 * how we tell a gallery page apart from the rest.
 */
var currentPath = window.location.pathname || "";

function emit(): void {
  listeners.forEach(function (fn) {
    fn();
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return function () {
    listeners.delete(fn);
  };
}

/** Subscribes to global state (data or route) and re-renders on change. */
function useGlobalVersion(): number {
  var state = React.useState(0);
  var version = state[0];
  var setVersion = state[1];

  React.useEffect(function () {
    return subscribe(function () {
      setVersion(function (v) {
        return v + 1;
      });
    });
  }, []);

  return version;
}

/**
 * Only show the language dropdown on gallery edit panels.
 *
 * CustomFieldsInput is shared by the scene, performer, studio, tag and image
 * edit panels. Without this check the "language" field would show up on every
 * one of them. A gallery detail page is /galleries/{id}, and the bulk edit
 * dialog opens over the gallery list at /galleries.
 */
function isGalleryContext(): boolean {
  return currentPath.indexOf("/galleries") === 0;
}

// ───────────────────── Reading and writing custom fields ─────────────────────

/**
 * Reads the language value out of custom_fields. The field name is matched
 * case-insensitively.
 * @returns "" when there is no such field
 */
function pickLanguage(customFields: unknown): string {
  if (!customFields || typeof customFields !== "object") return "";

  var map = customFields as CustomFieldsMap;
  var keys = Object.keys(map);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === FIELD_NAME) {
      var v = map[keys[i]];
      if (v === null || v === undefined) return "";
      return String(v);
    }
  }
  return "";
}

/**
 * Writes a new language value into custom_fields and returns the new object
 * (the input is not mutated). An empty value removes every case variant of the
 * key — matching the delete semantics of the native CustomFieldInput.
 */
function setLanguage(customFields: unknown, code: string): CustomFieldsMap {
  var next = Object.assign({}, customFields || {}) as CustomFieldsMap;
  Object.keys(next).forEach(function (k) {
    if (k.toLowerCase() === FIELD_NAME) delete next[k];
  });
  if (code) next[FIELD_NAME] = code;
  return next;
}

// ───────────────────────────── Fetching ─────────────────────────────

/**
 * A Gallery's custom_fields is the GraphQL Map scalar, and a single key cannot
 * be projected out of it. So we filter for galleries that have a `language`
 * field and fetch the whole map, then keep it in memory.
 *
 * The field name must be lowercase `language` — that is what this plugin
 * writes. Matching both `language` and `Language` in one query is impossible:
 *   - OR is singular in the schema (OR: GalleryFilterType), not an array
 *   - multiple criteria inside the custom_fields array are ANDed, not ORed
 * So lowercase is a hard constraint, guaranteed by the dropdown. Reads remain
 * case-insensitive, so a capitalised key already in the library still renders.
 */
var QUERY: unknown = null;

function getQuery(): unknown {
  if (QUERY) return QUERY;

  var Apollo = PluginApi.libraries.Apollo;
  var gql = (Apollo && Apollo.gql) || (PluginApi.GQL && PluginApi.GQL.gql);
  if (!gql) {
    console.error("[mangaTools] gql not available, cannot build the query");
    return null;
  }

  QUERY = gql(
    [
      "query MangaToolsMap {",
      "  findGalleries(",
      "    gallery_filter: {",
      '      custom_fields: [{ field: "language", modifier: NOT_NULL }]',
      "    }",
      "    filter: { per_page: -1 }",
      "  ) {",
      "    count",
      "    galleries {",
      "      id",
      "      custom_fields",
      "    }",
      "  }",
      "}",
    ].join("\n")
  );

  return QUERY;
}

/** What the query above returns, as far as this plugin cares */
type GalleriesPayload = {
  galleries?: Array<{ id: string; custom_fields?: CustomFieldsMap }>;
};

/** Refetches the language map. Concurrent calls share one in-flight request. */
function refresh(): Promise<unknown> {
  if (inFlight) return inFlight;

  var query = getQuery();
  if (!query) return Promise.resolve();

  var client;
  try {
    client = PluginApi.utils.StashService.getClient();
  } catch (e) {
    console.error("[mangaTools] failed to get the Apollo client:", e);
    return Promise.resolve();
  }

  inFlight = client
    .query({ query: query, fetchPolicy: "network-only" })
    .then(function (res) {
      var data = res && res.data;
      var result = data
        ? (data.findGalleries as GalleriesPayload | undefined)
        : undefined;
      var galleries = (result && result.galleries) || [];

      var next: Map<string, string> = new Map();
      galleries.forEach(function (g) {
        var value = pickLanguage(g.custom_fields);
        if (value) next.set(String(g.id), value);
      });

      store = next;
      emit();

      // Only log when the count changes, so it does not spam every minute.
      // This line is the first thing to check when a badge does not show up:
      // if it says 0, the query worked but no gallery carries a language field,
      // so the problem is the data rather than the plugin.
      if (next.size !== lastLoggedSize) {
        lastLoggedSize = next.size;
        console.info(
          "[mangaTools] loaded language tags for " + next.size + " gallery(ies)"
        );
      }
    })
    .catch(function (e) {
      // Deliberately do not clear what we already have — stale values beat
      // none, and the next refresh will try again. Query syntax errors land
      // here too (Apollo throws GraphQL errors), so this log has to be loud.
      console.error(
        "[mangaTools] failed to fetch language data, badges will not show. Raw error:",
        e
      );
    })
    .then(function () {
      inFlight = null;
    });

  return inFlight;
}

/**
 * The plugin settings live in Stash's Configuration (Configuration.plugins,
 * keyed by plugin ID) and are read/written through GraphQL. The one setting
 * here, enabledLanguages, is a comma-separated list of canonical codes; an
 * empty value means "no restriction". See parseEnabledLanguages in
 * languages.ts.
 *
 * Only the `plugins` field is fetched — not the rest of Configuration, which
 * is a large object. This is the same minimal-query approach as getQuery().
 */
var SETTINGS_QUERY: unknown = null;

function getSettingsQuery(): unknown {
  if (SETTINGS_QUERY) return SETTINGS_QUERY;

  var Apollo = PluginApi.libraries.Apollo;
  var gql = (Apollo && Apollo.gql) || (PluginApi.GQL && PluginApi.GQL.gql);
  if (!gql) {
    console.error("[mangaTools] gql not available, cannot read settings");
    return null;
  }

  // plugins is the PluginConfigMap scalar, so it needs no sub-selection.
  SETTINGS_QUERY = gql(
    [
      "query MangaToolsSettings {",
      "  configuration {",
      "    plugins",
      "  }",
      "}",
    ].join("\n")
  );

  return SETTINGS_QUERY;
}

/** What the settings query returns, as far as this plugin cares */
type SettingsPayload = {
  configuration?: {
    plugins?: { [pluginID: string]: { [key: string]: unknown } };
  };
};

/**
 * Refetches the plugin settings and updates NS.enabledLanguages.
 *
 * Runs on startup and on every navigation, so a change made on the settings
 * page is picked up as soon as the user leaves it. (The settings UI also
 * updates the value directly when it saves, but navigation re-reads it from
 * the source of truth.)
 */
function refreshSettings(): void {
  var query = getSettingsQuery();
  if (!query) return;

  var client;
  try {
    client = PluginApi.utils.StashService.getClient();
  } catch (e) {
    console.error("[mangaTools] failed to get the Apollo client:", e);
    return;
  }

  client
    .query({ query: query, fetchPolicy: "network-only" })
    .then(function (res) {
      var data = (res && res.data) as SettingsPayload | undefined;
      var plugins = data && data.configuration && data.configuration.plugins;
      var pluginCfg = plugins && plugins[PLUGIN_ID];
      NS.enabledLanguages = NS.parseEnabledLanguages(
        pluginCfg ? pluginCfg.enabledLanguages : null
      );
      // Absent reads as the default (on), so an install predating these
      // settings keeps its behaviour until the user turns something off.
      NS.showFlags = NS.parseFlag(pluginCfg ? pluginCfg.showFlags : null, true);
      NS.showCoverBadge = NS.parseFlag(
        pluginCfg ? pluginCfg.showCoverBadge : null,
        true
      );
      emit();
    })
    .catch(function (e) {
      // Keep whatever was last read; a stale enabled set beats none.
      console.error("[mangaTools] failed to fetch plugin settings:", e);
    });
}

/** Shape of the payload of Stash's "stash:location" event */
type LocationEvent = {
  detail?: { data?: { location?: { pathname?: string } } };
};

function start(): void {
  if (started) return;
  started = true;

  refresh();
  refreshSettings();

  // Saving an edit does not change the route, so a slow poll acts as a
  // backstop. The query only pulls id + custom_fields, so it is small.
  window.setInterval(function () {
    if (document.visibilityState === "visible") refresh();
  }, REFRESH_MS);

  if (PluginApi.Event && PluginApi.Event.addEventListener) {
    PluginApi.Event.addEventListener("stash:location", function (e) {
      var ev = e as LocationEvent;
      var loc = ev && ev.detail && ev.detail.data && ev.detail.data.location;
      currentPath = (loc && loc.pathname) || window.location.pathname || "";
      refresh();
      refreshSettings();
      // Tell subscribers to recompute isGalleryContext()
      emit();
    });
  }
}

/**
 * Refetches the gallery map, waiting for any fetch that is already in flight.
 *
 * Used after a bulk write. Both halves matter:
 *   - calling refresh() directly would usually be **skipped**, because refresh()
 *     shares one in-flight request — so the badges would keep the old flag until
 *     the next poll or navigation.
 *   - simply clearing inFlight and starting a new fetch would let the older
 *     response land afterwards and put the previous language back, since that
 *     request was built before the write.
 */
function refreshAfterWrite(): void {
  var pending = inFlight;
  if (pending) {
    // inFlight is cleared by this promise's own final handler, which runs
    // before this callback, so refresh() starts a genuinely new request.
    pending.then(function () {
      refresh();
    });
  } else {
    refresh();
  }
}

// ─────────────────────── UI locale and flags ───────────────────────

/**
 * Current Stash UI locale.
 *
 * Reads it through react-intl, exactly like CountryLabel does — the plugin
 * never guesses the user's language. This is a hook, so it must be called
 * inside a component body.
 */
function useLocale(): string {
  return PluginApi.libraries.Intl.useIntl().locale;
}

/**
 * A regional flag.
 *
 * flag-icons' CSS is loaded globally by Stash (index.scss imports
 * `flag-icons/css/flag-icons.min.css`), so emitting `<span class="fi fi-jp">`
 * is all that is needed — no assets to ship.
 *
 * These are CSS-drawn flags, not emoji: Windows' Segoe UI Emoji has no flag
 * glyphs, so a flag emoji degrades into a pair of boxed letters there.
 */
function Flag(props: { flag: string; className?: string }) {
  return (
    <span
      className={
        "fi fi-" + props.flag + (props.className ? " " + props.className : "")
      }
    />
  );
}

// ─────────────────────────── Cover badge ───────────────────────────

/** Reads the in-memory store only; issues no requests. */
function LanguageBadge(props: { galleryId: string }) {
  useGlobalVersion();
  var locale = useLocale();

  var info = NS.describe(store.get(String(props.galleryId)), locale);
  if (!info) return null;

  // No flag to show, for one of two reasons — and they are not the same chip:
  //
  //   unrecognised  arbitrary data, so it is bounded and ellipsised; a long junk
  //                 value must not end up covering the cover
  //   flags off     a real language name, so it is shown whole — clipping
  //                 "印度尼西亚语" or "Traditional Chinese" to a few characters
  //                 would make the setting hard to use
  //
  // The look is identical; what differs is whether the text may run its length.
  if (!info.known) {
    return <div className="manga-tools-badge is-unknown">{info.name}</div>;
  }
  if (!NS.showFlags) {
    return <div className="manga-tools-badge is-name">{info.name}</div>;
  }

  return (
    <div className="manga-tools-badge" aria-label={info.name}>
      <Flag flag={info.flag as string} />
    </div>
  );
}

// ─────────────────────────── Edit-page dropdown ───────────────────────────

/**
 * react-select is a namespace import on PluginApi.libraries, and the component
 * is its default export. It is looked up at runtime, so there is no static
 * type to give it.
 */
var SELECT: any = null;

function resolveSelect(): any {
  if (SELECT) return SELECT;

  var RS = PluginApi.libraries.ReactSelect;
  if (!RS) {
    console.error("[mangaTools] react-select not available");
    return null;
  }

  SELECT = RS.default || RS.Select || RS;
  return SELECT;
}

/**
 * Renders a dropdown option: flag plus localised name.
 * react-select calls this for both the menu item and the selected value, so
 * the two always look the same.
 */
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
 * Copies the class names for each layer off the studio field's DOM.
 *
 * Column widths are deliberately not hard-coded: renderField's defaults differ
 * between Stash versions — develop uses { sm: 3, xl: 2 } while the build
 * actually running only had { sm: 3 }. The extra col-xl-2 made our label
 * column narrower than the native ones on wide screens, so nothing lined up.
 * Copying the class names that are already there is correct regardless of
 * version or breakpoint.
 *
 * Returns null when nothing can be read, and the caller falls back to a
 * conservative default.
 */
function readNativeFieldClasses(
  anchorSelector: string
): NativeFieldClasses | null {
  var anchor = document.querySelector(anchorSelector);
  if (!anchor) return null;

  var label = anchor.querySelector("label");
  var control = label && label.nextElementSibling;
  if (!label || !control) return null;

  return {
    group: anchor.className,
    label: label.className,
    control: control.className,
  };
}

/**
 * The edit page's language field, rendered through a portal into the row
 * **right after the studio field**.
 *
 * Why an always-present field rather than replacing the existing language
 * input row: CustomFieldsInput only renders input rows for fields that already
 * exist, and a new gallery has no language row to replace. Typing the field
 * name and code by hand for every gallery would defeat the point of the
 * dropdown. The existing language row is suppressed by the CustomFieldInput
 * patch below, so there is never a duplicate.
 *
 * The structure mirrors Stash's renderField (utils/form.tsx) — see
 * readNativeFieldClasses for how the column widths are matched.
 */
function LanguageRow(props: {
  value: string;
  onChange: (code: string) => void;
}) {
  useGlobalVersion();

  var intl = PluginApi.libraries.Intl.useIntl();
  var Select = resolveSelect();

  // The mount point is read during render (same approach as the detail page).
  // ensureFieldHost is idempotent and returns null when the anchor is absent.
  var host = isGalleryContext() ? ensureFieldHost() : null;

  var bump = React.useState(0)[1];

  // On first mount the studio row **has not been committed to the DOM yet**:
  // CustomFieldsInput sits at the very end of the edit form, so when it renders
  // React has only just built the elements and has not written them out. This
  // pass therefore cannot find the anchor. The effect runs after the commit,
  // when it can, and one extra render is all it takes.
  //
  // It only bumps when the mount point differs from the one used for this
  // render, so once things settle the condition is never true again and there
  // is no render loop.
  // A layout effect, so the extra pass is flushed after React writes the DOM but
  // before the browser paints, and this correction adds no visible step of its
  // own.
  React.useLayoutEffect(function () {
    if (isGalleryContext() && ensureFieldHost() !== host) {
      bump(function (v) {
        return v + 1;
      });
    }
  });

  if (!isGalleryContext() || !Select || !host) return null;

  var current = NS.describe(props.value, intl.locale);
  var options: MangaToolsOption[] = NS.languageOptions(intl.locale).filter(
    function (o) {
      // NS.enabledLanguages is null for "no restriction", otherwise the
      // dropdown is limited to exactly these codes. Display (badge / detail
      // row) is not affected — it always uses the full table via describe().
      return !NS.enabledLanguages || NS.enabledLanguages.has(o.value);
    }
  );

  // Keep an unrecognised current value in the list, otherwise picking
  // something else would make it unreachable.
  if (current && !current.known) {
    // Spread rather than concat: concat infers the literal's `flag: null` as a
    // literal type, which then fails to match MangaToolsOption's `string | null`.
    options = [
      { value: current.code, label: current.name, flag: null },
      ...options,
    ];
  }

  var selected = current
    ? { value: current.code, label: current.name, flag: current.flag }
    : null;

  // Column widths come from the native field; this is the fallback.
  var cls = readNativeFieldClasses(EDIT_ANCHOR) || {
    group: "form-group row",
    label: "form-label col-form-label col-sm-3",
    control: "col-sm-9",
  };

  var field = (
    // Plain div/label carrying the copied class names, rather than
    // Form.Group/Form.Label/Col: those components regenerate the width classes
    // from their own defaults, which is what broke the alignment before.
    <div className={cls.group} data-field="manga_tools_language">
      <label className={cls.label} htmlFor="manga_tools_language">
        {fieldLabel(intl)}
      </label>
      <div className={cls.control}>
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_language"
          isClearable
          isSearchable={false}
          placeholder="Select language…"
          value={selected}
          options={options}
          // react-select draws a vertical rule between the clear and expand
          // icons by default, and none of Stash's own dropdowns have it — its
          // Select.tsx sets components: { IndicatorSeparator: () => null } in
          // its default props, and CountrySelect and FilterSelect each strip it
          // too. Follow suit, so this field matches the ones above it.
          components={{ IndicatorSeparator: () => null }}
          // Flags are drawn with CSS and cannot live inside a plain-text label,
          // so the option has to be rendered here.
          formatOptionLabel={formatLanguageOption}
          // An empty value deletes the field, matching the native
          // onChange("", "") semantics.
          onChange={function (opt: MangaToolsOption | null) {
            props.onChange(opt ? opt.value : "");
          }}
        />
      </div>
    </div>
  );

  return PluginApi.ReactDOM.createPortal(field, host);
}

// ─────────────────────────── Settings page ───────────────────────────

/**
 * The plugin's settings UI, rendered in place of the stock per-setting input
 * (see the PluginSettings patch below).
 *
 * The stock UI can only render STRING/NUMBER/BOOLEAN settings one input each,
 * so "which languages are enabled" would otherwise be a comma-separated text
 * box. This renders a multiselect of flag + localised name instead, writing
 * the same comma-separated value.
 *
 * It reads NS.enabledLanguages (kept fresh by refreshSettings) and writes it
 * back through configurePlugin, which replaces the plugin's whole settings
 * map — with a single setting, that map is just { enabledLanguages }.
 */
/**
 * One on/off setting, laid out exactly like Stash's own BooleanSetting
 * (Settings/Inputs.tsx): a `.setting` row with the heading on the left and the
 * switch pushed to the right by Stash's own CSS.
 */
function BooleanSetting(props: {
  id: string;
  heading: string;
  subHeading: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  var Bootstrap = PluginApi.libraries.Bootstrap;
  if (!Bootstrap) {
    console.error(
      "[mangaTools] react-bootstrap not available, cannot render the settings switches"
    );
    return null;
  }

  return (
    <div className="setting">
      <div>
        <h3>{props.heading}</h3>
        <div className="sub-heading">{props.subHeading}</div>
      </div>
      <div>
        <Bootstrap.Form.Switch
          id={props.id}
          checked={props.checked}
          onChange={function () {
            props.onChange(!props.checked);
          }}
        />
      </div>
    </div>
  );
}

function MangaToolsSettings(props: { pluginID: string }) {
  useGlobalVersion();

  var intl = PluginApi.libraries.Intl.useIntl();
  var Select = resolveSelect();

  var savePlugin = PluginApi.utils.StashService.useConfigurePlugin()[0];

  /**
   * Writes every setting at once.
   *
   * Deliberately not just the one that changed: configurePlugin's input is the
   * plugin's whole settings map, and writing the full map is correct whether
   * that map is replaced or merged — which cannot be confirmed from the plugin
   * side, since the resolver is not part of the published API.
   */
  function persist() {
    savePlugin({
      variables: {
        plugin_id: props.pluginID,
        input: {
          enabledLanguages: NS.enabledLanguages
            ? NS.serializeEnabledLanguages(NS.enabledLanguages)
            : "",
          showFlags: NS.showFlags,
          showCoverBadge: NS.showCoverBadge,
        },
      },
    }).catch(function (e) {
      console.error("[mangaTools] failed to save plugin settings:", e);
    });
  }

  var options: MangaToolsOption[] = NS.languageOptions(intl.locale);
  var enabled = NS.enabledLanguages;
  // null (no restriction) renders an empty box whose placeholder reads
  // "All languages", rather than filling the box with every tag. A non-empty
  // selection renders exactly those tags.
  var value = enabled
    ? options.filter(function (o) {
        return enabled !== null && enabled.has(o.value);
      })
    : [];

  if (!Select) return null;

  return (
    <>
      <div className="setting manga-tools-settings">
        <div className="manga-tools-settings-block">
          <h3>Enabled languages</h3>
          <div className="sub-heading">
            Only these languages appear in the edit-page dropdown. Display
            (badge and detail row) is unaffected. Leave empty to show every
            language.
          </div>
          <div className="manga-tools-settings-control">
            <Select
              className="manga-tools-settings-select"
              classNamePrefix="react-select"
              isMulti
              isClearable
              // Flip the menu above the control when there is not enough room
              // below (the plugin is usually the last entry on the page).
              menuPlacement="auto"
              placeholder="All languages"
              value={value}
              options={options}
              formatOptionLabel={formatLanguageOption}
              components={{ IndicatorSeparator: () => null }}
              onChange={function (selected: MangaToolsOption[] | null) {
                var codes = (selected || []).map(function (o) {
                  return o.value;
                });

                // Reflect the change immediately (the dropdown and this UI
                // both read NS.enabledLanguages), then persist it.
                NS.enabledLanguages = NS.parseEnabledLanguages(
                  NS.serializeEnabledLanguages(codes)
                );
                emit();
                persist();
              }}
            />
          </div>
        </div>
      </div>

      <BooleanSetting
        id="mangaTools-showFlags"
        heading="Show flags"
        subHeading="Draw the flag beside the language name. Turn this off to show the name on its own."
        checked={NS.showFlags}
        onChange={function (next) {
          NS.showFlags = next;
          emit();
          persist();
        }}
      />

      <BooleanSetting
        id="mangaTools-showCoverBadge"
        heading="Show the language on gallery covers"
        subHeading="The badge in the bottom-right of a gallery's cover. With flags turned off it shows the language name instead of a flag."
        checked={NS.showCoverBadge}
        onChange={function (next) {
          NS.showCoverBadge = next;
          emit();
          persist();
        }}
      />
    </>
  );
}

// ─────────────────────────── Bulk edit dialog ───────────────────────────

/** What the bulk row is about to do to the selected galleries */
type BulkLanguagePending = { kind: "set"; value: string } | { kind: "cleared" };

/**
 * The language the bulk dialog is about to apply, or null when the user has not
 * touched the row.
 *
 * This is state the dialog itself does not know about, and cannot be given:
 * EditGalleriesDialog is a plain React.FC (not a PatchComponent) and keeps its
 * pending edits in its own useState, so there is no way to add a field to them.
 * The row therefore lives outside that state and its value is merged into the
 * outgoing mutation instead — see installBulkLink.
 *
 * It is dropped once the mutation succeeds and when the dialog closes, so a
 * cancelled dialog leaves nothing behind.
 *
 * There is deliberately no "remove" state: the field mirrors Stash's own studio
 * selector, where clearing the box means "do not change this", not "empty it".
 */
var bulkPending: BulkLanguagePending | null = null;

/** Ids currently selected in the gallery list, captured from GalleryList */
var selectedGalleryIds: string[] = [];

/**
 * Records which galleries are selected.
 *
 * The bulk dialog does not hand its selection to anything a plugin can patch,
 * so it is read from GalleryList instead — the one patchable component that
 * receives `selectedIds`, and the parent of all three display modes, so grid,
 * list and wall are all covered by this single hook.
 *
 * Deliberately does **not** emit(): this runs during GalleryList's render, and
 * notifying subscribers there would set state on a component while a different
 * one is rendering. Nothing needs it either — the selection cannot change while
 * the modal is open.
 */
function captureSelection(selectedIds: unknown): void {
  var next: string[] = [];
  if (
    selectedIds &&
    typeof (selectedIds as { forEach?: unknown }).forEach === "function"
  ) {
    (selectedIds as Set<string>).forEach(function (id) {
      next.push(String(id));
    });
  }

  var unchanged =
    next.length === selectedGalleryIds.length &&
    next.every(function (id, i) {
      return id === selectedGalleryIds[i];
    });

  if (!unchanged) selectedGalleryIds = next;
}

/**
 * The language every selected gallery shares, or null when they differ (or when
 * none of them carries one).
 *
 * Mirrors getAggregateStudioId in Stash's utils/bulkUpdate.ts — comparing the
 * whole selection and falling back to "nothing in common" is what makes the
 * studio field show a value only when every selected item agrees. The languages
 * come from the plugin's own store rather than from the dialog, because the
 * dialog is the one thing that cannot be read.
 */
function selectedLanguageAggregate(): string | null {
  if (!selectedGalleryIds.length) return null;

  var first = store.get(selectedGalleryIds[0]) || "";
  for (var i = 1; i < selectedGalleryIds.length; i++) {
    if ((store.get(selectedGalleryIds[i]) || "") !== first) return null;
  }

  return first || null;
}

/** Set once, so the link chain is never wrapped twice */
var bulkLinkInstalled = false;

/**
 * Is this operation Stash's gallery bulk update?
 *
 * Matched on the **root field name from the schema** (`bulkGalleryUpdate`,
 * graphql/schema/schema.graphql) rather than on the operation name codegen
 * happens to give it, and not on the shape of the variables either: the scene
 * and image bulk updates also take an `ids` array, and writing a language onto
 * scenes is not this plugin's business.
 */
function isGalleryBulkUpdate(query: unknown): boolean {
  var defs = query ? (query as { definitions?: unknown[] }).definitions : null;
  if (!defs || !defs.length) return false;

  var op = defs[0] as {
    kind?: string;
    selectionSet?: { selections?: Array<{ name?: { value?: string } }> };
  };
  if (!op || op.kind !== "OperationDefinition") return false;

  var selections = op.selectionSet && op.selectionSet.selections;
  if (!selections || !selections.length) return false;

  var first = selections[0];
  return !!(first && first.name && first.name.value === "bulkGalleryUpdate");
}

/**
 * Merges the pending language into a bulk gallery update, in place.
 *
 * CustomFieldsInput is what makes this safe: `partial` updates just the named
 * keys, so the rest of every gallery's custom fields is left alone. Nothing is
 * merged when the user has not actually picked a language — a bulk edit of
 * photographers must go out exactly as Stash built it.
 *
 * @returns true when the operation was modified
 */
function applyPendingLanguage(operation: MangaToolsApolloOperation): boolean {
  if (!bulkPending || bulkPending.kind !== "set") return false;

  // The route is checked here as well as by the row's mount, so "a language is
  // only ever written on a gallery page" is a stated constraint rather than a
  // consequence of where the row happens to render.
  if (!isGalleryContext()) return false;

  if (!isGalleryBulkUpdate(operation.query)) return false;

  var input = operation.variables
    ? (operation.variables.input as { ids?: unknown } | undefined)
    : undefined;
  if (!input || !Array.isArray(input.ids)) return false;

  var fields = { partial: { [FIELD_NAME]: bulkPending.value } };

  operation.variables = Object.assign({}, operation.variables, {
    input: Object.assign({}, input, {
      custom_fields: Object.assign(
        {},
        (input as { custom_fields?: unknown }).custom_fields,
        fields
      ),
    }),
  });

  return true;
}

/**
 * Hooks Stash's Apollo link chain so the pending language rides along with the
 * dialog's own Apply.
 *
 * Why a link rather than patching the dialog: the dialog builds its mutation
 * from private state, so the last point this plugin and the dialog are both
 * present is the outgoing GraphQL operation. `setLink` is Apollo's own API for
 * changing the chain after the client exists, and the existing chain is passed
 * through untouched, so nothing else about the client changes.
 *
 * Installed lazily, the first time the bulk row mounts, so a user who never
 * opens the bulk dialog never has their client touched at all.
 */
function installBulkLink(): void {
  if (bulkLinkInstalled) return;

  var Apollo = PluginApi.libraries.Apollo;
  var client;
  try {
    client = PluginApi.utils.StashService.getClient();
  } catch (e) {
    console.error("[mangaTools] failed to get the Apollo client:", e);
    return;
  }

  if (
    !Apollo ||
    !Apollo.ApolloLink ||
    typeof client.setLink !== "function" ||
    !client.link
  ) {
    console.error(
      "[mangaTools] ApolloLink/setLink unavailable — languages cannot be set from the bulk edit dialog"
    );
    return;
  }

  // Replace the chain with ours in front of the existing one. setLink replaces
  // the whole chain, so the current link must be passed through explicitly.
  var previous = client.link;

  client.setLink(
    Apollo.ApolloLink.from([
      new Apollo.ApolloLink(function (operation, forward) {
        if (!applyPendingLanguage(operation)) {
          return forward(operation);
        }

        console.info(
          "[mangaTools] bulk update: sending the language with the dialog's own update"
        );

        // Cleared only once the update actually succeeded, so a failed Apply
        // can simply be retried with the row still filled in.
        return forward(operation).map(function (result) {
          bulkPending = null;

          // The badges read the plugin's own store, which this update has just
          // invalidated. Without this the covers keep the old flag until the
          // next poll or navigation.
          refreshAfterWrite();
          emit();

          return result;
        });
      }),
      previous,
    ])
  );

  bulkLinkInstalled = true;
}

/**
 * The bulk edit dialog's language row, rendered through a portal into a mount
 * point inserted between Stash's "studio" and "performers" rows.
 *
 * The value is deliberately **not** applied as it is picked: it is merged into
 * the dialog's own bulk update when Apply is pressed, so Cancel discards it
 * exactly like every other field in that dialog.
 */
function BulkLanguageRow() {
  useGlobalVersion();

  var intl = PluginApi.libraries.Intl.useIntl();
  var Select = resolveSelect();

  var host = isGalleryContext() ? ensureBulkFieldHost() : null;
  var bump = React.useState(0)[1];

  // Same first-render problem as LanguageRow: the dialog mounts this component
  // from its rating row, which renders **before** the studio row it has to
  // anchor on has been committed to the DOM. The effect runs after the commit,
  // and one extra render is all it takes.
  // As in LanguageRow: before paint, so this pass adds no step of its own.
  React.useLayoutEffect(function () {
    if (isGalleryContext()) {
      installBulkLink();
      if (ensureBulkFieldHost() !== host) {
        bump(function (v) {
          return v + 1;
        });
      }
    }
  });

  // Losing the row means the dialog closed, so the pending value is no longer
  // wanted. Checked against the DOM rather than unconditionally, so an
  // unrelated re-render cannot throw the value away while the dialog is open.
  React.useEffect(function () {
    return function () {
      if (!document.querySelector(BULK_ANCHOR)) {
        bulkPending = null;
      }
    };
  }, []);

  if (!isGalleryContext() || !Select || !host) return null;

  var options: MangaToolsOption[] = NS.languageOptions(intl.locale).filter(
    function (o) {
      return !NS.enabledLanguages || NS.enabledLanguages.has(o.value);
    }
  );

  var pending = bulkPending;

  // Show exactly what is about to happen: what the user picked, otherwise the
  // selection's shared language. A mixed selection shows the placeholder — the
  // same way the studio field behaves.
  var shown =
    pending && pending.kind === "set"
      ? pending.value
      : pending
        ? ""
        : selectedLanguageAggregate() || "";

  var current = shown ? NS.describe(shown, intl.locale) : null;

  // A code that is not in the enabled list still has to be shown while it is
  // sitting in the row, or the selection would look like it was ignored.
  var currentCode = current ? current.code : "";
  if (
    current &&
    !options.some(function (o) {
      return o.value === currentCode;
    })
  ) {
    options = [
      { value: current.code, label: current.name, flag: current.flag },
      ...options,
    ];
  }

  var selected = current
    ? { value: current.code, label: current.name, flag: current.flag }
    : null;

  var cls = readNativeFieldClasses(BULK_ANCHOR) || {
    group: "row",
    label: "col-form-label col-3",
    control: "col-9",
  };

  var field = (
    <div className={cls.group} data-field="manga_tools_language">
      <label className={cls.label} htmlFor="manga_tools_language">
        {fieldLabel(intl)}
      </label>
      <div className={cls.control}>
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_language"
          isClearable
          isSearchable={false}
          // The dialog is a scrolling modal, so the menu has to escape it.
          menuPortalTarget={document.body}
          placeholder="Select language…"
          value={selected}
          options={options}
          formatOptionLabel={formatLanguageOption}
          components={{ IndicatorSeparator: () => null }}
          // Clearing means "leave the language alone", exactly as clearing the
          // studio field means "leave the studio alone" — neither sends a value.
          onChange={function (opt: MangaToolsOption | null) {
            bulkPending = opt
              ? { kind: "set", value: opt.value }
              : { kind: "cleared" };
            emit();
          }}
        />
      </div>
    </div>
  );

  return PluginApi.ReactDOM.createPortal(field, host);
}

// ───────────────────────────── Patch registration ─────────────────────────────

// 1. The badge on the bottom of the gallery card cover.
//
//    The original component has to be rendered as a React element. Do not call
//    original(props) directly the way the official example does —
//    GalleryCard.Overlays uses useMemo internally, and calling it directly
//    breaks the rules of hooks.
PluginApi.patch.instead("GalleryCard.Overlays", function () {
  var args = argsToArray(arguments);
  var props = args[0] as { gallery?: { id?: string } };
  var Original = originalFrom(args);
  noteFired("GalleryCard.Overlays");

  var id = props.gallery && props.gallery.id;
  var value = id ? store.get(String(id)) : "";

  // Nothing to add: the gallery has no language, or the badge is turned off.
  if (!value || !NS.showCoverBadge) return <Original {...props} />;

  return (
    <>
      <Original {...props} />
      <LanguageBadge galleryId={id as string} />
    </>
  );
});

// 2. Edit page: render the language field (it portals itself after the studio
//    row, so it contributes nothing at this position).
PluginApi.patch.instead("CustomFieldsInput", function () {
  var args = argsToArray(arguments);
  var props = args[0] as {
    values?: CustomFieldsMap;
    onChange?: (values: CustomFieldsMap) => void;
  };
  var Original = originalFrom(args);
  noteFired("CustomFieldsInput");

  return (
    <>
      <LanguageRow
        value={pickLanguage(props.values)}
        onChange={function (code) {
          if (props.onChange) {
            props.onChange(setLanguage(props.values, code));
          }
        }}
      />
      <Original {...props} />
    </>
  );
});

// 3. Edit page: stop rendering the existing language input row, since the
//    field above handles it now. Every other field goes straight back to the
//    original component, so the plugin has zero effect on them.
//
//    isNew must pass through: that is the "new field" row, and the user may be
//    in the middle of typing "language" as the field name. Returning null would
//    make the whole row vanish mid-keystroke.
PluginApi.patch.instead("CustomFieldInput", function () {
  var args = argsToArray(arguments);
  var props = args[0] as { field?: string; isNew?: boolean };
  var Original = originalFrom(args);
  noteFired("CustomFieldInput");

  var isLanguageField =
    !!props.field && String(props.field).toLowerCase() === FIELD_NAME;

  if (!props.isNew && isLanguageField) {
    return null;
  }

  return <Original {...props} />;
});

/** Class name of the detail row's mount point */
var DETAIL_HOST_CLASS = "manga-tools-detail-host";

/**
 * The mount point. Held at module scope so a React re-render that drops it
 * reuses the same node instead of creating a new one every render.
 */
var detailHost: HTMLElement | null = null;

/**
 * Finds (creating if needed) the mount point for the detail-page language row.
 *
 * Why this touches the DOM: everything inside `.gallery-details` is a bare
 * <h6>. The only component there is PhotographerLink, and neither it nor its
 * parent GalleryDetailPanel is patchable, so React offers no insertion point.
 *
 * Appending to the end of `.gallery-details` puts the row after "photographer"
 * and before "details" — the latter belongs to renderDetails() in the next .row.
 */
function ensureDetailHost(): HTMLElement | null {
  var panel = document.querySelector(".gallery-details");
  if (!panel) {
    detailHost = null;
    return null;
  }

  if (!detailHost) {
    detailHost = document.createElement("div");
    detailHost.className = DETAIL_HOST_CLASS;
  }

  // A React re-render may push it earlier or drop it; keep it at the end.
  if (
    detailHost.parentNode !== panel ||
    panel.lastElementChild !== detailHost
  ) {
    panel.appendChild(detailHost);
  }

  return detailHost;
}

/** Class name of the edit field's mount point */
var FIELD_HOST_CLASS = "manga-tools-field-host";

/** As above, held at module scope so the same node is reused */
var fieldHosts: { [key: string]: HTMLElement | null } = {
  edit: null,
  bulk: null,
};

/**
 * Finds (creating if needed) the mount point for a language field row,
 * positioned **right after the row named by `anchorSelector`**.
 *
 * Why not patch the component that renders that row: StudioSelect renders
 * inside a `<Col>`, so anything added there is nested inside that column and
 * the label column no longer lines up with the native fields. What is needed
 * is a sibling field row, so one has to be inserted into the DOM.
 *
 * Conveniently Stash leaves a data-field attribute on these rows (renderField
 * on the edit panel, BulkUpdateFormGroup in the bulk dialog), which makes a far
 * more stable anchor than walking the structure.
 *
 * `key` is per-anchor so the edit panel and the bulk dialog each keep their own
 * mount point; they are never on screen at the same time.
 */
function ensureHostAfter(
  anchorSelector: string,
  key: string
): HTMLElement | null {
  var anchor = document.querySelector(anchorSelector);
  if (!anchor || !anchor.parentNode) {
    fieldHosts[key] = null;
    return null;
  }

  var host = fieldHosts[key];
  if (!host) {
    host = document.createElement("div");
    host.className = FIELD_HOST_CLASS;
    fieldHosts[key] = host;
  }

  // A React re-render may displace it; keep it directly after the studio row.
  // The reference node is nextElementSibling rather than nextSibling: it is
  // the same property the idempotency check above uses, and a stray whitespace
  // text node between the two does not change the position either way.
  if (
    host.parentNode !== anchor.parentNode ||
    anchor.nextElementSibling !== host
  ) {
    anchor.parentNode.insertBefore(host, anchor.nextElementSibling);
  }

  return host;
}

/** The gallery edit panel's mount point (see LanguageRow) */
function ensureFieldHost(): HTMLElement | null {
  return ensureHostAfter(EDIT_ANCHOR, "edit");
}

/** The bulk edit dialog's mount point (see BulkLanguageRow) */
function ensureBulkFieldHost(): HTMLElement | null {
  return ensureHostAfter(BULK_ANCHOR, "bulk");
}

/**
 * Localised text for the "language" label.
 *
 * Reuses config.ui.language.heading straight out of Stash's own locale files.
 * It exists in **every** locale Stash ships (en-GB "Language", zh-CN "语言",
 * ja-JP "言語", …), so this gets all of Stash's UI languages for free instead
 * of maintaining a label table here.
 */
function fieldLabel(intl: MangaToolsIntl): string {
  return intl.formatMessage({
    id: "config.ui.language.heading",
    defaultMessage: "Language",
  });
}

/**
 * The detail page's language row, rendered through a portal into the mount
 * point above.
 *
 * A portal rather than writing DOM directly: the content stays under React's
 * control, so a UI language change updates it automatically, and the only
 * thing inserted by hand is an empty div.
 *
 * Rendered as an <h6> to match the "photographer" rows above it.
 */
function DetailLanguageRow(props: { value: unknown }) {
  useGlobalVersion();

  var intl = PluginApi.libraries.Intl.useIntl();
  var info = NS.describe(props.value, intl.locale);
  if (!info) return null;

  // The mount point is synced during render. ensureDetailHost is idempotent
  // (find → create if missing → move back to the end) and always returns the
  // same node, so it never creates duplicates or triggers a render loop.
  //
  // A render-phase side effect is used here rather than state + useEffect: the
  // latter returns null first and re-renders after, which flashes every time
  // you open a gallery. Stash runs React 17, so there is no concurrent
  // rendering to be interrupted, and only our own node is touched — never a
  // sibling React manages.
  var host = ensureDetailHost();
  if (!host) return null;

  // A flag is drawn only when flags are on and the value is recognised.
  //
  // The space between the flag and the name is rendered only when there is a
  // flag, otherwise an unknown value — or any value with flags turned off —
  // would come out as "Language:  klingon" with two spaces.
  // The gap comes entirely from that space; the CSS adds no margin-right, so
  // the space before and after the flag match, and the row lines up with
  // "photographer: ..." above it.
  var showFlag = NS.showFlags && !!info.flag;

  return PluginApi.ReactDOM.createPortal(
    <h6 className="manga-tools-detail">
      {fieldLabel(intl) + ": "}
      {showFlag ? (
        <Flag flag={info.flag as string} className="manga-tools-flag" />
      ) : null}
      {showFlag ? " " : null}
      {info.name}
    </h6>,
    host
  );
}

// 4. Detail page: show the language as "flag + localised name", positioned
//    under "photographer".
//
//    Note the target is CustomFields (plural, the container), not CustomField —
//    the latter is a plain React.FC with no PatchComponent wrapper, so patching
//    it reports no error and simply never runs.
//    The language entry is lifted out of `values` (otherwise it would be
//    rendered twice) and everything else is handed to the original unchanged;
//    DetailLanguageRow renders that one entry under "photographer".
PluginApi.patch.instead("CustomFields", function () {
  var args = argsToArray(arguments);
  var props = args[0] as { values?: CustomFieldsMap; fullWidth?: boolean };
  var Original = originalFrom(args);
  noteFired("CustomFields");

  var values = props.values;
  if (!values || typeof values !== "object") return <Original {...props} />;

  var key: string | null = null;
  Object.keys(values).forEach(function (k) {
    if (key === null && k.toLowerCase() === FIELD_NAME) key = k;
  });
  if (key === null) return <Original {...props} />;

  var rest = Object.assign({}, values);
  delete rest[key];

  return (
    <>
      <Original {...props} values={rest} />
      <DetailLanguageRow value={values[key]} />
    </>
  );
});

// 5. Settings page: swap the stock per-setting input for the multiselect above,
//    but only for this plugin — every other plugin's settings go straight back
//    to the original component untouched.
PluginApi.patch.instead("PluginSettings", function () {
  var args = argsToArray(arguments);
  var props = args[0] as { pluginID?: string };
  var Original = originalFrom(args);
  noteFired("PluginSettings");

  if (props.pluginID === PLUGIN_ID) {
    return <MangaToolsSettings pluginID={props.pluginID} />;
  }

  return <Original {...props} />;
});

// 6. Bulk edit: records which galleries are selected. `before` only observes —
//    the props are handed straight back, so GalleryList renders exactly as it
//    would without the plugin. This is the only way to see the selection: the
//    dialog that uses it is not patchable.
PluginApi.patch.before("GalleryList", function () {
  var args = argsToArray(arguments);
  var props = args[0] as { selectedIds?: unknown };
  noteFired("GalleryList");
  captureSelection(props ? props.selectedIds : null);
  return args;
});

// 7. The gallery list's language filter, mounted from GalleryList for the same
//    reason the bulk row is mounted from RatingSystem: nothing in the filter
//    path itself is patchable (see language-filter.tsx), so a component that
//    renders on this page is used as a mount point. The section positions itself
//    by a DOM anchor inside the sidebar and reads the filter it is handed.
//
//    `GalleryList` is the list of cards, not the component that owns the sidebar
//    — which is why the section is placed by a DOM anchor rather than rendered
//    where it belongs. Stash's sidebar *could* host it: it registers
//    `FilteredGalleryList.SidebarSections` as a patchable wrapper around its own
//    filter sections. But the filter model lives inside `FilteredGalleryList`,
//    which does not pass it to that wrapper, and nothing patchable above the
//    wrapper holds it either. Publishing it from here was tried and does not
//    work: this component renders *after* the sidebar, so the section would read
//    an empty context and render nothing at all.
//
//    `instead` here rather than `before`: this one has to render. The two
//    coexist — Stash runs before-functions first and passes their result on, so
//    the selection above is still captured.
PluginApi.patch.instead("GalleryList", function () {
  var args = argsToArray(arguments);
  var props = args[0] as { filter?: MangaToolsFilterModel };
  var Original = originalFrom(args);
  noteFired("GalleryList.filter");

  // The filter dialog builds its cards from a shared options array that the
  // model reaches. Registering here is the first moment that array is in hand;
  // the call is idempotent and the array is only ever pushed to once.
  if (props.filter) registerLanguageCriterionOption(props.filter);

  return (
    <>
      <SidebarLanguageFilter filter={props.filter as MangaToolsFilterModel} />
      <DialogLanguageFilter filter={props.filter as MangaToolsFilterModel} />
      <Original {...props} />
    </>
  );
});

// 8. Bulk edit: mounts the language row into the bulk edit dialog. The dialog
//    itself is not a PatchComponent, so RatingSystem — the only patchable
//    component it renders — is used purely as a mount point; the row is
//    positioned by the DOM anchor and its value reaches the mutation through
//    installBulkLink, not through the dialog.
PluginApi.patch.instead("RatingSystem", function () {
  var args = argsToArray(arguments);
  var props = args[0] as object;
  var Original = originalFrom(args);
  noteFired("RatingSystem");

  return (
    <>
      <Original {...props} />
      <BulkLanguageRow />
    </>
  );
});

start();
