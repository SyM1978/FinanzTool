"""API-Tests gegen eine lokale PostgreSQL (frisch eingespieltes Schema)."""
import os, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "server"))
os.environ.setdefault("DATABASE_URL", "postgresql://finanzen_app:test@127.0.0.1:5433/finanzen")
os.environ["COOKIE_SECURE"] = "0"
os.environ["REGISTRATION"] = "invite"
os.environ["INVITE_CODE"] = "hallo-welt"
os.environ.setdefault("SRC_ONVISTA", "http://127.0.0.1:8782/ov/")
os.environ.setdefault("SRC_ECB", "http://127.0.0.1:8782/ecb.xml")
os.environ.setdefault("SRC_NEWS", "http://127.0.0.1:8783/rss/search")
from fastapi.testclient import TestClient
from finanzen.main import app

H = {"X-Requested-With": "finanzen"}
ok = 0
def check(cond, msg):
    global ok
    if not cond:
        print("FEHLER:", msg); sys.exit(1)
    ok += 1

def reset_db():
    subprocess.run("psql -h /tmp -p 5433 -U postgres -d finanzen -q -c 'TRUNCATE fin.users, fin.market_cache CASCADE'", shell=True, check=True)

reset_db()
with TestClient(app) as A, TestClient(app) as B:
    r = A.get("/api/auth/me"); check(r.json()["user"] is None and r.json()["registration"]["first"], "erster Nutzer")
    r = A.post("/api/auth/register", json={"email": "m@x.de", "name": "Markus", "password": "kurz", "invite": "hallo-welt"}, headers=H)
    check(r.status_code == 400, "Passwort zu kurz")
    r = A.post("/api/auth/register", json={"email": "m@x.de", "name": "Markus", "password": "geheim12345"})
    check(r.status_code == 403, "ohne CSRF-Kopf")
    r = A.post("/api/auth/register", json={"email": "m@x.de", "name": "Markus", "password": "geheim12345", "invite": ""}, headers=H)
    check(r.status_code == 403, "erster Nutzer braucht Einladungscode, wenn gesetzt " + r.text)
    r = A.post("/api/auth/register", json={"email": "M@x.de", "name": "Markus", "password": "geheim12345", "invite": "hallo-welt"}, headers=H)
    check(r.status_code == 200, "Registrierung " + r.text)
    me = A.get("/api/auth/me").json()["user"]; check(me["is_admin"] and me["email"] == "m@x.de", "admin")
    r = B.post("/api/auth/register", json={"email": "p@x.de", "name": "Petra", "password": "geheim12345", "invite": "falsch"}, headers=H)
    check(r.status_code == 403, "falscher Code")
    r = B.post("/api/auth/register", json={"email": "m@x.de", "name": "X", "password": "geheim12345", "invite": "hallo-welt"}, headers=H)
    check(r.status_code == 409, "doppelt")
    r = B.post("/api/auth/register", json={"email": "p@x.de", "name": "Petra", "password": "geheim12345", "invite": "hallo-welt"}, headers=H)
    check(r.status_code == 200 and not B.get("/api/auth/me").json()["user"]["is_admin"], "zweite Nutzerin")

    d = A.get("/api/data").json(); check(d["rev"] == 0 and d["accounts"] == [], "leer")
    acc = {"id": "giro1", "name": "Girokonto", "kind": "giro", "color": "#985A1C", "start": {"date": "2026-01-01", "amount": 123456},
           "fee": {"amount": 495, "interval": "m", "day": 1}, "interest": None, "goal": None, "min": 0, "loan": None, "u": 5, "neu": {"x": 1}}
    loan = {"id": "kfz", "name": "KFZ", "kind": "kredit", "color": "#1D5F8A", "start": {"date": "2026-01-01", "amount": -2000000},
            "fee": None, "interest": None, "goal": None, "min": 0, "loan": {"rate": 4.9, "day": 1, "payFrom": "giro1", "orig": 2500000, "order": "o2"}, "u": 5}
    orders = [{"id": "o1", "name": "Miete", "amount": 90000, "from": "giro1", "to": "", "interval": "m", "day": 3, "start": "2026-01-03", "end": "", "shift": "next", "cat": "Wohnen", "u": 1},
              {"id": "o2", "name": "Rate KFZ", "amount": 40000, "from": "giro1", "to": "kfz", "interval": "m", "day": 1, "start": "2026-02-01", "end": "", "shift": "next", "cat": "KFZ", "u": 1}]
    tx = [{"id": "t1", "acc": "giro1", "date": "2026-01-05", "amount": -1999, "text": "Einkauf", "cat": "Haushalt", "u": 3},
          {"id": "t2", "acc": "giro1", "date": "2026-01-03", "amount": -90000, "text": "Miete", "cat": "Wohnen", "order": "o1", "occ": "2026-01-03", "u": 3},
          {"id": "t3", "acc": "giro1", "date": "2026-01-06", "amount": 500, "text": "Korrektur", "cat": "", "corr": True, "u": 3},
          {"id": "bad", "acc": "giro1", "date": "05.01.2026", "amount": 1, "text": "", "cat": ""}]
    plan = {"id": "2026", "groups": [{"id": "g1", "name": "Einkommen", "kind": "einnahme", "items": [{"id": "i1", "name": "Gehalt", "m": [300000]*12}]},
                                     {"id": "g2", "name": "Wohnen", "kind": "fix", "items": [{"id": "i2", "name": "Miete", "m": [90000]*12, "link": "o1"}]}]}
    pos = {"id": "p1", "name": "SAP SE", "sym": "OV:STOCK:DE0007164600", "isin": "DE0007164600", "depot": "dep1", "u": 2}
    stx = [{"id": "s1", "pos": "p1", "type": "buy", "date": "2026-02-01", "qty": 1.5, "price": 180.25, "fee": 4.9, "amount": 0, "u": 2},
           {"id": "s2", "pos": "p1", "type": "div", "date": "2026-05-15", "qty": 0, "price": 0, "fee": 0, "amount": 3.3, "u": 2}]
    body = {"base_rev": 0, "settings": {"scheme": "nordsee", "compact": True, "benchmark": "OV:FUND:IE00B4L5Y983", "depots": [{"id": "x"}]},
            "upsert": {"accounts": [acc, loan], "orders": orders, "tx": tx, "skips": [{"order": "o1", "occ": "2026-02-03"}], "plan": [plan],
                       "depots": [{"id": "dep1", "name": "Comdirect", "cash_acc": "giro1"}], "pos": [pos], "sectx": stx,
                       "plans": [{"id": "sp1", "pos": "p1", "amount": 50, "fee": 0, "interval": "m", "day": 15, "start": "2026-03-15", "end": "", "paused": False, "u": 1}],
                       "watch": [{"id": "w1", "sym": "OV:STOCK:US0378331005", "name": "Apple", "isin": "US0378331005", "note": "", "u": 1}],
                       "alerts": [{"id": "a1", "sym": "OV:STOCK:DE0007164600", "name": "SAP SE", "type": "above", "value": 100, "hitAt": 0, "u": 1}],
                       "events": [{"id": "e1", "date": "2026-05-14", "title": "HV", "pos": "p1", "u": 1}]}}
    r = A.post("/api/sync", json=body, headers=H); j = r.json()
    check(r.status_code == 200 and j["rev"] == 1 and not j["reload"], "sync 1 " + r.text)
    check(len(j["rejected"]) == 1 and j["rejected"][0]["id"] == "bad", "ungültige Buchung abgelehnt")
    d = A.get("/api/data").json()
    check(d["rev"] == 1 and d["settings"]["scheme"] == "nordsee" and "depots" not in d["settings"], "settings")
    a = [x for x in d["accounts"] if x["id"] == "giro1"][0]
    check(a == {**acc, "neu": {"x": 1}}, "Konto Rundreise " + json.dumps(a))
    l = [x for x in d["accounts"] if x["id"] == "kfz"][0]
    check(l["loan"] == loan["loan"] and l["fee"] is None and l["start"]["amount"] == -2000000, "Kredit Rundreise " + json.dumps(l))
    check(d["orders"] == orders, "Aufträge Rundreise " + json.dumps(d["orders"]))
    check(d["tx"] == tx[:3] or sorted(d["tx"], key=lambda t: t["id"]) == sorted(tx[:3], key=lambda t: t["id"]), "Buchungen Rundreise " + json.dumps(d["tx"]))
    check(d["skips"] == [{"order": "o1", "occ": "2026-02-03"}], "skips")
    check(d["plan"] == {"2026": {"groups": plan["groups"]}}, "Plan Rundreise " + json.dumps(d["plan"]))
    check(d["depots"] == [{"id": "dep1", "name": "Comdirect", "cash_acc": "giro1"}], "Depots")
    check(d["pos"] == [pos], "Position " + json.dumps(d["pos"]))
    check(sorted(d["sectx"], key=lambda t: t["id"]) == stx, "Wertpapierbuchungen " + json.dumps(d["sectx"]))
    check(d["plans"][0]["amount"] == 50 and d["plans"][0]["end"] == "", "Sparplan")
    check(d["alerts"][0]["value"] == 100 and d["events"][0]["pos"] == "p1" and d["watch"][0]["note"] == "", "Alarm/Termin/Watch")

    # Nutzerin B sieht nichts von A
    dB = B.get("/api/data").json()
    check(all(dB[k] == [] for k in ("accounts", "orders", "tx", "pos", "sectx", "alerts")) and dB["plan"] == {}, "Trennung der Nutzer")
    r = B.post("/api/sync", json={"base_rev": 0, "delete": {"accounts": ["giro1"]}, "upsert": {"tx": [{"id": "t1", "acc": "giro1", "date": "2026-01-01", "amount": 1, "u": 99}]}}, headers=H)
    check(r.status_code == 200, "B sync")
    d = A.get("/api/data").json()
    check(len(d["accounts"]) == 2 and [t for t in d["tx"] if t["id"] == "t1"][0]["amount"] == -1999, "B kann A nicht ändern")

    # Ältere Änderung verliert, neuere gewinnt; zweites Gerät bekommt reload
    old = dict(tx[0], amount=-1, u=1)
    j = A.post("/api/sync", json={"base_rev": 1, "upsert": {"tx": [old]}}, headers=H).json()
    check(j["rev"] == 2 and not j["reload"], "rev 2")
    check([t for t in A.get("/api/data").json()["tx"] if t["id"] == "t1"][0]["amount"] == -1999, "ältere Änderung ignoriert")
    j = A.post("/api/sync", json={"base_rev": 1, "upsert": {"tx": [dict(tx[0], amount=-2500, u=10)]}}, headers=H).json()
    check(j["reload"] and j["rev"] == 3, "veralteter Stand -> reload")
    check([t for t in A.get("/api/data").json()["tx"] if t["id"] == "t1"][0]["amount"] == -2500, "neuere Änderung übernommen")

    # Löschen: Konto weg -> Buchungen per Kaskade weg; Position weg -> sec_tx/Sparplan weg; Plan-Jahr löschen
    j = A.post("/api/sync", json={"base_rev": 3, "delete": {"accounts": ["giro1"], "pos": ["p1"], "plan": ["2026"], "skips": ["o1|2026-02-03"]}}, headers=H).json()
    d = A.get("/api/data").json()
    check(d["tx"] == [] and d["sectx"] == [] and d["plans"] == [] and d["plan"] == {} and d["skips"] == [], "Kaskaden " + json.dumps({k: d[k] for k in ("tx", "sectx", "plans", "plan", "skips")}))
    check([o["id"] for o in d["orders"]] == ["o1", "o2"], "Aufträge bleiben (weiche Referenz)")
    # Waisen: Buchung auf nicht vorhandenes Konto wird verworfen statt den Abgleich zu blockieren
    r = A.post("/api/sync", json={"upsert": {"tx": [{"id": "t9", "acc": "gibtsnicht", "date": "2026-01-01", "amount": 5}]}}, headers=H)
    check(r.status_code == 200 and A.get("/api/data").json()["tx"] == [], "Waise")

    # Alarm: Wertänderung macht den Mail-Alarm wieder scharf
    subprocess.run("psql -h /tmp -p 5433 -U postgres -d finanzen -q -c \"UPDATE fin.price_alerts SET mail_armed=false\"", shell=True, check=True)
    A.post("/api/sync", json={"upsert": {"alerts": [{"id": "a1", "sym": "OV:STOCK:DE0007164600", "name": "SAP SE", "type": "above", "value": 120, "hitAt": 0, "u": 9}]}}, headers=H)
    armed = subprocess.run("psql -h /tmp -p 5433 -U postgres -d finanzen -tA -c \"SELECT mail_armed FROM fin.price_alerts\"", shell=True, capture_output=True, text=True).stdout.strip()
    check(armed == "t", "Alarm neu scharf")

    # Login / Logout / Passwort
    A.post("/api/auth/logout", headers=H); check(A.get("/api/data").status_code == 401, "abgemeldet")
    r = A.post("/api/auth/login", json={"email": "m@x.de", "password": "falsch"}, headers=H); check(r.status_code == 401, "falsches Passwort")
    r = A.post("/api/auth/login", json={"email": "M@X.de", "password": "geheim12345"}, headers=H); check(r.status_code == 200, "Login")
    r = A.post("/api/auth/password", json={"old": "geheim12345", "new": "nochgeheimer1"}, headers=H); check(r.status_code == 200, "Passwort ändern")
    check(A.get("/api/data").status_code == 200, "nach Passwortwechsel weiter angemeldet")
    r = A.post("/api/auth/profile", json={"name": "Markus H.", "alert_mail": True, "alert_email": "alarm@x.de"}, headers=H)
    u = A.get("/api/auth/me").json()["user"]; check(u["name"] == "Markus H." and u["alert_mail"] and u["alert_email"] == "alarm@x.de", "Profil")
    for i in range(8):
        B.post("/api/auth/login", json={"email": "p@x.de", "password": "x"}, headers=H)
    r = B.post("/api/auth/login", json={"email": "p@x.de", "password": "geheim12345"}, headers=H); check(r.status_code == 429, "Bremse")
    # Konto löschen
    r = A.post("/api/auth/delete", json={"password": "falsch"}, headers=H); check(r.status_code == 400, "Löschen braucht Passwort")
    r = A.post("/api/auth/delete", json={"password": "nochgeheimer1"}, headers=H); check(r.status_code == 200, "Konto gelöscht")
    n = subprocess.run("psql -h /tmp -p 5433 -U postgres -d finanzen -tA -c \"SELECT (SELECT count(*) FROM fin.users)||'/'||(SELECT count(*) FROM fin.orders)||'/'||(SELECT count(*) FROM fin.price_alerts)\"", shell=True, capture_output=True, text=True).stdout.strip()
    check(n == "1/0/0", "Kaskade beim Löschen " + n)
    check(A.get("/api/market/quotes?s=X").status_code == 401, "Kurse nur angemeldet")
print("API ok:", ok, "Prüfungen")
