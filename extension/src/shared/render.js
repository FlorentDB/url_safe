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
 * Map technical reason to simple user-friendly message.
 * @param {string} reason the technical reason from checker
 * @returns {string} simplified message
 */
function simplifyReason(reason) {
  if (reason.includes("punycode") || reason.includes("xn--")) {
    return "Ce domaine utilise une écriture internationale qui peut cacher une imitation visuelle.";
  }
  if (reason.includes("mélange des alphabets") || reason.includes("confondables avec le latin")) {
    return "Le nom de domaine mélange des alphabets différents (ex: cyrillique + latin) pour ressembler à un site connu.";
  }
  if (reason.includes("identifiants avant le nom d'hôte") || reason.includes("username") || reason.includes("password")) {
    return "Ce lien contient un nom d'utilisateur ou mot de passe — tentative de vol d'identifiants possible.";
  }
  if (reason.includes("adresse IP") || reason.includes("IP plutôt qu'un nom")) {
    return "Ce lien utilise une adresse numérique (IP) au lieu d'un nom de domaine — suspect.";
  }
  if (reason.includes("port inhabituel")) {
    return "Ce lien utilise un port non standard — inhabituel pour un site web légitime.";
  }
  if (reason.includes("caractère de contrôle encodé")) {
    return "Le lien cache des caractères invisibles pour tromper les filtres de sécurité.";
  }
  if (reason.includes("séquence encodée une seconde fois")) {
    return "Le lien contient un double encodage pour masquer son véritable contenu.";
  }
  if (reason.includes("Signalé par")) {
    return "Ce domaine est signalé par une source de référence locale.";
  }
  if (reason.includes("Ressemblance avec le domaine officiel") || (reason.includes("domaine officiel") && reason.includes("sous-domaine"))) {
    return "Un domaine officiel est utilisé comme sous-domaine d'un autre site — ce n'est pas le site officiel.";
  }
  if (reason.includes("Caractères Unicode confondables")) {
    return "Des caractères du domaine sont visuellement confondables avec ceux d'un site officiel.";
  }
  if (reason.includes("diffère d'un caractère")) {
    return "Le nom de domaine diffère d'un seul caractère d'un site officiel — imitation possible.";
  }
  return reason;
}

/**
 * Check if a reason has technical details worth showing in expandable section.
 * @param {string} reason the technical reason
 * @returns {boolean}
 */
function isTechnicalReason(reason) {
  return (
    reason.includes("punycode") ||
    reason.includes("xn--") ||
    reason.includes("mélange des alphabets") ||
    reason.includes("confondables") ||
    reason.includes("identifiants") ||
    reason.includes("adresse IP") ||
    reason.includes("port inhabituel") ||
    reason.includes("caractère de contrôle") ||
    reason.includes("double encodage") ||
    reason.includes("Signalé par") ||
    reason.includes("Ressemblance") ||
    reason.includes("Caractères Unicode") ||
    reason.includes("diffère d'un caractère")
  );
}

/**
 * Fill a container with one block per non-empty line of a technical reason.
 *
 * The lines are written with `textContent`, like every other value of this
 * module, so a hostile hostname stays text and never becomes markup.
 *
 * @param {HTMLElement} container the container to fill
 * @param {string} reason the technical reason
 * @returns {void}
 */
function fillTechnicalReason(container, reason) {
  for (const line of reason.split("\n").filter((part) => part.trim())) {
    const row = document.createElement("div");
    row.className = "tech-line";
    row.textContent = line;
    container.append(row);
  }
}

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
      item.className = "reason-item";

      // Level 1: Simple message
      const simple = document.createElement("span");
      simple.className = "reason-simple";
      simple.textContent = simplifyReason(reason);
      item.append(simple);

      // Level 2: the technical wording, collapsed behind a button.
      if (isTechnicalReason(reason)) {
        const details = document.createElement("div");
        details.className = "reason-details";
        details.hidden = true;
        fillTechnicalReason(details, reason);

        const toggle = document.createElement("button");
        toggle.className = "reason-toggle";
        toggle.textContent = "Voir les détails techniques";
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("type", "button");

        let expanded = false;
        toggle.addEventListener("click", () => {
          expanded = !expanded;
          toggle.setAttribute("aria-expanded", String(expanded));
          details.hidden = !expanded;
          toggle.textContent = expanded
            ? "Masquer les détails"
            : "Voir les détails techniques";
        });

        item.append(toggle, details);
      }

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
