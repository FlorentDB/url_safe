# url_safe

Prototype local pour examiner une URL sans l’ouvrir. Le service analyse son format, son nom d’hôte et une petite base SQLite. Il ne visite pas la destination et ne conserve pas les URL soumises.

## Démarrer

```bash
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Ouvrir <http://127.0.0.1:8000>.

## Base de domaines

La base SQLite est créée dans `data/url_safe.sqlite3`. Le fichier `data/domains.csv` contient une petite sélection de démonstration, notamment des domaines réservés aux exemples et des domaines populaires; ce n’est pas une liste de sûreté.

Le CSV doit contenir `hostname,status,source`. Les valeurs de `status` acceptées sont `known` et `malicious`.

```bash
.venv/bin/python -m app.import_domains data/domains.csv
```

La comparaison est exacte sur le nom d’hôte normalisé. Une entrée `example.com` ne valide pas automatiquement `login.example.com`.

`data/brands.csv` est un registre séparé des domaines de marques, utilisé pour détecter les ressemblances typographiques. Le prototype signale une distance Damerau-Levenshtein d’un caractère pour les noms de marque d’au moins six caractères, ainsi qu’un domaine officiel placé sous le domaine contrôlant d’un autre site. La liste est une graine éditoriale à vérifier, pas une source certifiée.

Les données `confusable-homoglyphs` dérivées des tables de confusables Unicode servent à repérer les mélanges d’alphabets et à comparer, caractère par caractère, un libellé de marque et ses homoglyphes. Cette vérification ne constitue pas une implémentation complète du skeleton UTS #39 : elle ne couvre pas les substitutions de longueurs différentes ni l’ensemble des règles bidi. Elle signale un indice, pas une fraude confirmée.

```bash
.venv/bin/python -m app.import_domains data/brands.csv --brands
```

Une ressemblance signifie « imitation possible », pas fraude confirmée. Les ressemblances de plusieurs caractères et les marques absentes du registre ne sont pas détectées par cette règle.

## Popularité Tranco

Le rang Tranco est un signal de popularité uniquement; il ne rend pas un domaine fiable et ne change pas sa classification. Aucun téléchargement n’est effectué au démarrage. Pour importer le Top 10 000 du dernier snapshot, exécuter :

```bash
.venv/bin/python -m app.import_tranco
```

Utiliser `--limit 100000` pour importer un Top 100 000. L’import récupère l’identifiant du snapshot puis son ZIP depuis `tranco-list.eu`, et conserve l’identifiant, le rang et la date d’import dans SQLite. Chaque import remplace le snapshot courant tout en conservant les anciens snapshots pour reproduire les résultats. Vérifier les conditions de licence des données agrégées avant une redistribution ou un usage commercial.

## L’extension navigateur

L’extension reprend les mêmes règles en JavaScript et vérifie **entièrement sur l’appareil**. Elle n’interroge aucun serveur, n’insère aucun script dans les pages et ne lit pas l’historique de navigation.

Deux entrées, toutes deux déclenchées volontairement :

- l’icône de la barre d’outils ouvre une fenêtre où l’on colle une adresse ;
- un clic droit sur un lien propose « Vérifier avec url_safe », et le verdict s’ouvre dans un onglet.

Les listes de domaines, de marques, de caractères confondables et de suffixes publics sont installées avec l’extension. Elles peuvent être actualisées depuis la page d’options, ce qui demande alors l’autorisation pour cet hôte seul ; tant que cette fonction n’est pas utilisée, l’extension ne joint aucun serveur.

### Construire

```bash
cd extension
npm test          # les suites JavaScript
npm run build     # extension/dist/url_safe-0.1.0-chrome.zip et -firefox.zip
```

Pour installer une version locale, décompresser l’archive puis charger le dossier `manifest.json` depuis la page des extensions du navigateur.

### Faire évoluer les règles

Les règles existent en double, en Python dans `app/` et en JavaScript dans `extension/src/core/`. Les deux versions sont tenues synchronisées par un fichier de vecteurs de test commun, `shared/vectors/verdicts.json` : changer une règle d’un côté sans l’autre fait échouer la suite de l’autre côté.

```bash
.venv/bin/python -m app.export_vectors   # régénérer les vecteurs, puis relire le diff
.venv/bin/python -m app.export_datasets  # réexporter les listes pour l’extension
```

## Limites

« Domaine répertorié » signifie uniquement qu’une entrée correspond dans la base locale. « Aucun signal local » ne signifie pas que le lien est sûr. La base fournie ne contient aucune liste de menaces; elle doit être alimentée depuis des sources fiables et actualisées avant tout usage réel.

Le navigateur envoie l’URL à ce serveur pour l’analyse, mais le serveur ne la récupère pas. Seul le nom d’hôte est recherché en base; aucune URL soumise n’est enregistrée ni renvoyée par l’API, dont les réponses sont marquées `no-store`.

## Déploiement Render (démo gratuite)

Le fichier `render.yaml` décrit un service Render gratuit, hébergé dans la région de Francfort. Pour le publier :

1. Pousser le dépôt sur GitHub.
2. Dans Render, choisir **New > Blueprint**, connecter le dépôt et confirmer la création du service `url-safe`.
3. Ouvrir l’adresse `onrender.com` attribuée au service.

Aucune redirection de port sur la box n’est nécessaire. Render fournit HTTPS. Le nom `url-safe.onrender.com` est indicatif : Render peut attribuer un autre sous-domaine s’il est déjà pris.

**Cette configuration est pour une démonstration, pas pour un service de production.** Render suspend une instance gratuite après 15 minutes sans requête; son réveil peut prendre environ une minute. Son système de fichiers est éphémère : la base SQLite locale peut être perdue lors d’une mise en veille, d’un redémarrage ou d’un redéploiement. L’application la recrée alors à partir des CSV de démonstration; les imports Tranco ne sont pas persistants. Render indique que ses offres gratuites ne sont pas destinées à la production. Vérifier les limites et tarifs actuels avant de publier.

Le site envoie le texte de l’URL au serveur pour l’analyse. Render termine HTTPS à son infrastructure et traite donc la requête; ne soumettre aucune adresse contenant un mot de passe, un jeton ou une autre information confidentielle. La page de confidentialité distingue maintenant le site de l’extension, qui vérifie localement.

Le domaine personnalisé peut être ajouté après l’achat : l’ajouter dans les réglages du service Render, configurer les enregistrements DNS demandés par Render, puis ajouter ce nom à `URLSAFE_ALLOWED_HOSTS`. Render émet et renouvelle le certificat TLS.

Pour un service toujours disponible, il faudra passer à une offre payante avec stockage persistant, ou faire évoluer l’application vers une base de données partagée. SQLite sur disque persistant convient à une seule instance; la montée en charge sur plusieurs instances nécessite aussi de remplacer la limitation de débit en mémoire par un stockage partagé.

## Installation Raspberry Pi

Exécuter les commandes **dans un terminal du Raspberry Pi**, pas sur le PC. Le Pi doit utiliser Raspberry Pi OS/Debian avec systemd; le script installe Nginx, les dépendances Python, le service systemd et SQLite.

Depuis la racine du dépôt déjà cloné :

```bash
sudo bash deploy/setup-pi.sh
```

Le script demande un domaine public. Laisser le champ vide configure le mode LAN sans ouvrir de port sur la box. Pour le mode LAN sans question :

```bash
sudo bash deploy/setup-pi.sh --lan-only
```

En mode public, préparer d’abord un nom de domaine dont le DNS pointe vers ta connexion publique et transférer TCP 80 et 443 vers le Pi. Puis lancer :

```bash
sudo bash deploy/setup-pi.sh --domain liens.example.net --email admin@example.net
```

Le script installe Certbot et demande automatiquement un certificat Let's Encrypt. Il ne configure pas le DNS, le routeur ou le pare-feu et ne contourne pas le CGNAT. Si le certificat ne peut pas être obtenu, le site reste fermé derrière une réponse 503; corrige le DNS/transfert puis relance le script. **Ne transfère jamais le port 8000.**

L’installateur crée un utilisateur système non privilégié `urlsafe`, installe le service `url_safe`, lance Uvicorn sur `127.0.0.1:8000`, configure Nginx en reverse proxy et écrit SQLite sous `/var/lib/url_safe`. Le code est installé sous `/opt/url_safe`. Il importe aussi le Top 10 000 Tranco; utiliser `--skip-tranco` pour sauter cette étape ou `--tranco-limit 100000` pour en importer davantage.

Le script n’ouvre pas de ports lui-même et ne fournit pas de défense DDoS. Le service utilise un seul worker car le rate limit applicatif est en mémoire. Sauvegarder `/var/lib/url_safe`, maintenir le Pi à jour et consulter les journaux avec `journalctl -u url_safe`. Pour contrôler le déploiement public, vérifier `https://<ton-domaine>/`, confirmer que `/docs` répond 404 et ne scanner l’IP publique que si tu contrôles la cible.

`deploy/url_safe.service` est le modèle systemd installé par le script. `deploy/Caddyfile.example` est un exemple alternatif manuel; l’installateur utilise Nginx.