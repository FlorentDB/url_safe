import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readCachedDatasets,
  SCHEMA_VERSION,
  STORAGE_KEY,
} from "../src/shared/datasets.js";
import {
  readSettings,
  SETTINGS_KEY,
} from "../src/shared/settings.js";

function mockStorage(initial) {
  const values = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries(
            keys.filter((key) => key in values).map((key) => [key, values[key]]),
          );
        },
        async set(entries) {
          Object.assign(values, entries);
        },
        async remove(key) {
          delete values[key];
        },
      },
    },
  };
  return values;
}

test("settings move to the url_safe storage key without losing values", async () => {
  const previous = {
    datasetBaseUrl: "https://datasets.example.org",
    autoRefresh: false,
  };
  const values = mockStorage({ lienClairSettings: previous });

  assert.deepEqual(await readSettings(), previous);
  assert.deepEqual(values[SETTINGS_KEY], previous);
  assert.equal("lienClairSettings" in values, false);
});

test("cached datasets move to the url_safe storage key", async () => {
  const previous = {
    datasets: { schema_version: SCHEMA_VERSION, domains: [] },
    source: "remote",
  };
  const values = mockStorage({ lienClairDatasets: previous });

  assert.deepEqual(await readCachedDatasets(), previous);
  assert.deepEqual(values[STORAGE_KEY], previous);
  assert.equal("lienClairDatasets" in values, false);
});
