/* Manga Tools smoke test: no browser needed, everything runs against stubs */
const path = require("path");
const fs = require("fs");
const assert = require("assert");

// This spec sits beside the plugin it tests — src/, tests/ and build/ all live
// under plugins/mangaTools/ — so nothing here has to name the plugin: the path
// below reaches the build output by relative position alone.
//
// The tests run against the *bundled* plugin, not the TypeScript sources, so
// they exercise exactly what gets published and a broken build shows up here.
// Run `npm test` from the repository root, which builds first.
const PLUGIN = path.join(__dirname, "..", "build");

// ── Stubs ──────────────────────────────────────────────────────────
const globalListeners = {};
const patched = {};
const patchedBefore = {};
/** How many times the plugin asked for the gallery map — used to prove a
 *  successful bulk update triggers a refresh (and that a no-op one does not). */
let galleryQueryCount = 0;
const capturedQueries = [];
let settingsEnabled = ""; // the stored enabledLanguages setting, mutated by tests
let capturedConfigWrite = null; // last configurePlugin write, captured by the stub
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
  // Effects are run immediately. The plugin uses them for mount-time work (the
  // bulk dialog's link hook-up), so an inert stub would never exercise it.
  // Cleanups are discarded: nothing in these tests unmounts a component.
  useEffect: (fn) => {
    fn();
  },
};

/** The chain the plugin installed via setLink, captured by the client stub */
let installedLink = null;

/**
 * Stands in for Stash's provider_configuration history — the filter is applied
 * by rewriting the URL, so this is where a filter change shows up.
 */
const historyReplaces = [];
const fakeHistory = {
  location: { pathname: "/galleries", search: "?perPage=40" },
  replace(location) {
    historyReplaces.push(location);
    this.location = location;
  },
};

/**
 * A stub of Stash's ListFilterModel, cut down to what the language filter
 * touches: the criteria, the options that can mint a new criterion, a clone, and
 * the encoder. makeQueryParameters returns a readable stand-in rather than a
 * real URL, because the point of the test is what goes into it — reimplementing
 * Stash's encoding here would be testing the wrong thing.
 */
const CUSTOM_FIELDS_OPTION = {
  type: "custom_fields",
  makeCriterion: () => ({
    criterionOption: { type: "custom_fields" },
    value: [],
  }),
};

function makeFilterModel(criteria = []) {
  return {
    criteria,
    options: { criterionOptions: [CUSTOM_FIELDS_OPTION] },
    clone() {
      return makeFilterModel(
        criteria.map((c) => ({
          criterionOption: { ...c.criterionOption },
          value: (c.value || []).map((v) => ({
            ...v,
            value: v.value ? [...v.value] : v.value,
          })),
        }))
      );
    },
    makeQueryParameters() {
      // Recorded as well as encoded, so a test can assert on the criteria that
      // reached the encoder rather than on the plugin's guesses at the format.
      encodedCriteria.push(this.criteria);
      return "ENCODED(" + JSON.stringify(this.criteria) + ")";
    },
  };
}

/** Criteria handed to makeQueryParameters by the most recent call */
const encodedCriteria = [];

/** A custom-fields criterion holding the given conditions */
const customFieldsCriterion = (conditions) => ({
  criterionOption: { type: "custom_fields" },
  value: conditions,
});

const fakeClient = {
  // Stands in for Stash's existing link chain, which setLink must pass through.
  link: { __original: true },
  setLink(link) {
    this.link = link;
    installedLink = link;
  },
  query: ({ query }) => {
    // The plugin fires two queries: the gallery map (findGalleries) and the
    // settings (configuration { plugins }). Branch on the query text.
    if (/configuration/.test(String(query))) {
      return Promise.resolve({
        data: {
          configuration: {
            plugins: { mangaTools: { enabledLanguages: settingsEnabled } },
          },
        },
      });
    }
    galleryQueryCount += 1;
    return Promise.resolve({
      data: {
        findGalleries: {
          count: 4,
          galleries: [
            { id: "1", custom_fields: { language: "zh-Hans" } },
            { id: "2", custom_fields: { Language: "zh-Hant" } }, // capitalised key, canonical value
            { id: "3", custom_fields: { language: "klingon" } }, // unknown value
            { id: "4", custom_fields: { other: "x" } }, // no language, must be ignored
            { id: "5", custom_fields: { language: "ZH-HANS" } }, // non-canonical case
            { id: "6", custom_fields: { language: "zh-Hans" } }, // same as 1, for bulk aggregation
          ],
        },
      },
    });
  },
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
    // Only ".cls", ".cls[data-field=...]", "[data-field=...]" and a bare tag
    // name are supported — which is all these tests need. The bare attribute
    // form is what the bulk dialog's anchor uses: its rows are Bootstrap `.row`
    // divs, with no class of Stash's own to match on.
    querySelector(sel) {
      const mAttr = /^\.([\w-]+)(?:\[data-field="([^"]+)"\])?$/.exec(sel);
      const mField = /^\[data-field="([^"]+)"\]$/.exec(sel);
      const mTag = /^([a-z]+)$/.exec(sel);
      if (!mAttr && !mField && !mTag) return null;

      const matches = (c) => {
        if (mField) {
          return c.dataset.field === mField[1];
        }
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

// Stands in for Stash's locale files: every message this plugin reads, in the UI
// languages the tests use. `config.ui.language.heading` exists in all of them,
// which is why the plugin uses it for the label rather than carrying its own.
// These strings are test data — do not translate them.
const MESSAGES = {
  "zh-CN": {
    "config.ui.language.heading": "语言",
    "actions.search": "搜索",
    "criterion_modifier_values.any": "任意",
    "criterion_modifier_values.none": "无",
  },
  "zh-TW": {
    "config.ui.language.heading": "語言",
    "actions.search": "搜尋",
    "criterion_modifier_values.any": "任意",
    "criterion_modifier_values.none": "無",
  },
  "en-US": {
    "config.ui.language.heading": "Language",
    "actions.search": "Search",
    "criterion_modifier_values.any": "Any",
    "criterion_modifier_values.none": "None",
  },
  "ja-JP": {
    "config.ui.language.heading": "言語",
    "actions.search": "検索",
    "criterion_modifier_values.any": "任意",
    "criterion_modifier_values.none": "なし",
  },
};

const PluginApi = {
  React,
  ReactDOM: {
    createPortal: (node, host) => ({ __portal: true, node, host }),
  },
  // Names rather than components, so the tests can find an icon by its rendered
  // type and read the definition it was given.
  components: { Icon: "Icon" },
  libraries: {
    Apollo: {
      gql: (s) => {
        capturedQueries.push(s);
        return s;
      },
      // Enough of ApolloLink to compose and invoke a chain: the instance keeps
      // its request function, and from() records the links it was given.
      ApolloLink: (function () {
        function FakeLink(request) {
          this.request = request;
        }
        FakeLink.from = (links) => ({ __chain: links });
        return FakeLink;
      })(),
    },
    Bootstrap: {
      // A marker rather than a component, so the tests can find the switches and
      // read their props without rendering anything.
      Form: { Label: () => null, Group: "FormGroup", Switch: "Switch" },
      Button: "Button",
      Collapse: "Collapse",
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
          (MESSAGES[currentLocale] || {})[id] || defaultMessage,
      }),
    },
    FontAwesomeSolid: {
      faMinus: "faMinus",
      faPlus: "faPlus",
      faChevronDown: "faChevronDown",
      faChevronRight: "faChevronRight",
      faCheckCircle: "faCheckCircle",
      faTimesCircle: "faTimesCircle",
    },
    FontAwesomeRegular: { faTimesCircle: "faTimesCircle(regular)" },
    // Captured so a test can assert the URL the filter pushes.
    ReactRouterDOM: {
      useHistory: () => fakeHistory,
    },
  },
  utils: {
    StashService: {
      getClient: () => fakeClient,
      useConfigurePlugin: () => [
        (opts) => {
          capturedConfigWrite = opts.variables;
          return Promise.resolve({});
        },
      ],
    },
  },
  Event: {
    addEventListener: (name, cb) => {
      globalListeners[name] = cb;
    },
  },
  patch: {
    before: (target, fn) => {
      patchedBefore[target] = fn;
    },
    instead: (target, fn) => {
      patched[target] = fn;
    },
  },
};

global.window = { location: { pathname: "/galleries" }, setInterval: () => 0 };
global.document = {
  visibilityState: "visible",
  body: documentRoot,
  createElement: makeEl,
  querySelector: (sel) => documentRoot.querySelector(sel),
};

// ── Intl.DisplayNames stub ─────────────────────────────────────────
// The plugin takes language names from the platform instead of carrying a
// table, so this is where the names come from. It is a stub rather than the
// real thing — Node has one — for three reasons: the expected strings would
// otherwise drift with the Node version, the absent-API and throwing paths
// cannot be provoked from a working implementation, and, most importantly,
// only a stub can show *which locale list* the plugin asked for. That last one
// is the guarantee that names follow Stash's language setting and never the
// browser's, so it is worth being able to assert it.
const FAKE_NAMES = {
  ja: {
    "en-US": "Japanese", en: "Japanese", "zh-CN": "日语", "zh-TW": "日文",
    "ja-JP": "日本語", "de-DE": "Japanisch",
  },
  "zh-Hans": {
    "en-US": "Simplified Chinese", en: "Simplified Chinese", "zh-CN": "简体中文",
    "zh-TW": "簡體中文", "ja-JP": "簡体中国語", "de-DE": "Chinesisch (vereinfacht)",
  },
  "zh-Hant": {
    "en-US": "Traditional Chinese", en: "Traditional Chinese", "zh-CN": "繁体中文",
    "zh-TW": "繁體中文", "ja-JP": "繁体中国語", "de-DE": "Chinesisch (traditionell)",
  },
  en: { "en-US": "English", en: "English", "zh-CN": "英语", "ja-JP": "英語" },
  // Two complete sets, English and Chinese, so the ordering tests have real
  // names to sort in both. The Chinese strings are the ones Intl.DisplayNames
  // actually returns, so a failure here means this plugin broke, not the data.
  ko: { "en-US": "Korean", "zh-CN": "韩语" },
  es: { "en-US": "Spanish", "zh-CN": "西班牙语" },
  fr: { "en-US": "French", "zh-CN": "法语" },
  de: { "en-US": "German", "zh-CN": "德语" },
  it: { "en-US": "Italian", "zh-CN": "意大利语" },
  pt: { "en-US": "Portuguese", "zh-CN": "葡萄牙语" },
  ru: { "en-US": "Russian", "zh-CN": "俄语" },
  th: { "en-US": "Thai", "zh-CN": "泰语" },
  vi: { "en-US": "Vietnamese", "zh-CN": "越南语" },
  id: { "en-US": "Indonesian", en: "Indonesian", "zh-CN": "印度尼西亚语" },
};

/** Every locale the stub has any data for, so "unsupported" can be modelled */
const FAKE_LOCALES = new Set();
Object.keys(FAKE_NAMES).forEach((code) =>
  Object.keys(FAKE_NAMES[code]).forEach((loc) => FAKE_LOCALES.add(loc))
);

/** Every construction the plugin performed: { locales, options } */
const displayNamesCalls = [];
/** Set by a test to make every construction throw, as a malformed tag would */
let displayNamesThrows = false;

function FakeDisplayNames(locales, options) {
  if (displayNamesThrows) throw new RangeError("malformed language tag");
  this.locales = locales;
  this.options = options;
  this.resolvedLocale =
    locales.find((l) => FAKE_LOCALES.has(l)) || locales[locales.length - 1];
  displayNamesCalls.push({ locales: locales.slice(), options });
}
// of() echoes a code it cannot resolve, exactly as the real implementation does
FakeDisplayNames.prototype.of = function (code) {
  const perLocale = FAKE_NAMES[code];
  return (perLocale && perLocale[this.resolvedLocale]) || code;
};

/** The genuine article, kept so the "engine has no DisplayNames" path can be
 *  tested by removing it and then putting it back. */
const realDisplayNames = global.Intl.DisplayNames;
global.Intl.DisplayNames = FakeDisplayNames;

// ── Load the plugin ────────────────────────────────────────────────
// One file, not two: the bundle has languages.ts inlined into it. PluginApi has
// to be on the window first, because the bundle reads it as it loads — the same
// order Stash uses, where the API is injected before any plugin script runs.
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

// ── 2. The locale handed to Intl.DisplayNames ──────────────────────
// Names come from the platform now, so what this plugin is responsible for is
// *which locale it asks for*. It must be Stash's UI locale (react-intl's,
// which Stash sets from Configuration.interface.language) and it must be sent
// with English beside it: given a locale on its own, an engine that does not
// know it resolves against the runtime's default locale — the browser's —
// silently, which would quietly break "names follow the Stash language".
/** The most recent construction the plugin performed */
const lastDisplayNames = () => displayNamesCalls[displayNamesCalls.length - 1];

assert.strictEqual(NS.name("ja", "zh-CN"), "日语");
assert.deepStrictEqual(lastDisplayNames().locales, ["zh-CN", "en"],
  "Stash's locale first, English second — never the locale alone");
assert.strictEqual(lastDisplayNames().options.type, "language");

// A different UI locale reaches the platform, and changes the answer with it
assert.strictEqual(NS.name("ja", "ja-JP"), "日本語");
assert.deepStrictEqual(lastDisplayNames().locales, ["ja-JP", "en"]);

// One formatter per locale, not per lookup: the dropdown asks for all 14 names
// on every render, so rebuilding per call would construct 14 of them per render.
const callsBefore = displayNamesCalls.length;
NS.name("ja", "zh-CN");
NS.name("zh-Hant", "zh-CN");
NS.name("en", "zh-CN");
assert.strictEqual(displayNamesCalls.length, callsBefore,
  "a warm locale must reuse its formatter");
console.log("✓ Intl.DisplayNames is asked for [Stash locale, English], once per locale");

// ── 3. Localised names ─────────────────────────────────────────────
// Still "canonical code → name looked up when rendering → raw value otherwise",
// but the names are the platform's, so the expected strings here are the
// stub's — they describe the handoff, not a table this plugin maintains.
assert.strictEqual(NS.name("ja", "zh-CN"), "日语");
assert.strictEqual(NS.name("ja", "zh-TW"), "日文", "the Taiwan wording, which the old table got wrong");
assert.strictEqual(NS.name("ja", "en-US"), "Japanese");
assert.strictEqual(NS.name("ja", "ja-JP"), "日本語");
assert.strictEqual(NS.name("zh-Hant", "zh-CN"), "繁体中文");
assert.strictEqual(NS.name("ZH-HANS", "zh-CN"), "简体中文", "non-canonical case still resolves");
assert.strictEqual(NS.name("chs", "zh-CN"), "chs", "non-canonical spelling returned as-is, never guessed");
assert.strictEqual(NS.name("ja", "de-DE"), "Japanisch",
  "a UI language the old four-locale table had no entry for now resolves");
assert.strictEqual(NS.name("klingon", "zh-CN"), "klingon", "unknown code returned as-is");

// Recognition stays ours. DisplayNames would happily name "chi" and "jpn"
// (ISO 639-2), and those must keep reading as unrecognised data.
assert.strictEqual(NS.name("chi", "zh-CN"), "chi", "alpha-3 is not one of our codes");
assert.strictEqual(NS.name("jpn", "ja-JP"), "jpn", "…even in its own UI language");

// Falsy locale: ask for the fallback rather than for "" (which throws)
assert.strictEqual(NS.name("ja", ""), "Japanese");
assert.strictEqual(NS.name("ja"), "Japanese", "no locale at all still yields a name");
console.log("✓ localised names (any UI language, canonical recognition, unknown echoed)");

// ── 3b. Degrading when the platform cannot help ────────────────────
// Two ways, both of which must leave the raw code rather than throwing or
// inventing English. Each uses a UI locale no earlier test has asked for, so
// the plugin's per-locale cache cannot mask the failure.
displayNamesThrows = true;
assert.strictEqual(NS.name("ja", "pl-PL"), "ja", "a rejected locale degrades to the code");
displayNamesThrows = false;

global.Intl.DisplayNames = undefined;
assert.strictEqual(NS.name("ja", "nl-NL"), "ja", "no DisplayNames at all degrades to the code");
assert.strictEqual(NS.describe("zh-Hant", "nl-NL").name, "zh-Hant",
  "…and the rest of the description still renders");
global.Intl.DisplayNames = FakeDisplayNames;

assert.strictEqual(typeof realDisplayNames, "function",
  "precondition: the runtime has a real DisplayNames, so the stub is the only difference");
console.log("✓ degraded paths (rejected locale / absent API) fall back to the code");

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

// ── 5. Every language has a flag, and every one is offered ────────
// The table is only codes and flags now; there is nothing to check for names,
// because the plugin no longer holds any. What is worth checking is that every
// entry reaches the dropdown — languageOptions is built from the table itself,
// so a code can no longer be dropped by a list somewhere else disagreeing with
// it, and that is the property to hold on to.
Object.keys(NS.LANGUAGES).forEach((code) => {
  const entry = NS.LANGUAGES[code];
  assert.ok(entry.flag && entry.flag.length === 2, `${code} is missing a flag code`);
});
const offered = NS.languageOptions("en-US").map((o) => o.value);
assert.deepStrictEqual(
  offered.slice().sort(),
  Object.keys(NS.LANGUAGES).sort(),
  "every language in the table should be offered, and nothing else"
);
assert.strictEqual(new Set(offered).size, offered.length, "no language should be offered twice");
console.log(`✓ language table complete (${Object.keys(NS.LANGUAGES).length} codes × flag, all offered)`);

// ── 5b. The dropdown is ordered by the name the reader sees ────────
// There is no hand-written order any more — the old one was the author's
// languages first, then European, then the rest. Read off the English names,
// where the expected sequence is verifiable by eye.
assert.deepStrictEqual(
  NS.languageOptions("en-US").map((o) => o.label),
  ["English", "French", "German", "Indonesian", "Italian", "Japanese", "Korean",
   "Portuguese", "Russian", "Simplified Chinese", "Spanish", "Thai",
   "Traditional Chinese", "Vietnamese"],
  "options should be ordered by the displayed name"
);

// …and it is a *collated* order rather than code-point order. For Chinese the
// two genuinely disagree, so this fails if the collator is ever dropped for a
// plain .sort() — which would put Thai and Chinese in an order no reader of
// those scripts would recognise.
const zhOptions = NS.languageOptions("zh-CN");
const zhLabels = zhOptions.map((o) => o.label);
assert.deepStrictEqual(
  zhLabels,
  zhLabels.slice().sort(new Intl.Collator("zh-CN").compare),
  "Chinese names should be in pinyin order, not code-point order"
);

// And the order follows the UI language — that is the point of sorting by name.
const enValues = NS.languageOptions("en-US").map((o) => o.value);
assert.notDeepStrictEqual(zhOptions.map((o) => o.value), enValues,
  "a different UI language should order the same languages differently");
assert.deepStrictEqual(zhOptions.map((o) => o.value).sort(), enValues.slice().sort(),
  "…without changing which languages are offered");
console.log("✓ dropdown order (by displayed name, in the reader's collation)");

// ── 6. Patch registration ──────────────────────────────────────────
// Note it is CustomFields (plural, the container), not CustomField — the latter
// is a plain React.FC, so patching it reports no error and simply never runs.
// That is a real bug this project hit.
[
  "GalleryCard.Overlays",
  "CustomFieldsInput",
  "CustomFieldInput",
  "CustomFields",
  "PluginSettings",
  "RatingSystem",
].forEach((t) => assert.ok(patched[t], `missing patch: ${t}`));

// GalleryList carries two patches, which is allowed: Stash runs the
// before-functions first and passes their result on to any instead-functions
// (see patch.tsx). It is observed for the selection the bulk dialog needs, and
// wrapped so the sidebar language filter has somewhere to mount.
assert.ok(patchedBefore["GalleryList"], "missing patch: GalleryList (before)");
assert.ok(patched["GalleryList"], "missing patch: GalleryList (instead)");

// The wrapper has to hand the list through untouched — the plugin adds a
// sibling, it does not replace anything.
const listModel = makeFilterModel();
const listEl = call("GalleryList", { filter: listModel, selectedIds: new Set() });
assert.strictEqual(listEl.type, React.Fragment, "GalleryList should be wrapped, not replaced");
const listOriginal = listEl.props.children[1];
assert.strictEqual(listOriginal.type, original, "the original GalleryList must still be rendered");
assert.strictEqual(listOriginal.props.filter, listModel, "…receiving the same filter it was given");
assert.strictEqual(typeof listEl.props.children[0].type, "function",
  "and the language filter as a sibling");
console.log("✓ all 6 patches registered (+ GalleryList observed and wrapped)");

// ── 7. Query shape ─────────────────────────────────────────────────
// Another bug this project hit: OR is singular in the schema
// (OR: GalleryFilterType). Writing it as an array makes the whole query fail
// validation, the failure is swallowed by the catch, and the symptom is
// "no badges at all" with no clue anywhere outside the console.
const galleryQuery = capturedQueries.find((q) => /findGalleries/.test(q));
assert.ok(galleryQuery, "the plugin never built the gallery-map query");
assert.ok(
  !/OR\s*:\s*\[/.test(galleryQuery),
  "OR is singular in the schema; an array fails validation"
);
assert.ok(
  /custom_fields:\s*\[\{\s*field:\s*"language",\s*modifier:\s*NOT_NULL\s*\}\]/.test(
    galleryQuery
  ),
  "the query should filter on language with NOT_NULL"
);
console.log("✓ query shape (OR not misused as an array)");

// ── 7b. Settings: enabledLanguages parse/serialise ─────────────────
// The setting is a comma-separated string of canonical codes; an empty value
// means "no restriction" (parse returns null).
assert.strictEqual(NS.parseEnabledLanguages(null), null);
assert.strictEqual(NS.parseEnabledLanguages(undefined), null);
assert.strictEqual(NS.parseEnabledLanguages(""), null);
assert.strictEqual(NS.parseEnabledLanguages("   "), null);
assert.deepStrictEqual(
  [...NS.parseEnabledLanguages("ja,en,zh-Hans")].sort(),
  ["en", "ja", "zh-Hans"],
  "parse should split on commas"
);
assert.deepStrictEqual(
  [...NS.parseEnabledLanguages("ja, JA, klingon, zh-Hans ")].sort(),
  ["ja", "zh-Hans"],
  "parse should canonicalise case, drop unknown codes and dedupe"
);
assert.strictEqual(NS.parseEnabledLanguages("klingon"), null,
  "a value with only unknown codes parses to null (no restriction)");

// Ordered by code, never by the name the reader sees: the stored value has to
// come out the same for every user, and languageOptions' order now follows the
// UI language.
assert.strictEqual(NS.serializeEnabledLanguages(["ja", "en"]), "en,ja",
  "serialise should order by code, not insertion order");
assert.strictEqual(NS.serializeEnabledLanguages(new Set(["zh-Hans", "ja"])), "ja,zh-Hans");
assert.strictEqual(NS.serializeEnabledLanguages(["en", "ja"]),
  NS.serializeEnabledLanguages(["ja", "en"]),
  "the same selection must serialise the same way whatever order it arrives in");
assert.strictEqual(NS.serializeEnabledLanguages([]), "", "an empty set serialises to the empty string");

// The boolean settings. Absent means "not configured", so the default — on — is
// used, and an install that predates the setting behaves exactly as before.
assert.strictEqual(NS.parseFlag(null, true), true);
assert.strictEqual(NS.parseFlag(undefined, true), true);
assert.strictEqual(NS.parseFlag("", true), true);
assert.strictEqual(NS.parseFlag(true, false), true);
assert.strictEqual(NS.parseFlag(false, true), false);
assert.strictEqual(NS.parseFlag("false", true), false, "a hand-edited string is understood");
assert.strictEqual(NS.parseFlag("0", true), false);
assert.strictEqual(NS.parseFlag(" TRUE ", false), true);
assert.strictEqual(NS.parseFlag("nonsense", true), true, "an unreadable value falls back to the default");
assert.strictEqual(NS.showFlags, true, "flags default to on");
assert.strictEqual(NS.showCoverBadge, true, "the cover badge defaults to on");
console.log("✓ settings parse/serialise (including the booleans)");

// ── 7c. Settings UI: the multiselect writes the setting back ───────
// The patched PluginSettings swaps the stock input for MangaToolsSettings only
// for this plugin; other plugins fall back to the original component.
const settingsEl = call("PluginSettings", { pluginID: "mangaTools" });
assert.notStrictEqual(settingsEl.type, original,
  "mangaTools should swap in its own settings component");
assert.strictEqual(call("PluginSettings", { pluginID: "other" }).type, original,
  "other plugins must go back to the original component");

// Render the settings component (find renders function components) and locate
// the react-select, which carries isMulti + the full option list.
// Empty (no restriction) must render as an empty box with an "All languages"
// placeholder, NOT as every tag pre-selected.
NS.enabledLanguages = null;
const emptySelect = find(settingsEl, (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti);
assert.ok(emptySelect, "the settings UI should render a multiselect");
assert.strictEqual(emptySelect.props.isClearable, true);
assert.strictEqual(emptySelect.props.menuPlacement, "auto",
  "the menu should flip up when there is not enough room below");
assert.deepStrictEqual(emptySelect.props.value, [],
  "empty must not pre-select every language");
assert.strictEqual(emptySelect.props.placeholder, "All languages");

NS.enabledLanguages = new Set(["ja", "en"]);
const settingsSelect = find(settingsEl, (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti);
assert.deepStrictEqual(
  settingsSelect.props.value.map((o) => o.value),
  ["ja", "en"],
  "the current value should be the enabled set"
);

// The two switches, laid out like Stash's own BooleanSetting.
const switches = [];
find(settingsEl, (n) => {
  if (n.type === "Switch") switches.push(n);
  return false;
});
assert.strictEqual(switches.length, 2, "both switches should render");
assert.strictEqual(switches[0].props.id, "mangaTools-showFlags");
assert.strictEqual(switches[0].props.checked, true, "flags default to on");
assert.strictEqual(switches[1].props.id, "mangaTools-showCoverBadge");
assert.strictEqual(switches[1].props.checked, true, "the cover badge defaults to on");

// Selecting a new set writes it back through configurePlugin and updates the
// shared NS.enabledLanguages immediately.
settingsSelect.props.onChange([{ value: "ja" }, { value: "zh-Hans" }]);
assert.deepStrictEqual(capturedConfigWrite, {
  plugin_id: "mangaTools",
  input: {
    enabledLanguages: "ja,zh-Hans",
    showFlags: true,
    showCoverBadge: true,
  },
}, "every setting is written together, so replace-vs-merge cannot matter");
assert.deepStrictEqual([...NS.enabledLanguages], ["ja", "zh-Hans"],
  "the in-memory set should update immediately");

// Clearing writes "" (which parses back to "no restriction").
settingsSelect.props.onChange(null);
assert.deepStrictEqual(capturedConfigWrite.input.enabledLanguages, "");
assert.strictEqual(NS.enabledLanguages, null, "clearing should restore null (all languages)");

// Flipping a switch updates the shared state and persists the lot.
switches[0].props.onChange();
assert.strictEqual(NS.showFlags, false, "toggling should update the shared state");
assert.deepStrictEqual(capturedConfigWrite, {
  plugin_id: "mangaTools",
  input: { enabledLanguages: "", showFlags: false, showCoverBadge: true },
});
NS.showFlags = true;
console.log("✓ settings UI (multiselect + switches write configurePlugin, update shared state)");

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
// The order is asserted in 5b; here it is only the selected value echoing back.
assert.strictEqual(editSelect.props.options.find((o) => o.value === "ja").label, "日语");

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
// Stash's `.setting-section .setting > div:last-child { text-align: right }`
// right-aligns the heading and description of this full-width settings block
// unless it is explicitly undone.
assert.ok(
  /\.setting-section\s+\.setting\.manga-tools-settings\s*>\s*div:last-child\s*\{[^}]*text-align:\s*left/.test(
    css
  ),
  "the settings block must reset Stash's text-align: right"
);
console.log("✓ CSS checks (braces / hover / positioning / flag sizing / settings alignment)");

// ── 10b. Bundle shape ──────────────────────────────────────────────
// The plugin is loaded by Stash through a plain <script> tag, so the file has to
// be a script and has to be self-contained. Both of those are properties of the
// bundler configuration rather than of the source, which is exactly why they are
// worth asserting: changing format to "esm" or forgetting bundle: true would
// still produce a file, and it would only fail in the browser.
const buildFiles = fs.readdirSync(PLUGIN).filter((f) => f.endsWith(".js"));
assert.deepStrictEqual(buildFiles, ["mangaTools.js"],
  "one bundled file, named after the plugin ID — ui.javascript in the yml names this file");

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
console.log("✓ bundle shape (single script file, self-contained, JSX transformed)");

// ── 10c. Gallery list: what the language filter reads and writes ───
// The filter works by rewriting the URL, which Stash's list hook re-reads on
// every navigation. So what is worth testing is exactly what this plugin
// contributes: which conditions it merges into the filter, that it leaves the
// rest of the filter alone, and that the section looks like one of Stash's own.

const sel = (modifier, included, excluded) => ({
  modifier: modifier || "",
  included: included || [],
  excluded: excluded || [],
});
const conditionsOf = (modifier, value) => {
  const c = { field: "language", modifier };
  if (value !== undefined) c.value = value;
  return c;
};

// --- reading: every shape the model can be in ---------------------
assert.deepStrictEqual(NS.readLanguageFilter(makeFilterModel()), sel(),
  "a filter with no criteria means no language selection");
assert.deepStrictEqual(
  NS.readLanguageFilter(makeFilterModel([customFieldsCriterion([conditionsOf("NOT_NULL")])])),
  sel("any"),
  "NOT_NULL is the (Any) state"
);
assert.deepStrictEqual(
  NS.readLanguageFilter(makeFilterModel([customFieldsCriterion([conditionsOf("IS_NULL")])])),
  sel("none"),
  "IS_NULL is the (None) state"
);
assert.deepStrictEqual(
  NS.readLanguageFilter(makeFilterModel([customFieldsCriterion([conditionsOf("EQUALS", ["ja"])])])),
  sel("", ["ja"]),
  "EQUALS is an included value"
);
assert.deepStrictEqual(
  NS.readLanguageFilter(makeFilterModel([customFieldsCriterion([conditionsOf("NOT_EQUALS", ["ko"])])])),
  sel("", [], ["ko"]),
  "NOT_EQUALS is an excluded value"
);
assert.deepStrictEqual(
  NS.readLanguageFilter(makeFilterModel([customFieldsCriterion([
    conditionsOf("EQUALS", ["ja"]),
    conditionsOf("NOT_EQUALS", ["ko"]),
  ])])),
  sel("", ["ja"], ["ko"]),
  "include and exclude are two conditions and both are read"
);
assert.deepStrictEqual(
  NS.readLanguageFilter(makeFilterModel([customFieldsCriterion([
    conditionsOf("EQUALS", ["ja"]),
    { field: "author", modifier: "EQUALS", value: ["x"] },
  ])])),
  sel("", ["ja"]),
  "another field's condition is not a language selection"
);
assert.deepStrictEqual(
  NS.readLanguageFilter(makeFilterModel([customFieldsCriterion([
    { field: "Language", modifier: "EQUALS", value: ["ja"] },
  ])])),
  sel("", ["ja"]),
  "field names are matched case-insensitively, as everywhere else in this plugin"
);
assert.deepStrictEqual(
  NS.readLanguageFilter(makeFilterModel([customFieldsCriterion([
    conditionsOf("MATCHES_REGEX", ["ja"]),
  ])])),
  sel(),
  "a modifier this plugin does not use is ignored rather than misread"
);

// --- writing ------------------------------------------------------
/** Runs the merge and reports what it asked Stash to encode */
function writeFilter(selection, conditions) {
  const model = makeFilterModel(
    conditions === undefined ? [] : [customFieldsCriterion(conditions)]
  );
  encodedCriteria.length = 0;
  const result = NS.languageFilterQuery(model, selection);
  return {
    result,
    criteria: encodedCriteria.length ? encodedCriteria[encodedCriteria.length - 1] : null,
  };
}
const languageConditions = (criteria) =>
  (criteria || [])
    .filter((c) => c.criterionOption && c.criterionOption.type === "custom_fields")
    .flatMap((c) => c.value || []);

let w = writeFilter(sel("", ["ja"]));
assert.ok(w.result, "a selection should produce query parameters");
assert.deepStrictEqual(languageConditions(w.criteria), [conditionsOf("EQUALS", ["ja"])]);

// The two modifier states carry no value at all
assert.deepStrictEqual(languageConditions(writeFilter(sel("any")).criteria),
  [conditionsOf("NOT_NULL")], "(Any) should be NOT_NULL");
assert.deepStrictEqual(languageConditions(writeFilter(sel("none")).criteria),
  [conditionsOf("IS_NULL")], "(None) should be IS_NULL");

// Include and exclude ride together, which works because the conditions are ANDed
assert.deepStrictEqual(
  languageConditions(writeFilter(sel("", ["ja"], ["ko"])).criteria),
  [conditionsOf("EQUALS", ["ja"]), conditionsOf("NOT_EQUALS", ["ko"])],
  "including one language and excluding another should send both conditions"
);

// Several values are one condition, not several: EQUALS unions them, and two
// conditions on one field would be ANDed and match nothing.
assert.deepStrictEqual(
  languageConditions(writeFilter(sel("", ["ja", "zh-Hant"])).criteria),
  [conditionsOf("EQUALS", ["ja", "zh-Hant"])],
  "several included languages are a single ORed condition"
);
assert.deepStrictEqual(
  languageConditions(writeFilter(sel("", [], ["ja", "zh-Hant"])).criteria),
  [conditionsOf("NOT_EQUALS", ["ja", "zh-Hant"])],
  "…and so are several excluded ones"
);

// The model is Stash's own live state object, so it must come out unchanged —
// mutating it would change the filter without telling anything to re-render.
const liveModel = makeFilterModel([
  customFieldsCriterion([conditionsOf("EQUALS", ["ja"])]),
]);
NS.languageFilterQuery(liveModel, sel("", ["ko"]));
assert.deepStrictEqual(liveModel.criteria[0].value, [conditionsOf("EQUALS", ["ja"])],
  "the live filter model must not be mutated");

// Another custom field's condition survives: this composes with a hand-made
// filter rather than discarding it.
w = writeFilter(sel("", ["ja"]), [
  { field: "author", modifier: "EQUALS", value: ["x"] },
  conditionsOf("EQUALS", ["ko"]),
]);
assert.deepStrictEqual(languageConditions(w.criteria),
  [{ field: "author", modifier: "EQUALS", value: ["x"] }, conditionsOf("EQUALS", ["ja"])],
  "another custom field's condition should be kept, and the language replaced");

// A case variant of the field name is dropped, for the same reason.
w = writeFilter(sel("", ["ja"]), [{ field: "Language", modifier: "EQUALS", value: ["ko"] }]);
assert.deepStrictEqual(languageConditions(w.criteria), [conditionsOf("EQUALS", ["ja"])],
  "a capitalised field name must not leave a second condition behind");

// Clearing removes the conditions, and the criterion with them — an empty
// criterion would otherwise show up as a filter tag with nothing in it.
assert.deepStrictEqual(writeFilter(sel(), [conditionsOf("EQUALS", ["ja"])]).criteria, [],
  "clearing should drop the criterion entirely");
assert.deepStrictEqual(
  languageConditions(writeFilter(sel(), [
    conditionsOf("EQUALS", ["ja"]),
    { field: "author", modifier: "EQUALS", value: ["x"] },
  ]).criteria),
  [{ field: "author", modifier: "EQUALS", value: ["x"] }],
  "…but a criterion that still holds something else stays"
);

// Only the custom-fields criterion is touched; other criteria pass through.
// Compared by content, not identity: the model is cloned on the way, which is
// the whole reason the live one survives intact.
const mixed = makeFilterModel([
  { criterionOption: { type: "studios" }, value: [] },
  customFieldsCriterion([]),
]);
encodedCriteria.length = 0;
NS.languageFilterQuery(mixed, sel("", ["ja"]));
assert.deepStrictEqual(encodedCriteria[0].map((c) => c.criterionOption.type),
  ["studios", "custom_fields"], "unrelated criteria should be kept, with ours alongside");
assert.deepStrictEqual(encodedCriteria[0][0].value, [], "…and left untouched");

// A filter that offers no custom-fields criterion cannot take one
const noCustomFields = makeFilterModel([]);
noCustomFields.options = { criterionOptions: [] };
assert.strictEqual(NS.languageFilterQuery(noCustomFields, sel("", ["ja"])), null,
  "without the option there is nowhere to put the condition, and it says so");
console.log("✓ filter conditions (read any/none/include/exclude, write, merge, clear, not mutated)");

// ── 10d. The sidebar section itself ────────────────────────────────
// Stand in for the gallery list's sidebar, in the shape the real one has: the
// saved-filters section, then Stash's own pinned-criteria sections, then the
// footer that shows the result count.
const sidebar = makeEl("div");
sidebar.className = "sidebar";
documentRoot.appendChild(sidebar);

const savedFiltersSection = makeEl("div");
savedFiltersSection.className = "sidebar-section sidebar-saved-filters";
sidebar.appendChild(savedFiltersSection);

const pinnedStudioSection = makeEl("div");
pinnedStudioSection.className = "sidebar-section sidebar-list-filter";
sidebar.appendChild(pinnedStudioSection);

const sidebarFooter = makeEl("div");
sidebarFooter.className = "sidebar-footer";
sidebar.appendChild(sidebarFooter);

/** Renders the section and follows the portal it makes */
const renderLanguageFilter = (conditions) => {
  const el = call("GalleryList", {
    filter: makeFilterModel(
      conditions === undefined ? [] : [customFieldsCriterion(conditions)]
    ),
    selectedIds: new Set(),
  }).props.children[0];
  return el.type(el.props);
};

let section = renderLanguageFilter();
assert.strictEqual(section.__portal, true, "the section should render through a portal");

const filterHostEl = sidebar.children[1];
assert.strictEqual(filterHostEl.className, "manga-tools-field-host");
assert.strictEqual(filterHostEl.previousElementSibling, savedFiltersSection,
  "the section should come after the saved filters");
assert.strictEqual(filterHostEl.nextElementSibling, pinnedStudioSection,
  "and before Stash's own pinned sections");
assert.strictEqual(section.host, filterHostEl);

// Markup copied from Stash's own sidebar section (CollapseButton/SidebarSection),
// so it reads as one of them rather than as something bolted on.
const sectionEl = section.node;
assert.strictEqual(sectionEl.props.className, "sidebar-section sidebar-list-filter");
const headerButton = sectionEl.props.children[0].props.children;
assert.strictEqual(headerButton.type, "Button");
assert.strictEqual(headerButton.props.className, "minimal collapse-button");
assert.strictEqual(
  find(sectionEl, (n) => n.type === "Button").props.children[1].props.children,
  "语言",
  "the heading is Stash's own word for language, from its locale files"
);
assert.strictEqual(find(sectionEl, (n) => n.type === "Collapse").props.in, true,
  "open by default");
assert.strictEqual(find(sectionEl, (n) => n.type === "Collapse").props.mountOnEnter, true,
  "the candidates should not be mounted until the section is opened");
assert.strictEqual(typeof headerButton.props.onClick, "function",
  "the header should be clickable — the transition itself is not asserted, since "
  + "this stub's useState has a no-op setter and asserting it would test the stub");

// The candidate list: a search box, then Stash's two modifier entries, then
// every language.
const candidateList = find(sectionEl, (n) => {
  return n.props && n.props.className === "queryable-candidate-list";
});
assert.ok(candidateList, "the candidates should be in a queryable-candidate-list");

const searchField = find(candidateList, (n) =>
  n.props && n.props.className === "clearable-text-field form-control");
assert.ok(searchField, "the candidates should be searchable, like Stash's own");
assert.strictEqual(searchField.props.placeholder, "搜索…",
  "with Stash's placeholder, localised");

const candidateItems = [];
find(candidateList, (n) => {
  if (n.props && /^unselected-object\b/.test(n.props.className)) candidateItems.push(n);
  return false;
});
assert.strictEqual(candidateItems.length, Object.keys(NS.LANGUAGES).length + 2,
  "every language should be offered, plus (Any) and (None)");
const labelOf = (item) =>
  find(item, (n) => n.props && typeof n.props.children === "string").props.children;
assert.deepStrictEqual(candidateItems.slice(0, 2).map(labelOf), ["(任意)", "(无)"],
  "the modifier entries come first, in Stash's own parenthesised wording, localised");
assert.deepStrictEqual(candidateItems.slice(0, 2).map((i) => i.props.className),
  ["unselected-object modifier-object", "unselected-object modifier-object"],
  "and carry modifier-object, as Stash marks them");
assert.strictEqual(candidateItems.some((i) => labelOf(i) === "日语"), true,
  "and the languages after them");

// Markup details taken from a real studio section, so the two read identically:
// the include icon carries no extra state class, and the row's trailing wrapper
// is present even when there is no button in it.
const jaRow = candidateItems.find((i) => labelOf(i) === "日语");
assert.strictEqual(find(jaRow, (n) => n.type === "Icon").props.className,
  "fa-fw include-button");
const modifierTrailing = find(candidateItems[0], (n) => n.type === "a").props.children[1];
assert.strictEqual(modifierTrailing.type, "div",
  "the trailing wrapper is rendered even when it holds no exclude button — "
  + "the modifier entries have nothing to put in it");
assert.strictEqual(modifierTrailing.props.children, null, "…and it is empty");

// Flags are drawn in the sidebar like everywhere else
assert.strictEqual(NS.showFlags, true, "precondition: flags are on");
assert.ok(
  find(candidateItems.find((i) => labelOf(i) === "日语"),
    (n) => /fi fi-/.test(n.props.className || "")),
  "candidates should carry a flag"
);

// Clicking a language rewrites the URL rather than keeping state of its own
const jaCandidate = candidateItems.find((i) => labelOf(i) === "日语");
historyReplaces.length = 0;
find(jaCandidate, (n) => n.type === "a").props.onClick();
assert.strictEqual(historyReplaces.length, 1, "clicking should apply the filter");
assert.strictEqual(historyReplaces[0].pathname, "/galleries", "on the same page");
assert.ok(/"field":"language","modifier":"EQUALS","value":\["ja"\]/.test(historyReplaces[0].search),
  "and the URL should carry an EQUALS condition for that language");

// The exclude button sits inside the row, so it has to stop the click reaching
// the row's own include handler.
const jaExclude = find(jaCandidate, (n) =>
  n.props && n.props.className === "minimal exclude-button");
assert.ok(jaExclude, "a candidate should offer an exclude button");
assert.strictEqual(find(jaExclude, (n) => n.props.children === "exclude") !== null, true,
  "labelled the way Stash labels it");
historyReplaces.length = 0;
let stopped = false;
jaExclude.props.onClick({ stopPropagation: () => { stopped = true; } });
assert.strictEqual(stopped, true, "the exclude click must stop propagating");
assert.strictEqual(historyReplaces.length, 1, "…and exclude rather than include");
assert.ok(/"modifier":"NOT_EQUALS","value":\["ja"\]/.test(historyReplaces[0].search),
  "the URL should carry a NOT_EQUALS condition");
console.log("✓ sidebar section (placement / native markup / search / candidates / include / exclude)");

// Clicking (Any) asks for galleries that have a language at all
const anyItem = candidateItems.find((i) => labelOf(i) === "(任意)");
historyReplaces.length = 0;
find(anyItem, (n) => n.type === "a").props.onClick();
assert.ok(/"modifier":"NOT_NULL"/.test(historyReplaces[0].search),
  "(Any) should ask for galleries carrying a language");
console.log("✓ sidebar section (modifier entries: any / none)");

// With something selected, it moves above the fold-away list — outside the
// collapse, so it stays visible — and the candidates no longer offer it.
section = renderLanguageFilter([
  conditionsOf("EQUALS", ["ja"]),
  conditionsOf("NOT_EQUALS", ["ko"]),
]);
const selectedList = find(section.node, (n) =>
  n.props && n.props.className === "selected-list");
assert.ok(selectedList, "a chosen language should appear in the selected-list");
assert.strictEqual(section.node.props.children[1], selectedList,
  "the selected list sits outside the collapse, where Stash puts it");
assert.strictEqual(find(selectedList, (n) => n.type === "Icon").props.icon, "faCheckCircle",
  "a chosen entry is ticked");
assert.strictEqual(find(selectedList, (n) => n.props.children === "日语") !== null, true);

// A selected row has no second column, unlike a candidate — checked against a
// real section, where a candidate's <a> holds the exclude button and a chosen
// one holds nothing but its label.
const selectedLink = find(selectedList, (n) => n.type === "a");
/** The children that actually render — a null slot produces nothing */
const renderedChildren = (el) =>
  (Array.isArray(el.props.children) ? el.props.children : [el.props.children])
    .filter((c) => c !== null && c !== undefined);
assert.strictEqual(renderedChildren(selectedLink).length, 1,
  "a chosen row holds only its label group");
assert.strictEqual(renderedChildren(selectedLink)[0].props.className, "label-group");

const remaining = [];
find(find(section.node, (n) =>
  n.props && n.props.className === "queryable-candidate-list"), (n) => {
  if (n.props && /^unselected-object\b/.test(n.props.className)) remaining.push(n);
  return false;
});
assert.strictEqual(remaining.length, Object.keys(NS.LANGUAGES).length - 2,
  "neither chosen language should also be offered as a candidate");
assert.strictEqual(remaining.some((i) => /modifier-object/.test(i.props.className)), false,
  "(Any) and (None) are for the empty state, and those are only offered then");

// Clicking the chosen one clears it
historyReplaces.length = 0;
selectedLink.props.onClick();
assert.ok(/"modifier":"NOT_EQUALS","value":\["ko"\]/.test(historyReplaces[0].search)
  && !/"EQUALS"/.test(historyReplaces[0].search),
  "clicking the chosen language should drop it and leave the excluded one");

// An excluded language goes in its own list, which Stash marks excluded-list
const excludedList = find(section.node, (n) =>
  n.props && n.props.className === "selected-list excluded-list");
assert.ok(excludedList, "an excluded language should get the excluded-list");
assert.strictEqual(find(excludedList, (n) => n.type === "Icon").props.icon, "faTimesCircle",
  "and be marked with a cross rather than a tick");
assert.strictEqual(
  find(excludedList, (n) => n.props.className === "TruncatedText inline excluded-object-label") !== null,
  true,
  "with the excluded label class, as Stash has it"
);
console.log("✓ sidebar section (selected + excluded lists / row shapes / click clears)");

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

  // Follows the UI language, which is Stash's setting rather than the browser's,
  // so the name changes when that changes. (The locale list itself is pinned in
  // section 2; here it is only the visible consequence that matters.)
  currentLocale = "ja-JP";
  assert.strictEqual(badgeOf("1").props["aria-label"], "簡体中国語", "should follow the UI language");
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

  // Options: flag + localised name. The order is asserted in 5b; what matters
  // here is that each option carries both halves of the display.
  const opts = select.props.options;
  const jaOption = opts.find((o) => o.value === "ja");
  assert.strictEqual(jaOption.label, "日语");
  assert.strictEqual(jaOption.flag, "jp");
  assert.strictEqual(opts.some((o) => o.flag === "vn"), true, "the Vietnam flag should be vn");
  assert.strictEqual(opts.every((o) => o.flag && o.flag.length === 2), true, "every option should have a flag");

  // Enabled-languages restriction: the dropdown is limited to the selected set,
  // but the currently-selected value still echoes even if it is outside the set
  // (display is unaffected — only the option list is filtered).
  NS.enabledLanguages = new Set(["ja", "en"]);
  const filtered = find(renderRow({ language: "vi" }), (n) => n.props && n.props.options);
  assert.deepStrictEqual(
    filtered.props.options.map((o) => o.value),
    ["ja", "en"],
    "the dropdown should show only the enabled languages"
  );
  assert.strictEqual(filtered.props.value.value, "vi",
    "a selected value outside the enabled set must still echo (display is unaffected)");
  assert.strictEqual(filtered.props.value.flag, "vn");
  NS.enabledLanguages = null; // restore

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

  // ── 13b. The two display switches, and that they are independent ──
  NS.showFlags = false;

  const formattedFlat = sel.props.formatOptionLabel({ value: "ja", label: "日语", flag: "jp" });
  assert.strictEqual(find(formattedFlat, (n) => /fi fi-/.test(n.props.className || "")), null,
    "the dropdown must not draw a flag when flags are off");
  assert.ok(hasText(formattedFlat, "日语"), "the name must still be there");

  // The space in the detail row belongs to the flag, so it has to go with it.
  const flatDetail = detail({ language: "zh-Hant" });
  assert.strictEqual(find(flatDetail.portal.node, (n) => /fi fi-/.test(n.props.className || "")), null,
    "the detail row must not draw a flag when flags are off");
  assert.deepStrictEqual(
    flatDetail.portal.node.props.children.filter((c) => typeof c === "string"),
    ["语言: ", "繁体中文"],
    "without a flag there must not be a double space"
  );

  // The badge survives flags being off: it falls back to the name chip. That
  // combination is exactly why the two switches are independent — the flag
  // mapping is lossy, so a name can be preferable without losing the badge.
  assert.strictEqual(card("1").type, React.Fragment, "the badge should survive flags being off");
  const flatBadge = badgeOf("1");
  assert.strictEqual(flatBadge.props.className, "manga-tools-badge is-unknown",
    "a recognised language falls back to the text chip");
  assert.strictEqual(flatBadge.props.children, "简体中文", "showing the localised name");
  assert.strictEqual(flagOf("1"), null, "and no flag element inside it");

  NS.showFlags = true;
  assert.strictEqual(flagOf("1").props.className, "fi fi-cn", "the flag comes back");

  // The cover badge turns off on its own, whatever the flags setting says.
  NS.showCoverBadge = false;
  assert.strictEqual(card("1").type, original, "no badge at all when the cover badge is off");
  assert.strictEqual(card("3").type, original, "and none for an unknown value either");

  NS.showFlags = false;
  assert.strictEqual(card("1").type, original, "nor with both switches off");

  NS.showCoverBadge = true;
  NS.showFlags = true;
  assert.strictEqual(card("1").type, React.Fragment, "restored");
  console.log("✓ display switches (flags off = names only / badge off / independent)");

  // ── 14. Bulk edit dialog: the language row rides along with Apply ──
  // This runs here rather than with the other synchronous sections because the
  // row's prefill comes from the plugin's gallery store, which only has data once
  // the refresh promise has settled.
  //
  // Stand in for EditGalleriesDialog's form: BulkUpdateFormGroup renders each row
  // as a Bootstrap `.row` carrying data-field, so that is the anchor.
  const bulkForm = makeEl("form");
  documentRoot.appendChild(bulkForm);

  const bulkStudioRow = makeEl("div");
  bulkStudioRow.className = "row";
  bulkStudioRow.dataset.field = "studio";
  const bulkStudioLabel = makeEl("label");
  bulkStudioLabel.className = "col-form-label col-3";
  const bulkStudioControl = makeEl("div");
  bulkStudioControl.className = "col-9";
  bulkStudioRow.appendChild(bulkStudioLabel);
  bulkStudioRow.appendChild(bulkStudioControl);
  bulkForm.appendChild(bulkStudioRow);

  const bulkPerformerRow = makeEl("div");
  bulkPerformerRow.className = "row";
  bulkPerformerRow.dataset.field = "performers";
  bulkForm.appendChild(bulkPerformerRow);

  // The selection is read from GalleryList, which the plugin observes rather
  // than replaces.
  const selectGalleries = (ids) =>
    patchedBefore["GalleryList"]({ selectedIds: new Set(ids) }, undefined);

  // The row is mounted by the RatingSystem patch; render the fragment it returns
  // and follow the portal it makes.
  const bulkRow = () => {
    const frag = call("RatingSystem", { value: 0 });
    const rowEl = frag.props.children[1];
    return rowEl.type(rowEl.props);
  };
  const bulkSelectOf = () =>
    find(bulkRow().node, (n) => n.props && n.props.inputId === "manga_tools_language");

  let b14 = bulkRow();
  assert.strictEqual(b14.__portal, true, "the bulk row should render through a portal");

  const bulkHost = bulkForm.children[1];
  assert.strictEqual(bulkHost.className, "manga-tools-field-host");
  assert.strictEqual(bulkHost.previousElementSibling, bulkStudioRow,
    "the row should go right after the studio row");
  assert.strictEqual(bulkHost.nextElementSibling, bulkPerformerRow,
    "and right before the performers row — i.e. between studio and performers");
  assert.strictEqual(b14.host, bulkHost);

  // Structure and classes are copied from the native row, so it lines up with it
  const bulkNode = b14.node;
  assert.strictEqual(bulkNode.props.className, "row");
  assert.strictEqual(bulkNode.props["data-field"], "manga_tools_language");
  assert.strictEqual(bulkNode.props.children[0].props.className, "col-form-label col-3",
    "the label classes should be copied from the native row");
  assert.strictEqual(bulkNode.props.children[0].props.children, "语言");

  // Like the studio field: one value per gallery, cleared with the selector's own
  // x. No extra button, and no way to blank the field across a selection.
  assert.strictEqual(bulkSelectOf().props.isClearable, true);
  assert.strictEqual(
    find(bulkNode, (n) => n.props && n.props["aria-pressed"] !== undefined), null,
    "there should be no separate clear button");
  assert.strictEqual(bulkSelectOf().props.menuPortalTarget, global.document.body,
    "the menu has to escape the modal");

  // ── Prefill from the selection, the way the studio field does ──
  // Gallery 1 and 6 are zh-Hans, 2 is zh-Hant, 4 has no language field at all.
  selectGalleries(["1", "6"]);
  assert.strictEqual(bulkSelectOf().props.value.value, "zh-Hans",
    "the whole selection agreeing should prefill that language");
  assert.strictEqual(bulkSelectOf().props.value.label, "简体中文", "in the UI language");

  selectGalleries(["1", "2"]);
  assert.strictEqual(bulkSelectOf().props.value, null, "a mixed selection must not prefill");
  assert.strictEqual(bulkSelectOf().props.placeholder, "Select language…");

  selectGalleries(["1", "4"]);
  assert.strictEqual(bulkSelectOf().props.value, null,
    "a gallery with no language counts as differing, not as a match");

  selectGalleries([]);
  assert.strictEqual(bulkSelectOf().props.value, null, "nothing selected, nothing to prefill");

  // ── Apply: the picked language rides along with the dialog's own update ──
  /** Runs an operation through the plugin's link and reports what came out */
  const runLink = (variables, rootField) => {
    let forwarded = null;
    let completed = null;
    const forward = (op) => {
      forwarded = op;
      return {
        map(fn) {
          completed = fn({ data: {} });
          return this;
        },
      };
    };
    installedLink.__chain[0].request(
      {
        query: {
          kind: "Document",
          definitions: [
            {
              kind: "OperationDefinition",
              selectionSet: {
                selections: [{ name: { value: rootField ?? "bulkGalleryUpdate" } }],
              },
            },
          ],
        },
        variables,
      },
      forward
    );
    return { forwarded, completed };
  };

  const bulkVars = () => ({ input: { ids: ["1", "2"], photographer: "x" } });

  // The link is installed the first time the row renders, and must not disturb
  // the chain Stash already had.
  assert.ok(installedLink, "the bulk row should install the link hook");
  assert.strictEqual(installedLink.__chain[1].__original, true,
    "the existing link chain must be passed through untouched");

  // Untouched: the operation must go out exactly as Stash built it.
  let r14 = runLink(bulkVars());
  assert.strictEqual(r14.forwarded.variables.input.custom_fields, undefined,
    "an untouched row must not add custom_fields");
  assert.strictEqual(r14.completed, null, "nothing to clear when nothing was injected");

  const queriesBefore = galleryQueryCount;
  bulkSelectOf().props.onChange({ value: "zh-Hant", label: "繁体中文", flag: "tw" });
  assert.strictEqual(bulkSelectOf().props.value.value, "zh-Hant", "the row should echo the pick");

  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields,
    { partial: { language: "zh-Hant" } },
    "the picked language should ride along with the dialog's own update");
  assert.deepStrictEqual(r14.forwarded.variables.input.ids, ["1", "2"],
    "the rest of the input must be left alone");
  assert.strictEqual(r14.forwarded.variables.input.photographer, "x");
  assert.strictEqual(r14.completed !== null, true,
    "a successful update should clear the pending value");

  // ...and once cleared, a second Apply must not repeat it.
  r14 = runLink(bulkVars());
  assert.strictEqual(r14.forwarded.variables.input.custom_fields, undefined,
    "the value should only ever be sent once");

  // Other entities' bulk updates must never be touched, even with a value pending.
  bulkSelectOf().props.onChange({ value: "ja", label: "日语", flag: "jp" });
  r14 = runLink(bulkVars(), "bulkSceneUpdate");
  assert.strictEqual(r14.forwarded.variables.input.custom_fields, undefined,
    "a scene bulk update must not be given a language");

  // ...and the value survives that, so it is still applied to the right operation.
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields,
    { partial: { language: "ja" } });

  // Clearing the x means "leave the language alone", exactly as clearing the
  // studio field means "leave the studio alone" — neither sends a value.
  bulkSelectOf().props.onChange(null);
  r14 = runLink(bulkVars());
  assert.strictEqual(r14.forwarded.variables.input.custom_fields, undefined,
    "clearing must not write anything");
  assert.strictEqual(r14.completed, null);

  // The route is checked by the injection itself, not only by the row being
  // mounted: a value left pending must not be written once the route has moved on.
  bulkSelectOf().props.onChange({ value: "ko", label: "韩语", flag: "kr" });
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields,
    { partial: { language: "ko" } },
    "precondition: it does apply while on a gallery page");

  bulkSelectOf().props.onChange({ value: "ko", label: "韩语", flag: "kr" });
  globalListeners["stash:location"]({ detail: { data: { location: { pathname: "/scenes/5" } } } });
  r14 = runLink(bulkVars());
  assert.strictEqual(r14.forwarded.variables.input.custom_fields, undefined,
    "a pending value must never be written once the route has left the galleries");

  // Off a gallery page there is no row at all
  const onScene14 = call("RatingSystem", { value: 0 });
  assert.strictEqual(onScene14.props.children[1].type(onScene14.props.children[1].props), null,
    "no bulk language row on a scene page");
  globalListeners["stash:location"]({ detail: { data: { location: { pathname: "/galleries" } } } });
  assert.notStrictEqual(bulkRow(), null, "restored on a gallery page");
  console.log("✓ bulk edit (placement / prefill / partial set / clear / scene isolation / one-shot / route)");

  // The badges read the plugin's own store, so a successful write refetches it —
  // otherwise the covers keep the old flag until the next poll. That refetch is
  // deliberately deferred until any fetch already in flight has settled (a fetch
  // started before the write would otherwise land afterwards and undo it), so the
  // count can only be checked once the microtask queue has drained.
  setTimeout(() => {
    assert.strictEqual(galleryQueryCount, queriesBefore + 1,
      "a successful bulk update should refetch the gallery map, so the badges update");
    console.log("✓ bulk edit refetch (deferred past the in-flight fetch)");

    console.log("\nAll smoke tests passed");
  }, 0);
}, 10);
