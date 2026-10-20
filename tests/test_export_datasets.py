import json

from app.database import import_brand_domains, import_domains
from app.export_datasets import SCHEMA_VERSION, export_domains, export_unicode


def test_export_domains_writes_registries_as_json(tmp_path) -> None:
    database_path = tmp_path / "test.sqlite3"
    domains_csv = tmp_path / "domains.csv"
    domains_csv.write_text(
        "hostname,status,source\nmalicious.example,malicious,Test feed\n",
        encoding="utf-8",
    )
    brands_csv = tmp_path / "brands.csv"
    brands_csv.write_text(
        "brand_name,hostname,source\nAcme,acme.com,Test brand\n",
        encoding="utf-8",
    )
    import_domains(database_path, domains_csv)
    import_brand_domains(database_path, brands_csv)

    output_path = tmp_path / "out" / "domains.json"
    count = export_domains(database_path, output_path)

    document = json.loads(output_path.read_text(encoding="utf-8"))

    assert count == 2
    assert document["schema_version"] == SCHEMA_VERSION
    assert document["domains"] == [
        {
            "hostname": "malicious.example",
            "status": "malicious",
            "source": "Test feed",
        }
    ]
    assert document["brands"] == [
        {
            "brand_name": "Acme",
            "hostname": "acme.com",
            "source": "Test brand",
        }
    ]


def test_export_unicode_keeps_only_latin_confusable_characters(tmp_path) -> None:
    output_path = tmp_path / "unicode.json"

    count = export_unicode(output_path)
    document = json.loads(output_path.read_text(encoding="utf-8"))

    assert count > 0
    assert document["schema_version"] == SCHEMA_VERSION
    assert document["script_ranges"]
    assert document["script_aliases"]

    confusables = document["confusables"]

    # A Cyrillic letter that looks like "i" must be present, because it is
    # confusable with Latin and the extension relies on it.
    assert "і" in confusables
    assert "i" in confusables["і"]

    # A Latin source character can never be confusable with Latin under the
    # rules the extension applies, so it must be absent.
    assert "a" not in confusables


def test_exported_unicode_matches_the_installed_package(tmp_path) -> None:
    from confusable_homoglyphs import categories
    from confusable_homoglyphs import confusables as confusables_module

    output_path = tmp_path / "unicode.json"
    export_unicode(output_path)
    document = json.loads(output_path.read_text(encoding="utf-8"))

    assert document["script_ranges"] == categories.categories_data["code_points_ranges"]
    assert document["script_aliases"] == categories.categories_data["iso_15924_aliases"]

    # Every exported source character must really be confusable with Latin,
    # otherwise the trimming removed something the server would still match.
    raw = confusables_module.confusables_data
    for character in document["confusables"]:
        entries = raw[character]
        assert any(
            categories.alias(glyph) == "LATIN"
            for entry in entries
            for glyph in entry["c"]
        )
