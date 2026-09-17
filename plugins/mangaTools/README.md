# Manga Tools

A toolbox that adapts Stash galleries to manga/comic management. It **does not
modify Stash core code** — everything goes through the UI plugin API, so Stash
upgrades never produce merge conflicts.

## Features

| Feature | What it adds |
|---|---|
| **Language** | A language attribute on galleries, surfaced as a flag badge, an edit-page dropdown, a bulk-edit row and a localised detail row |
| **Censorship** | Whether a gallery is censored or not, surfaced as a mark on the gallery card and a row in the detail page's Manga info panel |
| **Translation group** | Who translated the comic, as free text — a box in the edit page's Manga info block, and a row in the details one |
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

The data lives in one of the Gallery's **custom fields**: `plugin.mangaTools.language`. What
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
  `{ partial: { "plugin.mangaTools.language": "ja" } }`. It is matched on the schema's root field
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
**Apply** is pressed, exactly as the sidebar does; `src/filter-model.ts`
holds the operations the two share, so a click cannot come to mean different
things in the two places.

**The criterion is a custom field, and Stash is told it is a language.** It has to
be stored as one: Stash decodes the query string before a plugin's filter option
exists, so a stored type of `language` would not resolve on a reload. That leaves
Stash treating it as a custom field, which shows up in two places — its tag would
open the custom-fields card, and that tag would read `plugin.mangaTools.language
(custom field) is ja`. Both are repaired without changing what is stored: the criterion is handed
Stash's Language option, so its tag opens our card and its ✗ clears the filter,
and the tag's wording is replaced in the DOM with the same sentence the sidebar
would use. The repair is in the DOM because Stash draws its tag row *before* this
plugin is mounted, so nothing attached at render time can reach it (see
`relabelTags`). All three of this plugin's fields share that one criterion, so a
filter with two of them set is one criterion carrying a condition for each: what a
tag is worded from is the field's own conditions, never the criterion as a whole,
or a filter with two fields in it leaves both tags in Stash's raw wording (see
`fieldTagLabels`).

**The two tag rows say different things, so they are worded differently.** The row
above the list reports the filter the list is *applied* to. The row inside the
dialog reports the dialog's *working copy* — which is why Stash's own criteria
update it the moment they are edited, several clicks before Apply. A language
filter's working copy lives in this plugin's card rather than in Stash's copy, so
the dialog's row is worded from the card instead: one label per tag Stash drew,
a tag hidden only when the card has nothing to say in its place, and a tag of this
plugin's own drawn for a condition Stash has no tag for at all — the first
language picked into a dialog that had none when it opened (see
`manageDialogTags`). Clearing the card's selection and taking the tags away are
wired together, so the ✗ on Stash's tag means the same thing as the ✗ on this
plugin's.

**Applying waits for Apply to reach the list's filter.** Stash commits the dialog's
*copy*, and the model the plugin is handed is the list's, which only becomes that
copy a commit later, when Stash's own hook re-reads the query string Apply wrote.
So the merge waits for the model to change and merges into the new one. That is what
keeps the rest of the dialog: by then the filter holds everything the dialog did, so
a criterion removed there stays removed.

The wait has a deadline, because pressing Apply does not necessarily commit anything
at all — choosing a language and nothing else leaves Stash's own filter untouched,
so nothing arrives to wait for. See [Known limitations](#known-limitations).

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

### Censorship

Whether a gallery is censored. A separate field from the language rather than a
flag on it, because the two are independent: an uncensored Japanese volume is a
perfectly ordinary thing.

Three states, and the third is the absence of the field rather than a value:

| State | Stored | Card | Toolbar |
|---|---|---|---|
| Not marked | no field | nothing | an empty chessboard, dimmed |
| Censored | `censored` | a knight | a knight |
| Uncensored | `uncensored` | a pawn | a pawn |

**Why a knight and a pawn.** 骑兵, "cavalry", is what a censored release is, and
步兵, "infantry", is what it is not — the mosaic a censor lays over the page has
had that name in Chinese for long enough that the joke needs no explaining to
the reader it is aimed at. The icons carry it and nothing on screen spells it
out: a tooltip about a word rather than about the gallery would be worse than no
tooltip. If the pun wears off, `censorshipIcon` in `src/mangaTools.tsx` is the
one place to change it.

**Why a board for the third state.** It is the third member of the same set, so
the button reads as one control with three states rather than as two chess pieces
beside a UI glyph — and the circled question mark it replaced is the universal
"help" mark, in a toolbar, which is a thing people click by mistake. A board with
nothing on it is also just true: nothing has been marked. It looks a little like
the mosaic the other two are named after, which the dimmed grey helps along. The
name needs no fallback, unlike `faXmark` in `dialog-filter.tsx`: `chess-board`
has been spelled that way in every FontAwesome since 5.

**Only "not marked" has a colour of its own** — it is dimmed, so the button reads
as an offer rather than as a setting with a value. The two marked states keep the
button's ordinary foreground colour and are told apart by the icon alone. Stash's
organized button next door does the opposite, dimming one state and colouring the
other brown; that brown is deliberately not copied, since it is Stash's accent for
"organized" and would say that being censored is a kind of done-ness.

| Where | Effect |
|---|---|
| Gallery list / card | The state's icon **at the end of the popover row** — the row that appears on hover with the image count, the tag count and the organized box. An unmarked gallery adds nothing there, since most galleries are unmarked |
| Gallery detail page | A **row in the Manga info panel**, with the state's icon and its name. Unset draws no row at all |
| Gallery edit page | A two-option selector in the Manga info block. Unset is the selector's own clear button, which is what makes "not marked" a state you can return to without a third option to name it |

**The toolbar carries the manga switch, not this.** It used to cycle the three
censorship states; the mark and the switch are asked of the same plugin state, so
two controls in one toolbar meant two things to explain and no way to tell which
was authoritative. What the toolbar keeps is the one control there is no other
route to — marking a gallery as manga — and this plugin's fields are set on the
edit page, where every other gallery attribute is set.

**The card's mark is spliced into Stash's own row, and that row is a flex
container** — rendering a second `.card-popovers` beside it would put the mark on
a line of its own instead of at the end of this one. So the mark renders an
anchor carrying the gallery id, and portals its button into the last child of the
row it finds from that anchor. A card Stash draws no row for at all — no images,
tags, performers, scenes or organized mark — gets one made for it with the same
classes, so nothing about it looks unlike the real thing. See `ensurePopoverSlot`.

**The toolbar button is the same trick, for the same reason.** `Gallery` is not a
registered component, so there is no patch to hang a React child off; a span is
inserted after the one holding `.organized-button`, anchored on that button
rather than on a position, because the group's other span is the operation menu
and its contents vary. See `ensureToolbarHost`.

That anchor is not always there, and its absence is not the toolbar's: Stash
renders a spinner in the button's place for as long as its own save runs, which
is what a click on organized starts. So the lookup keeps the host it already has
rather than standing down — otherwise the switch disappeared the moment the
reader clicked organized, and stayed gone until the next refresh.

**Writing the mark is deliberately quieter than anything else this plugin
writes.** Stash's edit page is a tab on the same page as that toolbar, and its
form reinitialises itself whenever the gallery behind it changes
(`enableReinitialize` in `GalleryEditPanel`), which throws away whatever is typed
in it and not saved. `custom_fields` is one of that form's own fields, so the
obvious write does exactly that.

Both directions therefore go through this plugin's own mutation, whose selection
set asks for nothing back — Apollo writes only what a mutation asks for, so the
cached gallery keeps what it had — and both push the change into the form's copy
of the map at the same time, so that the map a Save sends back (the whole of it:
`custom_fields: { full: … }`) carries the change too. The store's own query is
`no-cache` for the same reason.

That the unmark is written quietly as well is the part worth spelling out, since
it is not obvious: what the panels draw is asked of this plugin's store rather
than of Stash's values (see `isMarkedNow`), so the cache can go on holding fields
that nothing on screen asks it for — and it must, because removing them there is
what resets the edit form. Marking quietly and unmarking loudly is exactly the
combination that lost a reader's typing on the way out.

**Both look their mount point up during render, which on a page's first pass is
too early** — React has not committed the page yet, so the lookup finds the
previous page's markup, which on a load is nothing. `useAfterMount` asks for one
more render once the component has mounted, and that render is the one that can
see it. One extra render, not a loop.

**The store, not the cache, is what says whether a gallery is manga** — which is
what makes the quiet write safe, and why the two have to be read together. It is
filled by a `no-cache` query for galleries carrying the mark, and it is what the
switch, the card's mark and the panels all ask (`isMarkedNow`); a gallery the
query did not return is one the server does not consider manga, and the mark
therefore says so the moment the write takes it out of the store. Until the first
answer the map is null rather than empty — "nothing is manga" is an answer, and a
different one from "no answer yet", which is the only reading that can flicker a
marked gallery's switch on the way in.

A write is followed by a refetch of that store, *deferred* past any fetch already
in flight: a fetch built before the write answers with the state before it, so
letting that response land afterwards puts back what the write just changed. The
reason is the same one the writes are quiet for, seen from the other side.

Clearing removes the key rather than writing an empty value, and removes it *by
the spelling the gallery actually carries* — so a key that drifted in case is
removed rather than left behind holding the old mark.

### Translation group

Who translated the comic: `plugin.mangaTools.translationGroup`, as free text.

| Where | Effect |
|---|---|
| Gallery detail page | A row in the Manga info panel: the label and the name, and nothing else. Unset draws no row |
| Gallery edit page | A text box in the Manga info block, with the groups already in use offered as suggestions |

**Free text, and that is the whole of its design.** The other fields here pick
from a vocabulary this plugin owns — a language is a code, a censorship is one of
two words — so both can be validated, localised and drawn with an icon. A group's
name is whatever it calls itself, and the only honest treatment of that is to
keep what was typed. Nothing is normalised on the way in, and nothing is drawn
from it.

**React-select cannot be typed into.** Stash gives plugins `react-select`, whose
select is a search box over a fixed list; the creatable variant is a separate
entry point and is not offered. A select would therefore mean a group could only
be picked once somebody else had already set it somewhere else. The field is a
plain `<input>` with a `<datalist>`, so the browser supplies the suggestions and
typing a new name costs nothing — and pressing Enter or clicking away does not
throw the text away, which a "creatable" select would have done (you have to
select the option you just typed before it counts).

**The suggestions are the groups in use**, read out of this plugin's own store:
every marked gallery's whole custom_fields map is already in memory, so the list
costs no request and is the same set of galleries as everything else here. It is
empty until the first fetch settles, which is right — before that there is
nothing to suggest, and the box works either way.

**The value is stored as typed, and read trimmed.** A space has to be typable, so
the box writes exactly what is in it; what comes back out for display and for the
suggestions is trimmed (`NS.translationGroupOf`), because a space on the end is
not part of a group's name. Blurring writes the trimmed value back, which is a
tidy-up rather than a change of meaning — and a value that is already tidy is
left alone, so blurring never marks the form dirty on its own. A box holding
nothing but spaces counts as nothing, and removes the key.

Committed on every keystroke rather than on blur, unlike Stash's own
custom-field input. What a Save reads is the values map as it stood when the
click was handled, and a blur that has not been through a render yet can lose the
last thing typed; with the map here being the only copy, that is not a risk worth
taking for one fewer re-render.

There is deliberately **no sidebar section and no bulk-edit row** for it. A
sidebar section would have to be a free-text search rather than the checkbox list
the other three are, and the bulk row would have to say what "set this group on
every selected gallery" means when the values differ. Both are additions with
their own design questions rather than a column in an existing table. It is
recognised as one of this plugin's fields all the same — see `NS.ownField` — so it
never shows up as a raw custom-field row in the edit form, and unmarking clears it
along with the rest.

### Settings

Six settings under **Settings → Plugins → Manga Tools**:

| Setting | Type | Effect |
|---|---|---|
| **Enabled languages** | multiselect | Limits which languages the edit-page dropdown offers; empty = every language |
| **Show flags** | switch | Draw flags, or the language name on its own |
| **Show the language on gallery covers** | switch | The badge in the bottom-right of a gallery's cover |
| **Start the details block expanded** | switch | The state the details tab's Manga info section opens in |
| **Start the edit block expanded** | switch | The same, for the edit form's block |
| **Hide the performers field on a manga gallery** | switch | A manga gallery's edit page leaves Stash's performers field out |

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

**The switches default to what the plugin already did, and an absent value reads
as the default** — both display switches on, the details block folded, the edit
block open, the performers field hidden. So an install that predates them behaves
exactly as it did until something is turned off. Nothing is written to the config
until then.

**Hiding the performers field only hides it.** The row is Stash's, its value lives
in Stash's form, and the plugin neither renders it nor touches it: one CSS rule
keyed on the mount point the language row already needs takes it off the page, so
a manga gallery that does have performers keeps them when it is saved. The bulk
edit dialog (where the selection may mix manga and ordinary galleries) and the
details tab are unaffected.

Every setting is saved as one map. `configurePlugin`'s input is the plugin's whole
settings object, and writing all of them at once is correct whether that object is
replaced or merged — which the plugin cannot confirm, since the resolver is not
part of the published API.

It is a *custom* UI rather than Stash's stock per-setting inputs. Stash
can only render STRING/NUMBER/BOOLEAN settings one plain input each, so "which
languages are enabled" would otherwise be a comma-separated text box. The plugin
patches `PluginSettings` to render a react-select multiselect (flag + localised
name, the same renderer as the edit dropdown) plus the switches, which are laid
out exactly like Stash's own `BooleanSetting`.

**Only the edit dropdown is affected.** Display is untouched: a gallery whose
language is disabled still shows its flag badge and detail row exactly as before —
the value is simply no longer offered as a new choice. This is react-select's
`value`/`options` split: the selected value is rendered from `value`, which is
never filtered, while only the option *list* is filtered.

## Files

```
mangaTools/
├── src/
│   ├── mangaTools.tsx        Badge, panels, dropdown, bulk row, toolbar switch, settings, patches
│   ├── filter-model.ts       Criterion read/write for all three fields (pure, no DOM)
│   ├── filter-ui.tsx         The rows and tag DOM both filter surfaces share
│   ├── sidebar-filter.tsx    The three sidebar filter sections
│   ├── dialog-filter.tsx     The dialog's language card
│   ├── languages.ts          Codes, flags, and the name lookup (pure, no DOM)
│   ├── fields.ts             The custom fields this plugin owns, and how to
│   │                         read and write one (pure, no DOM)
│   ├── i18n.ts               The plugin's own strings, per locale
│   ├── messages/             One JSON catalog per language
│   └── plugin-api.ts         Types for PluginApi and the namespace above
├── tests/
│   ├── smoke.js              The runner, and the entry point `npm test` names
│   ├── helpers.js            The stubs, the fixtures, and the loaded bundle
│   ├── renders.js            The two surfaces more than one section drives
│   └── sections/             One file per area, in the order they run
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

`languages.ts` and `fields.ts` still publish themselves at `window.MangaTools` as
well, because that is the handle `tests/helpers.js` uses to call the pure
functions directly; the plugin itself never reads it. They share one namespace
object, each adding its own members — which is why `fields.ts` holds the field
*names* while `languages.ts` holds the table of language codes they can point at.
The four filter modules do the same, each publishing the members it owns at the
end of its own file; that is what keeps the sidebar and dialog from having to
import each other.

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
write/clear semantics, badge rendering, the generic field read/write rules, the
censorship mark's placement in Stash's own popover row and the toolbar button's
cycle and mutation, settings parse/serialise and the settings UI's write path,
the filter's read/merge/replace/clear rules and the sidebar section it renders,
the shape of the bundle (one file, no module syntax, JSX really transformed), and
the string/CSS surface of every patched component.

They are split by area. `tests/smoke.js` is the runner — what runs, in what order,
and what failed — and `tests/sections/` holds one file per area, in the order
they run. What the sections share lives in `tests/helpers.js` (the stubs, the
fixtures, and the loaded bundle) and `tests/renders.js` (the two surfaces more
than one of them drives).

Two things about that split are load-bearing. The sections that read the gallery
map the plugin fetches as it loads run in a timer, so the ones that do not care
whether it has settled go first. And what the tests *move* — the UI locale, the
tags the DOM stub answers with — sits in one `state` object in `helpers.js`: a
section file is its own module, so a test that set its own copy of a variable
would leave the stub reading the original and go on passing.

Against a real Stash:

1. **Enter a value**: open any gallery's edit page → a "language" dropdown should
   appear between studio and performers → pick "简体中文 (zh-Hans)" → save
2. **Check what was stored**: open `/graphql` and confirm a code, not a name:
   ```graphql
   { findGalleries(ids: ["<gallery id>"]) { galleries { id custom_fields } } }
   ```
   Expect `plugin.mangaTools.language === "zh-Hans"`
3. **Check the badge**: back on the gallery list, the card's cover should show the
   China flag in the bottom-right
4. **Check the tolerance**: hand-edit a gallery's value to `chs`; after a refresh
   the badge should show a grey "chs" chip rather than a flag, and `klingon`
   should render as `klingo` (truncated to 6 characters) rather than erroring
5. **Check isolation**: add a `test: 123` field to the same gallery — its input
   should still be the native text box
6. **Check the scope**: open any scene or performer edit page — there should be
   **no** language dropdown (the plugin only acts on gallery pages)
6b. **Check censorship**: on that gallery's **detail** page, the toolbar should
   have a dimmed chessboard button between the organized box and the `⋮`
   menu. Its tooltip should read "mark as censored".
   - Click it: the icon becomes a knight, the tooltip "mark as uncensored", and
     the mark should appear on the gallery's card in the list behind — at the
     **end of the row** that shows the image count and tags, not on a line of
     its own.
   - Click again: a pawn. Again: back to the question mark, and the mark is gone
     from the card.
   - **Check it really cleared**: `/graphql` again — the
     `plugin.mangaTools.censorship` key should be **absent**, not empty.
   - **Check the unmarked case is quiet**: most galleries carry no mark, and
     their cards should look exactly as they did before the plugin was enabled —
     no empty row, no gap.
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
   - **Check the tag**: it should read `语言 是 日语`, not `plugin.mangaTools.
     language (用户字段) 是 ja` — the wording is the plugin's. Clicking it should
     open the **Language** card in the filter dialog, and its ✗ should clear the
     filter. With an
     exclusion there are two tags, one per condition, and the second should read
     `语言 不是 韩语`.
   - **Check the dialog's tag**: with the dialog open, change the language in the
     card — the tag's wording should follow it straight away, without Apply. With
     no language applied when the dialog was opened, picking one should make a tag
     appear where Stash has none. Pressing the tag's ✗ should empty the card, and
     emptying the card should take the tag away.
   - **Check that Apply keeps the rest of the dialog**: with the dialog open,
     remove one of Stash's own criteria (say **Organized**) *and* change the
     language, then press Apply — the removed criterion must stay removed, and one
     added there must stay added.
   - The same conditions are reachable by hand: filter panel → Custom Fields →
     field `plugin.mangaTools.language`. Both routes write the same thing, so a filter set through
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
| `[mangaTools] loaded N gallery(ies) marked as manga` | Fetching worked. **N is the number of galleries carrying the mark** — if N is lower than expected, the problem is the data, not the plugin |
| `[mangaTools] failed to fetch custom fields, marks will not show. Raw error: …` | The gallery query failed; read the error that follows. What the store already holds is kept, so the last answer keeps working |
| `[mangaTools] patch active: <component>` | That patch ran for the first time. Fires once per target |
| `[mangaTools] bulk update: sending the manga fields with the dialog's own update` | The Apollo link merged a bulk edit's manga fields into the outgoing mutation |

One more line reports a limitation rather than a fault — `Apply changed nothing in
Stash's filter, so the language picked in the card was not applied` — and is
explained under [Known limitations](#known-limitations).

Reading them together:

- **No logs at all** → the plugin did not load. Check that Manga Tools is
  enabled under Settings → Plugins, hit Reload Plugins, then **hard-refresh the
  browser (Ctrl+F5)**.
- **"loaded N" with N=0** → the query worked but no gallery carries the
  `plugin.mangaTools.manga` mark. Mark a few from a gallery's detail page.
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

**`plugin.mangaTools.manga` is the one name the query spells, and the only one it
has to.** A gallery whose mark is keyed differently is not *found* by it, so the
plugin does not see that gallery at all — no badge, no card mark, no detail row.
The other three fields are never queried, only read and written, and for them a
drifted key is no obstacle: reads and writes are both tolerant of case —
`NS.pickField` matches any variant, and `NS.setField` replaces every variant with
the canonical spelling — so such a key is still read, and is corrected the first
time the plugin writes that gallery. The *query* is strict because matching the
variants there is impossible: GraphQL's `OR` is singular so it cannot be written
as an array, and multiple criteria inside a `custom_fields` array are ANDed.
Entering values
through the plugin's own controls never hits any of this, since they write the
canonical spelling.

## Known limitations

- **Marking a gallery from the toolbar leaves its edit form looking dirty.**
  Marking writes the mark into that form's own copy of the custom fields as well
  as to the server (see "Writing the mark" above), so formik sees a difference
  from the snapshot it mounted with and reports unsaved changes — until a Save,
  after which it is clean again. That is the price of not resetting the form: the
  alternative is the form being reinitialised on top of whatever was typed in it.
- **The bulk edit row hooks the Apollo link chain** (see "Bulk edit" above) — the
  only place the plugin goes beyond the patch API. It is the only way to put a
  field into that dialog, since the dialog is not patchable and keeps its pending
  values in private state. If a future Stash makes `EditGalleriesDialog` a
  `PatchComponent`, this should be replaced with a normal patch.
- **The dialog's language card is a replacement built around Stash, not inside it.**
  `CustomFieldCriterionEditor` is not a patchable component, so the card cannot be
  handed to Stash as an editor: the plugin draws its own list into the card and
  hides Stash's, by CSS, on the one card whose `data-type` is ours. The criterion
  it edits is still an ordinary custom field, so the two stay consistent — and if
  Stash ever renames that attribute, its editor simply shows up again beside the
  list rather than anything breaking.
- **The language dropdown only appears on gallery pages.** `CustomFieldsInput` is
  shared by every entity's edit panel, so the plugin scopes itself by URL path
  (`/galleries`). The bulk gallery edit dialog opens over the gallery list page,
  so that is covered too.
- **A new field still has to be typed once.** If you create a
  `plugin.mangaTools.language` field by hand instead of using the dropdown, you
  type the value yourself; with the dropdown there is no field to create — picking
  a value writes it. The censorship field has no such problem, since its button
  is always there and its first click creates the field.
- **Changes can take up to 60 seconds to appear.** After saving, badges refresh
  from a poll rather than instantly. Changing route (navigating) refreshes
  immediately, and a write from the censorship button updates the store directly.
- **Grid view only.** Of the gallery list's three display modes, only Grid goes
  through `GalleryCard`. List is a table, and Wall uses a different component, so
  neither shows a badge or a censorship mark.
- **A gallery with no censorship mark is invisible on the card, by design.** The
  row it would go in belongs to Stash and holds the image count, the tag count
  and the organized box; adding a fourth button that says "not set" would make
  every card noisier to say nothing about most of them. The state is still
  readable on the detail page, one click away.
- **Most of the plugin's surfaces are placed by hand in the DOM**, because Stash
  leaves no React insertion point at those positions (see above). How a surface
  is *reached* and where its content *lands* are separate questions: the
  censorship mark, for instance, is an ordinary `after` patch whose button is
  portalled into Stash's own popover row. Each mount point is an empty `<div>`
  that the plugin finds/creates and repositions while rendering; a React
  re-render that displaces it gets corrected automatically. The anchors are
  `.gallery-details` (detail page), `.form-group[data-field="studio_id"]` (edit
  page — confirmed to exist on v0.31.1) and `[data-field="studio"]` (bulk dialog).
  The filter dialog adds two more, anchored differently: the card's list goes
  inside Stash's own `.criterion-editor` box, which exists only while the card is
  open, and a tag drawn for the card joins Stash's tag row, or a row the plugin
  makes when Stash has none.

  The censorship mark adds one more of each kind: a span next to the gallery
  card's `.card-popovers` row, named by the gallery id so the right card's row is
  the one found, and a span after the toolbar's `.organized-button` — see
  [Censorship](#censorship). Those two go further than the others: the mark is
  portalled *into Stash's own row* rather than beside it, because the row is a
  flex container and a sibling would be a line of its own.

  **The correction runs in a *layout* effect.** Most of them need a second pass,
  because the anchor's element does not exist while the tree is still being built.
  A plain effect is flushed after the browser has painted, so the row or section
  would be missing for a frame and everything below it would jump. Layout effects
  run after React writes the DOM but before paint, which is the only window where
  the correction is invisible.
- **The sidebar filter is mounted where Stash mounts its own.** It used to be
  portalled into a `<div>` found by the selector `.sidebar-saved-filters`, with a
  second render pass to get it placed. Stash registers
  `FilteredGalleryList.SidebarSections` — a patchable wrapper around its own
  sidebar filter sections — and the three sections are pushed in front of Stash's
  own there: no anchor, no DOM, no second pass. The filter model has to come from
  somewhere, because that wrapper is handed only `children`: it is published from
  `FilteredGalleryList`'s own output (an `after` patch runs once its body has
  produced the tree, and before React descends into it), which the sections read
  on the same pass. Publishing it from `GalleryList` instead does not work: that
  is the list of cards, rendered *after* the sidebar, so the sections would read
  nothing on the first pass. The patch container arrived in Stash v0.31 — the
  plugin logs an error at the first list render when it is missing, rather than
  leaving an empty sidebar behind.
- **The sidebar section appears a moment after the page** — the delay that used
  to be visible with no explanation. It was the mechanism above: the sections were
  rendered by the cards' patch and portalled into a node created after the sidebar
  had already been committed, so they could not be there for the first paint. They
  are now children of the sidebar's own tree and render with it.
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
  (`plugin.mangaTools.language (custom field) is ja`) for as long as the first
  query takes. See
  [Filtering](#filtering).
- **The dialog's tag mirrors the card, not Stash's copy.** The row inside the dialog
  is worded from the card, and the ✗ on it clears the card — so a click on either is
  applied on **Apply**, and Cancel discards both. That is deliberate: Stash's copy
  cannot be written to from a plugin, so the card is the one that has to be the
  truth.
- **A language chosen in the dialog is applied on an Apply that changed something
  of Stash's, and not otherwise.** The merge that carries the card's selection runs
  once the list's filter has become what Apply committed — and Apply commits the
  dialog's *copy*, which the card's selection is not part of. Change a criterion
  alongside it and the language comes with it; change nothing else and Apply
  commits nothing, the filter never moves, and there is nothing to merge on to.
  The console says which happened (`Apply changed nothing in Stash's filter…`).
  **Picking the language in the sidebar always works**, and that is the way round
  it. Fixing this properly is not a small change: it needs the filter to follow
  the URL every time Apply rewrites it, which is Stash's business, not a plugin's.
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

**Chinese has only two entries, simplified and traditional.** A
"Chinese (unspecified)" entry existed briefly, but it shared the same flag as
simplified and was indistinguishable in both icon and name, adding ambiguity rather
than removing it, so it was dropped — and a bare `zh` is not mapped onto `zh-Hans`
either, for the same reason: the plugin does not guess which one a value meant.

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

**The plugin's own strings are translated too.** The headings, descriptions and
placeholders it writes itself — `Select language…`, the three settings — live in
`src/messages/*.json`, and `t(intl, id)` reads them from the catalog for Stash's UI
language. Everything else on screen comes from Stash's own messages and follows the
language for free.

A locale is chosen by its tag, dropping subtags one at a time, so `zh-Hant-HK` reads
the `zh-Hant` catalog; a bare `zh` reads the Simplified one, matching how a bare
value in the language field is read. A locale with no catalog of its own — or one
that has not translated a particular string — reads English, per key, so a
half-finished translation shows translated sentences rather than ids. See
[Translating](#translating).

Two things stay English, and neither is this plugin's to translate: the label
`exclude` on a sidebar row, which is a literal in Stash's own sidebar filter, and
the `displayName`/`description` in `mangaTools.yml`, which Stash's own settings UI
would render — the plugin replaces that UI with its own, so what is on screen comes
from the catalogs.

**Changing a field name**: edit it in `src/fields.ts`. Everything else reads it
from there, including the GraphQL query in `getQuery`.

**Adding another field** (scanlation group, …): the reading and writing are
already generic — `NS.pickField(map, name)` and `NS.setField(map, name, value)`,
used by both fields and by nothing else. What a third field would need is:

1. a name and its values in `src/fields.ts`, plus a `normalize…` if it is not
   free-form
2. whatever new surface it needs — see **Adding a surface** below
3. a message id per string and state in `src/messages/*.json`
4. a line in `refresh()`'s field list, so a gallery carrying only that field is
   still found by the query that feeds the store

Step 4 is the one that is easy to miss: the store is filled by one query per
field, and a field not in that list exists in the data and nowhere on screen.

**Adding a surface.** Where a new control goes decides how it is added, and there
is a clear order to try:

1. **`patch.after`** — the component is patchable and the control is *added to*
   what it already renders. The original is never called, so nothing about it can
   be disturbed, and its output passes through by identity when there is nothing
   to add. `GalleryCard.Overlays` (the flag badge), `GalleryCard.Popovers` (the
   censorship mark) and `RatingSystem` (the bulk row) are all this, and all three
   mean "the plugin adds a sibling and changes nothing else" is checkable rather
   than merely intended.
2. **`patch.instead`** — the component is patchable but its *props or output* have
   to change: `CustomFields` hands Stash a `values` map with this plugin's keys
   taken out, and `CustomFieldInput` returns null for its own row. This is also
   the only option when the control has to *precede* the original, as
   `GalleryList`'s two mounts do.
3. **A DOM mount point and a portal** — nothing on that part of the page is
   patchable at all. That is true of the three anchored rows, of the gallery
   detail toolbar and of the card's popover row, and it is why each of them
   carries a comment saying which component *would* have been the natural place
   and why it cannot be.

   Two of those go further than the others: the censorship mark is portalled
   **into Stash's own node** rather than beside it, because the row it belongs in
   is a flex container and a sibling would be a line of its own.

**Registering a patch goes through `registerPatch`**, which wraps the call in a
try/catch. That is not about a bad target name — Stash accepts any name and
simply never fires it, which is what the `patch active:` log is for. It is about
the API itself: the patches are registered top to bottom at load time, so a
`PluginApi.patch` that is missing a method would throw and silently kill every
patch *below* it. The smoke test loads the bundle once with a registration
deliberately faulted, to prove the rest still register.

### Translating

The plugin's own strings are the fourteen in `src/messages/en.json` — the edit-page
placeholder, the three settings blocks, and the six names a censorship state has
(current, and what a click would make it). Everything else it puts on screen comes
from Stash's messages, which Stash already translates.

**Adding a language** is two lines and a file:

1. copy `en.json` to a file named after the tag Stash uses — `de.json`,
   `pt-BR.json`, `zh-Hant.json`
2. import it in `src/i18n.ts` and add it to `CATALOGS` there

The list is written out by hand, deliberately: esbuild has no equivalent of Vite's
`import.meta.glob`, so a catalog has to be imported by name, and a file the build
cannot see would simply never load. The smoke test fails if the catalogs disagree
about which ids exist, which is the mistake that would otherwise only show up as a
sentence in the wrong language.

Keys are not translated, only their values. A locale that has not translated a
string reads the English one for that string, so a half-finished catalog shows
translated sentences rather than ids.

Locales are matched by tag, dropping subtags one at a time — `zh-Hant-HK` reads the
`zh-Hant` catalog — and a bare `zh` reads the Simplified one, matching how a bare
value in the language field is read. Anything with no catalog reads English.

`mangaTools.yml` is not translated, and cannot be: its `displayName`/`description`
are what Stash's own settings UI would render. The plugin replaces that UI with its
own, and what it draws comes from the catalogs.

### Deliberately not done

- A dedicated "language" section on the detail page — the value is only shown,
  localised, within the custom fields area
- **A censorship filter, bulk-edit row or settings.** The mark exists to be read
  and set per gallery; a filter for it is the obvious next step, but the language
  filter is enough machinery to prove the approach first. There is no setting for
  it either — with two values and a per-gallery control, a switch would be a
  preference about someone else's library.
- **Explaining the chess icons anywhere on screen.** See [Censorship](#censorship):
  the pun is the point for the reader it is aimed at, and a tooltip about a word
  rather than about the gallery would be worse than none.
- Splitting `src/mangaTools.tsx` into several files — it is ~2000 lines, and imports
  would now make that possible, but splitting it would be a separate change from
  adding a feature, and keeping them apart makes a regression easy to attribute
