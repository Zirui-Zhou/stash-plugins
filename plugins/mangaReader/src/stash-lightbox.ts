/**
 * What this plugin knows about Stash's lightbox: its markup, how to read where it
 * is, how to move it, and how to fetch the pages it is showing.
 *
 * Every name in here is an assumption about a component Stash does not expose —
 * `LightboxComponent` is a plain `React.FC` with no `PatchComponent` wrapper, so
 * there is no supported way in and this is the boundary where that is admitted.
 * Keeping the assumptions in one file is what makes them checkable against
 * Stash's source, and what the test suite can pin the parts of that are pure
 * (`parseIndicator`, `galleryIdFromPath`).
 *
 * If Stash renames something here, the reader stops working — so everything that
 * reads the lightbox returns null rather than guessing, and the caller turns the
 * mode off. A reader that cannot tell where it is must not draw anything.
 */
import { NR, gqlDoc, requirePluginApi } from "./plugin-api";
import type { MangaReaderPage } from "./spreads";

/** The root element's class. Everything else is a child of it. */
export const CLASS_LIGHTBOX = "Lightbox";
export const CLASS_DISPLAY = "Lightbox-display";
export const CLASS_CAROUSEL = "Lightbox-carousel";
export const CLASS_INDICATOR = "Lightbox-header-indicator";
export const CLASS_OPTIONS_ICON = "Lightbox-header-options-icon";
export const CLASS_POPOVER_BODY = "popover-body";

/** The selectors, spelled once so a page of Stash's markup is read the same way everywhere */
export const SELECTOR_LIGHTBOX = ".Lightbox";
export const SELECTOR_DISPLAY = ".Lightbox-display";
export const SELECTOR_CAROUSEL = ".Lightbox-carousel";
export const SELECTOR_INDICATOR = ".Lightbox-header-indicator";
export const SELECTOR_OPTIONS_ICON = ".Lightbox-header-options-icon";
export const SELECTOR_POPOVER_BODY = ".popover .popover-body";

/** Where the lightbox is, as far as the reader can tell. */
export interface LightboxPosition {
  /** 1-based, as the lightbox's own header counts */
  current: number;
  total: number;
}

/**
 * Reads the lightbox's header, which spells out "N / M".
 *
 * That text is the lightbox's own statement of where it is, which is why it is
 * what this plugin reads rather than the carousel's image: the header is one
 * element with one meaning, where the carousel holds several slides at once and
 * which of them is current depends on its internals.
 *
 * Null whenever the text is not the shape expected. A gallery of one image has no
 * counter at all — Stash draws it only when there is more than one — and that is a
 * null too, for the same reason as any other: nothing may be assumed from it.
 */
export function parseIndicator(text: string): LightboxPosition | null {
  const match = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
  if (!match) return null;

  const current = Number(match[1]);
  const total = Number(match[2]);
  if (!total || current < 1 || current > total) return null;

  return { current, total };
}

/** Where the lightbox is, or null when it cannot be told. */
export function readPosition(root: Element): LightboxPosition | null {
  const indicator = root.querySelector(SELECTOR_INDICATOR);
  // The counter is the <b> inside the header: the span beside it is the chapter
  // name, which is not a number.
  const counter = indicator?.querySelector("b");
  if (!counter) return null;

  return parseIndicator(counter.textContent || "");
}

/** The gallery a path belongs to, or null for any other page. */
export function galleryIdFromPath(pathname: string): string | null {
  const match = /^\/galleries\/(\d+)/.exec(pathname);
  return match ? match[1] : null;
}

/**
 * Presses one of the lightbox's own arrow keys, once.
 *
 * **One press, never a burst.** Stash's own key handler drops a press that arrives
 * while a page is still swapping (`isSwitchingPageRef` in its lightbox — "rapid
 * inputs are dropped", as its comment puts it), so two presses in the same tick
 * advance one page rather than two. That is intermittent, because a cached page
 * swaps fast enough for it not to happen, and it is why the reader presses, waits
 * for the header to say it landed, and presses again — see steppingTo in
 * takeover.ts.
 *
 * The event is dispatched on `document`, where the lightbox listens, and is
 * deliberately not `isTrusted` — which is how the reader's own key handler tells
 * it from a real key press and lets it through.
 */
export function pressArrow(direction: 1 | -1): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: direction > 0 ? "ArrowRight" : "ArrowLeft",
      bubbles: true,
      cancelable: true,
    })
  );
}

/**
 * One query for everything opening a gallery needs.
 *
 * Two things, one round trip: the pages, and the language this Stash's interface
 * is in — which the plugin needs for the label it adds to the lightbox's options
 * menu, and which cannot be read from the page (Stash leaves `html lang` at `en`
 * whatever the interface is set to).
 *
 * The image filter is copied from GalleryViewer, which is the list the lightbox is
 * opened with: `per_page: -1, sort: "path"` and nothing else. **The sort has to
 * match**, because the pairing is only meaningful against the order the reader is
 * being shown.
 */
export const GALLERY_QUERY_TEXT = [
  "query MangaReaderGallery($galleryId: ID!) {",
  "  configuration {",
  "    interface {",
  "      language",
  "    }",
  "  }",
  "  findImages(",
  "    image_filter: { galleries: { value: [$galleryId], modifier: INCLUDES } }",
  '    filter: { per_page: -1, sort: "path" }',
  "  ) {",
  "    images {",
  "      id",
  "      visual_files {",
  "        ... on ImageFile {",
  "          width",
  "          height",
  "        }",
  "      }",
  "    }",
  "  }",
  "}",
].join("\n");

let galleryQuery: unknown = null;

/** What the gallery query returns, as far as this plugin cares */
interface GalleryPayload {
  configuration?: { interface?: { language?: string } };
  findImages?: {
    images?: Array<{
      id: string;
      visual_files?: Array<{ width?: number; height?: number }>;
    }>;
  };
}

export interface GalleryAnswer {
  /** The interface language, or null when Stash did not say */
  language: string | null;
  pages: MangaReaderPage[];
}

/**
 * The pages of a gallery, in the order the lightbox shows them.
 *
 * A page's size comes from its first visual file that reported one; a page with
 * none still counts, because dropping it would shift every pair after it. That is
 * the one place a missing size matters, and it is why spreads.ts treats an unknown
 * size as an ordinary page rather than as a spread.
 */
export async function fetchGallery(galleryId: string): Promise<GalleryAnswer> {
  if (!galleryQuery) galleryQuery = gqlDoc(GALLERY_QUERY_TEXT);
  const query = galleryQuery;
  if (!query) throw new Error("[mangaReader] no gallery query document");

  const data = await requirePluginApi()
    .utils.StashService.getClient()
    // no-cache: this is read once per gallery opened and nothing else in the page
    // wants it in Apollo's normalised cache — the lightbox's own query is the one
    // that belongs there, and two writers of the same Image objects is how a
    // cache starts disagreeing with itself.
    .query({ query, variables: { galleryId }, fetchPolicy: "no-cache" })
    .then((res) => res?.data as GalleryPayload | undefined);

  const pages: MangaReaderPage[] = (data?.findImages?.images || []).map(
    (image) => {
      const file = (image.visual_files || []).find(
        (f) => typeof f?.width === "number" && typeof f?.height === "number"
      );

      return {
        id: String(image.id),
        width: file?.width || 0,
        height: file?.height || 0,
      };
    }
  );

  return {
    language: data?.configuration?.interface?.language || null,
    pages,
  };
}

NR.parseIndicator = parseIndicator;
NR.galleryIdFromPath = galleryIdFromPath;
