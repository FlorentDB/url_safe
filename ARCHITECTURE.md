# Architecture

## Purpose

Lien clair is a local-first prototype for inspecting a pasted URL without visiting its destination. It normalizes and inspects URL components, checks the exact hostname against a local SQLite table, and reports `known`, `suspicious`, or `unknown`. These classifications are informational; none certifies that a page is safe.

## Stack

- Python with FastAPI and Uvicorn for the HTTP application and API.
- SQLite through Python's standard library for the local hostname table.
- `urllib.parse` and `ipaddress` for URL/host parsing; `idna` (UTS #46) for ASCII hostname normalization; `confusable-homoglyphs` for Unicode confusable data; `tldextract` for registrable-domain boundaries using its bundled suffix snapshot; RapidFuzz for Damerau-Levenshtein comparison.
- Plain HTML, CSS, and JavaScript served as static files; there is no frontend framework or build step.
- Pytest and FastAPI's `TestClient` for tests.
- Dependencies are listed without version pins in `requirements.txt`. The analyzed workspace used Python 3.14.8; the project does not declare a supported Python range.

## Important Paths

```text
app/
  main.py                 FastAPI app factory, startup, page route, check API
  checker.py              URL parsing, hostname normalization, local heuristics
  unicode_security.py     UTS #39-derived confusable and mixed-script checks
  brand_matcher.py        Brand-domain matching and one-edit lookalike rule
  database.py             SQLite schema, exact lookup, CSV validation/import
  import_domains.py       CLI for importing or updating a CSV feed
  import_tranco.py        Explicit CLI download/import of a Tranco snapshot
  security_middleware.py  Request body-size limit for the check API
   static/
     index.html             French single-page interface
     app.js                 Form submission and safe result rendering
     styles.css             Responsive styling and reduced-motion handling
deploy/
  lien-clair.service      Hardened single-worker systemd service example
  Caddyfile.example       Public HTTPS reverse-proxy example
data/
  domains.csv              Demo seed rows; not a threat-intelligence feed
  brands.csv               Curated starter brand/domain registry
  url_safe.sqlite3         Runtime database and imported rankings, ignored by Git
tests/
  test_checker.py          Parser and heuristic tests
  test_api.py              HTTP, database, and classification tests
requirements.txt           Python dependencies
README.md                   Setup, import, and limitation notes
```

`.venv/`, Python caches, pytest cache, and `data/*.sqlite3` are ignored by Git. The database file may appear after starting the app.

## Components And Data Flow

1. `app.main:create_app()` selects the database path from its argument, `URLSAFE_DB_PATH`, or `data/url_safe.sqlite3`. Its lifespan initializes the schema and imports `data/domains.csv` and `data/brands.csv` with `ignore_existing=True`.
2. `GET /` serves `app/static/index.html`; `/static` serves the JavaScript and CSS.
3. The browser submits JSON `{ "url": "..." }` to `POST /api/check`. Pydantic constrains the input to 1-2048 characters.
4. `app.checker:analyze_url()` accepts HTTP(S) URLs (adding HTTPS when no scheme is supplied), extracts the actual hostname using `urlsplit`, canonicalizes IP or IDNA hostnames, and reports heuristics such as userinfo, IP literals, mixed-script confusables, punycode, unusual ports, encoded controls, and double encoding. It does not fetch the URL or follow redirects.
5. `app.database:lookup_domain()` queries SQLite for an exact canonical-hostname record. `list_brand_domains()` supplies the separate brand registry to `app.brand_matcher:find_brand_match()`.
6. `app.unicode_security` uses the packaged confusable character data to detect dangerous mixed-script labels and compare equal-length brand labels character by character. This is not a complete UTS #39 skeleton implementation; multi-code-point mappings and bidirectional skeleton processing are not implemented.
7. The brand matcher derives the registrable domain using `tldextract`'s bundled suffix snapshot (network fetching is disabled). It recognizes exact brand domains, Unicode homoglyph matches, one-character Damerau-Levenshtein differences for brand labels at least six characters long, and official hostnames embedded as non-controlling parts of another hostname.
8. `app.database:lookup_popular_domain()` checks the latest locally imported Tranco snapshot by exact hostname or registrable domain. This optional rank is returned as context and never changes the risk classification.
9. `app.main` prioritizes a `malicious` record, then possible brand impersonation, parser heuristics, and exact brand/domain matches, and otherwise returns `unknown`. The API classification is `known`, `suspicious`, `impersonation`, or `unknown`.
10. `app/static/app.js` renders response values with `textContent`/text nodes; it does not create a clickable link from the submitted URL.

The application makes no external reputation-service or destination requests. The submitted URL is passed to the local API but is not inserted into the database or returned in the API response. Check responses are marked `Cache-Control: no-store`.

The check endpoint uses SlowAPI (`URLSAFE_RATE_LIMIT`, default `30/minute`) with in-memory storage and the client IP as key. `TrustedHostMiddleware` restricts hosts using `URLSAFE_ALLOWED_HOSTS`; `RequestBodyLimitMiddleware` caps `/api/check` bodies at 4 KiB. `URLSAFE_ENV=production` disables `/docs`, `/redoc`, and `/openapi.json`, and adds CSP, `nosniff`, frame-denial, referrer, permissions, and no-store headers. The body-size cap protects only the API route.

## SQLite And CSV

The `domains` table has `hostname` as its primary key, a constrained `status` (`known` or `malicious`), a `source`, and `updated_at`. Hostnames are normalized to lowercase ASCII IDNA form before import and lookup. Matching is exact: a row for `example.com` does not match `login.example.com`.

The separate `brand_domains` table stores `brand_name`, normalized official `hostname`, `source`, and `updated_at`. Brand matching is a heuristic, not threat intelligence. The starter registry is intentionally small and must be verified and maintained before use beyond the prototype.

`tranco_snapshots` records snapshot ID, import time, source URL, number of imported domains, and which snapshot is current. `tranco_domains` stores `(list_id, hostname, rank)`. The CLI imports the latest snapshot explicitly, with a default limit of 10,000; application startup makes no Tranco network calls. Popularity remains independent of safety status.

CSV headers must include `hostname,status,source`. Startup imports only missing rows, preserving existing database records. The CLI importer upserts existing rows and refreshes `status`, `source`, and `updated_at`. The checked-in CSV is demo data (including reserved example domains and illustrative popular domains), not a maintained or verified safe-domain list.

## Commands

Run from the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The development server is available at `http://127.0.0.1:8000`; FastAPI's interactive API docs are at `/docs`.

```bash
python -m pytest -q
python -m app.import_domains path/to/domains.csv
python -m app.import_domains data/brands.csv --brands
python -m app.import_tranco
python -m app.import_tranco --limit 100000
```

There is currently no separate production build, frontend compilation, packaging, or deployment command configured in the repository. Use the virtual-environment Python for these commands if the system interpreter differs.

Public Raspberry Pi deployment templates are in `deploy/`; replace the example hostname and follow the setup sequence in `README.md`. The intended topology is Caddy on ports 80/443 reverse-proxying to Uvicorn on loopback port 8000. The systemd template runs as unprivileged `urlsafe`, writes SQLite only under `/var/lib/lien-clair`, and uses one worker because SlowAPI storage is in-memory. Uvicorn trusts forwarded headers only from loopback Caddy.

## Constraints And Pitfalls

- `known` means only that the exact hostname exists in the local table. It is not an allowlist decision or a safety guarantee; a known site can be compromised.
- `unknown` means no local match, not that a URL is benign. The repository contains no live threat feed, scheduled refresh, DNS/certificate check, reputation API, or redirect analysis.
- `impersonation` means a local brand-domain heuristic found a close match; it is not a confirmed malicious verdict. The current one-edit rule can miss multi-character changes and brands missing from `data/brands.csv`.
- Tranco rank is popularity context, not a trust verdict. The default import is only the Top 10,000 and is not run automatically.
- Unicode confusable checks use Unicode-derived package data but do not implement the entire UTS #39 skeleton or bidi algorithms; treat results as heuristics.
- `tldextract` network access is disabled; registrable-domain parsing uses the suffix snapshot packaged with the installed dependency, which may age until dependencies are updated.
- The heuristics are warning signals, not a complete phishing detector. URL parsing/IDNA normalization is not a full browser-equivalent security analysis, and the implementation does not inspect page content.
- Never add server-side fetching of user-submitted URLs without an explicit SSRF-safe design. The current no-fetch boundary is an important security property.
- Startup's `ignore_existing=True` means changing a CSV row does not update an existing database record. Run the CLI importer to apply updates.
- SQLite is suitable for a single Raspberry Pi instance; multi-instance database behavior is not configured. The public API has no user authentication by design.
- The production deployment example enables an in-memory rate limit and production host allowlist; it is not a volumetric DDoS defense. Do not increase Uvicorn worker count without replacing the shared-state-less limiter.
- Request-size limits, CSP, trusted-host validation, and TLS reverse-proxy settings reduce common attack surface but do not guarantee resilience against large DDoS traffic. Keep Uvicorn bound to loopback behind Caddy.
- The systemd/Caddy files are templates only and do not configure the Raspberry Pi, router, DNS, firewall, or domain. Verify those externally before exposing the service.
- The `known`/`malicious` source data needs provenance and refresh policy before real-world use. Do not treat the demo rows as security evidence.