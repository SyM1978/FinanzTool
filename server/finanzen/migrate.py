"""Datenbankschema einspielen oder aktualisieren (läuft bei jedem Start des Containers „migrate“).

    ADMIN_DATABASE_URL=postgresql://postgres:…@db/finanzen  APP_DB_PASSWORD=…  python -m finanzen.migrate

Braucht einen Superuser (Erweiterungen, Rollen). Das Schema ist so geschrieben,
dass es beliebig oft laufen darf; bestehende Daten bleiben erhalten."""
import os
import sys
import time
from pathlib import Path

import psycopg
from psycopg import sql

SCHEMA = Path(os.environ.get("SCHEMA_FILE", str(Path(__file__).resolve().parent.parent / "schema.sql")))


def script(app_password: str) -> str:
    out = []
    for line in SCHEMA.read_text(encoding="utf-8").splitlines():
        if line.lstrip().startswith("\\"):          # psql-Befehle wie \set
            continue
        out.append(line)
    text = "\n".join(out)
    lit = sql.Literal(app_password).as_string()
    return text.replace(":app_password", lit)


def main() -> int:
    url = os.environ.get("ADMIN_DATABASE_URL")
    pw = os.environ.get("APP_DB_PASSWORD")
    if not url or not pw:
        print("ADMIN_DATABASE_URL und APP_DB_PASSWORD fehlen", file=sys.stderr)
        return 2
    for i in range(30):                          # warten, bis die Datenbank bereit ist
        try:
            with psycopg.connect(url, autocommit=True) as c:
                c.execute(script(pw))
                v = c.execute("SELECT value FROM fin.meta WHERE key = 'schema_version'").fetchone()
                print("Schema eingespielt, Version", v[0] if v else "?")
                return 0
        except psycopg.OperationalError as e:
            print("Datenbank noch nicht bereit:", str(e).strip().splitlines()[0])
            time.sleep(2)
    return 1


if __name__ == "__main__":
    sys.exit(main())
