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
import { readSettings, writeSettings } from "./settings";
import type { MangaReaderScreen } from "./spreads";
import { layout, screenAt, stepsToAdjacent } from "./spreads";
import {
  SELECTOR_DISPLAY,
  SELECTOR_LIGHTBOX,
  SELECTOR_POPOVER_BODY,
  fetchGallery,
  galleryIdFromPath,
  movePages,
  readPosition,
} from "./stash-lightbox";

/** Class on Stash's lightbox while this plugin is drawing inside it */
const CLASS_ACTIVE = "manga-reader-active";
/** This plugin's own container, and the pages in it */
const CLASS_SPREAD = "manga-reader-spread";
const CLASS_PAGE = "manga-reader-page";
const CLASS_SINGLE = "is-single";
/** The switch this plugin adds to the lightbox's options menu */
const SWITCH_ID = "manga-reader-double-page";

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
 * Per gallery and for this session only, because what it corrects is a property of
 * one scan rather than a preference: a gallery whose pages were grouped wrongly
 * needs its pairs shifted, and the gallery next to it does not. Persisting it would
 * mean deciding where — and the honest place, a per-gallery custom field, is a
 * coupling this plugin does not have with anything else yet.
 */
let offset: 0 | 1 = 0;
let offsetFor: string | null = null;

let reinsers = 0;
let language: string | null = null;
let logged = false;

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
  // The offset belongs to one gallery: a different one starts from the top.
  if (offsetFor !== id) {
    offsetFor = id;
    offset = 0;
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
    // the key that shifts it. It is the first thing to look at when the pairs look
    // wrong, and the only place the offset key is ever mentioned on screen.
    console.info(
      "[mangaReader] " +
        gallery.screens.length +
        " screen(s) from " +
        gallery.pages.length +
        " page(s), offset " +
        offset +
        " — press O in the lightbox to shift the pairing by one page"
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
 * Adds this plugin's switch to the lightbox's options popover, once per opening.
 *
 * The same markup Stash's own options use (a `form-group` holding a `form-check`),
 * so it reads as one of them rather than as something bolted on. Injected into
 * whatever popover is on screen at the time, because the popover is rebuilt from
 * scratch each time it is opened — which is also why this cannot be a React
 * component of ours: there is no patch point in there.
 *
 * A reader who opens the menu before this plugin has read a gallery's language
 * gets the English wording; the next opening has the right one.
 */
function injectSwitch(lightbox: Element): void {
  const body = lightbox.querySelector(SELECTOR_POPOVER_BODY);
  if (!body) return;
  if (body.querySelector("#" + SWITCH_ID)) return;

  const group = document.createElement("div");
  group.className = "form-group manga-reader-options";

  const row = document.createElement("div");
  row.className = "row mb-1";

  const column = document.createElement("div");
  column.className = "col";

  const check = document.createElement("div");
  check.className = "form-check";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.id = SWITCH_ID;
  input.checked = settings.doublePage;

  const text = document.createElement("label");
  text.className = "form-check-label";
  text.htmlFor = SWITCH_ID;
  text.textContent = labelFor(language, "doublePage");

  input.addEventListener("change", () => {
    if (input.checked) {
      activate();
    } else {
      settings = writeSettings({ doublePage: false });
      deactivate();
    }
  });

  check.appendChild(input);
  check.appendChild(text);
  column.appendChild(check);
  row.appendChild(column);
  group.appendChild(row);
  body.appendChild(group);
}

/** Keeps the switch in step when the mode is changed by something other than it */
function setSwitchChecked(checked: boolean): void {
  const input = document.getElementById(SWITCH_ID) as HTMLInputElement | null;
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
 * lightbox is moved (see movePages), they are what was asked for already, and
 * handling them again would double every step.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (!event.isTrusted || !wanted() || !root) return;

  const gallery = current();
  if (!gallery) return;

  if (event.key === "o" || event.key === "O") {
    if (event.repeat) return;

    offset = offset === 0 ? 1 : 0;
    offsetFor = gallery.id;
    gallery.screens = layout(gallery.pages, { ...settings, offset });
    shownAt = -1;

    event.preventDefault();
    event.stopPropagation();
    step();
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

  const position = readPosition(root);
  if (!position) return;

  const steps = stepsToAdjacent(
    gallery.screens,
    position.current - 1,
    event.key === "ArrowRight" ? 1 : -1
  );

  // Nothing that way: leave the event to Stash, which will do exactly as much,
  // which is nothing. Consuming it here would only be a lie about having moved.
  if (steps === 0) return;

  event.preventDefault();
  event.stopPropagation();
  movePages(steps);
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
