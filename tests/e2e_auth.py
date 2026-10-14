"""Anmeldung im Browser: Registrieren mit Bestätigungslink, Passwort vergessen, Zwei-Faktor einrichten und nutzen.
Braucht einen Server auf Port 8801 mit VERIFY_EMAIL=auto und APP_URL=http://127.0.0.1:8801 (siehe run_server.sh)."""
import os, sys, glob, re, time, subprocess, email, email.header
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
from finanzen import totp
from playwright.sync_api import sync_playwright
U = "http://127.0.0.1:8801/"
psql = lambda q: subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","finanzen","-tAq","-c",q],capture_output=True,text=True).stdout.strip()
psql("TRUNCATE fin.users, fin.market_cache CASCADE")
for f in glob.glob("/tmp/mf_mails/*"): os.remove(f)
def last_link(kind, timeout=8):
    t0 = time.time()
    while time.time() - t0 < timeout:
        for f in sorted(glob.glob("/tmp/mf_mails/*"), reverse=True):
            m = email.message_from_string(open(f).read())
            body = next(pt.get_payload(decode=True).decode() for pt in m.walk() if pt.get_content_type() == "text/plain")
            m = re.search(r"(http\S+#" + kind + r"=[A-Za-z0-9_\-]+)", body)
            if m: return m.group(1)
        time.sleep(0.3)
errs, n = [], 0
def ok(c, m):
    global n
    assert c, m; n += 1; print("ok:", m)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 900}, bypass_csp=True)
    pg = ctx.new_page(); pg.route("**/fonts.g*/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and not re.search(r"ERR_FAILED|40[0-3]|429", m.text) else None)
    shot = lambda name: pg.screenshot(path=f"shots/{name}.png", full_page=True)
    # 1. erstes Konto (Verwalter) direkt
    pg.goto(U); pg.wait_for_selector("#gReg:not([hidden])"); ok(pg.is_hidden("#gTabs"), "erstes Konto: ohne Reiter, direkt Registrieren")
    shot("60_erstes_konto")
    pg.fill("#gRName","Markus"); pg.fill("#gREmail","markus@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo")
    pg.wait_for_selector("#app:not([hidden])"); ok(True, "Verwalter angemeldet")
    pg.evaluate("SH.showView('einstellungen')"); pg.click("#uLogout"); pg.wait_for_selector("#gLogin:not([hidden])")
    ok(pg.is_visible("#gTabs") and pg.is_visible("#gForgotLnk"), "Anmeldemaske mit Reitern und „Passwort vergessen?“")
    shot("61_login")
    # 2. Registrieren mit Bestätigung
    pg.click("#gTabReg"); pg.fill("#gRName","Petra"); pg.fill("#gREmail","petra@example.de"); pg.fill("#gRPw","kurz"); pg.fill("#gRPw2","kurz"); pg.click("#gRGo")
    ok("mindestens 10" in pg.inner_text("#gRErr"), "zu kurzes Passwort")
    pg.fill("#gRPw","Sonnenschein am Meer"); pg.fill("#gRPw2","Sonnenschein am Meer")
    ok(pg.get_attribute("#gRMeter","data-s") in ("3","4"), "Stärkeanzeige: gut")
    pg.click("[data-eye=gRPw]"); ok(pg.get_attribute("#gRPw","type") == "text", "Passwort anzeigen"); pg.click("[data-eye=gRPw]")
    shot("62_registrieren")
    pg.click("#gRGo"); pg.wait_for_selector("#gInfo:not([hidden])")
    ok("petra@example.de" in pg.inner_text("#gInfoTxt"), "Hinweis: Mail verschickt"); shot("63_mail_verschickt")
    pg.click("#gInfoBack"); pg.fill("#gEmail","petra@example.de"); pg.fill("#gPw","Sonnenschein am Meer"); pg.click("#gGo")
    pg.wait_for_selector("#gUnverified:not([hidden])"); ok("bestätige" in pg.inner_text("#gErr"), "Login vor Bestätigung gesperrt, Link erneut anforderbar")
    link = last_link("verify"); ok(link and link.startswith("http://127.0.0.1:8801/#verify="), "Bestätigungslink in der Mail")
    pg.goto(link); pg.wait_for_selector("#app:not([hidden])", timeout=15000)
    ok(pg.evaluate("location.hash").find("verify") < 0 and pg.inner_text("#profName") == "Petra", "Link bestätigt und meldet an")
    # 3. Passwort vergessen
    pg.evaluate("SH.showView('einstellungen')"); pg.click("#uLogout"); pg.wait_for_selector("#gLogin:not([hidden])")
    pg.fill("#gEmail","petra@example.de"); pg.click("#gForgotLnk"); ok(pg.input_value("#gFEmail") == "petra@example.de", "E-Mail übernommen")
    shot("64_vergessen")
    for f in glob.glob("/tmp/mf_mails/*"): os.remove(f)
    pg.click("#gFGo"); pg.wait_for_selector("#gInfo:not([hidden])"); ok("Postfach" in pg.inner_text("#gInfoTxt"), "Hinweis nach Anforderung")
    link = last_link("reset"); ok(link, "Reset-Link in der Mail")
    pg.goto(link); pg.wait_for_selector("#gReset:not([hidden])")
    ok(pg.inner_text("#gResetMail") == "petra@example.de" and pg.is_hidden("#gNCodeWrap"), "Formular neues Passwort")
    shot("65_neues_passwort")
    pg.fill("#gNPw","Regen im Herbst 2026"); pg.fill("#gNPw2","Regen im Herbst 2026"); pg.click("#gNGo"); pg.wait_for_selector("#app:not([hidden])")
    ok(True, "neues Passwort gesetzt und angemeldet")
    # 4. Zwei-Faktor einrichten
    pg.evaluate("SH.showView('einstellungen','setuser')"); pg.click("#tfaSetup"); ok("Passwort" in pg.inner_text("#tfaMsg"), "Einrichten fragt Passwort")
    pg.fill("#tfaPw","Regen im Herbst 2026"); pg.click("#tfaSetup"); pg.wait_for_selector("#tfaSetupBox:not([hidden]) svg")
    secret = pg.inner_text("#tfaKey").replace(" ", ""); ok(len(secret) == 32, "QR-Code und Schlüssel angezeigt")
    pg.locator("#setuser").screenshot(path="shots/66_2fa_einrichten.png")
    pg.fill("#tfaCode","000000"); pg.click("#tfaEnable"); pg.wait_for_function("document.getElementById('tfaMsg').textContent.indexOf('stimmt nicht')>=0", timeout=5000); ok(True, "falscher Code abgelehnt")
    pg.fill("#tfaCode", totp.now_code(secret)); pg.click("#tfaEnable"); pg.wait_for_selector("#tfaCodesBox:not([hidden])")
    codes = pg.eval_on_selector_all("#tfaCodes code", "e=>e.map(x=>x.textContent)"); ok(len(codes) == 10, "10 Notfall-Codes angezeigt")
    pg.locator("#setuser").screenshot(path="shots/67_2fa_codes.png")
    pg.click("#tfaCodesDone"); ok(pg.inner_text("#tfaState").startswith("an · 10"), "Status: an, 10 Codes")
    # 5. Anmelden mit Code (nächster Zeitschritt, der aktuelle ist verbraucht)
    pg.click("#uLogout"); pg.wait_for_selector("#gLogin:not([hidden])")
    pg.fill("#gEmail","petra@example.de"); pg.fill("#gPw","Regen im Herbst 2026"); pg.uncheck("#gRemember"); pg.click("#gGo")
    pg.wait_for_selector("#gTotp:not([hidden])"); ok(True, "Login fragt nach Code"); shot("68_code")
    pg.fill("#gCode","12"); pg.click("#gTotpGo"); pg.wait_for_function("document.getElementById('gTotpErr').textContent.length>0")
    ok("stimmt nicht" in pg.inner_text("#gTotpErr"), "falscher Code")
    pg.fill("#gCode", totp._code(secret, int(time.time()) // 30 + 1)); pg.wait_for_selector("#app:not([hidden])", timeout=10000)
    ok(True, "6 Ziffern: meldet automatisch an")
    ck = [c for c in ctx.cookies() if c["name"] == "fin_session"][0]; ok(ck["expires"] == -1, "ohne „angemeldet bleiben“: Sitzungs-Cookie")
    pg.evaluate("SH.showView('einstellungen')"); pg.click("#uLogout"); pg.wait_for_selector("#gLogin:not([hidden])")
    pg.fill("#gEmail","petra@example.de"); pg.fill("#gPw","Regen im Herbst 2026"); pg.check("#gRemember"); pg.click("#gGo"); pg.wait_for_selector("#gTotp:not([hidden])")
    pg.fill("#gCode", codes[0]); pg.click("#gTotpGo"); pg.wait_for_selector("#app:not([hidden])")
    ok([c for c in ctx.cookies() if c["name"] == "fin_session"][0]["expires"] > time.time() + 20 * 86400, "Notfall-Code, angemeldet bleiben 30 Tage")
    ok(not errs, "keine JS-Fehler " + str(errs))
    # Handy-Ansicht der Anmeldung
    m = b.new_context(viewport={"width": 390, "height": 844}).new_page(); m.route("**/fonts.g*/**", lambda r: r.abort())
    m.goto(U); m.wait_for_selector("#gLogin:not([hidden])"); m.screenshot(path="shots/69_login_mobil.png")
    b.close()
print("Anmeldung im Browser ok:", n, "Prüfungen")
