/**
 * 10e–10f: the language card in Stash's edit-filters dialog, the criterion it
 * registers, the tag wording both surfaces use, and the selection operations
 * they share. The section numbers run out of order — 10h before 10g — because
 * that is the order they were written in.
 */

const assert = require("node:assert");
const {
  NS,
  PluginApi,
  call,
  capturedClicks,
  customFieldsCriterion,
  documentRoot,
  encodedCriteria,
  makeEl,
  makeFilterModel,
  observed,
  sel,
  state,
  tagWithText,
} = require("../helpers.js");

module.exports = () => {
  // ── 10e. The filter dialog's Language card ─────────────────────────
  // Stash's "edit filters" dialog builds its cards from a shared options array
  // that the model reaches, so an option can be added from a plugin. Three things
  // matter about the one we add: it goes in once, the criterion it makes is
  // usable, and it still stores itself as a custom field.
  const dialogModel = makeFilterModel();
  const dialogOptions = dialogModel.options.criterionOptions;
  const before = dialogOptions.length;
  NS.registerLanguageCriterionOption(dialogModel);
  assert.strictEqual(
    dialogOptions.length,
    before + 1,
    "one card should be added"
  );
  NS.registerLanguageCriterionOption(dialogModel);
  assert.strictEqual(
    dialogOptions.length,
    before + 1,
    "registering again must not add a second card — the list is shared"
  );

  const languageCriterionOption = dialogOptions.find(
    (o) => o.type === "language"
  );
  assert.ok(
    languageCriterionOption,
    "the card should be keyed on its own type"
  );
  assert.strictEqual(
    languageCriterionOption.messageID,
    "config.ui.language.heading",
    "and labelled with Stash's own word for language"
  );

  const madeCriterion = languageCriterionOption.makeCriterion();
  assert.strictEqual(
    madeCriterion.criterionOption.type,
    "language",
    "the criterion must carry our type, or the card cannot open or light up"
  );
  assert.deepStrictEqual(
    madeCriterion.value,
    [],
    "no conditions until a language is picked: an empty EQUALS matches nothing, " +
      "so merely opening the card must not be able to filter the list away"
  );

  // The guarantee that makes it safe: what reaches the URL is a plain custom
  // field. A stored type of "language" would not resolve on reload, because Stash
  // decodes the query string before this option has been registered.
  assert.deepStrictEqual(
    madeCriterion.toQueryParams(),
    { type: "custom_fields", value: [] },
    "the URL must carry custom_fields, which Stash always understands"
  );

  // And it must read the criterion it is called on. Stash clones a criterion with
  // cloneDeep before committing it — the copy keeps this method but is a different
  // object — so a closure over the original would serialise a stale value.
  const cloned = Object.assign({}, madeCriterion);
  cloned.value = [
    { field: "plugin.mangaTools.language", modifier: "EQUALS", value: ["ja"] },
  ];
  assert.deepStrictEqual(
    cloned.toQueryParams().value,
    [
      {
        field: "plugin.mangaTools.language",
        modifier: "EQUALS",
        value: ["ja"],
      },
    ],
    "toQueryParams must use `this`, not the object it was defined on"
  );

  // A criterion made by the card is recognised by the sidebar, and vice versa:
  // they are the same criterion underneath, so the two must not disagree.
  assert.deepStrictEqual(
    NS.readLanguageFilter(
      makeFilterModel([
        {
          criterionOption: { type: "language" },
          value: [
            {
              field: "plugin.mangaTools.language",
              modifier: "EQUALS",
              value: ["ja"],
            },
          ],
        },
      ])
    ),
    { modifier: "", included: ["ja"], excluded: [] },
    "the sidebar should read a filter set from the dialog"
  );

  // …and a filter set from the sidebar is made under our type, so it shows as the
  // Language card rather than as a generic custom field.
  encodedCriteria.length = 0;
  NS.languageFilterQuery(dialogModel, {
    modifier: "",
    included: ["ja"],
    excluded: [],
  });
  assert.strictEqual(
    encodedCriteria[0][0].criterionOption.type,
    "language",
    "the sidebar should create the criterion the dialog's card represents"
  );
  console.log(
    "✓ filter dialog card (registered once / usable criterion / stored as a custom field)"
  );

  // ── 10h. The card component itself ─────────────────────────────────
  // Nothing else renders it, and everything it does happens through DOM Stash
  // owns, so this is where the two watchers it installs are pinned down: the click
  // listener that catches Apply and Stash's own remove buttons, and the observer
  // that notices the card opening — the latter being the only route by which this
  // component can draw into a card Stash expanded *after* the render that mounted
  // it. Which is what a click on the tag does, and what left the card empty.
  //
  // The list it draws cannot be asserted here: the fake DOM runs no selectors
  // beyond the handful querySelector understands, so the card's box is never
  // found, and the stub's state setters are inert, so nothing re-renders anyway.
  const renderDialogCard = (conditions) => {
    // The card is rendered from GalleryList, whose patch wraps the list with it;
    // the sidebar's three sections are mounted through Stash's sidebar container
    // instead (see the sidebar's own tests).
    const el = call("GalleryList", {
      filter: makeFilterModel(
        conditions ? [customFieldsCriterion(conditions)] : []
      ),
      selectedIds: new Set(),
    }).props.children[0];
    return el.type(el.props);
  };
  renderDialogCard([
    { field: "plugin.mangaTools.language", modifier: "EQUALS", value: ["ja"] },
  ]);

  assert.strictEqual(observed.length, 1, "the card should watch the DOM once");
  assert.strictEqual(
    observed[0].target,
    global.document.body,
    "…on the document, because Stash mounts the dialog outside the list"
  );
  assert.strictEqual(
    observed[0].options.subtree,
    true,
    "…and into what is inside the dialog, not just the dialog itself"
  );

  const clicks = capturedClicks.filter((l) => l.name === "click");
  assert.strictEqual(clicks.length, 1, "and listen for clicks, once");
  assert.strictEqual(
    clicks[0].capture,
    true,
    "…on the capture phase, which is what makes Apply run before React's own render"
  );

  // The listener has to survive whatever the document hands it
  assert.doesNotThrow(() => {
    clicks[0].fn({ target: null });
    clicks[0].fn({ target: {} });
  });
  console.log("✓ dialog card component (click listener / DOM watcher)");

  // ── 10g. What Stash does with the criterion, and with its tag ──────
  // The criterion is stored as a custom field (see 10e), which left Stash treating
  // it as one: its tag opened the custom-fields card, and the Language card never
  // showed as the one in use. Adopting it fixes that without changing what is
  // stored — but only for a criterion that is wholly ours, since adopting another
  // one would mislabel it and hand it to Stash as the Language criterion.
  const adoptModel = (conditions) => {
    const model = makeFilterModel([customFieldsCriterion(conditions)]);
    NS.registerLanguageCriterionOption(model);
    return model;
  };

  const languageCondition = (field = "plugin.mangaTools.language") => [
    { field, modifier: "EQUALS", value: ["ja"] },
  ];

  let adopt = adoptModel(languageCondition());
  NS.adoptLanguageCriterion(adopt);
  assert.strictEqual(
    adopt.criteria[0].criterionOption.type,
    "language",
    "Stash should be told this criterion is the Language one"
  );
  assert.deepStrictEqual(
    adopt.criteria[0].toQueryParams(),
    { type: "custom_fields", value: languageCondition() },
    "…while the URL keeps carrying custom_fields — the only stored type that can " +
      "be read back on a reload, since Stash decodes the query string before this " +
      "plugin's option exists"
  );

  // The dialog works on a cloneDeep of the filter, so both have to survive being
  // copied onto a fresh criterion object. Object.assign stands in for it here.
  const adoptedClone = Object.assign({}, adopt.criteria[0]);
  assert.strictEqual(
    adoptedClone.criterionOption.type,
    "language",
    "the dialog's copy must stay ours"
  );
  assert.strictEqual(
    adoptedClone.toQueryParams().type,
    "custom_fields",
    "…including the stored form, which is what the dialog's Apply encodes"
  );
  assert.strictEqual(
    adopt.criteria[0].toQueryParams.call({ value: [] }).value.length,
    0,
    "toQueryParams must read `this`, not the criterion it was attached to"
  );

  // Exactly two properties, and no more. The other places Stash asks a criterion
  // to write itself out — applyToCriterionInput for the query, and
  // applyToSavedCriterion for a saved filter — are overridden on the custom-fields
  // class and write `input.custom_fields` without consulting criterionOption, so a
  // saved filter files the language where Stash always keeps custom fields and
  // reads it back. Shadowing either one with `this.criterionOption.type` would file
  // it under "language", which nothing can read back; this asserts the swap stays
  // out of them.
  assert.deepStrictEqual(
    Object.keys(adopt.criteria[0]).sort(),
    ["criterionOption", "toQueryParams", "value"],
    "adopting must add the two properties and touch nothing else"
  );

  // Adopting twice must not wrap anything or swap a second time
  adopt.criteria[0].criterionOption = { type: "language" };
  NS.adoptLanguageCriterion(adopt);
  assert.strictEqual(adopt.criteria[0].criterionOption.type, "language");
  assert.strictEqual(typeof adopt.criteria[0].toQueryParams, "function");

  // The field name is matched case-insensitively, as everywhere else
  adopt = adoptModel(languageCondition("plugin.mangaTools.Language"));
  NS.adoptLanguageCriterion(adopt);
  assert.strictEqual(
    adopt.criteria[0].criterionOption.type,
    "language",
    "a capitalised field name is still the language field"
  );

  adopt = adoptModel([{ field: "artist", modifier: "EQUALS", value: ["x"] }]);
  NS.adoptLanguageCriterion(adopt);
  assert.strictEqual(
    adopt.criteria[0].criterionOption.type,
    "custom_fields",
    "another field's criterion belongs to Stash and must be left alone"
  );

  adopt = adoptModel([
    { field: "plugin.mangaTools.language", modifier: "EQUALS", value: ["ja"] },
    { field: "artist", modifier: "EQUALS", value: ["x"] },
  ]);
  NS.adoptLanguageCriterion(adopt);
  assert.strictEqual(
    adopt.criteria[0].criterionOption.type,
    "custom_fields",
    "so must one that carries another field alongside ours"
  );

  adopt = adoptModel([]);
  NS.adoptLanguageCriterion(adopt);
  assert.strictEqual(
    adopt.criteria[0].criterionOption.type,
    "custom_fields",
    "and one with nothing in it to recognise"
  );

  // Stash's tag for this criterion is the generic custom-field sentence with the
  // raw field name in it. The tag itself is Stash's — its click and its ✗ already
  // do the right thing — so only the text node is replaced.
  //
  // A stand-in for a tag is `tagWithText`, from helpers.js — the same fixture the
  // sidebar sections' own tag tests use.
  const ourTag = tagWithText(
    "plugin.mangaTools.language (custom field) is ja, en"
  );
  const studioTag = tagWithText("Studio is J-Model");
  // The field is called "plugin.mangaTools.language", so a longer name that merely starts
  // with it
  // must not be mistaken for ours.
  const similarFieldTag = tagWithText(
    "plugin.mangaTools.languageNotes (custom field) is x"
  );
  const emptyTag = tagWithText(null);
  state.tagQuery = () => [studioTag, ourTag, similarFieldTag, emptyTag];
  NS.relabelTags(["语言 是 日语, 英语"]);
  state.tagQuery = () => [];
  assert.strictEqual(
    ourTag.firstChild.nodeValue,
    "语言 是 日语, 英语",
    "the language tag should be re-worded"
  );
  assert.strictEqual(
    studioTag.firstChild.nodeValue,
    "Studio is J-Model",
    "another criterion's tag must be left exactly as it is"
  );
  assert.strictEqual(
    similarFieldTag.firstChild.nodeValue,
    "plugin.mangaTools.languageNotes (custom field) is x",
    "a field whose name merely starts with the language field's must be left alone"
  );
  assert.strictEqual(
    emptyTag.firstChild.nodeValue,
    null,
    "a tag whose label is not a text node must be skipped, not crashed on"
  );

  // …and the re-worded tag is still known to be the language one afterwards, which
  // is what the dialog needs: it has to find the tag again on later renders, to
  // hide and to show it. The attribute recording the wording is how, since the
  // wording itself ("语言 是 …") no longer opens with the raw field name.
  state.tagQuery = () => [ourTag];
  NS.relabelTags(["语言 是 日语"]);
  state.tagQuery = () => [];
  assert.strictEqual(
    ourTag.firstChild.nodeValue,
    "语言 是 日语",
    "a tag whose wording this plugin wrote should be recognised again by its mark"
  );

  // One label per tag, in the order Stash draws them — which is the order of the
  // criterion's conditions. A filter with an exclusion is two tags, not one.
  const includedTag = tagWithText(
    "plugin.mangaTools.language (custom field) is ja"
  );
  const excludedTag = tagWithText(
    "plugin.mangaTools.language (custom field) is not ko"
  );
  state.tagQuery = () => [studioTag, includedTag, excludedTag];
  NS.relabelTags(["语言 是 日语", "语言 不是 韩语"]);
  state.tagQuery = () => [];
  assert.strictEqual(includedTag.firstChild.nodeValue, "语言 是 日语");
  assert.strictEqual(
    excludedTag.firstChild.nodeValue,
    "语言 不是 韩语",
    "the second tag takes the second label, not the first one again"
  );
  assert.strictEqual(
    studioTag.firstChild.nodeValue,
    "Studio is J-Model",
    "…and a tag in between that is not ours does not take a label"
  );

  // A tag for a modifier rather than values — "(None)", and "(Any)" likewise —
  // still opens with the field name, which is all a tag is recognised by.
  const nullTag = tagWithText(
    "plugin.mangaTools.language (custom field) is null"
  );
  state.tagQuery = () => [nullTag];
  NS.relabelTags(["语言 为空"]);
  state.tagQuery = () => [];
  assert.strictEqual(nullTag.firstChild.nodeValue, "语言 为空");

  // Nothing to say, or nothing to say it to, must both be no-ops
  const untouchedTag = tagWithText(
    "plugin.mangaTools.language (custom field) is ja"
  );
  state.tagQuery = () => [untouchedTag];
  NS.relabelTags([]);
  state.tagQuery = () => [];
  assert.strictEqual(
    untouchedTag.firstChild.nodeValue,
    "plugin.mangaTools.language (custom field) is ja",
    "an empty list of labels must leave the tags alone"
  );
  console.log(
    "✓ the criterion handed to Stash (identity, stored form, and its tags' wording)"
  );

  // ── 10i. The dialog's tag row ──────────────────────────────────────
  // The list's row reports the filter the list is applied to; the dialog's reports
  // the dialog's working copy, which for a language lives in this plugin's card
  // rather than in Stash's copy. So the two are worded differently, and the dialog's
  // is worded from the card on every commit — Stash's own tags, one label each.
  const dialogHostEl = makeEl("div");
  dialogHostEl.className = "edit-filter-dialog";
  const dialogContentEl = makeEl("div");
  dialogContentEl.className = "dialog-content";
  dialogHostEl.appendChild(dialogContentEl);
  documentRoot.appendChild(dialogHostEl);

  const dialogTagWithText = (value) =>
    tagWithText(value, [".edit-filter-dialog"]);

  // One tag, one label: Stash's tag is written into, and stays shown
  let dialogTag = dialogTagWithText(
    "plugin.mangaTools.language (custom field) is ja"
  );
  state.tagQuery = () => [dialogTag];
  NS.manageDialogTags(["语言 是 日语"]);
  state.tagQuery = () => [];
  assert.strictEqual(
    dialogTag.firstChild.nodeValue,
    "语言 是 日语",
    "Stash's tag should be worded the way this plugin words it"
  );
  assert.strictEqual(dialogTag.style.display, "", "…and left showing");
  state.tagQuery = () => [dialogTag];
  assert.deepStrictEqual(
    NS.ownTagLabels(["语言 是 日语"]),
    [],
    "…with nothing left for the card to draw itself"
  );
  state.tagQuery = () => [];

  // A second pass with the same labels must leave the DOM alone: this runs after
  // every commit, and a write per commit is a commit that never settles
  const writesSoFar = dialogTag.writes;
  state.tagQuery = () => [dialogTag];
  NS.manageDialogTags(["语言 是 日语"]);
  state.tagQuery = () => [];
  assert.strictEqual(
    dialogTag.writes,
    writesSoFar,
    "re-wording a tag it has already worded should write nothing"
  );

  // More labels than tags: the extra conditions have nowhere to go, so the card
  // draws them — this is the dialog that had no language at all when it opened
  dialogTag = dialogTagWithText(
    "plugin.mangaTools.language (custom field) is ja"
  );
  state.tagQuery = () => [dialogTag];
  NS.manageDialogTags(["语言 是 日语", "语言 不是 韩语"]);
  state.tagQuery = () => [];
  assert.strictEqual(
    dialogTag.firstChild.nodeValue,
    "语言 是 日语",
    "the first label goes into the tag Stash drew"
  );
  state.tagQuery = () => [dialogTag];
  assert.deepStrictEqual(
    NS.ownTagLabels(["语言 是 日语", "语言 不是 韩语"]),
    ["语言 不是 韩语"],
    "…and the rest are the card's to draw"
  );
  state.tagQuery = () => [];

  // Fewer labels than tags — an emptied card, or exclusions just taken off: the
  // tags with nothing to say step aside rather than repeat the last label
  const secondTag = dialogTagWithText(
    "plugin.mangaTools.language (custom field) is not ko"
  );
  state.tagQuery = () => [dialogTag, secondTag];
  NS.manageDialogTags(["语言 是 日语"]);
  state.tagQuery = () => [];
  assert.strictEqual(
    dialogTag.style.display,
    "",
    "a label with a tag keeps it shown"
  );
  assert.strictEqual(
    secondTag.style.display,
    "none",
    "a tag with no label to carry should step aside"
  );

  // …and back again, which is the pair that must not oscillate: showing it again
  // is the same comparison read the other way
  state.tagQuery = () => [dialogTag, secondTag];
  NS.manageDialogTags(["语言 是 日语", "语言 不是 韩语"]);
  state.tagQuery = () => [];
  assert.strictEqual(
    secondTag.style.display,
    "",
    "…and come back when the card has something for it again"
  );

  // An empty card takes them all away: the language is about to be removed
  state.tagQuery = () => [dialogTag, secondTag];
  NS.manageDialogTags([]);
  state.tagQuery = () => [];
  assert.strictEqual(dialogTag.style.display, "none");
  assert.strictEqual(secondTag.style.display, "none");
  state.tagQuery = () => [dialogTag, secondTag];
  assert.deepStrictEqual(
    NS.ownTagLabels([]),
    [],
    "an empty card draws nothing of its own either"
  );
  state.tagQuery = () => [];

  documentRoot.detach(dialogHostEl);

  // The ✗ on Stash's tag takes the criterion out of the dialog's copy, and the card
  // has to follow it — otherwise the card goes on showing a language the dialog has
  // dropped. The tag's label is Stash's way into the card and must not be taken for
  // the ✗, nor another criterion's tag for ours.
  const clickInside = (where) => ({
    closest: (sel) => (sel in where ? where[sel] : null),
  });
  const tagInDialog = () =>
    tagWithText("plugin.mangaTools.language (custom field) is ja", [
      ".edit-filter-dialog",
    ]);
  const removeClick = (tag, extra = {}) =>
    clickInside(
      Object.assign(
        {
          ".filter-tags .tag-item button": tag,
          ".edit-filter-dialog": {},
          ".tag-item": tag,
        },
        extra
      )
    );

  assert.strictEqual(
    NS.clickedTagRemove(removeClick(tagInDialog())),
    true,
    "the ✗ of the dialog's language tag is what the card follows"
  );
  assert.strictEqual(
    NS.clickedTagRemove(
      clickInside({ ".edit-filter-dialog": {}, ".tag-item": tagInDialog() })
    ),
    false,
    "the tag itself is Stash's way into the card, not a removal"
  );
  assert.strictEqual(
    NS.clickedTagRemove(
      removeClick(
        tagWithText("plugin.mangaTools.language (custom field) is ja", [
          ".edit-filter-dialog",
          ".criterion-list",
        ])
      )
    ),
    false,
    "the pills a card draws beside its editor are Stash's record, not the row"
  );
  assert.strictEqual(
    NS.clickedTagRemove(removeClick(tagWithText("Studio is J-Model"))),
    false,
    "another criterion's ✗ is not this plugin's business"
  );
  assert.strictEqual(
    NS.clickedTagRemove(
      clickInside({
        ".filter-tags .tag-item button": tagInDialog(),
        ".tag-item": tagInDialog(),
      })
    ),
    false,
    "…and the list's own row is not the dialog's"
  );
  assert.strictEqual(NS.clickedTagRemove(null), false);
  console.log(
    "✓ dialog tags (worded from the card / tags with nothing to say step aside / ✗ follows)"
  );

  // ── 10f. The selection operations both surfaces share ──────────────
  // Pure functions, so they can be tested directly rather than through two
  // components. They are what the sidebar section and the dialog's card both mean
  // by a click; the two commit at different times, which is exactly why the
  // meaning has to live in one place.
  // `sel` is the selection fixture helpers.js defines for all three sections.
  assert.deepStrictEqual(
    NS.toggleIncluded(sel(), "ja"),
    sel("", ["ja"]),
    "a pick adds to the included list"
  );
  assert.deepStrictEqual(
    NS.toggleIncluded(sel("", ["ja"]), "ja"),
    sel(),
    "picking the same one again takes it out"
  );
  assert.deepStrictEqual(
    NS.toggleIncluded(sel("", ["ja"]), "en"),
    sel("", ["ja", "en"]),
    "several values are a union, not a replacement"
  );
  assert.deepStrictEqual(
    NS.toggleIncluded(sel("none"), "ja"),
    sel("", ["ja"]),
    "picking a value leaves the (None) state"
  );
  assert.deepStrictEqual(
    NS.toggleIncluded(sel("", [], ["ja"]), "ja"),
    sel("", ["ja"]),
    "…and moves a value out of the excluded list: one or the other, never both"
  );

  assert.deepStrictEqual(NS.toggleExcluded(sel(), "ko"), sel("", [], ["ko"]));
  assert.deepStrictEqual(
    NS.toggleExcluded(sel("", ["ko"]), "ko"),
    sel("", [], ["ko"]),
    "excluding a value includes no longer"
  );

  assert.deepStrictEqual(
    NS.withModifier(sel("", ["ja"]), "any"),
    sel("any"),
    "(Any) cannot be said at the same time as particular values, so the values go"
  );
  assert.deepStrictEqual(
    NS.withoutModifier(sel("none")),
    sel(),
    "clearing the modifier leaves no restriction"
  );
  assert.deepStrictEqual(
    NS.withoutModifier(sel("none", ["ja"])),
    sel("", ["ja"]),
    "…and keeps any values that were there"
  );

  assert.strictEqual(NS.isEmptySelection(sel()), true);
  assert.strictEqual(NS.isEmptySelection(sel("any")), false);
  assert.strictEqual(NS.isEmptySelection(sel("", ["ja"])), false);
  assert.strictEqual(
    NS.sameSelection(sel("", ["ja", "en"]), sel("", ["en", "ja"])),
    true,
    "compared as sets: click order must not count as a change"
  );
  assert.strictEqual(
    NS.sameSelection(sel("", ["ja"]), sel("", ["ja", "en"])),
    false
  );
  assert.strictEqual(NS.sameSelection(sel("any"), sel("none")), false);
  console.log(
    "✓ selection operations (toggle / modifier / emptiness / sameness)"
  );

  // The tag text, assembled from Stash's own messages so a tag reads like one
  // Stash draws. Per condition, because Stash draws a tag per condition — which is
  // how a filter with exclusions comes out as two sentences rather than one.
  // `useIntl` here is the stub's, not React's: these call the plugin's helpers
  // directly rather than rendering a component.
  const intl = PluginApi.libraries.Intl.useIntl();
  const condition = (modifier, value) => ({
    field: "plugin.mangaTools.language",
    modifier,
    value,
  });
  assert.strictEqual(
    NS.conditionLabel(intl, condition("EQUALS", ["ja", "en"])),
    "语言 是 日语, 英语",
    "the criterion's localised name, the modifier's label, the values joined"
  );
  assert.strictEqual(
    NS.conditionLabel(intl, condition("NOT_EQUALS", ["ko"])),
    "语言 不是 韩语",
    "an exclusion is a sentence of its own"
  );
  assert.strictEqual(
    NS.conditionLabel(intl, condition("NOT_NULL")),
    "语言 不为空 ",
    "(Any) is not-null, and says so — that is what it produces"
  );
  assert.strictEqual(
    NS.conditionLabel(intl, condition("IS_NULL")),
    "语言 为空 ",
    "…and (None) is null"
  );
  assert.strictEqual(
    NS.conditionLabel(intl, condition("GREATER_THAN", ["1"])),
    null,
    "a modifier this plugin has no wording for is left to Stash"
  );

  // …and a whole criterion is one label per condition, in its order
  assert.deepStrictEqual(
    NS.tagLabels(intl, {
      value: [condition("EQUALS", ["ja"]), condition("NOT_EQUALS", ["ko"])],
    }),
    ["语言 是 日语", "语言 不是 韩语"],
    "a filter with picks and exclusions is two tags, as Stash draws it"
  );
  assert.deepStrictEqual(
    NS.tagLabels(intl, { value: [condition("EQUALS", ["ja"])] }),
    ["语言 是 日语"]
  );
  assert.strictEqual(
    NS.tagLabels(intl, {
      value: [condition("EQUALS", ["ja"]), condition("GREATER_THAN", ["1"])],
    }),
    null,
    "one condition without wording is enough to leave the whole criterion to Stash"
  );
  assert.strictEqual(
    NS.tagLabels(intl, { value: [] }),
    null,
    "and a criterion with nothing in it has no tags to word"
  );

  // What the sidebar sections actually ask for: one field's tags, out of the
  // criterion the filter holds. The three fields share a criterion, so a filter
  // with a language and a censorship in it is *one* criterion with two
  // conditions — and each field's tag takes its own wording, in the order Stash
  // draws them.
  const mixedFieldCriterion = makeFilterModel([
    customFieldsCriterion([
      { field: NS.MANGA_FIELD_NAME, modifier: "NOT_NULL" },
      condition("EQUALS", ["ja"]),
      {
        field: NS.CENSORSHIP_FIELD_NAME,
        modifier: "EQUALS",
        value: ["censored"],
      },
    ]),
  ]);
  assert.deepStrictEqual(
    NS.fieldTagLabels(intl, mixedFieldCriterion, NS.FIELD_NAME),
    ["语言 是 日语"],
    "the language tag is worded from the language conditions alone"
  );
  assert.deepStrictEqual(
    NS.fieldTagLabels(intl, mixedFieldCriterion, NS.CENSORSHIP_FIELD_NAME),
    ["修正 是 有修正"],
    "and the censorship tag from its own — not with the other field's wording, " +
      "which is what taking the criterion as a whole would put there"
  );
  assert.deepStrictEqual(
    NS.fieldTagLabels(intl, mixedFieldCriterion, NS.MANGA_FIELD_NAME),
    ["漫画 是 已标记"]
  );

  // Two conditions of one field are two tags, as Stash draws them
  assert.deepStrictEqual(
    NS.fieldTagLabels(
      intl,
      makeFilterModel([
        customFieldsCriterion([
          condition("EQUALS", ["ja"]),
          condition("NOT_EQUALS", ["ko"]),
        ]),
      ]),
      NS.FIELD_NAME
    ),
    ["语言 是 日语", "语言 不是 韩语"]
  );

  // Nothing to word, or nothing this plugin can word: both leave Stash's own
  // wording alone rather than writing a sentence of its own.
  assert.strictEqual(
    NS.fieldTagLabels(intl, makeFilterModel(), NS.FIELD_NAME),
    null,
    "a field the filter says nothing about has no wording of this plugin's"
  );
  assert.strictEqual(
    NS.fieldTagLabels(
      intl,
      makeFilterModel([
        customFieldsCriterion([condition("GREATER_THAN", ["1"])]),
      ]),
      NS.FIELD_NAME
    ),
    null,
    "one condition without wording is enough to leave that field's tags to Stash"
  );
  console.log(
    "✓ tag wording (per condition, built from Stash's messages not a table of ours)"
  );
};
