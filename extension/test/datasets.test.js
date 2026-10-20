import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { DATASET_FILES, SCHEMA_VERSION } from "../src/shared/datasets.js";
import { datasetOrigin } from "../src/shared/settings.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/**
 * Read one of the packaged dataset files.
 *
 * @param {string} key the dataset key
 * @returns {object} the parsed document
 */
function readDataset(key) {
  const path = join(ROOT, DATASET_FILES[key]);
  return JSON.parse(readFileSync(path, "utf8"));
}

test("the packaged datasets are all present and at the expected version", () => {
  for (const key of Object.keys(DATASET_FILES)) {
    const document = readDataset(key);
    assert.equal(document.schema_version, SCHEMA_VERSION, key);
  }
});

test("the packaged domains file holds the two registries", () => {
  const document = readDataset("domains");

  assert.ok(Array.isArray(document.domains));
  assert.ok(Array.isArray(document.brands));
  for (const entry of document.domains) {
    assert.deepEqual(Object.keys(entry).sort(), ["hostname", "source", "status"]);
  }
  for (const entry of document.brands) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "brand_name",
      "hostname",
      "source",
    ]);
  }
});

test("the packaged public suffix list holds the rules the server uses", () => {
  const document = readDataset("publicSuffixes");

  assert.ok(document.rules.includes("com"));
  assert.ok(document.rules.includes("co.uk"));
  // A wildcard rule and an exception rule are the two cases a naive
  // implementation gets wrong.
  assert.ok(document.rules.some((rule) => rule.startsWith("*.")));
  assert.ok(document.rules.some((rule) => rule.startsWith("!")));
});

test("the packaged Unicode tables keep the Latin confusables", () => {
  const document = readDataset("unicode");

  // A Cyrillic letter that looks like "i" is the classic case, and the
  // extension has to be able to find it.
  assert.ok(document.confusables["і"].includes("i"));
  // A Latin source character is never confusable with Latin under the
  // rules the extension applies, so it must have been trimmed away.
  assert.equal(document.confusables["a"], undefined);
  assert.ok(document.script_ranges.length > 0);
  assert.ok(document.script_aliases.length > 0);
});

test("the dataset host is only accepted over HTTPS", () => {
  assert.equal(
    datasetOrigin("https://exemple.org/url_safe/v1"),
    "https://exemple.org/*",
  );
  assert.equal(datasetOrigin("http://exemple.org/"), null);
  assert.equal(datasetOrigin("ftp://exemple.org/"), null);
  assert.equal(datasetOrigin("pas une adresse"), null);
  assert.equal(datasetOrigin(""), null);
  assert.equal(datasetOrigin(null), null);
});

test("the dataset host keeps its port", () => {
  assert.equal(
    datasetOrigin("https://exemple.org:8443/datasets"),
    "https://exemple.org:8443/*",
  );
});
