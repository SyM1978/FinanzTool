# Meine Finanzen – Einrichtung direkt auf dem VPS (ohne Docker)

> Alternative zu Dokploy (siehe README.md im Hauptordner). Statt die ZIP hochzuladen: `git clone` des Repositorys und `sudo bash deploy/vps/setup.sh DOMAIN E-MAIL` im geklonten Ordner.

„Meine Finanzen“ vereint **Mein Finanzkonto** und **Mein Depot** in einer App:
Konten, Daueraufträge, Kredite, Finanzplan, Depot, Aktienzeitung, Watchlist, Kursalarme.
Die Daten liegen in PostgreSQL auf deinem Server, jede Person mit eigenem Login und nur mit ihren eigenen Daten.

```
MeineFinanzen/
├── ANLEITUNG.md          diese Datei
├── web/index.html        die Seite (eine Datei, Logo eingebettet)
├── server/
│   ├── schema.sql        Datenbank: Tabellen, Rollen, Row-Level Security
│   ├── requirements.txt
│   └── finanzen/         Python-Server (FastAPI)
│       ├── main.py       Start, Sicherheits-Header, liefert die Seite aus
│       ├── auth.py       Konto anlegen, Login, Passwort, Konto löschen
│       ├── sync.py       Abgleich Seite ↔ Tabellen
│       ├── market.py     Kurse (onvista, EZB), Suche, News (Google News)
│       ├── alerts.py     Kursalarme per E-Mail (Timer alle 15 Minuten)
│       ├── db.py, config.py
└── deploy/
    ├── setup.sh          richtet alles auf Ubuntu 24.04 ein
    ├── finanzen.env.example
    ├── finanzen.service, finanzen-alerts.*, finanzen-backup.*
    └── nginx-finanzen.conf, finanzen_proxy.conf
```

---

## 1. Voraussetzungen

- Hetzner-VPS mit **Ubuntu 24.04**. Der kleinste Typ reicht.
- Eine (Sub-)Domain, z. B. `finanzen.deine-domain.de`. Ihr **A-Record** muss auf die IP des VPS zeigen. Das stellst du beim Domain-Anbieter ein.
- SSH-Zugang als root oder mit sudo.

## 2. Hochladen und einrichten

Auf deinem Rechner:

```bash
scp MeineFinanzen_1.1.0.zip root@DEINE-VPS-IP:
```

Auf dem VPS:

```bash
apt install -y unzip
unzip MeineFinanzen_1.1.0.zip && cd MeineFinanzen
sudo bash deploy/vps/setup.sh finanzen.deine-domain.de du@deine-domain.de
```

Das Skript erledigt in 7 Schritten:

1. **Pakete:** PostgreSQL 16, nginx, Python und certbot.
2. **Benutzer und Dateien:** legt den Systembenutzer `finanzen` an und kopiert die App nach `/opt/finanzen`.
3. **Python-Umgebung:** richtet eine eigene Umgebung (venv) ein und installiert die Pakete.
4. **Datenbank:**
   - legt die Datenbank `finanzen` an und spielt das Schema ein;
   - erzeugt ein zufälliges Datenbank-Passwort und einen **Einladungscode**;
   - schreibt beides nach `/etc/finanzen/finanzen.env`.
5. **Dienste:** startet die App und richtet zwei Timer ein, für die Kursalarme und für die nächtliche Sicherung.
6. **nginx:** richtet nginx als Vorderseite ein.
7. **HTTPS:** holt ein Zertifikat von Let’s Encrypt.

Am Ende steht `{"ok":true,...}` und der Einladungscode erscheint.

**Firewall** (empfohlen, falls noch nicht aktiv):

```bash
ufw allow OpenSSH && ufw allow "Nginx Full" && ufw enable
```

PostgreSQL lauscht nur lokal, von außen ist die Datenbank nicht erreichbar.

## 3. Erstes Konto

1. Öffne `https://finanzen.deine-domain.de`.
2. Trag Namen, E-Mail und Passwort ein (mindestens 10 Zeichen) sowie den Einladungscode. Das erste Konto wird **Verwalter**.
3. Deine Partnerin legt ihr eigenes Konto mit demselben Einladungscode an. Jede Person sieht nur ihre eigenen Daten, das erzwingt die Datenbank selbst.
4. Wenn alle Konten angelegt sind, kannst du neue Konten sperren:
   - in `/etc/finanzen/finanzen.env` die Zeile `REGISTRATION=closed` eintragen;
   - danach `systemctl restart finanzen` ausführen.

Den Einladungscode findest du jederzeit hier:

```bash
sudo grep INVITE_CODE /etc/finanzen/finanzen.env
```

## 4. Umzug aus den bisherigen Apps

1. In **Mein Finanzkonto** unter *Einstellungen › Sicherung & Teilen* auf **Herunterladen** gehen.
2. In **Mein Depot** unter *Einstellungen › Sicherung* auf **Sicherung herunterladen** gehen.
3. In **Meine Finanzen** unter *Einstellungen › Daten & Umzug* die Datei wählen, die **PIN der alten App** eintragen und **Hinzufügen** drücken. Das machst du für beide Sicherungen.

Die Sicherungen werden in deinem Browser entschlüsselt und dann als Tabellen gespeichert. Die PIN geht nicht an den Server.

Die Excel-Importdatei `finanzplan_2026_2027.json` bleibt auf deinem Rechner. *Einstellungen › Excel-Import* liest sie im Browser. Nur die übernommenen Planwerte landen danach in deinem Konto in der Datenbank.

## 5. Verrechnungskonto: Depot und Konto verbinden

Unter *Einstellungen › Depots* wählst du für jedes Depot ein Konto, z. B. *→ Girokonto*, und ein Startdatum.

Ab diesem Tag bucht die App jede Depot-Bewegung automatisch auf das Konto:

| Depot-Bewegung | Buchung auf dem Konto | Kategorie |
|---|---|---|
| Kauf | Kurs × Stück + Gebühr als Ausgabe | „Wertpapiere“ |
| Verkauf | Erlös minus Gebühr als Einnahme | „Wertpapiere“ |
| Dividende | als Einnahme | „Dividenden“ |

- Änderst oder löschst du die Depot-Buchung, passt sich die Konto-Buchung an.
- Das Startdatum verhindert doppelte Buchungen, wenn du frühere Käufe schon von Hand im Konto eingetragen hast.
- Die Übersicht zeigt zusätzlich den **Depotwert** und das Vermögen zusammen.

## 6. Kursalarme per E-Mail

1. SMTP-Daten in `/etc/finanzen/finanzen.env` eintragen. Das kann zum Beispiel ein Postfach bei deinem Webhoster sein:
   ```
   SMTP_HOST=smtp.dein-hoster.de
   SMTP_PORT=587
   SMTP_TLS=starttls        # oder ssl bei Port 465
   SMTP_USER=finanzen@deine-domain.de
   SMTP_PASSWORD=...
   MAIL_FROM=finanzen@deine-domain.de
   ```
2. Danach `systemctl restart finanzen` ausführen.
3. Mailversand vom Server testen:
   ```bash
   cd /opt/finanzen/server && sudo -u finanzen bash -c 'set -a; . /etc/finanzen/finanzen.env; /opt/finanzen/venv/bin/python -m finanzen.alerts test du@deine-domain.de'
   ```
4. In der App unter *Einstellungen › E-Mail-Alarme* den Haken **an** setzen und **Speichern** drücken. **Test-Mail senden** prüft den Versand.

Der Timer prüft werktags von 8 bis 22 Uhr alle 15 Minuten. Eine Schwelle meldet sich erst wieder, wenn der Kurs zwischendurch zurückgekommen ist. Tagesbewegungen melden sich höchstens einmal am Tag.

## 7. Sicherung und Wiederherstellung

Jede Nacht um 3:15 Uhr schreibt der Server eine Sicherung nach `/var/backups/finanzen/`. Sie bleibt 14 Tage liegen.

Zusätzlich kann jede Person unter *Einstellungen › Daten & Umzug* mit **Export (JSON)** alles herunterladen.

Wiederherstellen:

```bash
sudo systemctl stop finanzen
sudo -u postgres pg_restore --clean --if-exists -d finanzen /var/backups/finanzen/finanzen-2026-10-14.dump
sudo systemctl start finanzen
```

Tipp: Kopiere die Sicherungen gelegentlich vom VPS weg, z. B. per `scp` oder mit einer Hetzner Storage Box.

## 8. Update auf eine neue Version

Neue ZIP hochladen, entpacken und `sudo bash deploy/vps/setup.sh DOMAIN E-MAIL` erneut ausführen.

Daten, Passwörter und `finanzen.env` bleiben erhalten.

## 9. Nützliche Befehle

| Was | Befehl |
|---|---|
| Läuft die App? | `systemctl status finanzen` |
| Protokoll ansehen | `journalctl -u finanzen -n 100` |
| Alarm-Läufe | `journalctl -u finanzen-alerts -n 20` |
| Timer anzeigen | `systemctl list-timers 'finanzen*'` |
| Alle Benutzer | `sudo -u postgres psql finanzen -c "select email, name, is_admin, last_login from fin.users"` |

**Passwort vergessen:** Neues Passwort als Hash erzeugen und eintragen.

```bash
sudo -u finanzen /opt/finanzen/venv/bin/python -c "from argon2 import PasswordHasher; print(PasswordHasher().hash('NEUES-PASSWORT'))"
sudo -u postgres psql finanzen -c "update fin.users set pw_hash='HIER-DEN-HASH' where email='name@example.de'"
```

## 10. Für dich als Python-Entwickler: die Datenbank

Alle Tabellen liegen im Schema `fin`.

| Tabelle | Inhalt |
|---|---|
| `users`, `sessions`, `user_settings` | Benutzer, Anmeldungen, Darstellung |
| `accounts`, `orders`, `bookings`, `order_skips` | Konten, Daueraufträge, Buchungen |
| `plan_groups`, `plan_items` | Finanzplan, 12 Monatswerte als Array |
| `depots`, `positions`, `sec_tx`, `savings_plans` | Depot, Positionen, Käufe/Verkäufe/Dividenden, Sparpläne |
| `watchlist`, `price_alerts`, `events` | Watchlist, Kursalarme, Termine |

So sind die Werte gespeichert:

- **Beträge der Konten** in Cent als `bigint`.
- **Stück und Kurse** als `numeric`.
- Felder, die die Seite künftig ergänzt, landen in der Spalte `extra` (jsonb).

**Rollen und Row-Level Security:**

- Die App verbindet sich als Rolle `finanzen_app`.
- Diese Rolle sieht nur Zeilen mit `user_id = current_setting('app.user_id')`.
- Für eigene Auswertungen in Python setzt du die Nutzer-ID pro Transaktion:

```python
import psycopg
with psycopg.connect("postgresql://finanzen_app:PASSWORT@localhost/finanzen") as c:
    c.execute("select set_config('app.user_id', %s, true)", ("DEINE-USER-ID",))
    for name, summe in c.execute("""select a.name, a.start_amount + coalesce(sum(b.amount),0)
                                    from fin.accounts a left join fin.bookings b on b.acc=a.id and b.user_id=a.user_id and b.date >= a.start_date
                                    group by a.name, a.start_amount"""):
        print(name, summe / 100)
```

Deine User-ID steht in `fin.users` (Abfrage als `postgres`).

## 11. Sicherheit kurz erklärt

- **Passwörter** liegen nur als Argon2-Hash vor.
- **Sitzung:** zufälliges Token in einem Cookie, `HttpOnly`, `Secure` und `SameSite=Strict`. In der Datenbank steht nur dessen SHA-256.
- **Schutz vor Raten:** nach 8 Fehlversuchen ist die Anmeldung 15 Minuten gesperrt. Zusätzlich bremst nginx.
- **Schutz vor fremden Seiten:** schreibende Aufrufe brauchen einen eigenen Header (CSRF-Schutz). Strenge Content-Security-Policy.
- **Trennung der Nutzer:** übernimmt PostgreSQL per Row-Level Security. Auch ein Fehler im Python-Code kann keine fremden Zeilen lesen oder schreiben.
- **Kursquellen:** onvista, EZB und Google News erfahren nur, welche Wertpapiere abgefragt werden. Stückzahlen und Beträge bekommen sie nie.

**Hinweis:** onvista und Google News sind keine offiziellen Schnittstellen. Kurse sind meist verzögert, alles ohne Gewähr.
