url_safe {{VERSION}} — dossier de publication AMO
=================================================

Fichiers à envoyer sur AMO
--------------------------
  {{FIREFOX_ZIP}}   Champ « Upload New Version » : le paquet de l’extension.
                    manifest.json est à la racine de cette archive.
  {{SOURCE_ZIP}}    Section « Source code » : archive source complète, avec le
                    README de build et le script de construction.

Deux ZIP, deux champs distincts. N’envoyez jamais l’archive source dans
« Upload New Version ».

Contenu du dossier
------------------
  {{FIREFOX_ZIP}}   Paquet de l’extension, prêt à signer.
  {{SOURCE_ZIP}}    Archive source pour la revue AMO.
  firefox-package/  Paquet décompressé, manifest.json à la racine.
  AMO-SOURCE-README.md         Instructions de build complètes.
  AMO-SOURCE-REVIEW-NOTES.txt  Texte à coller dans les notes du relecteur.
  AMO-RELEASE-NOTES.txt        Texte à coller dans « Release notes ».
  CHANGELOG.md                 Journal des changements.
  AMO-UPDATE-GUIDE.md          Procédure de mise à jour, étape par étape.
  LISTING-FR.md                Textes de fiche AMO.
  SHA256SUMS.txt               Empreintes des fichiers de ce dossier.
  README.txt                   Ce fichier.

Rappels
-------
1. update_extension.sh ne publie rien : il reconstruit le paquet en local. La
   mise à jour n’atteint les utilisateurs qu’après l’envoi à AMO et la
   signature.
2. La version doit être strictement supérieure à la version déjà signée.
3. Ne modifiez jamais un paquet déjà signé : reconstruisez une version
   supérieure.
4. Conservez l’identifiant Gecko `url-safe@url-safe.fr`.
5. Pour une distribution non répertoriée, Firefox ne met pas l’extension à jour
   tout seul : partagez le nouveau .xpi signé avec vos testeurs.

Vérifier avant envoi
--------------------
  sha256sum -c SHA256SUMS.txt

  unzip -l {{FIREFOX_ZIP}} | head -5
  # la première entrée doit être manifest.json

  unzip -l {{SOURCE_ZIP}} | head
  # doit contenir AMO-SOURCE-README.md, requirements.txt,
  # requirements-lock.txt et scripts/update_extension.sh
