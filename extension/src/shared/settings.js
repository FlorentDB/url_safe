/**
 * The extension settings, kept in local storage.
 *
 * There is exactly one setting today: the address of the host the datasets
 * can be refreshed from. It is empty by default, which means the extension
 * never asks for a host permission and never touches the network.
 */

export const SETTINGS_KEY = "lienClairSettings";

/** The settings a fresh installation starts with. */
export const DEFAULT_SETTINGS = {
  datasetBaseUrl: null,
  autoRefresh: true,
};

/**
 * Read the current settings.
 *
 * @returns {Promise<object>} the settings, with the defaults filled in
 */
export async function readSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] ?? {}) };
}

/**
 * Merge changes into the settings.
 *
 * @param {object} patch the settings to change
 * @returns {Promise<object>} the new settings
 */
export async function writeSettings(patch) {
  const current = await readSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

/**
 * The origin of the dataset host, as a match pattern.
 *
 * Only HTTPS is accepted. The datasets are downloaded over the network, and
 * an encrypted channel is the only acceptable one for a file that will be
 * trusted as the source of a verdict.
 *
 * @param {string | null} baseUrl the dataset base URL
 * @returns {string | null} the origin, or null when there is no usable base URL
 */
export function datasetOrigin(baseUrl) {
  if (!baseUrl) {
    return null;
  }
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") {
      return null;
    }
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}
