"""Generate the shared test vectors used by both the Python and JavaScript suites.

The extension reimplements the checker in JavaScript. Two independent
implementations of the same rules will drift unless something prevents it, so
this module produces a single JSON document of inputs and expected outputs.
The Python suite asserts the vectors still hold, and the JavaScript suite
asserts it produces the same answers.

Regenerate with::

    python -m app.export_vectors

and review the diff before committing it. The vectors are the contract
between the two implementations, so they are checked in.
"""

import json
from pathlib import Path

from app.brand_matcher import find_brand_match
from app.checker import UrlInputError, analyze_url
from app.verdict import build_verdict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VECTORS_PATH = PROJECT_ROOT / "shared" / "vectors" / "verdicts.json"

BRANDS = [
    {
        "brand_name": "Microsoft",
        "hostname": "microsoft.com",
        "source": "Shared vector fixture",
    },
    {
        "brand_name": "Google",
        "hostname": "google.com",
        "source": "Shared vector fixture",
    },
    {
        "brand_name": "PayPal",
        "hostname": "paypal.com",
        "source": "Shared vector fixture",
    },
]

DOMAINS = {
    "example.com": ("known", "Shared vector fixture"),
    "malicious.example": ("malicious", "Shared vector fixture"),
}

URL_CASES = [
    "https://example.com",
    "https://malicious.example/path",
    "https://not-a-brand.example",
    "https://microsoft.com",
    "https://rmicrosoft.com",
    "https://microsoft.com.attacker.example",
    "https://mіcrosoft.com",
    "https://раypal.com",
    "https://example.com:8443/",
    "https://user:secret@example.com/",
    "https://example.com/path%0d%0aheader",
    "https://example.com/%252e%252e/login",
    "https://192.168.1.1/",
    "http://paypal.com/login",
    "example.com/path",
    "https://sub.example.com/",
]


def _domain_record(hostname: str) -> dict[str, str] | None:
    entry = DOMAINS.get(hostname)
    if entry is None:
        return None
    status, source = entry
    return {"hostname": hostname, "status": status, "source": source}


def build_vectors() -> list[dict[str, object]]:
    vectors: list[dict[str, object]] = []

    for url in URL_CASES:
        try:
            analysis = analyze_url(url)
        except UrlInputError as error:
            vectors.append({"url": url, "error": str(error)})
            continue

        canonical_hostname = str(analysis["canonical_hostname"])
        record = _domain_record(canonical_hostname)
        brand_match = find_brand_match(canonical_hostname, BRANDS)
        reasons = list(analysis["reasons"])
        verdict = build_verdict(
            reasons=reasons,
            record=record,
            brand_match=brand_match,
        )

        vectors.append(
            {
                "url": url,
                "hostname": analysis["hostname"],
                "canonical_hostname": canonical_hostname,
                "reasons": reasons,
                "record": record,
                "brand_match": brand_match,
                "verdict": {
                    "classification": verdict.classification,
                    "title": verdict.title,
                    "explanation": verdict.explanation,
                    "reasons": verdict.reasons,
                    "source": verdict.source,
                    "matched_brand": verdict.matched_brand,
                    "official_domain": verdict.official_domain,
                },
            }
        )

    return vectors


def main() -> None:
    vectors = build_vectors()
    document = {
        "schema_version": 1,
        "brands": BRANDS,
        "domains": [
            {"hostname": hostname, "status": status, "source": source}
            for hostname, (status, source) in DOMAINS.items()
        ],
        "cases": vectors,
    }

    VECTORS_PATH.parent.mkdir(parents=True, exist_ok=True)
    VECTORS_PATH.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"{len(vectors)} vecteur(s) écrits vers {VECTORS_PATH}.")


if __name__ == "__main__":
    main()
