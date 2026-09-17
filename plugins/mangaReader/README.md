# Manga Reader

A two-page (**spread**) view for Stash's image lightbox, for reading manga the way
it was printed: two pages side by side, the earlier one on the right.

**Status: working, and off until you turn it on.** Open any gallery, open an image,
open the lightbox's options menu — the one behind the gear icon in its header — and
there is a **Double page** switch at the bottom with the rest of the options.

## What it does

While the switch is on, and while you are reading a **gallery**:

| | |
|---|---|
| **Two pages at once** | Laid out to fit the screen, in reading order, the earlier page on the right |
| **Spreads** | A page wider than it is tall is taken for one image spanning two pages, and stands alone |
| **The cover** | Stands alone. A cover is not the left half of anything |
| **Arrows** | Left and right move a *screen*, not a page — so a pair advances together |
| **Shift the pairing** | A second switch in the options menu, or `O`, for a gallery whose pages are grouped wrongly. Remembered for that gallery |
| **Everything else** | Untouched. The header counter, the chapters, the nav strip, Escape, fullscreen, the slideshow — all still Stash's, and all still work, because the lightbox is still what says which page you are on |

Both switches are remembered per browser, like the lightbox options they sit
beside — except the shift, which is remembered *per gallery*, because that is what
it belongs to: one scan's pages need shifting and the gallery next to it does not.

Off a gallery page — an image list, a scene's stills — the mode draws nothing, even
switched on: pairing pages only means something inside a gallery.

## The three things worth knowing

**It is DOM surgery, not a React patch.** Stash's lightbox is
`LightboxComponent`, a plain `React.FC` with no `PatchComponent` wrapper, so
`PluginApi.patch` cannot reach it. What this plugin does instead is watch the
document for a lightbox appearing, put a container of its own **beside** Stash's
carousel — never in place of it, so React can re-render its own subtree without
ours going with it — hide that carousel with a class, and drive the lightbox
through its own interface: it reads where the lightbox is from its header, and
moves it with its own arrow keys rather than keeping a second idea of the current
page that could drift from the first.

The approach follows
[kokkengMangaViewer](https://github.com/kokkeng1/stash_plugin_custom/tree/main/plugins/kokkengMangaViewer),
which does the same thing in the wild for a scrolling view.

**Keys are pressed one at a time, and that is not a detail.** A turn of a screen is
two pages, and the lightbox moves one page per press — but it *drops* a press that
arrives while the page before it is still swapping (`isSwitchingPageRef` in Stash's
lightbox: "rapid inputs are dropped"). Two presses in the same tick therefore move
one page rather than two, intermittently, since a cached page swaps fast enough for
it not to happen. So a move is an errand: press once, wait for the header to say it
landed, press again — and send it again if the wait runs out, because a dropped
press changes nothing in the DOM for anything else to notice.

**Everything it depends on is in one file.** `src/stash-lightbox.ts` holds the
class names, the header format and the image query — the whole of what this plugin
assumes about Stash's markup. If a Stash release renames any of it, the reader stops
drawing and says so in the console rather than drawing something wrong: a canvas
that cannot tell where it is must not paint. The same goes for a gallery Stash
cannot answer for, or one whose page count no longer matches what the lightbox is
showing.

## What is not here yet

- **No zoom or pan in spread mode.** Stash's zoom acts on the carousel, which is
  hidden while this plugin draws. Pages are fitted to the screen and that is all.
- **Two of the pairing rules are settings without a UI**: `coverAlone` and
  `detectSpreads` are stored and honoured, but the options menu offers only the
  mode and the shift. Both default to what a manga wants.
- **The switches are worded in English the first time.** Their language comes from
  Stash's own configuration, which is read with the gallery — so the wording is
  right from the second time the menu is opened in a session.
- **Reading progress** is not tracked. That needs a viewer of our own rather than a
  takeover of Stash's.

## Why a separate plugin from mangaTools

`mangaTools` is about *managing* a manga library: the custom fields, the filters,
the panels. This is about *reading* one. They share a purpose and no code, and
reading is where a mistake is most annoying — so they keep separate blast radii.
Nothing here reads `mangaTools`' fields, and nothing there knows this plugin exists.

## Files

```
mangaReader/
├── src/
│   ├── mangaReader.tsx     Entry: loads Stash's API and starts watching
│   ├── spreads.ts          The pairing rules (pure, no DOM)
│   ├── settings.ts         What is remembered, and how it is parsed
│   ├── stash-lightbox.ts   Everything that assumes something about Stash's markup
│   ├── takeover.ts         The reader itself: the observer, the drawing, the keys
│   ├── i18n.ts             The plugin's own two strings
│   └── plugin-api.ts       Types, and the namespace the tests reach
├── tests/
│   ├── smoke.js            The pairing rules and the reader, section by section
│   └── dom.js              A fake DOM: only the parts this plugin touches
├── mangaReader.css         Hiding the carousel, laying out the two pages
└── mangaReader.yml         Plugin config (the file name is the plugin ID)
```

## Verifying

From the repository root:

```bash
npm test            # lints, type-checks, bundles, packages, then runs both plugins' tests
node plugins/mangaReader/tests/smoke.js   # just this one (build first: npm run build)
```

What the tests cannot cover is whether Stash's markup is still what
`stash-lightbox.ts` says it is. No test of ours can, which is why the reader is
written to stop rather than guess — the failure mode is a switch that has to be
pressed again, never a blank screen.
