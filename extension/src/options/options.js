/**
 * The options page.
 *
 * The extension works entirely with the data it was installed with, so this
 * page has nothing to configure by default. The only option is the host the
 * datasets can be refreshed from, and the permission for that host is only
 * requested when the user asks for a refresh.
 */

import {
  discardCachedDatasets,
  readCachedDatasets,
  refreshDatasets,
} from "../shared/datasets.js";
import { datasetOrigin, readSettings, writeSettings } from "../shared/settings.js";

const datasetUrl = document.querySelector("#dataset-url");
const refreshButton = document.querySelector("#refresh-button");
const dataPermissionButton = document.querySelector("#grant-data-permission");
const discardButton = document.querySelector("#discard-button");
const autoRefresh = document.querySelector("#auto-refresh");
const refreshError = document.querySelector("#refresh-error");
const refreshStatus = document.querySelector("#refresh-status");
const originCell = document.querySelector("#dataset-origin");
const updatedCell = document.querySelector("#dataset-updated");
const isFirefox = Boolean(
  chrome.runtime.getManifest().browser_specific_settings?.gecko,
);
const DATA_COLLECTION_PERMISSION = "technicalAndInteraction";
let hasDataCollectionPermission = false;

/**
 * Show an error under the refresh field.
 *
 * @param {string} message the message to show
 * @returns {void}
 */
function showError(message) {
  refreshError.textContent = message;
  refreshError.hidden = false;
  refreshStatus.hidden = true;
}

/**
 * Show a confirmation under the refresh field.
 *
 * @param {string} message the message to show
 * @returns {void}
 */
function showStatus(message) {
  refreshStatus.textContent = message;
  refreshStatus.hidden = false;
  refreshError.hidden = true;
}

/**
 * Format a date for display.
 *
 * @param {string | null} value an ISO date
 * @returns {string} the formatted date
 */
function formatDate(value) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Fill the page with the current state.
 *
 * @returns {Promise<void>} resolves once the page is filled
 */
async function showCurrentState() {
  const settings = await readSettings();
  const cached = await readCachedDatasets();
  const permissions = isFirefox ? await chrome.permissions.getAll() : null;
  hasDataCollectionPermission = permissions?.data_collection?.includes(
    DATA_COLLECTION_PERMISSION,
  ) ?? false;

  datasetUrl.value = settings.datasetBaseUrl ?? "";
  autoRefresh.checked = settings.autoRefresh;
  dataPermissionButton.hidden = !isFirefox;
  dataPermissionButton.textContent = hasDataCollectionPermission
    ? "Retirer l’autorisation de mise à jour"
    : "Autoriser les requêtes de mise à jour";

  if (cached) {
    originCell.textContent = cached.baseUrl ?? "Hôte distant";
    updatedCell.textContent = formatDate(cached.updatedAt);
    discardButton.hidden = false;
  } else {
    originCell.textContent = "Données installées avec l’extension";
    updatedCell.textContent = "—";
    discardButton.hidden = true;
  }
}

dataPermissionButton.addEventListener("click", async () => {
  refreshError.hidden = true;
  refreshStatus.hidden = true;

  if (hasDataCollectionPermission) {
    await chrome.permissions.remove({
      data_collection: [DATA_COLLECTION_PERMISSION],
    });
    await showCurrentState();
    showStatus("Autorisation retirée. Les mises à jour automatiques sont désactivées.");
    return;
  }

  try {
    const granted = await chrome.permissions.request({
      data_collection: [DATA_COLLECTION_PERMISSION],
    });
    if (!granted) {
      showError("Autorisation refusée. Les listes intégrées continueront de fonctionner hors ligne.");
      return;
    }
    await showCurrentState();
    showStatus("Autorisation accordée. Vous pouvez maintenant configurer un hôte de données.");
  } catch (error) {
    showError(error.message ?? "L’autorisation des requêtes de mise à jour a échoué.");
  }
});

refreshButton.addEventListener("click", async () => {
  refreshError.hidden = true;
  refreshStatus.hidden = true;

  const baseUrl = datasetUrl.value.trim();
  const origin = datasetOrigin(baseUrl);
  if (!origin) {
    showError("Indiquez une adresse en https:// pointant vers le dossier des données.");
    return;
  }

  // The permission request has to be the first thing this handler does.
  // Anything awaited before it would consume the user gesture and the
  // request would be refused.
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    showError("Accès refusé. Les données installées avec l’extension restent utilisées.");
    return;
  }

  if (isFirefox) {
    const permissions = await chrome.permissions.getAll();
    if (!permissions.data_collection?.includes(DATA_COLLECTION_PERMISSION)) {
      showError("Autorisez d’abord les requêtes de mise à jour. Le serveur pourra voir votre adresse IP.");
      return;
    }
  }

  refreshButton.disabled = true;
  try {
    const entry = await refreshDatasets(baseUrl);
    await writeSettings({ datasetBaseUrl: baseUrl });
    await showCurrentState();
    showStatus(`Listes actualisées le ${formatDate(entry.updatedAt)}.`);
  } catch (error) {
    showError(error.message ?? "L’actualisation a échoué.");
  } finally {
    refreshButton.disabled = false;
  }
});

discardButton.addEventListener("click", async () => {
  const settings = await readSettings();
  await discardCachedDatasets();
  await writeSettings({ datasetBaseUrl: null });

  const origin = datasetOrigin(settings.datasetBaseUrl);
  if (origin) {
    await chrome.permissions.remove({ origins: [origin] });
  }
  if (isFirefox) {
    await chrome.permissions.remove({
      data_collection: [DATA_COLLECTION_PERMISSION],
    });
  }

  await showCurrentState();
  showStatus("Les données installées avec l’extension sont de nouveau utilisées.");
});

autoRefresh.addEventListener("change", async () => {
  await writeSettings({ autoRefresh: autoRefresh.checked });
});

showCurrentState();
