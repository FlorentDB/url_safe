# Architecture

## Purpose

url_safe is a local-first prototype for inspecting pasted URLs without visiting their destinations. It parses and normalizes URLs, checks exact local domain and brand registries, applies URL/Unicode heuristics, and optionally displays a Tranco popularity rank. Results are informational and never certify that a page is safe.

## Stack

- Python, FastAPI, Uvicorn, SQLite.
- `urllib.parse`, `ipaddress`, and `idna` (UTS #46) for URL and hostname handling.
- `confusable-homoglyphs`, `rapidfuzz`, and `tldextract` for Unicode warnings, edit-distance matching, and registrable-domain boundaries.
- Plain HTML, CSS, and JavaScript; no frontend build step.
- Pytest/FastAPI `TestClient`; deployment configurations for Render and Raspberry Pi OS/Debian with systemd, Nginx, and optional Certbot TLS.
- The browser extension is plain ES modules with no framework and no build dependency. The Node test runner and a hand-written ZIP writer are enough; the only build tooling is a Python script that draws the icons.

## Important Paths

```text
app/
  main.py                 FastAPI app factory, lifecycle, page and check API
  checker.py              URL parsing, canonicalization, local heuristics
  unicode_security.py     Unicode confusable and mixed-script checks
  brand_matcher.py        Exact brand, homoglyph, and one-edit lookalike checks
  verdict.py              Classification rules, shared by the API and the extension
  database.py             SQLite schema, CSV imports, exact and rank lookups
  import_domains.py       CLI for domain and brand CSV imports
  import_tranco.py        Explicit Tranco snapshot download/import CLI
  export_datasets.py      Export the local databases as static JSON for the extension
  export_vectors.py       Generate the shared Python/JavaScript test vectors
  security_middleware.py  4 KiB request-body limit for the check endpoint
  static/                 HTML/CSS/JavaScript client, privacy policy, extension page
 deploy/
  setup-pi.sh             One-command Raspberry Pi setup (Nginx/systemd)
  url_safe.service        Hardened single-worker systemd unit
  Caddyfile.example       Optional manual Caddy alternative
 render.yaml              Free Render demo deployment
 data/
  domains.csv             Small demonstration domain list, not a safety list
  brands.csv              Curated starter brand-to-domain registry
  url_safe.sqlite3        Runtime DB; ignored by Git
extension/
  manifest.json           The single source manifest, Chrome-shaped
  package.json            Test, build, and data commands
  scripts/
    build.mjs             Package both stores, write the ZIP archives
    firefox-manifest.mjs  Turn the Chrome manifest into the Firefox one
    make-icons.py         Draw the icons, so they stay in step with the site
    smoke-test.mjs        Install the package in a real Firefox
  src/
    core/                 The checker, in JavaScript
      index.js            The Checker class, the entry point of the core
      checker.js          URL analysis, the counterpart of app/checker.py
      verdict.js          Classification, the counterpart of app/verdict.py
      brand.js            Brand lookalike detection
      idna.js             Punycode, UTS #46, and the STD3 rules
      unicode.js          Confusable table and script ranges
      publicsuffix.js     Public suffix list matching
      urlsplit.js         URL splitting, mirroring urllib.parse.urlsplit
    shared/
      datasets.js         Load, cache, and refresh the datasets
      settings.js         The one user setting, and its origin
      render.js           Verdict rendering, shared by the popup and the result page
      theme.css           The visual language of the site
    background/
      service-worker.js   Context menu, refresh alarm, message router
    popup/                The toolbar popup
    result/               The full-page result opened from the context menu
    options/              The options page
    data/                 The datasets, baked into the package
    icons/                The drawn icons
  test/                   Node test runner suites
shared/
  vectors/verdicts.json   The contract between the Python and JavaScript checkers
 tests/                   Parser, API, Unicode, SQLite, and Tranco tests
 requirements.txt         Python runtime and test dependencies
 README.md                 Setup and operational instructions
```

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

The Render Blueprint uses `/tmp/url_safe.sqlite3` for a free demo. Render's free service has an ephemeral filesystem and may sleep, so this database is disposable and is rebuilt from the demonstration CSVs at startup. Do not use the free configuration for production or persistent threat-intelligence data.

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

The extension has its own commands, run from `extension/`:

```bash
npm test                 # the JavaScript suites
npm run build            # the Chrome and Firefox packages in extension/dist
npm run build:release    # the same, refusing to build with placeholder addresses
npm run build:firefox    # the Firefox beta package only
npm run icons            # redraw the icons
npm run data             # re-export the datasets from the local database
npm run smoke            # install the package in a real Firefox
```

`npm run data` must be run from the repository root, because the exporter is a Python module of the server. The exported files are committed: the extension is built from the checkout, and a package must never depend on the state of a developer's machine.

On the Raspberry Pi, after cloning the repository, run from its root:

```bash
sudo bash deploy/setup-pi.sh
```

The installer asks for LAN-only or public mode. Use `--lan-only` for local access, or `--domain HOST --email ADDRESS` for public HTTPS. Public mode requires DNS to resolve to the home connection and router forwarding for TCP 80/443 before running Certbot. The script cannot configure the router/DNS or bypass CGNAT; it does not expose port 8000. It installs code in `/opt/url_safe`, system state in `/var/lib/url_safe`, and system configuration in `/etc/url_safe`.

## Deployment Constraints

The setup script targets Raspberry Pi OS/Debian with systemd and Nginx. It updates OS packages, installs dependencies, copies the checked-out code into `/opt/url_safe`, creates the `urlsafe` service account and a venv built on the Pi, configures Nginx, imports Tranco, and enables `url_safe.service`. Re-running it updates the installed code; it does not change DNS, router/firewall rules, or supply volumetric DDoS mitigation.

Nginx provides API request-size and rate limits. Public mode obtains a Let's Encrypt certificate with Certbot; LAN-only mode serves HTTP and opens no router ports. Back up `/var/lib/url_safe` and keep Raspberry Pi OS security updates current.

## Public Exposure Options

The installer implements two modes: `--lan-only` and `--domain`. Public mode assumes a routable IPv4 address and router forwarding for TCP 80/443, and it cannot work behind CGNAT. Three shapes are viable for a public instance; only the first is implemented today.

### 1. Port forwarding to the Pi (implemented, highest home-network exposure)

The Pi receives inbound TCP 80/443 through the router and terminates TLS itself with Certbot. This is the `--domain` mode described above. It exposes the home public IP, so the residential address becomes attributable to the service and is exposed to scanners and opportunistic abuse. The router must forward 80 and 443 explicitly; forwarding 8000 would bypass Nginx entirely and must never be done. A home connection also has no volumetric DDoS protection, and upstream residential addresses are often blocked by mail providers and flagged by abuse filters.

### 2. VPS (no home exposure, recurring cost)

The app runs on a rented server that holds the public IP. Nothing in the home is reachable from the internet, so the residential connection is not part of the attack surface and the box requires no changes. The trade-off is a permanent maintenance duty: OS patching, SSH hardening, backups of `/var/lib/url_safe`, and rebuilding the host if it is lost. Entry-level shared-CPU instances are sufficient for this workload because the checker performs only local SQLite lookups. A domain is still required for a usable hostname and for standard TLS issuance.

`deploy/setup-pi.sh` is written against Raspberry Pi OS/Debian with systemd and does not depend on Pi-specific hardware, so it is reusable on a Debian VPS. It should be reworked into a dedicated VPS path rather than reused verbatim, because the Pi assumptions (hostname-based LAN allow-list, `hostname -I` address discovery, the Pi-specific `setup-pi.sh` name) do not fit a hosted server.

### 3. CGNAT plus outbound tunnel (no home exposure, no inbound port)

When the ISP aggregates subscribers behind CGNAT, no port forwarding is possible. A tunnel client on the Pi instead opens an outbound connection to a third-party edge, which proxies public traffic back through that connection. The router needs no forwarding rule and the home IP is never published.

Two providers are practical:

- **Cloudflare Tunnel** (`cloudflared`): outbound-only, works behind CGNAT, and a custom hostname requires the domain to be active in the same Cloudflare account with Cloudflare nameservers, which is free. The free plan also absorbs volumetric DDoS at the edge.
- **Tailscale Funnel** (`tailscale funnel`): no domain purchase at all. It publishes a `*.ts.net` hostname with an automatically provisioned Let's Encrypt certificate. It is currently beta, restricted to TCP 443, 8443 and 10000, subject to non-configurable bandwidth limits, and requires both HTTPS certificates enabled for the tailnet and a `nodeAttrs` entry granting the `funnel` attribute.

### Choosing between them

The deciding factor for a privacy-oriented tool is TLS termination. The app promises that a submitted URL is never opened and never stored, and that promise holds end to end only when the operator terminates TLS. Any third-party edge terminates TLS at its own infrastructure, so the submitted URL crosses that provider in cleartext inside the decrypted request body. A self-hosted VPS or the Pi itself preserves the promise exactly; a tunnel or a proxied CDN hostname weakens it in favour of convenience and DDoS protection.

For this project the honest ranking is: VPS first if the privacy claim is part of the product identity, CGNAT plus tunnel second if zero cost and zero home exposure matter more, port forwarding last.

## Reverse Proxy and Client IP Trust

`deploy/url_safe.service` runs Uvicorn with `--proxy-headers --forwarded-allow-ips=127.0.0.1`, so Uvicorn rewrites `request.client` from `X-Forwarded-For` only when the connecting peer is loopback. Uvicorn walks the forwarded list in reverse and takes the first entry that is not itself trusted, so the client address Nginx appends last wins and a client-supplied `X-Forwarded-For` cannot spoof the rate-limit key. `slowapi` reads `request.client.host` through this path, which makes the per-client limit correct.

Two consequences must be preserved when a proxy is introduced in front of the app:

- The Nginx zone `limit_req_zone $binary_remote_addr` keys on the TCP peer of Nginx. Behind a tunnel or any other local proxy, every request arrives from `127.0.0.1`, so the entire public internet shares one bucket and the 30 r/m limit becomes a global cap. The fix is to restore the real address before rate limiting, using `set_real_ip_from` scoped to the tunnel's listener plus `real_ip_header CF-Connecting-IP`, and to keep the real-IP directives inside that one `server` block so that other listeners are unaffected. `CF-Connecting-IP` is the header Cloudflare guarantees; `X-Forwarded-For` behaviour must be confirmed with a probe against the chosen provider before relying on it.
- `URLSAFE_ALLOWED_HOSTS` must list the public hostname that the edge presents, otherwise `TrustedHostMiddleware` answers `400` for every request.

These two are the only proxy-aware adjustments the application needs. The body-size limit, the single-worker rule for the in-memory limiter, the `no-store` response policy, and the prohibition on fetching submitted URLs are unaffected by the choice of front end.

## Public Release Checklist

Beyond the transport, a public instance changes the risk profile of the data rather than the code:

- The checked-in `data/domains.csv` and `data/brands.csv` are demonstration seeds, not threat intelligence, and their `source` columns say so. Publishing the service with those seeds active means the interface displays reassuring verdicts such as "Domaine répertorié" for well-known hosts on the strength of editorial examples. The seed data must be replaced by a maintained feed, or the classification wording must be softened, before the service is presented publicly.
- Tranco ranks are popularity only, and their licence conditions must be checked before redistribution or commercial use.
- The service has no authentication and no abuse contact. It must not become a free reputation oracle for phishing links, which needs a monitored contact route and a clear statement that no verdict is a guarantee.
- A single-worker Uvicorn with in-memory rate limiting is a soft target. A public instance needs edge-level rate limiting in front of the application, not only the Nginx zone.

## Browser Extension Architecture

A browser extension changes the problem. The site is a page a user visits deliberately; an extension is code that runs inside every browser, on every session, and that the store reviews before anyone can install it. Three decisions follow from that, and the first one dominates the other two.

### Decision 1: does the extension call the API, or does it check locally?

**Call the API.** The extension sends the candidate URL to `/api/check` and renders the returned verdict. The Python implementation stays the single source of truth, no logic is duplicated, and the datasets stay fresh because they live only on the server.

- The extension needs `host_permissions` for the API origin, which Chrome surfaces to the user as a "read and change your data on <host>" warning.
- The server now sees the URLs users are about to open. That is browsing activity, and it is the data most likely to be used against the user.
- Every check consumes a server request, so the rate limiter and the DDoS exposure become load-bearing rather than theoretical. Behind a tunnel, the shared-bucket problem described above would collapse the service.
- The privacy claim in the interface and the README no longer holds end to end, because the URL crosses the network in cleartext inside the request body whenever a third party terminates TLS.

**Check locally.** The extension reimplements the heuristics in JavaScript and ships or fetches the datasets. Nothing about the checked URL ever leaves the device.

- The privacy claim becomes literally true, and the strongest argument for the product survives the extension.
- No server request per check, so no rate limit, no per-URL log, and no DDoS surface on the checking path.
- The Python and JavaScript implementations can drift. Every heuristic change must be applied twice, and the two answers for the same URL must stay consistent.
- The brand list and the confusable tables have to be present in the extension, which constrains their size.

**Hybrid, and this is the shape worth building.** The extension performs the checks locally, but it obtains the datasets by downloading static files rather than by calling a per-URL endpoint. The server publishes `domains` and `brand_domains` as bulk JSON. Downloading the whole list reveals nothing about which URL was checked, because the request is identical for every user. This gives local checking, fresh data, and no per-URL traffic, and the datasets can be served from a static host or a CDN without running the FastAPI application at all.

The cost is that the datasets must be published as artefacts rather than queried, which means a build step and a decision about the update cadence. A browser extension update is a manual, reviewed event, so a dataset fetched at runtime is far easier to refresh than one baked into the package.

### Decision 2: store distribution

Chrome Web Store costs a one-time USD 5 registration fee. Firefox AMO is free, and a Manifest V3 add-on must declare an `browser_specific_settings.gecko.id` and, since 3 November 2025, a `data_collection_permissions` value, even when the answer is `none`. A single Manifest V3 codebase targets both, with `browser_specific_settings` and a thin compatibility layer for the API differences.

Safari requires an Apple Developer membership and a native wrapper, which is a separate product and should be deferred.

### Decision 3: data disclosure and store policy

An extension that transmits URLs to a server collects browsing activity, and both stores treat that as sensitive data.

- Chrome requires a privacy policy, a completed data collection disclosure, and a limited-use certification in the developer dashboard, and it requires a prominent disclosure and consent before the first collection. Discrepancies between the dashboard, the policy, and the actual behaviour are a policy violation that can suspend the item and deactivate the installed base.
- Chrome forbids transferring user data for purposes other than the extension's single purpose, and forbids any human access to it. Server-side logs of submitted URLs must therefore be excluded from operational access, which conflicts with ordinary log-based debugging.
- The single purpose must be stated precisely, for example "check the safety of a link that the user explicitly selects". Proactive checking of links on hover, or on page load, is materially harder to defend because it is no longer strictly necessary for the stated purpose.
- An extension that performs every check locally and only downloads bulk datasets presents a far simpler disclosure story, because no user data is transmitted at all.

### CORS and origin

The application registers no CORS middleware, so a browser page on another origin cannot call it. A Manifest V3 background service worker may make cross-origin requests to hosts listed in `host_permissions` without the response carrying CORS headers, but this is a property of the extension origin and does not extend to content scripts. If a per-URL API is kept for the extension, the API host must be added to `URLSAFE_ALLOWED_HOSTS`, and the CORS behaviour has to be verified separately on each target browser rather than assumed from the Chromium documentation.

## Browser Extension Implementation

The hybrid shape described above is what was built. The extension checks locally, ships the datasets inside the package, and never joins a network unless the user explicitly asks for a refresh.

### Two entry points, both user-initiated

The extension offers a toolbar popup, where a URL can be pasted by hand, and a context-menu entry on links, named "Vérifier avec url_safe". The menu entry appears only in the `link` context, so it is offered exactly when there is a link to check. There is no content script, no hover detection, and no page-load inspection. Every check is the result of a deliberate gesture, which is what makes the single purpose defensible in front of a store review.

The context menu opens a full-page result in a new tab. The checked address is handed over through `chrome.storage.session` and only an opaque identifier travels in the address of the page, so the URL itself never reaches the address bar or the browser history.

### Permissions, and what the extension refuses to ask for

The manifest declares `storage`, `contextMenus`, and `alarms`. It declares no `content_scripts`, no `tabs`, no `activeTab`, no `scripting`, and no `host_permissions`. The only host access is an *optional* permission for a single origin, requested at the moment the user asks for a dataset refresh, and it is dropped again when the refreshed data is discarded.

A fresh installation therefore triggers **no permission prompt at all** in Chrome, which is the strongest position available for a store review. `extension/test/manifest.test.js` asserts all of this, so a later change that adds a browsing permission fails the test suite rather than the review.

### The checker, in JavaScript

`extension/src/core/` is a second implementation of the same rules. It is not a port of the Python by hand alone: each module documents the exact counterpart it mirrors and the places where the two disagree by default.

Three of those disagreements had to be resolved explicitly, because the browser and the server do not behave the same way on their own.

- **URL splitting.** `urllib.parse.urlsplit` keeps the brackets around an IPv6 literal, does not percent-decode the host, and leaves some parts untouched. The browser's `URL` parser does the opposite on all three counts. `urlsplit.js` reproduces the Python behaviour, because the server is the reference.
- **Hostname canonicalisation.** The `idna` package applies UTS #46 *and* the STD3 rules. The browser applies UTS #46 alone, so it accepts `abc_def.com` and over-long labels that the server rejects. `idna.js` uses the browser parser for the mapping and applies the stricter rules on top of it.
- **Punycode decoding.** `TextDecoder` has no `punycode` encoding, so `idna.js` implements the RFC 3492 decoder itself, to turn a hostname back into the characters a user actually sees.

The Unicode tables and the public suffix list are exported from the server's own dependencies, so both sides work from the same data. The confusable table is trimmed to the characters that have a Latin homoglyph, which removes about eighty percent of the file without changing a single result.

### Shared test vectors

Two independent implementations of the same rules will drift. `app/export_vectors.py` writes `shared/vectors/verdicts.json`, a list of inputs and the verdict each one must produce, and both suites assert against it: `tests/test_shared_vectors.py` for Python, `extension/test/vectors.test.js` for JavaScript. A rule that is changed on one side and not the other fails the other side's suite.

The vectors are committed. They are the contract between the two implementations, and a contract that is regenerated on every run would not catch anything.

### Datasets

`app/export_datasets.py` writes three files into `extension/src/data/`: the domain and brand registries, the trimmed Unicode tables, and the public suffix rules. They are baked into the package, so the extension is complete and functional with no network access at all, and the data can be refreshed later without going through a store review.

Only the *refreshed* datasets are cached in `chrome.storage.local`. Caching the bundled ones would trade a package read for a storage read and gain nothing.

### Chrome and Firefox

One manifest is the source of truth, and it is Chrome-shaped. `extension/scripts/firefox-manifest.mjs` turns it into the Firefox one at build time: `background.service_worker` becomes `background.scripts`, and a `browser_specific_settings.gecko` block is added with the stable identifier `url-safe@url-safe.fr`, a minimum Firefox version, and `data_collection_permissions` declaring `none` as required and `technicalAndInteraction` as optional. Optional refresh is gated on the user's Firefox data-collection consent as well as the configured HTTPS host permission.

The background context is loaded with a dynamic import rather than a static one. A static import would make the file a module, and Firefox runs background scripts as classic scripts. The dynamic import works in both, and the event listeners are still registered synchronously at the top level, which is what a service worker that can be stopped at any moment requires.

### Packaging

`extension/scripts/build.mjs` copies the source tree into `extension/dist/chrome` and `extension/dist/firefox`, writes the two manifests, and produces the two ZIP archives. The archives are written by hand, because the project has no build dependency and a ZIP with deflated entries is a few dozen lines.

The build refuses to produce a package that references a file that does not exist, that points at a missing page, or that still carries the placeholder address. The placeholder scan covers every packaged file, not only the manifest, because the privacy policy is copied in from `app/static/` and the pages quote values of their own. `--release` turns the placeholder into a hard error, so a package cannot reach a store with `example.invalid` in it.

The icons are drawn by `extension/scripts/make-icons.py`, which writes the PNGs by hand so that they stay in step with the colours of the website and can be regenerated at any size.

The privacy policy is written once, at `app/static/confidentialite.html`, and copied into the package by the build. It carries its own styles inline, because a link to a stylesheet would not resolve inside the extension, and two copies of the same document would be free to drift apart. The packaged file is byte-identical to the one the website serves.

### Refreshing the bundled data

The extension ships its datasets inside the package, so a data change only reaches users through a rebuild. `scripts/update_extension.sh` performs the whole sequence from the repository root: it imports `data/domains.csv` and `data/brands.csv`, imports the curated `data/brands-priority.yaml`, exports the datasets with `app/export_datasets.py`, runs the Python and JavaScript suites, and writes the Firefox archive with `npm run build:firefox`. The script reads the version from `extension/package.json` and checks that `extension/manifest.json` agrees; `--version X.Y.Z` or `--bump patch|minor|major` rewrites both files before the build, so a new release folder needs no manual edit. It then re-zips the built tree into `release/<version>/url_safe-<version>-firefox.zip`, with `manifest.json` at its root, and fails if that property does not hold. It also writes `url_safe-<version>-source.zip` for the store's source review: the build instructions (`AMO-SOURCE-README.md`), the build script, the dependency list and lock file, and every input, but no artefact (`dist/`, `release/`, virtualenv, database, caches). The folder also receives an extracted `firefox-package/` copy, the source reviewer notes and a refreshed `SHA256SUMS.txt`. Running the individual commands in another order leaves the package with stale data, which is what the script exists to prevent.

The exported `domains.json` carries both registries, `unicode.json` the trimmed confusable tables and `public_suffixes.json` the public rules; all three report `schema_version` 1, which the extension refuses to load when it differs.

### What has been verified, and what has not

The checks that were run, and what each one proves:

- **43 JavaScript tests** (`npm test`): the checker against the shared vectors, the manifest against the privacy rules, the renderer against a stand-in for the DOM, the packaged datasets, the beta disclosures, and the syntax of every source file.
- **31 Python tests** (`python -m pytest`): the server, the shared vectors, the exporters.
- **Mozilla's own linter** (`npx web-ext lint`): zero errors and zero warnings on the Firefox package.
- **A real Firefox** (`npm run smoke`): the package is installed through the standard command and the extension loads without error.

What has **not** been verified automatically is that the popup paints the verdict in a browser. Two browser boundaries make it impractical: Firefox refuses to open a `moz-extension://` address in a tab the driver created, and refuses the driver on privileged pages such as `about:debugging`; Chrome does not load extensions in headless mode at all. The renderer is therefore covered by a test that builds the same markup against a stand-in for the DOM, and the last check is a click in the browser.

### What still has to be done before a submission

- The store links in `app/static/extension.html` must point at the real listings. The manifest no longer carries a placeholder address.
- The contact address in `app/static/confidentialite.html` is `warsmox.dev@gmail.com`; it must remain monitored.
- The demonstration seed data (10 domain records, 215 brand records) must be replaced by a maintained feed, exactly as for the website.
- The Firefox extension uses the proposed stable Gecko identifier `url-safe@url-safe.fr`; AMO must confirm that it is available, and changing it after signing would create a different add-on.
