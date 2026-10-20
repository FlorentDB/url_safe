/**
 * Dataset loading for the extension.
 *
 * The extension ships the domain registry, the brand registry, the Unicode
 * confusable tables and the public suffix list inside the package. A user who
 * installs the extension therefore gets a working checker with no network
 * access at all, and the extension never asks for a host permission to do so.
 *
 * A refresh from a remote host is possible but strictly optional. The user
 * points the extension at a dataset URL in the options page, which grants the
 * host permission for that origin only. Refreshing downloads the same files
 * for every user, so the download reveals nothing about the links that were
 * checked.
 *
 * The bundled files are read straight from the package on every use. Only
 * refreshed datasets are cached in storage, because caching the bundled ones
 * would only trade a package read for a storage read.
 */

import { Checker } from "../core/index.js";

/** The dataset files, and the key each one is loaded under. */
export const DATASET_FILES = {
  domains: "src/data/domains.json",
  unicode: "src/data/unicode.json",
  publicSuffixes: "src/data/public_suffixes.json",
};

/** The storage key holding the refreshed datasets and their metadata. */
export const STORAGE_KEY = "url_safeDatasets";
const LEGACY_STORAGE_KEY = "lienClairDatasets";

/** The schema version this build of the extension understands. */
export const SCHEMA_VERSION = 1;

/**
 * Read the datasets shipped inside the package.
 *
 * @returns {Promise<object>} the datasets
 * @throws {Error} when a file is missing or has an unexpected schema
 */
export async function loadBundledDatasets() {
  const entries = await Promise.all(
    Object.entries(DATASET_FILES).map(async ([key, path]) => {
      const response = await fetch(chrome.runtime.getURL(path));
      if (!response.ok) {
        throw new Error(`Le fichier de données ${path} est introuvable.`);
      }
      const document = await response.json();
      assertSchemaVersion(document, path);
      return [key, document];
    }),
  );

  return Object.fromEntries(entries);
}

/**
 * Read the refreshed datasets from storage, if there are any.
 *
 * @returns {Promise<object | null>} the datasets, or null when there are none
 */
export async function readCachedDatasets() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEY,
    LEGACY_STORAGE_KEY,
  ]);
  let entry = stored[STORAGE_KEY];
  if (!entry && stored[LEGACY_STORAGE_KEY]?.datasets) {
    entry = stored[LEGACY_STORAGE_KEY];
    await chrome.storage.local.set({ [STORAGE_KEY]: entry });
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
  }
  if (!entry || !entry.datasets) {
    return null;
  }
  if (entry.datasets.schema_version !== SCHEMA_VERSION) {
    return null;
  }
  return entry;
}

/**
 * The datasets to work with: the refreshed ones when there are any, the
 * bundled ones otherwise.
 *
 * @returns {Promise<object>} the datasets and their metadata
 */
export async function loadDatasets() {
  const cached = await readCachedDatasets();
  if (cached) {
    return cached;
  }

  const bundled = await loadBundledDatasets();
  return {
    datasets: { schema_version: SCHEMA_VERSION, ...bundled },
    source: "bundled",
    updatedAt: null,
    baseUrl: null,
  };
}

/**
 * Download the datasets from a remote host and cache them.
 *
 * @param {string} baseUrl the directory holding the dataset files
 * @returns {Promise<object>} the stored entry
 * @throws {Error} when a file cannot be fetched or is malformed
 */
export async function refreshDatasets(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  const entries = await Promise.all(
    Object.entries(DATASET_FILES).map(async ([key, path]) => {
      const name = path.slice(path.lastIndexOf("/") + 1);
      const response = await fetch(`${base}/${name}`, {
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`${name} : le serveur a répondu ${response.status}.`);
      }
      const document = await response.json();
      assertSchemaVersion(document, name);
      return [key, document];
    }),
  );

  const entry = {
    datasets: { schema_version: SCHEMA_VERSION, ...Object.fromEntries(entries) },
    source: "remote",
    updatedAt: new Date().toISOString(),
    baseUrl: base,
  };

  await chrome.storage.local.set({ [STORAGE_KEY]: entry });
  return entry;
}

/**
 * Drop the refreshed datasets and fall back to the bundled ones.
 *
 * @returns {Promise<void>} resolves once the cache is empty
 */
export async function discardCachedDatasets() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/**
 * Build a checker over a set of datasets.
 *
 * @param {object} datasets the datasets
 * @returns {Checker} the checker
 */
export function buildChecker(datasets) {
  return new Checker(datasets);
}

/**
 * Refuse a dataset file whose schema this build does not understand.
 *
 * @param {object} document the parsed file
 * @param {string} name the file name, for the error message
 * @throws {Error} when the schema version differs
 */
function assertSchemaVersion(document, name) {
  if (document.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `${name} : version de schéma ${document.schema_version}, ` +
        `version attendue ${SCHEMA_VERSION}.`,
    );
  }
}
