import pytest

from app.checker import UrlInputError, analyze_url


def test_adds_https_when_scheme_is_missing() -> None:
    result = analyze_url("example.com/path")

    assert result["normalized_url"] == "https://example.com/path"
    assert result["canonical_hostname"] == "example.com"


def test_converts_internationalized_hostname_to_ascii() -> None:
    result = analyze_url("https://раypal.com")

    assert result["hostname"] == "раypal.com"
    assert result["canonical_hostname"].startswith("xn--")
    assert any("punycode" in reason for reason in result["reasons"])


def test_flags_credentials_even_when_the_host_is_known() -> None:
    result = analyze_url("https://example.com@attacker.test/login")

    assert result["canonical_hostname"] == "attacker.test"
    assert any("identifiants" in reason for reason in result["reasons"])


def test_rejects_non_http_schemes() -> None:
    with pytest.raises(UrlInputError, match="HTTP et HTTPS"):
        analyze_url("javascript:alert(1)")


def test_rejects_control_characters() -> None:
    with pytest.raises(UrlInputError, match="contrôle"):
        analyze_url("https://example.com/\nnext")


def test_flags_encoded_control_characters() -> None:
    result = analyze_url("https://example.com/path%0d%0aheader")

    assert any("contrôle encodé" in reason for reason in result["reasons"])


def test_flags_double_encoded_path_characters() -> None:
    result = analyze_url("https://example.com/%252e%252e/login")

    assert any("seconde fois" in reason for reason in result["reasons"])


def test_flags_mixed_script_confusable_label() -> None:
    result = analyze_url("https://раураl.example")

    assert any("mélange des alphabets" in reason for reason in result["reasons"])


def test_does_not_flag_regular_latin_label_as_mixed_script() -> None:
    result = analyze_url("https://paypal.example")

    assert not any("mélange des alphabets" in reason for reason in result["reasons"])