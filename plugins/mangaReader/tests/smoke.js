/**
 * Manga Reader smoke test: the pairing rules.
 *
 * What is under test is the *bundled* plugin, not the sources — the tests load
 * build/mangaReader.js, the one file Stash loads, so a broken build shows up here
 * rather than in a browser. `npm test` from the repository root builds first.
 *
 * The DOM half of this plugin (the lightbox takeover) is not tested here yet; see
 * the README for why the pairing rules are the half worth having tests for.
 */
const assert = require("node:assert");
const path = require("node:path");

const BUNDLE = path.join(__dirname, "..", "build", "mangaReader.js");

// The bundle publishes itself on the window, the way it does in a browser — the
// same arrangement mangaTools uses, and the only way a bundle with no exports can
// be reached from here.
global.window = {};
require(BUNDLE);

const NR = global.window.MangaReader;

const failures = [];

/** Runs one section, reporting rather than rethrowing so the rest still run */
function runSection(name, body) {
  try {
    body();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.error(`\n✗ ${name}`);
    console.error(err?.stack ? err.stack : String(err));
  }
}

// ── Fixtures ───────────────────────────────────────────────────────

/** A page of the usual shape: taller than it is wide. */
const page = (id, width = 1000, height = 1500) => ({ id, width, height });

/** A page that spans two of them. */
const wide = (id) => page(id, 2000, 1500);

/** A screen list as ids, `+` between the pages that share one. */
const shape = (screens) =>
  screens.map((s) => s.pages.map((p) => p.id).join("+"));

/** Pages a, b, c, … */
const pagesOf = (...ids) => ids.map((id) => page(String(id)));

// ── Sections ───────────────────────────────────────────────────────

runSection("the plugin loads and publishes its rules", () => {
  assert.ok(NR, "the bundle should publish window.MangaReader");
  assert.strictEqual(typeof NR.layout, "function");
  assert.strictEqual(typeof NR.screenAt, "function");
  assert.strictEqual(typeof NR.stepsToAdjacent, "function");
  assert.strictEqual(typeof NR.isWideSpreadPage, "function");
});

runSection("what counts as a spread", () => {
  assert.strictEqual(
    NR.isWideSpreadPage(page("tall")),
    false,
    "an ordinary page is not a spread"
  );
  assert.strictEqual(NR.isWideSpreadPage(wide("w")), true);
  assert.strictEqual(
    NR.isWideSpreadPage(page("square", 1000, 1000)),
    false,
    "a square page is a page: the ratio is strictly greater than one"
  );
  assert.strictEqual(
    NR.isWideSpreadPage(page("unknown", 0, 0)),
    false,
    "a page Stash reported no size for pairs like any other — no size is not " +
      "evidence of a spread, and treating it as one would strand it alone"
  );
});

runSection("the cover, and the pairs that follow it", () => {
  assert.deepStrictEqual(NR.layout([]), [], "nothing to lay out");

  assert.deepStrictEqual(
    shape(NR.layout(pagesOf("a"))),
    ["a"],
    "a single page is a single screen"
  );

  assert.deepStrictEqual(
    shape(NR.layout(pagesOf("a", "b", "c", "d", "e"))),
    ["a", "b+c", "d+e"],
    "the cover stands alone and the rest pair up, by default"
  );

  assert.deepStrictEqual(
    shape(NR.layout(pagesOf("a", "b", "c", "d", "e"), { coverAlone: false })),
    ["a+b", "c+d", "e"],
    "without a cover to respect the pairs start at the first page, and an odd " +
      "number of pages leaves the last one alone"
  );

  assert.deepStrictEqual(
    shape(
      NR.layout(pagesOf("a", "b", "c", "d", "e"), {
        coverAlone: true,
        offset: 1,
      })
    ),
    ["a", "b", "c+d", "e"],
    "the offset strands one more page, which is what puts a wrongly-judged " +
      "spread's pairs back where they belong"
  );

  assert.deepStrictEqual(
    shape(NR.layout(pagesOf("a", "b"), { coverAlone: false })),
    ["a+b"],
    "two pages are one screen"
  );
});

runSection("a page that spans two of them", () => {
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
    "a page whose neighbour is a spread stands alone — this is the case that " +
      "leaves a single page in the middle of a book"
  );

  assert.deepStrictEqual(
    shape(NR.layout([page("a"), wide("w"), page("b")], { coverAlone: false })),
    ["a", "w", "b"],
    "and the same at the end, where there is no pair left to make"
  );

  assert.deepStrictEqual(
    shape(
      NR.layout([page("a"), page("b"), wide("w"), page("c")], {
        coverAlone: false,
        detectSpreads: false,
      })
    ),
    ["a+b", "w+c"],
    "with the detection off a wide page is just a page — which is the setting " +
      "for a gallery whose scans do not need it"
  );

  assert.deepStrictEqual(
    shape(NR.layout([wide("x"), wide("y")], { coverAlone: false })),
    ["x", "y"],
    "two spreads in a row are two screens"
  );
});

runSection("reading order is what a screen holds", () => {
  const screens = NR.layout(pagesOf("a", "b", "c", "d"));
  assert.deepStrictEqual(
    screens.map((s) => s.start),
    [0, 1, 3],
    "a screen knows which page it starts at, which is how the reader tells " +
      "Stash where to go"
  );
  assert.deepStrictEqual(
    screens[1].pages.map((p) => p.id),
    ["b", "c"],
    "and holds its pages in the order they are read — the earlier one first, " +
      "whatever side of the screen it is drawn on"
  );

  // The layout must not touch what it was given: the page list comes from a
  // fetched answer that is kept for the rest of the session.
  const pages = pagesOf("a", "b");
  const before = JSON.stringify(pages);
  NR.layout(pages);
  assert.strictEqual(
    JSON.stringify(pages),
    before,
    "the page list is not mutated"
  );
});

runSection("finding the screen a page is on", () => {
  const screens = NR.layout(pagesOf("a", "b", "c", "d", "e"));

  screens.forEach((screen, at) => {
    screen.pages.forEach((_page, offset) => {
      assert.strictEqual(
        NR.screenAt(screens, screen.start + offset),
        at,
        "every page belongs to exactly the screen that holds it"
      );
    });
  });

  // The pages a layout covers are a partition of the list: nothing dropped,
  // nothing counted twice. Worth asserting rather than eyeballing, because the
  // rules are a greedy walk and a mistake would be an off-by-one in the middle.
  const covered = screens.flatMap((s) => s.pages.map((p) => p.id));
  assert.deepStrictEqual(
    covered,
    ["a", "b", "c", "d", "e"],
    "every page is on exactly one screen, in order"
  );

  assert.strictEqual(NR.screenAt(screens, 99), -1, "an index past the end");
  assert.strictEqual(NR.screenAt([], 0), -1, "and an empty layout");
});

runSection("how far Stash's page number has to move", () => {
  // a | b+c | d+e — so forward from the cover is 1, from the first of a pair 2,
  // from the second of a pair 1.
  const screens = NR.layout(pagesOf("a", "b", "c", "d", "e"));

  assert.strictEqual(
    NR.stepsToAdjacent(screens, 0, 1),
    1,
    "forward from the cover to the first pair"
  );
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
  assert.strictEqual(
    NR.stepsToAdjacent(screens, 0, -1),
    0,
    "there is nothing before the cover"
  );
  assert.strictEqual(
    NR.stepsToAdjacent(screens, 4, 1),
    0,
    "and nothing after the last screen"
  );

  // Backwards lands on the *first* page of the screen behind, which is what keeps
  // one rule for both directions: the page the reader is on is always the first
  // one of the screen in view. From the last page of the last pair back to page 1
  // is therefore three, not one — the presses between land on pages that are in
  // the screen being left, so nothing flickers.
  assert.strictEqual(
    NR.stepsToAdjacent(screens, 4, -1),
    -3,
    "back from the second page of the last pair to the pair before it"
  );
  assert.strictEqual(
    NR.stepsToAdjacent(screens, 1, -1),
    -1,
    "back to the cover"
  );

  // Applying the step lands on the screen that way — the property the reader
  // depends on, checked over every page of the layout.
  screens.forEach((_screen, at) => {
    for (const direction of [1, -1]) {
      const from = screens[at].start;
      const steps = NR.stepsToAdjacent(screens, from, direction);
      if (steps === 0) continue;
      assert.strictEqual(
        NR.screenAt(screens, from + steps),
        at + direction,
        `stepping ${steps} from page ${from} lands on the adjacent screen`
      );
    }
  });
});

// ── The tally ──────────────────────────────────────────────────────

if (failures.length === 0) {
  console.log("\nAll mangaReader smoke tests passed");
} else {
  console.error(
    `\n${failures.length} section(s) failed: ${failures.join(", ")}`
  );
  process.exitCode = 1;
}
