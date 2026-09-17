/**
 * The surfaces this plugin reaches into, and the namespace it publishes its own
 * logic on.
 *
 * Only what is actually used is declared. An inaccurate declaration is worse than
 * none: it type-checks code that fails at runtime, and this plugin's other half is
 * DOM work against markup that only a browser can confirm.
 */
import type { MangaReaderPage, MangaReaderScreen } from "./spreads";

/** The slice of Apollo's client this plugin queries through. */
export interface MangaReaderApolloClient {
  query(options: {
    query: unknown;
    variables?: Record<string, unknown>;
    fetchPolicy?: string;
  }): Promise<{ data?: { [key: string]: unknown } }>;
}

/**
 * Stash's plugin API, as far as this plugin uses it.
 *
 * `GQL` is the plugin API's own gql namespace, which some versions carry instead
 * of the one on the Apollo library. Both are looked up, because a plugin that
 * assumed either alone would fail on the other.
 */
export interface IPluginApi {
  libraries: {
    Apollo?: { gql?: (text: string) => unknown };
  };
  GQL?: { gql?: (text: string) => unknown };
  utils: {
    StashService: { getClient(): MangaReaderApolloClient };
  };
}

/** Just the settings this plugin keeps. See settings.ts. */
export interface MangaReaderSettings {
  /** The mode itself. Off until somebody turns it on. */
  doublePage: boolean;
  /** Whether the first page is given a screen of its own. */
  coverAlone: boolean;
  /** Whether a page wider than it is tall is taken for a spread. */
  detectSpreads: boolean;
}

/** What is being read: the pages, and where the reader is. */
export interface MangaReaderGallery {
  id: string;
  pages: MangaReaderPage[];
  screens: MangaReaderScreen[];
}

/**
 * The namespace this plugin publishes its logic on.
 *
 * Same arrangement mangaTools uses: modules attach themselves to the window so a
 * smoke test can reach the functions without a bundler of its own. Nothing at
 * runtime reads it — the plugin ships as one file, with its imports inlined.
 *
 * The pairing rules are in spreads.ts and the settings in settings.ts; each
 * publishes its own members, so neither has to import the other.
 */
export interface MangaReaderNamespace {
  parseSettings(raw: string | null): MangaReaderSettings;
  parseOffsets(raw: string | null): { [galleryId: string]: 0 | 1 };
  parseIndicator(text: string): { current: number; total: number } | null;
  galleryIdFromPath(pathname: string): string | null;
  isWideSpreadPage(page: MangaReaderPage): boolean;
  layout(
    pages: MangaReaderPage[],
    options?: Partial<{
      coverAlone: boolean;
      offset: 0 | 1;
      detectSpreads: boolean;
    }>
  ): MangaReaderScreen[];
  screenAt(screens: MangaReaderScreen[], pageIndex: number): number;
  stepsToAdjacent(
    screens: MangaReaderScreen[],
    pageIndex: number,
    direction: 1 | -1
  ): number;
}

/** The one namespace object, created here because this module is the types' home */
window.MangaReader = window.MangaReader || ({} as MangaReaderNamespace);
export const NR: MangaReaderNamespace = window.MangaReader;

declare global {
  interface Window {
    /** Injected by Stash before any plugin script runs */
    PluginApi?: IPluginApi;
    /** Published by this plugin's own modules, read by its smoke test */
    MangaReader?: MangaReaderNamespace;
  }
}

/**
 * Returns Stash's PluginApi, or throws if it is missing.
 *
 * Throws rather than returning null: everything this plugin does needs the API,
 * and a plugin that quietly did nothing would look like a plugin that failed to
 * load. Stash injects it before any plugin script runs, so its absence is a real
 * fault and not a case to handle.
 */
export function requirePluginApi(): IPluginApi {
  const api = window.PluginApi;
  if (!api) throw new Error("[mangaReader] PluginApi is not available");

  return api;
}

/**
 * `gql`, wherever this Stash keeps it.
 *
 * A document rather than the text it was built from: handing Apollo a plain string
 * is a rejected promise with nothing useful in it, and every operation here goes
 * through this.
 */
export function gqlDoc(text: string): unknown {
  const api = requirePluginApi();
  const gql = api.libraries.Apollo?.gql || api.GQL?.gql;
  if (!gql) {
    console.error("[mangaReader] gql not available, cannot build a query");
    return null;
  }

  return gql(text);
}
