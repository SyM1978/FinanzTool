#!/bin/bash
# =====================================================================
# Meine Finanzen – Einrichtung auf einem frischen Ubuntu 24.04 (Hetzner)
#
#   sudo bash deploy/vps/setup.sh finanzen.deine-domain.de du@deine-domain.de
#
# Aufruf aus dem Repository-Ordner (git clone). Das Skript kann
# mehrfach laufen (Update): Daten und Passwörter bleiben erhalten.
# =====================================================================
set -euo pipefail
DOMAIN="${1:-}"; MAIL="${2:-}"
if [ -z "$DOMAIN" ] || [ -z "$MAIL" ]; then
  echo "Aufruf: sudo bash deploy/vps/setup.sh DOMAIN E-MAIL   (E-Mail für Let's Encrypt)"; exit 1
fi
[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten."; exit 1; }
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
echo "== 1/7 Pakete"
apt-get update -q
apt-get install -y -q postgresql nginx python3-venv certbot python3-certbot-nginx

echo "== 2/7 Benutzer und Dateien"
id finanzen >/dev/null 2>&1 || useradd --system --home /opt/finanzen --shell /usr/sbin/nologin finanzen
mkdir -p /opt/finanzen /etc/finanzen /var/backups/finanzen
rm -rf /opt/finanzen/server /opt/finanzen/web
cp -r "$SRC/server" /opt/finanzen/server
python3 "$SRC/web/build.py" >/dev/null
mkdir -p /opt/finanzen/web && cp "$SRC/web/out/index.html" /opt/finanzen/web/
chown -R root:finanzen /opt/finanzen; chmod -R o-rwx /opt/finanzen
chown postgres:postgres /var/backups/finanzen; chmod 700 /var/backups/finanzen

echo "== 3/7 Python-Umgebung"
[ -d /opt/finanzen/venv ] || python3 -m venv /opt/finanzen/venv
/opt/finanzen/venv/bin/pip install -q --upgrade pip
/opt/finanzen/venv/bin/pip install -q -r /opt/finanzen/server/requirements.txt

echo "== 4/7 Datenbank"
ENV=/etc/finanzen/finanzen.env
if [ ! -f "$ENV" ]; then
  DBPW="$(openssl rand -hex 24)"; INV="$(openssl rand -hex 6)"
  sed -e "s/HIER_DAS_DB_PASSWORT/$DBPW/" -e "s/HIER_EIN_EINLADUNGSCODE/$INV/" \
      -e "s#https://finanzen.example.de#https://$DOMAIN#" "$SRC/deploy/vps/finanzen.env.example" > "$ENV"
  chown root:finanzen "$ENV"; chmod 640 "$ENV"
  echo "   Neue Einstellungen in $ENV (Einladungscode: $INV)"
fi
DBPW="$(sed -n 's#^DATABASE_URL=postgresql://finanzen_app:\([^@]*\)@.*#\1#p' "$ENV")"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='finanzen'" | grep -q 1 || sudo -u postgres createdb finanzen
sudo -u postgres psql -q -v app_password="'$DBPW'" -f /opt/finanzen/server/schema.sql finanzen

echo "== 5/7 Dienste"
cp "$SRC"/deploy/vps/finanzen.service "$SRC"/deploy/vps/finanzen-alerts.service "$SRC"/deploy/vps/finanzen-alerts.timer \
   "$SRC"/deploy/vps/finanzen-backup.service "$SRC"/deploy/vps/finanzen-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now finanzen.service finanzen-alerts.timer finanzen-backup.timer
systemctl restart finanzen.service

echo "== 6/7 nginx"
cp "$SRC/deploy/vps/finanzen_proxy.conf" /etc/nginx/finanzen_proxy.conf
if [ ! -f /etc/nginx/sites-available/finanzen ]; then
  sed "s/DOMAIN/$DOMAIN/" "$SRC/deploy/vps/nginx-finanzen.conf" > /etc/nginx/sites-available/finanzen
  ln -sf /etc/nginx/sites-available/finanzen /etc/nginx/sites-enabled/finanzen
fi
nginx -t && systemctl reload nginx

echo "== 7/7 HTTPS (Let's Encrypt)"
certbot --nginx -n --agree-tos -m "$MAIL" -d "$DOMAIN" --redirect || echo "   HTTPS noch nicht eingerichtet: Zeigt die Domain schon auf diesen Server? Später: certbot --nginx -d $DOMAIN"

sleep 2
curl -fsS http://127.0.0.1:8000/api/health && echo
echo "Fertig. Öffne https://$DOMAIN und lege das erste Konto an (es wird Verwalter)."
echo "Mailversand: SMTP-Daten in $ENV eintragen, dann: systemctl restart finanzen"
