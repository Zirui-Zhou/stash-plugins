/**
 * 1–5b: the language catalogue — what a code normalises to, what name the
 * platform gives it, what the dropdown offers, and in what order.
 */

const assert = require("node:assert");
const {
  FakeDisplayNames,
  NS,
  displayNamesCalls,
  realDisplayNames,
  state,
} = require("../helpers.js");

module.exports = () => {
  // ── 1. Normalisation ───────────────────────────────────────────────
  // Values are only ever written by this plugin's own dropdown, so only letter
  // case and surrounding whitespace are tolerated. Anything else is returned
  // unchanged and described as unknown (a grey "unrecognised" chip).
  const cases = [
    ["zh-Hans", "zh-Hans"],
    ["zh-Hant", "zh-Hant"],
    ["ja", "ja"],
    ["en", "en"],
    ["ZH-HANS", "zh-Hans"],
    ["Zh-Hant", "zh-Hant"], // case-insensitive
    ["  en  ", "en"],
    ["\tja\n", "ja"], // surrounding whitespace
    ["chs", "chs"],
    ["简体", "简体"],
    ["jp", "jp"], // former aliases no longer resolve
    ["zh-TW", "zh-TW"],
    ["中文", "中文"],
    ["chi", "chi"],
    ["klingon", "klingon"],
    ["zh", "zh"], // unrecognised: returned as-is
    ["", ""],
    [null, ""],
    [undefined, ""],
  ];
  for (const [input, want] of cases) {
    assert.strictEqual(
      NS.normalize(input),
      want,
      `normalize(${JSON.stringify(input)})`
    );
  }
  console.log(`✓ normalisation: all ${cases.length} cases pass`);

  // ── 2. The locale handed to Intl.DisplayNames ──────────────────────
  // Names come from the platform now, so what this plugin is responsible for is
  // *which locale it asks for*. It must be Stash's UI locale (react-intl's,
  // which Stash sets from Configuration.interface.language) and it must be sent
  // with English beside it: given a locale on its own, an engine that does not
  // know it resolves against the runtime's default locale — the browser's —
  // silently, which would quietly break "names follow the Stash language".
  /** The most recent construction the plugin performed */
  const lastDisplayNames = () =>
    displayNamesCalls[displayNamesCalls.length - 1];

  assert.strictEqual(NS.name("ja", "zh-CN"), "日语");
  assert.deepStrictEqual(
    lastDisplayNames().locales,
    ["zh-CN", "en"],
    "Stash's locale first, English second — never the locale alone"
  );
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
  assert.strictEqual(
    displayNamesCalls.length,
    callsBefore,
    "a warm locale must reuse its formatter"
  );
  console.log(
    "✓ Intl.DisplayNames is asked for [Stash locale, English], once per locale"
  );

  // ── 3. Localised names ─────────────────────────────────────────────
  // Still "canonical code → name looked up when rendering → raw value otherwise",
  // but the names are the platform's, so the expected strings here are the
  // stub's — they describe the handoff, not a table this plugin maintains.
  assert.strictEqual(NS.name("ja", "zh-CN"), "日语");
  assert.strictEqual(
    NS.name("ja", "zh-TW"),
    "日文",
    "the Taiwan wording, which the old table got wrong"
  );
  assert.strictEqual(NS.name("ja", "en-US"), "Japanese");
  assert.strictEqual(NS.name("ja", "ja-JP"), "日本語");
  assert.strictEqual(NS.name("zh-Hant", "zh-CN"), "繁体中文");
  assert.strictEqual(
    NS.name("ZH-HANS", "zh-CN"),
    "简体中文",
    "non-canonical case still resolves"
  );
  assert.strictEqual(
    NS.name("chs", "zh-CN"),
    "chs",
    "non-canonical spelling returned as-is, never guessed"
  );
  assert.strictEqual(
    NS.name("ja", "de-DE"),
    "Japanisch",
    "a UI language the old four-locale table had no entry for now resolves"
  );
  assert.strictEqual(
    NS.name("klingon", "zh-CN"),
    "klingon",
    "unknown code returned as-is"
  );

  // Recognition stays ours. DisplayNames would happily name "chi" and "jpn"
  // (ISO 639-2), and those must keep reading as unrecognised data.
  assert.strictEqual(
    NS.name("chi", "zh-CN"),
    "chi",
    "alpha-3 is not one of our codes"
  );
  assert.strictEqual(
    NS.name("jpn", "ja-JP"),
    "jpn",
    "…even in its own UI language"
  );

  // Falsy locale: ask for the fallback rather than for "" (which throws)
  assert.strictEqual(NS.name("ja", ""), "Japanese");
  assert.strictEqual(
    NS.name("ja"),
    "Japanese",
    "no locale at all still yields a name"
  );
  console.log(
    "✓ localised names (any UI language, canonical recognition, unknown echoed)"
  );

  // ── 3b. Degrading when the platform cannot help ────────────────────
  // Two ways, both of which must leave the raw code rather than throwing or
  // inventing English. Each uses a UI locale no earlier test has asked for, so
  // the plugin's per-locale cache cannot mask the failure.
  state.displayNamesThrows = true;
  assert.strictEqual(
    NS.name("ja", "pl-PL"),
    "ja",
    "a rejected locale degrades to the code"
  );
  state.displayNamesThrows = false;

  global.Intl.DisplayNames = undefined;
  assert.strictEqual(
    NS.name("ja", "nl-NL"),
    "ja",
    "no DisplayNames at all degrades to the code"
  );
  assert.strictEqual(
    NS.describe("zh-Hant", "nl-NL").name,
    "zh-Hant",
    "…and the rest of the description still renders"
  );
  global.Intl.DisplayNames = FakeDisplayNames;

  assert.strictEqual(
    typeof realDisplayNames,
    "function",
    "precondition: the runtime has a real DisplayNames, so the stub is the only difference"
  );
  console.log(
    "✓ degraded paths (rejected locale / absent API) fall back to the code"
  );

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
  assert.strictEqual(
    NS.describe("vi", "zh-CN").flag,
    "vn",
    "Vietnam is vn, not vi"
  );

  // Non-canonical spellings (former aliases, other notations) are all unknown now
  // and are no longer silently corrected.
  ["chs", "简体", "jp", "zh-TW", "中文"].forEach((v) => {
    const r = NS.describe(v, "zh-CN");
    assert.strictEqual(
      r.known,
      false,
      `${v} should no longer resolve as a language`
    );
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
    assert.ok(
      entry.flag && entry.flag.length === 2,
      `${code} is missing a flag code`
    );
  });
  const offered = NS.languageOptions("en-US").map((o) => o.value);
  assert.deepStrictEqual(
    offered.slice().sort(),
    Object.keys(NS.LANGUAGES).sort(),
    "every language in the table should be offered, and nothing else"
  );
  assert.strictEqual(
    new Set(offered).size,
    offered.length,
    "no language should be offered twice"
  );
  console.log(
    `✓ language table complete (${Object.keys(NS.LANGUAGES).length} codes × flag, all offered)`
  );

  // ── 5b. The dropdown is ordered by the name the reader sees ────────
  // There is no hand-written order any more — the old one was the author's
  // languages first, then European, then the rest. Read off the English names,
  // where the expected sequence is verifiable by eye.
  assert.deepStrictEqual(
    NS.languageOptions("en-US").map((o) => o.label),
    [
      "English",
      "French",
      "German",
      "Indonesian",
      "Italian",
      "Japanese",
      "Korean",
      "Portuguese",
      "Russian",
      "Simplified Chinese",
      "Spanish",
      "Thai",
      "Traditional Chinese",
      "Vietnamese",
    ],
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
  assert.notDeepStrictEqual(
    zhOptions.map((o) => o.value),
    enValues,
    "a different UI language should order the same languages differently"
  );
  assert.deepStrictEqual(
    zhOptions.map((o) => o.value).sort(),
    enValues.slice().sort(),
    "…without changing which languages are offered"
  );
  console.log(
    "✓ dropdown order (by displayed name, in the reader's collation)"
  );
};
