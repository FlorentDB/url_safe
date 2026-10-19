# Lien clair

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

## Limites

« Domaine répertorié » signifie uniquement qu’une entrée correspond dans la base locale. « Aucun signal local » ne signifie pas que le lien est sûr. La base fournie ne contient aucune liste de menaces; elle doit être alimentée depuis des sources fiables et actualisées avant tout usage réel.

Le navigateur envoie l’URL à ce serveur pour l’analyse, mais le serveur ne la récupère pas. Seul le nom d’hôte est recherché en base; aucune URL soumise n’est enregistrée ni renvoyée par l’API, dont les réponses sont marquées `no-store`.

## Déploiement public sur Raspberry Pi

Les exemples `deploy/lien-clair.service` et `deploy/Caddyfile.example` visent Raspberry Pi OS/Debian avec systemd. Ils ne sont pas appliqués au Pi depuis ce dépôt. Remplacer `example.net` dans les deux fichiers par le domaine réellement utilisé avant activation.

Architecture : Internet → ports TCP 80/443 du routeur → Caddy/TLS sur le Pi → Uvicorn sur `127.0.0.1:8000`. Ne pas transférer le port 8000 depuis le routeur. L’IP publique/DNS doit pointer vers le Pi, et le routeur doit transférer uniquement 80/443 vers lui. Le port SSH doit rester limité à un accès d’administration sûr.

Préparer le Pi : installer les mises à jour de sécurité du système et installer Python, `venv`, Caddy et `rsync` selon leurs instructions officielles. Créer un utilisateur système `urlsafe`; copier le code sans le venv local ni la base; créer l’environnement Python **sur le Pi** (ne pas copier le `.venv` d’un PC d’une autre architecture); installer `requirements.txt`; remplacer le domaine d’exemple dans les deux modèles; puis installer et démarrer le service :

```bash
sudo install -d -o root -g root -m 0755 /opt/lien-clair
sudo install -d -o root -g root -m 0755 /opt/lien-clair/data /opt/lien-clair/deploy
sudo useradd --system --no-create-home --shell /usr/sbin/nologin urlsafe
sudo rsync -a --delete --exclude='.venv' --exclude='__pycache__' --exclude='*.sqlite3' app/ /opt/lien-clair/app/
sudo rsync -a --delete data/*.csv /opt/lien-clair/data/
sudo rsync -a deploy/ /opt/lien-clair/deploy/
sudo install -m 0644 requirements.txt /opt/lien-clair/requirements.txt
sudo python3 -m venv /opt/lien-clair/.venv
sudo /opt/lien-clair/.venv/bin/pip install -r /opt/lien-clair/requirements.txt
sudoedit /opt/lien-clair/deploy/lien-clair.service
sudoedit /opt/lien-clair/deploy/Caddyfile.example
sudo install -m 0644 /opt/lien-clair/deploy/lien-clair.service /etc/systemd/system/lien-clair.service
sudo install -m 0644 /opt/lien-clair/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo systemd-analyze verify /etc/systemd/system/lien-clair.service
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl daemon-reload
sudo systemctl enable --now lien-clair
sudo systemctl reload caddy
sudo systemctl status lien-clair caddy
```

`StateDirectory` crée `/var/lib/lien-clair` avec les permissions du compte de service; c’est là que SQLite écrit. Caddy obtient/renouvelle le certificat automatiquement si le DNS public pointe vers le routeur, que les ports 80/443 y sont transférés au Pi, et que le FAI autorise les connexions entrantes. Si le réseau est derrière CGNAT ou bloque ces ports, il faudra un reverse tunnel ou un VPS relais au lieu d’exposer Uvicorn.

Le service démarre **un seul worker** : le rate limit SlowAPI est en mémoire par processus. Uvicorn ne fait confiance aux en-têtes proxy que depuis `127.0.0.1`. Si l’on ajoute plusieurs workers ou plusieurs instances, remplacer ce limiteur par un stockage partagé avant déploiement. Conserver des sauvegardes de `/var/lib/lien-clair` et tester les restaurations.

Les protections applicatives incluent une limite de corps de 4 Kio, un plafond de 30 vérifications/minute/IP par défaut, `TrustedHostMiddleware`, des en-têtes CSP et la désactivation de `/docs` en production. Le rate limit ne protège pas d’un déni de service réseau volumétrique : utiliser aussi les protections du routeur/hébergeur. L’API reste publique et n’a pas d’authentification; Caddy ne doit pas exposer directement Uvicorn.

Après chaque mise à jour : sauvegarder la base, mettre à jour le code et les dépendances sur le Pi, redémarrer `lien-clair`, vérifier les journaux (`journalctl -u lien-clair`) et le endpoint, puis conserver un retour arrière du code et de la base. Ne jamais lancer l’import Tranco au démarrage du service; exécuter la commande d’import explicitement.

Après ouverture depuis un réseau extérieur, vérifier `https://<ton-domaine>/`, confirmer que `/docs` répond 404 et contrôler les en-têtes/rate limits. Ne pas lancer de scan actif contre l’IP publique sans vérifier que tu contrôles la cible et que l’essai est autorisé.