/**
 * Type declarations for the surfaces this plugin reaches into, plus the one
 * accessor it uses to get hold of them.
 *
 * This used to be a `.d.ts` of ambient globals, which is what the official
 * Stash plugin example does. It became a real module when the plugin gained a
 * bundler (esbuild — see tools/build.mjs): once `import`/`export` are available,
 * a module is strictly better than a global script. The types below are
 * exported and imported by name, so a typo in a type name is a compile error
 * instead of an accidental reference to some other global, and `interface
 * Window` has to say `declare global` because it is no longer implicitly global.
 *
 * Only the parts actually used are declared. Widening this to the full Stash
 * UI plugin API is possible but pointless: an inaccurate declaration is worse
 * than none, since it would type-check code that fails at runtime.
 */
import type { ComponentType, ReactNode, ReactPortal } from "react";

/** One entry of the language table in languages.ts */
export interface MangaToolsLanguage {
  /** flag-icons alpha-2 *country* code, not a language code */
  flag: string;
}

/**
 * The slice of Intl.DisplayNames this plugin uses.
 *
 * Declared here rather than taken from lib.dom because DisplayNames is ES2021
 * and this project compiles against ES2019 — raising the target to reach it
 * would remove the downleveling safety net for the rest of the bundle. See
 * displayNamesFor in languages.ts, which looks the constructor up at runtime
 * and treats its absence as a normal case.
 */
export interface MangaToolsDisplayNames {
  /** Echoes the code back when it cannot resolve it */
  of(code: string): string | undefined;
}

/** Its constructor. The locale list is ordered by preference. */
export interface MangaToolsDisplayNamesCtor {
  new (
    locales: string[],
    options: { type: "language" }
  ): MangaToolsDisplayNames;
}

/** Result of MangaTools.describe() */
export interface MangaToolsDescription {
  code: string;
  /** null for values the table does not recognise */
  flag: string | null;
  name: string;
  known: boolean;
}

/** One dropdown option from MangaTools.languageOptions() */
export interface MangaToolsOption {
  value: string;
  label: string;
  flag: string | null;
}

/**
 * A gallery's custom_fields, as Stash's GraphQL Map scalar gives it: string keys,
 * arbitrary values. This plugin only ever writes strings, but it does not get to
 * decide what is already in there.
 */
export interface MangaToolsCustomFields {
  [key: string]: unknown;
}

/** The namespace languages.ts and fields.ts publish on window.MangaTools */
export interface MangaToolsNamespace {
  LANGUAGES: { [code: string]: MangaToolsLanguage };
  FALLBACK_LOCALE: string;

  /** The language field's name. See fields.ts. */
  FIELD_NAME: string;
  /** The censorship field's name. See fields.ts. */
  CENSORSHIP_FIELD_NAME: string;
  /** The values the censorship field takes, in cycle order. See fields.ts. */
  CENSORSHIP_VALUES: string[];
  /** A stored censorship value as one of CENSORSHIP_VALUES, or "" for anything else. */
  normalizeCensorship(raw: unknown): string;

  /** Reads a named field out of a custom_fields map, case-insensitively. */
  pickField(customFields: unknown, name: string): string;
  /** Writes a named field into a copy of the map. "" removes it. */
  setField(
    customFields: unknown,
    name: string,
    value: string
  ): MangaToolsCustomFields;

  findCanonical(code?: string | null): string;
  normalize(raw: unknown): string;
  name(code: unknown, locale?: string | null): string;
  describe(raw: unknown, locale?: string | null): MangaToolsDescription | null;
  languageOptions(locale?: string | null): MangaToolsOption[];

  /** Set of enabled languages, or null for "no restriction". Populated by mangaTools.tsx. */
  enabledLanguages: Set<string> | null;
  parseEnabledLanguages(raw: unknown): Set<string> | null;
  serializeEnabledLanguages(codes: Iterable<string>): string;

  /** Whether flags are drawn. Populated by mangaTools.tsx from the plugin settings. */
  showFlags: boolean;
  /** Whether the cover badge is drawn. Independent of showFlags. */
  showCoverBadge: boolean;
  parseFlag(raw: unknown, fallback: boolean): boolean;

  /**
   * The language part of Stash's filter model, as the sidebar section sees it.
   * Populated by language-filter.tsx.
   */
  readLanguageFilter(
    filter: MangaToolsFilterModel
  ): MangaToolsLanguageSelection;
  /**
   * Query parameters for the filter with this selection applied, or null when
   * the list offers no custom-fields criterion to attach it to.
   */
  languageFilterQuery(
    filter: MangaToolsFilterModel,
    selection: MangaToolsLanguageSelection
  ): string | null;
  /**
   * Adds the Language criterion to a list's filter options, so Stash's "edit
   * filters" dialog offers a card for it. Idempotent.
   */
  registerLanguageCriterionOption(filter: MangaToolsFilterModel): void;
  /**
   * Gives the filter's criterion the Language identity Stash's own controls read,
   * without changing the type it stores itself as. Idempotent.
   */
  adoptLanguageCriterion(filter: MangaToolsFilterModel): void;
  /**
   * Re-words Stash's tags for the language filter in the list's row, one label
   * per tag in the order Stash draws them. A DOM repair, not a render — see the
   * note above it in language-filter.tsx for why it cannot be anything else.
   */
  relabelTags(labels: string[]): void;
  /**
   * Words the dialog's tags from the card, one label per tag, hiding the tags the
   * card has nothing to say in — see the note above it in language-filter.tsx.
   */
  manageDialogTags(labels: string[]): void;
  /** The labels the card must draw itself, having found no tag of Stash's for them */
  ownTagLabels(labels: string[]): string[];
  /** Was the ✗ of a language tag in the dialog's row what was clicked? */
  clickedTagRemove(target: Element | null): boolean;

  /*
   * Changes to a selection. Shared by the sidebar section and the dialog's card,
   * which commit at different times but must mean the same thing by a click.
   */
  toggleIncluded(
    selection: MangaToolsLanguageSelection,
    code: string
  ): MangaToolsLanguageSelection;
  toggleExcluded(
    selection: MangaToolsLanguageSelection,
    code: string
  ): MangaToolsLanguageSelection;
  withModifier(
    selection: MangaToolsLanguageSelection,
    modifier: "any" | "none"
  ): MangaToolsLanguageSelection;
  withoutModifier(
    selection: MangaToolsLanguageSelection
  ): MangaToolsLanguageSelection;
  isEmptySelection(selection: MangaToolsLanguageSelection): boolean;
  sameSelection(
    a: MangaToolsLanguageSelection,
    b: MangaToolsLanguageSelection
  ): boolean;
  /**
   * The sentence for one condition of a language filter, built from Stash's own
   * messages — or null for a modifier this plugin has no wording for.
   */
  conditionLabel(
    intl: MangaToolsIntl,
    condition: MangaToolsCustomFieldCondition
  ): string | null;
  /**
   * One label per condition of the criterion, in its order, or null when any of
   * them has no wording. What Stash's tags for it should say.
   */
  tagLabels(
    intl: MangaToolsIntl,
    criterion: MangaToolsFilterCriterion
  ): string[] | null;

  /** One of this plugin's own strings, in the reader's Stash language. */
  t(intl: MangaToolsIntl, id: string): string;
  /** The message catalog a locale reads from — see i18n.ts for the chain. */
  catalogFor(locale: string): { [id: string]: string };
  /** Every catalog, by tag */
  catalogs(): { [locale: string]: { [id: string]: string } };
}

/**
 * What the language filter is asking for.
 *
 * `modifier` is "any" (galleries carrying a language), "none" (those without)
 * or "" when the include/exclude lists are what matter — matching how Stash's
 * own sidebar filter treats its modifier as one of several candidate values
 * rather than as a separate control.
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

/** What react-intl's useIntl() gives us — only the fields this plugin touches */
export interface MangaToolsIntl {
  locale: string;
  formatMessage(
    descriptor: { id: string; defaultMessage?: string },
    values?: { [name: string]: unknown }
  ): string;
}

/** The slice of the Apollo client this plugin uses */
export interface MangaToolsApolloClient {
  query(options: {
    query: unknown;
    fetchPolicy?: string;
  }): Promise<{ data?: { [key: string]: unknown } }>;

  /** The current link chain — read before replacing it (see setLink below) */
  link?: unknown;
  /** Apollo's own API for replacing the link chain after the client exists */
  setLink?(link: unknown): void;
}

/** Minimal shape of an operation as it passes through an Apollo link */
export interface MangaToolsApolloOperation {
  query: unknown;
  variables: Record<string, unknown>;
}

/** What forwarding an operation returns; only `map` is used here */
export interface MangaToolsApolloObservable {
  map(fn: (result: unknown) => unknown): MangaToolsApolloObservable;
}

/** What a link calls to pass the operation further down the chain */
export type MangaToolsApolloForward = (
  operation: MangaToolsApolloOperation
) => MangaToolsApolloObservable;

/**
 * ApolloLink's static side. Only the two entry points this plugin uses are
 * declared: `new ApolloLink(fn)` builds a single link, and
 * `ApolloLink.from([...])` composes a chain.
 */
export interface MangaToolsApolloLinkClass {
  new (
    request: (
      operation: MangaToolsApolloOperation,
      forward: MangaToolsApolloForward
    ) => MangaToolsApolloObservable
  ): unknown;

  from(links: unknown[]): unknown;
}

/**
 * One condition inside the filter's custom-fields criterion.
 *
 * Matches CustomFieldCriterionInput in Stash's schema: a field name, a modifier
 * from CriterionModifier, and a list of values. Stash's own editor only ever
 * puts one value here for EQUALS, which is why this plugin does too.
 */
export interface MangaToolsCustomFieldCondition {
  field: string;
  value?: unknown[];
  modifier: string;
}

/**
 * A filter criterion, as far as this plugin needs one.
 *
 * `criterionOption.type` is how a criterion is identified — "custom_fields" is
 * the one this plugin looks for. Read off the live object rather than imported,
 * because the model lives inside Stash's bundle.
 */
export interface MangaToolsFilterCriterion {
  criterionOption?: { type?: string };
  value?: MangaToolsCustomFieldCondition[];
  /** How the criterion writes itself into the URL */
  toQueryParams?(): { type: string; value: unknown };
}

/**
 * An entry of ListFilterOptions.criterionOptions — a factory for its criterion.
 *
 * Stash only ever reads `type` (to identify the criterion), `messageID` (the
 * card's label) and `makeCriterion` off these, which is what lets a plugin add
 * one without the class it would normally be built from.
 */
export interface MangaToolsCriterionOption {
  type: string;
  messageID: string;
  makeCriterion(): MangaToolsFilterCriterion;
}

/**
 * Stash's ListFilterModel, as far as this plugin needs one.
 *
 * Every one of these is public API, and deliberately so: the obvious way to add
 * a filter would be to build the URL query by hand, but the encoding Stash uses
 * there is private (translateJSON). Cloning the model and asking it for its own
 * query parameters keeps that knowledge in Stash.
 */
export interface MangaToolsFilterModel {
  criteria: MangaToolsFilterCriterion[];
  options?: { criterionOptions?: MangaToolsCriterionOption[] };
  clone(): MangaToolsFilterModel;
  makeQueryParameters(): string;
}

/**
 * react-router v5's history, as used by Stash's own filter hook.
 *
 * `location.state` is the history entry's own state — the place Stash keeps its
 * sidebar sections' open/closed state, and which survives a reload.
 */
export interface MangaToolsHistory {
  location: {
    pathname?: string;
    search?: string;
    state?: { [key: string]: unknown };
  };
  replace(location: {
    pathname?: string;
    search?: string;
    state?: { [key: string]: unknown };
  }): void;
}

/** The mutation StashService.useConfigurePlugin() returns */
export type MangaToolsConfigurePluginFn = (options: {
  variables: { plugin_id: string; input: Record<string, unknown> };
}) => Promise<unknown>;

/** The mutation StashService.useGalleryUpdate() returns */
export type MangaToolsGalleryUpdateFn = (options: {
  variables: { input: Record<string, unknown> };
}) => Promise<unknown>;

export type MangaToolsGql = (source: string) => unknown;

/**
 * A patch callback.
 *
 * `before` and `instead` are both handed the original arguments; `instead` has
 * `next()` appended, and what that returns is the original component — so for
 * those two the last argument is the component to fall back to (see originalFrom).
 * `after` is the odd one out: Stash appends the *rendered result* instead, and the
 * callback is expected to return it (see resultFrom).
 */
export type MangaToolsPatchFn = (...args: unknown[]) => unknown;

export interface IPluginApi {
  /**
   * Stash's own React. Typed as the module namespace rather than a hand-written
   * interface, so `React.useState` and friends are checked against the real
   * @types/react rather than against a guess.
   */
  React: typeof import("react");

  /**
   * Components Stash registers for plugins — those wrapped in PatchComponent.
   * `Icon` is the one used here: the sidebar section's chevron, check and plus
   * marks go through Stash's own wrapper so they match its sizing and classes.
   */
  components: { Icon: ComponentType<Record<string, unknown>> };

  ReactDOM: {
    createPortal(children: ReactNode, container: Element): ReactPortal;
  };

  /** Used as a fallback source for `gql` if libraries.Apollo has none */
  GQL?: { gql?: MangaToolsGql };

  libraries: {
    Apollo?: {
      gql?: MangaToolsGql;
      ApolloLink?: MangaToolsApolloLinkClass;
    };
    /** react-bootstrap: the settings switches, and the sidebar section's button/collapse */
    Bootstrap?: {
      Form: { Switch: ComponentType<Record<string, unknown>> };
      Button: ComponentType<Record<string, unknown>>;
      Collapse: ComponentType<Record<string, unknown>>;
    };
    Intl: { useIntl(): MangaToolsIntl };
    /** FontAwesome's icon definitions, looked up by name */
    FontAwesomeSolid?: { [iconName: string]: unknown };
    FontAwesomeRegular?: { [iconName: string]: unknown };
    /** react-router-dom, used to push the filter URL the way Stash itself does */
    ReactRouterDOM: { useHistory(): MangaToolsHistory };
    /** react-select as a namespace import: the component is its default export */
    ReactSelect: { default?: unknown; Select?: unknown };
  };

  utils: {
    StashService: {
      getClient(): MangaToolsApolloClient;
      useConfigurePlugin(): [MangaToolsConfigurePluginFn];
      /**
       * Stash's own gallery-update mutation, cache eviction included. The same
       * one its organized button uses, so a write from this plugin is
       * indistinguishable from one of Stash's.
       */
      useGalleryUpdate(): [MangaToolsGalleryUpdateFn];
    };
  };

  Event: {
    addEventListener(name: string, callback: (event: unknown) => void): void;
  };

  patch: {
    /**
     * Observes a registered component's arguments. The callback receives the
     * arguments and must return the arguments to pass on — returning them
     * unchanged renders nothing differently, which is how the plugin reads
     * GalleryList's selection without affecting it.
     */
    before(target: string, fn: MangaToolsPatchFn): void;
    instead(target: string, fn: MangaToolsPatchFn): void;
    /**
     * Wraps a registered component's *output*. The callback receives the
     * arguments with the rendered result appended, and returns what should be
     * rendered instead — which, to add something, is the result and then it.
     *
     * Prefer this to `instead` whenever the original is only being appended to:
     * it never calls the original component, so a component with hooks inside
     * (GalleryCard.Overlays uses useMemo) cannot be broken by the patch, and it
     * composes with another plugin's `instead` on the same target, which sees
     * the original rather than whatever this plugin made of it.
     */
    after(target: string, fn: MangaToolsPatchFn): void;
  };
}

declare global {
  interface Window {
    /** Injected by Stash before any plugin script runs */
    PluginApi?: IPluginApi;
    /** Published by languages.ts, consumed by mangaTools.tsx */
    MangaTools?: MangaToolsNamespace;
  }
}

/**
 * Returns Stash's PluginApi, or throws if it is missing.
 *
 * Deliberately not a "check and give up quietly" guard. Stash injects
 * PluginApi before it loads any plugin script, so its absence means something
 * is wrong at the loading level rather than that the plugin should sit out a
 * while — and since a bundled entry point has no early `return` to gracefully
 * bail with, throwing is both the honest and the simplest signal. The message
 * is the only thing the user gets, so it names the plugin and the cause.
 */
export function requirePluginApi(): IPluginApi {
  const api = window.PluginApi;
  if (!api) {
    throw new Error(
      "[mangaTools] window.PluginApi is missing — the plugin cannot load"
    );
  }
  return api;
}
