"""Kurse, Suche, News und Mail-Alarme gegen nachgebaute Quellen."""
import os, sys, glob, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "server"))
os.environ.update({"DATABASE_URL": "postgresql://finanzen_app:test@127.0.0.1:5433/finanzen", "COOKIE_SECURE": "0", "REGISTRATION": "open",
                   "SRC_ONVISTA": "http://127.0.0.1:8782/ov/", "SRC_ECB": "http://127.0.0.1:8782/ecb.xml", "SRC_NEWS": "http://127.0.0.1:8784/rss/search",
                   "SRC_Y_CHART": "http://127.0.0.1:8782/yahoo/chart/", "SRC_Y_SEARCH": "http://127.0.0.1:8782/yahoo/search",
                   "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "8825", "SMTP_TLS": "none", "MAIL_FROM": "depot@example.de", "APP_URL": "https://finanzen.example.de"})
from fastapi.testclient import TestClient
from finanzen.main import app
from finanzen import alerts
H = {"X-Requested-With": "finanzen"}

def mail_text(raw):
    """Textfassung einer Mail (auch bei HTML-Mails mit Logo)."""
    import email as _em, email.header as _eh
    m = _em.message_from_string(raw)
    subj = str(_eh.make_header(_eh.decode_header(m["Subject"])))
    for part in m.walk():
        if part.get_content_type() == "text/plain":
            return subj + "\n" + part.get_payload(decode=True).decode("utf-8")
    return subj
n = 0
def check(c, m):
    global n
    if not c: print("FEHLER:", m); sys.exit(1)
    n += 1
psql = lambda q: subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "finanzen", "-tAq", "-c", q], capture_output=True, text=True).stdout.strip()
psql("TRUNCATE fin.users, fin.market_cache CASCADE")
for f in glob.glob("/tmp/mf_mails/*"): os.remove(f)
with TestClient(app) as A:
    A.post("/api/auth/register", json={"email": "m@x.de", "name": "Markus", "password": "geheim12345"}, headers=H)
    j = A.get("/api/market/quotes?s=OV:STOCK:DE0007164600,USDEUR=X,OV:STOCK:XX0000000000,SAP.DE").json()
    q = j["quotes"]
    check(q["OV:STOCK:DE0007164600"]["price"] == 214.35 and q["OV:STOCK:DE0007164600"]["prev"] == 212.0, "onvista Kurs")
    check(abs(q["USDEUR=X"]["price"] - round(1 / 1.0915, 6)) < 1e-9, "EZB")
    check("OV:STOCK:XX0000000000" not in q and "429" in j["errors"]["SAP.DE"], "Fehler sauber gemeldet " + str(j["errors"]))
    check(psql("SELECT count(*) FROM fin.market_cache WHERE key LIKE 'q:%'") == "2", "Cache")
    h = A.get("/api/market/history?s=OV:STOCK:DE0007164600&r=1y").json()
    check(len(h["points"]) == 250 and h["points"][-1][1] > h["points"][0][1], "Verlauf")
    s = A.get("/api/market/search?q=sap").json()
    check(s["results"][0]["symbol"] == "OV:STOCK:DE0007164600" and len(s["results"]) == 1, "Suche (ohne Derivate)")
    check(A.get("/api/market/search?q=x").status_code == 400, "Suche zu kurz")
    nw = A.get("/api/market/news?q=SAP").json()["items"]
    check(len(nw) == 4 and nw[0]["source"] == "Testquelle 1" and nw[0]["title"] == "SAP meldet Quartalszahlen Nr. 1 & mehr", "News " + str(nw[:1]))
    # Alarme
    A.post("/api/sync", json={"upsert": {"alerts": [
        {"id": "a1", "sym": "OV:STOCK:DE0007164600", "name": "SAP SE", "type": "above", "value": 200, "u": 1},
        {"id": "a2", "sym": "OV:STOCK:DE0008404005", "name": "Allianz SE", "type": "below", "value": 100, "u": 1},
        {"id": "a3", "sym": "OV:STOCK:US0378331005", "name": "Apple", "type": "dayUp", "value": 1, "u": 1},
        {"id": "a4", "sym": "OV:STOCK:US0378331005", "name": "Apple", "type": "dayMove", "value": 1, "u": 1},
        {"id": "a5", "sym": "OV:STOCK:DE0008404005", "name": "Allianz SE", "type": "dayMove", "value": 1, "u": 1}]}}, headers=H)
    r = alerts.run(); check(r["users"] == 0, "Mail-Alarme aus -> niemand")
    A.post("/api/auth/profile", json={"alert_mail": True}, headers=H)
    r = alerts.run(); check(r == {"users": 1, "sent": 3, "errors": 0}, "drei Alarme (Allianz ±1 % nicht erreicht) " + str(r))
    mails = glob.glob("/tmp/mf_mails/*"); check(len(mails) == 1, "eine Sammelmail")
    txt = mail_text(open(mails[0]).read()); raw = open(mails[0]).read()
    check("SAP SE: steigt auf 200,00" in txt and "Apple: steigt heute um 1,0\u00a0%" in txt and "Apple: bewegt sich heute um ±\u00a01,0\u00a0%" in txt and "Allianz" not in txt and "https://finanzen.example.de/#alarme" in txt and "text/html" in raw and "cid:logo" in raw and "Content-ID: <logo>" in raw, txt[-600:])
    r = alerts.run(); check(r["sent"] == 0, "nicht doppelt")
    psql("UPDATE fin.market_cache SET data = jsonb_set(data, '{price}', '150') WHERE key = 'q:OV:STOCK:DE0007164600'")
    alerts.run(); check(psql("SELECT mail_armed FROM fin.price_alerts WHERE id='a1'") == "t", "wieder scharf, wenn Kurs zurück")
    psql("UPDATE fin.market_cache SET data = jsonb_set(data, '{price}', '210') WHERE key = 'q:OV:STOCK:DE0007164600'")
    r = alerts.run(); check(r["sent"] == 1, "erneut ausgelöst")
    st = A.get("/api/alerts/status").json(); check(st["enabled"] and "a1" in st["fired"] and st["lastError"] == "", "Status")
    check(A.post("/api/alerts/testmail", headers=H).json()["email"] == "m@x.de", "Testmail")
    check(len(glob.glob("/tmp/mf_mails/*")) == 3, "drei Mails")
print("Markt & Alarme ok:", n, "Prüfungen")
