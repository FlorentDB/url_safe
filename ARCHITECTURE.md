# Architecture

## Purpose

Lien clair is a local-first prototype for inspecting pasted URLs without visiting their destinations. It parses and normalizes URLs, checks exact local domain and brand registries, applies URL/Unicode heuristics, and optionally displays a Tranco popularity rank. Results are informational and never certify that a page is safe.

## Stack

- Python, FastAPI, Uvicorn, SQLite.
- `urllib.parse`, `ipaddress`, and `idna` (UTS #46) for URL and hostname handling.
- `confusable-homoglyphs`, `rapidfuzz`, and `tldextract` for Unicode warnings, edit-distance matching, and registrable-domain boundaries.
- Plain HTML, CSS, and JavaScript; no frontend build step.
- Pytest/FastAPI `TestClient`; deployment bootstrap for Raspberry Pi OS/Debian with systemd, Nginx, and optional Certbot TLS.

## Important Paths

```text
app/
  main.py                 FastAPI app factory, lifecycle, page and check API
  checker.py              URL parsing, canonicalization, local heuristics
  unicode_security.py     Unicode confusable and mixed-script checks
  brand_matcher.py        Exact brand, homoglyph, and one-edit lookalike checks
  database.py             SQLite schema, CSV imports, exact and rank lookups
  import_domains.py       CLI for domain and brand CSV imports
  import_tranco.py        Explicit Tranco snapshot download/import CLI
  security_middleware.py  4 KiB request-body limit for the check endpoint
  static/                 HTML/CSS/JavaScript client
 deploy/
  setup-pi.sh             One-command Raspberry Pi setup (Nginx/systemd)
  url_safe.service        Hardened single-worker systemd unit
  Caddyfile.example       Optional manual Caddy alternative
 data/
  domains.csv             Small demonstration domain list, not a safety list
  brands.csv              Curated starter brand-to-domain registry
  url_safe.sqlite3        Runtime DB; ignored by Git
 tests/                   Parser, API, Unicode, SQLite, and Tranco tests
 requirements.txt         Python runtime and test dependencies
 README.md                 Setup and operational instructions
```

The deployment identifier is `url_safe`; the user-facing product name remains “Lien clair”.

## Request Flow

1. The browser sends JSON `{ "url": "..." }` to `POST /api/check`; the full submitted URL is not included in the response and is not persisted.
2. `RequestBodyLimitMiddleware` limits this route to 4 KiB. Pydantic validates the URL field, and the URL parser accepts only HTTP(S), adding HTTPS if no scheme was supplied.
3. The checker extracts and canonicalizes the host with IDNA, identifies IP literals, credentials, punycode, unusual ports, encoded control characters, double encoding, and dangerous mixed-script labels. The server never fetches or follows the submitted URL.
4. SQLite performs parameterized exact lookups in `domains`, `brand_domains`, and the current Tranco snapshot. Brand comparison can flag one-character differences or supported Unicode homoglyph matches.
5. `main.py` returns `known`, `suspicious`, `impersonation`, or `unknown`. A Tranco rank is context only and does not affect this classification.
6. Static JavaScript renders API fields as text, not clickable links.

## Security Boundaries

The app uses `TrustedHostMiddleware`, SlowAPI in-memory limiting (default `30/minute` per client IP), `Cache-Control: no-store` for API responses, and security headers including CSP, `nosniff`, frame denial, referrer policy, and permissions policy. `URLSAFE_ENV=production` disables OpenAPI/docs routes. These controls reduce application-layer risk but are not DDoS protection.

SlowAPI state is process-local: deploy with one Uvicorn worker unless it is replaced with shared storage. Proxy headers are trusted only from loopback. Keep Uvicorn on `127.0.0.1:8000` behind the reverse proxy. Never add server-side fetching of user-supplied URLs without an explicit SSRF-safe design.

Unicode checks are heuristics, not a complete UTS #39 skeleton/bidi implementation. A `known` result is not a trust guarantee; `unknown` is not a threat verdict. Tranco measures popularity, not safety.

## Data And Persistence

`domains` stores exact normalized hostnames with `known` or `malicious` status and a source. `brand_domains` stores brand name, official hostname, and source. Startup imports the checked-in CSV seed rows with `ignore_existing=True`; the CSVs are curated examples and are not maintained threat intelligence.

`tranco_snapshots` records list ID, source, import time, row count, and current-snapshot state. `tranco_domains` stores hostname/rank by list ID. Tranco is downloaded only by the explicit CLI or Pi bootstrap, never during app startup or a URL check. Runtime SQLite is stored in `data/url_safe.sqlite3` for development and `/var/lib/url_safe/url_safe.sqlite3` on the Pi.

## Commands

Development, from repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
python -m pytest -q
```

Import domain/brand data with `python -m app.import_domains ...`; refresh Tranco explicitly with `python -m app.import_tranco` (default Top 10,000).

On the Raspberry Pi, after cloning the repository, run from its root:

```bash
sudo bash deploy/setup-pi.sh
```

The installer asks for LAN-only or public mode. Use `--lan-only` for local access, or `--domain HOST --email ADDRESS` for public HTTPS. Public mode requires DNS to resolve to the home connection and router forwarding for TCP 80/443 before running Certbot. The script cannot configure the router/DNS or bypass CGNAT; it does not expose port 8000. It installs code in `/opt/url_safe`, system state in `/var/lib/url_safe`, and system configuration in `/etc/url_safe`.

## Deployment Constraints

The setup script targets Raspberry Pi OS/Debian with systemd and Nginx. It updates OS packages, installs dependencies, copies the checked-out code into `/opt/url_safe`, creates the `urlsafe` service account and a venv built on the Pi, configures Nginx, imports Tranco, and enables `url_safe.service`. Re-running it updates the installed code; it does not change DNS, router/firewall rules, or supply volumetric DDoS mitigation.

Nginx provides API request-size and rate limits. Public mode obtains a Let's Encrypt certificate with Certbot; LAN-only mode serves HTTP and opens no router ports. Back up `/var/lib/url_safe` and keep Raspberry Pi OS security updates current.
