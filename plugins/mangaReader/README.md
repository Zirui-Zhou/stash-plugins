# Manga Reader

A two-page (**spread**) view for Stash's image lightbox, for reading manga the way
it was printed: two pages side by side, the earlier one on the right.

**Status: the pairing rules are in, the viewer is not.** The plugin installs, loads
and does nothing visible yet — see [What is here](#what-is-here) and
[What is next](#what-is-next). It is deliberately inert rather than half-wired:
nothing on screen changes, so installing it cannot break a reading session.

## What is here

`src/spreads.ts`: how a gallery's pages go together into screens. Pure functions,
no DOM, no Stash API — and the only part of this plugin with real tests.

| Rule | What it does |
|---|---|
| **Cover alone** | The first page takes a screen of its own. A cover is not the left half of anything |
| **Spreads alone** | A page wider than it is tall is one image spanning two pages, so it takes a screen of its own |
| **Pairs** | Two ordinary pages share a screen, and the odd one out at the end stands alone |
| **Offset** | Strands one more page after the cover, to put a wrongly-grouped gallery's pairs back |

A screen holds its pages **in reading order** — `pages[0]` is the earlier page,
whatever side it is drawn on. The reader reverses them when it lays them out,
which keeps the direction question out of the rules entirely.

The offset exists because of one case nothing can settle from the data: **a page
scanned on its side is as wide as a spread is.** When one is judged wrongly, every
pair after it is off by a page, and shifting the pairing by one puts them all back.

## What is next

The viewer itself: taking over the lightbox's display area, and a switch in the
lightbox's own options menu to turn the mode on.

That half is **DOM surgery**, not a React patch, and it is worth saying why:
Stash's lightbox is `LightboxComponent`, a plain `React.FC` with no
`PatchComponent` wrapper, so `PluginApi.patch` cannot reach it. The approach —
`MutationObserver` on `.Lightbox`, a container inserted *beside* Stash's carousel
rather than replacing it, and driving the lightbox through its own interface (its
arrow keys, its header indicator) — follows
[kokkengMangaViewer](https://github.com/kokkeng1/stash_plugin_custom/tree/main/plugins/kokkengMangaViewer),
which does the same thing in the wild for a scrolling view.

## Why a separate plugin from mangaTools

`mangaTools` is about *managing* a manga library: the custom fields, the filters,
the panels. This is about *reading* one. They share a purpose and no code, and
reading is where a mistake is most annoying — so they keep separate blast radii.
Nothing here uses `mangaTools`' fields, and nothing there knows this plugin exists.

## Verifying

From the repository root:

```bash
npm test            # lints, type-checks, bundles, packages, then runs every plugin's tests
node plugins/mangaReader/tests/smoke.js   # just this one (build first: npm run build)
```
