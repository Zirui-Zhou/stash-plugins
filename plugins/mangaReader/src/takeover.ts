/**
 * The reader: putting two pages where the lightbox keeps one.
 *
 * HOW THIS WORKS, AND WHY IT IS LIKE THIS. Stash's lightbox cannot be patched —
 * `LightboxComponent` is a plain `React.FC`, with no `PatchComponent` wrapper — so
 * there is no supported way to change what it draws. What this file does instead:
 *
 *   1. watches the document for a lightbox appearing, with a `MutationObserver`;
 *   2. puts a container of its own **beside** Stash's carousel, never in place of
 *      it, so React is free to re-render its own subtree without ours going with
 *      it — and the carousel keeps existing, hidden, because it is the thing that
 *      holds the lightbox's idea of where it is;
 *   3. hides that carousel with a class and lays the two pages out itself;
 *   4. drives the lightbox through its own interface — reading where it is from
 *      its header, and moving it with its own arrow keys (see stash-lightbox.ts)
 *      rather than keeping a second idea of the current page that could drift from
 *      the first. Every way of moving — our keys, Stash's keys, the nav strip, a
 *      chapter — ends in the same DOM change, so there is one code path back to a
 *      correct drawing, and it is the observer's.
 *
 * The approach follows kokkengMangaViewer (github.com/kokkeng1/stash_plugin_custom),
 * which does the same thing for a scrolling view. Its lesson worth repeating is
 * that this is a *degradable* feature: everything that reads Stash's markup returns
 * null rather than guessing, and a null turns the mode off and says so. The worst
 * case is a reader who has to press a switch again, never a blank screen.
 */
import { labelFor } from "./i18n";
import type { MangaReaderGallery, MangaReaderSettings } from "./plugin-api";
import {
  readOffset,
  readSettings,
  writeOffset,
  writeSettings,
} from "./settings";
import type { MangaReaderScreen } from "./spreads";
import { layout, screenAt, stepsToAdjacent } from "./spreads";
import {
  SELECTOR_DISPLAY,
  SELECTOR_LIGHTBOX,
  SELECTOR_POPOVER_BODY,
  fetchGallery,
  galleryIdFromPath,
  pressArrow,
  readPosition,
} from "./stash-lightbox";

/** Class on Stash's lightbox while this plugin is drawing inside it */
const CLASS_ACTIVE = "manga-reader-active";
/** This plugin's own container, and the pages in it */
const CLASS_SPREAD = "manga-reader-spread";
const CLASS_PAGE = "manga-reader-page";
const CLASS_SINGLE = "is-single";
/** The switches this plugin adds to the lightbox's options menu */
const SWITCH_ID = "manga-reader-double-page";
const OFFSET_ID = "manga-reader-offset";
/** Class of the group holding them, so it can be found again */
const CLASS_OPTIONS = "manga-reader-options";

/**
 * How many times the container may be put back before the plugin gives up.
 *
 * React owns the element this container sits in, so it can be removed at any
 * moment — the observer puts it back. A container that keeps vanishing is a
 * disagreement with Stash's rendering that re-inserting will not settle, and
 * fighting it in a loop would be worse than not drawing: off, with a line in the
 * console, is the honest ending.
 */
const MAX_REINSERTS = 8;

/** How many galleries' page lists are kept. See loadGallery. */
const CACHE_LIMIT = 8;

let settings: MangaReaderSettings = readSettings();

/** The lightbox being worked in, and this plugin's container inside it */
let root: Element | null = null;
let container: HTMLElement | null = null;

/**
 * The galleries whose pages are in hand, by id.
 *
 * Kept because the same gallery is opened and closed repeatedly — reading a few
 * pages, going back to the thumbnails, opening it again — and the page list is the
 * same answer every time. Bounded, because a session can touch a great many
 * galleries and this is a convenience, not a store.
 */
const loaded: Map<string, MangaReaderGallery> = new Map();

/** The gallery being read, and the screen being drawn from it */
let galleryId: string | null = null;
let shownAt = -1;

/**
 * The offset for the gallery in hand, and which gallery that was.
 *
 * Per gallery, and remembered for it — see the note on OFFSET_KEY. Only one
 * gallery is being read at a time, so the value in hand is the one for `offsetFor`
 * and the two are set together.
 */
let offset: 0 | 1 = 0;
let offsetFor: string | null = null;

let reinsers = 0;
let language: string | null = null;
let logged = false;

/**
 * Where the lightbox is being moved to, while it is on the way there.
 *
 * A turn of a screen is several pages, and the lightbox only moves one page per
 * press — and drops a press that arrives while the page before it is still
 * swapping. So a move is a small errand: press once, wait for the header to say it
 * landed, press again, and give up if it never does. See `press` and `arrived`.
 */
let errand: {
  /** The page index (0-based) the last press started from */
  from: number;
  /** The page index being aimed at */
  to: number;
  /** The press that has been sent and not yet seen land */
  retry: number | null;
} | null = null;

/** How long to wait for a press to land before sending it again, in milliseconds */
const PRESS_RETRY_MS = 120;
/** How many times one step may be re-sent before the errand is abandoned */
const MAX_ATTEMPTS = 3;
let attempts = 0;

// ── The loop ───────────────────────────────────────────────────────

/**
 * One pass over the document: is there a lightbox, and is it where it should be?
 *
 * Cheap by construction — a `querySelector` and a string compare in the common
 * case, since this runs on every DOM change in the page. Everything expensive
 * happens once per gallery, in `loadGallery`.
 */
function step(): void {
  const lightbox = document.querySelector(SELECTOR_LIGHTBOX);

  if (!lightbox) {
    if (root) closeLightbox();
    return;
  }

  if (lightbox !== root) {
    closeLightbox();
    root = lightbox;
    galleryId = null;
    shownAt = -1;
    reinsers = 0;
    logged = false;
  }

  injectSwitch(lightbox);

  if (!wanted()) return;

  const wantedId = galleryIdFromPath(window.location.pathname);
  if (!wantedId) return;

  if (galleryId !== wantedId || !loaded.has(wantedId)) {
    loadGallery(wantedId);
    return;
  }

  sync(lightbox);

  // After the drawing, so an unfinished move shows the page it is passing through
  // rather than skipping it.
  arrived(lightbox);
}

/** Whether the reader should be drawing, as far as can be told without asking */
function wanted(): boolean {
  return (
    settings.doublePage &&
    root !== null &&
    galleryIdFromPath(window.location.pathname) !== null
  );
}

/** The pages of the gallery being read, if they are in hand */
function current(): MangaReaderGallery | null {
  return galleryId ? loaded.get(galleryId) || null : null;
}

/** Asks Stash for the gallery's pages, unless they are already in hand */
function loadGallery(id: string): void {
  // The offset belongs to one gallery, and is remembered for it: a gallery whose
  // pages are grouped wrongly is opened again and again, and being made to shift
  // the pairing every time would be the feature failing at its one job.
  if (offsetFor !== id) {
    offsetFor = id;
    offset = readOffset(id);
  }

  const already = loaded.get(id);
  if (already) {
    galleryId = id;
    shownAt = -1;
    step();
    return;
  }

  const forLightbox = root;

  fetchGallery(id)
    .then((answer) => {
      // The lightbox can have been closed — or another opened — while that was in
      // flight, and an answer for the previous one must not be drawn over this one.
      if (root !== forLightbox) return;

      remember(id, {
        id,
        pages: answer.pages,
        screens: layout(answer.pages, { ...settings, offset }),
      });

      language = answer.language;
      galleryId = id;
      shownAt = -1;
      step();
    })
    .catch((e) => {
      console.error(
        "[mangaReader] could not read this gallery's pages, turning the spread " +
          "view off:",
        e
      );
      deactivate();
    });
}

function remember(id: string, gallery: MangaReaderGallery): void {
  loaded.delete(id);
  loaded.set(id, gallery);

  while (loaded.size > CACHE_LIMIT) {
    const oldest = loaded.keys().next();
    if (oldest.done) break;
    loaded.delete(oldest.value);
  }
}

/** Draws whatever screen the lightbox is currently in */
function sync(lightbox: Element): void {
  const gallery = current();
  if (!gallery) return;

  const position = readPosition(lightbox);
  if (!position) {
    // The counter is drawn only when there is more than one image, so a gallery of
    // one page is the ordinary reason there is nothing to read here — and the
    // other reason is that Stash's markup has changed under this plugin, which is
    // worth a line rather than a silent nothing.
    if (gallery.pages.length <= 1) return;

    console.error(
      "[mangaReader] the lightbox header could not be read, so the spread view " +
        "cannot follow it — turning itself off"
    );
    deactivate();
    return;
  }

  const at = screenAt(gallery.screens, position.current - 1);
  if (at < 0) {
    console.error(
      "[mangaReader] the lightbox is at page " +
        position.current +
        ", which is not among the pages this plugin read — turning the spread " +
        "view off"
    );
    deactivate();
    return;
  }

  if (at === shownAt && container?.childElementCount) return;

  // Only now, with somewhere to draw: inserting the container is what hides the
  // carousel, and a gallery with nothing to show must not be left with a hidden
  // one and an empty screen of ours.
  ensureContainer(lightbox);
  if (!container) return;

  draw(gallery.screens[at], at);
}

/**
 * Creates the container, or puts it back if React has taken it away.
 *
 * Called only when there is something to draw, which is what makes a gallery with
 * nothing to show harmless: no container, and the carousel never hidden.
 */
function ensureContainer(lightbox: Element): void {
  const display = lightbox.querySelector(SELECTOR_DISPLAY);

  if (!display) {
    deactivate();
    return;
  }

  if (container && container.parentNode === display) return;

  if (container) {
    reinsers += 1;
    if (reinsers > MAX_REINSERTS) {
      console.error(
        "[mangaReader] the lightbox keeps removing the reader's container — " +
          "turning the spread view off rather than fighting it"
      );
      deactivate();
      return;
    }
  }

  if (!container) {
    container = document.createElement("div");
    container.className = CLASS_SPREAD;
  }

  // Stash's own layers above this one are positioned; this makes the display the
  // containing block for the container rather than the page.
  (display as HTMLElement).style.position = "relative";
  display.appendChild(container);
  lightbox.classList.add(CLASS_ACTIVE);
}

/** Draws one screen, and warms the pages either side of it */
function draw(screen: MangaReaderScreen, at: number): void {
  if (!container) return;

  container.textContent = "";
  container.classList.toggle(CLASS_SINGLE, screen.pages.length === 1);

  // In reading order: the earlier page first in the DOM, which for a
  // right-to-left book is the right-hand one — the stylesheet reverses them, so
  // the order here stays "as read" and the direction is one CSS rule.
  screen.pages.forEach((page, index) => {
    const box = document.createElement("div");
    box.className = CLASS_PAGE;

    const image = document.createElement("img");
    image.src = "/image/" + page.id + "/image";
    image.alt = String(screen.start + index + 1);
    image.decoding = "async";

    box.appendChild(image);
    container?.appendChild(box);
  });

  shownAt = at;

  const gallery = current();
  if (!logged && gallery) {
    logged = true;
    // One line per read, on the first gallery of the session: what was paired, and
    // where the switch that shifts it lives. The first thing to look at when the
    // pairs look wrong.
    console.info(
      "[mangaReader] " +
        gallery.screens.length +
        " screen(s) from " +
        gallery.pages.length +
        " page(s), offset " +
        offset +
        " — the lightbox's options menu can shift the pairing, and O does the same"
    );
  }

  preload(at);
}

/**
 * Warms the images of the screens either side.
 *
 * A page turn that waits for its own bytes feels broken, and a screen is two
 * images rather than one, so without this a slow library would show one page of a
 * pair and then the other. Nothing is awaited: this is the browser's cache being
 * filled, which is all the next turn needs.
 */
function preload(at: number): void {
  const gallery = current();
  if (!gallery) return;

  for (const step of [1, -1]) {
    const screen = gallery.screens[at + step];
    if (!screen) continue;

    for (const page of screen.pages) {
      const image = new Image();
      image.src = "/image/" + page.id + "/image";
    }
  }
}

// ── Moving the lightbox, a page at a time ──────────────────────────

/** The page the lightbox says it is on, 0-based, or null when it cannot be read */
function currentIndex(lightbox: Element): number | null {
  const position = readPosition(lightbox);
  return position ? position.current - 1 : null;
}

/**
 * Starts moving the lightbox to a page, by whole pages.
 *
 * Called with the page index a turn of the screen lands on. Nothing is sent if the
 * lightbox is already there; otherwise the first press goes now and the rest
 * follow as it lands.
 */
function startErrand(lightbox: Element, to: number): void {
  const from = currentIndex(lightbox);
  if (from === null || from === to) return;

  endErrand();
  attempts = 0;
  errand = { from, to, retry: null };
  press(lightbox);
}

/** Sends the next press of the errand, and arms the retry that covers a dropped one */
function press(lightbox: Element): void {
  if (!errand) return;

  const from = currentIndex(lightbox);
  if (from === null) {
    endErrand();
    return;
  }
  if (from === errand.to) {
    endErrand();
    return;
  }

  errand.from = from;
  attempts += 1;
  pressArrow(from < errand.to ? 1 : -1);
  armRetry(lightbox);
}

/**
 * Waits a moment for the press to land, and sends it again if it did not.
 *
 * The lightbox drops a press that arrives while the page before it is still
 * swapping (see pressArrow), and a dropped press changes nothing in the DOM — so
 * nothing else here would ever notice. This is the only place that waits on a
 * clock rather than on the reader's own header.
 */
function armRetry(lightbox: Element): void {
  if (!errand) return;
  if (errand.retry !== null) window.clearTimeout(errand.retry);

  errand.retry = window.setTimeout(() => {
    if (!errand) return;
    errand.retry = null;

    const at = currentIndex(lightbox);
    // It landed: the drawing follows on its own, and the next press with it.
    if (at === null || at !== errand.from) return;

    if (attempts >= MAX_ATTEMPTS) {
      // Three presses that went nowhere: the lightbox is not moving for reasons
      // this plugin cannot see. Stop, and leave the reader where they are.
      console.error(
        "[mangaReader] the lightbox did not respond to the arrow keys, so the " +
          "spread view has stopped moving it — the page shown is the one it is on"
      );
      endErrand();
      return;
    }

    press(lightbox);
  }, PRESS_RETRY_MS);
}

/**
 * Carries the errand on when a press has landed — called on every DOM change.
 *
 * This is what makes a turn feel immediate: the wait between presses is the
 * lightbox's own page swap, not a timer. The timer in armRetry is only there for
 * the press that landed nowhere.
 */
function arrived(lightbox: Element): void {
  if (!errand) return;

  const at = currentIndex(lightbox);
  if (at === null) {
    endErrand();
    return;
  }
  if (at === errand.to) {
    endErrand();
    return;
  }

  // Still on the page that press started from: it has not landed yet, and the
  // timer is watching for that. Anywhere else, it landed short of the target.
  if (at !== errand.from) press(lightbox);
}

function endErrand(): void {
  if (errand && errand.retry !== null) window.clearTimeout(errand.retry);
  errand = null;
}

// ── Turning the mode on and off ────────────────────────────────────

function activate(): void {
  settings = writeSettings({ doublePage: true });
  setSwitchChecked(true);
  step();
}

/**
 * Stops drawing, and undoes everything drawing changed.
 *
 * Leaves the lightbox as it was found: the carousel visible again, the display's
 * positioning restored, the container gone. Nothing here assumes it is in a good
 * state — the mode can be turned off from the options menu at any moment, and the
 * lightbox may already be closing.
 */
function deactivate(): void {
  if (container) {
    container.remove();
    container = null;
  }

  if (root) {
    root.classList.remove(CLASS_ACTIVE);
    const display = root.querySelector(SELECTOR_DISPLAY) as HTMLElement | null;
    if (display) display.style.position = "";
  }

  shownAt = -1;
}

function closeLightbox(): void {
  deactivate();
  root = null;
  galleryId = null;
  logged = false;
}

// ── The switch in the lightbox's own options menu ──────────────────

/**
 * Adds this plugin's switches to the lightbox's options popover, once per opening.
 *
 * The same markup Stash's own options use (a `form-group` holding `form-check`s),
 * so they read as part of the menu rather than as something bolted on. Injected
 * into whatever popover is on screen at the time, because the popover is rebuilt
 * from scratch each time it is opened — which is also why these cannot be React
 * components of ours: there is no patch point in there.
 *
 * The mode switch is always there. The offset one appears only while a gallery is
 * in hand, because the offset is a page pairing and there is no pairing without
 * one — and it is the escape hatch for a page that was taken for a spread and was
 * not one, so it belongs where the reader looks when the pairs look wrong.
 *
 * A reader who opens the menu before this plugin has read a gallery's language
 * gets the English wording; the next opening has the right one.
 */
function injectSwitch(lightbox: Element): void {
  const body = lightbox.querySelector(SELECTOR_POPOVER_BODY);
  if (!body) return;

  // The group is put there once and completed afterwards: the menu can be opened
  // before the gallery's pages have arrived — two clicks from opening the lightbox
  // is enough — and the offset switch has nothing to offer until they have.
  const existing = body.querySelector("." + CLASS_OPTIONS);
  if (existing) {
    addOffsetSwitch(existing);
    return;
  }

  const group = document.createElement("div");
  group.className = "form-group " + CLASS_OPTIONS;
  group.appendChild(
    checkbox({
      id: SWITCH_ID,
      label: labelFor(language, "doublePage"),
      checked: settings.doublePage,
      onChange: (checked) => {
        if (checked) {
          activate();
        } else {
          settings = writeSettings({ doublePage: false });
          deactivate();
        }
      },
    })
  );

  addOffsetSwitch(group);
  body.appendChild(group);
}

/** Adds the offset switch to the group, once there is a gallery to shift */
function addOffsetSwitch(group: Element): void {
  if (!current() || group.querySelector("#" + OFFSET_ID)) return;

  group.appendChild(
    checkbox({
      id: OFFSET_ID,
      label: labelFor(language, "offset"),
      checked: offset === 1,
      onChange: (checked) => {
        const gallery = current();
        if (gallery) setOffset(gallery, checked ? 1 : 0);
      },
    })
  );
}

/** One option row, in Stash's own markup: a form-check inside a row's column */
function checkbox(option: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): Element {
  const row = document.createElement("div");
  row.className = "row mb-1";

  const column = document.createElement("div");
  column.className = "col";

  const check = document.createElement("div");
  check.className = "form-check";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.id = option.id;
  input.checked = option.checked;

  const text = document.createElement("label");
  text.className = "form-check-label";
  text.htmlFor = option.id;
  text.textContent = option.label;

  input.addEventListener("change", () => option.onChange(input.checked));

  check.appendChild(input);
  check.appendChild(text);
  column.appendChild(check);
  row.appendChild(column);

  return row;
}

/**
 * Keeps a switch in step when the state changes by another route.
 *
 * Both switches can be changed without being clicked — the mode by its own key
 * handling, the offset by `O` — and a checkbox that disagrees with what the reader
 * sees on screen is worse than no checkbox.
 */
function setSwitchChecked(checked: boolean): void {
  setChecked(SWITCH_ID, checked);
}

function setOffsetSwitchChecked(checked: boolean): void {
  setChecked(OFFSET_ID, checked);
}

function setChecked(id: string, checked: boolean): void {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (input) input.checked = checked;
}

// ── Keys ───────────────────────────────────────────────────────────

/**
 * Handles the arrows while the spread view is up, and the offset key.
 *
 * Listens on `window` **in the capture phase**, which is what puts it in front of
 * the lightbox's own handler on `document`: the event path runs window, then
 * document, then the target. The event is then stopped there, and this plugin
 * moves the lightbox itself — by whole screens rather than by pages, which is the
 * whole point of the mode.
 *
 * Events this plugin dispatched are ignored, by `isTrusted`: they are how the
 * lightbox is moved (see pressArrow), they are what was asked for already, and
 * handling them again would double every step.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (!event.isTrusted || !wanted() || !root) return;

  const lightbox = root;
  const gallery = current();
  if (!gallery) return;

  if (event.key === "o" || event.key === "O") {
    if (event.repeat) return;

    setOffset(gallery, offset === 0 ? 1 : 0);

    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

  // Holding an arrow down repeats, and Stash's own handler ignores repeats for the
  // arrows: paging twice as fast while a key is held is not what it does, and this
  // plugin is not going to start.
  if (event.repeat) return;

  // A text field has the arrow keys while it has focus. The lightbox has none of
  // its own, but this listener is on the window and would take them from anything.
  const target = event.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  ) {
    return;
  }

  const at = currentIndex(lightbox);
  if (at === null) return;

  const steps = stepsToAdjacent(
    gallery.screens,
    at,
    event.key === "ArrowRight" ? 1 : -1
  );

  // Nothing that way: leave the event to Stash, which will do exactly as much,
  // which is nothing. Consuming it here would only be a lie about having moved.
  if (steps === 0) return;

  event.preventDefault();
  event.stopPropagation();
  startErrand(lightbox, at + steps);
}

/**
 * Shifts a gallery's pairing by one page, or puts it back, and remembers it.
 *
 * Two ways in — the key and the switch in the options menu — and both come through
 * here, so they cannot disagree about what the offset is.
 */
function setOffset(gallery: MangaReaderGallery, next: 0 | 1): void {
  offset = next;
  offsetFor = gallery.id;
  writeOffset(gallery.id, next);

  gallery.screens = layout(gallery.pages, { ...settings, offset });
  shownAt = -1;

  setOffsetSwitchChecked(next === 1);
  step();
}

// ── Wiring ─────────────────────────────────────────────────────────

/**
 * Starts watching. Called once, when the script loads.
 *
 * An observer on the whole document rather than a listener on the lightbox,
 * because the lightbox is created and destroyed by Stash and there is no moment to
 * attach to. `subtree` because everything interesting happens below the body, and
 * the handler is cheap enough to run on every batch — see `step`.
 */
export function install(): void {
  if (!document.body) {
    document.addEventListener("DOMContentLoaded", install);
    return;
  }

  const observer = new MutationObserver(() => {
    try {
      step();
    } catch (e) {
      // An observer callback that throws is an observer that never runs again,
      // which would take the reader off the page silently. Report, and put the
      // lightbox back the way it was: whatever is wrong, the reader can still read.
      console.error(
        "[mangaReader] the reader failed and has been turned off:",
        e
      );
      deactivate();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("keydown", onKeyDown, true);

  // The switch is a setting, not a mode: nothing is drawn until the reader turns it
  // on, but the observer has to be running for the switch to be there at all.
  step();
}
