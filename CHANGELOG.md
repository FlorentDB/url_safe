# Changelog — url_safe

Les versions suivent le manifeste de l’extension Firefox. Chaque soumission à
AMO doit porter un numéro strictement supérieur au précédent.

## 0.1.2 — 25 octobre 2026

### Dépôt

- Le dépôt ne contient plus que l’extension Firefox. Le backend FastAPI, les
  tests Python, le déploiement Render et Raspberry Pi, les outils de flux et la
  stratégie de base de données ont été supprimés.
- Les données sources vivent dans `extension/data/`; l’export est assuré par
  `extension/scripts/export_datasets.py`, sans base SQLite.
- La politique de confidentialité est dans `extension/src/confidentialite.html`
  et les vecteurs de test dans `extension/test/vectors.json`.
- Aucun changement fonctionnel : les jeux de données exportés et le JavaScript
  embarqué sont identiques ; seule la version change.

## 0.1.1 — 25 octobre 2026

### Données embarquées dans l’extension

- **Domaines : 7 → 10 entrées.** 7 domaines `known` et 3 entrées `malicious`
  de démonstration (`phishing-example.com`, `malware-test.net`,
  `fake-bank-login.xyz`). Ces trois entrées viennent des CSV de démonstration,
  pas d’un flux maintenu.
- **Marques : 6 → 215 entrées.** 203 proviennent de
  `data/brands-priority.yaml`, réparties en 18 catégories (banques françaises
  et internationales, plateformes crypto, gouvernement français, messagerie,
  GAFAM et tech, cloud, paiement, SaaS, communication, e-commerce, streaming,
  réseaux sociaux, sécurité, registrars DNS) ; 12 proviennent de
  `data/brands.csv`. Aucun doublon `(marque, domaine)`.
- Tables Unicode confondables et règles de suffixes publics réexportées
  (`schema_version` 1). Les fichiers `unicode.json` et
  `public_suffixes.json` sont inchangés octet pour octet ; seul
  `domains.json` change.

### Interface de l’extension

- Chaque signal affiche d’abord une explication en langage simple.
- Le libellé technique est disponible derrière le bouton
  « Voir les détails techniques » (`aria-expanded` mis à jour).
- Ajout des styles `reason-simple`, `reason-toggle`, `reason-details` et
  `tech-line` dans `theme.css`.

### Sécurité

- Le rendu repose uniquement sur des nœuds DOM et `textContent` : la
  construction HTML (`innerHTML`) des détails techniques a été retirée. Un nom
  d’hôte hostile reste du texte, ce que la suite de tests vérifie.
- Le build `--release` scanne désormais **tous les fichiers du paquet** à la
  recherche de valeurs de remplacement, et non plus seulement les manifestes.
  Un paquet contenant `example.invalid` ne peut plus être produit en release.

### Corrections

- `app/database.py` : la migration ne casse plus une base existante. Les index
  sont créés après l’ajout des colonnes, et `last_seen` / `first_seen` sont
  ajoutés comme colonnes nullables puis remplis depuis `updated_at`, car
  SQLite refuse un défaut non constant dans `ALTER TABLE … ADD COLUMN`.
- `data/brands-priority.yaml` : suppression d’un bloc `tech_gafam` dupliqué et
  mal indenté qui rendait le YAML invalide.
- `app/static/confidentialite.html` : adresse de contact réelle
  (`warsmox.dev@gmail.com`) et date de révision mise à jour.

### Empaquetage et outillage

- Version `0.1.1` dans `extension/manifest.json` et `extension/package.json`.
- Nouveau `scripts/update_extension.sh` : import des CSV et du YAML, export des
  jeux de données, suites Python et JavaScript, puis build Firefox. Il publie
  `release/<version>/` avec `url_safe-<version>-firefox.zip` (`manifest.json`
  à la racine) et `url_safe-<version>-source.zip` (instructions de build, script,
  dépendances verrouillées et entrées) pour la revue AMO.
- `pyyaml` ajouté aux dépendances, et `requirements-lock.txt` fige
  l’environnement exact utilisé pour le paquet soumis.
- `scripts/update_extension.sh` accepte `--version X.Y.Z` et
  `--bump patch|minor|major` : la version est écrite dans le manifeste et
  `package.json` avant le build, et le dossier `release/<version>/` est créé
  automatiquement.
- Documentation alignée sur les nouveaux comptes (10 domaines, 215 marques) et
  sur la version 0.1.1.

## 0.1.0 — 20 octobre 2026

- Première bêta privée : vérification locale d’une URL, fenêtre de l’extension,
  menu contextuel sur un lien, page d’options, actualisation facultative des
  listes.
- Registre minuscule : 7 domaines connus, 6 marques, aucun domaine malveillant.
- Version Firefox non répertoriée, identifiant Gecko `url-safe@url-safe.fr`.
