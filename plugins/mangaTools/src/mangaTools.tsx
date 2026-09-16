/**
 * Manga Tools — a toolbox that adapts Stash galleries to manga/comic management.
 *
 * Everything goes through the UI plugin API; no Stash core code is modified, so
 * Stash upgrades never produce merge conflicts.
 *
 * The language attribute lives in one of the Gallery's custom fields,
 * `plugin.mangaTools.language`. What is stored is the canonical code, not the
 * display name, and the name is looked up only when rendering — the same
 * approach Stash takes for performer nationality. It surfaces in five places:
 *
 *   - a flag badge on the bottom of the gallery card cover
 *   - a dropdown on the gallery edit page, so you never type a code by hand
 *   - the same dropdown in the bulk edit dialog, riding along with Apply
 *   - a collapsible block in the details tab, where the raw code would be — the
 *     language as its flag and localised name, the censorship mark beside it
 *   - a filter section in the gallery list's sidebar (language-filter.tsx),
 *     which narrows the list to one language
 *
 * A second attribute, the censorship mark, works the same way and lives in
 * `plugin.mangaTools.censorship`. It is a two-valued field rather than a boolean:
 * "not marked" is the absence of the key, which is what the selector's own clear
 * button produces. It surfaces in four places:
 *
 *   - a selector on the gallery edit page, beside the language one
 *   - a mark on the gallery detail page's toolbar, beside Stash's organized
 *     button — the same icons, but a mark rather than a control
 *   - a row in the details tab's block, as icon and word
 *   - an icon at the end of the gallery card's popover row, for the two marked
 *     states only — an unmarked gallery shows nothing, since most are unmarked
 *
 * `languages.ts` holds the codes and their flags, `fields.ts` the field names
 * and the generic read/write helpers, `language-filter.tsx` the sidebar filter.
 * Everything else is below.
 *
 * New features should keep the same shape: patches that hand anything they do
 * not own straight back to the original component, and shared data in a module
 * rather than on the window.
 *
 * The plugin is one bundled file. The modules imported below are inlined into
 * it, so Stash loads exactly the one file ui.javascript names in mangaTools.yml
 * and there is no load order left to get wrong.
 */
import "./fields";
import { NS } from "./languages";
import { t } from "./i18n";
import { requirePluginApi } from "./plugin-api";
import {
  DialogLanguageFilter,
  registerLanguageCriterionOption,
  SidebarLanguageFilter,
} from "./language-filter";
import type { ReactNode } from "react";
import type { MangaToolsFilterModel } from "./plugin-api";
import type {
  MangaToolsApolloClient,
  MangaToolsApolloOperation,
  MangaToolsCustomFields,
  MangaToolsIntl,
  MangaToolsOption,
  MangaToolsPatchFn,
} from "./plugin-api";

// Throws if Stash has not injected its API, the one thing that can go wrong at
// load time. Binding the result once gives every reference below a
// non-optional type without a single non-null assertion later on.
const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

const FIELD_NAME = NS.FIELD_NAME;
const CENSORSHIP_FIELD_NAME = NS.CENSORSHIP_FIELD_NAME;
const MANGA_FIELD_NAME = NS.MANGA_FIELD_NAME;

// The field names lowercased. Every read compares case-insensitively, so the
// left-hand side is lowercased and these are what it is compared against.
// Derived rather than written out, so the two can never drift apart.
const FIELD_KEY = FIELD_NAME.toLowerCase();
const CENSORSHIP_KEY = CENSORSHIP_FIELD_NAME.toLowerCase();

const PLUGIN_ID = "mangaTools";

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
const EDIT_ANCHOR = '.form-group[data-field="studio_id"]';
const BULK_ANCHOR = '[data-field="studio"]';

const REFRESH_MS = 60000;

/** The Gallery custom_fields map as it comes back from GraphQL */
type CustomFieldsMap = MangaToolsCustomFields;

/** Column class names copied off a native form row */
type NativeFieldClasses = { group: string; label: string; control: string };

/**
 * Pulls the original component out of a patch.instead callback's arguments.
 *
 * The official example writes `(props, _, original)`, but the number of
 * arguments passed depends on whether React supplies the legacy context, so a
 * hard-coded index can come back undefined. The last argument is always the
 * original component — reading it that way is safe either way.
 */
// biome-ignore lint/suspicious/noExplicitAny: the component a patch is handed // has no nameable type — its props differ per target, and it is used as JSX.
function originalFrom(args: unknown[]): any {
  return args[args.length - 1];
}

/**
 * Pulls the rendered result out of a patch.after callback's arguments.
 *
 * `after` is the one patch kind whose last argument is not a component: Stash
 * appends what everything before it produced — the original component's output,
 * or an `instead` function's — and the callback returns what should be rendered
 * in its place. Two accessors rather than one index for that reason: they look
 * interchangeable and are not, and mixing them up yields a component rendered as
 * a child rather than a crash.
 */
function resultFrom(args: unknown[]): ReactNode {
  return args[args.length - 1] as ReactNode;
}

/**
 * Registers a patch, and keeps one failing to register from taking the rest of
 * the plugin with it.
 *
 * A patch whose *target does not exist* is not what this guards: Stash only
 * pushes the callback onto a list, so a name it has never heard of registers
 * happily and simply never fires — which is what `noteFired`'s log is for.
 *
 * What it guards is the API surface itself. This file runs top to bottom at load
 * time, so a `PluginApi.patch` that is missing or renamed — a Stash older or
 * newer than this plugin expects — would throw here and stop the module, and
 * every patch *below* that point would silently never register. A half-working
 * plugin with no error is the worst of both outcomes; this turns it into one
 * line on the console naming the target that did not make it.
 */
function registerPatch(
  kind: "before" | "instead" | "after",
  target: string,
  fn: MangaToolsPatchFn
): void {
  try {
    PluginApi.patch[kind](target, fn);
  } catch (e) {
    console.error(
      "[mangaTools] could not register the " + target + " patch:",
      e
    );
  }
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
const firedOnce: { [target: string]: boolean } = {};

function noteFired(target: string): void {
  if (firedOnce[target]) return;
  firedOnce[target] = true;
  console.info("[mangaTools] patch active: " + target);
}

// ───────────────────────────── State ─────────────────────────────

/**
 * galleryId -> that gallery's custom fields.
 *
 * The whole map is kept rather than the values this plugin reads, because the
 * query fetches it whole anyway (a single key cannot be projected out of the
 * GraphQL Map scalar) and because a second field would otherwise mean a second
 * store. What is in here is only ever from a gallery that carries one of the
 * plugin's fields — see refresh().
 */
let store: Map<string, CustomFieldsMap> = new Map();

/** Subscribers: re-render when the store or the route changes */
const listeners: Set<() => void> = new Set();

let inFlight: Promise<unknown> | null = null;
let started = false;
let lastLoggedSize = -1;

/**
 * Current path. CustomFieldsInput is shared by every entity type, so this is
 * how we tell a gallery page apart from the rest.
 */
let currentPath = window.location.pathname || "";

function emit(): void {
  listeners.forEach((fn) => {
    fn();
  });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Subscribes to global state (data or route) and re-renders on change. */
function useGlobalVersion(): number {
  const state = React.useState(0);
  const version = state[0];
  const setVersion = state[1];

  React.useEffect(
    () =>
      subscribe(() => {
        setVersion((v) => v + 1);
      }),
    []
  );

  return version;
}

/**
 * Only show the language dropdown on gallery edit panels.
 *
 * CustomFieldsInput is shared by the scene, performer, studio, tag and image
 * edit panels. Without this check the language field would show up on every
 * one of them. A gallery detail page is /galleries/{id}, and the bulk edit
 * dialog opens over the gallery list at /galleries.
 */
function isGalleryContext(): boolean {
  return currentPath.indexOf("/galleries") === 0;
}

/**
 * The gallery id in the current URL, or "" when this is not one gallery's page.
 *
 * The detail page's toolbar belongs to a component that cannot be patched and is
 * handed no id, so the URL is the only place to read it from. isGalleryContext
 * is the same test, one segment coarser: this one needs the id, that one only
 * needs to know the plugin is on a gallery page at all.
 */
function currentGalleryId(): string {
  const m = /^\/galleries\/(\d+)(?:\/|$)/.exec(currentPath);
  return m ? m[1] : "";
}

// ───────────────────── Reading and writing custom fields ─────────────────────

/**
 * Reads the language value out of custom_fields.
 *
 * Two lines over the generic helper in fields.ts, so that the call sites below
 * say which field they mean rather than repeating its name.
 */
function pickLanguage(customFields: unknown): string {
  return NS.pickField(customFields, FIELD_NAME);
}

/**
 * The censorship mark a gallery's custom fields carry.
 *
 * Through normalizeCensorship, so anything that is not one of the two known
 * values — including a key this plugin did not write — reads as "not marked"
 * rather than being shown or guessed at.
 */
function censorshipOf(customFields: unknown): string {
  return NS.normalizeCensorship(
    NS.pickField(customFields, CENSORSHIP_FIELD_NAME)
  );
}

/** The censorship mark the store holds for a gallery */
function storedCensorship(galleryId: string): string {
  return censorshipOf(store.get(String(galleryId)));
}

/** Whether a custom-field key is one of ours, whatever its case */
function isOwnField(key: string): boolean {
  const k = key.toLowerCase();
  return k === FIELD_KEY || k === CENSORSHIP_KEY;
}

// ───────────────────────────── Fetching ─────────────────────────────

/**
 * A Gallery's custom_fields is the GraphQL Map scalar, and a single key cannot
 * be projected out of it. So we filter for galleries that have one of this
 * plugin's fields and fetch the whole map, then keep it in memory.
 *
 * **One query per field.** A gallery carrying only the censorship mark would
 * not be matched by a query filtered on the language field, and vice versa, and
 * the two cannot be asked for together: `OR` is singular in the schema
 * (`OR: GalleryFilterType`), not an array, and several criteria inside the
 * custom_fields array are ANDed, so listing both would mean "has both". Two
 * queries are the only way, and their answers are merged by gallery id.
 *
 * Each query spells its field name exactly. Asking for the case variants in one
 * query is impossible for the same reason, so one spelling per field is a hard
 * constraint, guaranteed by the dropdown that writes it. Reads and writes remain
 * case-insensitive (NS.pickField, NS.setField), so a key that has drifted in
 * case is still found and corrected on the next write — but a gallery whose key
 * drifted is not matched by this query, and so is missing from the map until
 * something writes it once.
 */
const QUERIES: { [field: string]: unknown } = {};

function getQuery(field: string): unknown {
  if (QUERIES[field]) return QUERIES[field];

  const Apollo = PluginApi.libraries.Apollo;
  const gql = Apollo?.gql || PluginApi.GQL?.gql;
  if (!gql) {
    console.error("[mangaTools] gql not available, cannot build the query");
    return null;
  }

  QUERIES[field] = gql(
    [
      "query MangaToolsMap {",
      "  findGalleries(",
      "    gallery_filter: {",
      '      custom_fields: [{ field: "' + field + '", modifier: NOT_NULL }]',
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

  return QUERIES[field];
}

/** What one query above returns, as far as this plugin cares */
type GalleriesPayload = {
  galleries?: Array<{ id: string; custom_fields?: CustomFieldsMap }>;
};

/**
 * Refetches the map. Concurrent calls share one in-flight request.
 *
 * Both queries run together and are merged; a gallery that carries both fields
 * is returned by both, with the same map, so the merge is a plain overwrite.
 */
function refresh(): Promise<unknown> {
  if (inFlight) return inFlight;

  const fields = [FIELD_NAME, CENSORSHIP_FIELD_NAME];
  const queries = fields.map(getQuery);
  if (queries.some((q) => !q)) return Promise.resolve();

  let client: MangaToolsApolloClient;
  try {
    client = PluginApi.utils.StashService.getClient();
  } catch (e) {
    console.error("[mangaTools] failed to get the Apollo client:", e);
    return Promise.resolve();
  }

  inFlight = Promise.all(
    queries.map((query) =>
      client.query({ query: query, fetchPolicy: "network-only" })
    )
  )
    .then((results) => {
      const next: Map<string, CustomFieldsMap> = new Map();
      results.forEach((res) => {
        const data = res?.data;
        const result = data
          ? (data.findGalleries as GalleriesPayload | undefined)
          : undefined;
        const galleries = result?.galleries || [];

        galleries.forEach((g) => {
          if (g.custom_fields) next.set(String(g.id), g.custom_fields);
        });
      });

      store = next;
      emit();

      // Only log when the count changes, so it does not spam every minute.
      // This line is the first thing to check when a badge does not show up:
      // if it says 0, the queries worked but no gallery carries either field,
      // so the problem is the data rather than the plugin.
      if (next.size !== lastLoggedSize) {
        lastLoggedSize = next.size;
        console.info(
          "[mangaTools] loaded custom fields for " + next.size + " gallery(ies)"
        );
      }
    })
    .catch((e) => {
      // Deliberately do not clear what we already have — stale values beat
      // none, and the next refresh will try again. Query syntax errors land
      // here too (Apollo throws GraphQL errors), so this log has to be loud.
      console.error(
        "[mangaTools] failed to fetch custom fields, marks will not show. Raw error:",
        e
      );
    })
    .then(() => {
      inFlight = null;
    });

  // Assigned in the try above: every path through the catch has returned.
  return inFlight!;
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
let SETTINGS_QUERY: unknown = null;

function getSettingsQuery(): unknown {
  if (SETTINGS_QUERY) return SETTINGS_QUERY;

  const Apollo = PluginApi.libraries.Apollo;
  const gql = Apollo?.gql || PluginApi.GQL?.gql;
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
  const query = getSettingsQuery();
  if (!query) return;

  let client: MangaToolsApolloClient;
  try {
    client = PluginApi.utils.StashService.getClient();
  } catch (e) {
    console.error("[mangaTools] failed to get the Apollo client:", e);
    return;
  }

  client
    // no-cache rather than network-only: `configuration` is a singleton with no
    // id, and writing a result like that into Apollo's normalised cache is what
    // makes it complain that ConfigResult "either needs an ID or a custom merge
    // function" — on every page load, from a read this plugin does not want
    // cached in the first place. It is re-read on every navigation anyway.
    .query({ query: query, fetchPolicy: "no-cache" })
    .then((res) => {
      const data = res?.data as SettingsPayload | undefined;
      const plugins = data?.configuration?.plugins;
      const pluginCfg = plugins?.[PLUGIN_ID];
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
    .catch((e) => {
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
  window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, REFRESH_MS);

  if (PluginApi.Event?.addEventListener) {
    PluginApi.Event.addEventListener("stash:location", (e) => {
      const ev = e as LocationEvent;
      const loc = ev?.detail?.data?.location;
      currentPath = loc?.pathname || window.location.pathname || "";
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
  const pending = inFlight;
  if (pending) {
    // inFlight is cleared by this promise's own final handler, which runs
    // before this callback, so refresh() starts a genuinely new request.
    pending.then(() => {
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
  const locale = useLocale();

  const info = NS.describe(
    pickLanguage(store.get(String(props.galleryId))),
    locale
  );
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

// ─────────────────────────── Censorship mark ───────────────────────────

/**
 * The icon for a censorship state.
 *
 * The pairing is a Chinese pun rather than anything to do with chess: 步兵,
 * "infantry", is what a censored release is *not*, and 骑兵, "cavalry", is what
 * it is — by way of the mosaic a censor lays over the page. A pawn and a knight
 * say the same thing in one glyph each. The joke is deliberately explained
 * nowhere on screen: the icons carry it, and a tooltip that spelled it out would
 * be a tooltip about a word rather than about the gallery.
 *
 * `faChessBoard` is the unmarked state, and it earns its place twice over — it is
 * the third member of the same set, so the button reads as one control with three
 * states rather than as a chess piece beside a UI glyph, and a board with nothing
 * on it *is* "nothing marked yet". It even looks a little like the mosaic the
 * other two are named after, which the dimmed grey helps along.
 *
 * No fallback name is needed, unlike `faXmark` in language-filter.tsx: chess-board
 * has been spelled that way in every FontAwesome since 5, so whichever version
 * Stash bundles answers to it.
 */
function censorshipIcon(value: string): unknown {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const name = CENSORSHIP_ICONS[value] || CENSORSHIP_ICONS[""];
  const icon = Solid[name];
  if (!icon) {
    // The lookup is by string, at runtime, so a name the bundled set does not
    // have comes back undefined — and undefined handed to Stash's Icon *throws
    // inside a render*, which takes the whole page down rather than one glyph.
    // The names below are checked against the wrong source by nature:
    // FontAwesome's docs list every version, not the subset this Stash ships.
    noteMissingIcon(name);
    return null;
  }
  return icon;
}

/** The one place the three icon names are written down, so the log can name them */
const CENSORSHIP_ICONS: { [value: string]: string } = {
  censored: "faChessKnight",
  uncensored: "faChessPawn",
  "": "faChessBoard",
};

/** Names already reported, so a page of galleries does not print a page of logs */
const missingIcons: { [name: string]: boolean } = {};

function noteMissingIcon(name: string): void {
  if (missingIcons[name]) return;
  missingIcons[name] = true;
  console.error(
    "[mangaTools] this Stash's FontAwesome has no " +
      name +
      ", so that icon is drawn as nothing. Run this in the console to see which " +
      "names it does have: window.PluginApi.libraries.FontAwesomeSolid." +
      name
  );
}

/**
 * The state's icon, or nothing at all when this Stash has no such name.
 *
 * A component rather than a bare `<Icon icon={censorshipIcon(...)} />`, so that a
 * name the bundled icon set does not have costs one glyph instead of throwing
 * through a render — which on a detail page means the page, not the icon.
 */
function CensorshipIcon(props: { value: string }) {
  const Icon = PluginApi.components.Icon;
  const icon = censorshipIcon(props.value);
  return icon ? <Icon icon={icon} /> : null;
}

/**
 * One censorship option: the state's icon, then its name.
 *
 * react-select draws this for the menu item and for the value in the box, so the
 * two always agree — which is the same arrangement as the language dropdown's
 * flag. `.manga-tools-option` is the class that spaces the two apart.
 */
function formatCensorshipOption(option: { value: string; label: string }) {
  return (
    <span className="manga-tools-option">
      <CensorshipIcon value={option.value} />
      {option.label}
    </span>
  );
}

/** The plugin's own word for a state, for a tooltip or a label */
function censorshipLabel(intl: MangaToolsIntl, value: string): string {
  if (value === "censored") return t(intl, "mangaTools.censorship.censored");
  if (value === "uncensored")
    return t(intl, "mangaTools.censorship.uncensored");
  return t(intl, "mangaTools.censorship.unset");
}

/** Class of the empty span kept beside Stash's popover row, one per card */
const POPOVER_ANCHOR_CLASS = "manga-tools-popover-anchor";
/** Class of the node inside that row that our button is portalled into */
const POPOVER_SLOT_CLASS = "manga-tools-popover-slot";
/** Marks a row this plugin had to make, because Stash drew none */
const POPOVER_ROW_CLASS = "manga-tools-popovers";

/**
 * Forces one more render once a component has mounted.
 *
 * Every mount point below is found by looking in the document, and the first
 * render of a page happens *before* React has committed any of it: a lookup at
 * that point sees the previous page's markup, which on a load is nothing at all.
 * Effects flush after the commit, so the extra render this asks for is the first
 * one that can see the toolbar. One bump and not a loop: the dependency list is
 * empty, so the effect never runs twice.
 *
 * A layout effect rather than a plain one, for the reason the other mount points
 * give: it runs after React has written the DOM but before the browser paints,
 * which is the only window in which the second render is invisible. A plain
 * effect would leave the button missing for a frame.
 *
 * The tests' React stub runs the callback immediately and its state setter is
 * inert, so under the stub this is a no-op — which is sound, because a test
 * builds the DOM it wants found *before* calling the component.
 */
function useAfterMount(): void {
  const bump = React.useState(0)[1];
  React.useLayoutEffect(() => {
    bump(1);
  }, []);
}

/**
 * Whether an element carries a class.
 *
 * Read off `className` rather than through `classList`: the smoke tests' DOM
 * stub has the former and not the latter, and a class name is all this needs.
 */
function hasClass(el: Element | null, name: string): boolean {
  return !!el && (el.className || "").split(/\s+/).indexOf(name) >= 0;
}

/**
 * Finds (creating if needed) the node to portal a card's mark into: the last
 * child of Stash's own `.card-popovers` row.
 *
 * Why a portal *into* Stash's row, rather than a second row of our own: the row
 * is a flex container, so anything rendered beside it lands on a line of its own
 * instead of being another button on this one.
 *
 * The anchor is the empty span the caller renders next to that row, carrying the
 * gallery id. Searching for *that* is what makes the row found the right one: a
 * gallery appears in exactly one card in Stash's list, so the id names one anchor
 * — where `.card-popovers` alone would match the first row on the page however
 * far down it this card is. If a gallery ever did appear twice, the mark would
 * go to the first of them and the second would go without.
 *
 * A card with no image count, no tags, no performers, no scenes and no organized
 * mark has no row at all. One is then created with the classes Stash uses, so it
 * is indistinguishable from the real thing — because there is no real thing to
 * be distinguished from.
 */
function ensurePopoverSlot(galleryId: string): HTMLElement | null {
  const anchor = document.querySelector(
    '[data-gallery="' + galleryId + '"]'
  ) as HTMLElement | null;
  if (!anchor?.parentNode) return null;

  const previous = anchor.previousElementSibling;
  let row: Element;

  if (
    hasClass(previous, "card-popovers") ||
    hasClass(previous, POPOVER_ROW_CLASS)
  ) {
    row = previous as Element;
  } else {
    row = document.createElement("div");
    row.className = "btn-group card-popovers " + POPOVER_ROW_CLASS;
    anchor.parentNode.insertBefore(row, anchor);
  }

  let slot: Element | null = null;
  for (let i = 0; i < row.children.length; i++) {
    if (hasClass(row.children[i], POPOVER_SLOT_CLASS)) {
      slot = row.children[i];
      break;
    }
  }

  if (slot) {
    // Stash re-renders its row and can leave ours in the middle of it; the mark
    // belongs after Stash's own buttons, which is where they still are.
    if (row.lastElementChild !== slot) row.appendChild(slot);
    return slot as HTMLElement;
  }

  slot = document.createElement("span");
  slot.className = POPOVER_SLOT_CLASS;
  row.appendChild(slot);
  return slot as HTMLElement;
}

/**
 * The censorship mark at the end of a card's popover row, or null when the
 * gallery carries no mark.
 *
 * An anchor plus a portal rather than the button itself, because the row it
 * belongs in is Stash's and React does not own it — see ensurePopoverSlot. The
 * anchor is rendered on every pass so there is always exactly one to find; on
 * the pass that also has a slot to draw, the two go out together.
 *
 * `useAfterMount` is what turns the anchor of this render into the slot of the
 * next one, on a real page: the anchor is not in the document until this render
 * has been committed.
 */
function CensorshipPopoverMark(props: { galleryId: string }) {
  useGlobalVersion();
  useAfterMount();

  // Read here rather than bound at module scope: plugin scripts can run before
  // Stash has registered its components, so a module-level read can come back
  // undefined and never recover. language-filter.tsx reads it the same way.
  const intl = PluginApi.libraries.Intl.useIntl();
  const value = storedCensorship(props.galleryId);
  const slot = value ? ensurePopoverSlot(props.galleryId) : null;

  if (!value) return null;

  return (
    <>
      <span className={POPOVER_ANCHOR_CLASS} data-gallery={props.galleryId} />
      {slot
        ? PluginApi.ReactDOM.createPortal(
            <button
              type="button"
              className="minimal btn btn-primary manga-tools-mark"
              title={censorshipLabel(intl, value)}
            >
              <CensorshipIcon value={value} />
            </button>,
            slot
          )
        : null}
    </>
  );
}

// ────────────────────────── Gallery toolbar ──────────────────────────

/** Class of the mount point in the gallery toolbar */
const TOOLBAR_HOST_CLASS = "manga-tools-toolbar-host";

/**
 * Whether this Stash has the mutation the switch writes through.
 *
 * Asked once, at load, because `useGalleryUpdate` is a hook and hooks cannot be
 * called conditionally — so the decision has to be made before the component that
 * calls it is rendered. Stash injects StashService itself (it is a namespace
 * import of `src/core/StashService`), so a version without this function is the
 * only way the lookup fails, and on such a version the toolbar gets nothing
 * rather than a switch that cannot work.
 */
const CAN_WRITE =
  typeof PluginApi.utils.StashService.useGalleryUpdate === "function";

if (!CAN_WRITE) {
  console.error(
    "[mangaTools] this Stash has no useGalleryUpdate, so the toolbar switch " +
      "cannot be shown. The rest of the plugin is unaffected."
  );
}

/** As with the other mount points, held at module scope so a re-render reuses
 *  the same node rather than making a new one every time. */
let toolbarHost: HTMLElement | null = null;

/**
 * Finds (creating if needed) the mount point in the gallery detail page's
 * toolbar, directly after the span holding Stash's organized button.
 *
 * Why the DOM at all: the toolbar is rendered by `Gallery`, which is not a
 * registered component, so there is no patch to hang a React child off — the
 * same situation as the detail row (see ensureDetailHost).
 *
 * Why that button and not the group's two spans by position: the second span is
 * the operation menu, whose contents depend on the entity and on the user's
 * settings. The organized button is drawn for every gallery, on every version,
 * in a group of its own, which makes it the one stable handle in there.
 *
 * Scoped to `.gallery-toolbar`, so the bulk edit dialog's organized button —
 * same class, different place — is never mistaken for it.
 */
function ensureToolbarHost(): HTMLElement | null {
  const button = document.querySelector(".gallery-toolbar .organized-button");
  const anchor = (button?.parentNode || null) as HTMLElement | null;
  if (!anchor?.parentNode) {
    toolbarHost = null;
    return null;
  }

  if (!toolbarHost) {
    toolbarHost = document.createElement("span");
    toolbarHost.className = TOOLBAR_HOST_CLASS;
  }

  // A React re-render may displace it; keep it directly after that span, which
  // puts it between the organized button and the operation menu.
  if (anchor.nextElementSibling !== toolbarHost) {
    anchor.parentNode.insertBefore(toolbarHost, anchor.nextElementSibling);
  }

  return toolbarHost;
}

/**
 * The gallery detail page's censorship mark, on the toolbar.
 *
 * This was the control: a button that cycled through the three states and wrote
 * whichever it landed on. It is a mark now, because the edit page has a selector
 * for the same field and a selector has no third state to explain — unset is its
 * own clear button, exactly as it is for the language. So there is nothing left
 * for this to do beyond saying what the gallery is.
 *
 * Kept rather than deleted because the icon up here is wanted for something else
 * later. It is a `<span>`, not a button, so that a mark does not look like
 * something to click.
 */
/**
 * The mark's icon.
 *
 * A span with a mask rather than an `<svg>`: the artwork is a file, shipped as
 * downloaded with its attribution comment intact, and a file cannot see the
 * page's `currentColor` — that only works for markup inlined into the page. A CSS
 * mask reads the shape and ignores the colour, so the file supplies one and
 * `background-color` supplies the other, and the two states are a colour rule
 * each. See .manga-tools-manga-icon in mangaTools.css.
 */
function MangaIcon() {
  return <span className="manga-tools-manga-icon" aria-hidden="true" />;
}

/**
 * The spelling of a key a gallery actually carries, or the canonical name.
 *
 * The click below removes a key rather than writing an empty value, and removing
 * it by name only works for the spelling the gallery really has — a key that
 * drifted in case would otherwise survive the click and the mark would appear not
 * to clear.
 */
function storedKey(customFields: unknown, name: string): string {
  const map = (customFields || {}) as CustomFieldsMap;
  if (typeof map !== "object") return name;

  const key = name.toLowerCase();
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === key) return keys[i];
  }
  return name;
}

/**
 * What this plugin puts in the gallery toolbar.
 *
 * The switch first, because it is the entry point: a gallery that does not carry
 * the mark is a plain Stash gallery as far as this plugin is concerned, and the
 * switch is the only thing it shows there. Everything else it does appears once
 * the mark is on — which is why the censorship mark beside it is conditional and
 * the switch is not.
 *
 * One click, like the organized button next to it, and for the same reason:
 * saying "this one is manga" is not editing the gallery, so it should not mean
 * opening the edit tab and saving a form. That does mean it writes immediately
 * rather than riding Save — the one place this plugin writes on its own, and the
 * reason it reaches for Stash's own gallery-update mutation.
 */
function GalleryToolbar(props: { galleryId: string; values: CustomFieldsMap }) {
  useGlobalVersion();
  useAfterMount();

  const intl = PluginApi.libraries.Intl.useIntl();
  const update = PluginApi.utils.StashService.useGalleryUpdate();
  const state = React.useState(false);
  const busy = state[0];
  const setBusy = state[1];

  const host = ensureToolbarHost();
  if (!host) return null;

  const marked = NS.isManga(props.values);

  const onToggle = () => {
    const input: Record<string, unknown> = { id: props.galleryId };
    input.custom_fields = marked
      ? { remove: [storedKey(props.values, MANGA_FIELD_NAME)] }
      : { partial: { [MANGA_FIELD_NAME]: NS.MANGA_VALUE } };

    setBusy(true);
    update[0]({ variables: { input } }).then(
      () => setBusy(false),
      (e: unknown) => {
        setBusy(false);
        console.error("[mangaTools] could not write the manga mark:", e);
      }
    );
  };

  return PluginApi.ReactDOM.createPortal(
    <>
      <button
        type="button"
        className={
          "minimal manga-tools-manga-toggle btn btn-secondary" +
          (marked ? " is-manga" : "")
        }
        title={t(
          intl,
          marked ? "mangaTools.manga.marked" : "mangaTools.manga.mark"
        )}
        aria-pressed={marked}
        disabled={busy}
        onClick={onToggle}
      >
        <MangaIcon />
      </button>

      {marked ? (
        <span
          className={
            "manga-tools-censorship-mark" +
            (censorshipOf(props.values)
              ? " is-" + censorshipOf(props.values)
              : " is-unmarked")
          }
          title={censorshipLabel(intl, censorshipOf(props.values))}
        >
          <CensorshipIcon value={censorshipOf(props.values)} />
        </span>
      ) : null}
    </>,
    host
  );
}

// ─────────────────────────── Edit-page dropdown ───────────────────────────

/**
 * react-select is a namespace import on PluginApi.libraries, and the component
 * is its default export. It is looked up at runtime, so there is no static
 * type to give it.
 */
// biome-ignore lint/suspicious/noExplicitAny: react-select is reached through a namespace import at runtime, so its component has no static type.
let SELECT: any = null;

// biome-ignore lint/suspicious/noExplicitAny: as above — the component itself.
function resolveSelect(): any {
  if (SELECT) return SELECT;

  const RS = PluginApi.libraries.ReactSelect;
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
  const anchor = document.querySelector(anchorSelector);
  if (!anchor) return null;

  const label = anchor.querySelector("label");
  const control = label?.nextElementSibling;
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
function MangaFieldBlock(props: {
  values?: CustomFieldsMap;
  onChange?: (values: CustomFieldsMap) => void;
}) {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();
  const state = React.useState(FIELD_OPEN_BY_DEFAULT);
  const open = state[0];
  const setOpen = state[1];
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Button = PluginApi.libraries.Bootstrap?.Button;

  // The mount point is read during render (same approach as the detail page).
  // ensureFieldHost is idempotent and returns null when the anchor is absent.
  const host = isGalleryContext() ? ensureFieldHost() : null;

  const bump = React.useState(0)[1];

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
  React.useLayoutEffect(() => {
    if (isGalleryContext() && ensureFieldHost() !== host) {
      bump((v) => v + 1);
    }
  });

  if (!isGalleryContext() || !Select || !host) return null;

  // One writer for both rows: Stash's form owns the values map, so each row
  // hands it a new map rather than writing anything itself. That is what makes
  // Save persist the language and the mark together, and Cancel discard both.
  const write = (name: string, value: string) => {
    if (props.onChange) {
      props.onChange(NS.setField(props.values, name, value));
    }
  };

  const current = NS.describe(pickLanguage(props.values), intl.locale);
  let options: MangaToolsOption[] = NS.languageOptions(intl.locale).filter(
    (o) => {
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

  const selected = current
    ? { value: current.code, label: current.name, flag: current.flag }
    : null;

  // Column widths come from the native field; this is the fallback.
  const cls = readNativeFieldClasses(EDIT_ANCHOR) || {
    group: "form-group row",
    label: "form-label col-form-label col-sm-3",
    control: "col-sm-9",
  };

  const languageField = (
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
          placeholder={t(intl, "mangaTools.select.placeholder")}
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
          onChange={(opt: MangaToolsOption | null) => {
            write(FIELD_NAME, opt ? opt.value : "");
          }}
        />
      </div>
    </div>
  );

  // The mark, as a two-option selector rather than the cycle the toolbar used to
  // carry. Two options and a clear button cover the three states exactly, and the
  // reason the old control needed a third icon — "not marked" — was that a cycle
  // has to name every state it can reach. A selector does not: not marked *is*
  // nothing selected.
  const mark = censorshipOf(props.values);
  const markOptions = [
    { value: "censored", label: t(intl, "mangaTools.censorship.censored") },
    {
      value: "uncensored",
      label: t(intl, "mangaTools.censorship.uncensored"),
    },
  ];
  const markSelected = markOptions.find((o) => o.value === mark) || null;

  const markField = (
    <div className={cls.group} data-field="manga_tools_censorship">
      <label className={cls.label} htmlFor="manga_tools_censorship">
        {t(intl, "mangaTools.censorship.heading")}
      </label>
      <div className={cls.control}>
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_censorship"
          isClearable
          isSearchable={false}
          // The placeholder is the third state's name, so it reads the same as
          // the row in the details block: 未标注 rather than an empty box.
          placeholder={t(intl, "mangaTools.censorship.unset")}
          value={markSelected}
          options={markOptions}
          components={{ IndicatorSeparator: () => null }}
          // The same treatment the language options get: an icon cannot live
          // inside a plain-text label, so the option is drawn here.
          formatOptionLabel={formatCensorshipOption}
          onChange={(opt: { value: string } | null) => {
            write(CENSORSHIP_FIELD_NAME, opt ? opt.value : "");
          }}
        />
      </div>
    </div>
  );

  // The field row is not wrapped in the disclosure, it is *shown or not shown* by
  // it, and that is deliberate: wrapping it would put a box between the row and
  // the padded column its negative margins cancel against, which is the whole
  // reason the mount point above is `display: contents`. Folding this way costs
  // the height animation — the fold is instant — and keeps the columns lined up
  // with the native fields, which is the property that took the work.
  //
  // The header does need a row of its own, or it would sit outside the form's
  // column grid; it borrows the same column classes as the rows around it.
  return PluginApi.ReactDOM.createPortal(
    <div className="manga-tools-panel">
      <div className={cls.group}>
        <div className="col-12">
          <div className="collapse-header">
            {Button ? (
              <Button
                className="minimal collapse-button"
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                <Icon
                  icon={open ? Solid.faChevronDown : Solid.faChevronRight}
                  fixedWidth
                />
                <span>{t(intl, "mangaTools.panel.heading")}</span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {open ? languageField : null}
      {open ? markField : null}
    </div>,
    host
  );
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
  const Bootstrap = PluginApi.libraries.Bootstrap;
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
          onChange={() => {
            props.onChange(!props.checked);
          }}
        />
      </div>
    </div>
  );
}

function MangaToolsSettings(props: { pluginID: string }) {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();

  const savePlugin = PluginApi.utils.StashService.useConfigurePlugin()[0];

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
    }).catch((e) => {
      console.error("[mangaTools] failed to save plugin settings:", e);
    });
  }

  const options: MangaToolsOption[] = NS.languageOptions(intl.locale);
  const enabled = NS.enabledLanguages;
  // null (no restriction) renders an empty box whose placeholder reads
  // "All languages", rather than filling the box with every tag. A non-empty
  // selection renders exactly those tags.
  const value = enabled ? options.filter((o) => enabled?.has(o.value)) : [];

  if (!Select) return null;

  return (
    <>
      <div className="setting manga-tools-settings">
        <div className="manga-tools-settings-block">
          <h3>{t(intl, "mangaTools.settings.enabledLanguages.heading")}</h3>
          <div className="sub-heading">
            {t(intl, "mangaTools.settings.enabledLanguages.description")}
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
              placeholder={t(
                intl,
                "mangaTools.settings.enabledLanguages.placeholder"
              )}
              value={value}
              options={options}
              formatOptionLabel={formatLanguageOption}
              components={{ IndicatorSeparator: () => null }}
              onChange={(selected: MangaToolsOption[] | null) => {
                const codes = (selected || []).map((o) => o.value);

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
        heading={t(intl, "mangaTools.settings.showFlags.heading")}
        subHeading={t(intl, "mangaTools.settings.showFlags.description")}
        checked={NS.showFlags}
        onChange={(next) => {
          NS.showFlags = next;
          emit();
          persist();
        }}
      />

      <BooleanSetting
        id="mangaTools-showCoverBadge"
        heading={t(intl, "mangaTools.settings.showCoverBadge.heading")}
        subHeading={t(intl, "mangaTools.settings.showCoverBadge.description")}
        checked={NS.showCoverBadge}
        onChange={(next) => {
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
let bulkPending: BulkLanguagePending | null = null;

/** Ids currently selected in the gallery list, captured from GalleryList */
let selectedGalleryIds: string[] = [];

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
  const next: string[] = [];
  if (
    selectedIds &&
    typeof (selectedIds as { forEach?: unknown }).forEach === "function"
  ) {
    (selectedIds as Set<string>).forEach((id) => {
      next.push(String(id));
    });
  }

  const unchanged =
    next.length === selectedGalleryIds.length &&
    next.every((id, i) => id === selectedGalleryIds[i]);

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

  const first = pickLanguage(store.get(selectedGalleryIds[0]));
  for (let i = 1; i < selectedGalleryIds.length; i++) {
    if (pickLanguage(store.get(selectedGalleryIds[i])) !== first) return null;
  }

  return first || null;
}

/** Set once, so the link chain is never wrapped twice */
let bulkLinkInstalled = false;

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
  const defs = query
    ? (query as { definitions?: unknown[] }).definitions
    : null;
  if (!defs?.length) return false;

  const op = defs[0] as {
    kind?: string;
    selectionSet?: { selections?: Array<{ name?: { value?: string } }> };
  };
  if (op?.kind !== "OperationDefinition") return false;

  const selections = op.selectionSet?.selections;
  if (!selections?.length) return false;

  const first = selections[0];
  return !!(first?.name && first.name.value === "bulkGalleryUpdate");
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
  if (bulkPending?.kind !== "set") return false;

  // The route is checked here as well as by the row's mount, so "a language is
  // only ever written on a gallery page" is a stated constraint rather than a
  // consequence of where the row happens to render.
  if (!isGalleryContext()) return false;

  if (!isGalleryBulkUpdate(operation.query)) return false;

  const input = operation.variables
    ? (operation.variables.input as { ids?: unknown } | undefined)
    : undefined;
  if (!input || !Array.isArray(input.ids)) return false;

  const fields = { partial: { [FIELD_NAME]: bulkPending.value } };

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

  const Apollo = PluginApi.libraries.Apollo;
  let client: MangaToolsApolloClient;
  try {
    client = PluginApi.utils.StashService.getClient();
  } catch (e) {
    console.error("[mangaTools] failed to get the Apollo client:", e);
    return;
  }

  if (
    !Apollo?.ApolloLink ||
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
  const previous = client.link;

  client.setLink(
    Apollo.ApolloLink.from([
      new Apollo.ApolloLink((operation, forward) => {
        if (!applyPendingLanguage(operation)) {
          return forward(operation);
        }

        console.info(
          "[mangaTools] bulk update: sending the language with the dialog's own update"
        );

        // Cleared only once the update actually succeeded, so a failed Apply
        // can simply be retried with the row still filled in.
        return forward(operation).map((result) => {
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

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();

  const host = isGalleryContext() ? ensureBulkFieldHost() : null;
  const bump = React.useState(0)[1];

  // Same first-render problem as LanguageRow: the dialog mounts this component
  // from its rating row, which renders **before** the studio row it has to
  // anchor on has been committed to the DOM. The effect runs after the commit,
  // and one extra render is all it takes.
  // As in LanguageRow: before paint, so this pass adds no step of its own.
  React.useLayoutEffect(() => {
    if (isGalleryContext()) {
      installBulkLink();
      if (ensureBulkFieldHost() !== host) {
        bump((v) => v + 1);
      }
    }
  });

  // Losing the row means the dialog closed, so the pending value is no longer
  // wanted. Checked against the DOM rather than unconditionally, so an
  // unrelated re-render cannot throw the value away while the dialog is open.
  React.useEffect(
    () => () => {
      if (!document.querySelector(BULK_ANCHOR)) {
        bulkPending = null;
      }
    },
    []
  );

  if (!isGalleryContext() || !Select || !host) return null;

  let options: MangaToolsOption[] = NS.languageOptions(intl.locale).filter(
    (o) => !NS.enabledLanguages || NS.enabledLanguages.has(o.value)
  );

  const pending = bulkPending;

  // Show exactly what is about to happen: what the user picked, otherwise the
  // selection's shared language. A mixed selection shows the placeholder — the
  // same way the studio field behaves.
  const shown =
    pending && pending.kind === "set"
      ? pending.value
      : pending
        ? ""
        : selectedLanguageAggregate() || "";

  const current = shown ? NS.describe(shown, intl.locale) : null;

  // A code that is not in the enabled list still has to be shown while it is
  // sitting in the row, or the selection would look like it was ignored.
  const currentCode = current ? current.code : "";
  if (current && !options.some((o) => o.value === currentCode)) {
    options = [
      { value: current.code, label: current.name, flag: current.flag },
      ...options,
    ];
  }

  const selected = current
    ? { value: current.code, label: current.name, flag: current.flag }
    : null;

  const cls = readNativeFieldClasses(BULK_ANCHOR) || {
    group: "row",
    label: "col-form-label col-3",
    control: "col-9",
  };

  const field = (
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
          placeholder={t(intl, "mangaTools.select.placeholder")}
          value={selected}
          options={options}
          formatOptionLabel={formatLanguageOption}
          components={{ IndicatorSeparator: () => null }}
          // Clearing means "leave the language alone", exactly as clearing the
          // studio field means "leave the studio alone" — neither sends a value.
          onChange={(opt: MangaToolsOption | null) => {
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

// ─────────────────────────── The manga panel ───────────────────────────
//
// The gallery's manga attributes, as a collapsible block in the details tab.
// A disclosure rather than a tab this plugin injects into Stash's tab bar: it
// owns its own open state and nothing else's, which is the entire difference —
// a tab would have to agree with react-bootstrap about which tab is active, and
// that is what made the first attempt at this too fragile to keep.
//

/**
 * Renders nothing rather than taking the page with it, and says so.
 *
 * For the block this plugin adds to the details tab, so that a mistake in it
 * costs one section rather than the whole page: React 17 answers a throw inside a
 * render by unmounting the tree, which is what left the app sitting on "Loading"
 * while this was being built. A boundary turns that into a log line naming the
 * block.
 */
class GuardedBlock extends React.Component<
  { name: string; children?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(
      "[mangaTools] the " +
        this.props.name +
        " threw while rendering, so it is " +
        "not on the page. Everything else the plugin does is unaffected.",
      error
    );
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Whether the block starts open.
 *
 * Collapsed, because the details tab already has a lot on it and the header is
 * what says this section exists. One word to change if that reads as hidden
 * rather than tidy.
 */
const PANEL_OPEN_BY_DEFAULT = false;

/**
 * The same block on the gallery edit page, and the opposite default.
 *
 * Open, because there it is not a section of a page full of sections — it is a
 * field, and the dropdown inside it is the only way to set a language at all.
 * A fold that starts closed would be a fold over the feature.
 */
const FIELD_OPEN_BY_DEFAULT = true;

/**
 * The gallery's manga attributes, as labelled rows.
 *
 * Deliberately rendered whether or not anything is set, with a dash for an
 * unset value: the panel is a place for these attributes, so an empty one is
 * still the answer to "where would this go". (If this is ever shipped outside the
 * experiment that is worth revisiting — the rest of the plugin keeps an unset
 * value quiet.)
 */
function MangaDetailsPanel(props: { values: CustomFieldsMap }) {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const state = React.useState(PANEL_OPEN_BY_DEFAULT);
  const open = state[0];
  const setOpen = state[1];

  const language = NS.describe(pickLanguage(props.values), intl.locale);
  const mark = censorshipOf(props.values);
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Button = PluginApi.libraries.Bootstrap?.Button;
  const Collapse = PluginApi.libraries.Bootstrap?.Collapse;

  // The same mount point the plain language row used: the end of .gallery-details,
  // which lands after "photographer" and before "details".
  const host = ensureDetailHost();
  if (!host) return null;

  // The flag and the space before the name are conditional, and both for the same
  // reason: an unknown value has no flag, and a row that always put a space there
  // would read "Language:  klingon".
  const showFlag = NS.showFlags && !!language?.flag;

  // Two <h6>s, exactly as the rows above and below are drawn — the pieces are
  // separate children rather than a label and a value in a wrapper, so the text
  // nodes come out the way Stash's own rows produce them.
  const body = (
    <div className="manga-tools-panel-body">
      <h6 className="manga-tools-detail">
        {fieldLabel(intl) + ": "}
        {showFlag ? (
          <Flag flag={language?.flag as string} className="manga-tools-flag" />
        ) : null}
        {showFlag ? " " : null}
        {language ? language.name : "—"}
      </h6>
      <h6 className="manga-tools-detail">
        {t(intl, "mangaTools.censorship.heading") + ": "}
        <CensorshipIcon value={mark} />
        {mark ? " " : null}
        {censorshipLabel(intl, mark)}
      </h6>
    </div>
  );

  return PluginApi.ReactDOM.createPortal(
    <div className="manga-tools-panel">
      {/*
        Stash's own collapsible section, reproduced rather than invented: the
        classes are `components/Shared/CollapseButton.tsx`'s, and its stylesheet is
        what makes this look like the rest of the page. `minimal` is the class
        that gives a button the page's text colour — without it a bare <button>
        keeps the browser's own, which is black whatever the theme.
      */}
      <div className="collapse-header">
        {Button ? (
          <Button
            className="minimal collapse-button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Icon
              icon={open ? Solid.faChevronDown : Solid.faChevronRight}
              fixedWidth
            />
            <span>{t(intl, "mangaTools.panel.heading")}</span>
          </Button>
        ) : null}
      </div>

      {/* With no Bootstrap at all the body simply shows — degraded, not hidden. */}
      {Collapse ? <Collapse in={open}>{body}</Collapse> : body}
    </div>,
    host
  );
}

// ───────────────────────────── Patch registration ─────────────────────────────

// 1. The badge on the bottom of the gallery card cover.
//
//    `after`, not `instead`: nothing about Stash's own output is being changed,
//    only added to. That is what lets the original component be left alone —
//    GalleryCard.Overlays uses useMemo internally, so calling it directly (as the
//    official example does) is exactly the thing not to do, and `after` never
//    calls it at all.
registerPatch("after", "GalleryCard.Overlays", (...args: unknown[]) => {
  const props = args[0] as { gallery?: { id?: string } };
  const result = resultFrom(args);
  noteFired("GalleryCard.Overlays");

  const id = props.gallery?.id;
  const value = id ? pickLanguage(store.get(String(id))) : "";

  // Nothing to add: the gallery has no language, or the badge is turned off.
  if (!value || !NS.showCoverBadge) return result;

  return (
    <>
      {result}
      <LanguageBadge galleryId={id as string} />
    </>
  );
});

// 1b. The censorship mark at the end of the same card's popover row.
//
//     Deliberately not another cover badge: the language badge is a flag, which
//     reads at a glance, while "censored" is a property you look up rather than
//     scan for — and two overlapping chips on one cover would fight. The popover
//     row is where Stash already puts this kind of attribute (organized, and the
//     two counts), and it costs nothing on the covers of the many galleries that
//     carry no mark at all.
registerPatch("after", "GalleryCard.Popovers", (...args: unknown[]) => {
  const props = args[0] as { gallery?: { id?: string } };
  const result = resultFrom(args);
  noteFired("GalleryCard.Popovers");

  const id = props.gallery?.id;
  if (!id || !storedCensorship(String(id))) return result;

  return (
    <>
      {result}
      <CensorshipPopoverMark galleryId={String(id)} />
    </>
  );
});

// 2. Edit page: render the language field (it portals itself after the studio
//    row, so it contributes nothing at this position).
registerPatch("instead", "CustomFieldsInput", (...args: unknown[]) => {
  const props = args[0] as {
    values?: CustomFieldsMap;
    onChange?: (values: CustomFieldsMap) => void;
  };
  const Original = originalFrom(args);
  noteFired("CustomFieldsInput");

  return (
    <>
      <MangaFieldBlock values={props.values} onChange={props.onChange} />
      <Original {...props} />
    </>
  );
});

// 3. Edit page: stop rendering the existing language input row, since the
//    field above handles it now. Every other field goes straight back to the
//    original component, so the plugin has zero effect on them.
//
//    isNew must pass through: that is the "new field" row, and the user may be
//    in the middle of typing a name that will turn out to be ours. Returning null would
//    make the whole row vanish mid-keystroke.
registerPatch("instead", "CustomFieldInput", (...args: unknown[]) => {
  const props = args[0] as { field?: string; isNew?: boolean };
  const Original = originalFrom(args);
  noteFired("CustomFieldInput");

  const isLanguageField =
    !!props.field && String(props.field).toLowerCase() === FIELD_KEY;

  if (!props.isNew && isLanguageField) {
    return null;
  }

  return <Original {...props} />;
});

/** Class name of the detail row's mount point */
const DETAIL_HOST_CLASS = "manga-tools-detail-host";

/**
 * The mount point. Held at module scope so a React re-render that drops it
 * reuses the same node instead of creating a new one every render.
 */
let detailHost: HTMLElement | null = null;

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
  const panel = document.querySelector(".gallery-details");
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
const FIELD_HOST_CLASS = "manga-tools-field-host";

/** As above, held at module scope so the same node is reused */
const fieldHosts: { [key: string]: HTMLElement | null } = {
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
  const anchor = document.querySelector(anchorSelector);
  if (!anchor?.parentNode) {
    fieldHosts[key] = null;
    return null;
  }

  let host = fieldHosts[key];
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

// 4. Detail page: show the language as "flag + localised name", positioned
//    under "photographer", and hang the censorship button off the toolbar.
//
//    Note the target is CustomFields (plural, the container), not CustomField —
//    the latter is a plain React.FC with no PatchComponent wrapper, so patching
//    it reports no error and simply never runs.
//
//    Both of this plugin's fields are lifted out of `values`, so Stash does not
//    also draw them as raw custom-field rows; everything else is handed to the
//    original untouched. The panel portals itself under "photographer" and
//    draws the language entry there, and the censorship button portals itself
//    into the toolbar —
//    which is why this component is where it is rendered from. It is the one
//    patchable component on this page that has the gallery's custom fields in
//    hand, and the toolbar's own component is not patchable at all.
//
//    The button does not depend on those fields being there, only on this being
//    a gallery: `CustomFields` is rendered by the gallery detail panel whatever
//    a gallery carries, including nothing.
registerPatch("instead", "CustomFields", (...args: unknown[]) => {
  const props = args[0] as { values?: CustomFieldsMap; fullWidth?: boolean };
  const Original = originalFrom(args);
  noteFired("CustomFields");

  const values = props.values;
  if (!values || typeof values !== "object") return <Original {...props} />;

  const rest = Object.assign({}, values) as CustomFieldsMap;
  let languageKey: string | null = null;
  let censorshipKey: string | null = null;

  Object.keys(values).forEach((k) => {
    if (!isOwnField(k)) return;
    if (k.toLowerCase() === FIELD_KEY) languageKey = k;
    else censorshipKey = k;
    delete rest[k];
  });

  const lifted = languageKey !== null || censorshipKey !== null;

  // Empty on every entity's page but a gallery's, which is what keeps the
  // button off a scene's or a performer's detail page.
  const galleryId = currentGalleryId();

  // Nothing to lift out and no toolbar to put a button in: hand the original
  // component its own props object back, unwrapped. This is the common case on
  // every non-gallery entity.
  if (!lifted && !galleryId) return <Original {...props} />;

  return (
    <>
      {/* Stash passed `values`, and `rest` differs from it only when something
          of ours was lifted out; passing the original props object otherwise
          keeps the identity its own memoisation compares. */}
      <Original
        {...(lifted ? Object.assign({}, props, { values: rest }) : props)}
      />
      {/*
        The panel, in the details tab, where the plain language row used to be.
        It renders whether or not this gallery carries either field, because it is
        a place for these attributes and an empty one still answers "where would
        this go"; collapsed, it costs one line.
      */}
      {galleryId ? (
        <GuardedBlock name="manga panel">
          <MangaDetailsPanel values={values} />
        </GuardedBlock>
      ) : null}
      {/*
        Rendered whether or not this gallery carries the field yet, and that is
        the whole point: this button is the only way to set a mark, so gating it
        on a mark already existing would leave every gallery permanently
        unmarked. An absent key is simply the "not marked" state, and the first
        click writes the canonical spelling.
      */}
      {galleryId && CAN_WRITE ? (
        <GalleryToolbar galleryId={galleryId} values={values} />
      ) : null}
    </>
  );
});

// 5. Settings page: swap the stock per-setting input for the multiselect above,
//    but only for this plugin — every other plugin's settings go straight back
//    to the original component untouched.
registerPatch("instead", "PluginSettings", (...args: unknown[]) => {
  const props = args[0] as { pluginID?: string };
  const Original = originalFrom(args);
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
registerPatch("before", "GalleryList", (...args: unknown[]) => {
  const props = args[0] as { selectedIds?: unknown };
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
registerPatch("instead", "GalleryList", (...args: unknown[]) => {
  const props = args[0] as { filter?: MangaToolsFilterModel };
  const Original = originalFrom(args);
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
//
//    `after` for the same reason as the card, and one more: RatingSystem is
//    rendered by Stash's own scene and gallery pages with a rating system the
//    user chose, so leaving its output exactly as it was is worth more here than
//    anywhere else.
registerPatch("after", "RatingSystem", (...args: unknown[]) => {
  noteFired("RatingSystem");

  return (
    <>
      {resultFrom(args)}
      <BulkLanguageRow />
    </>
  );
});

start();
