/**
 * 10d–10d2: the three sidebar sections as rendered, the shell all three go
 * through, and the tags above the list.
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {
  NS,
  PLUGIN,
  PluginApi,
  callAfter,
  censorshipConditionsOf,
  conditionsOf,
  customFieldsCriterion,
  fakeHistory,
  find,
  hasText,
  historyReplaces,
  makeFilterModel,
  mangaConditionsOf,
  state,
  tagWithText,
} = require("../helpers.js");

module.exports = () => {
  // ── 10d. The sidebar section itself ────────────────────────────────
  // The sections are mounted through Stash's own sidebar patch container, so
  // there is no DOM here at all: publish the filter the way the list does (from
  // FilteredGalleryList's output, before the sidebar is rendered), then take the
  // container's children apart.
  // A Stash that has no such container — it arrived in v0.31 — would lose the
  // three sections without a word: the patch registers, and never fires. That is
  // the one failure this design can have that nothing else would report, so the
  // plugin says so once, and this is the check that it does. First, before any
  // other render of the list, because it only ever says it once.
  const containerName = "FilteredGalleryList.SidebarSections";
  const registered = PluginApi.components[containerName];
  const complaints = [];
  const realError = console.error;
  delete PluginApi.components[containerName];
  try {
    console.error = (message) => complaints.push(String(message));
    callAfter("FilteredGalleryList", {}, { type: "div", props: {} });
  } finally {
    console.error = realError;
    PluginApi.components[containerName] = registered;
  }
  assert.ok(
    complaints.some(
      (m) => m.indexOf("no FilteredGalleryList.SidebarSections") !== -1
    ),
    "a Stash without the sidebar container must be told about, not silently " +
      "swallowed into an empty sidebar"
  );

  const publishFilter = (filter) => {
    callAfter(
      "FilteredGalleryList",
      {},
      {
        type: "SidebarContent",
        props: { filter },
      }
    );
  };

  /** The container's output for one filter: our three sections, then Stash's own */
  const renderSidebarContainer = (conditions) => {
    publishFilter(
      makeFilterModel(
        conditions === undefined ? [] : [customFieldsCriterion(conditions)]
      )
    );
    return callAfter(
      "FilteredGalleryList.SidebarSections",
      { children: [] },
      { type: "ORIGINAL", props: { children: [] } }
    );
  };

  /** One of the three sections, rendered the way the container renders it */
  const renderSidebarSection = (childIndex, conditions) => {
    const el = renderSidebarContainer(conditions).props.children[childIndex];
    // One call renders the section, which returns the shared shell element; the
    // second reaches the markup the assertions navigate.
    const shell = el.type(el.props);
    return Object.assign({}, el, { node: shell.type(shell.props), shell });
  };

  const renderLanguageFilter = (conditions) =>
    renderSidebarSection(0, conditions);
  const renderCensorshipFilter = (conditions) =>
    renderSidebarSection(1, conditions);
  const renderMangaFilter = (conditions) => renderSidebarSection(2, conditions);

  let section = renderLanguageFilter();

  // Where the sections land: ours first, Stash's own after. That is the position
  // they have always had — after the sidebar's saved-filters header, before its
  // studio filter — and it is now a property of the tree rather than of a DOM
  // anchor, which is the whole point of mounting them this way.
  const stashSide = { type: "SidebarStudiosFilter", props: {} };
  const original = { type: "ORIGINAL", props: { children: [stashSide] } };
  publishFilter(makeFilterModel());
  const container = callAfter(
    "FilteredGalleryList.SidebarSections",
    { children: [] },
    original
  );
  assert.strictEqual(
    container.props.children.length,
    4,
    "three plugin sections and Stash's own output"
  );
  assert.deepStrictEqual(
    container.props.children.slice(0, 3).map((c) => typeof c.type),
    ["function", "function", "function"],
    "the three sections come first"
  );
  assert.strictEqual(
    container.props.children[3],
    original,
    "…and Stash's own filter sections after them"
  );

  // The filter they are built from is the one published from FilteredGalleryList's
  // output — the sidebar's container is handed nothing else.
  const published = makeFilterModel([
    customFieldsCriterion([conditionsOf("EQUALS", ["ja"])]),
  ]);
  publishFilter(published);
  const wired = callAfter(
    "FilteredGalleryList.SidebarSections",
    { children: [] },
    original
  );
  assert.strictEqual(
    wired.props.children[0].props.filter,
    published,
    "each section is handed the filter the list published, not one of its own"
  );

  // The publication itself reads the model out of the rendered tree, wherever it
  // sits in it — the elements Stash hands the model to are not at a fixed depth.
  const deep = makeFilterModel([
    customFieldsCriterion([conditionsOf("IS_NULL")]),
  ]);
  callAfter(
    "FilteredGalleryList",
    {},
    {
      type: "div",
      props: {
        children: [
          {
            type: "SidebarPane",
            props: { children: [{ type: "div", props: {} }] },
          },
          { type: "SidebarContent", props: { filter: deep } },
        ],
      },
    }
  );
  assert.strictEqual(
    callAfter("FilteredGalleryList.SidebarSections", { children: [] }, original)
      .props.children[0].props.filter,
    deep,
    "the model is found wherever the tree holds it"
  );

  // Markup copied from Stash's own sidebar section (CollapseButton/SidebarSection),
  // so it reads as one of them rather than as something bolted on.
  const sectionEl = section.node;
  assert.strictEqual(
    sectionEl.props.className,
    "sidebar-section sidebar-list-filter"
  );
  const headerButton = sectionEl.props.children[0].props.children;
  assert.strictEqual(headerButton.type, "Button");
  assert.strictEqual(headerButton.props.className, "minimal collapse-button");
  assert.strictEqual(
    find(sectionEl, (n) => n.type === "Button").props.children[1].props
      .children,
    "语言",
    "the heading is Stash's own word for language, from its locale files"
  );
  // Collapsed when the filter is not in use — Stash's own sections start closed,
  // and the chevron points right to say so.
  assert.strictEqual(
    find(sectionEl, (n) => n.type === "Collapse").props.in,
    false,
    "with nothing filtered the section should start collapsed, like Stash's"
  );
  assert.strictEqual(
    find(sectionEl, (n) => n.type === "Icon").props.icon,
    "faChevronRight",
    "and the chevron should point right"
  );
  assert.strictEqual(
    find(sectionEl, (n) => n.type === "Collapse").props.mountOnEnter,
    true,
    "the candidates should not be mounted until the section is opened"
  );
  assert.strictEqual(
    typeof headerButton.props.onClick,
    "function",
    "the header should be clickable — the transition itself is not asserted, since " +
      "this stub's useState has a no-op setter and asserting it would test the stub"
  );

  // The candidate list: a search box, then Stash's two modifier entries, then
  // every language.
  const candidateList = find(sectionEl, (n) => {
    return n.props && n.props.className === "queryable-candidate-list";
  });
  assert.ok(
    candidateList,
    "the candidates should be in a queryable-candidate-list"
  );

  const searchField = find(
    candidateList,
    (n) => n.props && n.props.className === "clearable-text-field form-control"
  );
  assert.ok(
    searchField,
    "the candidates should be searchable, like Stash's own"
  );
  assert.strictEqual(
    searchField.props.placeholder,
    "搜索…",
    "with Stash's placeholder, localised"
  );

  const candidateItems = [];
  find(candidateList, (n) => {
    if (n.props && /^unselected-object\b/.test(n.props.className))
      candidateItems.push(n);
    return false;
  });
  assert.strictEqual(
    candidateItems.length,
    Object.keys(NS.LANGUAGES).length + 2,
    "every language should be offered, plus (Any) and (None)"
  );
  const labelOf = (item) =>
    find(item, (n) => n.props && typeof n.props.children === "string").props
      .children;
  assert.deepStrictEqual(
    candidateItems.slice(0, 2).map(labelOf),
    ["(任意)", "(无)"],
    "the modifier entries come first, in Stash's own parenthesised wording, localised"
  );
  assert.deepStrictEqual(
    candidateItems.slice(0, 2).map((i) => i.props.className),
    ["unselected-object modifier-object", "unselected-object modifier-object"],
    "and carry modifier-object, as Stash marks them"
  );
  assert.strictEqual(
    candidateItems.some((i) => labelOf(i) === "日语"),
    true,
    "and the languages after them"
  );

  // Markup details taken from a real studio section, so the two read identically:
  // the include icon carries no extra state class, and the row's trailing wrapper
  // is present even when there is no button in it.
  const jaRow = candidateItems.find((i) => labelOf(i) === "日语");
  assert.strictEqual(
    find(jaRow, (n) => n.type === "Icon").props.className,
    "fa-fw include-button"
  );
  const modifierTrailing = find(candidateItems[0], (n) => n.type === "a").props
    .children[1];
  assert.strictEqual(
    modifierTrailing.type,
    "div",
    "the trailing wrapper is rendered even when it holds no exclude button — " +
      "the modifier entries have nothing to put in it"
  );
  assert.strictEqual(modifierTrailing.props.children, null, "…and it is empty");

  // Flags are drawn in the sidebar like everywhere else
  assert.strictEqual(NS.showFlags, true, "precondition: flags are on");
  assert.ok(
    find(
      candidateItems.find((i) => labelOf(i) === "日语"),
      (n) => /fi fi-/.test(n.props.className || "")
    ),
    "candidates should carry a flag"
  );

  // Clicking a language rewrites the URL rather than keeping state of its own
  const jaCandidate = candidateItems.find((i) => labelOf(i) === "日语");
  historyReplaces.length = 0;
  find(jaCandidate, (n) => n.type === "a").props.onClick();
  assert.strictEqual(
    historyReplaces.length,
    1,
    "clicking should apply the filter"
  );
  assert.strictEqual(
    historyReplaces[0].pathname,
    "/galleries",
    "on the same page"
  );
  assert.ok(
    /"field":"plugin\.mangaTools\.language","modifier":"EQUALS","value":\["ja"\]/.test(
      historyReplaces[0].search
    ),
    "and the URL should carry an EQUALS condition for that language"
  );

  // The exclude button sits inside the row, so it has to stop the click reaching
  // the row's own include handler.
  const jaExclude = find(
    jaCandidate,
    (n) => n.props && n.props.className === "minimal exclude-button"
  );
  assert.ok(jaExclude, "a candidate should offer an exclude button");
  assert.strictEqual(
    find(jaExclude, (n) => n.props.children === "exclude") !== null,
    true,
    "labelled the way Stash labels it"
  );
  historyReplaces.length = 0;
  let stopped = false;
  jaExclude.props.onClick({
    stopPropagation: () => {
      stopped = true;
    },
  });
  assert.strictEqual(stopped, true, "the exclude click must stop propagating");
  assert.strictEqual(
    historyReplaces.length,
    1,
    "…and exclude rather than include"
  );
  assert.ok(
    /"modifier":"NOT_EQUALS","value":\["ja"\]/.test(historyReplaces[0].search),
    "the URL should carry a NOT_EQUALS condition"
  );
  console.log(
    "✓ sidebar section (placement / native markup / search / candidates / include / exclude)"
  );

  // Clicking (Any) asks for galleries that have a language at all
  const anyItem = candidateItems.find((i) => labelOf(i) === "(任意)");
  historyReplaces.length = 0;
  find(anyItem, (n) => n.type === "a").props.onClick();
  assert.ok(
    /"modifier":"NOT_NULL"/.test(historyReplaces[0].search),
    "(Any) should ask for galleries carrying a language"
  );
  console.log("✓ sidebar section (modifier entries: any / none)");

  // With something selected, it moves above the fold-away list — outside the
  // collapse, so it stays visible — and the candidates no longer offer it.
  section = renderLanguageFilter([
    conditionsOf("EQUALS", ["ja"]),
    conditionsOf("NOT_EQUALS", ["ko"]),
  ]);
  const selectedList = find(
    section.node,
    (n) => n.props && n.props.className === "selected-list"
  );

  // A filter being set does NOT open the section — Stash does no such thing
  // (nothing in it writes a section's open state but the reader's own click), and
  // deriving it here would flicker, since a filter arriving from the URL is known
  // a render later than the first paint.
  assert.strictEqual(
    find(section.node, (n) => n.type === "Collapse").props.in,
    false,
    "a filter in use should not force the section open"
  );

  assert.ok(
    selectedList,
    "a chosen language should appear in the selected-list"
  );
  assert.strictEqual(
    section.node.props.children[1],
    selectedList,
    "the selected list sits outside the collapse, where Stash puts it"
  );
  assert.strictEqual(
    find(selectedList, (n) => n.type === "Icon").props.icon,
    "faCheckCircle",
    "a chosen entry is ticked"
  );
  assert.strictEqual(
    find(selectedList, (n) => n.props.children === "日语") !== null,
    true
  );

  // A selected row has no second column, unlike a candidate — checked against a
  // real section, where a candidate's <a> holds the exclude button and a chosen
  // one holds nothing but its label.
  const selectedLink = find(selectedList, (n) => n.type === "a");
  /** The children that actually render — a null slot produces nothing */
  const renderedChildren = (el) =>
    (Array.isArray(el.props.children)
      ? el.props.children
      : [el.props.children]
    ).filter((c) => c !== null && c !== undefined);
  assert.strictEqual(
    renderedChildren(selectedLink).length,
    1,
    "a chosen row holds only its label group"
  );
  assert.strictEqual(
    renderedChildren(selectedLink)[0].props.className,
    "label-group"
  );

  const remaining = [];
  find(
    find(
      section.node,
      (n) => n.props && n.props.className === "queryable-candidate-list"
    ),
    (n) => {
      if (n.props && /^unselected-object\b/.test(n.props.className))
        remaining.push(n);
      return false;
    }
  );
  assert.strictEqual(
    remaining.length,
    Object.keys(NS.LANGUAGES).length - 2,
    "neither chosen language should also be offered as a candidate"
  );
  assert.strictEqual(
    remaining.some((i) => /modifier-object/.test(i.props.className)),
    false,
    "(Any) and (None) are for the empty state, and those are only offered then"
  );

  // Clicking the chosen one clears it
  historyReplaces.length = 0;
  selectedLink.props.onClick();
  assert.ok(
    /"modifier":"NOT_EQUALS","value":\["ko"\]/.test(
      historyReplaces[0].search
    ) && !/"EQUALS"/.test(historyReplaces[0].search),
    "clicking the chosen language should drop it and leave the excluded one"
  );

  // An excluded language goes in its own list, which Stash marks excluded-list
  const excludedList = find(
    section.node,
    (n) => n.props && n.props.className === "selected-list excluded-list"
  );
  assert.ok(excludedList, "an excluded language should get the excluded-list");
  assert.strictEqual(
    find(excludedList, (n) => n.type === "Icon").props.icon,
    "faTimesCircle",
    "and be marked with a cross rather than a tick"
  );
  assert.strictEqual(
    find(
      excludedList,
      (n) => n.props.className === "TruncatedText inline excluded-object-label"
    ) !== null,
    true,
    "with the excluded label class, as Stash has it"
  );
  console.log(
    "✓ sidebar section (selected + excluded lists / row shapes / click clears)"
  );

  // The open state lives in the history entry, where Stash keeps its own — so it
  // survives a reload, which is what a reader sees as "it remembers".
  fakeHistory.location.state = {
    mangaToolsLanguageOpen: true,
    somethingElse: 1,
  };
  section = renderLanguageFilter();
  assert.strictEqual(
    find(section.node, (n) => n.type === "Collapse").props.in,
    true,
    "a remembered open state should be honoured on the first render"
  );
  assert.strictEqual(
    find(section.node, (n) => n.type === "Icon").props.icon,
    "faChevronDown"
  );

  // …and toggling records the choice in that same place, merging rather than
  // replacing whatever else the entry was holding.
  const searchBeforeToggle = fakeHistory.location.search;
  historyReplaces.length = 0;
  find(section.node, (n) => n.type === "Button").props.onClick();
  assert.strictEqual(
    historyReplaces.length,
    1,
    "toggling should remember the choice"
  );
  assert.deepStrictEqual(
    historyReplaces[0].state,
    { mangaToolsLanguageOpen: false, somethingElse: 1 },
    "the entry's other state must survive"
  );
  assert.strictEqual(
    historyReplaces[0].search,
    searchBeforeToggle,
    "and the URL's query must be left exactly as it was — this is not a filter change"
  );
  fakeHistory.location.state = undefined;
  // Enter takes the only candidate left, as Stash's onEnter does. Restricted to a
  // single enabled language so the list really does hold one — the search box
  // itself cannot be typed into here, since this stub's useState is inert.
  NS.enabledLanguages = new Set(["ja"]);
  const oneCandidate = renderLanguageFilter();
  const oneSearchBox = find(
    oneCandidate,
    (n) => n.props && n.props.className === "clearable-text-field form-control"
  );
  assert.ok(oneSearchBox, "precondition: the search box is rendered");
  historyReplaces.length = 0;
  oneSearchBox.props.onKeyDown({ key: "Enter" });
  assert.ok(
    /"field":"plugin\.mangaTools\.language","modifier":"EQUALS","value":\["ja"\]/.test(
      historyReplaces[0].search
    ),
    "Enter should take the only candidate on offer"
  );
  NS.enabledLanguages = null;

  // …and stays out of the way when there is a choice to make
  const manyCandidates = renderLanguageFilter();
  historyReplaces.length = 0;
  find(
    manyCandidates,
    (n) => n.props && n.props.className === "clearable-text-field form-control"
  ).props.onKeyDown({ key: "Enter" });
  assert.strictEqual(
    historyReplaces.length,
    0,
    "Enter must not pick one of several — that choice is the reader's"
  );

  // (Any) and (None) are absent while a value is chosen, and come back when it is
  // cleared — the state Stash offers them in.
  section = renderLanguageFilter([conditionsOf("NOT_NULL")]);
  const modifierItems = [];
  find(
    find(
      section.node,
      (n) => n.props && n.props.className === "queryable-candidate-list"
    ),
    (n) => {
      if (n.props && /modifier-object/.test(n.props.className || ""))
        modifierItems.push(n);
      return false;
    }
  );
  assert.strictEqual(
    modifierItems.length,
    0,
    "with the (Any) modifier set, the modifier entries belong above, not in the list"
  );
  assert.strictEqual(
    find(section.node, (n) => n.props && n.props.children === "(任意)") !==
      null,
    true,
    "…and are shown as the chosen value"
  );

  // …and the languages go with them. Stash's own useCandidates returns an empty
  // list for IsNull and NotNull, which is why choosing (None) in the studio filter
  // makes the studios disappear; the same must happen here or the two sections
  // behave differently for no reason the reader can see.
  const offeredWhileFiltered = [];
  find(
    find(
      section.node,
      (n) => n.props && n.props.className === "queryable-candidate-list"
    ),
    (n) => {
      if (n.props && /^unselected-object\b/.test(n.props.className)) {
        offeredWhileFiltered.push(n);
      }
      return false;
    }
  );
  assert.strictEqual(
    offeredWhileFiltered.length,
    0,
    "(Any) or (None) leaves nothing to choose, so no language is offered"
  );
  assert.ok(
    find(
      section.node,
      (n) =>
        n.props && n.props.className === "clearable-text-field form-control"
    ),
    "…though the search box stays, standing over an empty list, as it does in Stash"
  );

  // And there is a way back. Clicking the chosen modifier entry returns it to the
  // default — Stash's onUnselect does this by setting the modifier back, which is
  // a different action from selecting it, so it cannot be a toggle on the
  // candidate. That escape hatch was silently broken once, hence this test.
  historyReplaces.length = 0;
  const chosenModifier = find(
    section.node,
    (n) => n.props && n.props.className === "selected-object modifier-object"
  );
  assert.ok(
    chosenModifier,
    "the chosen modifier should sit in the selected list"
  );
  chosenModifier.props.children.props.onClick();
  assert.strictEqual(
    historyReplaces[0].search,
    "ENCODED([])",
    "clearing it should leave no language condition at all"
  );

  // The search box's clear button cannot be reached from these tests: it only
  // renders once the box has text, and this stub's useState cannot type. Its one
  // non-obvious requirement is therefore pinned in the bundle text instead — that
  // it asks for the *secondary* variant, since react-bootstrap defaults to primary
  // and Stash's own .clearable-text-field-clear does not undo that background,
  // leaving a solid blue block where a small cross should be.
  // If this ever fails, check that change against ClearableInput.tsx rather than
  // deleting the assertion.
  const bundleText = fs.readFileSync(
    path.join(PLUGIN, "mangaTools.js"),
    "utf8"
  );
  const clearMarker = 'className: "clearable-text-field-clear"';
  const clearAt = bundleText.indexOf(clearMarker);
  assert.ok(clearAt > 0, "the clear button should be in the bundle");
  const clearProps = bundleText.slice(
    bundleText.lastIndexOf("{", clearAt),
    bundleText.indexOf("}", clearAt)
  );
  assert.ok(
    /variant:\s*"secondary"/.test(clearProps),
    "the clear button must be a secondary button, like Stash's — a primary one is a blue block"
  );
  console.log("✓ search box clear button (secondary, not the primary default)");

  // ── 10d2. The censorship and manga sections share the language section's shell ──
  // The three sections used to each write the shell markup out; now they render
  // through one SidebarSection. renderSidebarSection keeps a reference to that
  // shared element in `shell`, so the three can be shown to be the same component
  // rather than three hand-written divs.
  const langShell = renderLanguageFilter().shell;
  assert.strictEqual(
    typeof langShell.type,
    "function",
    "the section's shell should be a component, not a hand-written div"
  );
  assert.strictEqual(
    renderCensorshipFilter().shell.type,
    langShell.type,
    "the censorship section should render through the same shell as the language one"
  );
  assert.strictEqual(
    renderMangaFilter().shell.type,
    langShell.type,
    "and so should the manga section"
  );

  /**
   * The rows a section offers below the fold, in the order it draws them.
   *
   * The same shape walks both remaining sections: a candidate list holding one
   * row per value, each row an `unselected-object`.
   */
  const candidateRows = (node) => {
    const items = [];
    find(
      find(
        node,
        (n) => n.props && n.props.className === "queryable-candidate-list"
      ),
      (n) => {
        if (n.props && /^unselected-object\b/.test(n.props.className))
          items.push(n);
        return false;
      }
    );
    return items;
  };
  const candidateRowLabels = (node) => candidateRows(node).map(labelOf);

  /** The add/remove icons of every row under a node, as class strings */
  const rowIcons = (node) => {
    const icons = [];
    find(node, (n) => {
      if (
        n.type === "Icon" &&
        /^fa-fw (include-button|exclude-icon)/.test(String(n.props.className))
      )
        icons.push(n.props.className);
      return false;
    });
    return icons;
  };

  // ── Censorship: the language section's shape on two fixed values ──
  const censSection = renderCensorshipFilter();
  assert.strictEqual(
    find(censSection.node, (n) => n.type === "Button").props.children[1].props
      .children,
    "修正",
    "the censorship section is headed by this plugin's own word for it"
  );

  const chessIcons = [];
  find(censSection.node, (n) => {
    if (n.type === "Icon" && /^faChess/.test(n.props.icon || ""))
      chessIcons.push(n);
    return false;
  });
  assert.ok(
    chessIcons.length >= 2,
    "each censorship value should draw a chess piece where a flag would go"
  );

  const censCandidates = candidateRows(censSection.node);
  assert.deepStrictEqual(
    censCandidates.slice(0, 2).map(labelOf),
    ["(任意)", "(无)"],
    "censorship offers the same two modifier entries as the language section"
  );
  assert.deepStrictEqual(
    censCandidates.slice(2).map(labelOf),
    ["有修正", "无修正"],
    "followed by its two values"
  );

  // Clicking a value rewrites the URL, on the censorship field
  const censoredRow = censCandidates.find((i) => labelOf(i) === "有修正");
  historyReplaces.length = 0;
  find(censoredRow, (n) => n.type === "a").props.onClick();
  assert.ok(
    /"field":"plugin\.mangaTools\.censorship","modifier":"EQUALS","value":\["censored"\]/.test(
      historyReplaces[0].search
    ),
    "clicking a censorship value should write its EQUALS condition"
  );

  // …and the chosen value moves above the fold-away list
  const censChosen = renderCensorshipFilter([
    censorshipConditionsOf("EQUALS", ["censored"]),
  ]);
  const censSelectedList = find(
    censChosen.node,
    (n) => n.props && n.props.className === "selected-list"
  );
  assert.ok(
    censSelectedList,
    "a chosen censorship value should sit above the fold"
  );
  assert.ok(hasText(censSelectedList, "有修正"), "with the value's own label");

  // (Any) and (None) leave nothing to pick — there is no particular value to
  // choose in those states — so the two values step aside, exactly as they do in
  // the language section.
  const censAny = renderCensorshipFilter([censorshipConditionsOf("NOT_NULL")]);
  assert.deepStrictEqual(
    candidateRowLabels(censAny.node),
    [],
    "choosing (Any) should take the two values off the list"
  );
  assert.ok(
    hasText(
      find(
        censAny.node,
        (n) => n.props && n.props.className === "selected-list"
      ),
      "(任意)"
    ),
    "…leaving the modifier it chose above the fold"
  );

  // The criterion Stash draws the tags from is one criterion for all three
  // fields, so a filter with a language and a censorship in it is one criterion
  // with two conditions. Each section words the tags of its own field and no
  // other — by the conditions it owns, not by the criterion as a whole, which is
  // what left both tags in Stash's own raw wording when two fields were set.
  const langTag = tagWithText(
    "plugin.mangaTools.language (custom field) is ja"
  );
  const censTag = tagWithText(
    "plugin.mangaTools.censorship (custom field) is censored"
  );
  state.tagQuery = () => [langTag, censTag];
  renderCensorshipFilter([
    censorshipConditionsOf("EQUALS", ["censored"]),
    conditionsOf("EQUALS", ["ja"]),
  ]);
  state.tagQuery = () => [];
  assert.strictEqual(
    censTag.firstChild.nodeValue,
    "修正 是 有修正",
    "the censorship section words its own tag even when the criterion also " +
      "holds a condition for another field"
  );
  assert.strictEqual(
    langTag.firstChild.nodeValue,
    "plugin.mangaTools.language (custom field) is ja",
    "…and leaves the other field's tag for the section that owns it"
  );

  // The same for the language section, so neither call site can drift into
  // wording the other field's tags.
  const jaTag = tagWithText("plugin.mangaTools.language (custom field) is ja");
  const otherCensTag = tagWithText(
    "plugin.mangaTools.censorship (custom field) is censored"
  );
  state.tagQuery = () => [jaTag, otherCensTag];
  renderLanguageFilter([
    censorshipConditionsOf("EQUALS", ["censored"]),
    conditionsOf("EQUALS", ["ja"]),
  ]);
  state.tagQuery = () => [];
  assert.strictEqual(
    jaTag.firstChild.nodeValue,
    "语言 是 日语",
    "the language section words its own tag out of the shared criterion"
  );
  assert.strictEqual(
    otherCensTag.firstChild.nodeValue,
    "plugin.mangaTools.censorship (custom field) is censored",
    "…and not the censorship one"
  );

  // ── Manga: a boolean, single-select, no modifiers ──
  const mangaSection = renderMangaFilter();
  assert.strictEqual(
    find(mangaSection.node, (n) => n.type === "Button").props.children[1].props
      .children,
    "是否为漫画",
    "the manga section is headed by the question the mark asks about a gallery"
  );

  assert.deepStrictEqual(
    candidateRowLabels(mangaSection.node),
    ["是", "否"],
    "manga offers its two values and no modifier entries, in Stash's own words " +
      "for a boolean — the ones its organized section uses"
  );

  // English has no such message in Stash's catalogs — its own organized section
  // shows the bare id "true" there — so this plugin's fallback is what shows.
  state.currentLocale = "en-US";
  assert.deepStrictEqual(
    candidateRowLabels(renderMangaFilter().node),
    ["Yes", "No"],
    "a locale Stash has not translated the two words for falls back to this " +
      "plugin's own"
  );
  state.currentLocale = "zh-CN";

  // The plus has nothing to add on a value that is the only one a criterion
  // takes, so Stash hides it with a class rather than by not drawing it, which is
  // what keeps the label where it is on a multi-value row. Only the candidate
  // carries it: the chosen row's tick has to stay visible.
  assert.deepStrictEqual(
    rowIcons(mangaSection.node),
    ["fa-fw include-button single-value", "fa-fw include-button single-value"],
    "neither manga value draws a plus while neither is chosen"
  );

  const mangaMarked = renderMangaFilter([mangaConditionsOf("NOT_NULL")]);
  assert.deepStrictEqual(
    rowIcons(mangaMarked.node),
    ["fa-fw include-button", "fa-fw include-button single-value"],
    "the chosen value keeps its tick, and only the candidate's plus is hidden"
  );

  // Choosing a value writes the mark's presence; choosing it again clears it —
  // single-select, so there is no include/exclude and no (Any)/(None).
  const mangaCandidates = candidateRows(mangaSection.node);
  const markedRow = mangaCandidates.find((i) => labelOf(i) === "是");
  historyReplaces.length = 0;
  find(markedRow, (n) => n.type === "a").props.onClick();
  assert.ok(
    /"field":"plugin\.mangaTools\.manga","modifier":"NOT_NULL"/.test(
      historyReplaces[0].search
    ),
    "choosing marked should write the manga mark's presence"
  );

  const mangaSelectedList = find(
    mangaMarked.node,
    (n) => n.props && n.props.className === "selected-list"
  );
  assert.ok(
    mangaSelectedList,
    "a chosen manga state should sit above the fold"
  );
  assert.ok(hasText(mangaSelectedList, "是"), "with the chosen value's label");

  historyReplaces.length = 0;
  find(mangaSelectedList, (n) => n.type === "a").props.onClick();
  assert.strictEqual(
    historyReplaces[0].search,
    "ENCODED([])",
    "clicking the chosen manga state should clear the filter"
  );

  console.log(
    "✓ censorship & manga sections (shared shell, values, and URL writes)"
  );
};
