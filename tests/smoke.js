/* Manga Tools smoke test: no browser needed, everything runs against stubs */
const path = require("path");
const fs = require("fs");
const assert = require("assert");

// The tests run against the *compiled* plugin, not the TypeScript sources — so
// they exercise exactly what gets published, and a broken build shows up here.
// Run `npm test`, which builds first.
const PLUGIN = path.join(__dirname, "..", "plugins", "mangaTools", "build");

// ── Stubs ──────────────────────────────────────────────────────────
const globalListeners = {};
const patched = {};
let capturedQuery = null;
let currentLocale = "zh-CN";

const React = {
  Fragment: Symbol("Fragment"),
  // Matches React: createElement only builds an element, it does not call the
  // component function, and a single child is not wrapped in an array.
  // Must be a normal function — inside an arrow function `arguments` refers to
  // the enclosing module's arguments.
  createElement: function (type, props) {
    const children = Array.prototype.slice.call(arguments, 2);
    const next = Object.assign({}, props);
    if (children.length === 1) next.children = children[0];
    else if (children.length > 1) next.children = children;
    return { type, props: next };
  },
  useState: (init) => [init, () => {}],
  useEffect: () => {},
};

const fakeClient = {
  query: () =>
    Promise.resolve({
      data: {
        findGalleries: {
          count: 4,
          galleries: [
            { id: "1", custom_fields: { language: "zh-Hans" } },
            { id: "2", custom_fields: { Language: "zh-Hant" } }, // capitalised key, canonical value
            { id: "3", custom_fields: { language: "klingon" } }, // unknown value
            { id: "4", custom_fields: { other: "x" } }, // no language, must be ignored
            { id: "5", custom_fields: { language: "ZH-HANS" } }, // non-canonical case
          ],
        },
      },
    }),
};

// ── Minimal DOM stub: only the methods the mount points actually use ──
function makeEl(tag) {
  const el = {
    tagName: tag,
    className: "",
    dataset: {},
    children: [],
    parentNode: null,
    detach(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      return i;
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.detach(child);
      el.children.push(child);
      child.parentNode = el;
      return child;
    },
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.detach(child);
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i >= 0) el.children.splice(i, 0, child);
      else el.children.push(child);
      child.parentNode = el;
      return child;
    },
    get lastElementChild() {
      return el.children[el.children.length - 1] || null;
    },
    get nextElementSibling() {
      if (!el.parentNode) return null;
      const i = el.parentNode.children.indexOf(el);
      return i >= 0 ? el.parentNode.children[i + 1] || null : null;
    },
    get previousElementSibling() {
      if (!el.parentNode) return null;
      const i = el.parentNode.children.indexOf(el);
      return i > 0 ? el.parentNode.children[i - 1] : null;
    },
    // Only ".cls", ".cls[data-field=...]" and a bare tag name are supported —
    // which is all these tests need.
    querySelector(sel) {
      const mAttr = /^\.([\w-]+)(?:\[data-field="([^"]+)"\])?$/.exec(sel);
      const mTag = /^([a-z]+)$/.exec(sel);
      if (!mAttr && !mTag) return null;

      const matches = (c) => {
        if (mAttr) {
          return (
            (c.className || "").split(/\s+/).includes(mAttr[1]) &&
            (mAttr[2] === undefined || c.dataset.field === mAttr[2])
          );
        }
        return c.tagName === mTag[1];
      };

      for (const c of el.children) {
        if (matches(c)) return c;
        const deep = c.querySelector ? c.querySelector(sel) : null;
        if (deep) return deep;
      }
      return null;
    },
  };
  return el;
}

const documentRoot = makeEl("body");

// Stands in for Stash's locale files: config.ui.language.heading exists in every
// UI language. These strings are test data — do not translate them.
const FIELD_LABELS = {
  "zh-CN": "语言",
  "zh-TW": "語言",
  "en-US": "Language",
  "ja-JP": "言語",
};

const PluginApi = {
  React,
  ReactDOM: {
    createPortal: (node, host) => ({ __portal: true, node, host }),
  },
  components: { Icon: () => null },
  libraries: {
    Apollo: {
      gql: (s) => {
        capturedQuery = s;
        return s;
      },
    },
    Bootstrap: {
      Form: { Label: () => null, Group: "FormGroup" },
      FormGroup: "FormGroup",
      Row: "Row",
      Col: "Col",
    },
    ReactSelect: { default: "Select" },
    Intl: {
      useIntl: () => ({
        locale: currentLocale,
        // Stands in for Stash's react-intl: a hit in the locale files returns the
        // translation, otherwise defaultMessage is used.
        formatMessage: ({ id, defaultMessage }) =>
          id === "config.ui.language.heading"
            ? FIELD_LABELS[currentLocale] || defaultMessage
            : defaultMessage,
      }),
    },
    FontAwesomeSolid: { faMinus: "faMinus" },
  },
  utils: { StashService: { getClient: () => fakeClient } },
  Event: {
    addEventListener: (name, cb) => {
      globalListeners[name] = cb;
    },
  },
  patch: {
    instead: (target, fn) => {
      patched[target] = fn;
    },
  },
};

global.window = { location: { pathname: "/galleries" }, setInterval: () => 0 };
global.document = {
  visibilityState: "visible",
  createElement: makeEl,
  querySelector: (sel) => documentRoot.querySelector(sel),
};

// ── Load the plugin ────────────────────────────────────────────────
require(path.join(PLUGIN, "languages.js"));
global.window.PluginApi = PluginApi;
require(path.join(PLUGIN, "mangaTools.js"));

const NS = global.window.MangaTools;
const original = (props) => ({ type: "ORIGINAL", props });
const call = (target, props) => patched[target](props, undefined, original);
const call2 = (target, props) => patched[target](props, original);

/** Is a piece of text present anywhere in the tree? (whitespace-insensitive) */
function hasText(node, text) {
  return (
    find(
      node,
      (n) =>
        typeof n.props.children === "string" &&
        n.props.children.trim() === text.trim()
    ) !== null
  );
}

/**
 * Finds the first element in the tree matching a predicate.
 *
 * It renders function components as it goes (Flag, for instance). Without that,
 * a structure like "component wrapping a span" is just an element whose type is
 * a function, and the real span is never reached.
 * This is a tiny test-only renderer: no hooks, no state.
 */
function find(node, pred) {
  if (node === null || node === undefined) return null;

  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, pred);
      if (hit) return hit;
    }
    return null;
  }

  // Portal: the content hangs off `node`, so descend straight into it.
  if (node.__portal) {
    return find(node.node, pred);
  }

  // Text node: wrap it as a pseudo-element so predicates like hasText can match.
  if (typeof node !== "object") {
    return pred({ props: { children: node } }) ? node : null;
  }

  // Function component: call it to get its output, then keep looking.
  if (typeof node.type === "function") {
    return find(node.type(node.props), pred);
  }

  if (pred(node)) return node;
  return find(node.props && node.props.children, pred);
}

// ── 1. Normalisation ───────────────────────────────────────────────
// Values are only ever written by this plugin's own dropdown, so only letter
// case and surrounding whitespace are tolerated. Anything else is returned
// unchanged and described as unknown (a grey "unrecognised" chip).
const cases = [
  ["zh-Hans", "zh-Hans"], ["zh-Hant", "zh-Hant"], ["ja", "ja"], ["en", "en"],
  ["ZH-HANS", "zh-Hans"], ["Zh-Hant", "zh-Hant"],   // case-insensitive
  ["  en  ", "en"], ["\tja\n", "ja"],               // surrounding whitespace
  ["chs", "chs"], ["简体", "简体"], ["jp", "jp"],   // former aliases no longer resolve
  ["zh-TW", "zh-TW"], ["中文", "中文"], ["chi", "chi"],
  ["klingon", "klingon"], ["zh", "zh"],             // unrecognised: returned as-is
  ["", ""], [null, ""], [undefined, ""],
];
cases.forEach(([input, want]) =>
  assert.strictEqual(NS.normalize(input), want, `normalize(${JSON.stringify(input)})`)
);
console.log(`✓ normalisation: all ${cases.length} cases pass`);

// ── 2. UI locale parsing (aligned with Stash's getLocaleCode) ──────
assert.strictEqual(NS.localeCode("zh-CN"), "zh");
assert.strictEqual(NS.localeCode("zh-TW"), "tw");
assert.strictEqual(NS.localeCode("en-US"), "en");
assert.strictEqual(NS.localeCode("ja-JP"), "ja");
assert.strictEqual(NS.localeCode("ko-KR"), "ko");
assert.strictEqual(NS.localeCode(""), "en", "empty locale should fall back to English");
assert.strictEqual(NS.localeCode(undefined), "en");
console.log("✓ localeCode");

// ── 3. Localised names (the expected strings are data, not prose) ──
assert.strictEqual(NS.name("ja", "zh-CN"), "日语");
assert.strictEqual(NS.name("ja", "zh-TW"), "日語");
assert.strictEqual(NS.name("ja", "en-US"), "Japanese");
assert.strictEqual(NS.name("ja", "ja-JP"), "日本語");
assert.strictEqual(NS.name("zh-Hant", "zh-CN"), "繁体中文");
assert.strictEqual(NS.name("ZH-HANS", "zh-CN"), "简体中文", "non-canonical case still resolves");
assert.strictEqual(NS.name("chs", "zh-CN"), "chs", "non-canonical spelling returned as-is, never guessed");
assert.strictEqual(NS.name("ja", "de-DE"), "Japanese", "uncovered UI language falls back to English");
assert.strictEqual(NS.name("klingon", "zh-CN"), "klingon", "unknown code returned as-is");
console.log("✓ localised names (zh / tw / en / ja + fallback)");

// ── 4. describe: code + flag + name ────────────────────────────────
let d = NS.describe("zh-Hans", "zh-CN");
assert.deepStrictEqual(
  { c: d.code, f: d.flag, n: d.name, k: d.known },
  { c: "zh-Hans", f: "cn", n: "简体中文", k: true }
);
// A canonical code in the wrong case should still be recognised, and reported
// in its canonical form.
d = NS.describe("ZH-HANS", "zh-CN");
assert.strictEqual(d.known, true);
assert.strictEqual(d.code, "zh-Hans");

assert.strictEqual(NS.describe("ja", "zh-CN").flag, "jp");
assert.strictEqual(NS.describe("zh-Hant", "zh-CN").flag, "tw");
assert.strictEqual(NS.describe("ko", "zh-CN").flag, "kr");
assert.strictEqual(NS.describe("vi", "zh-CN").flag, "vn", "Vietnam is vn, not vi");

// Non-canonical spellings (former aliases, other notations) are all unknown now
// and are no longer silently corrected.
["chs", "简体", "jp", "zh-TW", "中文"].forEach((v) => {
  const r = NS.describe(v, "zh-CN");
  assert.strictEqual(r.known, false, `${v} should no longer resolve as a language`);
  assert.strictEqual(r.flag, null, `${v} should have no flag`);
  assert.strictEqual(r.name, v, `${v} should be displayed as-is`);
});

d = NS.describe("klingonish", "zh-CN");
assert.strictEqual(d.known, false);
assert.strictEqual(d.flag, null, "unknown values have no flag");
assert.strictEqual(d.name, "klingonish");

assert.strictEqual(NS.describe("", "zh-CN"), null);
assert.strictEqual(NS.describe(null, "zh-CN"), null);
console.log("✓ describe (flag mapping, case tolerance, unknown values)");

// ── 5. Every language has a flag and names in all four UI locales ──
Object.keys(NS.LANGUAGES).forEach((code) => {
  const entry = NS.LANGUAGES[code];
  assert.ok(entry.flag && entry.flag.length === 2, `${code} is missing a flag code`);
  ["zh", "tw", "en", "ja"].forEach((loc) => {
    assert.ok(entry.names[loc], `${code} is missing the ${loc} name`);
  });
});
console.log(`✓ language table complete (${Object.keys(NS.LANGUAGES).length} languages × 4 UI locales)`);

// ── 6. Patch registration ──────────────────────────────────────────
// Note it is CustomFields (plural, the container), not CustomField — the latter
// is a plain React.FC, so patching it reports no error and simply never runs.
// That is a real bug this project hit.
[
  "GalleryCard.Overlays",
  "CustomFieldsInput",
  "CustomFieldInput",
  "CustomFields",
].forEach((t) => assert.ok(patched[t], `missing patch: ${t}`));
console.log("✓ all 4 patches registered");

// ── 7. Query shape ─────────────────────────────────────────────────
// Another bug this project hit: OR is singular in the schema
// (OR: GalleryFilterType). Writing it as an array makes the whole query fail
// validation, the failure is swallowed by the catch, and the symptom is
// "no badges at all" with no clue anywhere outside the console.
assert.ok(capturedQuery, "the plugin never built a query");
assert.ok(
  !/OR\s*:\s*\[/.test(capturedQuery),
  "OR is singular in the schema; an array fails validation"
);
assert.ok(
  /custom_fields:\s*\[\{\s*field:\s*"language",\s*modifier:\s*NOT_NULL\s*\}\]/.test(
    capturedQuery
  ),
  "the query should filter on language with NOT_NULL"
);
console.log("✓ query shape (OR not misused as an array)");

// ── 8. CustomFieldInput isolation ──────────────────────────────────
assert.strictEqual(call("CustomFieldInput", { field: "language", value: "zh-Hans" }), null,
  "an existing language row should render null");
assert.strictEqual(call("CustomFieldInput", { field: "Language", value: "x" }), null,
  "a capitalised field name should be recognised too");
assert.strictEqual(call("CustomFieldInput", { field: "language", isNew: true }).type, original,
  "the isNew row must pass through, or it vanishes while the name is being typed");
assert.strictEqual(call("CustomFieldInput", { field: "author", value: "x" }).type, original,
  "other fields must go back to the original component");
assert.strictEqual(call2("CustomFieldInput", { field: "author" }).type, original,
  "reading the original as args[last] must survive the 2-argument call form");
console.log("✓ CustomFieldInput isolation (including the 2-argument form)");

// ── 9. CustomFields detail page: lift the language entry, portal it into .gallery-details ──
// Mount a detail panel into the DOM stub to stand in for a gallery detail page
const galleryPanel = makeEl("div");
galleryPanel.className = "gallery-details";
documentRoot.appendChild(galleryPanel);
// The panel already holds a few rows rendered by Stash
const stockH6 = makeEl("h6");
galleryPanel.appendChild(stockH6);

const detail = (values) => {
  const frag = call("CustomFields", { values, fullWidth: true });
  const rest = frag.props.children[0].props.values;
  const rowEl = frag.props.children[1];
  return { rest, portal: rowEl.type(rowEl.props) };
};

let r9 = detail({ language: "zh-Hant", author: "x" });
assert.deepStrictEqual(r9.rest, { author: "x" }, "the language entry must be lifted out so it is not rendered twice");
assert.strictEqual(r9.portal.__portal, true, "should render through a portal");

// The mount point must land at the end of .gallery-details — after "photographer",
// before "details".
const host = galleryPanel.lastElementChild;
assert.strictEqual(host.className, "manga-tools-detail-host");
assert.strictEqual(host.parentNode, galleryPanel);
assert.strictEqual(r9.portal.host, host, "the portal should render into this mount point");

// Content: <h6> + flag + localised name, matching the rows above it
assert.strictEqual(r9.portal.node.type, "h6");
assert.strictEqual(r9.portal.node.props.className, "manga-tools-detail");
const rowFlag = find(r9.portal.node, (n) => /fi fi-/.test(n.props.className || ""));
assert.strictEqual(rowFlag.props.className, "fi fi-tw manga-tools-flag");
assert.ok(hasText(r9.portal.node, "繁体中文"), "the name should be localised");
assert.ok(hasText(r9.portal.node, "语言: "), "the label should come from Stash's locale files (zh-CN → 语言)");

// Spacing comes from a text space, not a CSS margin, so pin the text children
// down. With a flag: "label + space" + flag + " " + name — equal gaps either side.
assert.deepStrictEqual(
  r9.portal.node.props.children.filter((c) => typeof c === "string"),
  ["语言: ", " ", "繁体中文"]
);

// When a React re-render pushes the mount point earlier, it must be pulled back.
galleryPanel.appendChild(makeEl("h6")); // stand in for another row React adds
assert.strictEqual(galleryPanel.lastElementChild.tagName, "h6", "precondition: the mount point was displaced");
detail({ language: "ja" });
assert.strictEqual(galleryPanel.lastElementChild, host, "a re-render should pull it back to the end");
const hosts = galleryPanel.children.filter(
  (c) => c.className === "manga-tools-detail-host"
);
assert.strictEqual(hosts.length, 1, "the mount point must not be created twice");
assert.strictEqual(hosts[0], host, "the same mount point should be reused");

// A capitalised key should be lifted out too (field names are case-insensitive;
// the value itself must still be canonical).
r9 = detail({ Language: "zh-Hant" });
assert.deepStrictEqual(r9.rest, {}, "a capitalised key should be lifted out too");
assert.ok(hasText(r9.portal.node, "繁体中文"));

// Unknown value: no flag, text only — and no stray extra space
r9 = detail({ language: "klingon" });
assert.strictEqual(find(r9.portal.node, (n) => /fi fi-/.test(n.props.className || "")), null,
  "an unknown value should have no flag");
assert.ok(hasText(r9.portal.node, "klingon"));
assert.deepStrictEqual(
  r9.portal.node.props.children.filter((c) => typeof c === "string"),
  ["语言: ", "klingon"],
  "without a flag there must not be a double space in \"语言:  klingon\""
);

// Label i18n: follows the UI language, falls back to English
currentLocale = "ja-JP";
assert.ok(hasText(detail({ language: "ja" }).portal.node, "言語: "), "should follow the UI language");
currentLocale = "de-DE";
assert.ok(hasText(detail({ language: "ja" }).portal.node, "Language: "),
  "should fall back to English for a locale without the key");
currentLocale = "zh-CN";

// No language field at all → hands off completely
let noLang = call("CustomFields", { values: { author: "x" } });
assert.strictEqual(noLang.type, original, "without a language field the original is used unchanged");
assert.ok(call("CustomFields", {}), "empty values must not throw");
assert.ok(call("CustomFields", {}), "missing values must not throw");

// Not on a gallery detail page (no .gallery-details): render nothing, do not throw
galleryPanel.parentNode.children.splice(
  galleryPanel.parentNode.children.indexOf(galleryPanel), 1
);
assert.strictEqual(detail({ language: "ja" }).portal, null, "with no mount point it should safely return null");
documentRoot.appendChild(galleryPanel);
console.log("✓ detail page (lift out / portal target / pull back / label i18n / unknown / no mount point)");

// ── 9b. Edit page: the language field portals between studio and performers ──
// Stand in for the edit form: studio row → performer row, with data-field as the anchor
const editForm = makeEl("form");
documentRoot.appendChild(editForm);

const studioRow = makeEl("div");
studioRow.className = "form-group row";
studioRow.dataset.field = "studio_id";
editForm.appendChild(studioRow);

// The native field's label and control — the plugin copies their class names
const studioLabel = makeEl("label");
studioLabel.className = "form-label col-form-label col-sm-3";
const studioControl = makeEl("div");
studioControl.className = "col-sm-9";
studioRow.appendChild(studioLabel);
studioRow.appendChild(studioControl);

const performerRow = makeEl("div");
performerRow.className = "form-group row";
performerRow.dataset.field = "performer_ids";
editForm.appendChild(performerRow);

const editField = (values, onChange) => {
  const el = call("CustomFieldsInput", { values, onChange: onChange || (() => {}) })
    .props.children[0];
  return el.type(el.props);
};

const fieldPortal = editField({ language: "ja" });
assert.strictEqual(fieldPortal.__portal, true, "should render through a portal into the edit form");

const fieldHostEl = editForm.children[1];
assert.strictEqual(fieldHostEl.className, "manga-tools-field-host");
assert.strictEqual(fieldHostEl.previousElementSibling, studioRow,
  "the mount point should come right after the studio row");
assert.strictEqual(fieldHostEl.nextElementSibling, performerRow,
  "and right before the performer row — i.e. between studio and performers");
assert.strictEqual(fieldPortal.host, fieldHostEl);

// Field structure: every class name is copied from the native field rather than
// generated, so the column widths can never drift.
const fg = fieldPortal.node;
assert.strictEqual(fg.type, "div");
assert.strictEqual(fg.props.className, "form-group row");
assert.strictEqual(fg.props["data-field"], "manga_tools_language");

// This is a bug this project hit: xl:2 / xl:7 used to be hard-coded, but the
// Stash build actually running has no xl in its defaults, so the label column
// came out narrower than the native ones on wide screens and never lined up.
// Copying the native class names matches whatever they happen to be.
const labelEl = fg.props.children[0];
assert.strictEqual(labelEl.type, "label");
assert.strictEqual(labelEl.props.className, "form-label col-form-label col-sm-3",
  "the label classes should be copied verbatim (no extra col-xl-2)");
assert.strictEqual(labelEl.props.htmlFor, "manga_tools_language");
assert.strictEqual(labelEl.props.children, "语言", "the label should come from Stash's locale files");

const controlEl = fg.props.children[1];
assert.strictEqual(controlEl.type, "div");
assert.strictEqual(controlEl.props.className, "col-sm-9",
  "the control classes should be copied verbatim (no extra col-xl-7)");

// When the native field changes width, follow it
studioLabel.className = "form-label col-form-label col-xl-12 col-sm-3";
studioControl.className = "col-xl-12 col-sm-9";
const followed = editField({ language: "ja" }).node;
assert.strictEqual(followed.props.children[0].props.className,
  "form-label col-form-label col-xl-12 col-sm-3", "should follow the native field's widths");
assert.strictEqual(followed.props.children[1].props.className, "col-xl-12 col-sm-9");
studioLabel.className = "form-label col-form-label col-sm-3";
studioControl.className = "col-sm-9";

// Anchor present but unreadable internals: fall back to the default, do not throw
studioRow.detach(studioLabel);
studioRow.detach(studioControl);
assert.strictEqual(editField({ language: "ja" }).node.props.children[1].props.className,
  "col-sm-9", "should fall back to the default when the native classes cannot be read");
studioRow.appendChild(studioLabel);
studioRow.appendChild(studioControl);

// The dropdown itself
const editSelect = find(fg, (n) => n.props && n.props.options);
assert.strictEqual(editSelect.props.value.value, "ja");
assert.strictEqual(editSelect.props.value.flag, "jp");
assert.strictEqual(editSelect.props.options[0].label, "日语");

// Appearance must match Stash's own dropdowns: no default separator rule, and
// the same theme prefix
assert.strictEqual(typeof editSelect.props.components.IndicatorSeparator, "function",
  "the react-select IndicatorSeparator should be removed (Stash's Select.tsx does the same)");
assert.strictEqual(editSelect.props.components.IndicatorSeparator(), null);
assert.strictEqual(editSelect.props.classNamePrefix, "react-select",
  "should reuse Stash's react-select theme prefix");
assert.strictEqual(editSelect.props.inputId, "manga_tools_language", "should pair with the label's for");

// When a React re-render displaces the mount point, pull it back after studio
editForm.insertBefore(makeEl("div"), performerRow);
editField({ language: "ja" });
assert.strictEqual(fieldHostEl.previousElementSibling, studioRow, "a re-render should pull it back");
const fieldHosts = editForm.children.filter(
  (c) => c.className === "manga-tools-field-host"
);
assert.strictEqual(fieldHosts.length, 1, "the mount point must not be created twice");

// Nothing renders off a gallery page
globalListeners["stash:location"]({ detail: { data: { location: { pathname: "/scenes/5" } } } });
assert.strictEqual(editField({ language: "ja" }), null, "no language field on a scene page");
globalListeners["stash:location"]({ detail: { data: { location: { pathname: "/galleries/1" } } } });
assert.notStrictEqual(editField({ language: "ja" }), null, "restored when back on a gallery page");

// No studio anchor: return null safely, do not throw
const firstChild = editForm.children[0];
editForm.detach(studioRow);
assert.strictEqual(editField({ language: "ja" }), null, "with no studio field it should safely return null");
editForm.insertBefore(studioRow, firstChild);
console.log("✓ edit page (target between studio and performers / widths copied / pull back / no anchor)");

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
  /\.gallery-card:hover\s+\.manga-tools-badge[^{]*\{[^}]*opacity:\s*0/.test(css),
  "the hover fade-out rule is missing"
);
assert.ok(
  /\.gallery-card\s+\.thumbnail-section\s*\{[^}]*position:\s*relative/.test(css),
  "the .thumbnail-section positioning context is missing, so the badge lands below the title"
);
assert.ok(
  /\.manga-tools-badge\s+\.fi\s*\{[^}]*height:/.test(css),
  "the badge flag sizing rule is missing"
);
console.log("✓ CSS checks (braces / hover / positioning / flag sizing)");

setTimeout(() => {
  // ── 11. Badges (after the refresh promise settles) ───────────────
  const card = (id) => call("GalleryCard.Overlays", { gallery: { id } });

  // The badge wraps a Flag component, so one more render is needed to reach the span
  const badgeOf = (id) => {
    const el = card(id);
    if (el.type !== React.Fragment) return null;
    const b = el.props.children[1];
    return b.type(b.props);
  };
  const flagOf = (id) => {
    const badge = badgeOf(id);
    if (!badge || badge.type !== "div") return null;
    const inner = badge.props.children;
    // The unknown-value branch holds plain text, not a Flag element
    if (!inner || typeof inner.type !== "function") return null;
    return inner.type(inner.props);
  };

  assert.strictEqual(card("1").type, React.Fragment, "gallery 1 should carry a badge");
  assert.strictEqual(flagOf("1").props.className, "fi fi-cn", "gallery 1 should show the China flag");
  assert.strictEqual(flagOf("2").props.className, "fi fi-tw", "gallery 2 holds a traditional value");
  assert.strictEqual(flagOf("5").props.className, "fi fi-cn",
    "gallery 5 holds ZH-HANS, which is non-canonical case and should still resolve");
  assert.strictEqual(badgeOf("1").props["aria-label"], "简体中文", "should carry an aria-label");
  assert.strictEqual(card("4").type, original, "a gallery without a language must not be touched");
  assert.strictEqual(card("999").type, original, "an unknown id must not be touched");

  // Unknown value: grey text chip, no flag
  const unknown = badgeOf("3");
  assert.strictEqual(unknown.props.className, "manga-tools-badge is-unknown");
  assert.strictEqual(unknown.props.children, "klingon");
  assert.strictEqual(flagOf("3"), null, "an unknown value must not render a flag");

  // Follows the UI language
  currentLocale = "ja-JP";
  assert.strictEqual(badgeOf("1").props["aria-label"], "中国語（簡体）", "should follow the UI language");
  currentLocale = "zh-CN";
  console.log("✓ badges (flag / case tolerance / unknown / no field / UI language)");

  // ── 12. Route scoping ────────────────────────────────────────────
  assert.strictEqual(typeof globalListeners["stash:location"], "function", "the route event was never subscribed");
  const nav = (p) =>
    globalListeners["stash:location"]({ detail: { data: { location: { pathname: p } } } });

  const renderRow = (values, onChange) => {
    const el = call("CustomFieldsInput", { values, onChange: onChange || (() => {}) })
      .props.children[0];
    return el.type(el.props);
  };

  nav("/scenes/5");
  assert.strictEqual(renderRow({ language: "zh-Hans" }), null, "no language dropdown on a scene page");
  nav("/performers/3");
  assert.strictEqual(renderRow({ language: "zh-Hans" }), null, "no language dropdown on a performer page");
  nav("/galleries/12");
  assert.notStrictEqual(renderRow({ language: "zh-Hans" }), null, "the dropdown should appear on a gallery detail page");
  nav("/galleries");
  assert.notStrictEqual(renderRow({ language: "zh-Hans" }), null, "and on the gallery list page (bulk edit)");
  console.log("✓ route scoping (hidden on scenes/performers, shown on galleries)");

  // ── 13. Edit write semantics ─────────────────────────────────────
  let captured = null;
  const setter = (v) => { captured = v; };
  const row = renderRow({ author: "x", Language: "ja" }, setter);
  const select = find(row, (n) => n.props && typeof n.props.onChange === "function" && n.props.options);

  select.props.onChange({ value: "zh-Hant" });
  assert.deepStrictEqual(captured, { author: "x", language: "zh-Hant" },
    "writing should drop case variants and canonicalise the field name to lowercase");

  select.props.onChange(null);
  assert.deepStrictEqual(captured, { author: "x" }, "clearing should remove the field entirely");

  // Options: flag + localised name
  const opts = select.props.options;
  assert.strictEqual(opts[0].value, "ja", "common languages should come first");
  assert.strictEqual(opts[0].label, "日语");
  assert.strictEqual(opts[0].flag, "jp");
  assert.strictEqual(opts.some((o) => o.flag === "vn"), true, "the Vietnam flag should be vn");
  assert.strictEqual(opts.every((o) => o.flag && o.flag.length === 2), true, "every option should have a flag");

  // Selected value echo: a canonical code in the wrong case echoes back canonical
  const sel = find(renderRow({ language: "ZH-HANT" }), (n) => n.props && n.props.options);
  assert.strictEqual(sel.props.value.label, "繁体中文", "should echo the canonical name");
  assert.strictEqual(sel.props.value.value, "zh-Hant", "should echo the canonical code");
  assert.strictEqual(sel.props.value.flag, "tw");

  // Non-canonical spellings (former aliases, other notations) are unknown values
  // now: they appear in the list as-is, otherwise picking something else would
  // make them unreachable.
  const selUnknown = find(renderRow({ language: "chs" }), (n) => n.props && n.props.options);
  assert.strictEqual(selUnknown.props.options[0].value, "chs");
  assert.strictEqual(selUnknown.props.options[0].flag, null, "an unknown option has no flag");
  assert.strictEqual(selUnknown.props.value.label, "chs", "an unknown value echoes as-is");

  // formatOptionLabel should render flag + name
  const formatted = sel.props.formatOptionLabel({ value: "ja", label: "日语", flag: "jp" });
  assert.strictEqual(
    find(formatted, (n) => /fi fi-jp/.test(n.props.className || "")).props.className,
    "fi fi-jp manga-tools-flag"
  );
  assert.strictEqual(find(formatted, (n) => n.props.children === "日语") !== null, true);
  const formattedUnknown = sel.props.formatOptionLabel({ value: "x", label: "x", flag: null });
  assert.strictEqual(find(formattedUnknown, (n) => /fi fi-/.test(n.props.className || "")), null,
    "an option with no flag must not render a flag");
  console.log("✓ edit write / clear / option flags and names");

  console.log("\nAll smoke tests passed");
}, 10);
