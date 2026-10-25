# Stratégie d'augmentation de la base de données URL Safe

## Objectif
Passer d'une base de démonstration (~100 marques, ~10 domaines) à une base de production maintenue (>10k domaines, >500 marques, feed malveillant temps réel).

---

## 1. Sources de données recommandées

### Marques légitimes (brand_domains)
| Source | Type | Fréquence | Volume estimé | Notes |
|--------|------|-----------|---------------|-------|
| **Tranco Top 1M** | Classement popularité | Quotidien | 1M domaines | Filtrer: garder seulement marques connues |
| **Public Suffix List** | Registres officiels | Hebdomadaire | ~10k TLD | Déjà utilisé pour extraction domaine enregistrable |
| **Majestic Million** | Classement backlinks | Mensuel | 1M | Alternative à Tranco |
| **Listes manuelles curatées** | Banques, admin, crypto | À la demande | 500-1000 | **Priorité haute** (cibles phishing principales) |

### Domaines malveillants (domains status=malicious)
| Source | Format | Fréquence | Volume/jour | API | Licence |
|--------|--------|-----------|-------------|-----|---------|
| **PhishTank** | CSV/JSON | Temps réel | ~2-5k | ✅ Oui | Gratuit (attribution) |
| **OpenPhish** | TXT/JSON | 12h | ~1-3k | ✅ Oui | Gratuit (non-commercial) |
| **URLhaus** | CSV/JSON | Temps réel | ~500-2k | ✅ Oui | Gratuit (CC BY 4.0) |
| **Spamhaus DBL** | DNS zone | Temps réel | ~100k+ | DNSBL | Commercial |
| **Abuse.ch** (malware domains) | CSV | Quotidien | ~1k | ✅ Oui | Gratuit |
| **Certstream** (certificats suspects) | WebSocket | Temps réel | Variable | ✅ Oui | Gratuit |
| **Google Safe Browsing** | API v4 | Temps réel | Milliards | ✅ Oui | Gratuit (quotas) |

### Domaines connus bénins (domains status=known)
| Source | Utilité |
|--------|---------|
| Tranco Top 10k-100k | Contexte popularité (pas sécurité) |
| Listes blanches Cisco Umbrella / Majestic | Domaines légitimes populaires |

---

## 2. Architecture de pipeline recommandée

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Sources        │────▶│  Normalisation   │────▶│  SQLite Local   │
│  (APIs, CSV,    │     │  - Dédoublonnage │     │  (url_safe.     │
│   DNS, feeds)   │     │  - IDNA/UTS#46   │     │   sqlite3)      │
└─────────────────┘     │  - Déduplication │     └────────┬────────┘
                        │    cross-source  │              │
                        └────────┬─────────┘              ▼
                                 │              ┌─────────────────┐
                                 ▼              │  Export JSON    │
                        ┌──────────────────┐    │  (domains.json, │
                        │  Enrichissement  │    │   brands.json)  │
                        │  - Catégorisation│    └────────┬────────┘
                        │  - Score confiance│           │
                        │  - Métadonnées    │           ▼
                        └──────────────────┘    ┌─────────────────┐
                                               │  Build Extension│
                                               │  (.xpi / .crx)  │
                                               └─────────────────┘
```
---

## 3. Implémentation par phases

### Phase 1 — Semaine 1-2 : Fondations (✅ Partiellement fait)
- [x] Schema SQLite extensible (`tranco_snapshots`, `tranco_domains`)
- [x] CLI `import_tranco.py` (limité à 10k par défaut)
- [x] CLI `import_domains.py` / `import_brand_domains.py`
- [x] Export JSON pour extension (`export_datasets.py`)
- [ ] **À faire** : Script `update_feeds.py` orchestrant toutes les sources
- [ ] **À faire** : Déduplication cross-sources (même domaine dans PhishTank + URLhaus)
- [ ] **À faire** : Score de confiance par source (PhishTank=high, Certstream=medium)

### Phase 2 — Semaine 3-4 : Automatisation feeds malveillants
```python
# update_feeds.py (à créer)
SOURCES = [
    {"name": "phishtank", "url": "https://data.phishtank.com/data/online-valid.csv", "format": "csv", "parser": parse_phishtank},
    {"name": "openphish", "url": "https://openphish.com/feed.txt", "format": "txt", "parser": parse_openphish},
    {"name": "urlhaus", "url": "https://urlhaus.abuse.ch/downloads/csv/", "format": "csv", "parser": parse_urlhaus},
    {"name": "abuse_ch_malware", "url": "https://malware-domain-list.abuse.ch/downloads/csv/", "format": "csv", "parser": parse_abuse_ch},
]
```
- Scheduler : `cron` quotidien (Render) ou `systemd timer` (Pi)
- Idempotence : `INSERT OR IGNORE` + `updated_at` pour refresh
- Métriques : `prometheus` exporter sur `/metrics` (domaines ajoutés, doublons, erreurs)
---

### Phase 3 — Semaine 5-6 : Marques prioritaires (curatées)
Créer `data/brands-priority.yaml` :
```yaml
categories:
  banking_fr:
    - {brand: "BNP Paribas", domain: "bnpparibas.com"}
    - {brand: "Société Générale", domain: "societegenerale.com"}
    - {brand: "Crédit Agricole", domain: "credit-agricole.fr"}
    # ... 20 banques FR
  banking_us:
    - {brand: "Chase", domain: "chase.com"}
    # ... 15 banques US
  crypto_exchanges:
    - {brand: "Coinbase", domain: "coinbase.com"}
    - {brand: "Binance", domain: "binance.com"}
    # ... 10 exchanges
  gov_fr:
    - {brand: "Service Public", domain: "service-public.fr"}
    - {brand: "Impôts", domain: "impots.gouv.fr"}
    - {brand: "Ameli", domain: "ameli.fr"}
    # ... 15 admin FR
  email_providers:
    - {brand: "Proton", domain: "proton.me"}
    - {brand: "Tutanota", domain: "tutanota.com"}
    # ... 10 providers
```
Script `import_brands_from_yaml.py` → `brand_domains` table.

### Phase 4 — Semaine 7-8 : Tranco intelligent (pas tout importer)
Au lieu d'importer 1M domaines :
```python
# import_tranco_smart.py
def should_import_tranco_domain(hostname, rank):
    # Importer si :
    # - Top 10k (toujours)
    # - OU domaine dans brands.csv (marque connue)
    # - OU TLD à risque (.xyz, .top, .loan, .click, .tk, .ml, .ga, .cf, .gq)
    # - OU longueur < 8 caractères (typosquatting fréquent)
    return rank <= 10000 or hostname in KNOWN_BRANDS or is_risky_tld(hostname) or len(hostname.split('.')[0]) < 8
```
Résultat : ~50-100k domaines pertinents au lieu de 1M.

### Phase 5 — Continu : Maintenance & Qualité
- **Dédoublonnage hebdo** : `DELETE FROM domains WHERE hostname IN (SELECT hostname FROM domains GROUP BY hostname HAVING COUNT(*) > 1)`
- **Expiration** : `malicious` > 90 jours sans reconfirmation → `status=expired` (table archive)
- **Contrôle qualité** : Échantillonnage manuel 1% / semaine
- **Feedback utilisateur** : Bouton "Signaler faux positif" → file d'attente modération

---

## 4. Coûts & Infrastructure

| Composant | Coût mensuel estimé | Notes |
|-----------|---------------------|-------|
| Render (cron job quotidien) | Gratuit (plan free) | 500h/mois suffisantes |
| Stockage SQLite | ~10-50 MB | Négligeable |
| Bande passante feeds | ~50-200 MB/jour | CDN gratuit (GitHub Pages, Cloudflare R2) |
| API Google Safe Browsing | Gratuit (10k req/jour) | Quotas suffisants pour extension |
| Monitoring (UptimeRobot + logs) | Gratuit | |

**Total : 0€/mois** sur infrastructure gratuite.

---

## 5. Métriques de succès

| KPI | Cible 3 mois | Cible 12 mois |
|-----|--------------|---------------|
| Marques curatées | 200 | 500+ |
| Domaines malveillants actifs | 50k | 200k+ |
| Faux positifs signalés | < 5% | < 1% |
| Latence import quotidien | < 5 min | < 2 min |
| Taille `domains.json` (extension) | < 500 KB | < 2 MB |
| Refresh extension (optionnel) | Hebdo | Quotidien |

---

## 6. Checklist technique immédiate

- [ ] Créer `scripts/update_feeds.py` avec parsers PhishTank, OpenPhish, URLhaus
- [ ] Ajouter colonnes `last_seen`, `confidence_score` dans table `domains`
- [ ] Créer `data/brands-priority.yaml` avec 100 marques prioritaires
- [ ] Modifier `import_tranco.py` → `import_tranco_smart.py` avec filtres
- [ ] Configurer cron/systemd timer pour refresh quotidien
- [ ] Ajouter endpoint `/healthz` + `/metrics` (Prometheus)
- [ ] Documenter procédure ajout marque manuelle (PR sur `brands-priority.yaml`)
- [ ] Tester export `domains.json` < 500 KB (compression gzip côté extension)

---

## 7. Note sur l'extension (.xpi / .crx)

L'extension **ne télécharge pas Tranco**. Elle embarque seulement :
- `domains.json` (domains + brands) → **~100-500 KB gzippé**
- `unicode.json` (tables confusuables) → **~200 KB gzippé**
- `public_suffixes.json` → **~50 KB gzippé**

**Taille totale package : < 1 MB** (acceptable pour Chrome Web Store / AMO).

Le refresh optionnel (configuré par l'utilisateur) télécharge les **mêmes fichiers JSON** depuis votre serveur — identiques pour tous les utilisateurs → **aucune fuite de vie privée**.

---

## 8. Prochaines actions concrètes (cette semaine)

1. **Créer `scripts/update_feeds.py`** avec 3 parsers (PhishTank, OpenPhish, URLhaus)
2. **Ajouter colonnes** `last_seen`, `confidence` dans `database.py` + migration
3. **Créer `data/brands-priority.yaml`** avec 100 marques prioritaires (banques FR/US, crypto, admin, email)
4. **Tester le pipeline** : `python scripts/update_feeds.py && python app/export_datasets.py`
5. **Vérifier taille** `extension/src/data/domains.json` < 500 KB
6. **Documenter** dans `CONTRIBUTING.md` comment ajouter une marque / signaler un faux positif