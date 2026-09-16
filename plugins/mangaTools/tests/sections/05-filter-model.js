/**
 * 10c–10c2: what the filter reads out of the query and what it writes back —
 * the language, censorship and manga criteria, all on the one custom-fields
 * type Stash always understands.
 */

const assert = require("node:assert");
const {
  NS,
  censorshipConditionsOf,
  conditionsOf,
  customFieldsCriterion,
  encodedCriteria,
  makeFilterModel,
  mangaConditionsOf,
  sel,
} = require("../helpers.js");

module.exports = () => {
  // ── 10c. Gallery list: what the language filter reads and writes ───
  // The filter works by rewriting the URL, which Stash's list hook re-reads on
  // every navigation. So what is worth testing is exactly what this plugin
  // contributes: which conditions it merges into the filter, that it leaves the
  // rest of the filter alone, and that the section looks like one of Stash's own.

  // --- reading: every shape the model can be in ---------------------
  assert.deepStrictEqual(
    NS.readLanguageFilter(makeFilterModel()),
    sel(),
    "a filter with no criteria means no language selection"
  );
  assert.deepStrictEqual(
    NS.readLanguageFilter(
      makeFilterModel([customFieldsCriterion([conditionsOf("NOT_NULL")])])
    ),
    sel("any"),
    "NOT_NULL is the (Any) state"
  );
  assert.deepStrictEqual(
    NS.readLanguageFilter(
      makeFilterModel([customFieldsCriterion([conditionsOf("IS_NULL")])])
    ),
    sel("none"),
    "IS_NULL is the (None) state"
  );
  assert.deepStrictEqual(
    NS.readLanguageFilter(
      makeFilterModel([customFieldsCriterion([conditionsOf("EQUALS", ["ja"])])])
    ),
    sel("", ["ja"]),
    "EQUALS is an included value"
  );
  assert.deepStrictEqual(
    NS.readLanguageFilter(
      makeFilterModel([
        customFieldsCriterion([conditionsOf("NOT_EQUALS", ["ko"])]),
      ])
    ),
    sel("", [], ["ko"]),
    "NOT_EQUALS is an excluded value"
  );
  assert.deepStrictEqual(
    NS.readLanguageFilter(
      makeFilterModel([
        customFieldsCriterion([
          conditionsOf("EQUALS", ["ja"]),
          conditionsOf("NOT_EQUALS", ["ko"]),
        ]),
      ])
    ),
    sel("", ["ja"], ["ko"]),
    "include and exclude are two conditions and both are read"
  );
  assert.deepStrictEqual(
    NS.readLanguageFilter(
      makeFilterModel([
        customFieldsCriterion([
          conditionsOf("EQUALS", ["ja"]),
          { field: "author", modifier: "EQUALS", value: ["x"] },
        ]),
      ])
    ),
    sel("", ["ja"]),
    "another field's condition is not a language selection"
  );
  assert.deepStrictEqual(
    NS.readLanguageFilter(
      makeFilterModel([
        customFieldsCriterion([
          {
            field: "plugin.mangaTools.Language",
            modifier: "EQUALS",
            value: ["ja"],
          },
        ]),
      ])
    ),
    sel("", ["ja"]),
    "field names are matched case-insensitively, as everywhere else in this plugin"
  );
  assert.deepStrictEqual(
    NS.readLanguageFilter(
      makeFilterModel([
        customFieldsCriterion([conditionsOf("MATCHES_REGEX", ["ja"])]),
      ])
    ),
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
      criteria: encodedCriteria.length
        ? encodedCriteria[encodedCriteria.length - 1]
        : null,
    };
  }
  const languageConditions = (criteria) =>
    (criteria || [])
      .filter(
        (c) => c.criterionOption && c.criterionOption.type === "custom_fields"
      )
      .flatMap((c) => c.value || []);

  let w = writeFilter(sel("", ["ja"]));
  assert.ok(w.result, "a selection should produce query parameters");
  assert.deepStrictEqual(languageConditions(w.criteria), [
    conditionsOf("EQUALS", ["ja"]),
  ]);

  // The two modifier states carry no value at all
  assert.deepStrictEqual(
    languageConditions(writeFilter(sel("any")).criteria),
    [conditionsOf("NOT_NULL")],
    "(Any) should be NOT_NULL"
  );
  assert.deepStrictEqual(
    languageConditions(writeFilter(sel("none")).criteria),
    [conditionsOf("IS_NULL")],
    "(None) should be IS_NULL"
  );

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
  assert.deepStrictEqual(
    liveModel.criteria[0].value,
    [conditionsOf("EQUALS", ["ja"])],
    "the live filter model must not be mutated"
  );

  // Another custom field's condition survives: this composes with a hand-made
  // filter rather than discarding it.
  w = writeFilter(sel("", ["ja"]), [
    { field: "author", modifier: "EQUALS", value: ["x"] },
    conditionsOf("EQUALS", ["ko"]),
  ]);
  assert.deepStrictEqual(
    languageConditions(w.criteria),
    [
      { field: "author", modifier: "EQUALS", value: ["x"] },
      conditionsOf("EQUALS", ["ja"]),
    ],
    "another custom field's condition should be kept, and the language replaced"
  );

  // A case variant of the field name is dropped, for the same reason.
  w = writeFilter(sel("", ["ja"]), [
    { field: "plugin.mangaTools.Language", modifier: "EQUALS", value: ["ko"] },
  ]);
  assert.deepStrictEqual(
    languageConditions(w.criteria),
    [conditionsOf("EQUALS", ["ja"])],
    "a capitalised field name must not leave a second condition behind"
  );

  // Clearing removes the conditions, and the criterion with them — an empty
  // criterion would otherwise show up as a filter tag with nothing in it.
  assert.deepStrictEqual(
    writeFilter(sel(), [conditionsOf("EQUALS", ["ja"])]).criteria,
    [],
    "clearing should drop the criterion entirely"
  );
  assert.deepStrictEqual(
    languageConditions(
      writeFilter(sel(), [
        conditionsOf("EQUALS", ["ja"]),
        { field: "author", modifier: "EQUALS", value: ["x"] },
      ]).criteria
    ),
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
  assert.deepStrictEqual(
    encodedCriteria[0].map((c) => c.criterionOption.type),
    ["studios", "custom_fields"],
    "unrelated criteria should be kept, with ours alongside"
  );
  assert.deepStrictEqual(
    encodedCriteria[0][0].value,
    [],
    "…and left untouched"
  );

  // A filter that offers no custom-fields criterion cannot take one
  const noCustomFields = makeFilterModel([]);
  noCustomFields.options = { criterionOptions: [] };
  assert.strictEqual(
    NS.languageFilterQuery(noCustomFields, sel("", ["ja"])),
    null,
    "without the option there is nowhere to put the condition, and it says so"
  );

  // What the dialog's Apply merges into is the model the plugin was rendered with —
  // *not* one rebuilt from the URL Stash has just written. That was tried, to stop a
  // criterion the dialog removed from coming back, and it took the page down: the
  // filter's criteria then disagree with the URL's, Stash's own hook stops
  // recognising the two as the same filter, and the URL and the filter state rewrite
  // each other until React gives up. A merge may change the language, never which
  // criteria are set.
  const mergeModel = makeFilterModel([
    { criterionOption: { type: "organized" }, value: [] },
    customFieldsCriterion([conditionsOf("EQUALS", ["ja"])]),
  ]);
  encodedCriteria.length = 0;
  NS.languageFilterQuery(mergeModel, sel("", ["ko"]));
  assert.deepStrictEqual(
    encodedCriteria[0].map((c) => c.criterionOption.type),
    ["organized", "custom_fields"],
    "the merge should leave every other criterion exactly as the model has it"
  );
  assert.deepStrictEqual(
    encodedCriteria[0][1].value,
    [conditionsOf("EQUALS", ["ko"])],
    "…changing only the language"
  );
  assert.deepStrictEqual(
    mergeModel.criteria.map((c) => c.criterionOption.type),
    ["organized", "custom_fields"],
    "…and the model it merged from is untouched"
  );

  console.log(
    "✓ filter conditions (read any/none/include/exclude, write, merge, clear, not mutated)"
  );

  // ── 10c2. Censorship and manga: the same rules, on their own fields ──
  // The censorship filter is the language filter's shape on a second field; the
  // manga filter is a boolean on a third. All three share the one custom-fields
  // criterion, so what is worth testing is that each field reads and writes its own
  // conditions and leaves the others' alone.

  assert.deepStrictEqual(
    NS.readCensorshipFilter(makeFilterModel()),
    sel(),
    "a filter with no criteria means no censorship selection"
  );
  assert.deepStrictEqual(
    NS.readCensorshipFilter(
      makeFilterModel([
        customFieldsCriterion([censorshipConditionsOf("NOT_NULL")]),
      ])
    ),
    sel("any"),
    "NOT_NULL is the (Any) state for censorship"
  );
  assert.deepStrictEqual(
    NS.readCensorshipFilter(
      makeFilterModel([
        customFieldsCriterion([censorshipConditionsOf("IS_NULL")]),
      ])
    ),
    sel("none"),
    "IS_NULL is the (None) state for censorship"
  );
  assert.deepStrictEqual(
    NS.readCensorshipFilter(
      makeFilterModel([
        customFieldsCriterion([censorshipConditionsOf("EQUALS", ["censored"])]),
      ])
    ),
    sel("", ["censored"]),
    "EQUALS is an included censorship value"
  );
  assert.deepStrictEqual(
    NS.readCensorshipFilter(
      makeFilterModel([
        customFieldsCriterion([
          censorshipConditionsOf("NOT_EQUALS", ["uncensored"]),
        ]),
      ])
    ),
    sel("", [], ["uncensored"]),
    "NOT_EQUALS is an excluded censorship value"
  );
  assert.deepStrictEqual(
    NS.readCensorshipFilter(
      makeFilterModel([
        customFieldsCriterion([
          censorshipConditionsOf("EQUALS", ["censored"]),
          conditionsOf("EQUALS", ["ja"]),
        ]),
      ])
    ),
    sel("", ["censored"]),
    "the language field's condition is not a censorship selection"
  );

  // writing: the censorship conditions replace only themselves
  function writeCensorship(selection, conditions) {
    const model = makeFilterModel(
      conditions === undefined ? [] : [customFieldsCriterion(conditions)]
    );
    encodedCriteria.length = 0;
    const result = NS.censorshipFilterQuery(model, selection);
    return {
      result,
      criteria: encodedCriteria.length
        ? encodedCriteria[encodedCriteria.length - 1]
        : null,
    };
  }
  let r = writeCensorship(sel("", ["censored"]));
  assert.ok(r.result, "a censorship selection should produce query parameters");
  assert.deepStrictEqual(
    languageConditions(r.criteria),
    [censorshipConditionsOf("EQUALS", ["censored"])],
    "an empty filter becomes one censorship condition"
  );
  assert.strictEqual(
    r.criteria[0].criterionOption.type,
    "custom_fields",
    "created under the custom-fields identity, since no censorship card is registered"
  );

  // …and it keeps the language condition beside its own
  r = writeCensorship(sel("", [], ["uncensored"]), [
    conditionsOf("EQUALS", ["ja"]),
  ]);
  assert.deepStrictEqual(
    languageConditions(r.criteria),
    [
      conditionsOf("EQUALS", ["ja"]),
      censorshipConditionsOf("NOT_EQUALS", ["uncensored"]),
    ],
    "the censorship write keeps the language condition and adds its own"
  );

  // clearing drops only the censorship condition
  r = writeCensorship(sel(), [
    conditionsOf("EQUALS", ["ja"]),
    censorshipConditionsOf("EQUALS", ["censored"]),
  ]);
  assert.deepStrictEqual(
    languageConditions(r.criteria),
    [conditionsOf("EQUALS", ["ja"])],
    "an empty censorship selection removes its condition and keeps the language's"
  );

  // ── manga: a single choice among two ──

  assert.strictEqual(
    NS.readMangaFilter(makeFilterModel()),
    "",
    "no criteria means no manga state"
  );
  assert.strictEqual(
    NS.readMangaFilter(
      makeFilterModel([customFieldsCriterion([mangaConditionsOf("NOT_NULL")])])
    ),
    "marked",
    "NOT_NULL is the marked state"
  );
  assert.strictEqual(
    NS.readMangaFilter(
      makeFilterModel([customFieldsCriterion([mangaConditionsOf("IS_NULL")])])
    ),
    "unmarked",
    "IS_NULL is the unmarked state"
  );
  assert.strictEqual(
    NS.readMangaFilter(
      makeFilterModel([
        customFieldsCriterion([
          conditionsOf("EQUALS", ["ja"]),
          mangaConditionsOf("NOT_NULL"),
        ]),
      ])
    ),
    "marked",
    "the manga state is read beside another field's condition"
  );

  function writeManga(selection, conditions) {
    const model = makeFilterModel(
      conditions === undefined ? [] : [customFieldsCriterion(conditions)]
    );
    encodedCriteria.length = 0;
    const result = NS.mangaFilterQuery(model, selection);
    return {
      result,
      criteria: encodedCriteria.length
        ? encodedCriteria[encodedCriteria.length - 1]
        : null,
    };
  }
  assert.deepStrictEqual(
    languageConditions(writeManga("marked").criteria),
    [mangaConditionsOf("NOT_NULL")],
    "marked becomes NOT_NULL"
  );
  assert.deepStrictEqual(
    languageConditions(writeManga("unmarked").criteria),
    [mangaConditionsOf("IS_NULL")],
    "unmarked becomes IS_NULL"
  );
  assert.deepStrictEqual(
    writeManga("", [mangaConditionsOf("NOT_NULL")]).criteria,
    [],
    "clearing the manga state drops the criterion entirely"
  );

  // the three compose: language + censorship + manga on the one criterion
  assert.deepStrictEqual(
    languageConditions(
      writeManga("marked", [
        conditionsOf("EQUALS", ["ja"]),
        censorshipConditionsOf("EQUALS", ["censored"]),
      ]).criteria
    ),
    [
      conditionsOf("EQUALS", ["ja"]),
      censorshipConditionsOf("EQUALS", ["censored"]),
      mangaConditionsOf("NOT_NULL"),
    ],
    "the manga write keeps both other fields and adds its own"
  );

  console.log(
    "✓ censorship & manga filters (read and write, composed on the one criterion)"
  );
};
