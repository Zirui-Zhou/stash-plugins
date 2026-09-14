# Manga Tools

A toolbox that adapts Stash galleries to manga/comic management. It **does not
modify Stash core code** — everything goes through the UI plugin API, so Stash
upgrades never produce merge conflicts.

## Features

| Feature | What it adds |
|---|---|
| **Language** | A language attribute on galleries, surfaced as a flag badge, an edit-page dropdown and a localised detail row |
| **Settings** | An "Enabled languages" multiselect that limits which languages the edit-page dropdown offers — display is unaffected |

Each feature occupies its own section below, and each keeps to the same rule:
anything it does not own is handed straight back to Stash untouched.

### Language

Adds a "language" property to galleries.

| Where | Effect |
|---|---|
| Gallery list / card | A **regional flag** in the bottom-right of the cover (Japan, China, Taiwan…). Fades out on hover like the studio icon, clearing the cover |
| Gallery edit page | A "language" dropdown **between "studio" and "performers"**, listing "flag + localised name" — no typing codes by hand |
| Gallery detail page | An extra `<h6>` row **below "photographer", above "details"**, showing "flag + localised name" with the same label and font as the rows around it |

**Both of those positions rely on DOM plus a React portal, not a plain React
patch.** Stash leaves no insertion point at either one:

- **Detail page**: everything inside `.gallery-details` is a bare `<h6>`. The
  only component there is `PhotographerLink`, and neither it nor its parent
  `GalleryDetailPanel` is patchable. The plugin appends an empty container to the
  end of `.gallery-details`, which lands exactly after "photographer" and before
  "details".
- **Edit page**: `StudioSelect` *is* patchable, but it renders **inside a
  `<Col>`**, so anything injected there is nested in that column and the label
  column stops lining up with the fields above. Instead a sibling field row is
  inserted into the DOM, anchored on the `data-field="studio_id"` attribute that
  `renderField` leaves on every row (see `ui/v2.5/src/utils/form.tsx`) — far more
  stable than walking the element structure.

  **The column widths are copied off the native field's DOM rather than
  computed.** This came out of a real bug: `labelProps { sm:3, xl:2 }` /
  `fieldProps { sm:9, xl:7 }` were hard-coded from the develop branch's defaults,
  but the build actually running has **no `xl`** in its defaults, so on wide
  screens the label column came out narrower than the native ones and nothing
  lined up. Copying the classes that are already there is correct regardless of
  Stash version or breakpoint.

  The dropdown itself matches Stash's look too: `classNamePrefix: "react-select"`
  reuses its theme, and `components: { IndicatorSeparator: () => null }` removes
  the vertical rule react-select draws between the clear and expand icons —
  which is exactly what Stash's own `Select.tsx` does in its default props.

Both positions only insert an **empty div**; the content is rendered by a React
portal, so a UI language change or a value change updates automatically. No HTML
is written into the DOM by hand.

The "language" label comes straight from Stash's own locale files
(`config.ui.language.heading`) rather than a table maintained here — verified to
exist in every locale shipped with v0.31.1 (`语言` / `語言` / `Language` / `言語` /
`언어` / `Sprache`…), which gets all ~40 of Stash's UI languages for free.

Flags use `flag-icons`, which Stash already loads globally in `index.scss`, so the
plugin emits `<span class="fi fi-jp">` and ships **no extra assets**. They look
identical to the nationality flags on performer pages.

The data lives in the Gallery's **custom fields**: `custom_fields.language`. What
is stored is the canonical code, not the display name — the same approach Stash
takes for performer nationality (store `US`, display `United States`).

The semantic meaning is **the language of the comic itself**, not whether it is
raw or translated.

### Settings

Adds an "Enabled languages" multiselect under **Settings → Plugins → Manga
Tools**.

| Setting | Effect |
|---|---|
| **Enabled languages** | Limits which languages the edit-page dropdown offers; empty = every language |

An empty value shows an "All languages" placeholder rather than every tag; only a
chosen subset renders tags.

It is a *custom* multiselect rather than Stash's stock per-setting input. Stash
can only render STRING/NUMBER/BOOLEAN settings one plain input each, so "which
languages are enabled" would otherwise be a comma-separated text box. The plugin
patches `PluginSettings` to render a react-select multiselect (flag + localised
name, the same renderer as the edit dropdown) while writing the same
comma-separated value to `Configuration.plugins.mangaTools.enabledLanguages`.

**Only the edit dropdown is affected.** Display is untouched: a gallery whose
language is disabled still shows its flag badge and detail row exactly as before —
the value is simply no longer offered as a new choice. This is react-select's
`value`/`options` split: the selected value is rendered from `value`, which is
never filtered, while only the option *list* is filtered.

## Files

```
mangaTools/
├── src/
│   ├── mangaTools.tsx     Badge, dropdown, settings, patch registration
│   ├── languages.ts       Language table (pure data, swappable on its own)
│   └── pluginApi.d.ts     Types for window.PluginApi and window.MangaTools
├── mangaTools.yml         Plugin config (the file name is the plugin ID)
├── mangaTools.css         Styles
├── tsconfig.json          Extends the repo's tsconfig.base.json
└── build/                 Compiled output — generated, gitignored, and the only
                           thing that gets packaged
```

`languages.js` and `mangaTools.js` are loaded in the order given by
`ui.javascript` and communicate through a single namespace,
`window.MangaTools`. That global does not go away at this build level: the
compiler is configured with `module: "esnext"` and the source files contain no
`import`/`export`, so they stay plain scripts; importing across them (or pulling
in an npm package) would require a bundler.

The smoke test lives at `tests/smoke.js` **outside this directory**, so it never
ends up inside the zip that gets installed into a user's plugins folder.

## Installation

Install through Stash's plugin manager; no copying files by hand.

**Settings → Plugins → Available Plugins → Add Source**

| Field | Value |
|---|---|
| Name | anything |
| Source URL | `https://<your-username>.github.io/stash-plugins/index.yml` |
| Local Path | anything, e.g. `stash-plugins` |

Then tick Manga Tools → **Install** → **Reload Plugins**.

To update later: **Installed Plugins → Update**.

> To install manually instead: copy the whole `mangaTools/` directory into
> `<Stash config dir>/plugins/` and hit Reload Plugins. Note the js/css paths in
> the `.yml` are relative to the `.yml`, so the directory has to stay complete —
> copying the `.yml` alone is not enough.

## Verifying

From the repository root (no Stash required):

```bash
npm install     # once
npm test        # compiles, packages, then runs the tests
npm run typecheck
```

`npm test` runs the tests against the **compiled** plugin in `build/`, so they
exercise exactly what gets published and a broken build shows up here.

They cover value normalisation, the unknown-value fallback, route scoping,
write/clear semantics, badge rendering, settings parse/serialise and the settings
UI's write path, and the string/CSS surface of every patched component.

Against a real Stash:

1. **Enter a value**: open any gallery's edit page → a "language" dropdown should
   appear between studio and performers → pick "简体中文 (zh-Hans)" → save
2. **Check what was stored**: open `/graphql` and confirm a code, not a name:
   ```graphql
   { findGalleries(ids: ["<gallery id>"]) { galleries { id custom_fields } } }
   ```
   Expect `custom_fields.language === "zh-Hans"`
3. **Check the badge**: back on the gallery list, the card's cover should show the
   China flag in the bottom-right
4. **Check the tolerance**: hand-edit a gallery's value to `chs`; after a refresh
   the badge should show a grey "chs" chip rather than a flag, and `klingon`
   should render as `klingo` (truncated to 6 characters) rather than erroring
5. **Check isolation**: add a `test: 123` field to the same gallery — its input
   should still be the native text box
6. **Check the scope**: open any scene or performer edit page — there should be
   **no** language dropdown (the plugin only acts on gallery pages)
7. **Check filtering**: gallery list → filter panel → Custom Fields → field
   `language`, modifier `=`, value `zh-Hans`
8. **Check the settings**: Settings → Plugins → Manga Tools, tick only e.g.
   `日本語` and `English`, save, then open a gallery edit page — the dropdown
   should offer only those two, while a gallery already set to Vietnamese still
   shows its flag and detail row

## Troubleshooting: the badge does not show up

Open the browser console (F12) first. The plugin logs three kinds of line, and
**each one pinpoints a different broken link in the chain**:

| Log | Meaning |
|---|---|
| `[mangaTools] loaded language tags for N gallery(ies)` | Fetching worked. **N is the number of galleries that will show a badge** — if N is lower than expected, the problem is the data, not the plugin |
| `[mangaTools] failed to fetch language data, badges will not show. Raw error: …` | The query failed; read the error that follows |
| `[mangaTools] patch active: <component>` | That patch ran for the first time. Fires once per target |

Reading them together:

- **No logs at all** → the plugin did not load. Check that Manga Tools is
  enabled under Settings → Plugins, hit Reload Plugins, then **hard-refresh the
  browser (Ctrl+F5)**.
- **"loaded N" with N=0** → the query worked but no gallery carries a `language`
  custom field. Tag a few from the edit page dropdown.
- **"loaded N" with N>0, but no "patch active: GalleryCard.Overlays"** → this page
  is not in grid view. Only Grid mode uses `GalleryCard`.
- **A missing "patch active" line** → that component name does not exist in your
  Stash build. Patching a non-existent component raises no error and simply never
  runs.

### Why those logs exist

Development hit two completely silent failures, so every link in the chain now
leaves a trace:

1. GraphQL's `OR` is **singular** in the schema (`OR: GalleryFilterType`). It was
   written as an array, the whole query failed validation, the failure was
   swallowed by the `catch`, and the only symptom was that no badges appeared
   anywhere with no hint as to why.
2. `CustomField` looks like a patchable component but is a plain `React.FC` (only
   `CustomFields`, `CustomFieldInput` and `CustomFieldsInput` are wrapped in
   `PatchComponent`). Patching it does not error; it just never runs.

Both are fixed, and the smoke test guards against them (it checks the query shape
and the patch target list).

**The field name must be lowercase `language`.** The query filter hard-codes the
lowercase spelling. Matching both `language` and `Language` in one query is
impossible: GraphQL's `OR` is singular so it cannot be written as an array, and
multiple criteria inside a `custom_fields` array are ANDed. Reads are
case-insensitive, but **only a lowercase key is found by the query**. Entering
values through the plugin's dropdown never hits this, since that writes lowercase.

## Known limitations

- **The filter UI is still plain text**, with no dropdown. Stash's
  `CustomFieldCriterionEditor` is not a patchable component, so the plugin cannot
  replace it without changing core code.
- **The language dropdown only appears on gallery pages.** `CustomFieldsInput` is
  shared by every entity's edit panel, so the plugin scopes itself by URL path
  (`/galleries`). The bulk gallery edit dialog opens over the gallery list page,
  so that is covered too.
- **A new field still has to be typed once.** If you create a `language` field by
  hand instead of using the dropdown, you type the value yourself; with the
  dropdown there is no field to create — picking a value writes it.
- **Changes can take up to 60 seconds to appear.** After saving, badges refresh
  from a poll rather than instantly. Changing route (navigating) refreshes
  immediately.
- **Grid view only.** Of the gallery list's three display modes, only Grid goes
  through `GalleryCard`. List is a table, and Wall uses a different component, so
  neither shows a badge.
- **The detail-page row and the edit-page field both touch the DOM**, because
  Stash leaves no React insertion point at either position (see above). Each mount
  point is an empty `<div>` that the plugin finds/creates and repositions while
  rendering; a React re-render that displaces it gets corrected automatically. The
  anchors are `.gallery-details` (detail page) and
  `.form-group[data-field="studio_id"]` (edit page) — the latter confirmed to
  exist on v0.31.1.
- **Fetch size scales with the number of tagged galleries**, not the library
  size. Verified working against a 1194-gallery library.

## Extending

**Adding a language**: edit `NS.LANGUAGES` in `languages.js`. Each entry needs two
fields — `flag` (a flag-icons alpha-2 **country** code) and `names` (names grouped
by UI language; zh / tw / en / ja are covered today). Add to `NS.ORDER` if you
want a different sort position.

**Only canonical codes are recognised.** There is no alias mapping: values only
ever come from this plugin's own dropdown, so they are canonical by construction.
Reads tolerate surrounding whitespace and letter case (`ZH-HANS` resolves);
anything else becomes an unknown value and shows as a grey "unrecognised" chip
rather than being silently corrected. That is deliberate — bad data should be
visible.

**The language-to-flag mapping is lossy.** A language is not a country, and where
it is one-to-many only one can be picked:

- `zh-Hant` uses the Taiwan flag (`tw`) — Traditional Chinese is also used in Hong
  Kong and Macau; change it to `flag: "hk"` if you prefer
- `en` uses the UK flag (`gb`), changeable to `us`
- Easy mistakes: Vietnam is `vn`, not `vi` (that one is the US Virgin Islands)

**Chinese has only two entries, simplified and traditional.** Anything that does
not specify (`zh` / `中文` / `chinese` / `汉化`…) is treated as `zh-Hans`. A
"Chinese (unspecified)" entry existed briefly, but it shared the same flag as
simplified and was indistinguishable in both icon and name, adding ambiguity
rather than removing it, so it was dropped.

**Flags are not emoji.** Windows' Segoe UI Emoji has no flag glyphs, so a flag
emoji degrades into a pair of boxed letters there. This is why the plugin uses
`flag-icons` CSS.

**i18n coverage for names is limited.** Stash itself gets its nationality names
from `i18n-iso-countries`, covering ~40 UI languages; this table is hand-written
and covers 4, falling back to English. Full coverage would mean pulling in
`i18n-iso-languages` and serving its locale files through `ui.assets` at
`/plugin/{id}/assets/`, fetched at runtime. Note that this does **not** become
possible just because the repo compiles TypeScript: an `import` would fail at
runtime, because Stash loads each file as a plain script, so an npm package
still cannot be pulled in. That needs a bundler.

**Changing the field name**: edit `NS.FIELD_NAME` at the end of
`src/languages.ts`. Note the GraphQL query in `getQuery`
(`src/mangaTools.tsx`) hard-codes `"language"`, so that has to change too.

**Adding another field** (scanlation group, uncensored, …): the design is
single-field right now. `pickLanguage` / `setLanguage` are generic read/write
helpers that can be lifted out, but the badge and the dropdown both assume one
value.

### Deliberately not done

- A dedicated "language" section on the detail page — the value is only shown,
  localised, within the custom fields area
- Splitting `src/mangaTools.tsx` into several files — it is ~800 lines, but
  splitting it would be a separate change from adding a feature, and keeping them
  apart makes a regression easy to attribute
