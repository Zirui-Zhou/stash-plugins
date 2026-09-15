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

/** The namespace languages.ts publishes on window.MangaTools */
export interface MangaToolsNamespace {
  LANGUAGES: { [code: string]: MangaToolsLanguage };
  FALLBACK_LOCALE: string;
  FIELD_NAME: string;

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
}

/** What react-intl's useIntl() gives us — only the fields this plugin touches */
export interface MangaToolsIntl {
  locale: string;
  formatMessage(descriptor: { id: string; defaultMessage?: string }): string;
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

/** The mutation StashService.useConfigurePlugin() returns */
export type MangaToolsConfigurePluginFn = (options: {
  variables: { plugin_id: string; input: Record<string, unknown> };
}) => Promise<unknown>;

export type MangaToolsGql = (source: string) => unknown;

/**
 * A patch callback. `patch.instead` appends `next()` to the arguments, and what
 * that returns is the original component — so the last argument is always the
 * component to fall back to. See originalFrom() in mangaTools.tsx.
 */
export type MangaToolsPatchFn = (...args: unknown[]) => unknown;

export interface IPluginApi {
  /**
   * Stash's own React. Typed as the module namespace rather than a hand-written
   * interface, so `React.useState` and friends are checked against the real
   * @types/react rather than against a guess.
   */
  React: typeof import("react");

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
    /** react-bootstrap, used for the settings switches */
    Bootstrap?: {
      Form: { Switch: ComponentType<Record<string, unknown>> };
    };
    Intl: { useIntl(): MangaToolsIntl };
    /** react-select as a namespace import: the component is its default export */
    ReactSelect: { default?: unknown; Select?: unknown };
  };

  utils: {
    StashService: {
      getClient(): MangaToolsApolloClient;
      useConfigurePlugin(): [MangaToolsConfigurePluginFn];
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
