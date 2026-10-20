import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SOURCE_DIR = join(ROOT, "src");

/**
 * Every JavaScript file of the source tree.
 *
 * @param {string} directory the directory to walk
 * @returns {string[]} the absolute paths
 */
function listScripts(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listScripts(path));
    } else if (entry.name.endsWith(".js")) {
      files.push(path);
    }
  }
  return files.sort();
}

const SCRIPTS = listScripts(SOURCE_DIR);

test("the source tree holds the modules the manifest points at", () => {
  assert.ok(SCRIPTS.length >= 10, `${SCRIPTS.length} fichiers`);
  for (const name of [
    "background/service-worker.js",
    "core/index.js",
    "popup/popup.js",
    "result/result.js",
    "options/options.js",
    "shared/datasets.js",
  ]) {
    assert.ok(
      SCRIPTS.some((path) => path.endsWith(join("src", name))),
      name,
    );
  }
});

test("every source file parses as a module", () => {
  // The pages and the background context touch the browser APIs at load
  // time, so they cannot be imported in Node. Parsing them is still worth
  // doing: a syntax error in one of them would only show up in a browser.
  for (const path of SCRIPTS) {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ["--check", path], { stdio: "pipe" }),
      path,
    );
  }
});

test("no source file uses eval or the Function constructor", () => {
  for (const path of SCRIPTS) {
    const source = readFileSync(path, "utf8");
    assert.ok(!/\beval\s*\(/.test(source), path);
    assert.ok(!/new\s+Function\s*\(/.test(source), path);
  }
});

test("no page carries an inline script or an inline event handler", () => {
  const pages = readdirSync(SOURCE_DIR, { recursive: true }).filter((name) =>
    name.endsWith(".html"),
  );

  assert.ok(pages.length >= 3);
  for (const page of pages) {
    const path = join(SOURCE_DIR, page);
    assert.ok(statSync(path).isFile(), page);
    const source = readFileSync(path, "utf8");
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(source), page);
    assert.ok(!/\son[a-z]+\s*=/i.test(source), page);
  }
});
