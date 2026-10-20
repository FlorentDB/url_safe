/**
 * The popup of the extension.
 *
 * The check runs here, in the page, with the datasets read from the local
 * package. Nothing is sent anywhere: there is no request to make, and no
 * server that could receive the address.
 */

import { buildChecker, loadDatasets } from "../shared/datasets.js";
import { renderError, renderVerdict } from "../shared/render.js";

const form = document.querySelector("#check-form");
const input = document.querySelector("#url-input");
const button = document.querySelector("#check-button");
const buttonLabel = button.querySelector("span");
const result = document.querySelector("#result");
const optionsButton = document.querySelector("#options-button");

let checkerPromise = null;

/**
 * The checker, built once per popup opening.
 *
 * The datasets are read from the package, or from the cache when the user
 * refreshed them. Reading them once keeps the second check in the same popup
 * instant.
 *
 * @returns {Promise<object>} the checker
 */
function getChecker() {
  checkerPromise ??= loadDatasets().then((entry) => buildChecker(entry.datasets));
  return checkerPromise;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.hidden = true;
  button.disabled = true;
  buttonLabel.textContent = "Analyse…";

  try {
    const checker = await getChecker();
    renderVerdict(result, checker.check(input.value));
  } catch (error) {
    renderError(result, error.message ?? "Cette adresse n’a pas pu être analysée.");
  } finally {
    button.disabled = false;
    buttonLabel.textContent = "Vérifier";
  }
});

optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

input.focus();
