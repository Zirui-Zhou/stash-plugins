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
}

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
    Apollo?: { gql?: MangaToolsGql };
    Intl: { useIntl(): MangaToolsIntl };
    /** react-select as a namespace import: the component is its default export */
    ReactSelect: { default?: unknown; Select?: unknown };
  };

  utils: {
    StashService: { getClient(): MangaToolsApolloClient };
  };

  Event: {
    addEventListener(name: string, callback: (event: unknown) => void): void;
  };

  patch: {
    instead(target: string, fn: MangaToolsPatchFn): void;
  };
}

interface Window {
  /** Injected by Stash before any plugin script runs */
  PluginApi?: IPluginApi;
  /** Published by languages.ts, consumed by mangaTools.tsx */
  MangaTools?: MangaToolsNamespace;
}
