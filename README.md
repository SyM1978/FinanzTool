# Meine Finanzen

Konten, Daueraufträge, Kredite, Finanzplan und Depot in einer Web-App. Smooth Solutions.
Python/FastAPI, PostgreSQL 16 mit Row-Level Security, jede Person mit eigenem Login und eigenen Daten.

```
├── Dockerfile                  baut die Seite und den Server in ein Image
├── docker-compose.yml          db · migrate · app · alerts · backup  (für Dokploy)
├── docker-compose.local.yml    lokal ohne HTTPS auf Port 8000
├── .env.example                alle Einstellungen
├── server/
│   ├── schema.sql              Tabellen, Rollen, Row-Level Security
│   └── finanzen/               main · auth · sync · market · alerts · migrate · db · config
├── web/
│   ├── build.py                setzt die Seite zusammen → web/out/index.html
│   ├── src/                    Hülle: Login, Abgleich, Einstellungen, Sortierung, Markierung
│   ├── legacy/finanz, depot/   Quellen von „Mein Finanzkonto“ und „Mein Depot“
│   └── assets/                 Logo
├── tests/                      API-, Markt- und Browser-Tests mit nachgebauten Kursquellen
└── deploy/vps/                 Alternative ohne Docker (systemd + nginx, setup.sh)
```

## Installation mit Dokploy

1. **Projekt anlegen:** In Dokploy ein Projekt anlegen und darin *Create Service › Compose* wählen.
   - Provider: **GitHub**, Repository `SyM1978/FinanzTool`, Branch `main`.
   - Compose-Pfad: `./docker-compose.yml`, Typ **Docker Compose**.
2. **Environment:** den Inhalt von `.env.example` einfügen und die Werte ersetzen.
   - Für Passwörter nur Buchstaben und Ziffern verwenden, z. B. von `openssl rand -hex 24`.
   - Zwingend sind `POSTGRES_PASSWORD` und `APP_DB_PASSWORD`.
   - Für die Registrierung einen `INVITE_CODE` setzen.
3. **Domain:** unter *Domains* eine Domain hinzufügen.
   - Service: **app**, Container-Port: **8000**.
   - HTTPS an, Zertifikat über Let’s Encrypt.
   - Der DNS-A-Record muss auf den Server zeigen.
4. **Deploy:** Dokploy baut das Image und startet die Dienste in dieser Reihenfolge:

   | Dienst | Aufgabe |
   |---|---|
   | `db` | PostgreSQL, Daten im Volume `db-data` |
   | `migrate` | spielt das Schema ein und beendet sich dann. Das ist beabsichtigt, Status „exited (0)“ |
   | `app` | die Web-App |
   | `alerts` | prüft werktags von 8 bis 22 Uhr alle 15 Minuten die Kursalarme |
   | `backup` | schreibt jede Nacht um 3:15 Uhr eine Sicherung ins Volume `backups` und behält sie 14 Tage |

5. **Erstes Konto:** die Domain öffnen und mit dem Einladungscode das erste Konto anlegen. Es wird Verwalter.

**Updates:** auf GitHub pushen und in Dokploy **Deploy** drücken, oder *Autodeploy* einschalten. `migrate` läuft bei jedem Deploy und ändert nur, was fehlt. Die Daten bleiben erhalten.

**Hinweis zum Netzwerk:** Ältere Dokploy-Versionen hängen die Traefik-Labels nicht automatisch an. Dann den Dienst `app` zusätzlich ins externe Netzwerk `dokploy-network` hängen, siehe Dokploy-Doku „Docker Compose › Domains“.

### Sicherung zurückspielen

```bash
docker compose cp backup:/backups/finanzen-2026-10-14.dump ./      # oder im Dokploy-Terminal
docker compose exec -T db pg_restore -U postgres --clean --if-exists -d finanzen < finanzen-2026-10-14.dump
```

Zusätzlich kann jede Person in der App unter *Einstellungen › Daten & Umzug* alles als JSON exportieren.

### Mail für Kursalarme

Diese Werte in der Environment eintragen:

| Variable | Wert |
|---|---|
| `SMTP_HOST` | Server deines Mail-Anbieters |
| `SMTP_PORT` | 587, oder 465 mit `SMTP_TLS=ssl` |
| `SMTP_USER`, `SMTP_PASSWORD` | Zugangsdaten des Postfachs |
| `MAIL_FROM` | Absenderadresse |

Danach neu deployen. In der App unter *Einstellungen › E-Mail-Alarme* einschalten und eine Test-Mail senden.

### Passwort vergessen

```bash
docker compose exec app python -c "from argon2 import PasswordHasher; print(PasswordHasher().hash('NEUES-PASSWORT'))"
docker compose exec db psql -U postgres finanzen -c "update fin.users set pw_hash='HASH' where email='name@example.de'"
```

## Lokal ausprobieren

```bash
cp .env.example .env        # Passwörter eintragen
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
# → http://localhost:8000
```

## Entwicklung

- **Seite bauen:** `python web/build.py` erzeugt `web/out/index.html`. Dabei entsteht auch eine `web/out/preview.html`, die ohne Server mit Beispieldaten läuft.
- **Anpassungen an den Altquellen** stehen nicht in den Dateien selbst, sondern als geprüfte Ersetzungen in `web/build.py`. Passt eine Stelle nicht mehr, bricht der Build mit Meldung ab.

**Tests** brauchen eine lokale PostgreSQL auf Port 5433 mit eingespieltem Schema und Playwright:

```bash
python tests/fake_sources.py & python tests/fake_news2.py & python tests/fake_smtp.py &
tests/run_server.sh &
python tests/test_api.py && python tests/test_market.py && python tests/smoke.py && python tests/e2e.py
```

Dabei laufen auch nachgebaute Kursquellen und ein Test-Mailserver.

## Sicherheit

- **Passwörter:** liegen nur als Argon2id-Hash vor.
- **Sitzung:** im Cookie mit `HttpOnly`, `Secure` und `SameSite=Strict`. In der Datenbank steht nur ein SHA-256 des Tokens.
- **Schreibende Aufrufe:** brauchen einen eigenen Header (Schutz vor fremden Seiten, CSRF).
- **Anmeldung:** wird nach Fehlversuchen gebremst.
- **Content-Security-Policy:** streng.
- **Rollen:** Die App verbindet sich als `finanzen_app` ohne Superuser-Rechte.
- **Datentrennung:** Row-Level Security sorgt dafür, dass jede Person nur ihre eigenen Zeilen sieht. Das gilt auch, wenn im Python-Code ein Fehler steckt.
- **Datenbank:** ist nur im internen Docker-Netz erreichbar.
- **Kursquellen:** onvista, EZB und Google News erfahren nur die abgefragten Wertpapiere. Stückzahlen und Beträge bekommen sie nie.

Kurse sind meist verzögert, alles ohne Gewähr.
