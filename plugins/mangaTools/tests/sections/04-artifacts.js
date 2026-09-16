/**
 * 10–10b: the two built artefacts — the stylesheet and the bundle.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { PLUGIN } = require("../helpers.js");

module.exports = () => {
  // ── 10. Basic CSS checks (catch typos and missing rules after hand edits) ──
  const css = fs.readFileSync(path.join(PLUGIN, "mangaTools.css"), "utf8");
  assert.strictEqual(
    (css.match(/\{/g) || []).length,
    (css.match(/\}/g) || []).length,
    "CSS braces are unbalanced"
  );
  assert.ok(
    /\.manga-tools-badge\s*\{[^}]*opacity:\s*0\.75/.test(css),
    "the badge's resting opacity should be 0.75 (matching .studio-overlay)"
  );
  assert.ok(
    /\.gallery-card:hover\s+\.manga-tools-badge[^{]*\{[^}]*opacity:\s*0/.test(
      css
    ),
    "the hover fade-out rule is missing"
  );
  assert.ok(
    /\.gallery-card\s+\.thumbnail-section\s*\{[^}]*position:\s*relative/.test(
      css
    ),
    "the .thumbnail-section positioning context is missing, so the badge lands below the title"
  );
  assert.ok(
    /\.manga-tools-badge\s+\.fi\s*\{[^}]*height:/.test(css),
    "the badge flag sizing rule is missing"
  );
  // The text chip's truncation belongs to unrecognised values only. A recognised
  // language name is shown whole — clipping it is what made "印度尼西亚语" come out
  // as "印度尼…" with flags turned off.
  const boundedChip = /\.manga-tools-badge\.is-unknown\s*\{([^}]*)\}/.exec(css);
  assert.ok(
    boundedChip && /text-overflow:\s*ellipsis/.test(boundedChip[1]),
    "an unrecognised value should be bounded and ellipsised"
  );
  assert.ok(
    !/\.manga-tools-badge\.is-name\s*\{[^}]*text-overflow/.test(css),
    "a recognised language name must not be truncated — see the .is-name rule"
  );
  // Stash's row of condition tags under our card carries Bootstrap's `d-flex`,
  // which is `display: flex !important` — so hiding it only works with
  // `!important` of our own. Without it the row shows the same selection a second
  // time in Stash's raw wording, right under the picker.
  //
  // The whole row, not the empty one: an earlier version hid it only when empty,
  // which left it appearing as soon as the criterion held anything — and that is
  // the state a language filter is normally in.
  const pillsTagsRule =
    /\.criterion-list \[data-type="language"\] \.filter-tags\s*\{([^}]*)\}/.exec(
      css
    );
  assert.ok(pillsTagsRule, "the editor's own tag row should be hidden");
  assert.ok(
    /display:\s*none\s*!important/.test(pillsTagsRule[1]),
    "…with !important: a plain display: none loses to Bootstrap's d-flex"
  );
  // The flag needs its own spacing in a list row: a flex `gap` would also open up
  // the icon-to-name spacing those rows share with Stash's, and a margin applied
  // more broadly would double up in the dropdown and the detail row.
  assert.ok(
    /\.selected-object \.manga-tools-flag,[^}]*\.unselected-object \.manga-tools-flag\s*\{[^}]*margin:/.test(
      css
    ),
    "the flag in a list row should be spaced from the icon and the name"
  );
  // Stash's `.setting-section .setting > div:last-child { text-align: right }`
  // right-aligns the heading and description of this full-width settings block
  // unless it is explicitly undone.
  assert.ok(
    /\.setting-section\s+\.setting\.manga-tools-settings\s*>\s*div:last-child\s*\{[^}]*text-align:\s*left/.test(
      css
    ),
    "the settings block must reset Stash's text-align: right"
  );
  // The performers field is hidden by CSS rather than by not rendering the row —
  // Stash's form keeps the value, so nothing can clear it. That makes this rule
  // the whole of the feature, and its sibling combinator the load-bearing part of
  // it: the mount point carrying the class (set in 8–9b) has to be a sibling that
  // comes before Stash's row, which is where the plugin puts it.
  const performersRule =
    /\.manga-tools-field-host\.hide-performers\s*~\s*\.form-group\[data-field="performer_ids"\]\s*\{([^}]*)\}/.exec(
      css
    );
  assert.ok(
    performersRule,
    "a manga gallery's edit page should hide the performers field"
  );
  assert.ok(
    /display:\s*none/.test(performersRule[1]),
    "…by taking the field off the page, and not by emptying anything"
  );
  console.log(
    "✓ CSS checks (braces / hover / positioning / flag sizing / settings alignment / performers)"
  );

  // ── 10b. Bundle shape ──────────────────────────────────────────────
  // The plugin is loaded by Stash through a plain <script> tag, so the file has to
  // be a script and has to be self-contained. Both of those are properties of the
  // bundler configuration rather than of the source, which is exactly why they are
  // worth asserting: changing format to "esm" or forgetting bundle: true would
  // still produce a file, and it would only fail in the browser.
  const buildFiles = fs.readdirSync(PLUGIN).filter((f) => f.endsWith(".js"));
  assert.deepStrictEqual(
    buildFiles,
    ["mangaTools.js"],
    "one bundled file, named after the plugin ID — ui.javascript in the yml names this file"
  );

  const bundle = fs.readFileSync(path.join(PLUGIN, "mangaTools.js"), "utf8");
  assert.ok(
    !/^\s*(import|export)[\s{"']/m.test(bundle),
    "the bundle must not contain module syntax — Stash loads it as a plain script"
  );
  assert.ok(
    /React\.createElement/.test(bundle),
    "JSX should have been transformed into React.createElement calls"
  );
  assert.ok(
    /window\.MangaTools\s*=/.test(bundle),
    "languages.ts should be inlined into the bundle, not left as a separate file"
  );
  console.log(
    "✓ bundle shape (single script file, self-contained, JSX transformed)"
  );
};
