/**
 * Manga Reader — how a gallery's pages go together into screens.
 *
 * Pure data plus pure functions: no PluginApi, no DOM. The smoke tests call these
 * directly, and that is the reason they live in a file of their own — the reader
 * that consumes them is DOM surgery inside Stash's own lightbox, and a test that
 * had to drive *that* would be testing Stash's markup rather than the pairing.
 *
 * READING ORDER, NOT VISUAL ORDER. A screen's `pages` come in the order they are
 * read: `pages[0]` is the earlier page. In a right-to-left book the earlier page
 * is drawn on the *right*, so the reader reverses them as it lays them out.
 * Keeping direction out of this file means the rules have no direction in them to
 * get wrong — and a western comic would be the same rules with the reversing done
 * the other way round.
 */
import { NR } from "./plugin-api";

/** One page, as far as pairing cares. Dimensions come from Stash's image rows. */
export interface MangaReaderPage {
  id: string;
  width: number;
  height: number;
}

/** One screenful: what the reader puts on screen at once. */
export interface MangaReaderScreen {
  /** Index into the page list of this screen's *first* page */
  start: number;
  /** One page, or the two that share a screen — in reading order */
  pages: MangaReaderPage[];
}

export interface MangaReaderSpreadOptions {
  /** The first page stands alone: a cover is not the left half of anything. */
  coverAlone: boolean;
  /**
   * Shift the pairing on by one page, for a gallery whose pages are grouped
   * wrongly. See SPREAD_RATIO for the case that needs it.
   */
  offset: 0 | 1;
  /** Treat a page wider than it is tall as one image spanning two pages. */
  detectSpreads: boolean;
}

export const DEFAULT_SPREAD_OPTIONS: MangaReaderSpreadOptions = {
  coverAlone: true,
  offset: 0,
  detectSpreads: true,
};

/**
 * How much wider than tall a page has to be before it is taken for a spread.
 *
 * A page scanned on its side is the case no ratio can settle: a rotated single
 * page is as wide as a spread is, and nothing in the numbers tells the two apart.
 * That is what the offset is for — when one is judged wrongly, every pair after it
 * is off by a page, and shifting the pairing by one puts them all back.
 */
const SPREAD_RATIO = 1;

/** Whether a page takes a screen of its own because it spans two of them. */
export function isWideSpreadPage(page: MangaReaderPage): boolean {
  // A page whose size Stash did not report is not evidence of anything, so it
  // pairs like an ordinary page rather than standing alone.
  if (!page.height || page.width <= 0) return false;

  return page.width / page.height > SPREAD_RATIO;
}

/**
 * Every screen of a gallery, in order.
 *
 * A single pass from the front, because the rule is about *pairs* and nothing
 * later can change whether an earlier page was pairable:
 *
 *   - the cover stands alone, when asked for;
 *   - the offset stands one more page alone, when asked for;
 *   - a page that is a spread stands alone;
 *   - two ordinary pages share a screen;
 *   - a page whose neighbour is a spread stands alone, which is the case that
 *     leaves a screen with one page in the middle of a book.
 */
export function layout(
  pages: MangaReaderPage[],
  options?: Partial<MangaReaderSpreadOptions>
): MangaReaderScreen[] {
  const opts: MangaReaderSpreadOptions = {
    ...DEFAULT_SPREAD_OPTIONS,
    ...(options || {}),
  };
  const screens: MangaReaderScreen[] = [];

  const pairable = (page: MangaReaderPage): boolean =>
    !(opts.detectSpreads && isWideSpreadPage(page));

  let i = 0;
  const standAlone = (): void => {
    screens.push({ start: i, pages: [pages[i]] });
    i += 1;
  };

  if (opts.coverAlone && i < pages.length) standAlone();
  if (opts.offset === 1 && i < pages.length) standAlone();

  while (i < pages.length) {
    const next = pages[i + 1];
    if (next && pairable(pages[i]) && pairable(next)) {
      screens.push({ start: i, pages: [pages[i], next] });
      i += 2;
    } else {
      standAlone();
    }
  }

  return screens;
}

/**
 * Which screen a page is on, or -1 when the index is not in the list.
 *
 * The reader asks this with *Stash's* idea of the current page, which is why it
 * takes a page index rather than a screen index: the two are different numbers
 * and Stash's is the one the lightbox header and keyboard work in.
 */
export function screenAt(
  screens: MangaReaderScreen[],
  pageIndex: number
): number {
  for (let i = 0; i < screens.length; i++) {
    const screen = screens[i];
    if (
      pageIndex >= screen.start &&
      pageIndex < screen.start + screen.pages.length
    ) {
      return i;
    }
  }

  return -1;
}

/**
 * How far Stash's page index has to move to reach the screen next to this one.
 *
 * Signed, and counted from the page the reader is actually on: forward from the
 * first page of a pair is two, and from the second is one. Zero means there is no
 * screen that way, which is the end of the book.
 *
 * A number rather than a screen, because the reader's only way to move Stash is to
 * press its arrow key that many times — see the note in mangaReader.tsx.
 */
export function stepsToAdjacent(
  screens: MangaReaderScreen[],
  pageIndex: number,
  direction: 1 | -1
): number {
  const at = screenAt(screens, pageIndex);
  if (at < 0) return 0;

  const target = screens[at + direction];
  if (!target) return 0;

  return target.start - pageIndex;
}

// Published for the smoke test, which reaches them through the window — see the
// note on MangaReaderNamespace in plugin-api.ts.
NR.isWideSpreadPage = isWideSpreadPage;
NR.layout = layout;
NR.screenAt = screenAt;
NR.stepsToAdjacent = stepsToAdjacent;
