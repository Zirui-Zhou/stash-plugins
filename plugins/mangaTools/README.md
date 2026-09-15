# Manga Tools

A toolbox that adapts Stash galleries to manga/comic management. It **does not
modify Stash core code** — everything goes through the UI plugin API, so Stash
upgrades never produce merge conflicts.

## Features

| Feature | What it adds |
|---|---|
| **Language** | A language attribute on galleries, surfaced as a flag badge, an edit-page dropdown, a bulk-edit row and a localised detail row |
| **Language filter** | A "language" section in the gallery list's sidebar that narrows the list to one language |
| **Settings** | Which languages the dropdown offers, whether flags are drawn, and whether the cover badge is drawn |

Each feature occupies its own section below, and each keeps to the same rule:
anything it does not own is handed straight back to Stash untouched.

### Language

Adds a "language" property to galleries.

| Where | Effect |
|---|---|
| Gallery list / card | A **regional flag** in the bottom-right of the cover (Japan, China, Taiwan…). Fades out on hover like the studio icon, clearing the cover |
| Gallery list / sidebar | A **language section** listing every language, to filter the list — see [Filtering](#filtering) |
| Gallery edit page | A "language" dropdown **between "studio" and "performers"**, listing "flag + localised name" — no typing codes by hand |
| Gallery detail page | An extra `<h6>` row **below "photographer", above "details"**, showing "flag + localised name" with the same label and font as the rows around it |
| Gallery bulk edit | A "language" row **between "studio" and "performers"**, prefilled with the selection's shared language like the studio field, and applied by the dialog's own **Apply** — Cancel discards it like every other field |

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

  Its options are **ordered by the name shown**, in the reader's own collation,
  so the list reads naturally in whatever language the Stash UI is set to. There
  is no hand-written priority order — see [Extending](#extending) for why that
  one was removed.

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

The name to display for that code is looked up through `Intl.DisplayNames` at
render time, so it follows Stash's UI language rather than being stored or
shipped — see [Extending](#extending) for why, and for what that costs.

#### Bulk edit

Setting one language across a whole selection is the reason this row exists, and
it is the only part of the plugin that reaches outside the patch API — so it is
worth knowing how it works.

`EditGalleriesDialog` is **not** a `PatchComponent`, and it keeps the values it is
about to apply in its own state:

```jsx
const [updateInput, setUpdateInput] = useState<BulkGalleryUpdateInput>(...)
function getGalleryInput() { return { ...updateInput, ... } }   // Apply sends this
```

No hook lets a plugin add a field to that state. So the row is rendered *outside*
it — DOM plus portal, anchored on the `data-field="studio"` row that
`BulkUpdateFormGroup` emits — and its value is merged into the outgoing mutation
instead:

- the plugin installs one `ApolloLink` in front of Stash's chain with
  `client.setLink(from([ours, previous]))` — Apollo's own API for changing the
  chain after the client exists. The existing chain is passed through untouched,
  so nothing else about the client changes.
- that link rewrites `input.custom_fields` on `bulkGalleryUpdate` **only**, as
  `{ partial: { language: "ja" } }`. It is matched on the schema's root field
  name, not on an operation name, and scene/image bulk updates are deliberately
  left alone. A bulk edit that has nothing to do with language goes out byte for
  byte as Stash built it.
- it is installed **lazily**, the first time the row mounts, so a user who never
  opens the dialog never has their client touched at all.
- the value is cleared once the update **succeeds**, so a failed Apply can simply
  be retried with the row still filled in, and a cancelled dialog leaves nothing
  behind.
- a successful update also **refetches the gallery map**, so the flag badges on
  the cards update instead of waiting up to a minute for the next poll. That
  refetch waits for any fetch already in flight: one started before the write
  carries pre-write data and would otherwise land afterwards and undo it.

`partial` is what makes this safe rather than a blind overwrite: `CustomFieldsInput`
updates just the named keys, so nothing else in a gallery's custom fields is
disturbed.

The row behaves like Stash's own studio field, because it is the same shape of
data — one value per gallery:

- **the box is prefilled with the selection's shared language** when every
  selected gallery agrees, and shows the placeholder when they differ or none of
  them carries one. That mirrors `getAggregateStudioId` in Stash's
  `utils/bulkUpdate.ts`; the languages come from the plugin's own gallery store,
  since the dialog is the one thing that cannot be read.
- **clearing the box means "leave the language alone"**, exactly as clearing the
  studio field means "leave the studio alone" — neither sends a value. There is
  deliberately no way to blank the field across a selection, and so no extra
  button beside the dropdown.

The selection itself is read by *observing* `GalleryList` (`patch.before`, which
hands the props straight back). That is the only patchable component that receives
`selectedIds`, and it is the parent of all three display modes, so grid, list and
wall are all covered by one hook.

#### Filtering

The gallery list's sidebar gains a **language** section, built to work the way
Stash's own studio section does:

- a heading you can fold away, with whatever is selected **above** it, so the
  selection stays visible while the list of choices is folded
- a search box over the candidates, matching both the name and the code
- two modifier entries first — **(Any)**, galleries carrying a language at all,
  and **(None)**, galleries carrying none
- every language below, each with an **include** button and an **exclude** one
- excluded values collected in their own list, marked with a cross rather than a
  tick

There are three decisions behind that worth knowing, because each rules out an
approach that looks more obvious.

**There are two surfaces, and they commit at different times.** The sidebar
section applies on every click. The "edit filters" dialog also offers a
**Language** card, registered into the filter model's own
`options.criterionOptions` — the module-level array Stash builds its cards from,
which is reachable through the model even though `EditFilterDialog`,
`CriterionEditor` and `CustomFieldsFilter` are all plain `React.FC` and cannot be
patched. That card keeps its own selection and merges it into the URL when
**Apply** is pressed, exactly as the sidebar does; `src/language-filter.tsx`
holds the operations the two share, so a click cannot come to mean different
things in the two places.

**The criterion is a custom field, and Stash is told it is a language.** It has to
be stored as one: Stash decodes the query string before a plugin's filter option
exists, so a stored type of `language` would not resolve on a reload. That leaves
Stash treating it as a custom field, which shows up in two places — its tag would
open the custom-fields card, and that tag would read `language (custom field) is
ja`. Both are repaired without changing what is stored: the criterion is handed
Stash's Language option, so its tag opens our card and its ✗ clears the filter,
and the tag's wording is replaced in the DOM with the same sentence the sidebar
would use. The repair is in the DOM because Stash draws its tag row *before* this
plugin is mounted, so nothing attached at render time can reach it (see
`relabelTags`).

**It works by rewriting the URL.** Stash keeps its filter in the `c` query
parameter, and its list hook re-reads that on every navigation. So a filter change
here is a URL change, and the filter tag, the result count, pagination,
bookmarks and the back button all follow without the plugin doing anything. The
alternative — holding the selection in plugin state and injecting it into the
`findGalleries` query, the way the bulk dialog injects its write — would leave
Stash's own state and the count disagreeing with what is on screen.

Nothing here reimplements Stash's encoding. The obvious route in would be to
build the query string by hand, but the format is private
(`translateJSON`, which swaps braces for parentheses). Instead the plugin clones
the live filter model and asks *it* for the query parameters, merging its
conditions into the existing custom-fields criterion. All of that is public API on
the model: `clone`, `options.criterionOptions`, `makeCriterion`,
`makeQueryParameters`.

**What the conditions mean**, measured against a real library rather than assumed:

| conditions | meaning |
|---|---|
| `EQUALS [a, b]` | matches `a` **or** `b` — several values are a union |
| `NOT_EQUALS [a, b]` | excludes both, **and also matches galleries with no language field** |
| `NOT_NULL` | galleries carrying a language |
| `IS_NULL` | galleries carrying none |
| `EQUALS [a]` + `NOT_EQUALS [b]` | include `a`, exclude `b` — the conditions are ANDed |

That last row is what makes include and exclude compose: `EQUALS [a]` with
`NOT_EQUALS [a]` returns nothing, which only AND semantics can produce. The
second row is why **exclude mirrors Stash's own modifier verbatim** rather than
being something cleverer — excluding one language on a mostly-untagged library
still returns nearly everything, and matching the studio filter while documenting
that is more honest than quietly meaning something else by the word.

The section honours the **enabled languages** setting, so the two never disagree
about which languages this library uses — with one exception: a value already
included or excluded stays visible even if it has since been disabled, since
otherwise the list would be filtered by something invisible.

**Two of the studio filter's entries are deliberately absent.** Stash also offers
`any of` and `only` among the modifier candidates, but those exist to choose
between its `INCLUDES` and `INCLUDES_ALL` modifiers — "any of these studios" as
opposed to "all of them". A custom-field `EQUALS` has no "all" form: its values
are always a union, so both entries would mean the same thing as selecting the
languages directly.

### Settings

Three settings under **Settings → Plugins → Manga Tools**:

| Setting | Type | Effect |
|---|---|---|
| **Enabled languages** | multiselect | Limits which languages the edit-page dropdown offers; empty = every language |
| **Show flags** | switch | Draw flags, or the language name on its own |
| **Show the language on gallery covers** | switch | The badge in the bottom-right of a gallery's cover |

An empty language list shows an "All languages" placeholder rather than every
tag; only a chosen subset renders tags.

**The two switches are deliberately independent**, so all four combinations are
available:

| Show flags | Cover badge | Cover | Dropdowns / detail row |
|---|---|---|---|
| on | on | flag | flag + name |
| off | on | **name only**, in a chip | name only |
| on | off | no badge | flag + name |
| off | off | no badge | name only |

A badge without a flag is a real choice, not a leftover: the flag mapping is
lossy (see "Extending" — a language is not a country, so `zh-Hant` gets the
Taiwan flag and `en` gets the UK one), and a name can be preferable to a
misleading flag. The name chip is the same one an unrecognised value already
renders.

**Both switches default to on, and an absent value reads as the default** — so an
install that predates them behaves exactly as it did until something is turned
off. Nothing is written to the config until then.

Every setting is saved as one map. `configurePlugin`'s input is the plugin's whole
settings object, and writing all three at once is correct whether that object is
replaced or merged — which the plugin cannot confirm, since the resolver is not
part of the published API.

It is a *custom* UI rather than Stash's stock per-setting inputs. Stash
can only render STRING/NUMBER/BOOLEAN settings one plain input each, so "which
languages are enabled" would otherwise be a comma-separated text box. The plugin
patches `PluginSettings` to render a react-select multiselect (flag + localised
name, the same renderer as the edit dropdown) plus the two switches, which are
laid out exactly like Stash's own `BooleanSetting`.

**Only the edit dropdown is affected.** Display is untouched: a gallery whose
language is disabled still shows its flag badge and detail row exactly as before —
the value is simply no longer offered as a new choice. This is react-select's
`value`/`options` split: the selected value is rendered from `value`, which is
never filtered, while only the option *list* is filtered.

## Files

```
mangaTools/
├── src/
│   ├── mangaTools.tsx        Badge, dropdown, bulk row, settings, patches
│   ├── language-filter.tsx   The gallery list's language filter section
│   ├── languages.ts          Codes, flags, and the name lookup (pure, no DOM)
│   └── plugin-api.ts         Types for PluginApi and the namespace above
├── tests/
│   └── smoke.js              Smoke test, run by `npm test` from the repo root
├── mangaTools.yml            Plugin config (the file name is the plugin ID)
├── mangaTools.css            Styles
├── tsconfig.json             Extends the repo's tsconfig.base.json
└── build/                    Bundled output — generated, gitignored, and the
                              only thing that gets packaged
```

`ui.javascript` names **one** file. esbuild bundles `src/mangaTools.tsx` together
with everything it imports into `build/mangaTools.js`, loaded by Stash through a
plain `<script>` tag — hence `format: "iife"` in `tools/build.mjs`. The source
files talk to each other by importing, not through the window.

`languages.ts` still publishes itself at `window.MangaTools` as well, because that
is the handle `tests/smoke.js` uses to call the pure functions directly; the
plugin itself never reads it.

`tsc` plays no part in producing that file — it only type-checks, and esbuild
strips types without reading them. That is why `npm test` runs both; see
[DEVELOPING.md](../../DEVELOPING.md).

`tests/` is not packaged — the zip holds only what the entry point bundles plus
the `.yml`, `.css` and `.md` copied in beside it, so the spec never reaches a
user's plugins folder.

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
npm install         # once
npm run typecheck   # tsc over the sources
npm run build       # bundle + package into dist/ (no type-check)
npm test            # type-check, bundle, package, then run the tests
```

`npm test` runs the tests against the **bundled** plugin in `build/`, so they
exercise exactly what gets published and a broken build shows up here. A type
error does not — esbuild strips types without reading them — which is why
`npm test` runs `tsc` first rather than relying on the bundler.

They cover value normalisation, the unknown-value fallback, route scoping,
write/clear semantics, badge rendering, settings parse/serialise and the settings
UI's write path, the filter's read/merge/replace/clear rules and the sidebar
section it renders, the shape of the bundle (one file, no module syntax, JSX
really transformed), and the string/CSS surface of every patched component.

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
7. **Check filtering**: gallery list → the sidebar should have a **语言** section
   with a search box, **(任意)** and **(无)** first, then every language.
   - **Include**: click a language → it moves above the fold-away list with a
     tick, the list narrows, a filter tag appears, and the URL changes. Click it
     again and the filter clears. Click a second one: both should be included,
     as "any of these".
   - **(无)** should list the galleries with no language set — the untagged ones.
   - **Exclude**: hover a candidate and press its **exclude** button → the
     language appears in a second list, marked with a cross. Note how many
     results that leaves: every untagged gallery still matches.
   - **Search**: type `日` and the candidates should narrow to the Japanese and
     Chinese entries.
   - **Check it composes**: include one language and exclude another; both
     conditions are sent, and including and excluding the *same* language should
     return nothing at all.
   - **Check the tag**: it should read `语言 是 日语`, not `language (用户字段) 是
     ja` — the wording is the plugin's. Clicking it should open the **Language**
     card in the filter dialog, and its ✗ should clear the filter. With an
     exclusion there are two tags, one per condition, and the second should read
     `语言 不是 韩语`.
   - The same conditions are reachable by hand: filter panel → Custom Fields →
     field `language`. Both routes write the same thing, so a filter set through
     one should show up in the other.
8. **Check the settings**: Settings → Plugins → Manga Tools, tick only e.g.
   `日本語` and `English`, save, then open a gallery edit page — the dropdown
   should offer only those two, while a gallery already set to Vietnamese still
   shows its flag and detail row
9. **Check the display switches**: under Settings → Plugins → Manga Tools, turn
   **Show flags** off — the dropdowns and the detail row should show names only,
   and the cover badges should become name chips rather than disappearing. Turn
   it back on and turn **Show the language on gallery covers** off instead — now
   the covers are bare and everything else is unchanged.
10. **Check the bulk edit**: select several galleries → **Edit** → a "language"
   row should appear between studio and performers.
   - Select galleries that already share a language: the box should be prefilled
     with it. Select a mixed set: it should show the placeholder instead.
   - Pick a language, press **Apply**, and all of them should show the new flag
     **without waiting for a refresh**.
   - Do it again and press **Cancel** instead — nothing should change.

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

- **The bulk edit row hooks the Apollo link chain** (see "Bulk edit" above) — the
  only place the plugin goes beyond the patch API. It is the only way to put a
  field into that dialog, since the dialog is not patchable and keeps its pending
  values in private state. If a future Stash makes `EditGalleriesDialog` a
  `PatchComponent`, this should be replaced with a normal patch.
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
- **All four insertion points touch the DOM**, because Stash leaves no React
  insertion point at those positions (see above). Each mount point is an empty
  `<div>` that the plugin finds/creates and repositions while rendering; a React
  re-render that displaces it gets corrected automatically. The anchors are
  `.gallery-details` (detail page), `.form-group[data-field="studio_id"]` (edit
  page — confirmed to exist on v0.31.1), `[data-field="studio"]` (bulk dialog) and
  `.sidebar-saved-filters` (filter sidebar).

  **The correction runs in a *layout* effect.** Three of the four need a second
  pass, because the anchor's element does not exist while the tree is still being
  built. A plain effect is flushed after the browser has painted, so the row or
  section would be missing for a frame and everything below it would jump. Layout
  effects run after React writes the DOM but before paint, which is the only
  window where the correction is invisible.
- **The sidebar filter could not be moved off its anchor.** Stash registers
  `FilteredGalleryList.SidebarSections` — a patchable wrapper around its own
  sidebar filter sections — which looks like the natural place to render this
  one, with no anchor and no second pass. It does not work: that wrapper is handed
  only `children`, the filter model lives inside `FilteredGalleryList` above it,
  and nothing patchable up there holds one either. Publishing the model from
  `GalleryList` was tried and renders nothing at all, because `GalleryList` is the
  list of cards and renders *after* the sidebar. The anchor stands.
- **The sidebar section appears a moment after the page, and the cause is not
  known.** Two explanations have been ruled out by reading Stash: plugin scripts
  run before the app's first render (`PluginsLoader` waits on `useScript`, which
  waits for the `load` event), and the mount-point corrections already run in
  layout effects, i.e. before the browser paints. The delay is brief and the
  section arrives in the right place, so it is left as it is rather than chased
  with more machinery — if you do go after it, start by confirming which version
  Stash is actually running, since a cached earlier build would look identical.
- **Excluding a language also matches galleries with no language set**, because
  that is what Stash's `NOT_EQUALS` means. On a library where most galleries are
  untagged, "not Japanese" therefore returns nearly everything; `(None)` asks for
  the untagged ones directly.
- **A language cannot be both included and excluded** — the two lists are
  mutually exclusive, since `EQUALS` and `NOT_EQUALS` for the same value is a
  contradiction that matches nothing.
- **The filter's tag is Stash's tag, re-worded.** It is not a tag this plugin
  draws, so it behaves natively — it opens the Language card, and its ✗ clears the
  filter — but the wording is replaced after Stash has rendered it. On a page
  *load* with a language filter already in the URL, that replacement happens once
  the gallery list has rendered, so the tag shows Stash's own wording
  (`language (custom field) is ja`) for as long as the first query takes. See
  [Filtering](#filtering).
- **Fetch size scales with the number of tagged galleries**, not the library
  size. Verified working against a 1194-gallery library.

## Extending

**Adding a language**: add one line to `NS.LANGUAGES` in `src/languages.ts` — a
canonical code and a `flag` (a flag-icons alpha-2 **country** code). That is the
whole change. The name comes from `Intl.DisplayNames`, so there is nothing to
translate, and the dropdown's position comes from that name, so there is no order
to maintain either.

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

**Language names come from the platform, not from this plugin.** `NS.name` asks
`Intl.DisplayNames` for the name in the current UI locale, so all ~90 locales the
engine's CLDR knows are covered rather than the four that used to be listed here,
and adding a language needs no translation. Three consequences worth knowing:

- **The wording is CLDR's, not ours.** Where it differs from what the old
  hand-written table said, CLDR wins — `id` in Chinese is 印度尼西亚语 rather than
  our shorter 印尼语. It can also shift when a browser updates its CLDR data.
- **The locale is Stash's, never the browser's.** The plugin passes react-intl's
  locale, which Stash sets from `Configuration.interface.language`. It also passes
  English as a second entry in the locale list, because an engine that does not
  know a locale would otherwise resolve against the *runtime's* default — the
  browser's — silently. The smoke test pins that pair.
- **Recognition stays this plugin's job.** `Intl.DisplayNames` would happily name
  `chi`, `jpn` and `zh-TW`; those must keep reading as unrecognised data, so only
  codes in `NS.LANGUAGES` are ever looked up.
- **The dropdown's order is the reader's, not ours.** Options are sorted by the
  displayed name through `Intl.Collator`, so they come out in the reader's own
  alphabet. The order that used to be here ran `ja, zh-Hans, zh-Hant, en, ko, …`
  then European languages then `th, vi, id` — the author's languages first, then
  the West, then the rest. That is a judgement about which languages matter, and
  nothing needs one: the list is searchable and the setting above usually
  shortens it. Note the *stored* `enabledLanguages` string is still sorted by
  code, so it does not depend on who wrote it.

An engine without `DisplayNames` (older than Chrome 81 / Firefox 86 / Safari
14.1) is not a crash: names degrade to the raw code, which is what an unrecognised
value shows anyway.

A library was considered and rejected. `@cospired/i18n-iso-languages` is the
maintained option — MIT, zero dependencies — but it does not understand BCP 47
script subtags, so `zh-Hans` and `zh-Hant` return `undefined`, exactly the two
languages the script-subtag design exists for. It also ships no `zh-TW` locale,
and its ~4.8 KB per locale × 32 locales would be ~140 KB against a 31 KB bundle,
to cover fewer locales than the platform already provides for nothing.

**This is still only half of i18n.** The plugin's own strings — `Select language…`,
the settings headings and descriptions — remain hard-coded English, so the
surrounding UI does not follow the language the names do.

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
- Splitting `src/mangaTools.tsx` into several files — it is ~800 lines, and imports
  would now make that possible, but splitting it would be a separate change from
  adding a feature, and keeping them apart makes a regression easy to attribute
