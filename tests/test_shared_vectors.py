"""Assert the Python implementation still matches the shared vectors.

The browser extension reimplements the checker in JavaScript and runs against
this same file, so a change to the Python rules that is not mirrored in
JavaScript fails here rather than silently producing two different answers.
"""

import json
from pathlib import Path

import pytest

from app.brand_matcher import find_brand_match
from app.checker import UrlInputError, analyze_url
from app.verdict import build_verdict

VECTORS_PATH = (
    Path(__file__).resolve().parent.parent / "shared" / "vectors" / "verdicts.json"
)


def _load() -> dict:
    return json.loads(VECTORS_PATH.read_text(encoding="utf-8"))


def test_shared_vectors_cover_every_classification() -> None:
    document = _load()
    classifications = {
        case["verdict"]["classification"]
        for case in document["cases"]
        if "verdict" in case
    }

    assert classifications == {"known", "suspicious", "impersonation", "unknown"}


def test_python_implementation_matches_shared_vectors() -> None:
    document = _load()
    brands = document["brands"]
    records = {
        entry["hostname"]: entry for entry in document["domains"]
    }

    for case in document["cases"]:
        if "error" in case:
            with pytest.raises(UrlInputError):
                analyze_url(case["url"])
            continue

        analysis = analyze_url(case["url"])
        assert analysis["hostname"] == case["hostname"], case["url"]
        assert analysis["canonical_hostname"] == case["canonical_hostname"], case["url"]
        assert analysis["reasons"] == case["reasons"], case["url"]

        canonical_hostname = case["canonical_hostname"]
        record = records.get(canonical_hostname)
        brand_match = find_brand_match(canonical_hostname, brands)
        assert brand_match == case["brand_match"], case["url"]

        verdict = build_verdict(
            reasons=list(analysis["reasons"]),
            record=record,
            brand_match=brand_match,
        )
        expected = case["verdict"]
        assert verdict.classification == expected["classification"], case["url"]
        assert verdict.title == expected["title"], case["url"]
        assert verdict.explanation == expected["explanation"], case["url"]
        assert verdict.reasons == expected["reasons"], case["url"]
        assert verdict.source == expected["source"], case["url"]
        assert verdict.matched_brand == expected["matched_brand"], case["url"]
        assert verdict.official_domain == expected["official_domain"], case["url"]
