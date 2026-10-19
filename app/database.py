import csv
import io
import sqlite3
import zipfile
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timezone
from typing import Iterator

import idna
import tldextract


DOMAIN_EXTRACTOR = tldextract.TLDExtract(suffix_list_urls=(), fallback_to_snapshot=True)
MAX_TRANCO_DOMAINS = 1_000_000


@contextmanager
def connect(database_path: Path) -> Iterator[sqlite3.Connection]:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database(database_path: Path) -> None:
    with connect(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS domains (
                hostname TEXT PRIMARY KEY,
                status TEXT NOT NULL CHECK (status IN ('known', 'malicious')),
                source TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS brand_domains (
                brand_name TEXT NOT NULL,
                hostname TEXT NOT NULL,
                source TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (brand_name, hostname)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tranco_snapshots (
                list_id TEXT PRIMARY KEY,
                downloaded_at TEXT NOT NULL,
                source_url TEXT NOT NULL,
                imported_domains INTEGER NOT NULL,
                is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1))
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS tranco_domains (
                list_id TEXT NOT NULL,
                hostname TEXT NOT NULL,
                rank INTEGER NOT NULL,
                PRIMARY KEY (list_id, hostname),
                FOREIGN KEY (list_id) REFERENCES tranco_snapshots(list_id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS tranco_domains_hostname_idx ON tranco_domains(hostname)"
        )


def normalize_domain(domain: str) -> str:
    value = domain.strip().rstrip(".").lower()
    if not value or "/" in value or "@" in value:
        raise ValueError(f"Nom de domaine invalide : {domain}")
    return idna.encode(value, uts46=True, std3_rules=True).decode("ascii").lower()


def lookup_domain(database_path: Path, hostname: str) -> dict[str, str] | None:
    with connect(database_path) as connection:
        row = connection.execute(
            "SELECT hostname, status, source, updated_at FROM domains WHERE hostname = ?",
            (hostname,),
        ).fetchone()
    return dict(row) if row else None


def lookup_popular_domain(database_path: Path, hostname: str) -> dict[str, str | int] | None:
    candidates = [hostname]
    extracted = DOMAIN_EXTRACTOR(hostname)
    if extracted.domain and extracted.suffix:
        registrable_domain = f"{extracted.domain}.{extracted.suffix}".lower()
        if registrable_domain not in candidates:
            candidates.append(registrable_domain)

    fallback_hostname = candidates[1] if len(candidates) > 1 else candidates[0]
    with connect(database_path) as connection:
        row = connection.execute(
            """SELECT domains.hostname, domains.rank, snapshots.list_id, snapshots.downloaded_at
                FROM tranco_domains AS domains
                JOIN tranco_snapshots AS snapshots USING (list_id)
                WHERE snapshots.is_current = 1 AND domains.hostname IN (?, ?)
                ORDER BY CASE domains.hostname WHEN ? THEN 0 ELSE 1 END
                LIMIT 1""",
            (candidates[0], fallback_hostname, hostname),
        ).fetchone()
    return dict(row) if row else None


def import_tranco_archive(
    database_path: Path,
    archive: bytes,
    *,
    list_id: str,
    source_url: str,
    limit: int = 10_000,
    downloaded_at: str | None = None,
) -> tuple[int, int]:
    if not list_id.strip():
        raise ValueError("L’identifiant du snapshot Tranco est obligatoire.")
    if not 1 <= limit <= MAX_TRANCO_DOMAINS:
        raise ValueError(f"La limite doit être comprise entre 1 et {MAX_TRANCO_DOMAINS}.")

    initialize_database(database_path)
    downloaded_at = downloaded_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    imported = 0
    skipped = 0
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped_file:
        csv_names = [name for name in zipped_file.namelist() if name.lower().endswith(".csv")]
        if not csv_names:
            raise ValueError("L’archive Tranco ne contient pas de fichier CSV.")

        with zipped_file.open(csv_names[0]) as binary_csv, io.TextIOWrapper(
            binary_csv,
            encoding="utf-8",
            newline="",
        ) as text_csv:
            reader = csv.reader(text_csv)
            with connect(database_path) as connection:
                connection.execute("UPDATE tranco_snapshots SET is_current = 0 WHERE is_current = 1")
                connection.execute(
                    """INSERT INTO tranco_snapshots
                       (list_id, downloaded_at, source_url, imported_domains, is_current)
                       VALUES (?, ?, ?, 0, 1)
                       ON CONFLICT(list_id) DO UPDATE SET
                           downloaded_at = excluded.downloaded_at,
                           source_url = excluded.source_url,
                           imported_domains = 0,
                           is_current = 1""",
                    (list_id, downloaded_at, source_url),
                )
                connection.execute("DELETE FROM tranco_domains WHERE list_id = ?", (list_id,))

                pending_rows: list[tuple[str, str, int]] = []
                for row in reader:
                    if len(row) < 2:
                        raise ValueError("Une ligne du CSV Tranco ne contient pas rang et domaine.")
                    try:
                        rank = int(row[0])
                    except ValueError as error:
                        if imported == 0 and row[0].strip().lower() in {"rank", "position"}:
                            continue
                        raise ValueError(f"Rang Tranco invalide : {row[0]!r}") from error

                    try:
                        hostname = normalize_domain(row[1])
                    except (ValueError, idna.IDNAError):
                        skipped += 1
                        continue
                    pending_rows.append((list_id, hostname, rank))
                    imported += 1
                    if len(pending_rows) >= 1_000:
                        connection.executemany(
                            "INSERT INTO tranco_domains (list_id, hostname, rank) VALUES (?, ?, ?)",
                            pending_rows,
                        )
                        pending_rows.clear()
                    if imported >= limit:
                        break

                if pending_rows:
                    connection.executemany(
                        "INSERT INTO tranco_domains (list_id, hostname, rank) VALUES (?, ?, ?)",
                        pending_rows,
                    )
                if imported == 0:
                    raise ValueError("Le CSV Tranco ne contient aucun domaine valide.")
                connection.execute(
                    "UPDATE tranco_snapshots SET imported_domains = ? WHERE list_id = ?",
                    (imported, list_id),
                )

    return imported, skipped


def list_brand_domains(database_path: Path) -> list[dict[str, str]]:
    with connect(database_path) as connection:
        rows = connection.execute(
            "SELECT brand_name, hostname, source FROM brand_domains ORDER BY brand_name"
        ).fetchall()
    return [dict(row) for row in rows]


def import_brand_domains(
    database_path: Path,
    csv_path: Path,
    *,
    ignore_existing: bool = False,
) -> int:
    initialize_database(database_path)
    imported = 0
    with csv_path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        required_fields = {"brand_name", "hostname", "source"}
        if not required_fields.issubset(reader.fieldnames or []):
            raise ValueError("Le CSV de marques doit contenir brand_name,hostname,source.")

        with connect(database_path) as connection:
            for row in reader:
                brand_name = row["brand_name"].strip()
                source_name = row["source"].strip()
                if not brand_name or not source_name:
                    raise ValueError("Chaque domaine de marque doit avoir un nom et une source.")
                hostname = normalize_domain(row["hostname"])

                if ignore_existing:
                    cursor = connection.execute(
                        """INSERT OR IGNORE INTO brand_domains (brand_name, hostname, source)
                           VALUES (?, ?, ?)""",
                        (brand_name, hostname, source_name),
                    )
                else:
                    cursor = connection.execute(
                        """INSERT INTO brand_domains (brand_name, hostname, source)
                           VALUES (?, ?, ?)
                           ON CONFLICT(brand_name, hostname) DO UPDATE SET
                               source = excluded.source,
                               updated_at = CURRENT_TIMESTAMP""",
                        (brand_name, hostname, source_name),
                    )
                imported += cursor.rowcount

    return imported


def import_domains(database_path: Path, csv_path: Path, *, ignore_existing: bool = False) -> int:
    initialize_database(database_path)
    imported = 0
    with csv_path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        required_fields = {"hostname", "status", "source"}
        if not required_fields.issubset(reader.fieldnames or []):
            raise ValueError("Le CSV doit contenir les colonnes hostname,status,source.")

        with connect(database_path) as connection:
            for row in reader:
                status = row["status"].strip().lower()
                if status not in {"known", "malicious"}:
                    raise ValueError(f"Statut invalide pour {row['hostname']!r} : {status}")

                hostname = normalize_domain(row["hostname"])
                source_name = row["source"].strip()
                if not source_name:
                    raise ValueError(f"Source manquante pour {hostname}.")

                if ignore_existing:
                    cursor = connection.execute(
                        """INSERT OR IGNORE INTO domains (hostname, status, source)
                           VALUES (?, ?, ?)""",
                        (hostname, status, source_name),
                    )
                else:
                    cursor = connection.execute(
                        """INSERT INTO domains (hostname, status, source)
                           VALUES (?, ?, ?)
                           ON CONFLICT(hostname) DO UPDATE SET
                               status = excluded.status,
                               source = excluded.source,
                               updated_at = CURRENT_TIMESTAMP""",
                        (hostname, status, source_name),
                    )
                imported += cursor.rowcount

    return imported