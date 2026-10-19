from confusable_homoglyphs import confusables


def confusable_characters(candidate: str, reference: str) -> list[dict[str, str]] | None:
    candidate = candidate.casefold()
    reference = reference.casefold()
    if len(candidate) != len(reference):
        return None

    matches: list[dict[str, str]] = []
    for candidate_character, reference_character in zip(candidate, reference):
        if candidate_character == reference_character:
            continue
        if candidate_character.isascii():
            return None

        evidence = confusables.is_confusable(
            candidate_character,
            preferred_aliases=["LATIN"],
            greedy=True,
        )
        if not evidence or not any(
            glyph["c"].casefold() == reference_character
            for entry in evidence
            for glyph in entry["homoglyphs"]
        ):
            return None
        matches.append(
            {
                "character": candidate_character,
                "matches": reference_character,
            }
        )

    return matches or None


def dangerous_mixed_script_labels(hostname: str) -> list[str]:
    suspicious_labels: list[str] = []
    for label in hostname.split("."):
        if confusables.is_dangerous(label, preferred_aliases=["LATIN"]):
            suspicious_labels.append(label)
    return suspicious_labels