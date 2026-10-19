import io
import zipfile

from fastapi.testclient import TestClient

from app.database import import_domains, import_tranco_archive
from app.main import create_app


def test_homepage_and_known_domain_lookup(tmp_path) -> None:
    client = TestClient(create_app(tmp_path / "test.sqlite3"))

    with client:
        homepage = client.get("/")
        result = client.post("/api/check", json={"url": "https://example.com"})
        subdomain = client.post("/api/check", json={"url": "https://login.example.com"})

    assert homepage.status_code == 200
    assert "Regardez avant" in homepage.text
    assert result.status_code == 200
    assert result.json()["classification"] == "known"
    assert "ne garantit pas" in result.json()["explanation"]
    assert subdomain.json()["classification"] == "unknown"


def test_imported_malicious_domain_is_flagged(tmp_path) -> None:
    database_path = tmp_path / "test.sqlite3"
    csv_path = tmp_path / "feed.csv"
    csv_path.write_text(
        "hostname,status,source\nmalicious.example,malicious,Test feed\n",
        encoding="utf-8",
    )
    import_domains(database_path, csv_path)

    with TestClient(create_app(database_path)) as client:
        response = client.post("/api/check", json={"url": "https://malicious.example"})

    assert response.json()["classification"] == "suspicious"
    assert response.json()["source"] == "Test feed"


def test_flags_one_character_brand_lookalike(tmp_path) -> None:
    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        response = client.post("/api/check", json={"url": "https://rmicrosoft.com"})

    assert response.status_code == 200
    assert response.json()["classification"] == "impersonation"
    assert response.json()["matched_brand"] == "Microsoft"
    assert response.json()["official_domain"] == "microsoft.com"


def test_flags_unicode_homoglyph_in_brand_domain(tmp_path) -> None:
    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        response = client.post("/api/check", json={"url": "https://mіcrosoft.com"})

    assert response.json()["classification"] == "impersonation"
    assert response.json()["matched_brand"] == "Microsoft"
    assert "confondables" in response.json()["explanation"]


def test_exact_brand_domain_is_not_flagged_as_lookalike(tmp_path) -> None:
    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        response = client.post("/api/check", json={"url": "https://microsoft.com"})

    assert response.json()["classification"] == "known"
    assert response.json()["matched_brand"] == "Microsoft"


def test_unrelated_domain_remains_unknown(tmp_path) -> None:
    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        response = client.post("/api/check", json={"url": "https://not-a-brand.example"})

    assert response.json()["classification"] == "unknown"


def test_flags_official_brand_domain_nested_under_another_host(tmp_path) -> None:
    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        response = client.post(
            "/api/check",
            json={"url": "https://microsoft.com.attacker.example"},
        )

    assert response.json()["classification"] == "impersonation"
    assert response.json()["matched_brand"] == "Microsoft"


def test_tranco_rank_is_context_only_and_uses_current_snapshot(tmp_path) -> None:
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "top-1m.csv",
            "1,popular.example\n2,_invalid.example\n3,other.example\n",
        )
    database_path = tmp_path / "test.sqlite3"
    imported, skipped = import_tranco_archive(
        database_path,
        archive_buffer.getvalue(),
        list_id="snapshot-one",
        source_url="https://tranco-list.eu/download_daily/snapshot-one",
        limit=3,
        downloaded_at="2026-10-19T10:00:00+00:00",
    )
    newer_archive_buffer = io.BytesIO()
    with zipfile.ZipFile(newer_archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("top-1m.csv", "4,popular.example\n")
    import_tranco_archive(
        database_path,
        newer_archive_buffer.getvalue(),
        list_id="snapshot-two",
        source_url="https://tranco-list.eu/download_daily/snapshot-two",
        limit=3,
        downloaded_at="2026-10-19T11:00:00+00:00",
    )

    with TestClient(create_app(database_path)) as client:
        response = client.post("/api/check", json={"url": "https://popular.example"})

    assert response.json()["classification"] == "unknown"
    assert response.json()["popular_rank"] == 4
    assert response.json()["tranco_list_id"] == "snapshot-two"
    assert (imported, skipped) == (2, 1)


def test_invalid_scheme_returns_actionable_error(tmp_path) -> None:
    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        response = client.post("/api/check", json={"url": "javascript:alert(1)"})

    assert response.status_code == 422
    assert "HTTP et HTTPS" in response.json()["detail"]


def test_check_response_does_not_echo_or_cache_submitted_url(tmp_path) -> None:
    submitted_url = "https://unknown.example/reset?token=private-value"
    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        response = client.post("/api/check", json={"url": submitted_url})

    assert response.status_code == 200
    assert "submitted_url" not in response.json()
    assert "normalized_url" not in response.json()
    assert response.headers["cache-control"] == "no-store"
    assert "private-value" not in response.text


def test_production_hides_api_docs_and_sets_security_headers(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("URLSAFE_ENV", "production")
    monkeypatch.setenv("URLSAFE_ALLOWED_HOSTS", "testserver")

    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        homepage = client.get("/")
        docs = client.get("/docs")
        schema = client.get("/openapi.json")

    assert homepage.status_code == 200
    assert docs.status_code == 404
    assert schema.status_code == 404
    assert homepage.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in homepage.headers["content-security-policy"]


def test_rejects_untrusted_host_header(tmp_path) -> None:
    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        response = client.get("/", headers={"host": "attacker.invalid"})

    assert response.status_code == 400


def test_rejects_oversized_request_body(tmp_path) -> None:
    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        response = client.post(
            "/api/check",
            content=b'{"url":"https://example.com","extra":"' + b"x" * 5000 + b'"}',
            headers={"content-type": "application/json"},
        )

    assert response.status_code == 413


def test_rate_limits_api_requests_per_client(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("URLSAFE_RATE_LIMIT", "2/minute")

    with TestClient(create_app(tmp_path / "test.sqlite3")) as client:
        first = client.post("/api/check", json={"url": "https://first.example"})
        second = client.post("/api/check", json={"url": "https://second.example"})
        third = client.post("/api/check", json={"url": "https://third.example"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429