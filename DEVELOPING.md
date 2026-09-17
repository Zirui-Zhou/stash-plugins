# Developing

How the plugins in this repository are built, packaged and published, and the
conventions to follow when adding one. For installing them, see
[README.md](README.md).

## Adding a plugin

1. Create a directory under `plugins/`. Naming it after the plugin ID is the
   sane choice:

   ```
   plugins/myPlugin/
   ├── src/
   │   ├── myPlugin.tsx     ← entry point; bundled into build/myPlugin.js
   │   └── plugin-api.ts    ← types for the interfaces Stash injects
   ├── tests/
   │   └── smoke.js         ← the plugin's own tests (see below)
   ├── myPlugin.yml         ← the plugin ID comes from this file name; it must be <id>.yml
   ├── myPlugin.css
   └── tsconfig.json
   ```

   Copy `plugins/mangaTools/tsconfig.json` — it only turns off emitting, so that
   `tsc` cannot write over the bundler's output.

   **The entry point's name is fixed**: `src/<id>.tsx`, or `src/<id>.ts` for a
   plugin with no JSX. The build looks for exactly those and fails with the paths
   it tried if neither exists, because the emitted file name is derived from the
   plugin ID — that is the only way the output and `ui.javascript` cannot drift
   apart. Anything the entry point imports is inlined into the one file.

   **A plugin with no UI needs none of that.** Leave out `src/` and
   `tsconfig.json`, write the plugin in whatever language it needs, and the build
   packages the plugin's directory as it stands — nothing is bundled, and a
   `tests/` directory in it is left out of the package. No plugin here does this
   at the moment; the support is there because the build had it anyway.

2. `myPlugin.yml` **must** have top-level `name` and `version`, and its
   `ui.javascript` names the **bundled** file (same base name again, so
   `myPlugin.tsx` → `myPlugin.js`):

   ```yaml
   name: My Plugin
   description: One-line description
   url: https://github.com/<you>/<repo>/tree/main/plugins/myPlugin
   version: 0.1.0        # base version only; the build appends a suffix
   ui:
     javascript:
       - myPlugin.js
     css:
       - myPlugin.css
   ```

   `url` is optional, but it is what draws the **link button** next to the plugin
   under Settings → Plugins — point it at the plugin's page (its directory in
   this repo, or wherever it is documented).

3. Push to `main`. CI installs dependencies, type-checks, bundles, tests, and
   publishes.

**Bump `version` when you change the code.** Stash decides whether an update is
available from the version number; if it does not change, no update is offered.
Documentation and comment-only edits do not need a bump.

### Where the tests live

Beside the plugin they test, at `plugins/<id>/tests/` — not in a shared top-level
`tests/`. The spec then reaches its build output as `../build` by position alone,
with no plugin name in the path; `src/`, `tests/` and `build/` all belong to the
plugin, so moving or deleting one takes its tests with it; and two plugins cannot
collide over a name like `smoke.js`. `npm test` names each spec explicitly.

When a second plugin's tests want the same stubs — the fake `PluginApi`, React,
DOM and Apollo client in mangaTools' spec are all generic — lift them into a
shared file both can import. Don't move the specs back to the root to share them.

One spec file is a fine place to start, but a suite grows. mangaTools' is the
worked example of what that looks like: `tests/smoke.js` keeps the name `npm test`
runs and does nothing but run the others in order, `tests/helpers.js` holds the
stubs, the fixtures and the loaded bundle, and `tests/sections/` holds one file
per area. Anything two section files both drive moves up to a shared module
rather than being copied into both.

A `tests/` directory inside a plugin is safe from packaging: only what
`src/<id>.tsx` imports is bundled, and only `.yml`/`.css`/`.md` are copied in from
the plugin root. That is **not** true of a plain-JS plugin (no `tsconfig.json`),
which is packaged whole — and packaging copies entry by entry, so a subdirectory in
one fails the build rather than shipping.

### What gets zipped, and what does not

Only the plugin's `build/` directory is packaged: the bundled JavaScript plus the
`.yml`, `.css` and `.md` files copied in beside it. Sources, `tsconfig.json` and
anything else stay out of the zip.

The build **fails** if the `.yml` references a file that is not in that output,
so a stale entry in `ui.javascript` or an entry point the build never produced is
caught before publishing rather than producing a plugin that installs cleanly and
then does nothing.

## The build

Two tools do two different jobs, and both are necessary:

| | Does | Does not do |
|---|---|---|
| **esbuild** | bundles `src/` into the one file Stash loads | read types — it strips them |
| **tsc** | checks the types, emits nothing | produce the shipped file |

The split matters because **esbuild does not type-check**. It parses the TypeScript
and throws the annotations away without ever evaluating them, so a plugin full of
type errors bundles perfectly happily. `npm test` therefore runs `tsc` *before*
the bundler — `npm run typecheck`, then `npm run build`, then the smoke tests. CI
uses `npm test`, so a type error cannot reach a published package. `npm run build`
on its own skips the check, which is what makes local iteration fast.

### Bundler options that matter

Set in `tools/build.mjs`:

- **`format: "iife"`** — Stash loads the file through a plain `<script>` tag, so
  it has to be a script, not an ES module. This is the option that would break
  the plugin outright if it changed, which is why its own smoke test asserts the
  output contains no module syntax.
- **`target: "es2019"`** — matches `tsconfig.base.json`, so nothing newer slips
  through the bundler than the type-checker was told to accept.
- **`tsconfig`** — points esbuild at the plugin's own tsconfig rather than
  restating its settings, so the bundler and the type-checker read the same file
  and cannot disagree about the JSX transform.
- **`minify`/`sourcemap` off**, and **`charset` left at `ascii`** (so CJK strings
  become `\uXXXX`). The zip is small either way, a readable file is what you
  debug with in the browser, and ASCII output is correct regardless of what
  encoding anything in the serving path assumes.

### What the bundler buys, and what it costs

Bought: `import` works, so the plugin is split into modules instead of
communicating through `window` globals; npm packages become installable (adding
one is `npm i <pkg>` plus an import — nothing else changes); and Stash loads one
file per plugin, so there is no load-order rule to remember.

Cost: `npm test` runs a second tool, a source change is only visible after a
build (so the tests exercise the bundle, never the sources), and the shipped
JavaScript no longer looks like what you wrote. That last one is the reason the
smoke tests assert against behaviour rather than against the file.

## The TypeScript setup

`tsconfig.base.json` is shared by every plugin, and started from the official
Stash plugin example (`pkg/plugin/examples/react-component` in the Stash repo).
Three options there are load-bearing:

- **`"jsx": "react"`** (the classic transform) — JSX compiles to
  `React.createElement`, using a `React` variable from the surrounding scope.
  Plugins have no React import; they take it from `PluginApi.React`, which is
  exactly what the classic transform expects. That `var React = ...` line must
  stay in each plugin's entry file.
- **`"module": "esnext"` + `"moduleResolution": "bundler"`** — the example used
  `module: "None"`, which kept the output as plain scripts that talked to each
  other through a `window` global. The bundler replaces that, and `"None"` was
  deprecated in TypeScript 6.0 and removed in 7.0 anyway. `"bundler"` resolution
  is what makes `import x from "./y"` resolve the way esbuild resolves it.
- **`"types": ["react"]`** — TypeScript 7.0 is the native (Go) compiler and no
  longer auto-includes every `@types/*` package, so the ones in use are listed
  explicitly.

Type declarations live in `plugins/<id>/src/plugin-api.ts` — a real module that
exports the interfaces and imports them by name, so a mistyped type name is a
compile error rather than a silent reference to some other global. `interface
Window` sits in a `declare global` block there, which a module needs and a global
script does not.

`requirePluginApi()` at the top of the entry point returns the API or throws.
Stash injects `PluginApi` before it loads any plugin script, so its absence means
something is wrong at the loading level; a bundled entry point has no early
`return` to bail out with, and throwing is both the honest and the simpler signal.

## How publishing works

`.github/workflows/build.yml` on a push to `main`:

1. `npm ci`, then `npm test` — this type-checks every plugin, bundles it into its
   `build/` directory, packages everything into `dist/`, and runs the smoke tests
   against the bundled output. A failure stops the job before anything is
   published.
2. Pushes `dist/` to the `gh-pages` branch, from which GitHub Pages serves it.

Locally:

```bash
npm install         # once
npm run typecheck   # tsc over every plugin, no output
npm run build       # bundle + package into dist/ (no type-check)
npm test            # all of the above, plus the smoke tests

# Package a second, separately installable copy — see "Trying a change" below.
node tools/build.mjs --id-suffix=Test
# …and somewhere other than dist/, which leaves the ordinary build alone.
node tools/build.mjs --id-suffix=Test --out=/tmp/somewhere
```

> **Enabling Pages the first time**: repository Settings → Pages → Source, choose
> `Deploy from a branch`, pick the `gh-pages` branch and the `/ (root)` directory.
> This can only be set once CI has run at least once and the `gh-pages` branch
> exists.

### Trying a change without disturbing the real plugin

A UI change is not something you can judge from a diff — it has to be looked at,
in a browser, over a real library. Doing that by installing the branch normally
does not work: **Stash keys installs on the plugin ID, and it hides any available
package whose ID is already installed.** Two sources offering `mangaTools` cannot
both be installed; while one is installed, the other's entry does not even appear
in Available Plugins. And uninstalling to swap between them means a plugin reload
every time you want to look.

So a branch publishes a *different plugin* instead:

1. **A branch**, `test` or whatever it is called. Everything experimental lives
   here, and `main` stays as it is for the duration.
2. **`.github/workflows/publish-test.yml`**, which is already in the repo. It is
   inert unless a branch named `test` is pushed to — the name is in the workflow's
   `on:` — and then it runs `npm test`, then
   `node tools/build.mjs --id-suffix=Test`, and publishes `dist/` to the
   **`gh-pages-test`** branch. Nothing *serves* that branch — it is a place to put
   two files, in the same spirit as `gh-pages`, and it is always a single orphan
   commit because the workflow forces that.
3. **A second plugin source in Stash** pointing at the branch over raw:

   ```
   https://raw.githubusercontent.com/<username>/stash-plugins/gh-pages-test/index.yml
   ```

   The zip sits beside the index (`path:` in the manifest is relative), so a raw
   URL resolves both.

   That URL only answers once the workflow has run at least once.

4. **Install it.** It appears as *Manga Tools (test)* — a second plugin, with its
   own enable toggle, sitting beside the real one. Enable one and disable the
   other; whichever is enabled is the one whose patches are registered.

   The two share the custom fields (the same data, so an experiment runs against
   the real library) and read the *real* plugin's settings, because the ID in the
   source is still `mangaTools` where that matters. Which means the test copy's
   own settings row is inert — edit the real one.

**It publishes only the suffixed plugin.** With a suffix, `build.mjs` packages
every plugin under `<id><suffix>` and nothing else, so there is no entry in that
manifest that could update the real plugin. `tools/check-package-variant.mjs`
holds that in place, and checks the part the manifest cannot show: that the yml
*inside the zip* was renamed too. If it were not, installing the test source would
silently overwrite the real plugin — the manifest would say `mangaToolsTest`
while Stash, reading the yml's file name, installed `mangaTools`.

**Publishing the real plugin never depends on this.** The workflow is its own
file on its own branch with its own concurrency group, so a broken experiment
cannot stop `main` from publishing, and a push to `test` cannot cancel a publish
of `main`. That is the whole reason it is not a second job in `build.yml`.

**When the experiment is over**, either merge it or delete the branch. The
`gh-pages-test` branch and the second source in Stash can be removed at the same
time; neither is referenced from anywhere else.

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

Three, all `devDependencies` at the repo root:

- `typescript` (^7.0.2) — the type-checker. 7.0 is the native (Go) compiler; its
  `node_modules/typescript/bin/tsc` is still a thin JS shim that spawns the native
  binary, so invoking it through node keeps working.
- `@types/react` (^18.3.31) — React's types. Stash runs React 17, but 17's types
  are long unmaintained and 18's describe the same code; the official plugin
  example uses 18 too.
- `esbuild` (^0.28.2) — the bundler. It is called through its own API
  (`buildSync`), so unlike tsc it is not spawned as a child process.

Nothing else at runtime: YAML is read with regexes anchored to column 0, and
zipping is delegated to the system `zip` command, which the GitHub Actions Ubuntu
runner ships. `tools/build.mjs` invokes the TypeScript compiler through the current
node binary (`node_modules/typescript/bin/tsc`) rather than via `npx` or the
`node_modules/.bin` shim, since those differ per platform.

`npm test` requires both tools; `npm run build` alone needs only esbuild.
