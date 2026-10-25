# Chrome Web Store Listing — url_safe (Bêta)

> Last updated: 2026-10-20
> Status: Paused — Firefox beta is being prepared first

## Store Listing

**Extension name:** url_safe (Bêta)

**Short description:** BÊTA — THIS EXTENSION IS FOR BETA TESTING. Analyse indicative d’URL, sans garantie de sécurité.

**Detailed description:**

VERSION BÊTA — THIS EXTENSION IS FOR BETA TESTING.

url_safe examine une adresse à la demande et signale quelques indices pouvant mériter votre attention, comme une adresse mal formée, des caractères ressemblants ou une imitation d’une marque répertoriée.

Collez une adresse dans la fenêtre de l’extension, ou faites un clic droit sur un lien et choisissez « Vérifier avec url_safe ». La vérification s’effectue sur votre appareil; l’adresse examinée n’est pas transmise.

Les listes intégrées sont très limitées et ne sont pas une base de données anti-phishing maintenue. Un résultat n’est qu’un indice : l’absence d’alerte ne signifie pas qu’un site est fiable. Vérifiez l’adresse et ne l’ouvrez que si vous le jugez sûr.

L’actualisation des listes est facultative. Si vous la configurez, l’hôte de données reçoit une requête HTTPS pour télécharger les listes et peut voir les métadonnées habituelles de connexion, comme votre adresse IP. L’URL que vous vérifiez n’est pas incluse.

**Category:** Search Tools

**Single purpose:** Examiner localement une URL à la demande et afficher des indices possibles de risque.

**Primary language:** French

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store icon | 128×128 PNG | Ready | `extension/src/icons/icon-128.png` |
| Screenshot 1 | 1280×800 or 640×400 | Not created | |
| Screenshot 2 | 1280×800 or 640×400 | Not created | |
| Small promo tile | 440×280 | Not created | |

Screenshots must show the current extension UI and must not imply that the bundled data is a complete or maintained threat-intelligence feed.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Save the optional dataset host and downloaded dataset cache locally, so users do not have to reconfigure or download the same lists on every check. |
| `contextMenus` | permissions | Offer “Vérifier avec url_safe” when the user right-clicks a link. |
| `alarms` | permissions | Run the optional daily refresh only when a user has configured a dataset host and enabled automatic refresh. |
| `https://*/*` | optional host permission | Requested for the specific HTTPS origin entered by the user, only when the user initiates a dataset refresh. No host access is requested on installation. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** The extension does not collect checked URLs or browsing history.

URL checks run locally. The extension stores its optional dataset-host setting and refreshed public datasets in browser-local storage. If a user configures a remote dataset host, the browser makes HTTPS requests to that host; that host can receive ordinary connection metadata such as the user's IP address. No checked URL is included in those requests.

Before submission, review the disclosure against the final implementation and the Chrome Web Store's current data-use questions. Do not claim that the extension makes no network requests: optional dataset refresh contacts the user-configured host.

| Data Type | Collected by extension? | Sent off-device? | Purpose | Shared with third parties? |
|-----------|-------------------------|------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Web history / checked URLs | No | No | Local URL analysis | No |
| Website content | No | No | — | No |
| Optional dataset request | Public datasets only | Only after user configures refresh | Update bundled domain and Unicode datasets | The configured dataset host receives a request and normal connection metadata |

### Data Use Certification

- [x] Data is NOT sold to third parties.
- [x] Data is NOT used for purposes unrelated to the extension's core functionality.
- [x] Data is NOT used for creditworthiness or lending purposes.

## Privacy Policy

**Privacy policy URL:** Not yet published. Publish the extension-specific policy at a stable public URL before submission. A copy inside the extension package is not a substitute for the dashboard URL.

The current policy is `app/static/confidentialite.html`. It must remain consistent with the extension-only data practices above and should be reachable independently of the not-yet-deployed application website.

## Distribution

**Visibility:** Private — use trusted testers for a family beta. Unlisted is an alternative if you want to share a link more broadly.  
**Regions:** France (proposed)

## Developer Info

**Publisher name:** warsmox.

**Contact email:** warsmox.dev@gmail.com.

**Support URL / email:** To be supplied.

**Homepage URL:** Optional; no project website is needed for the extension to work.

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | 2026-10-20 | Private beta; prominent accuracy and coverage warning | Draft |
| 0.1.1 | 2026-10-25 | Expanded local registry (10 domains, 215 brands), clearer reason wording with optional technical details, DOM-only rendering | Draft |

## Chrome status

Chrome publication is paused while the Firefox beta is tested. Do not upload the Chrome package yet.

## Submission Blockers

- The Chrome Web Store account has not been connected; the owner must upload and submit from its dashboard.
- Chrome private visibility needs the testers' Google Account email addresses to be added in the developer dashboard.
- The publisher name and contact above are proposed for Chrome too; confirm in the dashboard before publication.
- Publish and verify a public extension privacy-policy URL. The extension's current policy file is included in its package but does not yet have a public URL.
- Create at least one genuine store screenshot.
- The proposed Firefox Gecko ID is `url-safe@url-safe.fr`; it is unrelated to the paused Chrome package.
- The bundled domain data remains a curated beta seed: 10 domain records (7 known and 3 malicious demo entries) and 215 brand records. The listing and warning must not describe it as comprehensive protection.
- Test the final signed packages in Chrome and Firefox, including right-click verification and optional dataset-refresh permission flows.

## Known Issues / Limitations

- The packaged extension currently contains 10 domain records (7 `known`, 3 `malicious` demonstration entries), 215 brand records. The three malicious entries come from demonstration seeds, not live feeds.
- The server's separate SQLite database contains a Tranco snapshot of 10,000 popular domains, but that snapshot is not included in the extension's bundled datasets.
- The bundled `domains.csv` and `brands.csv` are explicitly demonstration data, not maintained threat intelligence.
- Unicode and URL heuristics are signals, not proof that a link is malicious or safe.
- Store screenshots, a monitored contact address, and a public privacy-policy URL are not ready.
