/**
 * 6–7d: the plugin's registration with Stash, the query it sends for the
 * gallery map, its settings page, and its own strings.
 */

const assert = require("node:assert");
const {
  NS,
  React,
  call,
  capturedQueries,
  find,
  makeFilterModel,
  original,
  patched,
  patchedAfter,
  patchedBefore,
  state,
} = require("../helpers.js");

module.exports = () => {
  // ── 6. Patch registration ──────────────────────────────────────────
  // Note it is CustomFields (plural, the container), not CustomField — the latter
  // is a plain React.FC, so patching it reports no error and simply never runs.
  // That is a real bug this project hit.
  const requiredPatches = [
    "CustomFieldsInput",
    "CustomFieldInput",
    "CustomFields",
    "PluginSettings",
  ];
  for (const t of requiredPatches) {
    assert.ok(patched[t], `missing patch: ${t}`);
  }

  // The three that only add to Stash's own output are registered as `after`
  // patches. That is what leaves the original component uncalled — so one with
  // hooks inside (GalleryCard.Overlays uses useMemo) cannot be broken by the
  // patch — and what lets the output pass through untouched when the plugin has
  // nothing to add, which the identity checks below rely on.
  const requiredAfterPatches = [
    "GalleryCard.Overlays",
    "GalleryCard.Popovers",
    "RatingSystem",
    "FilteredGalleryList",
    "FilteredGalleryList.SidebarSections",
  ];
  for (const t of requiredAfterPatches) {
    assert.ok(patchedAfter[t], `missing after patch: ${t}`);
  }

  // GalleryList carries two patches, which is allowed: Stash runs the
  // before-functions first and passes their result on to any instead-functions
  // (see patch.tsx). It is observed for the selection the bulk dialog needs, and
  // wrapped so the filter dialog's card has somewhere to render.
  assert.ok(patchedBefore.GalleryList, "missing patch: GalleryList (before)");
  assert.ok(patched.GalleryList, "missing patch: GalleryList (instead)");

  // The wrapper has to hand the list through untouched — the plugin adds siblings,
  // it does not replace anything. Two now: the list the filter dialog draws
  // inside its own card, and the original list at the end. The three sidebar
  // sections are mounted elsewhere — through Stash's sidebar patch container, a
  // page of their own in the sidebar's tests.
  const listModel = makeFilterModel();
  const listEl = call("GalleryList", {
    filter: listModel,
    selectedIds: new Set(),
  });
  assert.strictEqual(
    listEl.type,
    React.Fragment,
    "GalleryList should be wrapped, not replaced"
  );
  const [dialogFilter, listOriginal] = listEl.props.children;
  assert.strictEqual(
    typeof dialogFilter.type,
    "function",
    "the dialog's card as a sibling"
  );
  assert.strictEqual(
    listOriginal.type,
    original,
    "the original GalleryList must still be rendered"
  );
  assert.strictEqual(
    listOriginal.props.filter,
    listModel,
    "…receiving the same filter it was given"
  );

  // Rendering the list is also what offers the filter dialog a Language card: the
  // dialog builds its cards from the same options array the model holds, and this
  // is the first moment that array is in hand.
  assert.ok(
    listModel.options.criterionOptions.some((o) => o.type === "language"),
    "the list patch should register a language criterion for the dialog"
  );
  console.log(
    "✓ all 6 patches registered (+ GalleryList observed and wrapped)"
  );

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
    /custom_fields:\s*\[\{\s*field:\s*"plugin\.mangaTools\.manga",\s*modifier:\s*NOT_NULL\s*\}\]/.test(
      galleryQuery
    ),
    "the query should filter on the mark that makes a gallery manga"
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
  assert.strictEqual(
    NS.parseEnabledLanguages("klingon"),
    null,
    "a value with only unknown codes parses to null (no restriction)"
  );

  // Ordered by code, never by the name the reader sees: the stored value has to
  // come out the same for every user, and languageOptions' order now follows the
  // UI language.
  assert.strictEqual(
    NS.serializeEnabledLanguages(["ja", "en"]),
    "en,ja",
    "serialise should order by code, not insertion order"
  );
  assert.strictEqual(
    NS.serializeEnabledLanguages(new Set(["zh-Hans", "ja"])),
    "ja,zh-Hans"
  );
  assert.strictEqual(
    NS.serializeEnabledLanguages(["en", "ja"]),
    NS.serializeEnabledLanguages(["ja", "en"]),
    "the same selection must serialise the same way whatever order it arrives in"
  );
  assert.strictEqual(
    NS.serializeEnabledLanguages([]),
    "",
    "an empty set serialises to the empty string"
  );

  // The boolean settings. Absent means "not configured", so the default — on — is
  // used, and an install that predates the setting behaves exactly as before.
  assert.strictEqual(NS.parseFlag(null, true), true);
  assert.strictEqual(NS.parseFlag(undefined, true), true);
  assert.strictEqual(NS.parseFlag("", true), true);
  assert.strictEqual(NS.parseFlag(true, false), true);
  assert.strictEqual(NS.parseFlag(false, true), false);
  assert.strictEqual(
    NS.parseFlag("false", true),
    false,
    "a hand-edited string is understood"
  );
  assert.strictEqual(NS.parseFlag("0", true), false);
  assert.strictEqual(NS.parseFlag(" TRUE ", false), true);
  assert.strictEqual(
    NS.parseFlag("nonsense", true),
    true,
    "an unreadable value falls back to the default"
  );
  assert.strictEqual(NS.showFlags, true, "flags default to on");
  assert.strictEqual(NS.showCoverBadge, true, "the cover badge defaults to on");
  console.log("✓ settings parse/serialise (including the booleans)");

  // ── 7c. Settings UI: the multiselect writes the setting back ───────
  // The patched PluginSettings swaps the stock input for MangaToolsSettings only
  // for this plugin; other plugins fall back to the original component.
  //
  // Rendered in English explicitly: the assertions below read the plugin's own
  // strings, which are translated (see 7d), so leaving the locale to whatever ran
  // last would make them say something different for reasons that are not the point.
  state.currentLocale = "en-US";
  const settingsEl = call("PluginSettings", { pluginID: "mangaTools" });
  assert.notStrictEqual(
    settingsEl.type,
    original,
    "mangaTools should swap in its own settings component"
  );
  assert.strictEqual(
    call("PluginSettings", { pluginID: "other" }).type,
    original,
    "other plugins must go back to the original component"
  );

  // Render the settings component (find renders function components) and locate
  // the react-select, which carries isMulti + the full option list.
  // Empty (no restriction) must render as an empty box with an "All languages"
  // placeholder, NOT as every tag pre-selected.
  NS.enabledLanguages = null;
  const emptySelect = find(
    settingsEl,
    (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti
  );
  assert.ok(emptySelect, "the settings UI should render a multiselect");
  assert.strictEqual(emptySelect.props.isClearable, true);
  assert.strictEqual(
    emptySelect.props.menuPlacement,
    "auto",
    "the menu should flip up when there is not enough room below"
  );
  assert.deepStrictEqual(
    emptySelect.props.value,
    [],
    "empty must not pre-select every language"
  );
  assert.strictEqual(emptySelect.props.placeholder, "All languages");

  NS.enabledLanguages = new Set(["ja", "en"]);
  const settingsSelect = find(
    settingsEl,
    (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti
  );
  assert.deepStrictEqual(
    settingsSelect.props.value.map((o) => o.value).sort(),
    ["en", "ja"],
    // Sorted: the value is drawn in the order the options are listed in, and those
    // are ordered by displayed name in the reader's collation — a display detail,
    // not something this assertion is about.
    "the current value should be the enabled set"
  );

  // The switches, laid out like Stash's own BooleanSetting, in the order the page
  // shows them.
  const switches = [];
  find(settingsEl, (n) => {
    if (n.type === "Switch") switches.push(n);
    return false;
  });
  assert.deepStrictEqual(
    switches.map((n) => n.props.id),
    [
      "mangaTools-showFlags",
      "mangaTools-showCoverBadge",
      "mangaTools-openDetailsBlock",
      "mangaTools-openEditBlock",
      "mangaTools-hidePerformers",
    ],
    "all five should render"
  );
  assert.strictEqual(switches[0].props.checked, true, "flags default to on");
  assert.strictEqual(
    switches[1].props.checked,
    true,
    "the cover badge defaults to on"
  );
  // The two defaults are not the same value, which is the point of them being two
  // settings: a section of a dense page starts folded, a field does not.
  assert.strictEqual(
    switches[2].props.checked,
    false,
    "the details block starts collapsed"
  );
  assert.strictEqual(
    switches[3].props.checked,
    true,
    "the edit block starts open — it holds the only way to set a language"
  );
  assert.strictEqual(
    switches[4].props.checked,
    true,
    "and a manga gallery's edit page hides the performers field by default"
  );

  // Selecting a new set writes it back through configurePlugin and updates the
  // shared NS.enabledLanguages immediately.
  settingsSelect.props.onChange([{ value: "ja" }, { value: "zh-Hans" }]);
  assert.deepStrictEqual(
    state.capturedConfigWrite,
    {
      plugin_id: "mangaTools",
      input: {
        enabledLanguages: "ja,zh-Hans",
        showFlags: true,
        showCoverBadge: true,
        openDetailsBlock: false,
        openEditBlock: true,
        hidePerformers: true,
      },
    },
    "every setting is written together, so replace-vs-merge cannot matter"
  );
  assert.deepStrictEqual(
    [...NS.enabledLanguages],
    ["ja", "zh-Hans"],
    "the in-memory set should update immediately"
  );

  // Clearing writes "" (which parses back to "no restriction").
  settingsSelect.props.onChange(null);
  assert.deepStrictEqual(state.capturedConfigWrite.input.enabledLanguages, "");
  assert.strictEqual(
    NS.enabledLanguages,
    null,
    "clearing should restore null (all languages)"
  );

  // Flipping a block's default updates the shared state and persists the lot,
  // exactly as the display switches do.
  switches[2].props.onChange();
  assert.strictEqual(NS.openDetailsBlock, true, "the details default flips");
  assert.strictEqual(
    state.capturedConfigWrite.input.openDetailsBlock,
    true,
    "and the whole map is written again"
  );
  // Put back by hand rather than by calling the switch again: it toggles the
  // `checked` it was *rendered* with, so a second call in the same render sets the
  // same value a second time.
  NS.openDetailsBlock = false;

  // Flipping a switch updates the shared state and persists the lot.
  switches[0].props.onChange();
  assert.strictEqual(
    NS.showFlags,
    false,
    "toggling should update the shared state"
  );
  assert.deepStrictEqual(state.capturedConfigWrite, {
    plugin_id: "mangaTools",
    input: {
      enabledLanguages: "",
      showFlags: false,
      showCoverBadge: true,
      openDetailsBlock: false,
      openEditBlock: true,
      hidePerformers: true,
    },
  });
  NS.showFlags = true;

  // Turning the performers switch off is how a reader asks for Stash's field
  // back; the gallery's edit page follows it, since the switch is read there.
  switches[4].props.onChange();
  assert.strictEqual(
    NS.hidePerformers,
    false,
    "the performers switch is live state like the rest"
  );
  assert.strictEqual(
    state.capturedConfigWrite.input.hidePerformers,
    false,
    "…and is written with the others"
  );
  NS.hidePerformers = true;
  console.log(
    "✓ settings UI (multiselect + switches write configurePlugin, update shared state)"
  );

  // ── 7d. The plugin's own strings follow Stash's UI language ────────
  // Only the strings this plugin writes itself have catalogs: the headings, the
  // descriptions and the placeholders. Everything else on screen comes from Stash's
  // messages, which its own provider resolves.
  const headingIn = (locale) => {
    state.currentLocale = locale;
    const el = call("PluginSettings", { pluginID: "mangaTools" });
    return find(el, (n) => n.type === "h3").props.children;
  };
  const placeholderIn = (locale) => {
    state.currentLocale = locale;
    const el = call("PluginSettings", { pluginID: "mangaTools" });
    return find(
      el,
      (n) => n.props && Array.isArray(n.props.options) && n.props.isMulti
    ).props.placeholder;
  };

  assert.strictEqual(headingIn("en-US"), "Enabled languages");
  assert.strictEqual(
    headingIn("zh-CN"),
    "启用的语言",
    "a Stash set to Simplified Chinese should read the Chinese heading"
  );
  assert.strictEqual(
    placeholderIn("zh-CN"),
    "全部语言",
    "…including the multiselect's placeholder"
  );
  assert.strictEqual(
    headingIn("zh-Hant"),
    "啟用的語言",
    "Traditional Chinese has its own catalog"
  );

  // The locale chain: an exact tag, then subtags dropped one at a time, then
  // English. A regional variant reads its language's catalog.
  assert.strictEqual(
    headingIn("zh-Hant-HK"),
    "啟用的語言",
    "zh-Hant-HK should fall back to the zh-Hant catalog"
  );
  assert.strictEqual(headingIn("en-GB"), "Enabled languages");
  assert.strictEqual(
    headingIn("de-DE"),
    "Enabled languages",
    "a language with no catalog of its own reads English rather than showing ids"
  );

  // And the lookup itself, including the reading a bare `zh` gets
  assert.strictEqual(
    NS.t({ locale: "zh" }, "mangaTools.select.placeholder"),
    "选择语言…",
    "a bare zh means Simplified, as it does in the language field"
  );
  assert.strictEqual(
    NS.t({ locale: "ja-JP" }, "mangaTools.select.placeholder"),
    "Select language…"
  );
  assert.strictEqual(
    NS.t({ locale: "zh-CN" }, "mangaTools.nope"),
    "mangaTools.nope",
    "an id no catalog has should show as itself, so it is obvious in the UI"
  );
  const catalogs = NS.catalogs();
  const englishIds = Object.keys(catalogs.en).sort();
  assert.ok(
    Object.keys(catalogs).length > 1,
    "there should be catalogs to compare"
  );
  for (const locale of Object.keys(catalogs)) {
    assert.deepStrictEqual(
      Object.keys(catalogs[locale]).sort(),
      englishIds,
      `the ${locale} catalog must cover exactly the ids en.json has — a missing one ` +
        "would read English in the middle of a translated screen, a stray one would " +
        "never be shown"
    );
  }
  state.currentLocale = "zh-CN";
  console.log(
    "✓ plugin strings (catalogs by Stash locale, subtag fallback, English last)"
  );
};
