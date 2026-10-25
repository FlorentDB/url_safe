import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { Checker, UrlInputError } from "../src/core/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const VECTORS = JSON.parse(
  readFileSync(join(HERE, "vectors.json"), "utf8"),
);

const DATASETS = {
  domains: {
    domains: VECTORS.domains,
    brands: VECTORS.brands,
  },
  unicode: JSON.parse(
    readFileSync(join(HERE, "..", "src", "data", "unicode.json"), "utf8"),
  ),
  publicSuffixes: JSON.parse(
    readFileSync(
      join(HERE, "..", "src", "data", "public_suffixes.json"),
      "utf8",
    ),
  ),
};

const checker = new Checker(DATASETS);

test("the extension matches the server on every shared vector", () => {
  for (const vector of VECTORS.cases) {
    if (vector.error !== undefined) {
      assert.throws(
        () => checker.check(vector.url),
        UrlInputError,
        vector.url,
      );
      continue;
    }

    const result = checker.check(vector.url);

    assert.equal(result.hostname, vector.hostname, `hostname: ${vector.url}`);
    assert.equal(
      result.canonical_hostname,
      vector.canonical_hostname,
      `canonical_hostname: ${vector.url}`,
    );
    assert.deepEqual(result.reasons, vector.verdict.reasons, `reasons: ${vector.url}`);
    assert.equal(
      result.classification,
      vector.verdict.classification,
      `classification: ${vector.url}`,
    );
    assert.equal(result.title, vector.verdict.title, `title: ${vector.url}`);
    assert.equal(
      result.explanation,
      vector.verdict.explanation,
      `explanation: ${vector.url}`,
    );
    assert.equal(result.source, vector.verdict.source, `source: ${vector.url}`);
    assert.equal(
      result.matched_brand,
      vector.verdict.matched_brand,
      `matched_brand: ${vector.url}`,
    );
    assert.equal(
      result.official_domain,
      vector.verdict.official_domain,
      `official_domain: ${vector.url}`,
    );
  }
});
