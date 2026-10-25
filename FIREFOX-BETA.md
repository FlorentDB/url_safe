# Bêta Firefox de url_safe

La version bêta est destinée à un petit groupe de proches. Elle vérifie les URL localement, mais son registre intégré reste une graine éditoriale : 10 domaines (7 connus et 3 entrées malveillantes de démonstration) et 215 marques. Ce n’est pas une protection anti-phishing complète. Un résultat sans alerte ne garantit pas qu’un site est sûr.

## Informations de l’extension

- Nom affiché : `url_safe (Bêta)`
- Éditeur : `warsmox`
- Contact : `warsmox.dev@gmail.com`
- Version : `0.1.1`
- Identifiant Gecko demandé : `url-safe@url-safe.fr`
- Distribution recommandée : non répertoriée (AMO signe l’extension sans la publier dans le catalogue)

L’identifiant respecte le format Mozilla `nom@domaine`; il ne crée pas une boîte mail et le domaine n’a pas à être configuré pour envoyer des courriels. AMO doit toutefois confirmer qu’il est disponible. Une fois signé, ne le change plus.

## Tester dans Firefox sans publication

Le mode temporaire est idéal pour tester l’interface avant l’envoi à AMO :

1. Depuis la racine du dépôt, lancer `cd extension && npm test && npm run build:firefox`.
2. Ouvrir `about:debugging#/runtime/this-firefox` dans Firefox.
3. Cliquer **Charger un module complémentaire temporaire…**.
4. Sélectionner `extension/dist/firefox/manifest.json`.
5. Ouvrir le menu des extensions, épingler url_safe si nécessaire, puis tester la fenêtre et le menu contextuel par clic droit sur un lien.

Le module temporaire disparaît au redémarrage de Firefox. Pour l’essai à long terme par les proches, il faut obtenir le paquet signé d’AMO.

## Soumettre à AMO en bêta non répertoriée

1. Se connecter au [tableau de bord développeur AMO](https://addons.mozilla.org/developers/). Créer le compte avec une adresse que tu consultes. La soumission doit être faite depuis ton compte; ne partage pas son mot de passe.
2. Construire le paquet dédié Firefox avec `npm run build:firefox` depuis `extension/`. Le fichier à téléverser est `extension/dist/url_safe-0.1.1-firefox.zip`.
3. Dans AMO, créer un nouveau module complémentaire et téléverser ce ZIP.
4. Choisir la distribution **non répertoriée / self-distribution**. Répondre honnêtement aux questions sur code source, collecte et transmission des données.
5. Utiliser les textes de fiche ci-dessous. Garder visible le statut bêta et les limites du registre.
6. Lire les avertissements du validateur, corriger les erreurs bloquantes, puis envoyer la version à la signature.
7. Suivre l’état dans **My Submissions** et dans l’e-mail associé au compte.
8. Après signature, télécharger le `.xpi` signé depuis la version soumise et le transmettre aux testeurs.

AMO peut vérifier aussi les modules non répertoriés. Les mises à jour ne seront pas automatiquement distribuées comme pour une fiche AMO publique : pour chaque nouvelle version, augmente le numéro de version, reconstruis, fais signer et partage le nouveau `.xpi`.

## Texte de fiche AMO

**Résumé**

`Bêta — Examine certains indices d’URL localement. Les listes sont limitées; un résultat sans alerte ne garantit pas qu’un site est sûr.`

**Description**

`VERSION BÊTA — Cette extension est expérimentale et destinée à un petit groupe de testeurs.`

`Collez une adresse dans la fenêtre de url_safe ou faites un clic droit sur un lien et choisissez « Vérifier avec url_safe ». L’extension analyse l’adresse sur votre appareil et ne l’ouvre pas.`

`Elle signale certains indices possibles : format d’URL inhabituel, caractères ressemblants ou ressemblance avec l’une des marques de sa petite liste intégrée. Cette liste contient seulement quelques domaines connus et marques de démonstration; elle n’est pas une base de données de sites malveillants et n’est pas mise à jour automatiquement.`

`Le résultat est un indice, pas une garantie. Un site répertorié peut être compromis; un site inconnu peut être parfaitement légitime. Vérifiez l’adresse et n’ouvrez le site que si vous le jugez sûr.`

`Par défaut, l’extension ne contacte aucun serveur et n’envoie pas les URL examinées. Une mise à jour distante des listes est facultative. Si vous l’activez, l’hôte HTTPS que vous choisissez reçoit une requête de téléchargement et peut voir votre adresse IP. Firefox demande une autorisation distincte pour ces données techniques; vous pouvez la refuser ou la retirer.`

## Permissions à justifier

| Permission | Justification proposée |
|---|---|
| `storage` | Enregistrer sur l’appareil le choix facultatif d’hôte de données et les listes téléchargées, afin que la configuration et le cache soient conservés entre les utilisations. |
| `contextMenus` | Ajouter « Vérifier avec url_safe » au menu contextuel des liens, uniquement après le clic droit volontaire de la personne. |
| `alarms` | Programmer l’actualisation facultative quotidienne, uniquement si un hôte de données est configuré et si l’option est activée. |
| Hôte HTTPS facultatif | Accès demandé seulement après que la personne a fourni l’hôte HTTPS et demandé l’actualisation des listes. Aucun hôte n’est autorisé à l’installation. |
| `technicalAndInteraction` facultatif (Firefox) | Autoriser, seulement après consentement Firefox, l’envoi de requêtes de téléchargement à l’hôte configuré. Cet hôte peut voir l’adresse IP; l’URL examinée n’est jamais incluse. |

**Déclaration de données Firefox :** le manifeste demande `none` en requis et `technicalAndInteraction` en option. Sur Firefox, l’actualisation exige le consentement à cette donnée technique et une permission distincte pour l’origine HTTPS. Le consentement technique se retire depuis la même page d’options. Si l’un des consentements manque, la fonction d’actualisation ne doit pas envoyer de requête.

## Politique de confidentialité

La politique complète est incluse dans le paquet et accessible depuis les options de l’extension, même hors ligne. Son fichier source est `app/static/confidentialite.html`. Pour une fiche de boutique qui exige une URL publique, publier ce document avant la soumission et remplacer cette note par l’URL réelle. Le dépôt n’étant pas configuré ici comme site public, ne pas inventer une URL GitHub Pages.

## Capture d’écran et suivi

Préparer une capture authentique de la fenêtre url_safe et une autre du résultat bêta. Ne pas présenter l’interface de façon à faire croire que la liste est exhaustive.

- Tableau de bord et signatures : [AMO Developer Hub](https://addons.mozilla.org/developers/).
- Soumissions et validation : section **My Submissions**.
- Courriels d’AMO et retour des testeurs : `warsmox.dev@gmail.com`.

Chrome est volontairement en pause. Ne pas envoyer le paquet Chrome tant que la bêta Firefox n’a pas été testée.
