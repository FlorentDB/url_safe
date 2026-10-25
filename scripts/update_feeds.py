#!/usr/bin/env python3
"""
Daily feed updater for malicious domains.
"""

import csv
import io
import sys
import tempfile
from pathlib import Path

import httpx

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.database import (
    initialize_database,
    import_domains,
    normalize_domain,
    extract_hostname_from_url,
    expire_old_malicious,
    deduplicate_domains,
    get_stats,
)

DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "url_safe.sqlite3"

FEEDS = [
    {"name": "phishtank", "url": "https://data.phishtank.com/data/online-valid.csv", "parser": "parse_phishtank", "enabled": True},
    {"name": "openphish", "url": "https://openphish.com/feed.txt", "parser": "parse_openphish", "enabled": True},
    {"name": "urlhaus", "url": "https://urlhaus.abuse.ch/downloads/csv/", "parser": "parse_urlhaus", "enabled": True},
    {"name": "abuse_ch_malware", "url": "https://malware-domain-list.abuse.ch/downloads/csv/", "parser": "parse_abuse_ch_malware", "enabled": True},
]

HTTP_TIMEOUT = 60.0
MAX_RETRIES = 3


def fetch_feed(url):
    for attempt in range(MAX_RETRIES):
        try:
            with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
                response = client.get(url)
                response.raise_for_status()
                return response.content
        except Exception as e:
            print(f"  Attempt {attempt + 1}/{MAX_RETRIES} failed for {url}: {e}")
            if attempt == MAX_RETRIES - 1:
                return None
    return None


def parse_phishtank(content):
    domains = []
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        if row.get("online", "").lower() != "yes":
            continue
        if row.get("verified", "").lower() != "yes":
            continue
        url = row.get("url", "").strip()
        if not url:
            continue
        hostname = extract_hostname_from_url(url)
        if hostname:
            domains.append({"hostname": hostname, "status": "malicious", "source": "phishtank"})
    return domains


def parse_openphish(content):
    domains = []
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        hostname = extract_hostname_from_url(line)
        if hostname:
            domains.append({"hostname": hostname, "status": "malicious", "source": "openphish"})
    return domains


def parse_urlhaus(content):
    domains = []
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        if row.get("url_status", "").lower() != "online":
            continue
        url = row.get("url", "").strip()
        if not url:
            continue
        hostname = extract_hostname_from_url(url)
        if hostname:
            domains.append({"hostname": hostname, "status": "malicious", "source": "urlhaus"})
    return domains


def parse_abuse_ch_malware(content):
    domains = []
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        hostname = row.get("domain") or row.get("hostname") or row.get("Domain") or row.get("Hostname")
        if hostname:
            hostname = hostname.strip()
            if hostname:
                try:
                    normalized = normalize_domain(hostname)
                    domains.append({"hostname": normalized, "status": "malicious", "source": "abuse_ch_malware"})
                except ValueError:
                    continue
    return domains


PARSERS = {
    "parse_phishtank": parse_phishtank,
    "parse_openphish": parse_openphish,
    "parse_urlhaus": parse_urlhaus,
    "parse_abuse_ch_malware": parse_abuse_ch_malware,
}


def update_feeds(database_path, *, expire_days=90, dry_run=False):
    initialize_database(database_path)

    results = {
        "feeds": {},
        "total_imported": 0,
        "total_expired": 0,
        "total_deduped": 0,
        "errors": [],
    }

    for feed in FEEDS:
        if not feed["enabled"]:
            continue

        name = feed["name"]
        print(f"Fetching {name}...")
        content = fetch_feed(feed["url"])

        if content is None:
            error_msg = f"Failed to fetch {name}"
            print(f"  ERROR: {error_msg}")
            results["errors"].append(error_msg)
            results["feeds"][name] = {"imported": 0, "error": error_msg}
            continue

        parser_func = PARSERS[feed["parser"]]
        try:
            domains = parser_func(content)
            print(f"  Parsed {len(domains)} domains from {name}")

            if not dry_run and domains:
                with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, newline="", encoding="utf-8") as tmp:
                    writer = csv.DictWriter(tmp, fieldnames=["hostname", "status", "source"])
                    writer.writeheader()
                    writer.writerows(domains)
                    tmp_path = Path(tmp.name)

                try:
                    imported = import_domains(database_path, tmp_path, ignore_existing=False)
                    print(f"  Imported {imported} new/updated domains from {name}")
                    results["feeds"][name] = {"imported": imported, "parsed": len(domains)}
                    results["total_imported"] += imported
                finally:
                    tmp_path.unlink(missing_ok=True)
            else:
                results["feeds"][name] = {"imported": 0, "parsed": len(domains), "dry_run": dry_run}

        except Exception as e:
            error_msg = f"Error parsing {name}: {e}"
            print(f"  ERROR: {error_msg}")
            results["errors"].append(error_msg)
            results["feeds"][name] = {"imported": 0, "error": str(e)}

    if not dry_run:
        print(f"Expiring malicious domains older than {expire_days} days...")
        expired = expire_old_malicious(database_path, expire_days)
        print(f"  Expired {expired} domains")
        results["total_expired"] = expired

        print("Deduplicating domains...")
        deduped = deduplicate_domains(database_path)
        print(f"  Removed {deduped} duplicates")
        results["total_deduped"] = deduped

    return results


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Update malicious domain feeds")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE_PATH)
    parser.add_argument("--expire-days", type=int, default=90)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()

    print(f"Updating feeds into {args.database}")
    print(f"Expire days: {args.expire_days}")
    print(f"Dry run: {args.dry_run}")
    print()

    results = update_feeds(args.database, expire_days=args.expire_days, dry_run=args.dry_run)

    print()
    print("=== Summary ===")
    for feed_name, feed_result in results["feeds"].items():
        if "error" in feed_result:
            print(f"  {feed_name}: ERROR - {feed_result['error']}")
        else:
            print(f"  {feed_name}: {feed_result.get('imported', 0)} imported / {feed_result.get('parsed', 0)} parsed")

    print(f"Total imported: {results['total_imported']}")
    print(f"Total expired: {results['total_expired']}")
    print(f"Total deduplicated: {results['total_deduped']}")

    if results["errors"]:
        print(f"Errors: {len(results['errors'])}")
        for err in results["errors"]:
            print(f"  - {err}")

    if args.stats:
        stats = get_stats(args.database)
        print()
        print("=== Database Stats ===")
        for k, v in stats.items():
            if k != "sources":
                print(f"  {k}: {v}")
        print("  sources:")
        for src, count in stats["sources"].items():
            print(f"    {src}: {count}")

    if results["errors"] and not args.dry_run:
        sys.exit(1)


if __name__ == "__main__":
    main()