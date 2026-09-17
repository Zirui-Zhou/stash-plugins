#!/usr/bin/env node
/**
 * Packages every plugin under plugins/ and generates Stash's package index.
 *
 * Output lands in dist/:
 *   dist/<pluginId>.zip   One zip per plugin, with the files **flat** inside
 *                         (no wrapping directory).
 *   dist/index.yml        Stash's package manifest. The "source URL" you type
 *                         into Stash points at this file.
 *
 * Publishing is handled by .github/workflows/build.yml, which pushes dist/ to
 * the gh-pages branch; GitHub Pages then serves it at
 * https://<username>.github.io/stash-plugins/.
 *
 * Also runnable locally:
 *   node tools/build.mjs                       package into dist/
 *   node tools/build.mjs --typecheck           type-check only, no output
 *   node tools/build.mjs --id-suffix=Test      package a second, separately
 *                                              installable copy — see below
 *   node tools/build.mjs --out=/tmp/somewhere  write somewhere other than dist/
 *
 * `--id-suffix` exists so a branch can publish a build that installs *beside* the
 * real plugin rather than over it. Stash keys installs on the plugin ID, and it
 * hides any available package whose ID is already installed, so two sources
 * offering the same ID cannot both be installed — the second never even appears.
 * A suffixed build carries the suffix in its ID, its yml file name and its
 * display name, which makes it a second plugin with its own enable toggle. The
 * two then share the custom fields (the data) and the settings (the stable
 * copy's), which is what makes it usable against a real library.
 *
 * It *replaces* rather than adds: with a suffix, every plugin is packaged under
 * its suffixed ID and nothing else. That way the index a test branch publishes
 * contains no entry that could update the real plugin.
 *
 * One npm dependency, esbuild, which bundles each plugin's TypeScript entry
 * point into the single .js file Stash loads. It is deliberately **not** a
 * type-checker — esbuild strips types without reading them — so `--typecheck`
 * runs tsc over the same sources. `npm test` does both, which is what keeps a
 * type error from reaching a published package.
 *
 * The rest stays dependency-free:
 *   - YAML is read with regexes anchored to column 0. Our plugin configs keep
 *     their top-level keys at column 0, so a nested key of the same name
 *     (say ui.version) can never be picked up by mistake.
 *   - Zipping is delegated to the system `zip` command, which the GitHub
 *     Actions ubuntu runner ships.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
// A real YAML parser, for one check: that a plugin's manifest is readable at all.
// The readers below are hand-rolled and tolerant; this is the only thing here that
// can tell a broken manifest from a working one. See buildPlugin.
import { load as parseYaml } from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const DIST_DIR = path.join(ROOT, "dist");

/**
 * esbuild's options, shared by every plugin.
 *
 *   format: "iife"     Stash loads the file with a plain <script> tag, so it has
 *                      to be a script, not an ES module. This is the one option
 *                      that would break the plugin outright if it changed.
 *   target: "es2019"   Matches tsconfig.base.json, so a construct that tsc would
 *                      accept for a newer target is still downleveled here.
 *   minify/sourcemap   Off. The zip is small either way, and a readable file in
 *                      the browser is what you actually debug with. esbuild
 *                      cannot emit a map Stash would use anyway — it serves the
 *                      file raw, with no devtools or stack mapping behind it.
 *   charset            Left at esbuild's default ("ascii"), which escapes every
 *                      non-ASCII character — this plugin is full of CJK language
 *                      names, so the output is \uXXXX rather than 日语. That is
 *                      deliberate: it keeps the file correct no matter what
 *                      encoding anything between the repo and the browser
 *                      assumes. Read the .ts sources, not this file.
 */
const ESBUILD_OPTIONS = {
  bundle: true,
  format: "iife",
  target: "es2019",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
};

/**
 * Reads a top-level `<key>: <value>`.
 *
 * The regex is anchored to column 0, so it only ever matches a top-level key —
 * never a nested one that happens to share the name.
 */
function topLevel(text, key) {
  const m = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(text);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
}

/** Reads an indented list under a top-level `<key>:` (used for `requires`). */
function topLevelList(text, key) {
  const m = new RegExp(`^${key}:[ \\t]*\\n((?:[ \\t]+-.*\\n?)*)`, "m").exec(
    text
  );
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^-[ \t]*/, "")
        .trim()
    )
    .filter(Boolean);
}

/**
 * Reads an indented list under a `<key>:` line at any depth — used for
 * ui.javascript and ui.css, which sit under `ui:` rather than at column 0.
 */
function listUnderKey(text, key) {
  const m = new RegExp(
    `^[ \\t]+${key}:[ \\t]*\\n((?:[ \\t]+-.*\\n?)*)`,
    "m"
  ).exec(text);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^-[ \t]*/, "")
        .trim()
    )
    .filter(Boolean);
}

/**
 * Reads an indented `key: value` map under a `<key>:` line — used for ui.assets,
 * which maps a served URL prefix to a directory in the plugin.
 *
 * Same approach as the list reader above: anchored to the key, one line per
 * entry, no dependency. A value that is empty ("/" with nothing after it) is
 * skipped rather than treated as a directory named "".
 */
function mapUnderKey(text, key) {
  // A key line, then the lines below it that are indented further and are
  // `something: value` pairs. The character class excludes the leading `-` of a
  // list item, so a list under the same parent is not read as a map — and spells
  // whitespace out as " \t" rather than \s, because this is a *string* before it
  // is a regex: in a template literal an unknown escape is the character itself,
  // so \s would quietly mean the letter s.
  const m = new RegExp(
    `^[ \t]+${key}:[ \t]*\n((?:[ \t]+[^- \t#][^:\n]*:.*\n?)*)`,
    "m"
  ).exec(text);
  if (!m) return {};

  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = /^[ \t]+([^:]+):[ \t]*(.*)$/.exec(line);
    const name = kv?.[1].trim();
    const value = kv?.[2].trim();
    if (name && value) out[name] = value;
  }
  return out;
}

/** Copies a directory tree. The zip holds a tree, not a flat set of files. */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

/**
 * Checks that every file the yml references actually made it into the package.
 *
 * This is the step that catches a build configuration mistake — a source file
 * not included by tsconfig, a renamed file, a stale entry in ui.javascript.
 * Without it the plugin would install cleanly and then silently do nothing,
 * because Stash gets a 404 for the script and logs nothing the user would see.
 */
function assertReferencedFilesExist(id, ymlText, dir) {
  for (const key of ["javascript", "css"]) {
    for (const rel of listUnderKey(ymlText, key)) {
      // External URLs are loaded by the browser, not shipped in the zip.
      if (/^https?:\/\//.test(rel)) continue;
      if (!fs.existsSync(path.join(dir, rel))) {
        throw new Error(
          `${id}: ${key} in the plugin config references "${rel}", ` +
            `which is not in the package (looked in ${dir})`
        );
      }
    }
  }
}

/** Short SHA for this build, used as the version suffix. */
function shortSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      // git writes "fatal: not a git repository" to stderr, which makes a local
      // trial run look like it failed. Swallow it.
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not a git repo yet, or no commits — which is normal for a local trial run.
    return "dev";
  }
}

/**
 * The value of a `--name=value` argument, or "" when the argument was not given.
 *
 * The script takes no positional arguments, so a few lines are enough — and they
 * are better than `find(...)?.split("=")[1]`, which would read a malformed
 * `--out` (given with no value) as "use the default" instead of failing.
 */
function argValue(name) {
  const arg = process.argv.find((a) => a.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1).trim() : "";
}

/**
 * The ID suffix from `--id-suffix=...`, or "" for an ordinary build.
 *
 * Restricted to letters and digits because it becomes part of a plugin ID, a
 * file name and a URL. Anything else could produce a package Stash cannot install
 * — or, worse, one whose ID differs from what the person who wrote the flag
 * expected, which would overwrite the real plugin instead of sitting beside it.
 */
function idSuffix() {
  const value = argValue("--id-suffix");
  if (value && !/^[A-Za-z][A-Za-z0-9]*$/.test(value)) {
    throw new Error(
      `--id-suffix must be letters and digits, starting with a letter ` +
        `(got ${JSON.stringify(value)})`
    );
  }
  return value;
}

/** Lists the plugin directory names under plugins/. */
function listPluginDirs() {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  return fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

/** Path of a plugin's tsconfig.json — its presence is what marks a plugin as TypeScript */
function tsconfigOf(dir) {
  return path.join(dir, "tsconfig.json");
}

/** Every plugin directory that holds a tsconfig.json */
function typescriptPlugins() {
  return listPluginDirs()
    .map((name) => ({ name, dir: path.join(PLUGINS_DIR, name) }))
    .filter((p) => fs.existsSync(tsconfigOf(p.dir)));
}

/**
 * Runs tsc over every TypeScript plugin, without emitting anything.
 *
 * This is the step esbuild cannot do. esbuild parses the types and throws them
 * away — it never reads them — so a plugin can bundle cleanly while being full
 * of errors that the compiler would have caught. Both have to run for a build
 * to mean anything, which is why `npm test` runs this before packaging.
 */
function typecheck() {
  const plugins = typescriptPlugins();
  if (!plugins.length) {
    console.log("No TypeScript plugins to check.");
    return;
  }

  const tsc = path.join(ROOT, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(tsc)) {
    throw new Error(
      `Type-checking needs typescript, which is not installed — ` +
        `run \`npm ci\` (or \`npm install\`) first`
    );
  }

  for (const plugin of plugins) {
    console.log(`  typecheck ${plugin.name}`);
    // Run the compiler through the current node binary rather than through npx
    // or the node_modules/.bin shim: those differ per platform (tsc.cmd on
    // Windows) and are awkward to invoke without going through a shell.
    execFileSync(process.execPath, [tsc, "-p", tsconfigOf(plugin.dir)], {
      cwd: ROOT,
      stdio: "inherit",
    });
  }
}

/**
 * The TypeScript entry point of a plugin: src/<id>.tsx, or src/<id>.ts.
 *
 * The name is fixed rather than discovered, because the output file has to match
 * what ui.javascript names in the yml, and deriving it from the plugin ID is the
 * only way both agree without a second source of truth.
 */
function findEntry(dir, id) {
  const candidates = [`${id}.tsx`, `${id}.ts`].map((f) =>
    path.join(dir, "src", f)
  );
  const entry = candidates.find((f) => fs.existsSync(f));
  if (!entry) {
    throw new Error(
      `plugins/${path.basename(dir)}: no entry point — expected ` +
        candidates.map((c) => path.relative(ROOT, c)).join(" or ")
    );
  }
  return entry;
}

/**
 * Produces the directory that should be packaged for a plugin.
 *
 * A plugin with a tsconfig.json is bundled into its own build/ directory, and
 * the things Stash needs at runtime that the source tree keeps out of src (the
 * yml, any css, the README) are copied in alongside it.
 *
 * A plugin without a tsconfig.json is packaged as-is, so plain-JS plugins keep
 * working.
 */
function compilePlugin(dir, id, files, assets) {
  const tsconfig = tsconfigOf(dir);
  if (!fs.existsSync(tsconfig)) return dir;

  const outDir = path.join(dir, "build");
  // Rebuild from scratch: a file deleted from src/ would otherwise linger in
  // build/ and end up in the zip.
  fs.rmSync(outDir, { recursive: true, force: true });

  buildSync({
    ...ESBUILD_OPTIONS,
    entryPoints: [findEntry(dir, id)],
    outfile: path.join(outDir, `${id}.js`),
    // Point esbuild at the plugin's tsconfig instead of restating its settings
    // here. That is what keeps the bundler and the type-checker on the same
    // JSX transform and target: they read the same file.
    tsconfig,
  });

  for (const f of files) {
    if (f === "tsconfig.json") continue;
    if (f.endsWith(".yml") || f.endsWith(".css") || f.endsWith(".md")) {
      fs.copyFileSync(path.join(dir, f), path.join(outDir, f));
    }
  }

  // The directories the yml's `ui.assets` maps. Copied because the yml is the
  // statement of what this plugin serves at runtime: a directory named there is
  // a directory that has to be in the package. Naming one that is not there is a
  // build failure here, where it is legible, rather than a 404 in a browser that
  // draws an empty box.
  for (const rel of Object.values(assets)) {
    const from = path.join(dir, rel);
    if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) {
      throw new Error(
        `plugins/${path.basename(dir)}: ui.assets maps to "${rel}", which is not ` +
          `a directory`
      );
    }
    copyDir(from, path.join(outDir, rel));
  }

  return outDir;
}

/**
 * Builds one plugin.
 *
 * The plugin ID comes from the yml file name (that's how Stash defines it), not
 * from the directory name. If the two disagree, the yml wins.
 *
 * `suffix` is what turns the result into a second, separately installable copy
 * — see the note on `--id-suffix` at the top of this file. It changes the ID, the
 * name the yml is written under inside the zip, and the display name, and nothing
 * else: the bundle keeps its file name, because the yml's `ui.javascript` names
 * it and the yml is not rewritten there.
 */
function buildPlugin(dirName, sha, suffix, outDir) {
  const dir = path.join(PLUGINS_DIR, dirName);
  const files = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .sort();

  const ymlName = files.find((f) => f.endsWith(".yml"));
  if (!ymlName) {
    throw new Error(
      `plugins/${dirName}: no .yml file, so the plugin ID cannot be determined`
    );
  }

  // Two IDs, and they are not interchangeable. `baseId` is what the *source*
  // calls things — the entry point is `src/<baseId>.tsx`, and the bundle is
  // `<baseId>.js`. `id` is what the *package* is called, which is what Stash
  // installs under. Only the second carries the suffix.
  const baseId = ymlName.replace(/\.yml$/, "");
  const id = baseId + suffix;
  const ymlOutName = `${id}.yml`;

  // Line endings are normalised on the way in. The readers below are line-based,
  // and on a Windows checkout with `core.autocrlf=true` every line ends with a
  // `\r` that their patterns do not allow for — which comes out as a `ui.assets`
  // map that silently parses to nothing, and a package that fails to carry the
  // directory it names. tools/check-package-variant.mjs is what catches that, and
  // it is how this was found. The manifest that gets packaged is written from
  // this text, so it comes out with LF as well; nothing reads a manifest for its
  // line endings.
  const ymlText = fs
    .readFileSync(path.join(dir, ymlName), "utf8")
    .replace(/\r\n/g, "\n");

  // The manifest has to be valid YAML, checked with a real parser, before any of
  // the readers below look at it.
  //
  // They are tolerant by design — each picks the one key it wants out of the text
  // and ignores the rest — so none of them can tell a manifest that is subtly
  // wrong from one that is right, and neither can anything else in this pipeline:
  // Stash reads this file with a real parser, and a manifest it cannot parse costs
  // the plugin its scripts, its styles and its settings at once. It appears in the
  // plugin list, and does nothing. That is not hypothetical: the 0.5.3 release
  // shipped a description containing a colon, which is a mapping indicator inside
  // a plain scalar, and the plugin was dead until 0.5.4.
  try {
    parseYaml(ymlText);
  } catch (e) {
    throw new Error(
      `plugins/${dirName}/${ymlName}: not valid YAML — ${e.message}`
    );
  }

  // What the yml exposes to the browser beyond its own script and stylesheet.
  const assets = mapUnderKey(ymlText, "assets");

  const baseVersion = topLevel(ymlText, "version");
  if (!baseVersion) {
    throw new Error(`plugins/${dirName}/${ymlName}: missing top-level version`);
  }
  const version = `${baseVersion}-${sha}`;

  // Write the computed full version into the yml inside the zip.
  //
  // Stash decides whether an update is available by comparing the installed
  // plugin's version against the version in the source manifest. The two have to
  // match, otherwise it reports an update forever. The repo keeps the
  // hand-written base version; the full version only exists in the build output.
  //
  // The display name follows the same reasoning: two entries in Stash's plugin
  // list both reading "Manga Tools" is exactly the confusion a suffixed build
  // exists to avoid.
  const patchedYml = ymlText
    .replace(/^version:.*$/m, `version: ${version}`)
    .replace(
      /^name:(.*)$/m,
      suffix ? `name:$1 (${suffix.toLowerCase()})` : "name:$1"
    );

  // What actually gets packaged: the bundled output for a TypeScript plugin,
  // or the plugin directory itself for a plain-JS one.
  const packageDir = compilePlugin(dir, baseId, files, assets);
  const packagedFiles = fs
    .readdirSync(packageDir)
    // A plugin written in something other than TypeScript is packaged as the
    // directory it sits in, and that directory also holds the plugin's own tests
    // (see DEVELOPING.md). A TypeScript plugin's package is its build output,
    // which never has them.
    .filter((f) => !f.startsWith(".") && f !== "tests")
    .sort();

  assertReferencedFilesExist(id, ymlText, packageDir);

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `stash-plugins-${id}-`));
  const zipPath = path.join(outDir, `${id}.zip`);
  const stagedNames = packagedFiles.map((f) =>
    f === ymlName ? ymlOutName : f
  );
  try {
    for (const f of packagedFiles) {
      if (f === ymlName) {
        fs.writeFileSync(path.join(stage, ymlOutName), patchedYml);
      } else if (fs.statSync(path.join(packageDir, f)).isDirectory()) {
        // An asset directory. The zip is built with -r, so the tree comes along.
        copyDir(path.join(packageDir, f), path.join(stage, f));
      } else {
        fs.copyFileSync(path.join(packageDir, f), path.join(stage, f));
      }
    }

    // zip *updates* an existing archive rather than rebuilding it, so files
    // from a previous build would linger. Remove it first.
    fs.rmSync(zipPath, { force: true });

    // Name the files explicitly instead of using ".": that keeps the archive
    // entries flat, with no prefix. -X drops extended attributes and uid/gid.
    //
    // The names to ask for are the *staged* ones, which differ from the source
    // names for exactly one file: a suffixed build writes the yml under its
    // suffixed name, and the original is no longer in the stage.
    execFileSync("zip", ["-r", "-X", "-q", zipPath, ...stagedNames], {
      cwd: stage,
    });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  const sha256 = createHash("sha256")
    .update(fs.readFileSync(zipPath))
    .digest("hex");

  return {
    id,
    // Read off the patched yml, not the source: that is where the display name
    // for a suffixed build is written.
    name: topLevel(patchedYml, "name") || id,
    description: topLevel(ymlText, "description") || "",
    version,
    // Stash expects date as "YYYY-MM-DD HH:MM:SS"
    date: new Date().toISOString().replace("T", " ").slice(0, 19),
    requires: topLevelList(ymlText, "requires"),
    path: `${id}.zip`,
    sha256,
  };
}

/**
 * Renders index.yml.
 *
 * Every string value is quoted. Unquoted, `version: 1.0` would parse as a float
 * and `date: 2026-09-14 12:00:00` as a timestamp — either one makes Stash fail
 * to deserialize the field into its string type.
 */
function renderIndex(entries) {
  const q = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  return (
    entries
      .map((e) => {
        const lines = [
          `- id: ${q(e.id)}`,
          `  name: ${q(e.name)}`,
          `  metadata:`,
          `    description: ${q(e.description)}`,
          `  version: ${q(e.version)}`,
          `  date: ${q(e.date)}`,
          `  path: ${q(e.path)}`,
          `  sha256: ${q(e.sha256)}`,
        ];
        if (e.requires.length) {
          lines.push("  requires:");
          for (const r of e.requires) lines.push(`    - ${q(r)}`);
        }
        return lines.join("\n");
      })
      .join("\n\n") + "\n"
  );
}

function main() {
  if (process.argv.includes("--typecheck")) {
    typecheck();
    return;
  }

  const sha = shortSha();
  const suffix = idSuffix();
  const dirs = listPluginDirs();
  const outDir = argValue("--out")
    ? path.resolve(ROOT, argValue("--out"))
    : DIST_DIR;

  if (dirs.length === 0) {
    console.error("No plugin directories found under plugins/");
    process.exit(1);
  }

  // Rebuilt from scratch: a package for a plugin that has since been renamed or
  // removed would otherwise linger and stay installable from the index.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const entries = dirs.map((d) => buildPlugin(d, sha, suffix, outDir));
  fs.writeFileSync(
    path.join(outDir, "index.yml"),
    renderIndex(entries),
    "utf8"
  );

  for (const e of entries) {
    console.log(`  ${e.id}  ${e.version}  ${e.sha256.slice(0, 12)}…`);
  }
  console.log(
    `\nWrote ${entries.length} package(s) to ${path.relative(ROOT, outDir)}/`
  );
}

main();
