#!/usr/bin/env node
/**
 * Checks that `--id-suffix` really produces a second, separately installable
 * package — and that an ordinary build is left alone.
 *
 * Why this is a script rather than a look at the output: the failure it guards
 * against is silent and damaging. A suffixed build whose *yml inside the zip*
 * still carries the original file name would install as the real plugin and
 * overwrite it, which is the exact thing the flag exists to prevent. The manifest
 * cannot show that, because the manifest is built from the ID while the yml's
 * file name is decided somewhere else — so this reads the zip's own entry names.
 *
 * Both halves matter, and only one of them needs a build:
 *
 *   - with no suffix, the package in dist/ (which `npm test` has already built)
 *     must still be the plugin under its own id and name
 *   - with a suffix, the package must become a different plugin in every way
 *     Stash looks at it: the entry's id, the zipped yml's file name, and the
 *     display name someone reads in Settings → Plugins
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUFFIX = "Test";

/** A file the plugin serves rather than bundles — see mangaTools.yml's ui.assets */
const ASSET = "assets/icons/manga.svg";

/**
 * The entries of an index.yml, as far as this script looks at them.
 *
 * Regexes rather than a YAML parser, as in tools/build.mjs: the file is generated
 * by that script, one `- id:` begins each entry, and every value is quoted.
 */
function indexEntries(text) {
  return text
    .split(/^- id: /m)
    .slice(1)
    .map((chunk) => ({
      id: /^"([^"]+)"/.exec(chunk)[1],
      name: /^ {2}name: "([^"]*)"/m.exec(chunk)?.[1] ?? "",
      path: /^ {2}path: "([^"]*)"/m.exec(chunk)?.[1] ?? "",
    }));
}

/**
 * The entry names inside a zip, read out of its central directory.
 *
 * Nothing is extracted and no external tool is called: `unzip` is a separate
 * package from the `zip` this project already shells out to, and all that is
 * needed here is the list of names. The offsets are the fixed layout of a central
 * directory header — signature, four more fields, then the name, the extra field
 * and the comment, whose lengths are the three 16-bit fields at 28, 30 and 32.
 */
function zipEntryNames(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const eocd = buf.lastIndexOf(Buffer.from("PK\x05\x06"));
  if (eocd < 0) {
    throw new Error(
      `${path.basename(zipPath)}: no end-of-central-directory record`
    );
  }

  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    names.push(buf.toString("utf8", at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

const listed = (entries) => entries.map((e) => e.id).join(", ");

// ── The ordinary build, already in dist/ ────────────────────────────
const plain = indexEntries(
  fs.readFileSync(path.join(ROOT, "dist", "index.yml"), "utf8")
);
const real = plain.find((e) => e.id === "mangaTools");
assert.ok(
  real,
  `dist/index.yml should list the plugin under its own id — got ${listed(plain)}`
);
assert.strictEqual(
  real.name,
  "Manga Tools",
  "an ordinary build must not carry the variant's display name"
);
assert.strictEqual(real.path, "mangaTools.zip");

// ── A suffixed build, into a directory of its own ───────────────────
// Not dist/: that holds the ordinary build the assertions above just read, and a
// second build over it would make this script check its own leftovers.
const out = fs.mkdtempSync(path.join(os.tmpdir(), "stash-plugins-variant-"));
try {
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, "tools", "build.mjs"),
      `--id-suffix=${SUFFIX}`,
      `--out=${out}`,
    ],
    { cwd: ROOT }
  );

  const variants = indexEntries(
    fs.readFileSync(path.join(out, "index.yml"), "utf8")
  );
  const variant = variants.find((e) => e.id === `mangaTools${SUFFIX}`);
  assert.ok(
    variant,
    `expected an entry for mangaTools${SUFFIX} — got ${listed(variants)}`
  );
  assert.strictEqual(
    variants.length,
    1,
    "a suffixed build must publish only the suffixed plugin, so nothing it " +
      "offers can update the real one"
  );
  assert.strictEqual(
    variant.name,
    "Manga Tools (test)",
    "the display name has to say which copy this is — two entries both reading " +
      '"Manga Tools" is the confusion the suffix exists to avoid'
  );
  assert.strictEqual(variant.path, `mangaTools${SUFFIX}.zip`);

  // The half the manifest cannot show, and the one that would do damage: Stash
  // takes the plugin ID from the yml file name, so it has to be renamed too.
  const names = zipEntryNames(path.join(out, variant.path));
  assert.ok(
    names.includes(`mangaTools${SUFFIX}.yml`),
    `the zip must carry the yml under its suffixed name, or Stash installs it ` +
      `as the real plugin and overwrites it. Entries: ${names.join(", ")}`
  );
  assert.ok(
    !names.includes("mangaTools.yml"),
    "and must not carry the original name as well"
  );
  // The plugin's one non-code file. Stash serves what `ui.assets` maps rather
  // than bundling it, so a build that stopped copying the directory would leave
  // the toolbar switch with no icon and nothing on screen to say why.
  assert.ok(
    names.includes(ASSET),
    `the plugin's asset must be in the package. Entries: ${names.join(", ")}`
  );
  assert.ok(
    names.includes("mangaTools.js"),
    "the bundle keeps its name — ui.javascript names it, and that part of the " +
      `yml is not rewritten. Entries: ${names.join(", ")}`
  );
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

console.log(
  "✓ package variant (a suffixed build is a separate plugin; an ordinary build is untouched)"
);
