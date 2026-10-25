/**
 * Classification.
 *
 * The wording is defined here and pinned by the test vectors: changing a title
 * or an explanation means updating the vectors too.
 */

const IMPERSONATION_MATCH_TYPES = new Set([
  "lookalike",
  "nested_brand_domain",
  "unicode_lookalike",
]);

/**
 * Classify a hostname from its findings and the local lookup results.
 *
 * @param {object} options the inputs of the decision
 * @param {string[]} options.reasons the heuristic findings
 * @param {object | null} options.record the row of the domain registry
 * @param {object | null} options.brandMatch the result of the brand matcher
 * @returns {object} the verdict
 */
export function buildVerdict({ reasons, record, brandMatch }) {
  const findings = [...reasons];

  if (record && record.status === "malicious") {
    return {
      classification: "suspicious",
      title: "Domaine signalé",
      explanation:
        "Une source de référence locale signale ce domaine. N’ouvre pas ce lien.",
      reasons: [...findings, `Signalé par : ${record.source}.`],
      source: record.source,
      matched_brand: null,
      official_domain: null,
    };
  }

  if (brandMatch && IMPERSONATION_MATCH_TYPES.has(brandMatch.match_type)) {
    const officialDomain = brandMatch.official_hostname;
    let explanation;
    let extraReason;

    if (brandMatch.match_type === "nested_brand_domain") {
      explanation =
        `Le domaine officiel ${officialDomain} apparaît dans une partie ` +
        "secondaire de l’adresse. Cela ne signifie pas que le site " +
        "appartient à cette marque.";
      extraReason =
        "Un domaine officiel est utilisé comme sous-domaine d’un autre site.";
    } else if (brandMatch.match_type === "unicode_lookalike") {
      explanation =
        `Des caractères du domaine sont confondables avec ceux de ` +
        `${officialDomain} selon les données Unicode. Cela indique une ` +
        "imitation possible, pas une fraude confirmée.";
      extraReason =
        `Caractères Unicode confondables avec le domaine officiel ` +
        `${officialDomain}.`;
    } else {
      explanation =
        `Le nom de domaine diffère d’un caractère de ${officialDomain}. ` +
        "Cela peut être une imitation, mais ce signal ne prouve pas une " +
        "fraude.";
      extraReason = `Ressemblance avec le domaine officiel ${officialDomain}.`;
    }

    return {
      classification: "impersonation",
      title: `Ressemble à ${brandMatch.brand_name}`,
      explanation,
      reasons: [...findings, extraReason],
      source: brandMatch.source,
      matched_brand: brandMatch.brand_name,
      official_domain: officialDomain,
    };
  }

  if (findings.length > 0) {
    return {
      classification: "suspicious",
      title: "À examiner",
      explanation:
        "Des éléments inhabituels ont été repérés. Cela ne prouve pas à lui " +
        "seul que le lien est malveillant.",
      reasons: findings,
      source: null,
      matched_brand: null,
      official_domain: null,
    };
  }

  if (brandMatch && brandMatch.match_type === "official") {
    return {
      classification: "known",
      title: `Domaine répertorié pour ${brandMatch.brand_name}`,
      explanation:
        "Le domaine correspond au registre local de la marque; cela ne " +
        "garantit pas que chaque page soit sûre.",
      reasons: findings,
      source: brandMatch.source,
      matched_brand: brandMatch.brand_name,
      official_domain: brandMatch.official_hostname,
    };
  }

  if (record && record.status === "known") {
    return {
      classification: "known",
      title: "Domaine répertorié",
      explanation:
        "Ce domaine est dans la liste locale, ce qui ne garantit pas que " +
        "cette page ou ce lien soit sûr.",
      reasons: findings,
      source: record.source,
      matched_brand: null,
      official_domain: null,
    };
  }

  return {
    classification: "unknown",
    title: "Aucun signal local",
    explanation:
      "Aucune correspondance dans la base locale. Ce résultat ne certifie " +
      "pas la sécurité du lien.",
    reasons: findings,
    source: null,
    matched_brand: null,
    official_domain: null,
  };
}
