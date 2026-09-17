/**
 * 11–13d: what the plugin puts on a gallery's card and on a gallery's page —
 * the badges, the route scoping, the edit writes, the censorship mark and the
 * manga panel.
 *
 * These wait for the plugin's first refresh rather than running with 01–07: the
 * badges and the bulk rows are read out of the gallery map it fetches on load.
 */

const assert = require("node:assert");
const {
  MANGA,
  NS,
  queryOptions,
  PluginApi,
  React,
  asManga,
  call,
  callAfter,
  documentRoot,
  find,
  galleryToolbarDom,
  globalListeners,
  hasText,
  makeEl,
  mutationWrites,
  state,
} = require("../helpers.js");
const { detail, editField } = require("../renders.js");

module.exports = () => {
  // ── 11. Badges (after the refresh promise settles) ───────────────
  // Stands in for Stash's own Overlays — the studio overlay. An `after` patch is
  // handed it and returns it, so handing back the *same object* is how "the
  // plugin added nothing" reads below, with no shape to guess at.
  const overlaysResult = { type: "StudioOverlay", props: {} };
  const card = (id) =>
    callAfter("GalleryCard.Overlays", { gallery: { id } }, overlaysResult);

  // The badge wraps a Flag component, so one more render is needed to reach the span
  const badgeOf = (id) => {
    const el = card(id);
    if (el.type !== React.Fragment) return null;
    const b = el.props.children[1];
    return b.type(b.props);
  };
  const flagOf = (id) => {
    const badge = badgeOf(id);
    if (badge?.type !== "div") return null;
    const inner = badge.props.children;
    // The unknown-value branch holds plain text, not a Flag element
    if (!inner || typeof inner.type !== "function") return null;
    return inner.type(inner.props);
  };

  assert.strictEqual(
    card("1").type,
    React.Fragment,
    "gallery 1 should carry a badge"
  );
  assert.strictEqual(
    flagOf("1").props.className,
    "fi fi-cn",
    "gallery 1 should show the China flag"
  );
  assert.strictEqual(
    flagOf("2").props.className,
    "fi fi-tw",
    "gallery 2 holds a traditional value"
  );
  assert.strictEqual(
    flagOf("5").props.className,
    "fi fi-cn",
    "gallery 5 holds ZH-HANS, which is non-canonical case and should still resolve"
  );
  assert.strictEqual(
    badgeOf("1").props["aria-label"],
    "简体中文",
    "should carry an aria-label"
  );
  // Identity, not merely "a component": an `after` patch that has nothing to add
  // returns the very object it was handed, so the original output is not merely
  // equivalent, it is the same one.
  assert.strictEqual(
    card("4"),
    overlaysResult,
    "a gallery without a language must not be touched"
  );
  assert.strictEqual(
    card("999"),
    overlaysResult,
    "an unknown id must not be touched"
  );

  // Unknown value: grey text chip, no flag
  const unknown = badgeOf("3");
  assert.strictEqual(unknown.props.className, "manga-tools-badge is-unknown");
  assert.strictEqual(unknown.props.children, "klingon");
  assert.strictEqual(
    flagOf("3"),
    null,
    "an unknown value must not render a flag"
  );

  // Follows the UI language, which is Stash's setting rather than the browser's,
  // so the name changes when that changes. (The locale list itself is pinned in
  // section 2; here it is only the visible consequence that matters.)
  state.currentLocale = "ja-JP";
  assert.strictEqual(
    badgeOf("1").props["aria-label"],
    "簡体中国語",
    "should follow the UI language"
  );
  state.currentLocale = "zh-CN";
  console.log(
    "✓ badges (flag / case tolerance / unknown / no field / UI language)"
  );

  // ── 12. Route scoping ────────────────────────────────────────────
  assert.strictEqual(
    typeof globalListeners["stash:location"],
    "function",
    "the route event was never subscribed"
  );
  const nav = (p) =>
    globalListeners["stash:location"]({
      detail: { data: { location: { pathname: p } } },
    });

  const renderRow = (values, onChange) => {
    const el = call("CustomFieldsInput", {
      // A manga gallery, so the only thing that can hide the row below is the
      // route — which is what this section is about.
      values: asManga(values),
      onChange: onChange || (() => {}),
    }).props.children[0];
    return el.type(el.props);
  };

  nav("/scenes/5");
  assert.strictEqual(
    renderRow({ "plugin.mangaTools.language": "zh-Hans" }),
    null,
    "no language dropdown on a scene page"
  );
  nav("/performers/3");
  assert.strictEqual(
    renderRow({ "plugin.mangaTools.language": "zh-Hans" }),
    null,
    "no language dropdown on a performer page"
  );
  // Gallery 1, not 12: a gallery the store does not list is not one this plugin
  // considers manga, and the row is only drawn for its own galleries.
  nav("/galleries/1");
  assert.notStrictEqual(
    renderRow({ "plugin.mangaTools.language": "zh-Hans" }),
    null,
    "the dropdown should appear on a manga gallery's detail page"
  );
  nav("/galleries");
  assert.notStrictEqual(
    renderRow({ "plugin.mangaTools.language": "zh-Hans" }),
    null,
    "and on the gallery list page (bulk edit)"
  );
  console.log(
    "✓ route scoping (hidden on scenes/performers, shown on galleries)"
  );

  // ── 13. Edit write semantics ─────────────────────────────────────
  let captured = null;
  const setter = (v) => {
    captured = v;
  };
  const row = renderRow(
    { author: "x", "plugin.mangaTools.Language": "ja" },
    setter
  );
  const select = find(
    row,
    (n) => n.props && typeof n.props.onChange === "function" && n.props.options
  );

  select.props.onChange({ value: "zh-Hant" });
  assert.deepStrictEqual(
    captured,
    {
      author: "x",
      [MANGA]: "true",
      "plugin.mangaTools.language": "zh-Hant",
    },
    "writing should drop case variants and canonicalise the field name to lowercase"
  );

  select.props.onChange(null);
  assert.deepStrictEqual(
    captured,
    { author: "x", [MANGA]: "true" },
    "clearing should remove the field entirely"
  );

  // Options: flag + localised name. The order is asserted in 5b; what matters
  // here is that each option carries both halves of the display.
  const opts = select.props.options;
  const jaOption = opts.find((o) => o.value === "ja");
  assert.strictEqual(jaOption.label, "日语");
  assert.strictEqual(jaOption.flag, "jp");
  assert.strictEqual(
    opts.some((o) => o.flag === "vn"),
    true,
    "the Vietnam flag should be vn"
  );
  assert.strictEqual(
    opts.every((o) => o.flag && o.flag.length === 2),
    true,
    "every option should have a flag"
  );

  // Enabled-languages restriction: the dropdown is limited to the selected set,
  // but the currently-selected value still echoes even if it is outside the set
  // (display is unaffected — only the option list is filtered).
  NS.enabledLanguages = new Set(["ja", "en"]);
  const filtered = find(
    renderRow({ "plugin.mangaTools.language": "vi" }),
    (n) => n.props?.options
  );
  assert.deepStrictEqual(
    filtered.props.options.map((o) => o.value),
    ["ja", "en"],
    "the dropdown should show only the enabled languages"
  );
  assert.strictEqual(
    filtered.props.value.value,
    "vi",
    "a selected value outside the enabled set must still echo (display is unaffected)"
  );
  assert.strictEqual(filtered.props.value.flag, "vn");
  NS.enabledLanguages = null; // restore

  // Selected value echo: a canonical code in the wrong case echoes back canonical
  const sel = find(
    renderRow({ "plugin.mangaTools.language": "ZH-HANT" }),
    (n) => n.props?.options
  );
  assert.strictEqual(
    sel.props.value.label,
    "繁体中文",
    "should echo the canonical name"
  );
  assert.strictEqual(
    sel.props.value.value,
    "zh-Hant",
    "should echo the canonical code"
  );
  assert.strictEqual(sel.props.value.flag, "tw");

  // Non-canonical spellings (former aliases, other notations) are unknown values
  // now: they appear in the list as-is, otherwise picking something else would
  // make them unreachable.
  const selUnknown = find(
    renderRow({ "plugin.mangaTools.language": "chs" }),
    (n) => n.props?.options
  );
  assert.strictEqual(selUnknown.props.options[0].value, "chs");
  assert.strictEqual(
    selUnknown.props.options[0].flag,
    null,
    "an unknown option has no flag"
  );
  assert.strictEqual(
    selUnknown.props.value.label,
    "chs",
    "an unknown value echoes as-is"
  );

  // formatOptionLabel should render flag + name
  const formatted = sel.props.formatOptionLabel({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  assert.strictEqual(
    find(formatted, (n) => /fi fi-jp/.test(n.props.className || "")).props
      .className,
    "fi fi-jp manga-tools-flag"
  );
  assert.strictEqual(
    find(formatted, (n) => n.props.children === "日语") !== null,
    true
  );
  const formattedUnknown = sel.props.formatOptionLabel({
    value: "x",
    label: "x",
    flag: null,
  });
  assert.strictEqual(
    find(formattedUnknown, (n) => /fi fi-/.test(n.props.className || "")),
    null,
    "an option with no flag must not render a flag"
  );
  console.log("✓ edit write / clear / option flags and names");

  // ── 13b. The two display switches, and that they are independent ──
  // The panel only renders on a gallery *page* now, so the route has to be one.
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries/1" } } },
  });
  NS.showFlags = false;

  const formattedFlat = sel.props.formatOptionLabel({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  assert.strictEqual(
    find(formattedFlat, (n) => /fi fi-/.test(n.props.className || "")),
    null,
    "the dropdown must not draw a flag when flags are off"
  );
  assert.ok(hasText(formattedFlat, "日语"), "the name must still be there");

  // The space in the detail row belongs to the flag, so it has to go with it.
  const flatDetail = detail({ "plugin.mangaTools.language": "zh-Hant" });
  assert.strictEqual(
    find(flatDetail.portal.node, (n) => /fi fi-/.test(n.props.className || "")),
    null,
    "the detail row must not draw a flag when flags are off"
  );
  const flatRow = find(
    flatDetail.portal.node,
    (n) => n.props?.className === "manga-tools-detail"
  );
  assert.deepStrictEqual(
    flatRow.props.children.filter((c) => typeof c === "string"),
    ["语言: ", "繁体中文"],
    "without a flag there must not be a double space"
  );

  // The badge survives flags being off: it falls back to the name chip. That
  // combination is exactly why the two switches are independent — the flag
  // mapping is lossy, so a name can be preferable without losing the badge.
  //
  // The class matters as much as the text: an unrecognised value is bounded and
  // ellipsised, while a recognised name is not clipped at all. Getting those the
  // same way round is what stopped "印度尼西亚语" rendering as "印度尼…".
  assert.strictEqual(
    card("1").type,
    React.Fragment,
    "the badge should survive flags being off"
  );
  const flatBadge = badgeOf("1");
  assert.strictEqual(
    flatBadge.props.className,
    "manga-tools-badge is-name",
    "a recognised language falls back to the name chip, which is not truncated"
  );
  assert.strictEqual(
    flatBadge.props.children,
    "简体中文",
    "showing the localised name"
  );
  assert.strictEqual(flagOf("1"), null, "and no flag element inside it");

  // A long name is the case that motivated the split, so check one end to end:
  // gallery 1 is zh-Hans, which is "Chinesisch (vereinfacht)" in German.
  state.currentLocale = "de-DE";
  assert.strictEqual(badgeOf("1").props.children, "Chinesisch (vereinfacht)");
  assert.strictEqual(
    badgeOf("1").props.className,
    "manga-tools-badge is-name",
    "a name long enough to be clipped keeps the chip that is allowed its full width"
  );
  state.currentLocale = "zh-CN";

  // An unrecognised value keeps the bounded chip, whatever its length
  assert.strictEqual(
    badgeOf("3").props.className,
    "manga-tools-badge is-unknown"
  );

  NS.showFlags = true;
  assert.strictEqual(
    flagOf("1").props.className,
    "fi fi-cn",
    "the flag comes back"
  );

  // The cover badge turns off on its own, whatever the flags setting says.
  NS.showCoverBadge = false;
  assert.strictEqual(
    card("1"),
    overlaysResult,
    "no badge at all when the cover badge is off"
  );
  assert.strictEqual(
    card("3"),
    overlaysResult,
    "and none for an unknown value either"
  );

  NS.showFlags = false;
  assert.strictEqual(card("1"), overlaysResult, "nor with both switches off");

  NS.showCoverBadge = true;
  NS.showFlags = true;
  assert.strictEqual(card("1").type, React.Fragment, "restored");
  console.log(
    "✓ display switches (flags off = names only / badge off / independent)"
  );

  // ── 13b. Censorship: the card mark and the toolbar button ─────────
  //
  // Two surfaces and two kinds of mount point. The card's mark is portalled
  // into Stash's own popover row, which React does not own; the toolbar button
  // is portalled into a span this plugin inserts beside Stash's organized
  // button. Neither target is patchable, so both are reached through the DOM —
  // and a test has to give the plugin the DOM it expects, the way Stash would.

  // --- the field, on its own ---
  assert.strictEqual(
    NS.CENSORSHIP_FIELD_NAME,
    "plugin.mangaTools.censorship",
    "the censorship field names its owner, like the language one"
  );
  assert.deepStrictEqual(
    NS.CENSORSHIP_VALUES,
    ["censored", "uncensored"],
    "two values, in the order the toolbar button cycles through them"
  );

  assert.strictEqual(NS.normalizeCensorship(null), "");
  assert.strictEqual(NS.normalizeCensorship(undefined), "");
  assert.strictEqual(NS.normalizeCensorship("   "), "");
  assert.strictEqual(NS.normalizeCensorship("CENSORED"), "censored");
  assert.strictEqual(NS.normalizeCensorship(" Uncensored "), "uncensored");
  assert.strictEqual(
    NS.normalizeCensorship("maybe"),
    "",
    "a value that is neither of the two reads as unmarked rather than as " +
      "itself — unlike a language, which is shown unrecognised because there " +
      "is no third state for it to fall back on"
  );

  const CF = NS.CENSORSHIP_FIELD_NAME;
  const TG = NS.TRANSLATION_GROUP_FIELD_NAME;

  assert.strictEqual(NS.pickField({ [CF]: "censored" }, CF), "censored");
  assert.strictEqual(
    NS.pickField({ "Plugin.MangaTools.Censorship": "censored" }, CF),
    "censored",
    "the key is matched case-insensitively"
  );
  assert.strictEqual(NS.pickField({ other: "x" }, CF), "");
  assert.strictEqual(NS.pickField(null, CF), "");
  assert.strictEqual(NS.pickField({ [CF]: null }, CF), "");

  assert.deepStrictEqual(
    NS.setField({ language: "ja", other: "x" }, CF, "censored"),
    { language: "ja", other: "x", [CF]: "censored" },
    "writing a field leaves every other field alone"
  );
  assert.deepStrictEqual(
    NS.setField(
      { "plugin.mangaTools.Censorship": "censored" },
      CF,
      "uncensored"
    ),
    { [CF]: "uncensored" },
    "and rewrites the key in its canonical spelling, whatever case it had"
  );
  assert.deepStrictEqual(
    NS.setField({ [CF]: "censored", other: "x" }, CF, ""),
    { other: "x" },
    "an empty value removes the field rather than storing an empty string"
  );
  // The input is never mutated — the language dropdown hands the result
  // straight to Stash as the new form values.
  const cfSource = { [CF]: "censored" };
  NS.setField(cfSource, CF, "");
  assert.deepStrictEqual(cfSource, { [CF]: "censored" });

  // The one list of this plugin's fields. Everything that has to recognise a key
  // of ours asks it, which is what stops a new field being known in some places
  // and not others — the mistake that shipped a raw plugin.mangaTools.manga row
  // into the edit form.
  assert.strictEqual(NS.ownField(NS.FIELD_NAME), NS.FIELD_NAME);
  assert.strictEqual(
    NS.ownField("PLUGIN.MANGATOOLS.Language"),
    NS.FIELD_NAME,
    "in any spelling"
  );
  assert.strictEqual(
    NS.ownField(NS.CENSORSHIP_FIELD_NAME),
    NS.CENSORSHIP_FIELD_NAME
  );
  assert.strictEqual(
    NS.ownField("plugin.mangaTools.Manga"),
    NS.MANGA_FIELD_NAME
  );
  assert.strictEqual(
    NS.ownField("plugin.mangaTools.Manga"),
    NS.MANGA_FIELD_NAME
  );
  assert.strictEqual(
    NS.ownField(NS.TRANSLATION_GROUP_FIELD_NAME),
    NS.TRANSLATION_GROUP_FIELD_NAME,
    "the fourth field, which has no sidebar section and no bulk row"
  );
  assert.strictEqual(
    NS.ownField("plugin.mangaTools.translationGroups"),
    "",
    "recognised means the name itself, not anything shaped like it"
  );
  assert.strictEqual(
    NS.ownField("plugin.mangaTools.languageNotes"),
    "",
    "a longer name that merely starts the same way is not ours"
  );
  assert.strictEqual(NS.ownField("other"), "");
  assert.strictEqual(NS.ownField(null), "");
  assert.strictEqual(NS.ownField(undefined), "");
  assert.strictEqual(NS.isOwnField("  plugin.mangaTools.manga  "), true);
  assert.strictEqual(NS.isOwnField("plugin.mangaTools.mangaX"), false);

  // The translation group's value, which is free text and so has the one rule
  // the other fields do not need: it is trimmed on the way out, because the
  // space somebody left on the end is not part of the group's name — and the
  // input that wrote it has to keep showing it while it is being typed (see 9b).
  assert.strictEqual(
    NS.translationGroupOf({ [TG]: "  Lily Manga  " }),
    "Lily Manga"
  );
  assert.strictEqual(
    NS.translationGroupOf({ "plugin.mangaTools.TranslationGroup": "X" }),
    "X",
    "read through the same case-insensitive key lookup as the other fields"
  );
  assert.strictEqual(NS.translationGroupOf({ [TG]: "   " }), "");
  assert.strictEqual(NS.translationGroupOf({ [TG]: "" }), "");
  assert.strictEqual(NS.translationGroupOf({ other: "x" }), "");
  assert.strictEqual(NS.translationGroupOf(null), "");

  // --- the card's popover row ---
  //
  // Stand in for what React commits: the element the plugin rendered, turned
  // into a node in the fake DOM. Reading the class and the attribute off that
  // element rather than writing them out here is what keeps this honest — if
  // the plugin stopped rendering the anchor, the lookup below would find
  // nothing and the assertions would fail.
  const commit = (el) => {
    const node = makeEl(el.type);
    node.className = el.props.className || "";
    if (el.props["data-gallery"] !== undefined) {
      node.dataset.gallery = el.props["data-gallery"];
    }
    return node;
  };

  /**
   * A card as Stash draws it, with the plugin's mark rendered and committed
   * into it. Returns the row, what the patch returned, the rendered anchor
   * element, and what the mark component draws once the anchor is in place.
   *
   * One card per gallery is in the fake document at a time. The mark finds its
   * row by gallery id, so two cards for one gallery would make that lookup
   * ambiguous — and on the real page a gallery appears in exactly one card, so
   * that is the state worth testing against.
   */
  // Stash's own popover row, as an `after` patch is handed it.
  const popoversResult = { type: "PopoverRow", props: {} };

  let lastCard = null;
  const cardMark = (id, { withRow = true } = {}) => {
    if (lastCard?.parentNode) documentRoot.removeChild(lastCard);

    const cardEl = makeEl("div");
    cardEl.className = "card";
    lastCard = cardEl;

    let row = null;
    if (withRow) {
      row = makeEl("div");
      row.className = "btn-group card-popovers";
      const organized = makeEl("div");
      organized.className = "organized";
      row.appendChild(organized);
      cardEl.appendChild(row);
    }

    const first = callAfter(
      "GalleryCard.Popovers",
      { gallery: { id } },
      popoversResult
    );
    const markEl = first === popoversResult ? null : first.props.children[1];

    // The anchor the mark draws, turned into a node the way React's commit
    // would — read off the rendered element rather than written out here, so a
    // change to the anchor's mark-up shows up as a failed lookup below.
    const drawnOnce = markEl ? markEl.type(markEl.props) : null;
    const anchorEl = drawnOnce ? drawnOnce.props.children[0] : null;
    const anchor = anchorEl ? commit(anchorEl) : null;
    if (anchor) cardEl.appendChild(anchor);
    documentRoot.appendChild(cardEl);

    // The second pass is the one that can see the committed anchor, which is
    // exactly what useAfterMount asks a real React for.
    const again = callAfter(
      "GalleryCard.Popovers",
      { gallery: { id } },
      popoversResult
    );
    const el = again === popoversResult ? null : again.props.children[1];
    const drawn = el ? el.type(el.props) : null;

    return { cardEl, row, markEl, anchor, el, drawn };
  };

  /** The portal the mark drew, if any */
  const markPortal = (id, options) => {
    const { drawn } = cardMark(id, options);
    if (!drawn || drawn.type !== React.Fragment) return null;
    const children = drawn.props.children || [];
    return children.find((c) => c?.__portal) || null;
  };

  const marked = markPortal("1");
  assert.ok(marked, "gallery 1 is marked, so its card should draw the mark");
  assert.strictEqual(
    marked.host.className,
    "manga-tools-popover-slot",
    "the mark goes into a node made for it"
  );
  assert.strictEqual(
    marked.host.parentNode.className,
    "btn-group card-popovers",
    "and that node is inside Stash's own popover row, not a row of our own"
  );
  assert.strictEqual(
    marked.host.parentNode.lastElementChild,
    marked.host,
    "as its last child — after Stash's organized mark"
  );
  assert.strictEqual(
    marked.node.type,
    "button",
    "what is drawn there is a button"
  );
  assert.strictEqual(
    marked.node.props.className,
    "minimal btn btn-primary manga-tools-mark",
    "carrying the same Bootstrap classes Stash's own card buttons do"
  );
  assert.strictEqual(
    marked.node.props.title,
    "漫画",
    "with this plugin's own word for what the gallery is, in the UI language"
  );
  // The icon is the same masked span the toolbar switch draws, so the same asset
  // and the same two colours serve both.
  const cardIcon = marked.node.props.children.type(
    marked.node.props.children.props
  );
  assert.strictEqual(cardIcon.props.className, "manga-tools-manga-icon");

  assert.strictEqual(
    markPortal("3").node.props.title,
    "漫画",
    "gallery 3 is manga too, and the icon says nothing about its censorship"
  );

  assert.strictEqual(
    cardMark("8").markEl,
    null,
    "gallery 8 carries a language but is not manga, so its card draws nothing"
  );
  assert.strictEqual(
    card("8"),
    overlaysResult,
    "…neither a mark nor a badge: the plugin is not on that gallery at all"
  );
  assert.strictEqual(
    card("7"),
    overlaysResult,
    "and gallery 7, which is manga but has no language, has no badge either"
  );

  // A card Stash draws no row for — no image count, no tags, no organized mark.
  const ownRow = cardMark("1", { withRow: false });
  assert.ok(
    ownRow.row === null,
    "the fixture really has no row of Stash's to start with"
  );
  assert.strictEqual(
    ownRow.anchor.previousElementSibling.className,
    "btn-group card-popovers manga-tools-popovers",
    "so the plugin makes one, with the classes Stash would have used"
  );
  assert.strictEqual(
    markPortal("1", { withRow: false }).host.parentNode.className,
    "btn-group card-popovers manga-tools-popovers",
    "and puts the mark in that"
  );

  // --- the detail page's toolbar ---
  const { toolbarGroup, organizedSpan, organizedButton } = galleryToolbarDom();

  // Gallery 3 is the one the cycle below writes to: its fixture mark is
  // "uncensored", and the cycle ends on "censored", so the store assertion at
  // the end of this section is one that a store which never changed would fail.
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries/3" } } },
  });

  /** The toolbar's mark, out of the same patch the panel comes from */
  const toolbarMark = (fields) => {
    // `fields` is what Stash handed the page, and by the time this section runs
    // they are not what the switch reads: it is drawn either way — it is the only
    // way to set the mark, so it cannot itself be gated on it — while what it
    // *says* comes from this plugin's store, which has answered by now (see
    // isMarkedNow). The values are only the fallback before that answer, which is
    // what 9c in section 03 drives; and it is why several assertions below are
    // about the store rather than about these.
    const rendered = call("CustomFields", { values: fields });
    const el = rendered.props.children[2];
    return { rendered, el, drawn: el.type(el.props) };
  };

  const detailValues = (mark, key = CF) => ({
    [NS.FIELD_NAME]: "ja",
    [key]: mark,
    other: "x",
  });

  const first = toolbarMark(detailValues("censored"));
  assert.deepStrictEqual(
    first.rendered.props.children[0].props.values,
    { other: "x" },
    "both of this plugin's fields are lifted out of what Stash renders, so " +
      "neither shows up as a raw custom-field row"
  );
  assert.strictEqual(
    first.drawn.host.parentNode,
    toolbarGroup,
    "the toolbar contents mount into the toolbar group"
  );
  assert.strictEqual(
    toolbarGroup.children[1],
    first.drawn.host,
    "directly after the span holding Stash's organized button, and before the " +
      "operation menu"
  );

  // What it draws: the switch, and — only while the question below is open — the
  // dialog that asks it. Gallery 3 is in the store the map query fills, so it is
  // marked as far as the switch is concerned, whatever `values` holds.
  const drawn = first.drawn.node;
  assert.strictEqual(drawn.type, React.Fragment);
  const toggleOn = drawn.props.children[0];
  assert.strictEqual(toggleOn.type, "button", "a button, like organized");
  assert.strictEqual(
    toggleOn.props.className,
    "minimal manga-tools-manga-toggle btn btn-secondary is-manga",
    "the state is a class, which is the one CSS colours differently"
  );
  assert.strictEqual(toggleOn.props.title, "漫画");
  assert.strictEqual(toggleOn.props["aria-pressed"], true);

  // Clicking organized takes the anchor away for as long as its own save runs:
  // Stash's OrganizedButton renders a spinner while it is `loading`, so the
  // button — and with it the one thing this plugin finds the toolbar by — is
  // absent from a page whose toolbar is sitting right there. A render in that
  // window must not take the switch with it, or the reader watches it vanish
  // under the cursor they just clicked with, and nothing brings it back until
  // this plugin's own next refresh.
  const switchHost = (fields) => {
    const el = call("CustomFields", { values: fields }).props.children[2];
    // Null twice over when the switch stands down: no element at all, or a
    // component that drew nothing. Either way there is no portal, and no host.
    const drawn = el ? el.type(el.props) : null;
    return drawn ? drawn.host : null;
  };
  const hostBefore = switchHost(detailValues("censored"));
  assert.strictEqual(
    hostBefore,
    first.drawn.host,
    "a render that finds the anchor reuses the host rather than making another"
  );

  organizedSpan.detach(organizedButton); // the spinner, for as long as it lasts
  assert.strictEqual(
    switchHost(detailValues("censored")),
    hostBefore,
    "with no anchor to find, the switch keeps the host it already has"
  );

  // Put the button back where Stash puts it, and nothing has moved: the same
  // host, in the same place, and no second one left behind by the render above.
  organizedSpan.insertBefore(organizedButton, hostBefore);
  assert.strictEqual(switchHost(detailValues("censored")), hostBefore);
  assert.strictEqual(
    toolbarGroup.children[1],
    hostBefore,
    "still directly after the span holding the button"
  );

  // The switch's icon is a masked span, not an svg: the artwork is a file, and a
  // file cannot see `currentColor` — the mask reads its shape and CSS supplies
  // the colour, which is what makes two states out of one image.
  const icon = toggleOn.props.children.type(toggleOn.props.children.props);
  assert.strictEqual(icon.type, "span");
  assert.strictEqual(icon.props.className, "manga-tools-manga-icon");

  // A gallery the store does not list is not manga, *however* the values Stash
  // handed in read. Those come from Apollo's cache, which neither of this plugin's
  // writes touches, so after taking a mark off they still say marked — and reading
  // them as the answer left the switch showing a mark the server no longer had.
  // This is that state, built directly: gallery 8 is the fixtures' one gallery
  // with no mark in the map.
  nav("/galleries/8");
  assert.strictEqual(
    toolbarMark(asManga(detailValues("censored"))).drawn.node.props.children[0]
      .props["aria-pressed"],
    false,
    "once the store has answered, a gallery missing from it is not manga"
  );

  // And the ordinary unmarked case, on a gallery no other section uses — which is
  // not decoration: marking a gallery marks it in the store for the rest of the
  // run, because the write is real and so is the state it leaves behind. Section
  // 14 picks its galleries out of that same store — gallery 8 is its "not manga"
  // fixture — so a mark left on a shared id would change what that section tests.
  nav("/galleries/999");
  const unmarkedToolbar = toolbarMark(detailValues("censored")).drawn.node;
  const toggle = unmarkedToolbar.props.children[0];
  assert.strictEqual(
    toggle.props.className,
    "minimal manga-tools-manga-toggle btn btn-secondary",
    "unmarked, and with no state class to say otherwise"
  );
  assert.strictEqual(toggle.props.title, "标记为漫画");
  assert.strictEqual(toggle.props["aria-pressed"], false);
  assert.strictEqual(
    unmarkedToolbar.props.children[1],
    null,
    "and nothing else, until the reader asks to stop managing the gallery"
  );

  const writesBefore = mutationWrites.length;
  toggle.props.onClick();

  // The switch says so at once, rather than after a round trip that may yet fail,
  // and it does it from the store — the values Stash handed in are untouched, so
  // nothing else could be answering here.
  assert.strictEqual(
    toolbarMark(detailValues("censored")).drawn.node.props.children[0].props[
      "aria-pressed"
    ],
    true,
    "a click should show up at once, without waiting for the write"
  );

  // The details panel is drawn on it too — the same question, asked through the
  // same helper — or marking a gallery on its own detail page would leave the page
  // looking untouched until it was reloaded.
  assert.ok(
    call("CustomFields", { values: detailValues("censored") }).props
      .children[1],
    "marking should draw the details panel on the page it was marked from"
  );

  // Marking is one click, and it goes through this plugin's own mutation rather
  // than Stash's. Stash's document asks for the gallery back, and what a mutation
  // asks for is what Apollo writes into its cache — which reinitialises a Stash
  // edit form open on the same page, on top of whatever is typed in it. So this
  // one asks for nothing.
  assert.deepStrictEqual(
    mutationWrites[writesBefore].variables,
    {
      input: {
        id: "999",
        custom_fields: { partial: { [NS.MANGA_FIELD_NAME]: "true" } },
      },
    },
    "marking writes the canonical name"
  );
  assert.ok(
    /galleryUpdate\(input: \$input\)\s*\{\s*id\s*\}/.test(
      mutationWrites[writesBefore].mutation
    ),
    "…asking for nothing but the id, so nothing else the page shows is disturbed"
  );
  assert.strictEqual(
    /custom_fields/.test(mutationWrites[writesBefore].mutation),
    false,
    "the mark is in the input, not in what the mutation asks back for"
  );
  // It has to be a document, not the text it was built from: Apollo rejects a
  // string, and rejects it as a promise — so the write does nothing at all, and
  // the only trace is a console line.
  assert.notStrictEqual(
    typeof mutationWrites[writesBefore].mutation,
    "string",
    "the mutation must go through gql — a bare string is a rejected promise"
  );

  // Marking with an edit form open writes into the form as well, so the copy its
  // Save sends back — the whole map, `custom_fields: { full: … }` — is not a
  // version without the mark. The form is published by the custom-fields section
  // of the edit page, which is rendered for every gallery, marked or not.
  nav("/galleries/997");
  const pushes = [];
  call("CustomFieldsInput", {
    values: { [NS.FIELD_NAME]: "ja" },
    onChange: (next) => pushes.push(next),
  });

  toolbarMark(
    detailValues("censored")
  ).drawn.node.props.children[0].props.onClick();
  assert.deepStrictEqual(
    pushes[0],
    { [NS.FIELD_NAME]: "ja", [NS.MANGA_FIELD_NAME]: "true" },
    "the form's own map gets the mark too"
  );

  // …and the store's query is no-cache for the same reason MARK_QUERY_TEXT asks for
  // nothing: these are Gallery objects, and a copy landing in Apollo's cache is
  // what resets an open edit form.
  const mapQueries = queryOptions.filter((q) => /findGalleries/.test(q.query));
  assert.ok(mapQueries.length > 0, "the map query should have been sent");
  assert.deepStrictEqual(
    [...new Set(mapQueries.map((q) => q.fetchPolicy))],
    ["no-cache"],
    "the store's query must not write what it reads into Apollo's cache"
  );

  // Unmarking asks first, because it takes this plugin's fields with it. The
  // dialog itself cannot be driven from here — the test React's state setter is
  // inert, so a click can open nothing — but what matters is assertable without
  // it: the click writes nothing, and the list of what confirming would remove is
  // its own function. (The same is true of the line that dialog adds when the
  // edit form is dirty; it is drawn in the dialog, not before it.)
  nav("/galleries/3");
  const writesAfterMarking = mutationWrites.length;
  toggleOn.props.onClick();
  assert.strictEqual(
    mutationWrites.length,
    writesAfterMarking,
    "the click must not write: it asks a question, and this one takes data with it"
  );

  assert.deepStrictEqual(
    NS.fieldsToClear({
      [NS.FIELD_NAME]: "ja",
      "plugin.mangaTools.Censorship": "uncensored",
      "plugin.mangaTools.Manga": "true",
      "plugin.mangaTools.translationgroup": "Lily Manga",
      other: "x",
    }),
    [
      NS.FIELD_NAME,
      "plugin.mangaTools.Censorship",
      "plugin.mangaTools.Manga",
      "plugin.mangaTools.translationgroup",
    ],
    "confirming removes every field of this plugin's, by the spelling it has — " +
      "the API removes by exact key, so a drifted one would survive otherwise"
  );
  assert.deepStrictEqual(
    NS.fieldsToClear({ other: "x" }),
    [NS.MANGA_FIELD_NAME],
    "and a gallery with none of them still has something to remove"
  );
  assert.deepStrictEqual(NS.fieldsToClear(null), [NS.MANGA_FIELD_NAME]);

  // The map the edit form is put into, which has to say the same thing as that
  // list: every one of this plugin's keys gone, by the spelling it has, and
  // everybody else's left exactly as it was.
  const beforeClear = {
    [NS.FIELD_NAME]: "ja",
    "plugin.mangaTools.Censorship": "uncensored",
    "plugin.mangaTools.Manga": "true",
    [TG]: "Lily Manga",
    other: "x",
  };
  assert.deepStrictEqual(
    NS.clearFields(beforeClear),
    { other: "x" },
    "the form's copy loses this plugin's fields and nothing else"
  );
  assert.deepStrictEqual(
    beforeClear,
    {
      [NS.FIELD_NAME]: "ja",
      "plugin.mangaTools.Censorship": "uncensored",
      "plugin.mangaTools.Manga": "true",
      [TG]: "Lily Manga",
      other: "x",
    },
    "and it is a copy: the map it was given is untouched"
  );
  // A gallery with none of this plugin's fields: fieldsToClear still names the
  // mark — the removal has to name *something* — while the map has nothing to
  // change. The two disagree there by design, which is why they are two.
  assert.deepStrictEqual(NS.clearFields({ other: "x" }), { other: "x" });
  assert.deepStrictEqual(NS.clearFields(null), {});

  // A rejected write leaves nothing behind: the mark it put in the store is
  // taken back by the refresh that follows. On a gallery the store does not
  // know, which is the one a click marks — and one no other section uses, for
  // the reason given above.
  nav("/galleries/998");
  state.galleryWriteResult = new Error("nope");
  toolbarMark(
    detailValues("censored")
  ).drawn.node.props.children[0].props.onClick();
  state.galleryWriteResult = null;

  // (A Stash with no client at all — the write that cannot even be attempted —
  // is 14c, in the next section. Nothing here can tell it apart from a write that
  // was sent: the store, the form and the switch all end up the same either way,
  // and the difference is a promise away.)

  // The write path is the edit form, through Stash's own values map — which is
  // what makes Save persist the mark and Cancel discard it.
  const edits = [];
  const block = editField({ [NS.FIELD_NAME]: "ja", other: "x" }, (next) =>
    edits.push(next)
  );
  const markSelect = find(
    block.node,
    (n) => n.props?.inputId === "manga_tools_censorship"
  );
  assert.ok(markSelect, "the edit page offers a selector for the mark");
  assert.deepStrictEqual(
    markSelect.props.options.map((o) => o.value),
    ["censored", "uncensored"],
    "two options and nothing else — unset is the selector's own clear button, " +
      "which is why the third state needs neither an icon nor a cycle"
  );
  assert.strictEqual(
    markSelect.props.placeholder,
    "未标注",
    "and the empty box is named, so it reads like the row in the details tab"
  );
  markSelect.props.onChange({ value: "uncensored", label: "无修正" });
  assert.deepStrictEqual(
    edits[0],
    { [MANGA]: "true", [NS.FIELD_NAME]: "ja", other: "x", [CF]: "uncensored" },
    "picking one writes it into the map Stash's form owns"
  );
  markSelect.props.onChange(null);
  assert.deepStrictEqual(
    edits[1],
    { [MANGA]: "true", [NS.FIELD_NAME]: "ja", other: "x" },
    "clearing removes the key rather than storing an empty value"
  );

  // ── The translation group's row: free text, in a select's clothing ──
  //
  // What makes that possible is that the text in the box *is* the field's value:
  // each keystroke is written to Stash's map, and the menu is built from the map
  // rather than from any state of react-select's. So the flow these assertions
  // drive is the real one — type, re-render, read the menu.
  const groupEdits = [];
  const groupField = (values) =>
    editField(values, (next) => groupEdits.push(next));
  const groupSelectOf = (block) =>
    find(
      block.node,
      (n) => n.props?.inputId === "manga_tools_translation_group"
    );
  const optionValues = (block) =>
    groupSelectOf(block).props.options.map((o) => o.value);

  const groupBlock = groupField({ [TG]: "Lily Manga", other: "x" });
  const groupSelect = groupSelectOf(groupBlock);
  assert.ok(
    groupSelect,
    "the edit page offers a field for the translation group"
  );
  assert.strictEqual(
    groupSelect.props.classNamePrefix,
    "react-select",
    "the same control the language and censorship fields are drawn with"
  );
  assert.strictEqual(
    groupSelect.props.isClearable,
    true,
    "with the same clear button — which is how the field is unset"
  );
  assert.strictEqual(
    groupSelect.props.placeholder,
    "填写翻译组…",
    "and this plugin's own words for the empty box"
  );
  assert.deepStrictEqual(
    groupSelect.props.value,
    { value: "Lily Manga", label: "Lily Manga" },
    "showing what the gallery carries"
  );
  // The separator is off, as it is on the two fields above: react-select draws a
  // vertical rule between the clear button and the arrow, and none of Stash's own
  // dropdowns have one.
  assert.strictEqual(groupSelect.props.components.IndicatorSeparator({}), null);
  // `inputValue` is deliberately *not* passed. react-select draws nothing in the
  // value area while its input has text, on the assumption that the input is
  // showing it — and choosing an option hides that input. Controlling the two of
  // them to the same string therefore blanks the box: no label, and no visible
  // text either.
  assert.strictEqual(
    "inputValue" in groupSelect.props,
    false,
    "the box is left to react-select, or it draws neither the value nor the text"
  );

  // Opening the menu asks for a fresh answer, so that the name just saved is in
  // the list rather than offered as a new one. What that costs is a query, and
  // counting queries is section 09's business — see 14d, which drives this prop
  // there, where a fetch in flight is already part of the furniture.
  assert.strictEqual(
    typeof groupSelect.props.onMenuOpen,
    "function",
    "opening the menu is what asks for the fresh list"
  );

  // The menu is the groups already in use, out of this plugin's store — the same
  // set of galleries as everything else here. Gallery 4's carries the spaces it
  // was typed with and is the same group as gallery 1's once trimmed, so a list
  // that did not trim would offer one group twice, and one entry would not match
  // the row the details panel draws.
  assert.deepStrictEqual(
    optionValues(groupBlock),
    ["Aozora", "Lily Manga"],
    "each group once, in name order — and no create entry for a name already in use"
  );

  // Typing: the keystroke goes into the map, and the next render's menu reads it.
  // A plain text box in a select's clothing, which is the point.
  groupSelect.props.onInputChange("Lily Mang", { action: "input-change" });
  assert.strictEqual(
    groupEdits[0][TG],
    "Lily Mang",
    "every keystroke goes into the map Stash's form owns"
  );
  const whileTyping = groupField(groupEdits[0]);
  assert.deepStrictEqual(
    optionValues(whileTyping),
    ["Lily Mang", "Aozora", "Lily Manga"],
    "and the menu then offers it, first and labelled as the offer it is"
  );
  assert.strictEqual(
    groupSelectOf(whileTyping).props.options[0].createLabel,
    '创建 "Lily Mang"',
    "worded in the reader's language, and quoted — the name is the thing being named"
  );
  // The offer is drawn only in the menu: the box shows the name, because an offer
  // to create what is already selected would read as a question.
  const createOption = groupSelectOf(whileTyping).props.options[0];
  assert.strictEqual(
    groupSelectOf(whileTyping).props.formatOptionLabel(createOption, {
      context: "value",
    }),
    "Lily Mang"
  );

  // No `filterOption` of our own: the menu is narrowed by what is typed into it,
  // which react-select does with its own input value. Nothing is passed, so
  // opening the field on a group already set offers the whole list — the state
  // input is empty until somebody types.
  assert.strictEqual(
    "filterOption" in groupSelect.props,
    false,
    "the menu's filtering is react-select's own"
  );

  // Nothing typed: nothing to offer, so the menu is the groups alone.
  assert.deepStrictEqual(optionValues(groupField({ [MANGA]: "true" })), [
    "Aozora",
    "Lily Manga",
  ]);
  // A name that differs from one in use only in case is not a new group.
  assert.deepStrictEqual(
    optionValues(groupField({ [TG]: "lily manga" })),
    ["Aozora", "Lily Manga"],
    "typing an existing group in another case offers it, not a second one"
  );

  // react-select calls onInputChange for reasons other than typing, and its text
  // is then the option it just selected or nothing at all — taking it would wipe
  // the value or put a search word back over it. Only "input-change" is written.
  groupEdits.length = 0;
  groupSelect.props.onInputChange("Lily Manga", { action: "set-value" });
  groupSelect.props.onInputChange("", { action: "menu-close" });
  groupSelect.props.onInputChange("", { action: "blur" });
  assert.deepStrictEqual(
    groupEdits,
    [],
    "only a keystroke is a change: selecting and closing the menu write nothing"
  );

  // Choosing an option writes it in that option's spelling, which is how a name
  // typed in the wrong case gets put right; the create entry carries the text
  // back unchanged.
  groupSelect.props.onChange({ value: "Lily Manga", label: "Lily Manga" });
  assert.strictEqual(groupEdits[0][TG], "Lily Manga");
  groupSelect.props.onChange(createOption);
  assert.strictEqual(
    groupEdits[1][TG],
    "Lily Mang",
    "…and the create entry is the text as it stands"
  );
  groupSelect.props.onChange(null);
  assert.deepStrictEqual(
    groupEdits[2],
    { [MANGA]: "true", other: "x" },
    "clearing removes the key rather than storing an empty value"
  );

  // A box holding only spaces means nothing, so it removes the key rather than
  // storing whitespace that reads as empty everywhere else.
  groupEdits.length = 0;
  groupSelect.props.onInputChange("   ", { action: "input-change" });
  assert.deepStrictEqual(groupEdits[0], { [MANGA]: "true", other: "x" });

  // Nothing else is written on the way out. The value is saved as it is typed, so
  // there is nothing for a blur to rescue — and nothing that could be quietly
  // rewritten from a render that the selection has already made obsolete.
  assert.strictEqual(
    "onBlur" in groupSelect.props,
    false,
    "leaving the box writes nothing: what was typed is already the value"
  );

  // A value somebody set by hand — spaces and all — is passed on as it is, with
  // the trimmed form as the label the box and the menu show.
  const handSet = groupSelectOf(groupField({ [TG]: "  独自组  " }));
  assert.strictEqual(
    handSet.props.value.value,
    "  独自组  ",
    "a value somebody set by hand is left exactly as it is"
  );
  assert.deepStrictEqual(
    handSet.props.value.label,
    "独自组",
    "while the label is the trimmed name"
  );

  // Stash draws no toolbar on an entity that is not a gallery.
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/scenes/1" } } },
  });
  assert.strictEqual(
    call("CustomFields", { values: detailValues("censored") }).props
      .children[2],
    null,
    "no mark on a scene's page — the fields are still lifted out, but there is " +
      "no gallery toolbar to hang it on"
  );
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries/1" } } },
  });

  console.log(
    "✓ censorship (field rules / card mark in Stash's row / a mark not a control / the edit-page selector)"
  );

  // ── 13c. The manga panel, and the tab it is rendered into as well ────
  //
  // EXPERIMENT, on the `test` branch. What is being judged is the *placement*,
  // so what these hold down is the machinery: that the panel says the same thing
  // in both places, and that the tab injection builds and switches Stash's own
  // markup rather than a guess at it.
  state.currentLocale = "zh-CN";
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries/1" } } },
  });

  const panelValues = {
    [NS.FIELD_NAME]: "zh-Hans",
    [NS.CENSORSHIP_FIELD_NAME]: "censored",
    [TG]: "Lily Manga",
    alsoNotOurs: "x",
  };
  const customFieldsEl = (values) =>
    call("CustomFields", { values: asManga(values) });

  /**
   * Renders one element the way React would, as far as a stub can: a function
   * component by calling it, a class component by constructing it and reading
   * what render() gives back. The experiment's error boundary is the only class.
   */
  const renderChild = (el) => {
    if (!el || typeof el.type !== "function") return el;
    return el.type.prototype instanceof PluginApi.React.Component
      ? new el.type(el.props).render()
      : el.type(el.props);
  };
  const panelOf = (values) =>
    renderChild(customFieldsEl(values).props.children[1]);

  const panel = panelOf(panelValues);
  assert.ok(panel, "a gallery page should render the panel");
  assert.ok(
    hasText(panel, "漫画信息"),
    "headed with this plugin's own words for it, since Stash has none"
  );
  assert.ok(
    hasText(panel, "简体中文"),
    "the language as its localised name, not the code"
  );
  assert.ok(hasText(panel, "有修正"), "and the censorship state");
  assert.ok(
    // Two assertions for the one row because the label and the value are drawn
    // as separate children — the same shape Stash's own rows take (see the row
    // above), and the reason the stricter reading is a pair.
    hasText(panel, "翻译组:") && hasText(panel, "Lily Manga"),
    "and the translation group, as written — it is free text, so there is " +
      "nothing here to draw beside it and nothing to look up"
  );

  // A row with no value is simply absent, and with none of the three there is no
  // panel at all — an unset value stays quiet, as the rest of the plugin keeps
  // it.
  // The icon lookup is by string at runtime, so a name the running Stash's
  // FontAwesome does not have comes back undefined — and undefined handed to
  // Stash's Icon *throws inside a render*, which takes the whole page down rather
  // than one glyph. These names are checked against FontAwesome's documentation,
  // which lists every version rather than the subset Stash happens to ship, so
  // this is a real possibility and not a hypothetical one.
  // find() calls function components as it walks, so this descends *through* the
  // guard — which is the point: if the guard let an undefined icon through, the
  // throw happens here rather than being invisible.
  // Only the censorship icons: the panel's header has a chevron, which is also
  // an Icon, so matching on the type alone would find the wrong one.
  const iconOf = (node) =>
    find(
      node,
      (n) => n.type === "Icon" && /^faChess/.test(String(n.props.icon))
    );
  assert.ok(iconOf(panel), "a name the bundled set has draws its icon");

  const knight = PluginApi.libraries.FontAwesomeSolid.faChessKnight;
  delete PluginApi.libraries.FontAwesomeSolid.faChessKnight;
  let withoutKnight = null;
  try {
    withoutKnight = iconOf(panelOf({ [NS.CENSORSHIP_FIELD_NAME]: "censored" }));
  } finally {
    PluginApi.libraries.FontAwesomeSolid.faChessKnight = knight;
  }
  assert.strictEqual(
    withoutKnight,
    null,
    "a name it does not have draws nothing at all, rather than throwing"
  );

  assert.strictEqual(
    renderChild(panelOf({ alsoNotOurs: "x" })),
    null,
    "with none of the three set there is no panel at all"
  );

  const languageOnly = renderChild(panelOf({ [NS.FIELD_NAME]: "zh-Hans" }));
  assert.ok(
    hasText(languageOnly, "简体中文"),
    "a language on its own draws just the language row"
  );
  assert.ok(
    !hasText(languageOnly, "未标注"),
    "and not a censorship row with nothing in it"
  );

  const censoredOnly = renderChild(
    panelOf({ [NS.CENSORSHIP_FIELD_NAME]: "censored" })
  );
  assert.ok(
    hasText(censoredOnly, "有修正"),
    "a mark on its own draws just the censorship row"
  );
  assert.ok(!hasText(censoredOnly, "简体中文"), "and not a language row");

  // The group on its own is a panel too — the third field is enough to want one,
  // which is the other half of the gate above.
  const groupOnly = renderChild(panelOf({ [TG]: "Lily Manga" }));
  assert.ok(
    hasText(groupOnly, "翻译组:") && hasText(groupOnly, "Lily Manga"),
    "a translation group on its own draws the panel and its row"
  );
  assert.ok(!hasText(groupOnly, "简体中文"), "and not the other two rows");
  assert.ok(!hasText(groupOnly, "未标注"), "nor an empty censorship row");

  // The two settings decide the state each block opens in — and only that, which
  // is why a block already on screen keeps whatever the reader did to it.
  NS.openDetailsBlock = true;
  assert.strictEqual(
    find(panelOf(panelValues), (n) => n.type === "Collapse").props.in,
    true,
    "the details block opens when the setting says so"
  );
  NS.openDetailsBlock = false;
  assert.strictEqual(
    find(panelOf(panelValues), (n) => n.type === "Collapse").props.in,
    false,
    "and starts folded by default"
  );

  // The edit block has no Collapse — it shows or hides the rows themselves, so
  // that the field row's negative margins keep cancelling against the form's own
  // column rather than a wrapper of ours.
  NS.openEditBlock = false;
  assert.strictEqual(
    find(editField({ [NS.FIELD_NAME]: "ja" }).node, (n) => n.type === "label"),
    null,
    "a folded edit block draws no rows"
  );
  NS.openEditBlock = true;
  assert.ok(
    find(editField({ [NS.FIELD_NAME]: "ja" }).node, (n) => n.type === "label"),
    "and an open one draws them"
  );

  console.log(
    "✓ manga panel (a disclosure in the details tab: word / rows / icon guard / both defaults)"
  );

  // ── 13d. A gallery that is not manga is left alone ───────────────
  //
  // The mark is the plugin's entry point, so this is the other half of it: a
  // gallery without the mark is an ordinary Stash gallery, and the switch on its
  // toolbar is the only thing of this plugin's on it.
  //
  // The fields themselves are still *lifted out* of what Stash renders, because
  // they are still this plugin's fields and a raw `plugin.mangaTools.language`
  // row is not something a reader should ever see. The values stay in the
  // gallery, unshown and unedited, so unmarking a gallery and marking it again
  // brings them back rather than having destroyed them.
  const plain = {
    [NS.FIELD_NAME]: "ja",
    [NS.CENSORSHIP_FIELD_NAME]: "censored",
    other: "x",
  };

  // Gallery 8: the fixtures' one gallery with no mark in the map the plugin
  // loaded, which is what this section is about. The route matters — whether a
  // gallery is manga is answered from the store first (see isMarkedNow), so the
  // page has to be one the store does not know, or these values would be
  // contradicting it rather than testing it.
  nav("/galleries/8");

  // Cards: gallery 8 carries a language and is not in the map the plugin loaded.
  assert.strictEqual(
    card("8"),
    overlaysResult,
    "no badge on a gallery that is not manga, even though it has a language"
  );
  assert.strictEqual(
    cardMark("8").markEl,
    null,
    "and no censorship mark in its popover row"
  );

  const unmarkedDetail = call("CustomFields", {
    values: plain,
    fullWidth: true,
  });
  assert.deepStrictEqual(
    unmarkedDetail.props.children[0].props.values,
    { other: "x" },
    "our fields are still kept out of Stash's own rendering"
  );
  assert.strictEqual(
    unmarkedDetail.props.children[1],
    null,
    "but the details block is not drawn"
  );
  assert.ok(
    unmarkedDetail.props.children[2],
    "while the switch is — it is the only way to make the gallery manga"
  );

  assert.strictEqual(
    call("CustomFieldsInput", { values: plain, onChange: () => {} }).props
      .children[0],
    null,
    "and its edit form is Stash's own, with no block of ours in it"
  );

  console.log(
    "✓ not manga (no badge, no card mark, no blocks — only the switch)"
  );
};
