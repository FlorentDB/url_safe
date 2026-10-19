import ipaddress

import idna
import tldextract
from rapidfuzz.distance import DamerauLevenshtein

from app.unicode_security import confusable_characters


DOMAIN_EXTRACTOR = tldextract.TLDExtract(
    suffix_list_urls=(),
    fallback_to_snapshot=True,
)
MIN_BRAND_LABEL_LENGTH = 6


def _registrable_domain(hostname: str) -> tuple[str, str] | None:
    extracted = DOMAIN_EXTRACTOR(hostname)
    if not extracted.domain or not extracted.suffix:
        return None

    registered_domain = f"{extracted.domain}.{extracted.suffix}".lower()
    try:
        label = idna.decode(extracted.domain.encode("ascii")).casefold()
    except (UnicodeError, idna.IDNAError):
        label = extracted.domain.casefold()
    return registered_domain, label


def find_brand_match(
    hostname: str,
    brands: list[dict[str, str]],
) -> dict[str, str | int] | None:
    try:
        ipaddress.ip_address(hostname)
        return None
    except ValueError:
        pass

    normalized_host = hostname.rstrip(".").lower()
    candidate = _registrable_domain(normalized_host)
    fuzzy_matches: list[dict[str, str | int]] = []

    for brand in brands:
        official_hostname = brand["hostname"].rstrip(".").lower()
        official = _registrable_domain(official_hostname)
        if official is None:
            continue
        official_domain, official_label = official

        if candidate is not None and candidate[0] == official_domain:
            return {
                "brand_name": brand["brand_name"],
                "official_hostname": official_hostname,
                "source": brand["source"],
                "match_type": "official",
                "distance": 0,
            }

        if (
            f".{official_hostname}." in f".{normalized_host}."
            and not normalized_host.endswith(f".{official_hostname}")
        ):
            return {
                "brand_name": brand["brand_name"],
                "official_hostname": official_hostname,
                "source": brand["source"],
                "match_type": "nested_brand_domain",
                "distance": 0,
            }

        if candidate is None:
            continue
        candidate_domain, candidate_label = candidate
        unicode_matches = confusable_characters(candidate_label, official_label)
        if unicode_matches:
            return {
                "brand_name": brand["brand_name"],
                "official_hostname": official_hostname,
                "source": brand["source"],
                "match_type": "unicode_lookalike",
                "distance": 0,
            }
        if len(official_label) < MIN_BRAND_LABEL_LENGTH:
            continue
        distance = DamerauLevenshtein.distance(candidate_label, official_label)
        if distance == 1:
            fuzzy_matches.append(
                {
                    "brand_name": brand["brand_name"],
                    "official_hostname": official_hostname,
                    "source": brand["source"],
                    "match_type": "lookalike",
                    "distance": distance,
                }
            )

    if not fuzzy_matches:
        return None
    return min(
        fuzzy_matches,
        key=lambda match: (
            int(match["distance"]),
            -len(str(match["brand_name"])),
        ),
    )