"""Classification logic shared by the web API and the browser extension.

The browser extension reimplements this module in JavaScript. Both
implementations are validated against the same vector file in
``shared/vectors/verdicts.json`` so that the two cannot drift apart.

This module is intentionally free of I/O: it takes already-resolved lookup
results and returns the verdict. That keeps the decision rules testable and
makes the JavaScript port a direct transcription rather than a rewrite.
"""

from dataclasses import dataclass, field
from typing import Literal

Classification = Literal["known", "suspicious", "impersonation", "unknown"]

IMPERSONATION_MATCH_TYPES = frozenset(
    {"lookalike", "nested_brand_domain", "unicode_lookalike"}
)


@dataclass(frozen=True)
class Verdict:
    """The outcome of classifying one hostname."""

    classification: Classification
    title: str
    explanation: str
    reasons: list[str] = field(default_factory=list)
    source: str | None = None
    matched_brand: str | None = None
    official_domain: str | None = None


def build_verdict(
    reasons: list[str],
    record: dict[str, str] | None = None,
    brand_match: dict[str, str | int] | None = None,
) -> Verdict:
    """Classify a hostname from its heuristic reasons and local lookup results.

    ``record`` is a row of the ``domains`` table, ``brand_match`` is the
    result of :func:`app.brand_matcher.find_brand_match`. ``reasons`` are the
    heuristic findings produced by :func:`app.checker.analyze_url`; the list is
    not mutated, and any reason added here is appended to the copy.
    """
    findings = list(reasons)

    if record and record["status"] == "malicious":
        return Verdict(
            classification="suspicious",
            title="Domaine signalé",
            explanation=(
                "Une source de référence locale signale ce domaine. "
                "N’ouvre pas ce lien."
            ),
            reasons=findings + [f"Signalé par : {record['source']}."],
            source=str(record["source"]),
        )

    if brand_match and brand_match["match_type"] in IMPERSONATION_MATCH_TYPES:
        official_domain = str(brand_match["official_hostname"])
        match_type = str(brand_match["match_type"])

        if match_type == "nested_brand_domain":
            explanation = (
                f"Le domaine officiel {official_domain} apparaît dans une partie "
                "secondaire de l’adresse. Cela ne signifie pas que le site "
                "appartient à cette marque."
            )
            extra_reason = (
                "Un domaine officiel est utilisé comme sous-domaine d’un autre site."
            )
        elif match_type == "unicode_lookalike":
            explanation = (
                f"Des caractères du domaine sont confondables avec ceux de "
                f"{official_domain} selon les données Unicode. Cela indique une "
                "imitation possible, pas une fraude confirmée."
            )
            extra_reason = (
                f"Caractères Unicode confondables avec le domaine officiel "
                f"{official_domain}."
            )
        else:
            explanation = (
                f"Le nom de domaine diffère d’un caractère de {official_domain}. "
                "Cela peut être une imitation, mais ce signal ne prouve pas une "
                "fraude."
            )
            extra_reason = f"Ressemblance avec le domaine officiel {official_domain}."

        return Verdict(
            classification="impersonation",
            title=f"Ressemble à {brand_match['brand_name']}",
            explanation=explanation,
            reasons=findings + [extra_reason],
            source=str(brand_match["source"]),
            matched_brand=str(brand_match["brand_name"]),
            official_domain=official_domain,
        )

    if findings:
        return Verdict(
            classification="suspicious",
            title="À examiner",
            explanation=(
                "Des éléments inhabituels ont été repérés. Cela ne prouve pas à lui "
                "seul que le lien est malveillant."
            ),
            reasons=findings,
        )

    if brand_match and brand_match["match_type"] == "official":
        return Verdict(
            classification="known",
            title=f"Domaine répertorié pour {brand_match['brand_name']}",
            explanation=(
                "Le domaine correspond au registre local de la marque; cela ne "
                "garantit pas que chaque page soit sûre."
            ),
            reasons=findings,
            source=str(brand_match["source"]),
            matched_brand=str(brand_match["brand_name"]),
            official_domain=str(brand_match["official_hostname"]),
        )

    if record and record["status"] == "known":
        return Verdict(
            classification="known",
            title="Domaine répertorié",
            explanation=(
                "Ce domaine est dans la liste locale, ce qui ne garantit pas que "
                "cette page ou ce lien soit sûr."
            ),
            reasons=findings,
            source=str(record["source"]),
        )

    return Verdict(
        classification="unknown",
        title="Aucun signal local",
        explanation=(
            "Aucune correspondance dans la base locale. Ce résultat ne certifie "
            "pas la sécurité du lien."
        ),
        reasons=findings,
    )
