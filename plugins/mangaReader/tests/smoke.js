/**
 * Manga Reader smoke test.
 *
 * What is under test is the *bundled* plugin, not the sources — the tests load
 * build/mangaReader.js, the one file Stash loads, so a broken build shows up here
 * rather than in a browser. `npm test` from the repository root builds first.
 *
 * Two halves, tested differently and honestly so:
 *
 *   - the pairing rules are pure functions, called directly (see spreads.ts);
 *   - the reader is DOM work against Stash's own markup, so the tests drive it
 *     through a fake DOM (tests/dom.js) and a fake lightbox built the way Stash's
 *     is. What that cannot cover is whether Stash's markup is still what this
 *     plugin thinks it is — no test of ours can know that, which is why the plugin
 *     turns itself off rather than draw wrongly when it stops matching.
 */
const assert = require("node:assert");
const path = require("node:path");
const { createDom } = require("./dom.js");

const BUNDLE = path.join(__dirname, "..", "build", "mangaReader.js");

// ── The environment the bundle loads into ──────────────────────────

const dom = createDom();

/** What the fake Stash answers with, per gallery, and what it was asked. */
const state = {
  language: null,
  galleries: {},
  queries: [],
  failing: false,
};

const client = {
  query: ({ query, variables, fetchPolicy }) => {
    state.queries.push({ query: String(query), variables, fetchPolicy });
    if (state.failing) return Promise.reject(new Error("no answer from Stash"));

    const gallery = state.galleries[variables.galleryId] || { images: [] };
    return Promise.resolve({
      data: {
        configuration: { interface: { language: state.language } },
        findImages: { images: gallery.images },
      },
    });
  },
};

global.window = dom.window;
global.document = dom.document;
global.MutationObserver = dom.MutationObserver;
global.Image = dom.window.Image;
// The plugin dispatches key events at the lightbox and ignores any that are not
// `isTrusted`, which is how it tells its own apart from a reader's. Trusting an
// event is exactly what this lets a test do.
global.KeyboardEvent = function KeyboardEvent(type, init) {
  return dom.makeEvent(type, init);
};

dom.window.PluginApi = {
  libraries: { Apollo: { gql: (text) => ({ __document: text }) } },
  utils: { StashService: { getClient: () => client } },
};

// The reader reports through the console, and some of what it says is visible
// nowhere else — a failure it recovers from by turning itself off, above all.
// Recorded *and* forwarded, the way mangaTools' suite does it.
const realConsoleError = console.error;
const loggedErrors = [];
console.error = (...args) => {
  loggedErrors.push(args.map((a) => String(a)).join(" "));
  realConsoleError.apply(console, args);
};

require(BUNDLE);

const NR = global.window.MangaReader;

// ── The runner ─────────────────────────────────────────────────────

const failures = [];

/**
 * Runs one section, reporting rather than rethrowing so the rest still run.
 *
 * Async, because half of this plugin is a promise: the pages are fetched, and
 * everything after that happens in a `then`.
 */
async function runSection(name, body) {
  try {
    await body();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`\n✗ ${name}`);
    console.error(err?.stack ? err.stack : String(err));
  }
}

/** Lets the bundle's promise chain run: one turn of the event loop is enough. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const errorsSince = (at) => loggedErrors.slice(at);

// ── Fixtures ───────────────────────────────────────────────────────

/** A page of the usual shape: taller than it is wide. */
const page = (id, width = 1000, height = 1500) => ({ id, width, height });

/** A page that spans two of them. */
const wide = (id) => page(id, 2000, 1500);

/** A page as Stash's GraphQL answers with it: a size inside `visual_files` */
const image = (id, width, height) => ({
  id,
  visual_files: [{ width, height }],
});

/** A screen list as ids, `+` between the pages that share one. */
const shape = (screens) =>
  screens.map((s) => s.pages.map((p) => p.id).join("+"));

/** Pages a, b, c, … */
const pagesOf = (...ids) => ids.map((id) => page(String(id)));

/**
 * A lightbox, built the way Stash's is: a display area holding a carousel, and a
 * header holding the counter that says where it is.
 */
function buildLightbox(current = 1, total = 5) {
  const lightbox = dom.makeElement("div");
  lightbox.className = "Lightbox";

  const display = dom.makeElement("div");
  display.className = "Lightbox-display";
  const carousel = dom.makeElement("div");
  carousel.className = "Lightbox-carousel";
  display.appendChild(carousel);

  const header = dom.makeElement("div");
  header.className = "Lightbox-header";
  const indicator = dom.makeElement("div");
  indicator.className = "Lightbox-header-indicator";
  const counter = dom.makeElement("b");
  counter.textContent = `${current} / ${total}`;
  indicator.appendChild(counter);
  header.appendChild(indicator);

  const footer = dom.makeElement("div");
  footer.className = "Lightbox-footer";

  lightbox.appendChild(display);
  lightbox.appendChild(header);
  lightbox.appendChild(footer);
  dom.body.appendChild(lightbox);

  return {
    lightbox,
    display,
    carousel,
    counter,
    /** What a reader sees as the lightbox moves — Stash rewrites this text */
    move: (at) => {
      counter.textContent = `${at} / ${total}`;
    },
    openPopover: () => {
      // Stash unmounts the popover when it closes and builds a new one next time,
      // which is why the label is worked out at injection time.
      const previous = lightbox.querySelector(".popover");
      if (previous) previous.remove();
      const popover = dom.makeElement("div");
      popover.className = "popover";
      const body = dom.makeElement("div");
      body.className = "popover-body";
      popover.appendChild(body);
      lightbox.appendChild(popover);
      return body;
    },
    close: () => lightbox.remove(),
  };
}

/** The container this plugin draws in, if it is drawing */
const container = () => dom.body.querySelector(".manga-reader-spread");

/** What is drawn, as image paths */
const drawn = () =>
  (container()?.children || []).map((box) => box.children[0].src);

/** A key press a reader made, rather than one the plugin dispatched */
const press = (key) => {
  const event = dom.makeEvent("keydown", { key, isTrusted: true });
  dom.window.dispatchEvent(event);
  return event;
};

// ── What Stash answers with ────────────────────────────────────────
//
// Every fixture is in place before the first section runs. The plugin keeps the
// page list it is given, so a gallery asked for before its fixture existed would
// be remembered as an empty one for the rest of the run.

/** Five pages with a spread in the middle: 101 | 102 | 103(wide) | 104+105 */
const GALLERY_WITH_A_SPREAD = {
  images: [
    image("101", 1000, 1500),
    image("102", 1000, 1500),
    image("103", 2000, 1500),
    image("104", 1000, 1500),
    image("105", 1000, 1500),
  ],
};

/** Five ordinary pages: 401 | 402+403 | 404+405 */
const PLAIN_GALLERY = {
  images: [
    image("401", 1000, 1500),
    image("402", 1000, 1500),
    image("403", 1000, 1500),
    image("404", 1000, 1500),
    image("405", 1000, 1500),
  ],
};

/** Two ordinary pages, for the header that cannot be read */
const TWO_PAGES = {
  images: [image("201", 1000, 1500), image("202", 1000, 1500)],
};

/** One page, which has no counter at all — Stash draws it only for more than one */
const ONE_PAGE = { images: [image("301", 1000, 1500)] };

dom.window.location.pathname = "/";
state.galleries["7"] = GALLERY_WITH_A_SPREAD;
state.galleries["8"] = PLAIN_GALLERY;
state.galleries["11"] = TWO_PAGES;
state.galleries["12"] = ONE_PAGE;

// ── Sections ───────────────────────────────────────────────────────

async function main() {
  await runSection("the plugin loads and watches for a lightbox", () => {
    assert.ok(NR, "the bundle should publish window.MangaReader");
    assert.strictEqual(typeof NR.layout, "function");
    assert.strictEqual(
      dom.observerCount(),
      1,
      "one observer on the document, which is how the lightbox is found"
    );
    assert.strictEqual(
      (dom.window.listeners.keydown || []).length,
      1,
      "and one key listener, on the window, so it runs before Stash's own"
    );
  });

  await runSection("settings are parsed defensively", () => {
    assert.deepStrictEqual(
      NR.parseSettings(null),
      { doublePage: false, coverAlone: true, detectSpreads: true },
      "a browser that has never been asked gets the defaults — the mode off"
    );
    assert.deepStrictEqual(
      NR.parseSettings('{"doublePage":true}'),
      { doublePage: true, coverAlone: true, detectSpreads: true },
      "a stored object may be missing a field: the rest are defaults"
    );
    assert.deepStrictEqual(
      NR.parseSettings('{"doublePage":"yes"}'),
      { doublePage: false, coverAlone: true, detectSpreads: true },
      "and a value of the wrong type is not a setting"
    );
    assert.deepStrictEqual(
      NR.parseSettings("not json"),
      { doublePage: false, coverAlone: true, detectSpreads: true },
      "nor is something else's value under our key"
    );
  });

  await runSection("the lightbox header is read as a position", () => {
    assert.deepStrictEqual(NR.parseIndicator("3 / 12"), {
      current: 3,
      total: 12,
    });
    assert.deepStrictEqual(
      NR.parseIndicator(" 1 / 2 "),
      { current: 1, total: 2 },
      "whitespace is not part of the number"
    );
    assert.strictEqual(NR.parseIndicator(""), null, "no counter at all");
    assert.strictEqual(NR.parseIndicator("Chapter 3"), null);
    assert.strictEqual(
      NR.parseIndicator("0 / 12"),
      null,
      "a page number out of range is not a position to draw from"
    );
    assert.strictEqual(NR.parseIndicator("13 / 12"), null);
  });

  await runSection("the gallery is read out of the path", () => {
    assert.strictEqual(NR.galleryIdFromPath("/galleries/7"), "7");
    assert.strictEqual(NR.galleryIdFromPath("/galleries/7/images"), "7");
    assert.strictEqual(
      NR.galleryIdFromPath("/galleries"),
      null,
      "the gallery list is not one gallery"
    );
    assert.strictEqual(NR.galleryIdFromPath("/scenes/7"), null);
    assert.strictEqual(
      NR.galleryIdFromPath("/images/7"),
      null,
      "an image's own page has no gallery to pair"
    );
  });

  await runSection("what counts as a spread", () => {
    assert.strictEqual(NR.isWideSpreadPage(page("tall")), false);
    assert.strictEqual(NR.isWideSpreadPage(wide("w")), true);
    assert.strictEqual(
      NR.isWideSpreadPage(page("square", 1000, 1000)),
      false,
      "the ratio is strictly greater than one"
    );
    assert.strictEqual(
      NR.isWideSpreadPage(page("unknown", 0, 0)),
      false,
      "a page with no size reported is not evidence of a spread"
    );
  });

  await runSection("the cover, and the pairs that follow it", () => {
    assert.deepStrictEqual(NR.layout([]), []);

    assert.deepStrictEqual(shape(NR.layout(pagesOf("a"))), ["a"]);

    assert.deepStrictEqual(
      shape(NR.layout(pagesOf("a", "b", "c", "d", "e"))),
      ["a", "b+c", "d+e"],
      "the cover stands alone and the rest pair up"
    );

    assert.deepStrictEqual(
      shape(NR.layout(pagesOf("a", "b", "c", "d", "e"), { coverAlone: false })),
      ["a+b", "c+d", "e"],
      "without a cover to respect, the odd page is the last one"
    );

    assert.deepStrictEqual(
      shape(
        NR.layout(pagesOf("a", "b", "c", "d", "e"), {
          coverAlone: true,
          offset: 1,
        })
      ),
      ["a", "b", "c+d", "e"],
      "the offset strands one more page, which puts a wrongly-grouped gallery's " +
        "pairs back"
    );

    // The layout must not touch what it was given: the page list is a fetched
    // answer that is kept for the rest of the session.
    const pages = pagesOf("a", "b");
    const before = JSON.stringify(pages);
    NR.layout(pages);
    assert.strictEqual(JSON.stringify(pages), before, "and it is not mutated");
  });

  await runSection("a page that spans two of them", () => {
    assert.deepStrictEqual(
      shape(
        NR.layout([page("a"), page("b"), wide("w"), page("c"), page("d")], {
          coverAlone: false,
        })
      ),
      ["a+b", "w", "c+d"],
      "a spread takes a screen of its own, and the pairing carries on after it"
    );

    assert.deepStrictEqual(
      shape(
        NR.layout([page("a"), wide("w"), page("b"), page("c")], {
          coverAlone: false,
        })
      ),
      ["a", "w", "b+c"],
      "a page whose neighbour is a spread stands alone — the case that leaves a " +
        "single page in the middle of a book. If the pairing after it is then " +
        "wrong for a book, the offset is what puts it right"
    );

    assert.deepStrictEqual(
      shape(
        NR.layout([page("a"), page("b"), wide("w"), page("c")], {
          coverAlone: false,
          detectSpreads: false,
        })
      ),
      ["a+b", "w+c"],
      "with the detection off a wide page is just a page"
    );

    assert.deepStrictEqual(
      shape(NR.layout([wide("x"), wide("y")], { coverAlone: false })),
      ["x", "y"],
      "two spreads in a row are two screens"
    );
  });

  await runSection("where a screen starts, and how far to move", () => {
    const screens = NR.layout(pagesOf("a", "b", "c", "d", "e"));

    screens.forEach((screen, at) => {
      screen.pages.forEach((_page, offset) => {
        assert.strictEqual(NR.screenAt(screens, screen.start + offset), at);
      });
    });
    assert.deepStrictEqual(
      screens.flatMap((s) => s.pages.map((p) => p.id)),
      ["a", "b", "c", "d", "e"],
      "every page is on exactly one screen, in order"
    );
    assert.strictEqual(NR.screenAt(screens, 99), -1);
    assert.strictEqual(NR.screenAt([], 0), -1);

    assert.strictEqual(NR.stepsToAdjacent(screens, 0, 1), 1);
    assert.strictEqual(
      NR.stepsToAdjacent(screens, 1, 1),
      2,
      "forward from the first page of a pair skips both its pages"
    );
    assert.strictEqual(
      NR.stepsToAdjacent(screens, 2, 1),
      1,
      "and from the second page of one only moves on by that one"
    );
    assert.strictEqual(NR.stepsToAdjacent(screens, 0, -1), 0);
    assert.strictEqual(NR.stepsToAdjacent(screens, 4, 1), 0);
    assert.strictEqual(
      NR.stepsToAdjacent(screens, 4, -1),
      -3,
      "backwards lands on the first page of the screen behind, which from the " +
        "last pair is three pages away"
    );
  });

  // ── The reader itself ────────────────────────────────────────────
  //
  // Every section below puts the page back to a known state before it does
  // anything, and that is not tidiness: one failing assertion would otherwise leave
  // a lightbox behind with the mode still on, and every section after it would be
  // testing that instead of what it says. A test that fails should fail alone.

  /**
   * A lightbox on a gallery page, with this plugin's switch set where the section
   * needs it, and the pages fetched.
   *
   * The mode is set by *using the switch*, which is the only way to change it from
   * outside the bundle — the plugin's copy of the settings is module state, and
   * writing localStorage behind its back would be testing a state it never reads.
   */
  async function startReader(options) {
    const {
      galleryId = "7",
      at = 1,
      total = 5,
      on = true,
      language = null,
      counterText,
    } = options || {};

    for (const child of dom.body.children.slice()) child.remove();
    dom.window.location.pathname = galleryId ? `/galleries/${galleryId}` : "/";
    state.language = language;
    dom.flush();

    const box = buildLightbox(at, total);
    // Some lightboxes have no counter at all — Stash draws it only for more than one
    // image — and that has to be true before the mode is turned on, not after.
    if (counterText !== undefined) box.counter.textContent = counterText;
    const popover = box.openPopover();
    dom.flush();

    const input = popover.querySelector("#manga-reader-double-page");
    assert.ok(input, "the switch should be in the lightbox's own options menu");
    input.checked = on;
    input.dispatch("change");
    await settle();

    return { box, input, popover };
  }

  /**
   * A gallery of five ordinary pages: screens are [1] [2+3] [4+5], so a pair is
   * something the arrows and the offset can be seen against. Gallery 8 in these
   * fixtures has a spread in it, which changes what the pairing does.
   */
  /** Closes the lightbox and lets the reader notice */
  function stopReader(box) {
    box.close();
    dom.flush();
  }

  await runSection("nothing is drawn until the mode is turned on", async () => {
    const { box } = await startReader({ on: false });

    assert.strictEqual(container(), null, "no container while the mode is off");
    assert.strictEqual(
      box.lightbox.classList.contains("manga-reader-active"),
      false,
      "and the lightbox untouched"
    );

    stopReader(box);
  });

  await runSection(
    "the switch is added to the lightbox's own options",
    async () => {
      const { box, input, popover } = await startReader({ on: false });

      assert.strictEqual(input.type, "checkbox");
      assert.strictEqual(
        input.checked,
        false,
        "off, because the mode is off — the switch shows the state, it does not set it"
      );

      const label = popover.querySelector("label");
      assert.strictEqual(label.htmlFor, "manga-reader-double-page");
      assert.strictEqual(
        label.textContent,
        "Double page",
        "in English, because no gallery has been read yet and Stash's interface " +
          "language is only known from its answer"
      );
      assert.ok(
        popover.querySelector(".form-check"),
        "and in Stash's own markup, so it reads as one of its options"
      );

      stopReader(box);
    }
  );

  await runSection(
    "the switch speaks the interface language once it is known",
    async () => {
      // The language comes from Stash's answer to the gallery query, so the wording
      // is right from the *second* time the menu is opened — which is all it can be,
      // and worth saying out loud.
      const { box } = await startReader({ on: true, language: "zh-TW" });

      const reopened = box.openPopover();
      dom.flush();
      assert.strictEqual(
        reopened.querySelector("label").textContent,
        "雙頁閱讀",
        "a traditional-Chinese interface reads the traditional wording"
      );

      stopReader(box);
    }
  );

  await runSection(
    "turning it on draws the pages the lightbox is showing",
    async () => {
      const { box } = await startReader({ on: true });

      assert.deepStrictEqual(
        state.queries.map((q) => q.variables.galleryId),
        ["7"],
        "the pages are asked for once, for the gallery in the path"
      );
      assert.strictEqual(
        state.queries[0].fetchPolicy,
        "no-cache",
        "and not written into Apollo's cache, where the lightbox's own query lives"
      );

      const drawnBox = container();
      assert.ok(drawnBox, "and a container to draw them in");
      assert.strictEqual(
        drawnBox.parentNode,
        box.display,
        "inside the display area"
      );
      assert.strictEqual(
        box.display.children.indexOf(drawnBox),
        1,
        "beside Stash's carousel rather than in place of it — which is what keeps " +
          "React free to re-render its own subtree without ours going with it"
      );
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        true,
        "with the class that hides the carousel"
      );
      assert.deepStrictEqual(
        drawn(),
        ["/image/101/image"],
        "the cover alone, because that is the screen page 1 is on"
      );
      assert.ok(
        dom.preloaded.includes("/image/102/image"),
        "and the pages of the next screen are warmed, so a turn does not wait"
      );

      // Stash moves and the reader follows — through the one code path every other
      // way of moving takes, which is the point of reading its header rather than
      // keeping a second idea of the current page.
      box.move(2);
      dom.flush();
      assert.deepStrictEqual(
        drawn(),
        ["/image/102/image"],
        "page 2 stands alone: its neighbour is the spread, and one page is not the " +
          "left half of a screen"
      );

      box.move(3);
      dom.flush();
      assert.deepStrictEqual(
        drawn(),
        ["/image/103/image"],
        "the spread takes a screen of its own"
      );

      box.move(4);
      dom.flush();
      assert.deepStrictEqual(
        drawn(),
        ["/image/104/image", "/image/105/image"],
        "and the pairing carries on after it — in reading order, which the " +
          "stylesheet reverses for a right-to-left book"
      );

      stopReader(box);
    }
  );

  await runSection("the arrows move by screen, not by page", async () => {
    const { box } = await startReader({ galleryId: "8", on: true });

    // What the plugin sends the lightbox, as opposed to what it consumes: the
    // events it dispatches are not `isTrusted`, which is how its own key handler
    // tells them from a reader's and lets them through.
    const sent = [];
    dom.document.addEventListener("keydown", (event) => sent.push(event.key));

    box.move(1);
    dom.flush();
    const forwards = press("ArrowRight");
    assert.deepStrictEqual(
      sent,
      ["ArrowRight"],
      "forward from the cover is one page"
    );
    assert.strictEqual(
      forwards.defaultPrevented,
      true,
      "and the press is consumed: this plugin decides where the lightbox goes"
    );
    assert.strictEqual(forwards.propagationStopped, true);

    box.move(2);
    dom.flush();
    sent.length = 0;
    press("ArrowRight");
    assert.deepStrictEqual(
      sent,
      ["ArrowRight", "ArrowRight"],
      "from the first page of a pair, two presses land on the next screen"
    );

    box.move(3);
    dom.flush();
    sent.length = 0;
    press("ArrowRight");
    assert.deepStrictEqual(
      sent,
      ["ArrowRight"],
      "and from the second page of one, the next screen is a single page on"
    );

    box.move(2);
    dom.flush();
    sent.length = 0;
    press("ArrowLeft");
    assert.deepStrictEqual(
      sent,
      ["ArrowLeft"],
      "backwards is one page, to the cover"
    );

    // The end of the book is left to Stash, which does nothing with it either:
    // consuming the press would only be a lie about having moved.
    box.move(5);
    dom.flush();
    sent.length = 0;
    const pastTheEnd = press("ArrowRight");
    assert.deepStrictEqual(sent, [], "nothing to move on to");
    assert.strictEqual(pastTheEnd.defaultPrevented, false);

    // A key press this plugin did not make passes straight through to the
    // lightbox — if its own handler took these, every step would double.
    sent.length = 0;
    dom.document.dispatchEvent(
      dom.makeEvent("keydown", { key: "ArrowRight", isTrusted: false })
    );
    assert.deepStrictEqual(sent, ["ArrowRight"]);

    // Keys that are not a page turn are none of this plugin's business.
    sent.length = 0;
    const other = press("Escape");
    assert.deepStrictEqual(sent, [], "Escape is left alone");
    assert.strictEqual(other.defaultPrevented, false);

    stopReader(box);
  });

  await runSection("the offset key re-pairs the gallery", async () => {
    const { box } = await startReader({ galleryId: "8", on: true });

    // At page 2, which is where the two layouts differ: without the offset its
    // screen is 2+3, and with it page 2 stands alone.
    box.move(2);
    dom.flush();
    const before = drawn();
    assert.deepStrictEqual(before, ["/image/402/image", "/image/403/image"]);

    press("o");
    assert.deepStrictEqual(
      drawn(),
      ["/image/402/image"],
      "O shifts the pairing by one page and redraws — the escape hatch for a page " +
        "that was taken for a spread and was not one"
    );

    press("o");
    assert.deepStrictEqual(drawn(), before, "and shifts it back");

    stopReader(box);
  });

  await runSection(
    "turning the switch off puts the lightbox back",
    async () => {
      const { box, input } = await startReader({ on: true });
      assert.ok(container(), "drawing first");

      input.checked = false;
      input.dispatch("change");

      assert.strictEqual(container(), null, "the container is gone");
      assert.strictEqual(
        box.lightbox.classList.contains("manga-reader-active"),
        false,
        "the carousel is visible again"
      );
      assert.strictEqual(
        box.display.style.position,
        "",
        "and the display is as Stash had it"
      );

      stopReader(box);
      assert.strictEqual(
        container(),
        null,
        "and closing the lightbox leaves nothing behind"
      );
    }
  );

  await runSection("the mode is not used off a gallery page", async () => {
    // The lightbox shows every kind of image in Stash; the mode is for reading a
    // gallery, so anywhere else it draws nothing — even switched on, as here.
    const asked = state.queries.length;
    const { box } = await startReader({ galleryId: null, on: true });

    assert.strictEqual(container(), null, "nothing is drawn");
    assert.strictEqual(
      state.queries.length,
      asked,
      "and no gallery's pages are asked for"
    );

    stopReader(box);
  });

  await runSection("the mode is remembered for the next session", async () => {
    const { box } = await startReader({ on: true });
    assert.ok(container(), "on, and drawing");

    assert.deepStrictEqual(
      JSON.parse(dom.window.localStorage.getItem("mangaReader.settings")),
      { doublePage: true, coverAlone: true, detectSpreads: true },
      "the switch writes the setting it changed and leaves the rest alone"
    );

    stopReader(box);
  });

  await runSection(
    "a gallery Stash cannot answer for is not drawn",
    async () => {
      state.failing = true;
      const at = loggedErrors.length;

      const { box } = await startReader({ galleryId: "9", on: true });

      assert.strictEqual(container(), null, "nothing is drawn");
      assert.ok(
        errorsSince(at).some((line) =>
          /could not read this gallery's pages/.test(line)
        ),
        "and the failure is reported rather than passed over"
      );

      state.failing = false;
      stopReader(box);
    }
  );

  await runSection(
    "a lightbox whose header cannot be read is not drawn over",
    async () => {
      // Several pages and a header with no counter: Stash's markup has moved on.
      // The plugin cannot know where it is, so it must not draw at all.
      const at = loggedErrors.length;
      const { box } = await startReader({ galleryId: "11", on: true });
      box.counter.textContent = "1";
      dom.flush();

      assert.strictEqual(container(), null, "nothing is drawn");
      assert.ok(
        errorsSince(at).some((line) => /header could not be read/.test(line)),
        "and it says which assumption failed"
      );

      stopReader(box);
    }
  );

  await runSection("a one-page gallery is quiet", async () => {
    // The counter is drawn only when there is more than one image, so this looks
    // exactly like markup that has changed — unless the page count says otherwise,
    // which is why the plugin reads its own page list before deciding.
    const at = loggedErrors.length;
    const { box } = await startReader({
      galleryId: "12",
      counterText: "",
      on: true,
    });

    assert.strictEqual(container(), null, "nothing is drawn");
    assert.deepStrictEqual(
      errorsSince(at),
      [],
      "and nothing is reported: one page is not a fault"
    );

    stopReader(box);
  });

  // ── The tally ────────────────────────────────────────────────────

  if (failures.length === 0) {
    console.log("\nAll mangaReader smoke tests passed");
  } else {
    console.error(
      `\n${failures.length} section(s) failed: ${failures.join(", ")}`
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("the smoke test itself failed:", e);
  process.exitCode = 1;
});
