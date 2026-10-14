"""Registrieren mit E-Mail-Bestätigung, Passwort vergessen, Zwei-Faktor (TOTP) und Notfall-Codes."""
import os, sys, glob, re, time, subprocess, email.header
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "server"))
os.environ.update({"DATABASE_URL": "postgresql://finanzen_app:test@127.0.0.1:5433/finanzen", "COOKIE_SECURE": "0", "REGISTRATION": "open",
                   "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "8825", "SMTP_TLS": "none", "MAIL_FROM": "finanzen@example.de", "APP_URL": "https://f.example.de"})
from fastapi.testclient import TestClient
from finanzen.main import app
from finanzen import totp
H = {"X-Requested-With": "finanzen"}
n = 0
def check(c, m):
    global n
    if not c: print("FEHLER:", m); sys.exit(1)
    n += 1
psql = lambda q: subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "finanzen", "-tAq", "-c", q], capture_output=True, text=True).stdout.strip()
psql("TRUNCATE fin.users, fin.market_cache CASCADE")

def mail_text(raw):
    """Textfassung einer Mail (auch bei HTML-Mails mit Logo)."""
    import email as _em, email.header as _eh
    m = _em.message_from_string(raw)
    subj = str(_eh.make_header(_eh.decode_header(m["Subject"])))
    for part in m.walk():
        if part.get_content_type() == "text/plain":
            return subj + "\n" + part.get_payload(decode=True).decode("utf-8")
    return subj
def clear():
    for f in glob.glob("/tmp/mf_mails/*"): os.remove(f)
def mails():
    out = []
    for f in sorted(glob.glob("/tmp/mf_mails/*")):
        out.append(mail_text(open(f).read()))
    return out
def link(kind):
    for m in reversed(mails()):
        x = re.search(r"#" + kind + r"=([A-Za-z0-9_\-]+)", m.replace("=\n", ""))
        if x: return x.group(1)
clear()
with TestClient(app) as A, TestClient(app) as B, TestClient(app) as C:
    st = A.get("/api/auth/me").json()["registration"]
    check(st["verify"] and st["reset"] and st["first"], "Zustand: Bestätigung und Zurücksetzen aktiv " + str(st))
    # erstes Konto: direkt angemeldet (Verwalter), keine Bestätigung
    r = A.post("/api/auth/register", json={"email": "admin@x.de", "name": "Admin", "password": "geheim12345"}, headers=H).json()
    check(r["verify"] is False and A.get("/api/auth/me").json()["user"]["is_admin"], "erstes Konto ohne Bestätigung")
    check(A.post("/api/auth/register", json={"email": "z@x.de", "name": "Z", "password": "aaaaaaaaaaaa"}, headers=H).status_code == 400, "zu einfaches Passwort")
    # zweites Konto: Bestätigung nötig
    r = B.post("/api/auth/register", json={"email": "Petra@x.de", "name": "Petra", "password": "geheim12345"}, headers=H).json()
    check(r["verify"] and B.get("/api/auth/me").json()["user"] is None, "Registrierung wartet auf Bestätigung")
    tok = link("verify"); check(tok and "Bitte bestätige" in mails()[-1] and "https://f.example.de/#verify=" in mails()[-1].replace("=\n", ""), "Bestätigungsmail mit Link")
    r = B.post("/api/auth/login", json={"email": "petra@x.de", "password": "geheim12345"}, headers=H)
    check(r.status_code == 403 and r.json()["need"] == "verify", "Login vor Bestätigung gesperrt")
    clear(); B.post("/api/auth/verify/resend", json={"email": "petra@x.de"}, headers=H)
    tok2 = link("verify"); check(tok2 and tok2 != tok, "Link erneut gesendet")
    check(B.post("/api/auth/verify", json={"token": tok}, headers=H).status_code == 400, "alter Link ungültig nach erneutem Senden")
    check(B.post("/api/auth/verify", json={"token": tok2}, headers=H).status_code == 200 and B.get("/api/auth/me").json()["user"]["email"] == "petra@x.de", "bestätigt und angemeldet")
    check(B.post("/api/auth/verify", json={"token": tok2}, headers=H).status_code == 400, "Link nur einmal")
    # doppelte Registrierung verrät nichts
    clear(); r = C.post("/api/auth/register", json={"email": "petra@x.de", "name": "X", "password": "andersgeheim1"}, headers=H)
    check(r.status_code == 200 and r.json()["verify"] and "Anmeldeversuch" in mails()[-1], "doppelte Adresse: gleiche Antwort, Hinweis-Mail")
    # Passwort vergessen
    clear(); r = C.post("/api/auth/forgot", json={"email": "gibtsnicht@x.de"}, headers=H)
    check(r.status_code == 200 and not mails(), "unbekannte Adresse: gleiche Antwort, keine Mail")
    C.post("/api/auth/forgot", json={"email": "petra@x.de"}, headers=H); rt = link("reset")
    check(rt and "60 Minuten" in mails()[-1], "Reset-Mail")
    check(C.post("/api/auth/reset/check", json={"token": rt}, headers=H).json() == {"ok": True, "email": "petra@x.de", "totp": False}, "Reset-Link prüfen")
    check(C.post("/api/auth/reset", json={"token": rt, "password": "kurz"}, headers=H).status_code == 400, "Reset: Passwort zu kurz")
    check(C.post("/api/auth/reset", json={"token": rt, "password": "neuespasswort1"}, headers=H).status_code == 200, "Reset ok")
    check(B.get("/api/data").status_code == 401, "alte Sitzungen nach Reset beendet")
    check(C.get("/api/auth/me").json()["user"]["email"] == "petra@x.de", "nach Reset angemeldet")
    check(C.post("/api/auth/reset", json={"token": rt, "password": "nocheinmal123"}, headers=H).status_code == 400, "Reset-Link nur einmal")
    check(B.post("/api/auth/login", json={"email": "petra@x.de", "password": "geheim12345"}, headers=H).status_code == 401, "altes Passwort ungültig")
    # Zwei-Faktor
    check(C.post("/api/auth/totp/setup", json={"password": "falsch"}, headers=H).status_code == 400, "Einrichten braucht Passwort")
    s = C.post("/api/auth/totp/setup", json={"password": "neuespasswort1"}, headers=H).json()
    check(s["svg"].startswith("<svg") and s["uri"].startswith("otpauth://totp/") and len(s["secret"]) == 32, "QR-Code und Geheimnis")
    check(C.post("/api/auth/totp/enable", json={"code": "123456"}, headers=H).status_code == 400, "falscher Code beim Einschalten")
    e = C.post("/api/auth/totp/enable", json={"code": totp.now_code(s["secret"])}, headers=H).json()
    check(len(e["recovery"]) == 10 and C.get("/api/auth/me").json()["user"]["totp"], "Zwei-Faktor an, 10 Notfall-Codes")
    C.post("/api/auth/logout", json={}, headers=H)
    r = C.post("/api/auth/login", json={"email": "petra@x.de", "password": "neuespasswort1"}, headers=H)
    check(r.status_code == 401 and r.json()["need"] == "totp", "Login fragt nach Code")
    check(C.post("/api/auth/login", json={"email": "petra@x.de", "password": "neuespasswort1", "code": "000000"}, headers=H).json()["need"] == "totp", "falscher Code")
    # Code aus dem Einschalten ist schon verbraucht -> auf nächsten Zeitschritt warten wäre langsam; daher Code eines künftigen Schritts
    nxt = totp._code(s["secret"], int(time.time()) // 30 + 1)
    r = C.post("/api/auth/login", json={"email": "petra@x.de", "password": "neuespasswort1", "code": nxt, "remember": False}, headers=H)
    check(r.status_code == 200 and "max-age" not in r.headers.get("set-cookie", "").lower(), "Login mit Code, Sitzungs-Cookie ohne „angemeldet bleiben“")
    C.post("/api/auth/logout", json={}, headers=H)
    check(C.post("/api/auth/login", json={"email": "petra@x.de", "password": "neuespasswort1", "code": nxt}, headers=H).status_code == 401, "gleicher Code nicht zweimal")
    rc = e["recovery"][0]
    check(C.post("/api/auth/login", json={"email": "petra@x.de", "password": "neuespasswort1", "code": rc.upper()}, headers=H).status_code == 200, "Login mit Notfall-Code")
    check(C.get("/api/auth/me").json()["user"]["recovery_left"] == 9, "Notfall-Code verbraucht")
    C.post("/api/auth/logout", json={}, headers=H)
    check(C.post("/api/auth/login", json={"email": "petra@x.de", "password": "neuespasswort1", "code": rc}, headers=H).status_code == 401, "Notfall-Code nur einmal")
    # Reset mit Zwei-Faktor braucht Code
    clear(); C.post("/api/auth/forgot", json={"email": "petra@x.de"}, headers=H); rt = link("reset")
    check(C.post("/api/auth/reset/check", json={"token": rt}, headers=H).json()["totp"], "Reset weiß von Zwei-Faktor")
    r = C.post("/api/auth/reset", json={"token": rt, "password": "drittespasswort1"}, headers=H)
    check(r.status_code == 401 and r.json()["need"] == "totp", "Reset ohne Code abgelehnt")
    check(C.post("/api/auth/reset", json={"token": rt, "password": "drittespasswort1", "code": e["recovery"][1]}, headers=H).status_code == 200, "Reset mit Notfall-Code")
    # Notfall-Codes neu, Zwei-Faktor aus
    newc = C.post("/api/auth/totp/recovery", json={"password": "drittespasswort1"}, headers=H).json()["recovery"]
    check(len(newc) == 10 and C.get("/api/auth/me").json()["user"]["recovery_left"] == 10, "neue Notfall-Codes")
    check(C.post("/api/auth/totp/disable", json={"password": "drittespasswort1", "code": "111111"}, headers=H).status_code == 400, "Ausschalten braucht Code")
    check(C.post("/api/auth/totp/disable", json={"password": "drittespasswort1", "code": e["recovery"][2]}, headers=H).status_code == 400, "alte Notfall-Codes ungültig")
    check(C.post("/api/auth/totp/disable", json={"password": "drittespasswort1", "code": newc[0]}, headers=H).status_code == 200, "Ausschalten mit Notfall-Code")
    check(not C.get("/api/auth/me").json()["user"]["totp"] and psql("select totp_secret is null from fin.users where email='petra@x.de'") == "t", "Zwei-Faktor aus, Geheimnis gelöscht")
    check(psql("select count(*) from fin.auth_tokens") in ("0", "1"), "Tokens aufgeräumt")
    check(subprocess.run(["psql", "-h", "127.0.0.1", "-p", "5433", "-U", "finanzen_app", "-d", "finanzen", "-tAc", "select * from fin.auth_tokens"], capture_output=True, text=True, env={**os.environ, "PGPASSWORD": "test"}).returncode != 0, "App-Rolle kann Tokens nicht lesen")
print("Auth ok:", n, "Prüfungen")
