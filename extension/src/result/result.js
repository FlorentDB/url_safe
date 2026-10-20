/**
 * The full-page result, opened from the context menu.
 *
 * The background context hands the verdict over through session storage and
 * passes only an identifier in the address of this page. The checked address
 * itself therefore stays out of the browser history and out of the address
 * bar, which is what lets the extension keep the promise it makes.
 */

import { renderError, renderVerdict } from "../shared/render.js";

const result = document.querySelector("#result");
const checkedUrl = document.querySelector("#checked-url");

/**
 * Show the verdict the background context left for this page.
 *
 * @returns {Promise<void>} resolves once the page is filled
 */
async function showPendingResult() {
  const identifier = new URLSearchParams(window.location.search).get("id");
  if (!identifier) {
    renderError(result, "Aucun lien à afficher.");
    return;
  }

  const key = `pending:${identifier}`;
  const stored = await chrome.storage.session.get(key);
  const pending = stored[key];

  if (!pending) {
    renderError(result, "Ce résultat n’est plus disponible.");
    return;
  }

  await chrome.storage.session.remove(key);

  checkedUrl.textContent = pending.url;

  if (pending.outcome.ok) {
    renderVerdict(result, pending.outcome.verdict);
  } else {
    renderError(result, pending.outcome.message);
  }
}

showPendingResult();
