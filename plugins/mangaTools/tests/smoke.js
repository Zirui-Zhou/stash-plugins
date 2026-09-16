/* Manga Tools smoke test: no browser needed, everything runs against stubs */
//
// One file per area, under sections/. This file is only the runner: what runs,
// in what order, and what failed. Everything they share — the stubs, the
// fixtures, the loaded bundle, and the state the tests move — is in helpers.js.
//
// The order matters in one place. The tests run against the *bundled* plugin,
// which starts fetching the gallery map as it loads, so the sections that read
// what it fetched run in a timer afterwards. Run `npm test` from the repository
// root, which builds first: the bundle is what is tested, so a broken build
// shows up here.
const { reportSummary, runSection } = require("./helpers.js");

/** Sections that do not care whether the plugin's first refresh has settled */
const SECTIONS = [
  ["1–5b the language catalogue", "./sections/01-languages.js"],
  ["6–7d registration, query, settings, strings", "./sections/02-settings.js"],
  ["8–9b the details block and the edit block", "./sections/03-detail-edit.js"],
  ["10–10b the stylesheet and the bundle", "./sections/04-artifacts.js"],
  [
    "10c–10c2 what the filter reads and writes",
    "./sections/05-filter-model.js",
  ],
  ["10d–10d2 the three sidebar sections", "./sections/06-sidebar.js"],
  ["10e–10f the dialog's card, criterion and tags", "./sections/07-dialog.js"],
];

/** Sections that read what the plugin fetched on load */
const AFTER_REFRESH = [
  ["11–13d badges, cards, the detail page, the panel", "./sections/08-card.js"],
  ["14 the bulk edit dialog", "./sections/09-bulk.js"],
];

for (const [name, file] of SECTIONS) runSection(name, require(file));

// The plugin's fetch is a promise, so its map is filled on a microtask: a timer
// is what puts these after it.
setTimeout(() => {
  for (const [name, file] of AFTER_REFRESH) runSection(name, require(file));
  // One more turn, for the refetch the bulk section defers past the fetch it
  // happened to coalesce onto — its own check is a zero-delay timer scheduled
  // above, and this one is scheduled after it, at the same delay, so it runs
  // second.
  setTimeout(reportSummary, 0);
}, 10);
