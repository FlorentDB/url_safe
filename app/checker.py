import ipaddress
import re
from urllib.parse import urlsplit

import idna

from app.unicode_security import dangerous_mixed_script_labels


SCHEME_PREFIX = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


class UrlInputError(ValueError):
    pass


def analyze_url(value: str) -> dict[str, object]:
    submitted_url = value.strip()
    if not submitted_url:
        raise UrlInputError("Colle une adresse à vérifier.")
    if len(submitted_url) > 2048:
        raise UrlInputError("L’adresse dépasse la longueur maximale de 2 048 caractères.")
    if any(ord(character) < 32 or ord(character) == 127 for character in submitted_url):
        raise UrlInputError("L’adresse contient des caractères de contrôle.")

    if not submitted_url.startswith("//") and "://" not in submitted_url:
        scheme = SCHEME_PREFIX.match(submitted_url)
        if scheme:
            raise UrlInputError("Seules les adresses HTTP et HTTPS sont prises en charge.")
        submitted_url = f"https://{submitted_url}"
    elif submitted_url.startswith("//"):
        submitted_url = f"https:{submitted_url}"

    try:
        parts = urlsplit(submitted_url)
        hostname = parts.hostname
        port = parts.port
    except ValueError as error:
        raise UrlInputError("Cette adresse n’a pas un format valide.") from error

    if parts.scheme.lower() not in {"http", "https"}:
        raise UrlInputError("Seules les adresses HTTP et HTTPS sont prises en charge.")
    if not hostname:
        raise UrlInputError("Aucun nom de domaine n’a été trouvé dans cette adresse.")

    original_hostname = hostname.rstrip(".").lower()
    is_ip_address = False
    try:
        canonical_hostname = str(ipaddress.ip_address(original_hostname))
        is_ip_address = True
    except ValueError:
        try:
            canonical_hostname = idna.encode(
                original_hostname,
                uts46=True,
                std3_rules=True,
            ).decode("ascii").lower()
        except idna.IDNAError as error:
            raise UrlInputError("Le nom de domaine ne peut pas être interprété correctement.") from error

    reasons: list[str] = []
    if parts.username is not None or parts.password is not None:
        reasons.append("L’adresse contient des identifiants avant le nom d’hôte.")
    if is_ip_address:
        reasons.append("L’adresse utilise une adresse IP plutôt qu’un nom de domaine.")
    if canonical_hostname.startswith("xn--") or ".xn--" in canonical_hostname:
        reasons.append("Le domaine utilise du punycode; vérifie les caractères internationalisés affichés.")
    try:
        unicode_hostname = idna.decode(canonical_hostname)
    except idna.IDNAError:
        unicode_hostname = original_hostname
    for label in dangerous_mixed_script_labels(unicode_hostname):
        reasons.append(
            f"L’étiquette « {label} » mélange des alphabets et contient des caractères confondables avec le latin."
        )
    if port is not None and port not in {80, 443}:
        reasons.append(f"L’adresse utilise un port inhabituel ({port}).")

    encoded_components = f"{parts.path}?{parts.query}#{parts.fragment}"
    if re.search(r"%(?:0[0-9a-f]|1[0-9a-f]|7f)", encoded_components, re.IGNORECASE):
        reasons.append("Le chemin contient un caractère de contrôle encodé.")
    if re.search(r"%25[0-9a-f]{2}", encoded_components, re.IGNORECASE):
        reasons.append("Le chemin contient une séquence encodée une seconde fois.")

    return {
        "submitted_url": value.strip(),
        "normalized_url": submitted_url,
        "hostname": original_hostname,
        "canonical_hostname": canonical_hostname,
        "reasons": reasons,
    }