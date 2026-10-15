"""Konto teilen im Browser: Markus gibt das Haushaltskonto frei, Petra bucht darauf, Tim darf nur lesen."""
import subprocess, glob, os, re, time, email
from playwright.sync_api import sync_playwright
U = "http://127.0.0.1:8800/"
psql = lambda q: subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","finanzen","-tAq","-c",q],capture_output=True,text=True).stdout.strip()
psql("TRUNCATE fin.users, fin.market_cache CASCADE")
for f in glob.glob("/tmp/mf_mails/*"): os.remove(f)
errs, n = [], 0
def ok(c, m):
    global n
    assert c, m; n += 1; print("ok:", m)
def last_mail_link():
    for _ in range(30):
        for f in sorted(glob.glob("/tmp/mf_mails/*"), reverse=True):
            m = email.message_from_string(open(f).read())
            t = next(p.get_payload(decode=True).decode() for p in m.walk() if p.get_content_type() == "text/plain")
            x = re.search(r"(http\S+#register=\S+)", t)
            if x: return x.group(1)
        time.sleep(0.3)
with sync_playwright() as p:
    b = p.chromium.launch()
    def user(name, mail, url=U):
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, bypass_csp=True); pg = ctx.new_page()
        pg.route("**/fonts.g*/**", lambda r: r.abort())
        pg.on("pageerror", lambda e: errs.append(name + ": " + str(e)))
        pg.on("console", lambda m: errs.append(name + ": " + m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
        pg.goto(url); pg.wait_for_selector("#gReg:not([hidden]), #gLogin:not([hidden])")
        if pg.is_hidden("#gReg"): pg.click("#gTabReg")
        pg.fill("#gRName", name)
        if not pg.input_value("#gREmail"): pg.fill("#gREmail", mail)
        pg.fill("#gRPw", "geheim12345"); pg.fill("#gRPw2", "geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
        return pg
    settle = lambda pg: pg.wait_for_function("!SH._pending()", timeout=15000)
    M = user("Markus", "markus@example.de")
    T = user("Tim", "tim@example.de")
    # Markus legt zwei Konten an
    def new_acc(pg, name, kind, start):
        pg.evaluate("SH.showView('einstellungen','konten')"); pg.fill("#aName", name); pg.select_option("#aKind", kind)
        pg.fill("#aStartDate", "2026-10-01"); pg.fill("#aStart", start); pg.click("#accSave"); settle(pg)
    new_acc(M, "Girokonto", "giro", "1.000,00"); new_acc(M, "Haushaltskonto", "haushalt", "300,00")
    # Freigaben
    M.evaluate("SH.showView('einstellungen','setshare')")
    ok(M.locator("#shAcc option:checked").inner_text() == "Haushaltskonto", "Haushaltskonto vorausgewählt")
    M.fill("#shMail", "petra@example.de"); M.click("#shGo"); M.wait_for_selector("#shOut li")
    ok("Einladung" in M.inner_text("#shMsg") and "Einladung offen" in M.inner_text("#shOut"), "Einladung an Petra (noch kein Konto)")
    link = last_mail_link(); ok(link and "petra%40example.de" in link or "petra@example.de" in (link or ""), "Einladungsmail mit Link")
    M.fill("#shMail", "tim@example.de"); M.select_option("#shPerm", "read"); M.click("#shGo"); M.wait_for_function("document.querySelectorAll('#shOut li').length==2")
    M.locator("#setshare").screenshot(path="shots/90_teilen.png")
    # Petra kommt über den Link
    P = user("Petra", "", link)
    P.evaluate("SH.showView('uebersicht')"); P.wait_for_timeout(300)
    tiles = P.inner_text("#tiles"); ok("Haushaltskonto" in tiles and "von markus" in tiles.lower() and "Girokonto" not in tiles, "Petra sieht nur das Haushaltskonto: " + tiles.replace("\n", " "))
    # Petra bucht
    P.evaluate("SH.showView('konten')"); P.click("#accPick [data-acc]")
    P.fill("#txDate", "2026-10-10"); P.fill("#txAmt", "45,90"); P.fill("#txText", "Wocheneinkauf"); P.click("#txSave"); settle(P)
    ok(psql("select u.name||':'||b.amount from fin.bookings b join fin.users u on u.id=b.user_id where b.text='Wocheneinkauf'") == "Markus:-4590", "Petras Buchung liegt bei Markus")
    P.screenshot(path="shots/91_petra_konto.png", full_page=True)
    # Markus sieht sie (Abruf)
    M.evaluate("SH._sync.reload=true; document.dispatchEvent(new Event('visibilitychange'))")
    M.wait_for_function("SH._D().tx.some(function(t){return t.text==='Wocheneinkauf'})", timeout=10000); ok(True, "Markus sieht Petras Buchung")
    M.evaluate("SH.showView('konten')"); M.locator("#accPick [data-acc]").nth(1).click(); M.wait_for_timeout(200)
    ok("geteilt mit" in M.inner_text("#accKind").lower(), "Markus sieht „geteilt mit …“: " + M.inner_text("#accKind"))
    # Tim: nur lesen
    T.reload(); T.wait_for_selector("#app:not([hidden])"); T.evaluate("SH.showView('konten')"); T.wait_for_timeout(300)
    ok("nur lesen" in T.inner_text("#accKind").lower(), "Tim: nur lesen")
    ok(T.is_disabled("#txSave"), "Tim: Buchen-Knopf gesperrt")
    T.evaluate("var D=SH._D();D.tx.push({id:'v1',acc:D.accounts[0].id,date:'2026-10-11',amount:-100,text:'Versuch',cat:'',u:Date.now()});SH.changed('fin')")
    T.wait_for_function("!document.getElementById('syncBar').hidden", timeout=10000)
    ok("nur zum Ansehen" in T.inner_text("#syncBar"), "Tim bekommt Hinweis")
    T.wait_for_function("!SH._D().tx.some(function(t){return t.text==='Versuch'})", timeout=10000)
    ok(psql("select count(*) from fin.bookings where text='Versuch'") == "0", "Tims Änderung verworfen")
    # Zurücknehmen
    M.evaluate("SH.showView('einstellungen','setshare')"); M.wait_for_timeout(200)
    btn = M.locator("#shOut [data-shdel]").first; btn.click(); btn.click(); M.wait_for_function("document.getElementById('shMsg').textContent.indexOf('zurückgenommen')>=0")
    P.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    P.wait_for_function("SH._D().accounts.length===0", timeout=10000); ok(True, "nach Zurücknehmen verschwindet das Konto bei Petra")
    ok(not [e for e in errs if "401" not in e and "403" not in e], "keine JS-Fehler " + str(errs))
    b.close()
print("Teilen im Browser ok:", n, "Prüfungen")
