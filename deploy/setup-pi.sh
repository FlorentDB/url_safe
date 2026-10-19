#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="url_safe"
APP_USER="urlsafe"
APP_DIR="/opt/url_safe"
STATE_DIR="/var/lib/url_safe"
CONFIG_DIR="/etc/url_safe"
NGINX_SITE="/etc/nginx/sites-available/url_safe"
NGINX_ENABLED="/etc/nginx/sites-enabled/url_safe"
NGINX_RATE_LIMIT="/etc/nginx/conf.d/url_safe-rate-limit.conf"
ACME_ROOT="/var/www/letsencrypt"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

DOMAIN=""
EMAIL=""
LAN_ONLY=0
SKIP_TRANCO=0
TRANCO_LIMIT=10_000

usage() {
    cat <<'EOF'
Usage:
  sudo bash deploy/setup-pi.sh --lan-only
  sudo bash deploy/setup-pi.sh --domain app.example.net --email admin@example.net

Options:
  --lan-only             Serve HTTP on the local network; no router ports are opened.
  --domain DOMAIN        Public hostname; requires DNS and router forwarding for TCP 80/443.
  --email EMAIL          Contact address for Let's Encrypt.
  --skip-tranco          Skip the initial Tranco Top 10,000 import.
  --tranco-limit NUMBER  Number of Tranco rows to import (default: 10000).
  -h, --help             Show this help.

With no mode option, the installer asks whether to configure LAN-only or public HTTPS.
EOF
}

fail() {
    printf 'Erreur: %s\n' "$1" >&2
    exit 1
}

while (($#)); do
    case "$1" in
        --lan-only)
            LAN_ONLY=1
            shift
            ;;
        --domain)
            (($# >= 2)) || fail "--domain nécessite un nom d’hôte."
            DOMAIN="$2"
            shift 2
            ;;
        --email)
            (($# >= 2)) || fail "--email nécessite une adresse."
            EMAIL="$2"
            shift 2
            ;;
        --skip-tranco)
            SKIP_TRANCO=1
            shift
            ;;
        --tranco-limit)
            (($# >= 2)) || fail "--tranco-limit nécessite un nombre."
            TRANCO_LIMIT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage >&2
            fail "Option inconnue: $1"
            ;;
    esac
done

[[ -f "$PROJECT_ROOT/app/main.py" && -f "$PROJECT_ROOT/requirements.txt" ]] \
    || fail "Lance ce script depuis le dépôt cloné Lien clair."
[[ $EUID -eq 0 ]] || fail "Lance avec sudo: sudo bash deploy/setup-pi.sh"
[[ -d /run/systemd/system ]] || fail "Ce script nécessite systemd (Raspberry Pi OS ou Debian)."

if ((LAN_ONLY)) && [[ -n "$DOMAIN" ]]; then
    fail "Choisis --lan-only ou --domain, pas les deux."
fi

if ((!LAN_ONLY)) && [[ -z "$DOMAIN" ]]; then
    read -r -p "Nom de domaine public (laisser vide pour LAN uniquement): " DOMAIN
    if [[ -z "$DOMAIN" ]]; then
        LAN_ONLY=1
    fi
fi

if ((!LAN_ONLY)); then
    [[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ && "$DOMAIN" == *.* && "$DOMAIN" != *..* ]] \
        || fail "Le domaine doit être un nom DNS ASCII complet, sans protocole ni chemin."
    if [[ -z "$EMAIL" ]]; then
        read -r -p "Adresse e-mail pour les avis de certificat Let's Encrypt: " EMAIL
    fi
    [[ "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] \
        || fail "Une adresse e-mail valide est requise en mode public."
fi

[[ "$TRANCO_LIMIT" =~ ^[0-9]+$ ]] \
    && ((TRANCO_LIMIT >= 1 && TRANCO_LIMIT <= 1000000)) \
    || fail "--tranco-limit doit être compris entre 1 et 1000000."

if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    [[ "${ID:-}" == "debian" || "${ID_LIKE:-}" == *debian* ]] \
        || fail "Système non pris en charge: Raspberry Pi OS ou Debian est requis."
fi

printf '\n== Installation système ==\n'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates nginx python3 python3-venv rsync
if ((!LAN_ONLY)); then
    apt-get install -y certbot
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /nonexistent --no-create-home \
        --shell /usr/sbin/nologin "$APP_USER"
fi

install -d -o root -g root -m 0755 "$APP_DIR"
install -d -o root -g root -m 0755 "$APP_DIR/app" "$APP_DIR/data"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$STATE_DIR"
install -d -o root -g root -m 0755 "$CONFIG_DIR"

rsync -a --delete \
    --exclude='__pycache__/' \
    --exclude='*.py[cod]' \
    "$PROJECT_ROOT/app/" "$APP_DIR/app/"
rsync -a --delete \
    --exclude='*.sqlite3' \
    "$PROJECT_ROOT/data/" "$APP_DIR/data/"
install -m 0644 "$PROJECT_ROOT/requirements.txt" "$APP_DIR/requirements.txt"
install -m 0644 "$SCRIPT_DIR/url_safe.service" "/etc/systemd/system/${APP_NAME}.service"

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/python" -m pip install --upgrade pip
"$APP_DIR/.venv/bin/pip" install --requirement "$APP_DIR/requirements.txt"
chown -R root:root "$APP_DIR"
chmod 0755 "$APP_DIR" "$APP_DIR/app" "$APP_DIR/data" "$APP_DIR/.venv"

if ((LAN_ONLY)); then
    PI_HOST="$(hostname -s)"
    PI_IP="$(hostname -I | awk '{print $1}')"
    SERVER_NAME="_"
    ALLOWED_HOSTS="${PI_HOST},${PI_HOST}.local,${PI_IP},localhost,127.0.0.1"
    NGINX_HTTP_BLOCK=$(cat <<'NGINX'
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
NGINX
)
else
    SERVER_NAME="$DOMAIN"
    ALLOWED_HOSTS="$DOMAIN,localhost,127.0.0.1"
    NGINX_HTTP_BLOCK=$(cat <<NGINX
    location ^~ /.well-known/acme-challenge/ {
        root $ACME_ROOT;
        default_type text/plain;
    }
    location / {
        return 503;
    }
NGINX
)
    install -d -o www-data -g www-data -m 0755 "$ACME_ROOT"
fi

cat > "$CONFIG_DIR/url_safe.env" <<EOF
URLSAFE_ENV=production
URLSAFE_ALLOWED_HOSTS=$ALLOWED_HOSTS
URLSAFE_RATE_LIMIT=30/minute
URLSAFE_DB_PATH=$STATE_DIR/url_safe.sqlite3
PYTHONDONTWRITEBYTECODE=1
EOF
chmod 0640 "$CONFIG_DIR/url_safe.env"
chown root:"$APP_USER" "$CONFIG_DIR/url_safe.env"

printf '\n== Configuration Nginx ==\n'
if [[ -e /etc/nginx/sites-enabled/default || -L /etc/nginx/sites-enabled/default ]]; then
    mv /etc/nginx/sites-enabled/default \
        "/etc/nginx/sites-available/default.disabled.$(date +%s)"
fi

cat > "$NGINX_RATE_LIMIT" <<'NGINX'
limit_req_zone $binary_remote_addr zone=url_safe_api:10m rate=30r/m;
NGINX

if ((LAN_ONLY)); then
    cat > "$NGINX_SITE" <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $SERVER_NAME;
    server_tokens off;
    client_max_body_size 4k;

    location = /api/check {
        limit_req zone=url_safe_api burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
else
    cat > "$NGINX_SITE" <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOMAIN;
    server_tokens off;

    location ^~ /.well-known/acme-challenge/ {
        root $ACME_ROOT;
        default_type text/plain;
    }
    location / {
        return 503;
    }
}
NGINX
fi

ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if ((!LAN_ONLY)); then
    printf '\n== Certificat HTTPS ==\n'
    if ! certbot certonly --webroot --webroot-path "$ACME_ROOT" \
        --domain "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --no-eff-email; then
        fail "Certificat non obtenu. Vérifie le DNS public et le transfert TCP 80 vers ce Pi; le site reste fermé (503) en attendant. Relance ensuite ce script."
    fi

    cat > "$NGINX_SITE" <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOMAIN;
    server_tokens off;

    location ^~ /.well-known/acme-challenge/ {
        root $ACME_ROOT;
        default_type text/plain;
    }
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $DOMAIN;
    server_tokens off;
    client_max_body_size 4k;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;

    location = /api/check {
        limit_req zone=url_safe_api burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
    nginx -t
    systemctl reload nginx

    install -d -o root -g root -m 0755 /etc/letsencrypt/renewal-hooks/deploy
    cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOK'
#!/bin/sh
systemctl reload nginx
HOOK
    chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
    systemctl enable --now certbot.timer
fi

printf '\n== Tranco ==\n'
if ((SKIP_TRANCO)); then
    printf 'Import Tranco ignoré (--skip-tranco).\n'
elif ! runuser -u "$APP_USER" -- env \
    URLSAFE_DB_PATH="$STATE_DIR/url_safe.sqlite3" \
    "$APP_DIR/.venv/bin/python" -m app.import_tranco --limit "$TRANCO_LIMIT"; then
    printf 'Avertissement: import Tranco ignoré; tu pourras le relancer plus tard.\n' >&2
fi

printf '\n== Service ==\n'
systemctl daemon-reload
systemctl enable --now "$APP_NAME"
systemctl restart "$APP_NAME"
systemctl --no-pager --full status "$APP_NAME"

if ((LAN_ONLY)); then
    printf '\nInstallation url_safe terminée. Ouvre http://%s ou http://%s.local depuis ton réseau local.\n' \
        "${PI_IP:-<adresse-locale-du-pi>}" "$(hostname -s)"
    printf 'Aucun port de la box n’a été configuré par ce script.\n'
else
    printf '\nInstallation url_safe terminée. Ouvre https://%s.\n' "$DOMAIN"
fi