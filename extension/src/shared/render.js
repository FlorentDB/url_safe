/**
 * Rendering of a verdict, shared by the popup and the full-page result.
 *
 * The wording and the structure match the website, because the two are shown
 * to the user side by side: the site and the extension must say the same thing
 * about the same link.
 *
 * Every value is written with `textContent`, so a hostile hostname can never
 * become markup.
 */

/** The label shown above the verdict title, per classification. */
export const STATUS_LABELS = {
  known: "Correspondance dans la base locale",
  suspicious: "Signal ou élément inhabituel",
  impersonation: "Ressemblance avec un domaine officiel",
  unknown: "Aucune correspondance locale",
};

/**
 * Render a verdict into a container.
 *
 * @param {HTMLElement} root the container, emptied before the verdict is drawn
 * @param {object} data the verdict, as returned by the checker
 * @returns {void}
 */
export function renderVerdict(root, data) {
  root.replaceChildren();
  root.dataset.classification = data.classification;
  root.hidden = false;

  const icon = document.createElement("span");
  icon.className = "result-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = iconFor(data.classification);

  const kicker = document.createElement("p");
  kicker.className = "result-kicker";
  kicker.textContent = STATUS_LABELS[data.classification] ?? "";

  const title = document.createElement("h2");
  title.textContent = data.title;

  const titles = document.createElement("div");
  titles.append(kicker, title);

  const heading = document.createElement("div");
  heading.className = "result-heading";
  heading.append(icon, titles);

  const explanation = document.createElement("p");
  explanation.className = "result-explanation";
  explanation.textContent = data.explanation;

  root.append(heading, explanation);

  const details = document.createElement("dl");
  details.className = "domain-detail";
  details.append(
    detailRow("Domaine interprété", data.hostname),
    detailRow("Forme ASCII", data.canonical_hostname, {
      hidden: data.canonical_hostname === data.hostname,
    }),
    detailRow(
      "Marque comparée",
      data.matched_brand
        ? `${data.matched_brand} (${data.official_domain})`
        : "",
      { hidden: !data.matched_brand },
    ),
    detailRow("Source locale", data.source ?? "", { hidden: !data.source }),
  );
  root.append(details);

  if (data.reasons.length > 0) {
    const list = document.createElement("ul");
    list.className = "reason-list";
    for (const reason of data.reasons) {
      const item = document.createElement("li");
      item.textContent = reason;
      list.append(item);
    }
    root.append(list);
  }
}

/**
 * Render an error message into a container.
 *
 * @param {HTMLElement} root the container
 * @param {string} message the message to show
 * @returns {void}
 */
export function renderError(root, message) {
  root.replaceChildren();
  root.dataset.classification = "error";
  root.hidden = false;

  const paragraph = document.createElement("p");
  paragraph.className = "form-error";
  paragraph.setAttribute("role", "alert");
  paragraph.textContent = message;
  root.append(paragraph);
}

/**
 * The glyph shown next to the verdict title.
 *
 * @param {string} classification the classification
 * @returns {string} the glyph
 */
function iconFor(classification) {
  if (classification === "known") {
    return "✓";
  }
  if (classification === "unknown") {
    return "?";
  }
  return "!";
}

/**
 * Build one row of the detail list.
 *
 * @param {string} term the label
 * @param {string} value the value
 * @param {object} options the row options
 * @param {boolean} options.hidden whether the row starts hidden
 * @returns {HTMLElement} the row
 */
function detailRow(term, value, options = {}) {
  const wrapper = document.createElement("div");
  if (options.hidden) {
    wrapper.hidden = true;
  }

  const label = document.createElement("dt");
  label.textContent = term;

  const description = document.createElement("dd");
  description.textContent = value;

  wrapper.append(label, description);
  return wrapper;
}
