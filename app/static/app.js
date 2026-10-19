const form = document.querySelector("#check-form");
const input = document.querySelector("#url-input");
const button = document.querySelector("#check-button");
const errorMessage = document.querySelector("#form-error");
const result = document.querySelector("#result");
const resultIcon = document.querySelector("#result-icon");
const resultKicker = document.querySelector("#result-kicker");
const resultTitle = document.querySelector("#result-title");
const resultExplanation = document.querySelector("#result-explanation");
const resultHost = document.querySelector("#result-host");
const resultCanonical = document.querySelector("#result-canonical");
const canonicalRow = document.querySelector("#canonical-row");
const sourceRow = document.querySelector("#source-row");
const resultSource = document.querySelector("#result-source");
const resultReasons = document.querySelector("#result-reasons");

const statusLabels = {
  known: "Correspondance dans la base locale",
  suspicious: "Signal ou élément inhabituel",
  impersonation: "Ressemblance avec un domaine officiel",
  unknown: "Aucune correspondance locale",
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  result.hidden = true;
  button.disabled = true;
  button.querySelector("span:first-child").textContent = "Analyse…";

  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: input.value }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || "Impossible d’analyser cette adresse.");
    }
    renderResult(payload);
  } catch (error) {
    errorMessage.textContent = error.message || "Le service est momentanément indisponible.";
    errorMessage.hidden = false;
  } finally {
    button.disabled = false;
    button.querySelector("span:first-child").textContent = "Vérifier";
  }
});

function renderResult(data) {
  result.dataset.classification = data.classification;
  resultKicker.textContent = statusLabels[data.classification];
  resultTitle.textContent = data.title;
  resultExplanation.textContent = data.explanation;
  resultHost.textContent = data.hostname;
  resultIcon.textContent = data.classification === "known" ? "✓" : data.classification === "unknown" ? "?" : "!";

  const hasDifferentCanonicalHost = data.canonical_hostname !== data.hostname;
  canonicalRow.hidden = !hasDifferentCanonicalHost;
  resultCanonical.textContent = data.canonical_hostname;
  const brandRow = document.querySelector("#brand-row");
  brandRow.hidden = !data.matched_brand;
  document.querySelector("#result-brand").textContent = data.matched_brand
    ? `${data.matched_brand} (${data.official_domain})`
    : "";
  sourceRow.hidden = !data.source;
  resultSource.textContent = data.source || "";
  const popularityRow = document.querySelector("#popularity-row");
  popularityRow.hidden = data.popular_rank == null;
  document.querySelector("#result-popularity").textContent = data.popular_rank == null
    ? ""
    : `Rang ${data.popular_rank} · liste ${data.tranco_list_id} · ${data.tranco_downloaded_at}`;

  resultReasons.replaceChildren();
  for (const reason of data.reasons) {
    const item = document.createElement("li");
    item.textContent = reason;
    resultReasons.append(item);
  }
  resultReasons.hidden = data.reasons.length === 0;
  result.hidden = false;
}