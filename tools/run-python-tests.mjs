#!/usr/bin/env node
/**
 * Runs the tests of every plugin that ships a Python script.
 *
 * Python is not a dependency of this repository — it is a dependency of the
 * plugins that are written in it, and of Stash, which runs those plugins. CI's
 * runner has it; so does the machine this is developed on. A machine without it
 * gets a note rather than a failed suite, because nothing else here needs Python
 * and a plugin's own tests should not decide whether the repository can be built.
 *
 * A plugin keeps its tests in `tests/`, the same place a TypeScript plugin does
 * (see DEVELOPING.md) — the difference is only how they are run.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The interpreter to use, or null when there is none to be found. */
function interpreter() {
  for (const candidate of ["python3", "python"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Not this one. Windows has `python` where Linux has `python3`, and a
      // machine can have neither.
    }
  }
  return null;
}

/** Plugins with a `tests/test_*.py`, as [name, directory] */
function suites() {
  const plugins = path.join(ROOT, "plugins");
  const found = [];
  for (const name of fs.readdirSync(plugins).sort()) {
    const tests = path.join(plugins, name, "tests");
    if (!fs.existsSync(tests)) continue;
    const hasTests = fs
      .readdirSync(tests)
      .some((f) => f.startsWith("test_") && f.endsWith(".py"));
    if (hasTests) found.push([name, tests]);
  }
  return found;
}

const found = suites();
if (found.length === 0) {
  process.exit(0);
}

const python = interpreter();
if (!python) {
  console.log(
    `! python is not installed, so ${found.length} plugin test suite(s) did not ` +
      `run: ${found.map(([name]) => name).join(", ")}. Nothing else in this ` +
      `repository needs it.`
  );
  process.exit(0);
}

for (const [name, dir] of found) {
  console.log(`python tests: ${name}`);
  execFileSync(python, ["-m", "unittest", "discover", "-s", dir, "-t", dir], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

console.log(`✓ python tests (${found.length} suite(s))`);
