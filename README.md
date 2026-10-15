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
   - Die SMTP-Werte eintragen. Ohne sie gibt es keine Bestätigungsmails, kein „Passwort vergessen“ und keine Kursalarme.
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

5. **Erstes Konto:** die Domain öffnen und das erste Konto anlegen. Es wird Verwalter und ist sofort angemeldet.

**Updates:** auf GitHub pushen und in Dokploy **Deploy** drücken, oder *Autodeploy* einschalten. `migrate` läuft bei jedem Deploy und ändert nur, was fehlt. Die Daten bleiben erhalten.

**Hinweis zum Netzwerk:** Ältere Dokploy-Versionen hängen die Traefik-Labels nicht automatisch an. Dann den Dienst `app` zusätzlich ins externe Netzwerk `dokploy-network` hängen, siehe Dokploy-Doku „Docker Compose › Domains“.

### Anmeldung und Konten

| Funktion | So läuft es |
|---|---|
| **Registrieren** | Standard `REGISTRATION=open`: Jeder kann sich mit Name, E-Mail und Passwort registrieren. Das Passwort braucht mindestens 10 Zeichen, eine Stärkeanzeige hilft. |
| **E-Mail bestätigen** | Neue Konten bekommen einen Bestätigungslink, 48 Stunden gültig. Erst danach ist die Anmeldung möglich. Gilt automatisch, sobald SMTP eingetragen ist (`VERIFY_EMAIL=auto`). |
| **Kein Konto-Raten** | Ist eine Adresse schon registriert, sieht die Antwort gleich aus. Der Inhaber bekommt nur einen Hinweis per Mail. |
| **Passwort vergessen** | Link per Mail, 60 Minuten gültig, nur einmal nutzbar. Danach sind alle anderen Geräte abgemeldet. |
| **Zwei-Faktor** | Freiwillig unter *Einstellungen › Benutzerkonto*. QR-Code mit einer Authenticator-App scannen, dazu 10 Notfall-Codes. Ein Code gilt nur einmal. Auch „Passwort vergessen“ verlangt dann den Code. |
| **Angemeldet bleiben** | Haken an: 30 Tage. Haken aus: bis der Browser geschlossen wird. |
| **Weitere Funktionen** | Passwort ändern, auf allen Geräten abmelden und das Konto samt allen Daten löschen. |
| **Bremsen** | 8 Fehlversuche pro Adresse in 15 Minuten. Mails sind begrenzt auf 5 pro Adresse und 8 pro IP-Adresse und Stunde. |

Nur mit Einladung: `REGISTRATION=invite` plus `INVITE_CODE`. Keine neuen Konten mehr: `REGISTRATION=closed`.

### Konten teilen

Unter *Einstellungen › Konten teilen* gibst du ein einzelnes Konto per E-Mail-Adresse frei, z. B. das Haushaltskonto für deine Partnerin.

| Recht | Was die andere Person darf |
|---|---|
| **ansehen und buchen** | Buchungen und Daueraufträge auf diesem Konto anlegen, ändern und löschen |
| **nur ansehen** | Konto, Buchungen und Prognose sehen, nichts ändern |

- **Wem es gehört:** Name, Startwert und Einstellungen des Kontos ändert nur der Besitzer. Alle anderen Daten (andere Konten, Depot, Finanzplan) bleiben privat.
- **Einladung:** Hat die Adresse noch kein Benutzerkonto, geht eine Einladung raus. Die Person darf sich damit auch bei `REGISTRATION=closed` registrieren. Die Freigabe greift erst, wenn die Adresse bestätigt ist.
- **Zurücknehmen und verlassen:** Freigaben lassen sich jederzeit zurücknehmen oder ändern. Die andere Person kann sie selbst verlassen.
- **Technik:** Die Daten bleiben beim Besitzer. Zusätzliche Row-Level-Security-Regeln in PostgreSQL erlauben den Zugriff auf genau dieses Konto.

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
PORT=8801 VERIFY_EMAIL=auto APP_URL=http://127.0.0.1:8801 tests/run_server.sh &   # für den Anmelde-Test
python tests/test_api.py && python tests/test_market.py && python tests/test_auth.py
python tests/smoke.py && python tests/e2e.py && python tests/e2e_auth.py
```

Dabei laufen auch nachgebaute Kursquellen und ein Test-Mailserver.

## Sicherheit

- **Passwörter:** liegen nur als Argon2id-Hash vor. Mail-Links und Notfall-Codes liegen nur als SHA-256 in der Datenbank. Die App-Rolle kann die Token-Tabelle nicht lesen.
- **Sitzung:** im Cookie mit `HttpOnly`, `Secure` und `SameSite=Strict`. In der Datenbank steht nur ein SHA-256 des Tokens.
- **Schreibende Aufrufe:** brauchen einen eigenen Header (Schutz vor fremden Seiten, CSRF).
- **Anmeldung:** wird nach Fehlversuchen gebremst.
- **Content-Security-Policy:** streng.
- **Rollen:** Die App verbindet sich als `finanzen_app` ohne Superuser-Rechte.
- **Datentrennung:** Row-Level Security sorgt dafür, dass jede Person nur ihre eigenen Zeilen sieht. Das gilt auch, wenn im Python-Code ein Fehler steckt.
- **Datenbank:** ist nur im internen Docker-Netz erreichbar.
- **Kursquellen:** onvista, EZB und Google News erfahren nur die abgefragten Wertpapiere. Stückzahlen und Beträge bekommen sie nie.

Kurse sind meist verzögert, alles ohne Gewähr.
