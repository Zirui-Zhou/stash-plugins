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
 *   node tools/build.mjs              package into dist/
 *   node tools/build.mjs --typecheck  type-check only, no output
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
function compilePlugin(dir, id, files) {
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

  return outDir;
}

/**
 * Builds one plugin.
 *
 * The plugin ID comes from the yml file name (that's how Stash defines it), not
 * from the directory name. If the two disagree, the yml wins.
 */
function buildPlugin(dirName, sha) {
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

  const id = ymlName.replace(/\.yml$/, "");
  const ymlText = fs.readFileSync(path.join(dir, ymlName), "utf8");

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
  const patchedYml = ymlText.replace(/^version:.*$/m, `version: ${version}`);

  // What actually gets packaged: the bundled output for a TypeScript plugin,
  // or the plugin directory itself for a plain-JS one.
  const packageDir = compilePlugin(dir, id, files);
  const packagedFiles = fs
    .readdirSync(packageDir)
    .filter((f) => !f.startsWith("."))
    .sort();

  assertReferencedFilesExist(id, ymlText, packageDir);

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `stash-plugins-${id}-`));
  const zipPath = path.join(DIST_DIR, `${id}.zip`);
  try {
    for (const f of packagedFiles) {
      if (f === ymlName) {
        fs.writeFileSync(path.join(stage, f), patchedYml);
      } else {
        fs.copyFileSync(path.join(packageDir, f), path.join(stage, f));
      }
    }

    // zip *updates* an existing archive rather than rebuilding it, so files
    // from a previous build would linger. Remove it first.
    fs.rmSync(zipPath, { force: true });

    // Name the files explicitly instead of using ".": that keeps the archive
    // entries flat, with no prefix. -X drops extended attributes and uid/gid.
    execFileSync("zip", ["-r", "-X", "-q", zipPath, ...packagedFiles], {
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
    name: topLevel(ymlText, "name") || id,
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
  const dirs = listPluginDirs();

  if (dirs.length === 0) {
    console.error("No plugin directories found under plugins/");
    process.exit(1);
  }

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  const entries = dirs.map((d) => buildPlugin(d, sha));
  fs.writeFileSync(
    path.join(DIST_DIR, "index.yml"),
    renderIndex(entries),
    "utf8"
  );

  for (const e of entries) {
    console.log(`  ${e.id}  ${e.version}  ${e.sha256.slice(0, 12)}…`);
  }
  console.log(`\nWrote ${entries.length} package(s) to dist/`);
}

main();
