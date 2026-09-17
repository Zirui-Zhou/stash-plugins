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
 *   - the same dropdown in the bulk edit dialog, gated by the manga mark and
 *     riding along with Apply
 *   - a collapsible block in the details tab, where the raw code would be — the
 *     language as its flag and localised name, the censorship mark beside it
 *   - a filter section in the gallery list's sidebar (sidebar-filter.tsx),
 *     which narrows the list to one language
 *
 * A second attribute, the censorship mark, works the same way and lives in
 * `plugin.mangaTools.censorship`. It is a two-valued field rather than a boolean:
 * "not marked" is the absence of the key, which is what the selector's own clear
 * button produces. It surfaces in three places:
 *
 *   - a selector on the gallery edit page, beside the language one
 *   - a row in the details tab's block, as icon and word
 *   - a selector in the bulk edit dialog, gated the same way
 *
 * A third field decides whether any of it applies. A gallery carrying
 * `plugin.mangaTools.manga` is manga; one that does not is an ordinary Stash
 * gallery, and the only thing of this plugin's on it is the switch that sets the
 * mark. Everything above is drawn only on the first kind — and the card carries
 * that same mark's icon at the end of its popover row, which is what says which
 * kind a card is without opening anything.
 *
 * `languages.ts` holds the codes and their flags, `censorship.tsx` the
 * censorship vocabulary and its icons, `fields.ts` the field names and the
 * generic read/write helpers. Filtering is spread across four modules —
 * `filter-model.ts` the criterion read/write logic, `filter-ui.tsx` the rows
 * both surfaces share, `sidebar-filter.tsx` the three sidebar sections, and
 * `dialog-filter.tsx` the dialog's language card. Everything else is below.
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
import { CensorshipIcon, formatCensorshipOption } from "./censorship";
import { NS } from "./languages";
import { t } from "./i18n";
import { requirePluginApi } from "./plugin-api";
import { DialogLanguageFilter } from "./dialog-filter";
import { registerLanguageCriterionOption } from "./filter-model";
import {
  SidebarCensorshipFilter,
  SidebarLanguageFilter,
  SidebarMangaFilter,
  currentSidebarFilter,
  publishSidebarFilter,
} from "./sidebar-filter";
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
const TRANSLATION_GROUP_FIELD_NAME = NS.TRANSLATION_GROUP_FIELD_NAME;

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
 * The filter model out of a rendered element tree, or null if it is not there.
 *
 * Whatever Stash hands the model to carries it as a `filter` prop, and a list
 * page has exactly one model, so the first one found is it. The shape is checked
 * rather than trusted: `filter` is a common enough prop name that a tree could
 * hold something else by it, and handing that to the sidebar's sections would
 * fail in a way that says nothing about the cause.
 */
function findFilter(node: ReactNode): MangaToolsFilterModel | null {
  if (node === null || typeof node !== "object") return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findFilter(child);
      if (found) return found;
    }
    return null;
  }

  const props = (node as { props?: { children?: ReactNode; filter?: unknown } })
    .props;
  if (!props) return null;
  if (Array.isArray(props.filter)) return null;
  const filter = props.filter as MangaToolsFilterModel | undefined;
  if (filter && Array.isArray(filter.criteria)) return filter;

  return findFilter(props.children);
}

/** Whether this Stash has the sidebar patch container the sections mount through */
function hasSidebarSectionsContainer(): boolean {
  const components = PluginApi.components as { [name: string]: unknown };
  return !!components && !!components["FilteredGalleryList.SidebarSections"];
}

/** Whether the missing-sidebar-container error has been logged already */
let warnedMissingSidebarContainer = false;

/** Registers a patch, and keeps one failing to register from taking the rest of
 *  the plugin with it.
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
 * galleryId -> that gallery's custom fields, or null before the first answer.
 *
 * The whole map is kept rather than the values this plugin reads, because the
 * query fetches it whole anyway (a single key cannot be projected out of the
 * GraphQL Map scalar) and because a second field would otherwise mean a second
 * store. What is in here is only ever from a gallery that carries one of the
 * plugin's fields — see refresh().
 *
 * Null and empty are different answers, and telling them apart is the whole
 * reason this is nullable rather than starting as an empty map: a gallery
 * *missing* from a filled store is one the server does not consider manga, while
 * an empty store means the question has not been asked yet. See isMarkedNow. The
 * map is replaced wholesale by a successful fetch, and a refresh that fails
 * leaves the previous one standing — the last answer keeps working, and this only
 * ever goes from null to a map.
 *
 * Which is why the writes read it with `?.`: a click that arrives before the
 * first answer has no map to put the change in, and fabricating one would be
 * answering the question with a guess — an empty map says "nothing is manga",
 * which would take the badge off every other gallery on the page. Such a click
 * still writes to the server and to the edit form; the answer arrives with the
 * refresh that follows it (refreshAfterWrite), and the switch follows then.
 */
let store: Map<string, CustomFieldsMap> | null = null;

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

// ───────────────────────────── Fetching ─────────────────────────────

/**
 * `gql`, wherever this Stash keeps it.
 *
 * The tag normally comes off the Apollo library Stash loads; the fallback is the
 * plugin API's own GQL namespace, which is a different object with the same
 * function on it. Whichever answers builds the document — handing Apollo a plain
 * string instead does not work, and fails quietly enough to have shipped once
 * (see MARK_QUERY_TEXT).
 *
 * Null, with a log, when neither is there. Every caller has to handle that
 * anyway (there is nothing to send), and `what` is what the log says it could
 * not build.
 */
function gqlDoc(text: string, what: string): unknown {
  const Apollo = PluginApi.libraries.Apollo;
  const gql = Apollo?.gql || PluginApi.GQL?.gql;
  if (!gql) {
    console.error("[mangaTools] gql not available, cannot " + what);
    return null;
  }

  return gql(text);
}

/**
 * The Apollo client this plugin reads and writes through, or null.
 *
 * Stash injects StashService itself, and `getClient` throws until the client
 * exists, so the failure is a real one and every caller wants the same thing
 * from it: a log they can grep, and no request. Consolidating it here keeps that
 * log one line rather than four copies that have to stay identical.
 */
function stashClient(): MangaToolsApolloClient | null {
  try {
    return PluginApi.utils.StashService.getClient();
  } catch (e) {
    console.error("[mangaTools] failed to get the Apollo client:", e);
    return null;
  }
}

/**
 * A Gallery's custom_fields is the GraphQL Map scalar, and a single key cannot
 * be projected out of it. So we filter for galleries that have this plugin's
 * field and fetch the whole map, then keep it in memory.
 *
 * **One query per field, and only one field is asked for.** The gallery set that
 * matters is the marked one — that is the set the store is a gate for — and a
 * marked gallery's custom_fields carries its language and its censorship as well,
 * so the one query answers all three questions (see refresh). Filtering on the
 * other fields would add galleries that are not manga, which is exactly what the
 * store must not hold.
 *
 * Two of these could not be combined anyway: `OR` is singular in the schema
 * (`OR: GalleryFilterType`), not an array, and several criteria inside the
 * custom_fields array are ANDed, so listing two fields would mean "has both".
 * The map is keyed by field name so that a second one can be added as its own
 * query, merged by gallery id — nothing does that today.
 *
 * The query spells its field name exactly. Asking for the case variants in one
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

  QUERIES[field] = gqlDoc(
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
    ].join("\n"),
    "build the query"
  );

  return QUERIES[field];
}

/** What one query above returns, as far as this plugin cares */
type GalleriesPayload = {
  galleries?: Array<{ id: string; custom_fields?: CustomFieldsMap }>;
};

/**
 * Refetches the map, and with it answers the question every reader asks. There
 * is one query (see QUERIES) and its result *replaces* the store rather than
 * being merged into it: a gallery the server no longer answers with is one that
 * stopped being manga, and it has to leave the map for that to be visible.
 *
 * Concurrent calls share one in-flight request.
 */
function refresh(): Promise<unknown> {
  if (inFlight) return inFlight;

  // One field, and deliberately not the two it used to be. What comes back is the
  // gallery's *whole* custom_fields map, so a gallery found by the mark gives
  // this plugin its language and its censorship value as well — and a gallery
  // without the mark is in nobody's answer, which is what makes the store itself
  // the gate: everything drawn from it appears only on galleries that are manga.
  const fields = [MANGA_FIELD_NAME];
  const queries = fields.map(getQuery);
  if (queries.some((q) => !q)) return Promise.resolve();

  // No client, no answer — and the store stays null, which is the honest thing
  // for it to say. The next refresh tries again.
  const client = stashClient();
  if (!client) return Promise.resolve();

  // no-cache rather than network-only, for the reason the settings query gives
  // (see refreshSettings): the answer would be written into Apollo's normalised
  // cache, and these are *Gallery* objects — so every refresh would push this
  // plugin's custom_fields into each marked gallery already in the cache. Stash's
  // edit form reinitialises itself whenever the gallery it was built from changes
  // (enableReinitialize in GalleryEditPanel), so that write lands as "the reader's
  // unsaved typing is thrown away". The store here is this plugin's own, and
  // nothing else reads that copy.
  inFlight = Promise.all(
    queries.map((query) =>
      client.query({ query: query, fetchPolicy: "no-cache" })
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
      // This line is the first thing to check when a badge does not show up: if it
      // says 0, the query worked but no gallery is marked as manga, so the problem
      // is the data rather than the plugin.
      if (next.size !== lastLoggedSize) {
        lastLoggedSize = next.size;
        console.info(
          "[mangaTools] loaded " + next.size + " gallery(ies) marked as manga"
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

  // plugins is the PluginConfigMap scalar, so it needs no sub-selection.
  SETTINGS_QUERY = gqlDoc(
    [
      "query MangaToolsSettings {",
      "  configuration {",
      "    plugins",
      "  }",
      "}",
    ].join("\n"),
    "read settings"
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

  const client = stashClient();
  if (!client) return;

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
      NS.openDetailsBlock = NS.parseFlag(
        pluginCfg ? pluginCfg.openDetailsBlock : null,
        DETAILS_OPEN_BY_DEFAULT
      );
      NS.openEditBlock = NS.parseFlag(
        pluginCfg ? pluginCfg.openEditBlock : null,
        EDIT_OPEN_BY_DEFAULT
      );
      NS.hidePerformers = NS.parseFlag(
        pluginCfg ? pluginCfg.hidePerformers : null,
        HIDE_PERFORMERS_BY_DEFAULT
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

/**
 * The URL this plugin's own files are served under, or "" when it cannot be found.
 *
 * A plugin cannot ask. `PluginApi` never says where its files live, and the ID is
 * not knowable from the source either — the yml file's name decides it, so the
 * installed copy may be `mangaToolsTest` while the code says `mangaTools`. The
 * tags Stash injects are the only self-reference on the page: `hooks/useScript`
 * appends a `<script src>` and `useCSS` a `<link>`, both pointing at this plugin.
 *
 * Both are checked, and neither by file name alone: what the backend puts in
 * those URLs is its own business. The last path segment is dropped and what is
 * left is the directory the plugin is served from, whatever it is called.
 */
function ownBaseUrl(): string {
  const tags: Element[] = [];
  const scripts = document.querySelectorAll("script[src]");
  for (let i = 0; i < scripts.length; i++) tags.push(scripts[i]);
  const links = document.querySelectorAll('link[rel="stylesheet"]');
  for (let i = 0; i < links.length; i++) tags.push(links[i]);

  for (const tag of tags) {
    const url =
      (tag as HTMLScriptElement).src || (tag as HTMLLinkElement).href || "";
    if (/mangaTools/.test(url)) return url.replace(/[^/]*$/, "");
  }
  return "";
}

/** Every script and stylesheet URL on the page, for the log below */
function pageAssetUrls(): string[] {
  const urls: string[] = [];
  const tags = document.querySelectorAll("script[src], link[rel=stylesheet]");
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    urls.push(
      (tag as HTMLScriptElement).src || (tag as HTMLLinkElement).href || ""
    );
  }
  return urls;
}

/**
 * Where this plugin's files are served from, learned once at load.
 *
 * Empty when it could not be worked out, and the switch's icon then falls back to
 * the stylesheet's own relative URL — which is the same answer arrived at
 * differently, and is what the CSS carries by default.
 */
let assetBase = "";

function start(): void {
  if (started) return;
  started = true;

  // Silent when it works, which it does on the Stash this was written against —
  // the tag gives /plugin/<id>/ and the switch keeps its icon. It speaks only when
  // the lookup fails, and then prints the page's own URLs, because that is the
  // only way to see what shape they are on a Stash that answers differently.
  assetBase = ownBaseUrl();
  if (!assetBase) {
    console.error(
      "[mangaTools] could not tell where my own files are served from, so the " +
        "switch's icon falls back to the stylesheet's own relative URL. " +
        "Scripts and stylesheets on this page: " +
        pageAssetUrls().join(", ")
    );
  }

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
 * Used after a write, and by the translation group's menu. Both halves matter:
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

/**
 * Refetches the store for the translation group's menu, because it is about to be
 * read.
 *
 * The one thing a list of this Stash's groups has to be is *current*, and the
 * moment it changes is the moment somebody saves a gallery that used a new name:
 * the store is otherwise refetched on a minute's timer, so without this the menu
 * goes on offering to create the very name the gallery in front of it carries —
 * and offering a group that only this gallery ever used, now that it no longer
 * does.
 *
 * Once per opening of the menu, which is the same query the plugin already runs
 * on a timer and after every write. Nothing waits on it: the menu opens with what
 * is in hand and is redrawn when the answer lands. Two openings in the same moment
 * share the one request, since refresh() coalesces onto a fetch in flight.
 */
function refreshForSuggestions(): void {
  refreshAfterWrite();
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
    pickLanguage(store?.get(String(props.galleryId))),
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
 * The manga icon at the end of a card's popover row, or null when the gallery is
 * not one the plugin manages.
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
function MangaPopoverMark(props: { galleryId: string }) {
  useGlobalVersion();
  useAfterMount();

  const intl = PluginApi.libraries.Intl.useIntl();
  const manga = storedIsManga(props.galleryId);
  const slot = manga ? ensurePopoverSlot(props.galleryId) : null;

  if (!manga) return null;

  return (
    <>
      <span className={POPOVER_ANCHOR_CLASS} data-gallery={props.galleryId} />
      {slot
        ? PluginApi.ReactDOM.createPortal(
            <button
              type="button"
              className="minimal btn btn-primary manga-tools-mark"
              title={t(intl, "mangaTools.manga.marked")}
            >
              <MangaIcon />
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
 * Whether this Stash has the client the switch writes through.
 *
 * Both of the switch’s writes go through this plugin’s own mutation, so the
 * client is all it needs. Stash injects StashService itself (it is a namespace
 * import of `src/core/StashService`), so a version without `getClient` is the
 * only way the lookup fails, and on such a version the toolbar gets nothing
 * rather than a switch that cannot work.
 */
const CAN_WRITE = typeof PluginApi.utils.StashService.getClient === "function";

if (!CAN_WRITE) {
  console.error(
    "[mangaTools] this Stash has no Apollo client, so the toolbar switch " +
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

  // The button is not always there, and its absence is not the toolbar's: Stash
  // renders a spinner in its place while its own save runs (OrganizedButton has a
  // `loading` branch), which is exactly what clicking organized does. Treating
  // that as "no toolbar" took this plugin's switch off the page — the reader saw
  // it vanish under their own cursor and stay gone until the next refresh.
  // Nothing about the button's absence says anything about the host.
  if (!button) return toolbarHost;

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
  // The stylesheet carries a relative URL for this, and it is right whenever
  // plugin files sit under one path. This is the same answer reached from the
  // plugin's own tag instead, which does not depend on that being true — and it is
  // only known after start() has run.
  const style = assetBase
    ? ({
        "--manga-tools-icon": `url("${assetBase}assets/icons/manga.svg")`,
      } as React.CSSProperties)
    : undefined;

  return (
    <span className="manga-tools-manga-icon" aria-hidden="true" style={style} />
  );
}

/**
 * The translation groups already in use, in the order the edit field offers them.
 *
 * Out of this plugin's own store, which is the same set of galleries everything
 * else here is about: every marked gallery carries its whole custom_fields map,
 * so the values in use are in memory already and no query is needed for them.
 * Empty until the first answer, which is right — before that there is nothing to
 * suggest, and the field is a plain text box regardless.
 *
 * Recomputed on every call rather than cached. The field that asks writes on every
 * keystroke, so this does run once per character — but it walks the marked
 * galleries and sorts the *distinct* names, which is tens of entries, and a walk
 * of a few thousand maps is not worth an invariant that can go stale: the store is
 * both replaced by a refresh and written into in place, and a cache keyed on
 * either one would be quietly wrong about the other.
 *
 * Case is left alone. Two groups whose names differ only in case are two names as
 * far as this is concerned, and folding them here would mean deciding which
 * spelling to offer somebody who typed the other one.
 */
function knownTranslationGroups(): string[] {
  if (!store) return [];

  const seen: { [name: string]: true } = {};
  store.forEach((fields) => {
    const name = NS.translationGroupOf(fields);
    if (name) seen[name] = true;
  });

  return Object.keys(seen).sort();
}

/**
 * Whether the store — a filled one — holds this gallery.
 *
 * Since the query asks for the mark, being in the map and being manga are the same
 * question, which is what makes the store a gate rather than a cache. This is the
 * one spelling of that question: isMarkedNow asks it here, so the cover badge, the
 * card's popover mark, the toolbar switch and the panels cannot come to different
 * conclusions about one gallery. They did once — membership here, and the map's
 * own value in the switch — and a gallery whose mark had been hand-set to an empty
 * string was manga to one and not to the other.
 */
function storedIsManga(galleryId: string): boolean {
  // `?? false` is the null store: something it cannot answer is not a yes.
  return store?.has(String(galleryId)) ?? false;
}

/**
 * Asks before a gallery stops being manga.
 *
 * Because unmarking is not a flag coming off: the plugin's fields go with it — a
 * gallery the plugin does not manage should not be left carrying half its data
 * (see the note on the toggle). That is worth a question, and Stash's own modal is
 * the way to ask it — the plugin has Bootstrap already.
 *
 * A modal rather than a second click on the switch: the switch has two states and
 * a two-step click would need a third, which is exactly the kind of state naming
 * this plugin went to some trouble to avoid.
 */
function ConfirmUnmark(props: {
  onCancel: () => void;
  onConfirm: () => void;
  /** Whether the edit form is holding unsaved changes the write will reset */
  resetsForm: boolean;
}) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const Modal = Bootstrap?.Modal;
  const Button = Bootstrap?.Button;
  if (!Modal || !Button || !Modal.Body || !Modal.Footer) return null;

  return (
    <Modal show size="sm" onHide={props.onCancel}>
      <Modal.Body>
        <div>{t(intl, "mangaTools.manga.confirm")}</div>
        {/* Taking the mark off removes the language and the censorship with it,
            which the details panel draws — so the cache has to follow, and Stash's
            edit form reinitialises itself when it does. Marking is the other way
            round and is written quietly, so this only ever applies here. */}
        {props.resetsForm ? (
          <div>{t(intl, "mangaTools.manga.confirmResetsForm")}</div>
        ) : null}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={props.onCancel}>
          {t(intl, "mangaTools.manga.confirmCancel")}
        </Button>
        <Button variant="danger" onClick={props.onConfirm}>
          {t(intl, "mangaTools.manga.confirmOk")}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

/**
 * The edit form's custom-fields map and its setter, while the edit tab is open.
 *
 * Published by MangaFieldBlock, which is rendered inside that form and so has
 * both. Marking from the toolbar writes through this as well as to the server
 * (see `mark`), so the form's own copy of the map carries the mark and a later
 * Save — which sends the whole map back (`custom_fields: { full: … }`) — cannot
 * drop it. Cleared when the block unmounts: a setter left behind would write into
 * a form that is no longer there.
 */
let editForm: {
  /** The gallery the form is for — the form on screen is always the route's */
  galleryId: string;
  values: CustomFieldsMap;
  onChange: (values: CustomFieldsMap) => void;
} | null = null;

/** The published form, if it is the one for this gallery */
function editFormFor(galleryId: string): typeof editForm {
  return editForm && editForm.galleryId === galleryId ? editForm : null;
}

/**
 * Whether this gallery is manga, as far as anything on screen is concerned.
 *
 * Once the store has an answer it *is* the answer, and a gallery missing from it
 * is one the server does not consider manga (see storedIsManga, which is where
 * the question is actually settled). That is not the same thing as the store
 * having nothing to say yet, which is the only case the values Stash passed in are
 * for — and telling the two apart is what the store being null is for. Reading a
 * missing gallery as "no answer" was wrong in a way that showed: the values come
 * out of Apollo's cache, which both of this plugin's writes leave alone on
 * purpose, so on a gallery the cache still held as marked, taking the mark off
 * left the switch saying it was still on.
 *
 * The store is otherwise the one to trust because the plugin's own writes keep it
 * in step (see `mark` and `write`) *and* it is refreshed from the server.
 * Everything that asks the question — the toolbar switch, the details panel, the
 * edit block — asks it here.
 *
 * The edit form is not consulted, which is worth spelling out: the form holds a
 * mark only when this plugin put one there, and it does that together with the
 * write, so the two agree by construction. A form the reader edited cannot hold
 * one at all — the mark has no control in that form.
 */
function isMarkedNow(
  galleryId: string | null | undefined,
  values?: CustomFieldsMap
): boolean {
  // No id means this is not one gallery's page — the list's bulk dialog is the
  // case that matters — so there is nothing to look up and the values are all
  // there is to go on. Before the first answer, likewise.
  if (store === null || !galleryId) return NS.isManga(values);
  return storedIsManga(galleryId);
}

/**
 * Whether Stash's edit form has changes that have not been saved.
 *
 * Read out of the DOM because that is the only place it shows. The panel's own
 * Save button is disabled while there is nothing to save — GalleryEditPanel
 * renders it with `disabled={!formik.dirty || …}` — and the panel exists only
 * while its tab is open, so no button means nothing to lose.
 */
function editFormIsDirty(): boolean {
  const save = document.querySelector(".edit-buttons-container .edit-button");
  return !!save && (save as HTMLButtonElement).disabled !== true;
}

/**
 * The mutation that marks a gallery.
 *
 * Its selection set is `id` and nothing else, which is the whole point: Apollo
 * writes what the mutation returns into the cache, so asking for no gallery
 * fields leaves the cached gallery exactly as it was — same object, same
 * custom_fields — and an edit form built from it does not reinitialise (see
 * refresh() for the same argument about the store's query).
 *
 * Stash's own `useGalleryUpdate` cannot be used here: its document asks for the
 * gallery, which is what we must not have.
 */
const MARK_QUERY_TEXT = [
  "mutation MangaToolsSetFields($input: GalleryUpdateInput!) {",
  "  galleryUpdate(input: $input) {",
  "    id",
  "  }",
  "}",
].join("\n");

/**
 * The same, as a document — through `gql`, the way every other operation here is
 * built.
 *
 * Handing Apollo the raw text does not work: what `client.mutate` expects is a
 * `DocumentNode`, and a string that Apollo declines to parse comes back as a
 * rejected promise with nothing useful in it. The tests cannot see the
 * difference (their `gql` is a stub that answers with what it was given), which
 * is how this got as far as a release: it was written as a template string and
 * every assertion still passed.
 */
let markUpdate: unknown = null;
function getMarkUpdate(): unknown {
  if (markUpdate) return markUpdate;

  markUpdate = gqlDoc(MARK_QUERY_TEXT, "build the mutation");
  return markUpdate;
}

/**
 * Writes fields, and leaves the page's cached gallery alone. See MARK_QUERY_TEXT.
 *
 * Rejects when there is nothing to write *with* — no document, or no client —
 * rather than resolving as though it had been sent. Both of the callers' paths
 * refresh, so the page comes out the same either way; what a rejection buys is
 * the line the caller logs, and without it this is the one failure of the pair
 * that leaves no trace at all: no request on the wire, nothing in the console,
 * and a click that looks exactly like a successful one. Apollo rejects for its
 * own reasons, so the callers already have that path — this only makes the two
 * failures this function can have take it too.
 */
function writeQuietly(
  galleryId: string,
  fields: Record<string, unknown>
): Promise<unknown> {
  const mutation = getMarkUpdate();
  if (!mutation) {
    return Promise.reject(
      new Error("[mangaTools] no mutation document, the write was not sent")
    );
  }

  const client = stashClient();
  if (!client) {
    return Promise.reject(
      new Error("[mangaTools] no Apollo client, the write was not sent")
    );
  }

  return client.mutate({
    mutation,
    variables: { input: { id: galleryId, custom_fields: fields } },
  });
}

function GalleryToolbar(props: { galleryId: string; values: CustomFieldsMap }) {
  useGlobalVersion();
  useAfterMount();

  const intl = PluginApi.libraries.Intl.useIntl();
  const busyState = React.useState(false);
  const busy = busyState[0];
  const setBusy = busyState[1];
  const confirmState = React.useState(false);
  const confirming = confirmState[0];
  const setConfirming = confirmState[1];

  const host = ensureToolbarHost();
  if (!host) return null;

  // What the switch says comes from isMarkedNow: this plugin's store once it has
  // answered, and the values Stash handed in only before that — the write is
  // deliberately invisible to the Apollo cache those values come from, so they are
  // the last to know.
  //
  // The edit form is not consulted for the mark. It holds one only when this
  // plugin put it there, and it does that together with the write, so there is
  // nothing it could add. It *is* what a click writes through, though — see the
  // two write paths below, which look it up when the click happens rather than
  // capturing whatever was published on this render.
  const marked = isMarkedNow(props.galleryId, props.values);

  /**
   * Takes the mark off, and this plugin's fields with it.
   *
   * Semantically the gallery is no longer the plugin's: leaving `language` and
   * `censorship` behind would be leaving data that nothing displays and nothing
   * explains. Every key is removed by the spelling it actually has, so a key that
   * drifted in case goes too.
   *
   * (A setting for this — clear on unmark, or keep — is the obvious next thing;
   * for now clearing unconditionally, behind the question above, is the honest
   * default: the alternative silently keeps data the reader cannot see.)
   */
  const write = (fields: Record<string, unknown>) => {
    // Taking the mark off takes this plugin's fields with it, so the gallery
    // stops being one of its own: out of the store now, not after the round trip.
    // Everything drawn from it — the badge, the details panel, the switch — goes
    // with it. The panels are gated on the store rather than on Stash's values
    // (see isMarkedNow), which is what makes it safe to write this quietly: the
    // cache goes on holding fields that nothing on screen asks it for.
    store?.delete(props.galleryId);

    // Looked up now rather than captured on the render that drew the switch: the
    // click is what the form has to agree with, and the published form can have
    // changed since (the edit tab opening or closing).
    const form = editFormFor(props.galleryId);
    if (form) {
      // The form's copy loses them too, and this is not symmetry for its own sake:
      // the map a Save sends back is the *whole* of the custom fields, so a form
      // still holding the mark puts it back the next time it is saved — and the
      // cache cannot be relied on to correct it, because this write does not
      // touch the cache at all.
      // The same fields, by the same spellings, as the `remove:` list the server
      // is given — NS.clearFields is the pair to fieldsToClear for that reason.
      form.onChange(NS.clearFields(form.values));
    }

    emit();

    setBusy(true);
    // Quiet, like the mark: through this plugin's own mutation rather than
    // Stash's, because changing the gallery's custom_fields in the cache is
    // exactly what reinitialises the edit form and throws away whatever the
    // reader has typed but not saved.
    writeQuietly(props.galleryId, fields).then(
      () => {
        setBusy(false);
        setConfirming(false);
        // The store is put right by the refresh, which drops a gallery the server
        // no longer answers with. Deferred, or a fetch built before the write
        // would land after it and put the gallery back.
        refreshAfterWrite();
      },
      (e: unknown) => {
        setBusy(false);
        setConfirming(false);
        console.error("[mangaTools] could not write the manga mark:", e);
        // The store has been emptied and the page has been told, but the server
        // never heard: ask it what the truth is, exactly as marking does. Without
        // this the gallery stays missing from the map — so unmarked on screen —
        // until the next poll or navigation, while the server still holds it.
        refreshAfterWrite();
      }
    );
  };

  const onToggle = () => {
    if (!marked) {
      mark();
      return;
    }

    setConfirming(true);
  };

  /**
   * Marks the gallery: on the server, and in the edit form if it is open.
   *
   * Both, because each covers something the other cannot. The server write is
   * what the plugin's own store reads, so the switch, the card badges and the
   * bulk rows all follow. The form write is what keeps the form's copy of the
   * map — the one its Save sends back in full — from being a version without the
   * mark, which is what would silently drop it (see editForm).
   *
   * Nothing here reinitialises that form: the write is the quiet one, and the
   * form is told directly rather than through the cache. That is the whole reason
   * marking is safe to do with unsaved typing sitting in it, where taking the
   * mark off is not.
   */
  const mark = () => {
    // The two copies are each built on their own: the form's map is the reader's,
    // with whatever they have typed into it, and replacing it with the store's
    // would throw that away — which is the failure this whole change is about.
    //
    // Read at click time, not on the render that drew the switch, so the form
    // written to is the one on screen now.
    const form = editFormFor(props.galleryId);
    if (form) {
      // The form gets the mark because the map its Save sends back is the *whole*
      // of it (`custom_fields: { full: … }`): a form that did not know about the
      // mark would drop it on the next save.
      form.onChange(NS.setField(form.values, MANGA_FIELD_NAME, NS.MANGA_VALUE));
    }

    // Marked here and now, so the switch, the details panel and the edit block —
    // all of which ask isMarkedNow — follow the click rather than waiting for a
    // server round trip that may yet fail. The write below either confirms this or,
    // on failure, is put right by the refresh that follows it.
    store?.set(
      props.galleryId,
      NS.setField(
        store?.get(props.galleryId) ?? props.values,
        MANGA_FIELD_NAME,
        NS.MANGA_VALUE
      )
    );

    emit();

    setBusy(true);
    writeQuietly(props.galleryId, {
      partial: { [MANGA_FIELD_NAME]: NS.MANGA_VALUE },
    }).then(
      () => {
        setBusy(false);
        refreshAfterWrite();
      },
      (e: unknown) => {
        setBusy(false);
        console.error("[mangaTools] could not write the manga mark:", e);
        // The server never heard about it, so what is on screen is wrong: ask the
        // server what the truth is. Deferred like the other one, for the same
        // reason — a fetch started before this click would answer with the state
        // before it.
        refreshAfterWrite();
      }
    );
  };

  const onConfirmUnmark = () => {
    write({ remove: NS.fieldsToClear(props.values) });
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
      {confirming ? (
        <ConfirmUnmark
          onCancel={() => setConfirming(false)}
          onConfirm={onConfirmUnmark}
          /* Read here, as the question is drawn: a value captured on the render
             that drew the switch can be stale by the time it is shown. */
          resetsForm={editFormIsDirty()}
        />
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
 * One entry in the translation group's menu.
 *
 * Not a MangaToolsOption: that type carries a flag, which is a fact about a
 * language this plugin knows the flag for, and a group has no such table behind
 * it. `createLabel` says instead that this entry is the text somebody is typing,
 * offered so that choosing it is how a new group gets set.
 */
type MangaToolsGroupOption = {
  value: string;
  label: string;
  /** The wording for the create entry, already localised — see below. */
  createLabel?: string;
};

/** Whether two group names are the same one, which is a question about case only */
function sameGroup(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Renders a group option: the name, or — in the menu only — the offer to create it.
 *
 * The "value" context is the box itself, and there the text is simply the name: an
 * offer to create what is already selected would read as a question. In the menu
 * it is prefixed, so the entry nobody has used before is told apart from the
 * groups that exist.
 *
 * The wording is carried on the option rather than looked up here because this is
 * called by react-select while it renders, and a component's worth of hooks cannot
 * be used in something invoked per option. The option is built in MangaFieldBlock,
 * which has the reader's `intl` in hand.
 */
function formatGroupOption(
  option: MangaToolsGroupOption,
  meta?: { context?: string }
) {
  if (!option.createLabel || meta?.context !== "menu") return option.label;
  return <span className="manga-tools-option">{option.createLabel}</span>;
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
  const state = React.useState(NS.openEditBlock);
  const open = state[0];
  const setOpen = state[1];
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Button = PluginApi.libraries.Bootstrap?.Button;

  // The mount point is read during render (same approach as the detail page).
  // ensureFieldHost is idempotent and returns null when the anchor is absent.
  const host = isGalleryContext() ? ensureFieldHost() : null;

  // A manga gallery rarely has performers, so the row Stash draws for them steps
  // aside when the setting asks it to — see .hide-performers in mangaTools.css.
  // Hidden rather than not rendered, because the row is Stash's: its value stays
  // in Stash's form, so a gallery that does have performers keeps them on save,
  // and nothing here can lose data. The class goes on this plugin's own node,
  // which React does not manage, so a re-render of Stash's form cannot undo it.
  if (host) {
    host.classList.toggle("hide-performers", NS.hidePerformers);
  }

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

  // The translation group, wearing the same Select as the two fields above it —
  // which is a costume, because react-select cannot be typed into. What makes it
  // work is that **the text in the box is the field's value**: every keystroke is
  // written to the map as it is typed, exactly as the plain text box did, and the
  // menu is then built from the value rather than from any state of react-select's.
  //
  // That is what keeps it honest. react-select is a control for choosing from a
  // list, and the usual way to make it accept new text is to keep the search text
  // in state, offer it as an extra option, and hope the reader selects it — where
  // typing and then leaving throws the text away. Here there is nothing to throw
  // away: the value is already saved, and the "create" entry is a way of saying
  // "this text, yes" rather than the only way of keeping it.
  //
  // Two of react-select's behaviours have to be worked with rather than around,
  // and both are visible in its source (Select.js, "renderPlaceholderOrValue" and
  // "setValue"):
  //
  //   - The value area draws **nothing** while the input has text in it, because
  //     the input is then assumed to be showing that text; and choosing an option
  //     hides the input (`opacity: 0`) for a single select. So `inputValue` is left
  //     to react-select: it holds what is being typed, the box shows that while
  //     typing and the chosen name as plain text afterwards, and the field ends up
  //     behaving exactly like the two above it. Controlling `inputValue` to the
  //     value instead blanks the box — text hidden and no label drawn.
  //   - `onInputChange` fires for reasons other than typing — selecting, closing
  //     the menu — and its text is then the option's label or nothing at all.
  //     Taking it would put the search text back over the value just chosen, or
  //     clear the field as the menu closed. Only "input-change" is written.
  const groupRaw = NS.pickField(props.values, TRANSLATION_GROUP_FIELD_NAME);
  const groupName = NS.translationGroupOf(props.values);

  const known = knownTranslationGroups();
  // Offered only when the text is not a group this Stash knows: otherwise the menu
  // would spell the same name twice, in whatever case it was typed.
  const namesANewGroup =
    !!groupName && !known.some((name) => sameGroup(name, groupName));

  const groupOptions: MangaToolsGroupOption[] = [
    ...(namesANewGroup
      ? [
          {
            value: groupName,
            label: groupName,
            // Composed here rather than in formatGroupOption, which runs inside
            // react-select's render and cannot use a hook. Quoted, because the
            // name is a name and reading "Create Lily Manga" makes the offer look
            // like the answer.
            createLabel:
              t(intl, "mangaTools.translationGroup.create") +
              ' "' +
              groupName +
              '"',
          },
        ]
      : []),
    ...known.map((name) => ({ value: name, label: name })),
  ];

  const groupField = (
    <div className={cls.group} data-field="manga_tools_translation_group">
      <label className={cls.label} htmlFor="manga_tools_translation_group">
        {t(intl, "mangaTools.translationGroup.heading")}
      </label>
      <div className={cls.control}>
        <Select
          className="manga-tools-select"
          classNamePrefix="react-select"
          inputId="manga_tools_translation_group"
          isClearable
          placeholder={t(intl, "mangaTools.translationGroup.placeholder")}
          value={groupRaw ? { value: groupRaw, label: groupName } : null}
          options={groupOptions}
          formatOptionLabel={formatGroupOption}
          // react-select draws a vertical rule between the clear button and the
          // arrow, and none of Stash's own dropdowns have it — its Select.tsx sets
          // this in its default props and strips it too. Follow suit, so this field
          // has the same furniture as the two above it.
          components={{ IndicatorSeparator: () => null }}
          // What is in the menu is the groups that exist *now*, and a save is the
          // moment that changes — the value just written becomes one of them, and
          // a name that was only ever used by this gallery stops being one. This
          // plugin's store is otherwise only refetched on a timer (a minute), so
          // without this the menu goes on offering to create the name the gallery
          // already carries.
          onMenuOpen={() => refreshForSuggestions()}
          onInputChange={(text: string, meta: { action?: string }) => {
            if (meta?.action !== "input-change") return;
            // A box holding only spaces means nothing, and nothing removes the
            // key rather than storing whitespace that reads as empty everywhere
            // else.
            write(TRANSLATION_GROUP_FIELD_NAME, text.trim() ? text : "");
          }}
          onChange={(opt: MangaToolsGroupOption | null) => {
            // A group picked from the list is written in *its* spelling, which is
            // how a name typed in another case is put right; the create entry
            // carries the text back unchanged.
            write(TRANSLATION_GROUP_FIELD_NAME, opt ? opt.value : "");
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
      {open ? groupField : null}
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
          openDetailsBlock: NS.openDetailsBlock,
          openEditBlock: NS.openEditBlock,
          hidePerformers: NS.hidePerformers,
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

      <BooleanSetting
        id="mangaTools-openDetailsBlock"
        heading={t(intl, "mangaTools.settings.openDetailsBlock.heading")}
        subHeading={t(intl, "mangaTools.settings.openDetailsBlock.description")}
        checked={NS.openDetailsBlock}
        onChange={(next) => {
          NS.openDetailsBlock = next;
          emit();
          persist();
        }}
      />

      <BooleanSetting
        id="mangaTools-openEditBlock"
        heading={t(intl, "mangaTools.settings.openEditBlock.heading")}
        subHeading={t(intl, "mangaTools.settings.openEditBlock.description")}
        checked={NS.openEditBlock}
        onChange={(next) => {
          NS.openEditBlock = next;
          emit();
          persist();
        }}
      />

      <BooleanSetting
        id="mangaTools-hidePerformers"
        heading={t(intl, "mangaTools.settings.hidePerformers.heading")}
        subHeading={t(intl, "mangaTools.settings.hidePerformers.description")}
        checked={NS.hidePerformers}
        onChange={(next) => {
          NS.hidePerformers = next;
          emit();
          persist();
        }}
      />
    </>
  );
}

// ─────────────────────────── Bulk edit dialog ───────────────────────────

/** What a bulk select is about to do to one of the two valued fields */
type BulkValuePending = { kind: "set"; value: string } | { kind: "remove" };

/**
 * What the bulk dialog is about to do to each of this plugin's fields.
 *
 * State the dialog itself does not know about, and cannot be given:
 * EditGalleriesDialog is a plain React.FC (not a PatchComponent) and keeps its
 * pending edits in its own useState, so there is no way to add a field to them.
 * The rows therefore live outside that state and their values are merged into
 * the outgoing mutation instead — see installBulkLink.
 *
 * `null` means "leave the field alone". A select's ✗ clears back to null; its
 * "remove" option is the only way to empty a field across a whole selection.
 * The two are deliberately distinct — "do not change" and "delete" are not the
 * same thing, and a bulk dialog that could only do the first would be unable to
 * strip a value Stash's own edit form can clear.
 *
 * `bulkManga` is the master. The mark is what makes a gallery the plugin's at
 * all, so the other two rows are only drawn while it is "mark"; and "unmark"
 * wins over whatever they hold, because a gallery that stops being manga also
 * stops carrying their values. See selectedMangaAggregate for the three states.
 *
 * All three are dropped once the mutation succeeds and when the dialog closes,
 * so a cancelled dialog leaves nothing behind.
 */
let bulkLanguage: BulkValuePending | null = null;
let bulkCensorship: BulkValuePending | null = null;
let bulkManga: "mark" | "unmark" | null = null;

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

  const first = pickLanguage(store?.get(selectedGalleryIds[0]));
  for (let i = 1; i < selectedGalleryIds.length; i++) {
    if (pickLanguage(store?.get(selectedGalleryIds[i])) !== first) return null;
  }

  return first || null;
}

/**
 * The censorship every selected gallery shares, or null when they differ (or
 * when none of them carries one). The counterpart of selectedLanguageAggregate
 * above, which this plugin's own three-valued field needs just as much as the
 * language field does.
 */
function selectedCensorshipAggregate(): string | null {
  if (!selectedGalleryIds.length) return null;

  const first = censorshipOf(store?.get(selectedGalleryIds[0]));
  for (let i = 1; i < selectedGalleryIds.length; i++) {
    if (censorshipOf(store?.get(selectedGalleryIds[i])) !== first) return null;
  }

  return first || null;
}

/**
 * Whether every selected gallery is manga, none of them is, or the two are
 * mixed. The three states the manga mark's checkbox has to express — a checkbox
 * can be checked, unchecked, or indeterminate, and which of those it shows is
 * exactly this.
 */
function selectedMangaAggregate(): "all" | "none" | "mixed" {
  if (!selectedGalleryIds.length) return "none";

  let anyManga = false;
  let anyOther = false;
  for (let i = 0; i < selectedGalleryIds.length; i++) {
    if (NS.isManga(store?.get(selectedGalleryIds[i]))) anyManga = true;
    else anyOther = true;
    if (anyManga && anyOther) return "mixed";
  }

  return anyManga ? "all" : "none";
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
 * Merges the pending fields into a bulk gallery update, in place.
 *
 * CustomFieldsInput is what makes this safe: `partial` updates just the named
 * keys, so the rest of every gallery's custom fields is left alone, and `remove`
 * deletes only the named keys. Both may appear at once — the two pendings that
 * can coexist are a "set" on one field and a "remove" on another, which the
 * schema allows in a single input.
 *
 * Nothing is merged when the user has not touched any field — a bulk edit of
 * photographers must go out exactly as Stash built it. `bulkManga` is the one
 * pending the others defer to: unmarking clears every field this plugin owns, so
 * when it is set the other two are ignored entirely; and only "mark" writes the
 * manga field itself, since a selection that is already all-manga must not be
 * rewritten.
 *
 * @returns true when the operation was modified
 */
function applyPendingFields(operation: MangaToolsApolloOperation): boolean {
  const partial: { [name: string]: string } = {};
  const remove: string[] = [];

  if (bulkManga === "unmark") {
    remove.push(FIELD_NAME, CENSORSHIP_FIELD_NAME, MANGA_FIELD_NAME);
  } else {
    if (bulkManga === "mark") partial[MANGA_FIELD_NAME] = NS.MANGA_VALUE;

    if (bulkLanguage?.kind === "set") partial[FIELD_NAME] = bulkLanguage.value;
    else if (bulkLanguage?.kind === "remove") remove.push(FIELD_NAME);

    if (bulkCensorship?.kind === "set")
      partial[CENSORSHIP_FIELD_NAME] = bulkCensorship.value;
    else if (bulkCensorship?.kind === "remove")
      remove.push(CENSORSHIP_FIELD_NAME);
  }

  if (!Object.keys(partial).length && !remove.length) return false;

  // The route is checked here as well as by the row's mount, so "these fields
  // are only ever written on a gallery page" is a stated constraint rather than
  // a consequence of where the row happens to render.
  if (!isGalleryContext()) return false;

  if (!isGalleryBulkUpdate(operation.query)) return false;

  const input = operation.variables
    ? (operation.variables.input as { ids?: unknown } | undefined)
    : undefined;
  if (!input || !Array.isArray(input.ids)) return false;

  const fields: { partial?: Record<string, string>; remove?: string[] } = {};
  if (Object.keys(partial).length) fields.partial = partial;
  if (remove.length) fields.remove = remove;

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
 * Hooks Stash's Apollo link chain so the pending fields ride along with the
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
  const client = stashClient();
  if (!client) return;

  if (
    !Apollo?.ApolloLink ||
    typeof client.setLink !== "function" ||
    !client.link
  ) {
    console.error(
      "[mangaTools] ApolloLink/setLink unavailable — the manga fields cannot be set from the bulk edit dialog"
    );
    return;
  }

  // Replace the chain with ours in front of the existing one. setLink replaces
  // the whole chain, so the current link must be passed through explicitly.
  const previous = client.link;

  client.setLink(
    Apollo.ApolloLink.from([
      new Apollo.ApolloLink((operation, forward) => {
        if (!applyPendingFields(operation)) {
          return forward(operation);
        }

        console.info(
          "[mangaTools] bulk update: sending the manga fields with the dialog's own update"
        );

        // Cleared only once the update actually succeeded, so a failed Apply
        // can simply be retried with the row still filled in.
        return forward(operation).map((result) => {
          bulkLanguage = null;
          bulkCensorship = null;
          bulkManga = null;

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

/** The "remove" option's value — cannot collide with a language code or a censorship value */
const BULK_REMOVE_VALUE = "__manga_tools_remove__";

/**
 * The bulk edit dialog's manga rows, rendered through a portal into a mount
 * point inserted between Stash's "studio" and "performers" rows.
 *
 * Three rows, gated by the first. The mark is a tri-state checkbox — the same
 * shape Stash's own "organized" field takes — because a selection can be all,
 * none, or a mix, and a checkbox is the one control that says all three. The
 * language and censorship selects are only drawn while the selection is being
 * kept or made manga: the mark is what makes a gallery this plugin's at all, so
 * offering those fields over a selection that is not manga would be writing
 * values onto galleries that would then not display them. Unchecking a mark
 * that exists shows a warning instead, and Apply is what actually removes it.
 *
 * The values are deliberately **not** applied as they are picked: they are
 * merged into the dialog's own bulk update when Apply is pressed, so Cancel
 * discards them exactly like every other field in that dialog.
 */
function BulkFieldsRow() {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const Select = resolveSelect();
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;

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

  // Losing the row means the dialog closed, so the pending values are no longer
  // wanted. Checked against the DOM rather than unconditionally, so an
  // unrelated re-render cannot throw them away while the dialog is open.
  React.useEffect(
    () => () => {
      if (!document.querySelector(BULK_ANCHOR)) {
        bulkLanguage = null;
        bulkCensorship = null;
        bulkManga = null;
      }
    },
    []
  );

  if (!isGalleryContext() || !Select || !host) return null;

  const cls = readNativeFieldClasses(BULK_ANCHOR) || {
    group: "row",
    label: "col-form-label col-3",
    control: "col-9",
  };

  // The mark, and the third state its checkbox has to express. `tri` is the
  // checkbox's state as a boolean *or* the indeterminate it shows for a mixed
  // selection — which is why it is not just `bulkManga !== "unmark"`.
  const aggregate = selectedMangaAggregate();
  const tri =
    bulkManga === "mark"
      ? true
      : bulkManga === "unmark"
        ? false
        : aggregate === "all"
          ? true
          : aggregate === "none"
            ? false
            : undefined;

  // React has no `indeterminate` prop, so it is set on the DOM node directly —
  // the same thing Stash's IndeterminateCheckbox does with its ref.
  const setIndeterminate = (el: HTMLInputElement | null) => {
    if (el) el.indeterminate = tri === undefined;
  };

  // The cycle depends on what the selection already is, so the "no change" rest
  // state is one click away in every case: all↔unmark, none↔mark, and for a
  // mix, keep→mark→unmark→keep. Marking first matches a checkbox the reader
  // has to confirm before it will ever remove a mark.
  const cycleManga = () => {
    if (aggregate === "all") {
      bulkManga = bulkManga === "unmark" ? null : "unmark";
    } else if (aggregate === "none") {
      bulkManga = bulkManga === "mark" ? null : "mark";
    } else {
      bulkManga =
        bulkManga === null ? "mark" : bulkManga === "mark" ? "unmark" : null;
    }
    emit();
  };

  // The mark is native organized-style markup — a form-group wrapping a
  // form-check, checkbox then label, no grid columns — so it sits in the dialog
  // exactly like Stash's "organized" field rather than in the label/control
  // column split the selects below use.
  const mangaRow = (
    <div className="form-group" data-field="manga_tools_manga">
      <div className="form-check">
        <input
          type="checkbox"
          className="form-check-input"
          id="manga_tools_manga"
          ref={setIndeterminate}
          checked={tri === true}
          onChange={cycleManga}
        />
        <label className="form-check-label" htmlFor="manga_tools_manga">
          {t(intl, "mangaTools.manga.isManga")}
        </label>
      </div>
    </div>
  );

  // The one option both selects share, and the way each draws it. It is a real
  // option rather than the clear button, because clearing already means "leave
  // this field alone" — the two must both be reachable, and they are opposites.
  const removeOption: MangaToolsOption = {
    value: BULK_REMOVE_VALUE,
    label: t(intl, "mangaTools.bulk.remove"),
    flag: null,
  };
  const banIcon = Solid.faBan || null;
  const removeLabel = (
    <span className="manga-tools-option">
      {banIcon ? <Icon icon={banIcon} /> : null}
      {removeOption.label}
    </span>
  );
  const formatLanguageWithRemove = (opt: MangaToolsOption) =>
    opt.value === BULK_REMOVE_VALUE ? removeLabel : formatLanguageOption(opt);
  const formatCensorshipWithRemove = (opt: { value: string; label: string }) =>
    opt.value === BULK_REMOVE_VALUE ? removeLabel : formatCensorshipOption(opt);

  let options: MangaToolsOption[] = NS.languageOptions(intl.locale).filter(
    (o) => !NS.enabledLanguages || NS.enabledLanguages.has(o.value)
  );

  // Show exactly what is about to happen: what the user picked, otherwise the
  // selection's shared language. A mixed selection shows the placeholder — the
  // same way the studio field behaves — and the remove option is its own state
  // rather than an empty box, because an empty box means "leave alone".
  const langShown =
    bulkLanguage?.kind === "set"
      ? bulkLanguage.value
      : bulkLanguage?.kind === "remove"
        ? BULK_REMOVE_VALUE
        : selectedLanguageAggregate() || "";

  const current =
    langShown && langShown !== BULK_REMOVE_VALUE
      ? NS.describe(langShown, intl.locale)
      : null;

  // A code that is not in the enabled list still has to be shown while it is
  // sitting in the row, or the selection would look like it was ignored.
  const currentCode = current ? current.code : "";
  if (current && !options.some((o) => o.value === currentCode)) {
    options = [
      { value: current.code, label: current.name, flag: current.flag },
      ...options,
    ];
  }

  const selected =
    langShown === BULK_REMOVE_VALUE
      ? removeOption
      : current
        ? { value: current.code, label: current.name, flag: current.flag }
        : null;

  const languageRow = (
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
          options={[...options, removeOption]}
          formatOptionLabel={formatLanguageWithRemove}
          components={{ IndicatorSeparator: () => null }}
          // Clearing means "leave the language alone", exactly as clearing the
          // studio field means "leave the studio alone" — neither sends a value.
          onChange={(opt: MangaToolsOption | null) => {
            if (!opt) {
              bulkLanguage = null;
            } else if (opt.value === BULK_REMOVE_VALUE) {
              bulkLanguage = { kind: "remove" };
            } else {
              bulkLanguage = { kind: "set", value: opt.value };
            }
            emit();
          }}
        />
      </div>
    </div>
  );

  const censorshipOptions = [
    { value: "censored", label: t(intl, "mangaTools.censorship.censored") },
    {
      value: "uncensored",
      label: t(intl, "mangaTools.censorship.uncensored"),
    },
  ];

  const censoredShown =
    bulkCensorship?.kind === "set"
      ? bulkCensorship.value
      : bulkCensorship?.kind === "remove"
        ? BULK_REMOVE_VALUE
        : selectedCensorshipAggregate() || "";

  const censoredSelected =
    censoredShown === BULK_REMOVE_VALUE
      ? removeOption
      : censoredShown
        ? {
            value: censoredShown,
            label: NS.censorshipLabel(intl, censoredShown),
          }
        : null;

  const censorshipRow = (
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
          menuPortalTarget={document.body}
          placeholder={t(intl, "mangaTools.censorship.unset")}
          value={censoredSelected}
          options={[...censorshipOptions, removeOption]}
          formatOptionLabel={formatCensorshipWithRemove}
          components={{ IndicatorSeparator: () => null }}
          onChange={(opt: { value: string } | null) => {
            if (!opt) {
              bulkCensorship = null;
            } else if (opt.value === BULK_REMOVE_VALUE) {
              bulkCensorship = { kind: "remove" };
            } else {
              bulkCensorship = { kind: "set", value: opt.value };
            }
            emit();
          }}
        />
      </div>
    </div>
  );

  // The gate in order: a warning while the reader is unmarking, the mark itself,
  // and only then the two fields it guards.
  return PluginApi.ReactDOM.createPortal(
    <>
      {tri === false && aggregate !== "none" ? (
        <div className="alert alert-warning" role="alert">
          {t(intl, "mangaTools.bulk.unmarkWarning")}
        </div>
      ) : null}
      {mangaRow}
      {tri === true ? languageRow : null}
      {tri === true ? censorshipRow : null}
    </>,
    host
  );
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
 * The state each block opens in, and the defaults for the two settings that
 * decide it.
 *
 * The details one starts collapsed: that tab already has a lot on it, and the
 * heading is what says the section exists. The edit one starts open, because
 * there it is not a section of a page full of sections — it is a field, and the
 * dropdown inside it is the only way to set a language at all, so a fold that
 * starts closed would be a fold over the feature.
 *
 * Only the *initial* state, either way: a setting is about how a block opens, not
 * about whether it can be opened, so changing it does not reach into a block that
 * is already on screen. `NS.openDetailsBlock` / `NS.openEditBlock` hold the live
 * values, which `refreshSettings` overwrites from the plugin config.
 */
const DETAILS_OPEN_BY_DEFAULT = false;
const EDIT_OPEN_BY_DEFAULT = true;
/** A mark is what makes a gallery manga, so a manga gallery's edit page hides
 *  the performers field unless the reader asks for it back. See the CSS rule. */
const HIDE_PERFORMERS_BY_DEFAULT = true;

NS.openDetailsBlock = DETAILS_OPEN_BY_DEFAULT;
NS.openEditBlock = EDIT_OPEN_BY_DEFAULT;
NS.hidePerformers = HIDE_PERFORMERS_BY_DEFAULT;

/**
 * The gallery's manga attributes, as labelled rows.
 *
 * A row is drawn only when its value is set — an unset one is simply absent,
 * the same way the rest of the plugin keeps an unset value quiet. With no value
 * at all the whole panel is dropped, since a fold whose only content is its own
 * heading is not worth a line.
 */
function MangaDetailsPanel(props: { values: CustomFieldsMap }) {
  useGlobalVersion();

  const intl = PluginApi.libraries.Intl.useIntl();
  const state = React.useState(NS.openDetailsBlock);
  const open = state[0];
  const setOpen = state[1];

  const language = NS.describe(pickLanguage(props.values), intl.locale);
  const mark = censorshipOf(props.values);
  const group = NS.translationGroupOf(props.values);
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Button = PluginApi.libraries.Bootstrap?.Button;
  const Collapse = PluginApi.libraries.Bootstrap?.Collapse;

  // Nothing set means nothing to say: with none of the three set the whole panel
  // is dropped, rather than left as an empty fold with only its heading.
  if (!language && !mark && !group) return null;

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
  // nodes come out the way Stash's own rows produce them. Each is drawn only
  // when its value is set.
  const body = (
    <div className="manga-tools-panel-body">
      {language ? (
        <h6 className="manga-tools-detail">
          {fieldLabel(intl) + ": "}
          {showFlag ? (
            <Flag flag={language.flag as string} className="manga-tools-flag" />
          ) : null}
          {showFlag ? " " : null}
          {language.name}
        </h6>
      ) : null}
      {mark ? (
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.censorship.heading") + ": "}
          <CensorshipIcon value={mark} />
          {mark ? " " : null}
          {NS.censorshipLabel(intl, mark)}
        </h6>
      ) : null}
      {group ? (
        // No icon and no flag: a group's name is its own, and there is nothing
        // here to draw beside it. Drawn last, because it is the one row that is
        // the same shape on every gallery rather than picked from a list.
        <h6 className="manga-tools-detail">
          {t(intl, "mangaTools.translationGroup.heading") + ": "}
          {group}
        </h6>
      ) : null}
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
  const value = id ? pickLanguage(store?.get(String(id))) : "";

  // Nothing to add: the gallery has no language, or the badge is turned off.
  if (!value || !NS.showCoverBadge) return result;

  return (
    <>
      {result}
      <LanguageBadge galleryId={id as string} />
    </>
  );
});

// 1b. The manga icon at the end of the same card's popover row.
//
//     Deliberately not another cover badge: the language badge is a flag, which
//     reads at a glance, while "this is one the plugin manages" is not a value you
//     scan for. The popover row is where Stash already puts this kind of thing
//     (organized, and the two counts), and it costs nothing on the many cards that
//     are not manga, which is most of them.
//
//     The gate is the store rather than a value: on a card there is nothing else to
//     ask, and the store holds exactly the galleries the query found — which, since
//     the query asks for the mark, is the same set as "is manga".
registerPatch("after", "GalleryCard.Popovers", (...args: unknown[]) => {
  const props = args[0] as { gallery?: { id?: string } };
  const result = resultFrom(args);
  noteFired("GalleryCard.Popovers");

  const id = props.gallery?.id;
  if (!id || !storedIsManga(String(id))) return result;

  return (
    <>
      {result}
      <MangaPopoverMark galleryId={String(id)} />
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

  // Subscribed for the same reason as the details panel above: whether the edit
  // block is drawn is asked from the store now, and a mark made from the toolbar
  // changes that without touching anything Stash would re-render this for.
  useGlobalVersion();

  // This component *is* the gallery's edit form's custom-fields section: it is
  // rendered for every gallery, whether or not this plugin has marked it, and it
  // is handed both the form's map and the setter for it. Published for the
  // toolbar switch, which marks through the form as well as through the server —
  // publishing it from the edit block instead would cover only galleries that are
  // already manga, and marking a gallery that is not is exactly the case this is
  // for. Cleared when the form goes, so nothing writes into one that is not there.
  React.useEffect(() => {
    const galleryId = currentGalleryId();
    if (props.onChange && galleryId) {
      editForm = {
        galleryId,
        values: props.values ?? {},
        onChange: props.onChange,
      };
    }
    return () => {
      editForm = null;
    };
  });

  return (
    <>
      {/* Only on a gallery that is manga. An unmarked gallery's edit form is
          Stash's own, unchanged — the plugin is not there at all. */}
      {isMarkedNow(currentGalleryId(), props.values) ? (
        <MangaFieldBlock values={props.values} onChange={props.onChange} />
      ) : null}
      <Original {...props} />
    </>
  );
});

// 3. Edit page: stop rendering the input row of every field this plugin owns —
//    they are all handled above now. Every other field goes straight back to the
//    original component, so the plugin has zero effect on them.
//
//    isNew must pass through: that is the "new field" row, and the user may be
//    in the middle of typing a name that will turn out to be ours. Returning null
//    would make the whole row vanish mid-keystroke.
//
//    All three, not just the language: this patch is what stops a raw
//    `plugin.mangaTools.censorship` row appearing in the form, and it went
//    unnoticed that it only ever checked for the language one until the other two
//    fields existed.
registerPatch("instead", "CustomFieldInput", (...args: unknown[]) => {
  const props = args[0] as { field?: string; isNew?: boolean };
  const Original = originalFrom(args);
  noteFired("CustomFieldInput");

  const isOwnRow = NS.isOwnField(props.field);

  if (!props.isNew && isOwnRow) {
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

/** The bulk edit dialog's mount point (see BulkFieldsRow) */
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

  // Subscribed, because what this renders depends on this plugin's own state:
  // whether the gallery is marked, which is now answered from the store rather
  // than from the values Stash passed in (see isMarkedNow). Without this, marking
  // a gallery on this very page would not draw the panel — nothing here would
  // re-render, since the write deliberately leaves Apollo's cache alone.
  useGlobalVersion();

  const values = props.values;
  if (!values || typeof values !== "object") return <Original {...props} />;

  const rest = Object.assign({}, values) as CustomFieldsMap;
  let lifted = false;

  Object.keys(values).forEach((k) => {
    if (!NS.isOwnField(k)) return;
    lifted = true;
    delete rest[k];
  });

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
        Drawn for a manga gallery that carries a value; the panel itself drops
        out entirely when none of its three fields is set.
      */}
      {galleryId && isMarkedNow(galleryId, values) ? (
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

// 7. The gallery list's filter sections. Stash wraps its own sidebar filter
//    sections in a patch container, `FilteredGalleryList.SidebarSections`, and
//    that is where these go: pushed in front of Stash's own, they land where
//    they have always been — after the sidebar's saved-filters header, before
//    its studio filter. Nothing is inserted into the DOM for this, and nothing
//    has to be found again after a re-render.
//
//    Two things make it work, and both are why this is not done from the list
//    below. The container is handed nothing but its children, so the filter
//    model has to come from somewhere else: it is published from
//    `FilteredGalleryList`'s own output (see the patch above), which React
//    renders before the sidebar and so before this container — the sections read
//    it on the same pass. Publishing from `GalleryList` instead, whose props do
//    carry the model, does not work: that is the list of cards, rendered *after*
//    the sidebar, so the sections would read nothing on the first pass and only
//    appear a render later.
registerPatch("after", "FilteredGalleryList.SidebarSections", (...args) => {
  const result = resultFrom(args);
  noteFired("FilteredGalleryList.SidebarSections");

  const filter = currentSidebarFilter();
  if (!filter) return result;

  return (
    <>
      <SidebarLanguageFilter filter={filter} />
      <SidebarCensorshipFilter filter={filter} />
      <SidebarMangaFilter filter={filter} />
      {result}
    </>
  );
});

// 7b. Publishes the filter the sidebar's sections are built from.
//
//    `FilteredGalleryList` creates the model (`useFilteredItemList`) and passes
//    it down to everything that uses it; nothing above it has it, and the
//    sidebar's container is handed only children. An `after` patch sees the
//    component's output — the element tree, with the model on the props of the
//    elements that were given it — while still running *before* React descends
//    into that tree, which is exactly the window the sidebar needs.
//
//    The walk is recursive rather than a path through `SidebarPane`/`Sidebar`/
//    `SidebarContent`: that tree is Stash's, and one of those being renamed or
//    wrapped would silently leave the sections unbuilt.
registerPatch("after", "FilteredGalleryList", (...args) => {
  const result = resultFrom(args);
  noteFired("FilteredGalleryList");

  // The container the sections are mounted through, checked here rather than at
  // load: components are registered as their module loads, and this one may not
  // exist yet when the plugin does. Rendering the list is the proof that its
  // module is loaded, and a Stash without it — it arrived in v0.31 — would
  // otherwise lose the three sections without a word.
  if (!warnedMissingSidebarContainer && !hasSidebarSectionsContainer()) {
    warnedMissingSidebarContainer = true;
    console.error(
      "[mangaTools] this Stash has no FilteredGalleryList.SidebarSections, so " +
        "the language, censorship and manga filter sections are unavailable. " +
        "Stash v0.31 added the patch container they are mounted through."
    );
  }

  publishSidebarFilter(findFilter(result));
  return result;
});

// 8. The filter dialog's card. Rendered from `GalleryList` because that is the
//    component with the model in hand on this page; the card portals itself into
//    the dialog through the DOM, since a dialog is not part of the list's tree.
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
      <DialogLanguageFilter filter={props.filter as MangaToolsFilterModel} />
      <Original {...props} />
    </>
  );
});

// 8. Bulk edit: mounts the manga rows into the bulk edit dialog. The dialog
//    itself is not a PatchComponent, so RatingSystem — the only patchable
//    component it renders — is used purely as a mount point; the rows are
//    positioned by the DOM anchor and their values reach the mutation through
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
      <BulkFieldsRow />
    </>
  );
});

start();
