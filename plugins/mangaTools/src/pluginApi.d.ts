/**
 * Type declarations for the surfaces this plugin reaches into.
 *
 * Deliberately a plain global script — no import/export anywhere in this file.
 * With `module: "None"` a file containing an import becomes a module, and that
 * would break the emitted output. This is also why `interface Window` below
 * augments the DOM's Window by declaration merging, instead of the usual
 * `declare global { ... }` block (which itself requires a module).
 *
 * Only the parts actually used are declared. Widening this to the full Stash
 * UI plugin API is possible but pointless: an inaccurate declaration is worse
 * than none, since it would type-check code that fails at runtime.
 */

/** One entry of the language table in languages.ts */
interface MangaToolsLanguage {
  /** flag-icons alpha-2 *country* code, not a language code */
  flag: string;
  /** Localised names, keyed by Stash UI locale (see localeCode) */
  names: { [locale: string]: string };
}

/** Result of MangaTools.describe() */
interface MangaToolsDescription {
  code: string;
  /** null for values the table does not recognise */
  flag: string | null;
  name: string;
  known: boolean;
}

/** One dropdown option from MangaTools.languageOptions() */
interface MangaToolsOption {
  value: string;
  label: string;
  flag: string | null;
}

/** The namespace languages.ts publishes on window.MangaTools */
interface MangaToolsNamespace {
  LANGUAGES: { [code: string]: MangaToolsLanguage };
  ORDER: string[];
  FALLBACK_LOCALE: string;
  FIELD_NAME: string;

  localeCode(locale?: string | null): string;
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
interface MangaToolsIntl {
  locale: string;
  formatMessage(descriptor: { id: string; defaultMessage?: string }): string;
}

/** The slice of the Apollo client this plugin uses */
interface MangaToolsApolloClient {
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
interface MangaToolsApolloOperation {
  query: unknown;
  variables: Record<string, unknown>;
}

/** What forwarding an operation returns; only `map` is used here */
interface MangaToolsApolloObservable {
  map(fn: (result: unknown) => unknown): MangaToolsApolloObservable;
}

/** What a link calls to pass the operation further down the chain */
type MangaToolsApolloForward = (
  operation: MangaToolsApolloOperation
) => MangaToolsApolloObservable;

/**
 * ApolloLink's static side. Only the two entry points this plugin uses are
 * declared: `new ApolloLink(fn)` builds a single link, and
 * `ApolloLink.from([...])` composes a chain.
 */
interface MangaToolsApolloLinkClass {
  new (
    request: (
      operation: MangaToolsApolloOperation,
      forward: MangaToolsApolloForward
    ) => MangaToolsApolloObservable
  ): unknown;

  from(links: unknown[]): unknown;
}

/** The mutation StashService.useConfigurePlugin() returns */
type MangaToolsConfigurePluginFn = (options: {
  variables: { plugin_id: string; input: Record<string, unknown> };
}) => Promise<unknown>;

type MangaToolsGql = (source: string) => unknown;

/**
 * A patch callback. `patch.instead` appends `next()` to the arguments, and what
 * that returns is the original component — so the last argument is always the
 * component to fall back to. See originalFrom() in mangaTools.tsx.
 */
type MangaToolsPatchFn = (...args: unknown[]) => unknown;

interface IPluginApi {
  React: typeof React;

  ReactDOM: {
    createPortal(children: React.ReactNode, container: Element): React.ReactPortal;
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
      Form: { Switch: React.ComponentType<Record<string, unknown>> };
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

interface Window {
  /** Injected by Stash before any plugin script runs */
  PluginApi?: IPluginApi;
  /** Published by languages.ts, consumed by mangaTools.tsx */
  MangaTools?: MangaToolsNamespace;
}
