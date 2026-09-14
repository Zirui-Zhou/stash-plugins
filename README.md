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
| `mangaTools` | Adapts Stash galleries to manga/comic management. A language attribute — a flag badge on the card cover, a dropdown on the edit page, a localised row on the detail page — plus a plugin setting that limits which languages the dropdown offers. |

Each plugin's own documentation lives in `plugins/<id>/README.md`.

## Adding a plugin

1. Create a directory under `plugins/`. Naming it after the plugin ID is the
   sane choice:

   ```
   plugins/myPlugin/
   ├── src/
   │   ├── myPlugin.tsx     ← TypeScript source; compiled into build/
   │   └── pluginApi.d.ts   ← types for the interfaces Stash injects
   ├── myPlugin.yml         ← the plugin ID comes from this file name; it must be <id>.yml
   ├── myPlugin.css
   └── tsconfig.json
   ```

   Copy `plugins/mangaTools/tsconfig.json` — it only sets `rootDir`/`outDir` and
   extends the shared `tsconfig.base.json`.

2. `myPlugin.yml` **must** have top-level `name` and `version`, and its
   `ui.javascript` entries name the **compiled** files (same base name as the
   sources, so `myPlugin.tsx` → `myPlugin.js`):

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

3. Push to `main`. CI installs dependencies, compiles, tests, and publishes.

**Bump `version` when you change the code.** Stash decides whether an update is
available from the version number; if it does not change, no update is offered.

### What gets zipped, and what does not

Only the plugin's `build/` directory is packaged: the compiled JavaScript plus
the `.yml`, `.css` and `.md` files copied in beside it. Sources, `tsconfig.json`
and anything else stay out of the zip.

The build **fails** if the `.yml` references a file that is not in that output,
so a stale entry in `ui.javascript` or a source file missing from `tsconfig`'s
`include` is caught before publishing rather than producing a plugin that
installs cleanly and then does nothing.

## The TypeScript setup

`tsconfig.base.json` is shared by every plugin, and started from the official
Stash plugin example (`pkg/plugin/examples/react-component` in the Stash repo).
Three options there are load-bearing:

- **`"module": "esnext"`** — the compiled files stay plain scripts, not ES
  modules. That is what lets Stash load them individually through `ui.javascript`
  and lets them talk to each other through a `window` global. The example used
  `module: "None"` for this, but that value was deprecated in TypeScript 6.0 and
  removed in 7.0, so the repo uses `esnext` instead. The output is the same,
  because the source files contain no `import`/`export`. (The one consequence: an
  `import` now compiles instead of being an error, and would then fail at runtime
  because Stash loads the file as a plain script — pulling in an npm package
  still needs a bundler.)
- **`"jsx": "react"`** (the classic transform) — JSX compiles to
  `React.createElement`, using a `React` variable from the surrounding scope.
  Plugins have no React import; they take it from `PluginApi.React`, which is
  exactly what the classic transform expects. That `var React = ...` line must
  stay in each plugin's entry file.
- **`"types": ["react"]`** — TypeScript 7.0 is the native (Go) compiler and no
  longer auto-includes every `@types/*` package, so the ones in use are listed
  explicitly.

`window.PluginApi` and `window.MangaTools` are declared in
`plugins/<id>/src/pluginApi.d.ts`. It is a plain global script on purpose: a file
containing an import becomes a module, which would break the emitted output.

## How publishing works

`.github/workflows/build.yml` on a push to `main`:

1. `npm ci`, then `npm test` — this compiles every plugin into its `build/`
   directory, packages them into `dist/`, and runs the smoke tests against the
   compiled output. A failure stops the job before anything is published.
2. Pushes `dist/` to the `gh-pages` branch, from which GitHub Pages serves it.

Locally:

```bash
npm install     # once
npm run build   # compile + package into dist/
npm test        # the above, then run the tests
npm run typecheck
```

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

Two, both `devDependencies` at the repo root: `typescript` (^7.0.2) and
`@types/react` (^18.3.31). TypeScript 7.0 is the native (Go) compiler; its
`node_modules/typescript/bin/tsc` is still a thin JS shim that spawns the native
binary, so the invocation below keeps working unchanged.

`tools/build.mjs` itself has none — YAML is read with regexes anchored to column
0, and zipping is delegated to the system `zip` command, which the GitHub Actions
ubuntu runner ships. It invokes the TypeScript compiler through the current node
binary (`node_modules/typescript/bin/tsc`) rather than via `npx` or the
`node_modules/.bin` shim, since those differ per platform.
