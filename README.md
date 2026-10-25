# url_safe

Extension Firefox (Manifest V3) qui examine une adresse à la demande, sans
ouvrir le lien et sans l’envoyer à un serveur. L’analyse est faite sur
l’appareil : format de l’URL, caractères ressemblants, imitation d’une marque
répertoriée, suffixes publics.

## Contenu du dépôt

```text
extension/
  manifest.json        manifeste source (forme Chrome, converti pour Firefox)
  src/core/            analyse d’URL, Unicode, marques, suffixes publics
  src/shared/          chargement des données, rendu, réglages
  src/popup/           fenêtre de l’extension
  src/result/          page de résultat du menu contextuel
  src/options/         options et actualisation facultative
  src/data/            jeux de données embarqués (générés)
  data/                sources CSV et YAML des registres
  scripts/             build, icônes, export des données
  test/                suites Node et vecteurs de verdicts
scripts/
  update_extension.sh  export, tests, build et dossier release/
```

## Prérequis

- Python 3.11 ou plus, avec `pip` : génération des données et des icônes.
- Node.js 20 ou plus, avec `npm` : tests et empaquetage.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## Données

Les registres de démonstration sont dans `extension/data/domains.csv` et
`extension/data/brands.csv` ; les marques prioritaires dans
`extension/data/brands-priority.yaml`. Ce ne sont pas des listes de menaces
maintenues.

```bash
python3 extension/scripts/export_datasets.py
```

écrit `extension/src/data/domains.json`, `unicode.json` et
`public_suffixes.json`. Les tables Unicode viennent de
`confusable-homoglyphs`, les suffixes publics du snapshot livré par
`tldextract`.

## Tester et construire

```bash
cd extension
npm test
npm run build:firefox
```

Depuis la racine, la séquence complète :

```bash
bash scripts/update_extension.sh
```

Elle exporte les données, lance les 43 tests, construit le paquet et publie
`release/<version>/` :

- `url_safe-<version>-firefox.zip` : le paquet, `manifest.json` à la racine ;
- `url_safe-<version>-source.zip` : l’archive source pour AMO.

## Nouvelle version

```bash
bash scripts/update_extension.sh --bump patch    # 0.1.2 -> 0.1.3
bash scripts/update_extension.sh --version 0.2.0
```

Le numéro est écrit dans `extension/manifest.json` et `extension/package.json`
avant le build. Compléter ensuite `release/<version>/AMO-RELEASE-NOTES.txt`.

## Limites

« Domaine répertorié » signifie qu’une entrée correspond dans la base locale.
« Aucun signal local » ne signifie pas que le lien est sûr. Les listes
fournies sont des graines éditoriales : un résultat est un indice, jamais une
garantie.
