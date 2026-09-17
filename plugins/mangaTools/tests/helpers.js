/* Manga Tools smoke test: the stubs, the fixtures, and the loaded bundle */
//
// Everything the section files share. They are separate modules that see this
// one and nothing else of each other, which is why what the tests *move* sits in
// the `state` object below rather than in a variable each file would keep its
// own copy of.
//
// The bundle is what is loaded, not the TypeScript sources, so these exercise
// exactly what gets published and a broken build shows up here. This directory
// sits beside src/ and build/ under plugins/mangaTools/, so the path below
// reaches the build output by relative position alone.
const path = require("node:path");
const assert = require("node:assert");

const PLUGIN = path.join(__dirname, "..", "build");

// ── Stubs ──────────────────────────────────────────────────────────
const globalListeners = {};
const patched = {};
const patchedBefore = {};
const patchedAfter = {};

/**
 * What the tests and the stubs both move.
 *
 * The stubs read these when they are called rather than capturing them when they
 * are built, which is what lets a test turn a switch — the locale, the tags the
 * DOM query answers with — and see the next render honour it. They sit in one
 * object because a test file is its own module now: a shared variable would be a
 * copy per file, and a test setting its own copy would leave the stub reading
 * the original, quietly asserting nothing.
 */
const state = {
  /** The UI language Stash reports, which the plugin's own strings follow */
  currentLocale: "zh-CN",
  /** How many times the plugin asked for the gallery map — used to prove a
   *  successful bulk update triggers a refresh (and that a no-op one does not) */
  galleryQueryCount: 0,
  /** The last configurePlugin write, captured by the stub */
  capturedConfigWrite: null,
  /** When set, the gallery update the toolbar switch sends rejects with this */
  galleryWriteResult: null,
  /**
   * When true, StashService.getClient throws — a Stash whose client is not there
   * yet. The plugin's writes then have nowhere to go, and what it does about that
   * is what 14c checks.
   */
  clientMissing: false,
  /** The link hook the bulk rows install, once they have */
  installedLink: null,
  /** What the DOM stub's querySelectorAll answers with, per test */
  tagQuery: () => [],
  /** Whether the platform's Intl.DisplayNames is made to throw */
  displayNamesThrows: false,
};

/**
 * Fault injection for the patch *registration* API, not for the callbacks.
 *
 * Set to a target name before the bundle loads, and the stub throws when the
 * plugin tries to register that one — which is the shape of a Stash whose
 * `PluginApi.patch` does not have the method the plugin is calling. What the
 * test then checks is that the patches *below* it still registered.
 */
let patchRegistrationFault = null;
const patchRegistrationFaultError = new Error("no such patch method");
const capturedQueries = [];
const settingsEnabled = ""; // what the config endpoint reports for the setting

const React = {
  Fragment: Symbol("Fragment"),
  // Matches React: createElement only builds an element, it does not call the
  // component function, and a single child is not wrapped in an array.
  createElement: (type, props, ...children) => {
    const next = Object.assign({}, props);
    if (children.length === 1) next.children = children[0];
    else if (children.length > 1) next.children = children;
    return { type, props: next };
  },
  // Matches React in the one way that matters here: a function argument is a
  // lazy initialiser and gets called, not stored. The setter is inert — nothing
  // in these tests can change state and read the result back.
  useState: (init) => [typeof init === "function" ? init() : init, () => {}],
  // Only the experiment's error boundary derives from this. The stub renders
  // nothing, so the lifecycle is never exercised — what matters is only that
  // `class X extends React.Component` is legal when the bundle loads.
  Component: class {
    constructor(props) {
      this.props = props || {};
      this.state = {};
    }
  },
  // Effects are run immediately. The plugin uses them for mount-time work (the
  // bulk dialog's link hook-up), so an inert stub would never exercise it.
  // Cleanups are discarded: nothing in these tests unmounts a component.
  useEffect: (fn) => {
    fn();
  },
  // Layout effects are the same thing to a stub with no browser to paint: what
  // the plugin relies on is *when* React flushes them, which is not observable
  // here. What matters for these tests is that the callback runs.
  useLayoutEffect: (fn) => {
    fn();
  },
  // A ref that never gets filled: nothing here mounts a real element, so
  // `current` stays null and code that focuses it quietly does nothing.
  useRef: (init) => ({ current: init }),
};

/** The chain the plugin installed via setLink, captured by the client stub */

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
      // `this.criteria`, not the array it was built with: a model can be
      // re-configured from a query string, and Stash clones its own state.
      return makeFilterModel(
        this.criteria.map((c) => ({
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

/** Every mutation the plugin sent through the client, whole — see fakeClient.mutate */
const mutationWrites = [];

/** Every query the plugin sent, with the fetch policy it asked for */
const queryOptions = [];

/** A custom-fields criterion holding the given conditions */
const customFieldsCriterion = (conditions) => ({
  criterionOption: { type: "custom_fields" },
  value: conditions,
});

// What each gallery carries, whole. Both map queries answer with the complete
// map — the GraphQL Map scalar is all of it or none of it — so the field a query
// filtered on decides only *which* galleries come back, never what they carry.
const MANGA = "plugin.mangaTools.manga";

/**
 * The same map with the mark that makes a gallery manga.
 *
 * Every fixture below is a manga gallery unless it says otherwise, because that
 * is the only kind the plugin draws anything on — the mark is its entry point.
 * The cases that are *not* manga say so by not using this.
 */
const asManga = (fields) => ({ [MANGA]: "true", ...fields });

const GALLERY_FIELDS = {
  1: {
    [MANGA]: "true",
    "plugin.mangaTools.language": "zh-Hans",
    "plugin.mangaTools.censorship": "censored",
  },
  // capitalised key, canonical value
  2: { [MANGA]: "true", "plugin.mangaTools.Language": "zh-Hant" },
  3: {
    [MANGA]: "true",
    "plugin.mangaTools.language": "klingon", // unknown value
    "plugin.mangaTools.Censorship": "uncensored", // capitalised key again
  },
  4: {
    [MANGA]: "true",
    other: "x", // not ours, must be left alone
    "plugin.mangaTools.censorship": "maybe", // neither value, so unmarked
  },
  5: { [MANGA]: "true", "plugin.mangaTools.language": "ZH-HANS" },
  6: { [MANGA]: "true", "plugin.mangaTools.language": "zh-Hans" },
  7: { [MANGA]: "true", "plugin.mangaTools.censorship": "uncensored" },
  // Carries a language and nothing else: not manga, so the plugin must leave it
  // entirely alone — no badge, no card mark, no block on its detail page.
  8: { "plugin.mangaTools.language": "ja" },
};

/**
 * The one query's answer: the galleries marked as manga, with their whole map.
 *
 * One list now, and one query. The plugin asks for galleries carrying the mark and
 * gets their entire custom_fields back — so a gallery found this way brings its
 * language and its censorship value with it, and a gallery without the mark is in
 * nobody's answer. Gallery 8 is the case that proves it: it has a language, and
 * the plugin never sees it.
 */
const galleryAnswer = (ids) =>
  ids.map((id) => ({ id: String(id), custom_fields: GALLERY_FIELDS[id] }));

const MANGA_GALLERIES = galleryAnswer([1, 2, 3, 4, 5, 6, 7]);

const fakeClient = {
  // Stands in for Stash's existing link chain, which setLink must pass through.
  link: { __original: true },
  setLink(link) {
    this.link = link;
    state.installedLink = link;
  },
  // The plugin's own mutation, which the mark writes through. Recorded whole —
  // document and variables — because the document is the point: what a mutation
  // *asks for* is what Apollo writes into its cache, and the mark has to ask for
  // nothing (`{ id }`) to leave the page's gallery alone.
  mutate: ({ mutation, variables }) => {
    // The document is kept as it was handed over rather than as text: whether it
    // went through `gql` is what one of the assertions is about. `String()` on it
    // still answers with the query text, for the assertions about its shape.
    mutationWrites.push({ mutation, variables });
    return state.galleryWriteResult
      ? Promise.reject(state.galleryWriteResult)
      : Promise.resolve({
          data: { galleryUpdate: { id: variables?.input?.id } },
        });
  },
  query: ({ query, fetchPolicy }) => {
    queryOptions.push({ query: String(query), fetchPolicy });
    // The plugin fires three queries: one gallery map per custom field
    // (findGalleries) and the settings (configuration { plugins }). Branch on
    // the query text — the field name is the only thing that tells the two
    // gallery queries apart.
    if (/configuration/.test(String(query))) {
      return Promise.resolve({
        data: {
          configuration: {
            plugins: { mangaTools: { enabledLanguages: settingsEnabled } },
          },
        },
      });
    }

    state.galleryQueryCount += 1;

    return Promise.resolve({
      data: {
        findGalleries: {
          count: MANGA_GALLERIES.length,
          galleries: MANGA_GALLERIES,
        },
      },
    });
  },
};

// ── Minimal DOM stub: only the methods the mount points actually use ──

/** data-some-name -> dataset.someName, the way the DOM does it */
const datasetKey = (name) =>
  name.replace(/-([a-z])/g, (_m, ch) => ch.toUpperCase());

/** The toolbar galleryToolbarDom() last put in the document */
let mountedToolbar = null;

/**
 * The part of a gallery page's toolbar the plugin hangs itself on.
 *
 * Stash's toolbar is a group holding the span with the organized button, then
 * the span with the operation menu — and the switch's host goes between the two,
 * so a test needs both to tell "in the right place" from "somewhere in the
 * toolbar". Appended to the document, since the host is found by searching it.
 *
 * Any toolbar this put there before is taken out first: a page has one, the
 * plugin looks for *the* toolbar, and a second one left behind would quietly
 * become the one it mounts into.
 */
function galleryToolbarDom() {
  if (mountedToolbar) documentRoot.removeChild(mountedToolbar);

  const toolbarEl = makeEl("div");
  toolbarEl.className = "gallery-toolbar";
  const toolbarGroup = makeEl("span");
  toolbarGroup.className = "gallery-toolbar-group";
  const organizedSpan = makeEl("span");
  const organizedButton = makeEl("button");
  organizedButton.className =
    "minimal organized-button organized btn btn-secondary";
  organizedSpan.appendChild(organizedButton);
  const menuSpan = makeEl("span");
  toolbarGroup.appendChild(organizedSpan);
  toolbarGroup.appendChild(menuSpan);
  toolbarEl.appendChild(toolbarGroup);
  documentRoot.appendChild(toolbarEl);
  mountedToolbar = toolbarEl;

  return { toolbarEl, toolbarGroup, organizedSpan, organizedButton, menuSpan };
}

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
    // The plugin takes its own row away with removeChild; the fake tree carries
    // detach for the stub's own use.
    removeChild(child) {
      el.detach(child);
      return child;
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.detach(child);
      el.children.push(child);
      child.parentNode = el;
      return child;
    },
    // Real elements have attributes, and this stub had only the two the plugin
    // used to touch — className and dataset. The tab injector sets more of them
    // (role, aria-selected, data-rb-event-key, href), so it gets a store. `data-*`
    // is mirrored into dataset and `class` into className, which is what
    // querySelector below reads — so the two representations never disagree.
    attributes: {},
    listeners: {},
    text: "",
    setAttribute(name, value) {
      el.attributes[name] = String(value);
      if (name === "class") el.className = String(value);
      const m = /^data-(.+)$/.exec(name);
      if (m) el.dataset[datasetKey(m[1])] = String(value);
    },
    getAttribute(name) {
      return name in el.attributes ? el.attributes[name] : null;
    },
    // The injector writes a tab's label as text rather than as a child element,
    // because the nav item it builds is not React's and has no component to
    // render. One string, so one property is enough.
    get textContent() {
      return el.text;
    },
    set textContent(value) {
      el.text = String(value);
      el.children.length = 0;
    },
    addEventListener(name, fn) {
      el.listeners[name] = fn;
    },
    // Enough of an event for the plugin's preventDefault guard, which checks for
    // it because a listener can be handed a non-event in a test.
    click() {
      if (el.listeners.click) el.listeners.click({ preventDefault: () => {} });
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
    // The plugin asks the mount point it made to carry a class or not, which a
    // real node answers with a class list. It reads and writes `className` — the
    // same property the assertions read — so the two cannot disagree, as with
    // `class` and `data-*` on setAttribute above.
    get classList() {
      const names = () => el.className.split(/\s+/).filter(Boolean);
      const write = (list) => {
        el.className = list.join(" ");
      };
      return {
        contains: (name) => names().indexOf(name) !== -1,
        add(name) {
          if (names().indexOf(name) === -1) write(names().concat([name]));
        },
        remove(name) {
          write(names().filter((n) => n !== name));
        },
        toggle(name, force) {
          const has = names().indexOf(name) !== -1;
          const want = force === undefined ? !has : force;
          if (want && !has) write(names().concat([name]));
          else if (!want && has) write(names().filter((n) => n !== name));
          return want;
        },
      };
    },
    // The tag helpers ask a row which tags are inside it. This stub keeps no
    // classes of its own, so it answers with nothing — and the plugin then makes
    // the row it keeps for itself, which is what the assertions below reach for.
    querySelectorAll: () => [],
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
    // Only a few selector shapes are supported — which is all these tests need,
    // and it stays that way deliberately rather than growing into a selector
    // engine:
    //
    //   .cls                     a class
    //   .cls .cls                a class inside a class (the filter dialog's row)
    //   .cls[data-field=...]     a class plus a data attribute
    //   [data-*=...]             a data attribute alone — the bulk dialog's
    //                            anchor, whose rows are Bootstrap `.row` divs
    //                            with no class of Stash's own
    //   tag[data-*=...]          a tag plus a data attribute — how the tab
    //                            injector finds Stash's own tab anchors, which it
    //                            matches by `data-rb-event-key`
    //   tag                      a bare tag name
    //
    // Any data-* attribute is matched, not just data-field, because the
    // censorship mark finds its card's row by the gallery id on its anchor.
    querySelector(sel) {
      const mDesc = /^\.([\w-]+) \.([\w-]+)$/.exec(sel);
      if (mDesc) {
        const outer = el.querySelector("." + mDesc[1]);
        return outer ? outer.querySelector("." + mDesc[2]) : null;
      }

      const mAttr = /^\.([\w-]+)(?:\[data-field="([^"]+)"\])?$/.exec(sel);
      const mData = /^\[data-([\w-]+)="([^"]+)"\]$/.exec(sel);
      const mTagData = /^([a-z]+)\[data-([\w-]+)="([^"]+)"\]$/.exec(sel);
      const mTag = /^([a-z]+)$/.exec(sel);
      if (!mAttr && !mData && !mTagData && !mTag) return null;

      const matches = (c) => {
        if (mData) {
          return c.dataset[datasetKey(mData[1])] === mData[2];
        }
        if (mTagData) {
          return (
            c.tagName === mTagData[1] &&
            c.dataset[datasetKey(mTagData[2])] === mTagData[3]
          );
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
    "actions.clear": "清除",
    "actions.exclude_lowercase": "排除",
    "criterion_modifier_values.any": "任意",
    "criterion_modifier_values.none": "无",
    // The pieces Stash composes a criterion's tag from. Its real strings are
    // "is" / "is not null"; these stand in so the composition can be asserted.
    "criterion_modifier.format_string":
      "{criterion} {modifierString} {valueString}",
    "criterion_modifier.format_string_excludes":
      "{criterion} {modifierString} {valueString} (excludes {excludedString})",
    "criterion_modifier.equals": "是",
    "criterion_modifier.not_equals": "不是",
    "criterion_modifier.is_null": "为空",
    "criterion_modifier.not_null": "不为空",
    // A boolean criterion's two values, which the manga section takes from Stash
    // rather than writing itself. English is deliberately left out below: Stash's
    // own en-US.json has no such message either, which is why its organized
    // section shows the bare id there — and why this plugin hands formatMessage a
    // fallback.
    true: "是",
    false: "否",
  },
  "zh-TW": {
    "config.ui.language.heading": "語言",
    "actions.search": "搜尋",
    true: "是",
    false: "否",
    "actions.clear": "清除",
    "criterion_modifier_values.any": "任意",
    "criterion_modifier_values.none": "無",
  },
  "en-US": {
    "config.ui.language.heading": "Language",
    "actions.search": "Search",
    "actions.clear": "Clear",
    "criterion_modifier_values.any": "Any",
    "criterion_modifier_values.none": "None",
  },
  "ja-JP": {
    "config.ui.language.heading": "言語",
    "actions.search": "検索",
    "actions.clear": "クリア",
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
  // Stash registers every patchable component here as its module loads; the
  // plugin looks one of them up to check the sidebar's patch container exists.
  components: {
    Icon: "Icon",
    "FilteredGalleryList.SidebarSections":
      "FilteredGalleryList.SidebarSections",
  },
  libraries: {
    Apollo: {
      gql: (text) => {
        capturedQueries.push(text);
        // A document, not the text it was built from. Apollo takes a DocumentNode,
        // and a plugin that hands it a raw string gets a rejected promise with
        // nothing useful in it — so wrapping here is what lets a test tell the two
        // apart. `String()` still answers with the text, which is how the
        // assertions about a query's shape read it.
        return { __document: text, toString: () => text };
      },
      // Enough of ApolloLink to compose and invoke a chain: the instance keeps
      // its request function, and from() records the links it was given.
      ApolloLink: (() => {
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
      // The dialog, with the two static sub-components the plugin uses. An object
      // rather than a marker string, because a string cannot carry properties —
      // and the plugin checks for both before drawing anything.
      Modal: { Body: "ModalBody", Footer: "ModalFooter" },
      FormGroup: "FormGroup",
      Row: "Row",
      Col: "Col",
    },
    ReactSelect: { default: "Select" },
    Intl: {
      useIntl: () => ({
        locale: state.currentLocale,
        // Stands in for Stash's react-intl: a hit in the locale files returns the
        // translation, otherwise defaultMessage is used.
        formatMessage: ({ id, defaultMessage }, values) => {
          const text = MESSAGES[state.currentLocale]?.[id] || defaultMessage;
          if (!values || typeof text !== "string") return text;
          // Enough of ICU for the messages the plugin reads: {name} placeholders.
          return text.replace(/\{(\w+)\}/g, (whole, name) =>
            name in values ? String(values[name]) : whole
          );
        },
      }),
    },
    FontAwesomeSolid: {
      faMinus: "faMinus",
      faPlus: "faPlus",
      faChevronDown: "faChevronDown",
      faChevronRight: "faChevronRight",
      faCheckCircle: "faCheckCircle",
      faTimesCircle: "faTimesCircle",
      // The censorship trio. Names rather than definitions, so a test can
      // assert which icon a state was given.
      faChessPawn: "faChessPawn",
      faChessKnight: "faChessKnight",
      faChessBoard: "faChessBoard",
    },
    FontAwesomeRegular: { faTimesCircle: "faTimesCircle(regular)" },
    // Captured so a test can assert the URL the filter pushes.
    ReactRouterDOM: {
      useHistory: () => fakeHistory,
    },
  },
  utils: {
    StashService: {
      // The switch writes through its own mutation on this client (see
      // MARK_QUERY_TEXT), not through Stash's useGalleryUpdate — so the client is
      // all a stub here has to provide.
      getClient: () => {
        if (state.clientMissing) throw new Error("no client yet");
        return fakeClient;
      },
      useConfigurePlugin: () => [
        (opts) => {
          state.capturedConfigWrite = opts.variables;
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
      if (patchRegistrationFault === target) throw patchRegistrationFaultError;
      patchedBefore[target] = fn;
    },
    instead: (target, fn) => {
      if (patchRegistrationFault === target) throw patchRegistrationFaultError;
      patched[target] = fn;
    },
    after: (target, fn) => {
      if (patchRegistrationFault === target) throw patchRegistrationFaultError;
      patchedAfter[target] = fn;
    },
  },
};

global.window = {
  location: { pathname: "/galleries" },
  setInterval: () => 0,
  // Reported as a fine pointer, so the focus code runs rather than being skipped
  // as it would be on a touch device.
  matchMedia: () => ({ matches: false }),
};
// The plugin watches the DOM for the filter dialog's card, because opening it is
// Stash's state change and React never reports it — see the observer in
// dialog-filter.tsx. There are no mutations to observe here, and the state
// setters below are inert, so this records the wiring and nothing more: which
// node is watched, and whether the callback survives being called.
const observed = [];
global.MutationObserver = function MutationObserver(callback) {
  this.callback = callback;
  // The callback is kept as well as the wiring, so a test can fire the observer
  // where the mutation it watches for cannot be provoked through the stub — the
  // tab injector watches for a class React changes on its own re-render.
  this.observe = (target, options) =>
    observed.push({ target, options, callback });
  this.disconnect = () => {};
};

/** Clicks the plugin listens for, captured the way a real document would */
const capturedClicks = [];

global.document = {
  visibilityState: "visible",
  body: documentRoot,
  createElement: makeEl,
  querySelector: (sel) => documentRoot.querySelector(sel),
  // The fake DOM runs no selectors beyond the handful querySelector above
  // understands, so a test sets the tags this should return and asserts on what
  // the plugin did with them. Defaults to none, so every other render is inert.
  querySelectorAll: (sel) => state.tagQuery(sel),
  addEventListener: (name, fn, capture) =>
    capturedClicks.push({ name, fn, capture }),
  removeEventListener: () => {},
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
    "en-US": "Japanese",
    en: "Japanese",
    "zh-CN": "日语",
    "zh-TW": "日文",
    "ja-JP": "日本語",
    "de-DE": "Japanisch",
  },
  "zh-Hans": {
    "en-US": "Simplified Chinese",
    en: "Simplified Chinese",
    "zh-CN": "简体中文",
    "zh-TW": "簡體中文",
    "ja-JP": "簡体中国語",
    "de-DE": "Chinesisch (vereinfacht)",
  },
  "zh-Hant": {
    "en-US": "Traditional Chinese",
    en: "Traditional Chinese",
    "zh-CN": "繁体中文",
    "zh-TW": "繁體中文",
    "ja-JP": "繁体中国語",
    "de-DE": "Chinesisch (traditionell)",
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
for (const code of Object.keys(FAKE_NAMES)) {
  for (const loc of Object.keys(FAKE_NAMES[code])) FAKE_LOCALES.add(loc);
}

/** Every construction the plugin performed: { locales, options } */
const displayNamesCalls = [];
/** Set by a test to make every construction throw, as a malformed tag would */

function FakeDisplayNames(locales, options) {
  if (state.displayNamesThrows) throw new RangeError("malformed language tag");
  this.locales = locales;
  this.options = options;
  this.resolvedLocale =
    locales.find((l) => FAKE_LOCALES.has(l)) || locales[locales.length - 1];
  displayNamesCalls.push({ locales: locales.slice(), options });
}
// of() echoes a code it cannot resolve, exactly as the real implementation does
FakeDisplayNames.prototype.of = function (code) {
  const perLocale = FAKE_NAMES[code];
  return perLocale?.[this.resolvedLocale] || code;
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

/**
 * Every line the plugin sends to `console.error`, in order.
 *
 * A few of its failures have no other symptom. A write that never left is
 * indistinguishable from one that was sent, from the outside: both leave the
 * store as the click set it, and both refetch. The line it prints is the whole
 * of the difference, so it is worth being able to assert on.
 *
 * Recorded *and* forwarded — a failure a human needs to see must still read the
 * way it did before there was a spy here.
 */
const loggedErrors = [];
const realConsoleError = console.error;
console.error = (...args) => {
  loggedErrors.push(args.map((a) => String(a)).join(" "));
  realConsoleError.apply(console, args);
};

const BUNDLE = require.resolve(path.join(PLUGIN, "mangaTools.js"));

// One load with a registration faulted, to check the plugin survives it, and
// then one clean load that every other assertion in the suite runs against.
//
// The plugin registers its patches at load time, top to bottom. If one of those
// calls throws — a Stash whose PluginApi.patch is missing a method, say — then
// without the try/catch in registerPatch the module would stop there and every
// patch *below* it would silently never register. That is the failure this
// checks for, and it can only be provoked at load time, which is why it happens
// here rather than beside the other patch assertions.
patchRegistrationFault = "GalleryCard.Overlays";
require(BUNDLE);
patchRegistrationFault = null;

for (const t of [
  "GalleryCard.Popovers",
  "CustomFieldsInput",
  "CustomFieldInput",
  "CustomFields",
  "PluginSettings",
  "RatingSystem",
]) {
  assert.ok(
    patchedAfter[t] || patched[t],
    `a patch that could not be registered must not stop the ones after it: ${t}`
  );
}
assert.ok(
  !patchedAfter["GalleryCard.Overlays"],
  "the faulted patch really did fail to register"
);
console.log("✓ patch registration (one failing does not stop the rest)");

// Re-load for real. The three maps are cleared first so nothing the faulted load
// left behind can satisfy an assertion below.
for (const map of [patched, patchedBefore, patchedAfter]) {
  for (const k of Object.keys(map)) delete map[k];
}
delete require.cache[BUNDLE];
require(BUNDLE);

const NS = global.window.MangaTools;
const original = (props) => ({ type: "ORIGINAL", props });
const call = (target, props) => patched[target](props, undefined, original);
const call2 = (target, props) => patched[target](props, original);

/**
 * Invokes an `after` patch the way Stash does: the original arguments first, then
 * what everything before the patch produced.
 *
 * `substrate` stands in for Stash's own output — the studio overlay on a gallery
 * card, the rating control on a detail page. Passed back by identity so a test
 * can tell "the plugin added nothing" (the same object comes out) from "the
 * plugin wrapped it" without either side having to guess at a shape.
 */
const callAfter = (target, props, substrate) =>
  patchedAfter[target](props, substrate);

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
  return find(node.props?.children, pred);
}

// ── Filter fixtures ────────────────────────────────────────────────
// The shape of a selection, and the condition each of the three fields writes.
// They live here rather than beside the assertions that use them because all
// three filter sections build on the same two.

const sel = (modifier, included, excluded) => ({
  modifier: modifier || "",
  included: included || [],
  excluded: excluded || [],
});

const conditionsOf = (modifier, value) => {
  const c = { field: "plugin.mangaTools.language", modifier };
  if (value !== undefined) c.value = value;
  return c;
};

const censorshipConditionsOf = (modifier, value) => {
  const c = { field: "plugin.mangaTools.censorship", modifier };
  if (value !== undefined) c.value = value;
  return c;
};

const mangaConditionsOf = (modifier) => ({
  field: "plugin.mangaTools.manga",
  modifier,
});

/**
 * A stand-in for one of Stash's tags: the text node holding the label, the
 * attributes the tag helpers use, and `closest` answered from the list of
 * selectors it sits inside. Set as what the document stub hands back from
 * `querySelectorAll` — see `state.tagQuery` — and asserted on afterwards.
 */
const tagWithText = (value, ancestors = []) => {
  const attributes = {};
  const tag = {
    firstChild:
      value === null
        ? { nodeType: 1, nodeValue: null }
        : { nodeType: 3, nodeValue: value },
    style: {},
    // How many times the plugin wrote to this tag. The wording and the attribute
    // recording it are written together, and only when the text actually changes,
    // so this is what "left the DOM alone" can be asserted on.
    writes: 0,
    closest: (sel) => (ancestors.indexOf(sel) === -1 ? null : {}),
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    setAttribute: (name, v) => {
      attributes[name] = v;
      tag.writes += 1;
    },
    hasAttribute: (name) => name in attributes,
    attributes,
  };
  return tag;
};

// ── The runner's bookkeeping ───────────────────────────────────────
// What each section threw, if anything. One failing must not stop the ones
// after it: the sections are independent, and a run that stops at the first
// failure says that something is wrong, not everything that is.

const failures = [];

/**
 * Whether the tally has been printed already.
 *
 * A section whose check lives in a nested timer can land after it — which is how
 * a run can end with "All smoke tests passed" printed over a failing assertion,
 * the exit code being the only thing that disagrees. A failure arriving late is
 * announced as such, and the tally is said again.
 */
let summaryPrinted = false;

/** Runs one section, reporting rather than rethrowing so the rest still run */
function runSection(name, body) {
  try {
    body();
  } catch (err) {
    failures.push(name);
    console.error("\n✗ " + name);
    console.error(err?.stack ? err.stack : String(err));
    if (summaryPrinted) {
      console.error(
        "\n(that section reported after the tally was printed — the run failed)"
      );
      printSummary();
    }
  }
}

/** The tally and the exit code. Callable more than once; the last word wins. */
function printSummary() {
  if (failures.length === 0) {
    console.log("\nAll smoke tests passed");
    return;
  }
  console.error(
    "\n" + failures.length + " section(s) failed: " + failures.join(", ")
  );
  process.exitCode = 1;
}

function reportSummary() {
  summaryPrinted = true;
  printSummary();
}

module.exports = {
  FakeDisplayNames,
  MANGA,
  NS,
  PLUGIN,
  PluginApi,
  React,
  asManga,
  call,
  call2,
  callAfter,
  capturedClicks,
  capturedQueries,
  censorshipConditionsOf,
  conditionsOf,
  customFieldsCriterion,
  displayNamesCalls,
  documentRoot,
  encodedCriteria,
  fakeHistory,
  find,
  galleryToolbarDom,
  globalListeners,
  hasText,
  historyReplaces,
  loggedErrors,
  makeEl,
  makeFilterModel,
  mangaConditionsOf,
  mutationWrites,
  observed,
  original,
  queryOptions,
  patched,
  patchedAfter,
  patchedBefore,
  realDisplayNames,
  reportSummary,
  runSection,
  sel,
  state,
  tagWithText,
};
