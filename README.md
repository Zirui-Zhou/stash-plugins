# stash-plugins

A collection of plugins for [Stash](https://github.com/stashapp/stash). Installed
and updated through Stash's own plugin manager — no copying files by hand.

## Installation

In Stash, go to **Settings → Plugins → Available Plugins → Add Source** and fill in:

| Field | Value |
|---|---|
| Name | anything, e.g. `Comic plugins` |
| Source URL | `https://<your-username>.github.io/stash-plugins/index.yml` |
| Local Path | anything, e.g. `stash-plugins` |

Every plugin in this repository then shows up in the list. Tick the ones you want,
click **Install**, then **Reload Plugins**.

When something is updated later, click **Update** under **Installed Plugins**.

## Plugins in this repo

| ID | Description |
|---|---|
| `mangaTools` | Adapts Stash galleries to manga/comic management. First feature: a language attribute — a flag badge on the card cover, a dropdown on the edit page, a localised row on the detail page. |

Each plugin's own documentation lives in `plugins/<id>/README.md`.

## Adding a plugin

1. Create a directory under `plugins/`. Naming it after the plugin ID is the
   sane choice:

   ```
   plugins/myPlugin/
   ├── myPlugin.yml      ← the plugin ID comes from this file name; it must be <id>.yml
   ├── myPlugin.js
   └── myPlugin.css
   ```

2. `myPlugin.yml` **must** have top-level `name` and `version`:

   ```yaml
   name: My Plugin
   description: One-line description
   version: 0.1.0        # base version only; the build appends a suffix
   ui:
     javascript:
       - myPlugin.js
     css:
       - myPlugin.css
   ```

3. Push to `main`. CI packages it, regenerates the manifest, and publishes.

**Bump `version` when you change the code.** Stash decides whether an update is
available from the version number; if it does not change, no update is offered.

### Only runtime files belong in the plugin directory

Whatever sits in `plugins/<id>/` **gets zipped as-is**. Put tests, notes and
sample data elsewhere in the repo (under `tests/`, say) — otherwise they are
installed into every user's plugin directory too.

## How publishing works

`.github/workflows/build.yml` does three things on a push to `main`:

1. Runs `node tools/build.mjs`, zipping each plugin under `plugins/` to `dist/<id>.zip`
2. Generates `dist/index.yml` (Stash's package manifest)
3. Pushes `dist/` to the `gh-pages` branch, from which GitHub Pages serves it

The build can also be run locally — `node tools/build.mjs` — writing to `dist/`.

> **Enabling Pages the first time**: repository Settings → Pages → Source, choose
> `Deploy from a branch`, pick the `gh-pages` branch and the `/ (root)` directory.
> This can only be set once CI has run at least once and the `gh-pages` branch
> exists.

## Conventions and gotchas

**The plugin ID comes from the yml file name**, not the directory name. When the
two disagree the yml wins — so keeping them identical saves confusion.

**The zip is flat inside**, with no wrapping directory. The directory name on the
user's machine comes from the manifest's `id`. This was confirmed by unpacking a
zip from the official source.

**The version is written back into the yml inside the zip.** You write
`version: 0.1.0` in the repo; after building, both the yml inside the zip and the
manifest say `0.1.0-<short SHA>`. That keeps the installed version and the source
version equal, so Stash does not report an update forever.

**Every string in the manifest is quoted.** Unquoted, `version: 1.0` would parse
as a float and `date: 2026-09-14 12:00:00` as a timestamp, either of which makes
Stash fail to deserialize the field.

**Any `.yml` under Stash's plugin directory is loaded as a plugin.** That does not
apply to this repository (it is never cloned into a plugins directory), but it
matters if you drop a plugin straight into Stash's `plugins/` to debug — Stash
scans recursively, so `.github/workflows/*.yml` would be picked up too.

## Dependencies

The build script has no npm dependencies: YAML is read with regexes anchored to
column 0, and zipping is delegated to the system `zip` command, which the GitHub
Actions ubuntu runner ships.
