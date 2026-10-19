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

L’installateur crée un utilisateur système non privilégié `urlsafe`, lance Uvicorn sur `127.0.0.1:8000`, configure Nginx en reverse proxy et écrit SQLite sous `/var/lib/lien-clair`. Il importe aussi le Top 10 000 Tranco; utiliser `--skip-tranco` pour sauter cette étape ou `--tranco-limit 100000` pour en importer davantage.

Le script n’ouvre pas de ports lui-même et ne fournit pas de défense DDoS. Le service utilise un seul worker car le rate limit applicatif est en mémoire. Sauvegarder `/var/lib/lien-clair`, maintenir le Pi à jour et consulter les journaux avec `journalctl -u lien-clair`. Pour contrôler le déploiement public, vérifier `https://<ton-domaine>/`, confirmer que `/docs` répond 404 et ne scanner l’IP publique que si tu contrôles la cible.

`deploy/lien-clair.service` est le modèle systemd installé par le script. `deploy/Caddyfile.example` est un exemple alternatif manuel; l’installateur utilise Nginx.