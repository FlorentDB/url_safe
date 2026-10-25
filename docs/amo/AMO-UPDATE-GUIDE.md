# Mettre à jour url_safe sur AMO — version {{VERSION}}

## 1. Ce que fait `update_extension.sh`, et ce qu’il ne fait pas

`bash scripts/update_extension.sh` travaille **uniquement en local** :

1. il exporte les jeux de données depuis `extension/data/` vers
   `extension/src/data/` (`python3 extension/scripts/export_datasets.py`) ;
2. il lance les 43 tests JavaScript (`npm test`) ;
3. il construit le paquet Firefox (`npm run build:firefox`) ;
4. il publie `release/{{VERSION}}/` avec `{{FIREFOX_ZIP}}` (`manifest.json` à
   la racine), `{{SOURCE_ZIP}}`, `firefox-package/` et les documents.

Il ne contacte ni AMO ni les utilisateurs. La mise à jour ne devient réelle
qu’après le téléversement sur AMO, la validation, la signature, puis la
distribution du `.xpi` signé.

## 2. Fichiers à utiliser

| Fichier | Usage |
|---|---|
| `{{FIREFOX_ZIP}}` | **Paquet de l’extension** : champ « Upload New Version ». `manifest.json` à sa racine. |
| `{{SOURCE_ZIP}}` | **Archive source** : section « Source code » de la soumission. |
| `AMO-SOURCE-REVIEW-NOTES.txt` | Texte à coller dans les notes du relecteur. |
| `AMO-SOURCE-README.md` | Instructions de build détaillées (aussi dans l’archive source). |
| `firefox-package/` | Contenu décompressé, pour inspection ou chargement temporaire. |
| `AMO-RELEASE-NOTES.txt` | Texte à coller dans le champ « Release notes ». |
| `CHANGELOG.md` | Journal détaillé des changements. |
| `LISTING-FR.md` | Textes de fiche, permissions et déclaration de données. |

Deux ZIP, deux champs distincts. N’envoyez jamais l’archive source comme paquet.

## 3. Avant de téléverser

- [ ] La version est bien `{{VERSION}}`, supérieure à la version déjà signée.
- [ ] `{{FIREFOX_ZIP}}` contient `manifest.json` à sa racine.
- [ ] `{{SOURCE_ZIP}}` contient `AMO-SOURCE-README.md`, `requirements.txt`,
      `requirements-lock.txt` et `scripts/update_extension.sh`.
- [ ] `AMO-RELEASE-NOTES.txt` est complété (plus le texte par défaut).
- [ ] `sha256sum -c SHA256SUMS.txt` ne signale aucune erreur.
- [ ] L’identifiant Gecko est resté `url-safe@url-safe.fr`.

Contrôle rapide du manifeste :

```sh
unzip -p {{FIREFOX_ZIP}} manifest.json | grep '"version"'
```

Attendu : `"version": "{{VERSION}}"`.

## 4. Procédure sur AMO

1. Se connecter au tableau de bord :
   <https://addons.mozilla.org/developers/>.
2. Ouvrir **My Add-ons**, puis l’extension `url_safe (Bêta)` existante.
   Ne créez pas une nouvelle fiche : vous perdriez l’identité et les
   installations des versions précédentes.
3. Cliquer **Upload New Version** (ou **New version**).
4. Sélectionner **`{{FIREFOX_ZIP}}`**.
5. Coller le contenu de `AMO-RELEASE-NOTES.txt` dans **Release notes**.
6. À la question sur le code généré, minifié ou obfusqué : répondre **oui**,
   car les données embarquées et les icônes sont produites par des scripts.
   Joindre `{{SOURCE_ZIP}}` dans la section « Source code », puis coller
   `AMO-SOURCE-REVIEW-NOTES.txt` dans les notes du relecteur.
7. Vérifier la compatibilité affichée : Firefox 140 minimum, Firefox pour
   Android 142 minimum.
8. Lancer la validation. Corriger les erreurs bloquantes ; lire les
   avertissements.
9. Soumettre pour signature, en conservant la distribution choisie
   précédemment (non répertoriée / self-distribution, sauf décision contraire).
10. Une fois la signature terminée, télécharger le `.xpi` signé depuis la page
    de la version soumise.

## 5. Après la signature

- **Distribution non répertoriée / self-distribution :** Firefox ne met pas
  l’extension à jour automatiquement. Envoyez le nouveau `.xpi` signé aux
  testeurs, qui l’installent par `about:addons` → roue dentée →
  **Installer un module complémentaire à partir d’un fichier**.
- **Fiche publique :** AMO sert la mise à jour aux navigateurs ; la nouvelle
  version apparaît automatiquement après signature.

Vérifications après installation :

- [ ] La version affichée dans `about:addons` est `{{VERSION}}`.
- [ ] La fenêtre de l’extension analyse une URL et affiche un verdict.
- [ ] Le clic droit sur un lien propose « Vérifier avec url_safe ».
- [ ] « Voir les détails techniques » déplie et replie les détails.
- [ ] Une marque récente du registre est reconnue (par exemple
      `bnpparibas-login.example` doit être signalé comme ressemblant à une
      marque).
- [ ] `about:addons` ne montre aucune erreur dans la console de l’extension.

## 6. Pour la prochaine mise à jour

`update_extension.sh` ne change pas le numéro de version sans option. Pour
publier une nouvelle version :

```bash
bash scripts/update_extension.sh --bump patch   # {{VERSION}} -> patch suivant
bash scripts/update_extension.sh --bump minor
bash scripts/update_extension.sh --version X.Y.Z
```

Le script écrit la version dans `extension/manifest.json` et
`extension/package.json`, puis crée `release/<version>/`. Complétez ensuite
`release/<version>/AMO-RELEASE-NOTES.txt` et téléversez les deux archives du
nouveau dossier.

## 7. Retour arrière

AMO conserve les versions précédentes. Pour revenir en arrière sur une
distribution non répertoriée, rediffusez le `.xpi` précédent déjà signé. Un
numéro déjà signé ne peut pas être re-téléversé : une correction impose une
version supérieure.
