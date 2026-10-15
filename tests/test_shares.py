"""Konten teilen: Rechte, Abgleich, Einladung per Mail, Zurücknehmen."""
import os, sys, glob, re, subprocess, email, email.header
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "server"))
os.environ.update({"DATABASE_URL": "postgresql://finanzen_app:test@127.0.0.1:5433/finanzen", "COOKIE_SECURE": "0", "REGISTRATION": "closed",
                   "VERIFY_EMAIL": "1", "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "8825", "SMTP_TLS": "none", "MAIL_FROM": "finanzen@example.de",
                   "APP_URL": "https://f.example.de"})
from fastapi.testclient import TestClient
from finanzen.main import app
H = {"X-Requested-With": "finanzen"}
n = 0
def check(c, m):
    global n
    if not c: print("FEHLER:", m); sys.exit(1)
    n += 1
psql = lambda q: subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","finanzen","-tAq","-c",q],capture_output=True,text=True).stdout.strip()
psql("TRUNCATE fin.users, fin.market_cache CASCADE")
for f in glob.glob("/tmp/mf_mails/*"): os.remove(f)
def mails():
    out = []
    for f in sorted(glob.glob("/tmp/mf_mails/*")):
        m = email.message_from_string(open(f).read())
        txt = next(p.get_payload(decode=True).decode() for p in m.walk() if p.get_content_type() == "text/plain")
        out.append((m["To"], str(email.header.make_header(email.header.decode_header(m["Subject"]))), txt))
    return out
def mkuser(cl, mail, name):
    psql(f"INSERT INTO fin.users(email,name,pw_hash,email_verified) VALUES ('{mail}','{name}','x',true)")
    from finanzen.auth import ph
    psql(f"UPDATE fin.users SET pw_hash='{ph.hash('geheim12345')}' WHERE email='{mail}'")
    r = cl.post("/api/auth/login", json={"email": mail, "password": "geheim12345"}, headers=H); assert r.status_code == 200, r.text
with TestClient(app) as A, TestClient(app) as B, TestClient(app) as C, TestClient(app) as Dd:
    r = A.post("/api/auth/register", json={"email": "markus@x.de", "name": "Markus", "password": "geheim12345"}, headers=H)  # erstes Konto
    check(r.status_code == 200, "Markus " + r.text)
    mkuser(B, "frau@x.de", "Petra"); mkuser(C, "sohn@x.de", "Tim")
    acc = lambda i, nm, kind: {"id": i, "name": nm, "kind": kind, "color": "#000", "start": {"date": "2026-01-01", "amount": 50000}, "u": 1}
    A.post("/api/sync", json={"upsert": {"accounts": [acc("haus", "Haushaltskonto", "haushalt"), acc("giro", "Girokonto", "giro")],
        "tx": [{"id": "t1", "acc": "haus", "date": "2026-02-01", "amount": -3000, "text": "Edeka", "u": 1},
               {"id": "t2", "acc": "giro", "date": "2026-02-01", "amount": -9000, "text": "Geheim", "u": 1}],
        "orders": [{"id": "o1", "name": "Haushaltsgeld", "amount": 40000, "from": "giro", "to": "haus", "interval": "m", "day": 1, "start": "2026-01-01", "u": 1},
                   {"id": "o2", "name": "Miete", "amount": 90000, "from": "giro", "to": "", "interval": "m", "day": 3, "start": "2026-01-03", "u": 1}],
        "skips": [{"order": "o1", "occ": "2026-03-01"}, {"order": "o2", "occ": "2026-03-03"}]}}, headers=H)
    # Freigeben
    check(A.post("/api/shares", json={"account": "giro2", "email": "frau@x.de"}, headers=H).status_code == 404, "unbekanntes Konto")
    check(A.post("/api/shares", json={"account": "haus", "email": "markus@x.de"}, headers=H).status_code == 400, "nicht an sich selbst")
    r = A.post("/api/shares", json={"account": "haus", "email": "Frau@x.de", "perm": "write"}, headers=H).json()
    check(r["registered"] and r["mail"], "Freigabe an Petra (schreiben)")
    sid_b = r["id"]
    sid_c = A.post("/api/shares", json={"account": "haus", "email": "sohn@x.de", "perm": "read"}, headers=H).json()["id"]
    r = A.post("/api/shares", json={"account": "haus", "email": "oma@x.de", "perm": "read"}, headers=H).json()
    check(not r["registered"], "Einladung an Oma (noch kein Konto)")
    ms = mails(); check(len(ms) == 3 and "Markus teilt ein Konto mit dir" in ms[0][1] and "Haushaltskonto" in ms[0][2] and "#register=oma@x.de" in ms[2][2], "drei Mails, Einladung mit Link")
    sh = A.get("/api/shares").json()["shares"]
    check(len(sh) == 3 and {s["email"]: s["pending"] for s in sh}["oma@x.de"], "Liste der Freigaben")
    # Petra sieht nur das Haushaltskonto
    d = B.get("/api/data").json()
    check(d["accounts"] == [] and len(d["shared"]) == 1, "eigene Daten leer, ein geteiltes Konto")
    s0 = d["shared"][0]
    check(s0["account"]["name"] == "Haushaltskonto" and s0["account"]["shared"]["perm"] == "write" and s0["owner"] == "Markus", "Konto mit Besitzer und Recht")
    check([t["id"] for t in s0["tx"]] == ["t1"], "nur Buchungen dieses Kontos (Geheim nicht)")
    check([o["id"] for o in s0["orders"]] == ["o1"] and s0["skips"] == [{"order": "o1", "occ": "2026-03-01"}], "nur Daueraufträge mit diesem Konto")
    check(B.get("/api/shares").json()["shares"][0]["dir"] == "in", "Petra sieht ihre Freigabe als eingehend")
    rev0 = B.get("/api/rev").json()["srev"]
    # Petra bucht auf das Haushaltskonto, legt einen Dauerauftrag von ihrem Giro an
    B.post("/api/sync", json={"upsert": {"accounts": [acc("pgiro", "Petras Giro", "giro")]}}, headers=H)
    r = B.post("/api/sync", json={"shared": {sid_b: {"upsert": {
        "tx": [{"id": "tp1", "acc": "haus", "date": "2026-02-05", "amount": -2599, "text": "Aldi", "u": 5},
               {"id": "tp2", "acc": "giro", "date": "2026-02-05", "amount": -1, "text": "Hack", "u": 5}],
        "orders": [{"id": "op1", "name": "Petra Haushalt", "amount": 30000, "from": "pgiro", "to": "haus", "interval": "m", "day": 1, "start": "2026-01-01", "u": 5}],
        "skips": [{"order": "o1", "occ": "2026-04-01"}]}, "delete": {"tx": ["t1"]}}}}, headers=H).json()
    check(any(x["id"] == "tp2" and "nicht zum geteilten" in x["why"] for x in r["rejected"]), "Buchung auf fremdes Konto abgelehnt")
    a = A.get("/api/data").json()
    check(sorted(t["id"] for t in a["tx"]) == ["t2", "tp1"], "Markus sieht Petras Buchung, t1 gelöscht: " + str([t["id"] for t in a["tx"]]))
    check("op1" in [o["id"] for o in a["orders"]] and {"order": "o1", "occ": "2026-04-01"} in a["skips"], "Dauerauftrag und Ausnahme beim Besitzer")
    check(B.get("/api/rev").json()["srev"] != rev0, "Stand der Freigabe geändert")
    check(psql("select count(*) from fin.bookings where id='tp2'") == "0", "keine Buchung auf Markus' Giro")
    # Tim darf nur lesen
    dt = C.get("/api/data").json(); check(len(dt["shared"]) == 1 and dt["shared"][0]["perm"] == "read", "Tim: lesen")
    r = C.post("/api/sync", json={"shared": {sid_c: {"upsert": {"tx": [{"id": "tt", "acc": "haus", "date": "2026-02-06", "amount": -1, "u": 1}]}, "delete": {"tx": ["tp1"]}}}}, headers=H).json()
    check(any(x["why"] == "nur Lesezugriff" for x in r["rejected"]) and psql("select count(*) from fin.bookings where id in ('tt','tp1')") == "1", "Tim kann nichts ändern")
    r = C.post("/api/sync", json={"shared": {sid_b: {"upsert": {"tx": [{"id": "tt", "acc": "haus", "date": "2026-02-06", "amount": -1, "u": 1}]}}}}, headers=H).json()
    check(any(x["why"] == "Freigabe nicht gefunden" for x in r["rejected"]), "fremde Freigabe-ID nutzt nichts")
    # Rechte ändern
    A.post(f"/api/shares/{sid_c}/perm", json={"perm": "write"}, headers=H)
    check(C.get("/api/data").json()["shared"][0]["perm"] == "write", "Recht geändert")
    check(B.post(f"/api/shares/{sid_c}/perm", json={"perm": "read"}, headers=H).status_code == 404, "nur der Besitzer ändert Rechte")
    # Oma registriert sich (Registrierung eigentlich geschlossen) und bestätigt
    for f in glob.glob("/tmp/mf_mails/*"): os.remove(f)
    r = Dd.post("/api/auth/register", json={"email": "oma@x.de", "name": "Oma", "password": "geheim12345"}, headers=H).json()
    check(r["verify"], "Oma darf sich trotz geschlossener Registrierung anmelden")
    check(Dd.post("/api/auth/register", json={"email": "fremd@x.de", "name": "F", "password": "geheim12345"}, headers=H).status_code == 403, "Fremde weiterhin nicht")
    tok = re.search(r"#verify=([\w-]+)", mails()[-1][2]).group(1)
    Dd.post("/api/auth/verify", json={"token": tok}, headers=H)
    check(len(Dd.get("/api/data").json()["shared"]) == 1, "Oma sieht das Konto nach der Bestätigung")
    # Verlassen und Zurücknehmen
    check(C.delete(f"/api/shares/{sid_c}", headers=H).status_code == 200 and C.get("/api/data").json()["shared"] == [], "Tim verlässt die Freigabe")
    check(A.delete(f"/api/shares/{sid_b}", headers=H).status_code == 200 and B.get("/api/data").json()["shared"] == [], "Markus nimmt Petras Freigabe zurück")
    r = B.post("/api/sync", json={"shared": {sid_b: {"upsert": {"tx": [{"id": "tz", "acc": "haus", "date": "2026-02-06", "amount": -1, "u": 1}]}}}}, headers=H).json()
    check(psql("select count(*) from fin.bookings where id='tz'") == "0", "danach kein Schreiben mehr")
    # Konto löschen entfernt Freigaben
    A.post("/api/sync", json={"delete": {"accounts": ["haus"]}}, headers=H)
    check(psql("select count(*) from fin.account_shares") == "0", "Konto gelöscht → Freigaben weg")
    # Eigener Abgleich bleibt getrennt: gleiche ID bei Petra löscht nichts bei Markus
    B.post("/api/sync", json={"delete": {"tx": ["t2"], "orders": ["o2"]}}, headers=H)
    check(psql("select count(*) from fin.bookings where id='t2'") == "1" and psql("select count(*) from fin.orders where id='o2'") == "1", "Löschen wirkt nur auf eigene Daten")
print("Freigaben ok:", n, "Prüfungen")
