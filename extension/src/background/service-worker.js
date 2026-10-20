/**
 * The background context of the extension.
 *
 * It does three things and nothing else:
 *
 * 1. It offers a "Vérifier avec url_safe" entry in the context menu of a
 *    link. The entry only appears when the user right-clicks a link, so the
 *    extension never inspects a page on its own.
 * 2. It opens the result page when that entry is used. The checked address is
 *    handed over through session storage rather than a query string, so it
 *    never reaches the browser history.
 * 3. It refreshes the datasets once a day, but only if the user configured a
 *    dataset host and allowed the host permission.
 *
 * The same file is used as a Chrome service worker and as a Firefox event
 * page. The only difference is the manifest key that points at it.
 *
 * The modules are loaded with a dynamic import rather than a static one. A
 * static import would make this file a module, and Firefox runs background
 * scripts as classic scripts. The dynamic import works in both, and the
 * listeners below are still registered synchronously, which is what a
 * service worker that can be stopped at any time requires.
 */

const datasets = import("../shared/datasets.js");
const settings = import("../shared/settings.js");

/** The identifier of the context menu entry. */
const CONTEXT_MENU_ID = "url_safe-check-link";

/** The page opened to show a verdict. */
const RESULT_PAGE = "src/result/result.html";

/** The identifier of the daily refresh alarm. */
const REFRESH_ALARM = "url_safe-refresh";

/** How often the datasets are refreshed, in minutes. */
const REFRESH_PERIOD_MINUTES = 1440;

/** How long a verdict waits in session storage before it is discarded. */
const PENDING_LIFETIME_MS = 10 * 60 * 1000;

/**
 * Create the context menu entry.
 *
 * The entry is created for links only. A right-click anywhere else on a page
 * has nothing to check, and offering the entry there would invite the
 * extension to look at pages the user did not ask about.
 *
 * @returns {void}
 */
function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: chrome.i18n.getMessage("contextMenuTitle"),
      contexts: ["link"],
    });
  });
}

/**
 * Check a URL and return the outcome.
 *
 * @param {string} url the URL to check
 * @returns {Promise<object>} `{ok: true, verdict}` or `{ok: false, message}`
 */
async function runCheck(url) {
  try {
    const { buildChecker, loadDatasets } = await datasets;
    const entry = await loadDatasets();
    const checker = buildChecker(entry.datasets);
    return { ok: true, verdict: checker.check(url) };
  } catch (error) {
    return { ok: false, message: error.message ?? "Analyse impossible." };
  }
}

/**
 * Drop the verdicts nobody opened.
 *
 * @returns {Promise<void>} resolves once the stale entries are gone
 */
async function discardStaleResults() {
  const stored = await chrome.storage.session.get(null);
  const now = Date.now();
  const stale = Object.keys(stored).filter(
    (key) =>
      key.startsWith("pending:") &&
      now - Number(stored[key]?.at ?? 0) > PENDING_LIFETIME_MS,
  );
  if (stale.length > 0) {
    await chrome.storage.session.remove(stale);
  }
}

/**
 * Refresh the datasets from the configured host, if there is one.
 *
 * @returns {Promise<void>} resolves once the attempt is over
 */
async function refreshIfConfigured() {
  const { readSettings } = await settings;
  const { refreshDatasets } = await datasets;

  const current = await readSettings();
  if (!current.datasetBaseUrl || !current.autoRefresh) {
    return;
  }

  const granted = await chrome.permissions.contains({
    origins: [new URL(current.datasetBaseUrl).origin + "/*"],
  });
  if (!granted) {
    return;
  }

  try {
    await refreshDatasets(current.datasetBaseUrl);
  } catch (error) {
    // A failed refresh keeps the previous datasets. The extension stays
    // usable, so the failure is not worth interrupting the user for.
    console.warn("Actualisation des données impossible :", error.message);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
  chrome.alarms.create(REFRESH_ALARM, {
    periodInMinutes: REFRESH_PERIOD_MINUTES,
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshIfConfigured();
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return;
  }

  const url = info.linkUrl ?? info.pageUrl;
  if (!url) {
    return;
  }

  const outcome = await runCheck(url);
  const identifier = crypto.randomUUID();

  await discardStaleResults();
  await chrome.storage.session.set({
    [`pending:${identifier}`]: { url, outcome, at: Date.now() },
  });

  chrome.tabs.create({
    url: `${chrome.runtime.getURL(RESULT_PAGE)}?id=${identifier}`,
  });
});
