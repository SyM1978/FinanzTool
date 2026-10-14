#!/bin/sh
# Startet den Server lokal gegen die Test-Datenbank und die nachgebauten Kursquellen
cd "$(dirname "$0")/../server"
export DATABASE_URL=postgresql://finanzen_app:test@127.0.0.1:5433/finanzen COOKIE_SECURE=0 REGISTRATION=open \
  SRC_ONVISTA=http://127.0.0.1:8782/ov/ SRC_ECB=http://127.0.0.1:8782/ecb.xml SRC_NEWS=http://127.0.0.1:8784/rss/search \
  SRC_Y_CHART=http://127.0.0.1:8782/yahoo/chart/ SRC_Y_SEARCH=http://127.0.0.1:8782/yahoo/search \
  SMTP_HOST=127.0.0.1 SMTP_PORT=8825 SMTP_TLS=none MAIL_FROM=finanzen@example.de WEB_DIR=../web/out
exec python3 -m uvicorn finanzen.main:app --host 127.0.0.1 --port ${PORT:-8800}
