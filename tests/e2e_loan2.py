"""Einfache Kredite: Rate ohne Konto, nach Tilgung ausblenden."""
import subprocess
from playwright.sync_api import sync_playwright
psql = lambda q: subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","finanzen","-tAq","-c",q],capture_output=True,text=True).stdout.strip()
psql("TRUNCATE fin.users, fin.market_cache CASCADE")
errs, n = [], 0
def ok(c, m):
    global n
    assert c, m; n += 1; print("ok:", m)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 900}, bypass_csp=True); pg = ctx.new_page()
    pg.route("**/fonts.g*/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
    settle = lambda: (pg.wait_for_timeout(150), pg.wait_for_function("!SH._pending()", timeout=15000))
    pg.goto("http://127.0.0.1:8800/"); pg.wait_for_selector("#gReg:not([hidden])")
    pg.fill("#gRName","M"); pg.fill("#gREmail","einfach@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("SH.showView('einstellungen','konten')")
    pg.fill("#aName","Girokonto"); pg.fill("#aStartDate","2026-01-01"); pg.fill("#aStart","2.500,00"); pg.click("#accSave"); settle()
    def loan(name, start, date, pay, hide=True):
        pg.fill("#aName", name); pg.select_option("#aKind", "kredit"); pg.fill("#aStartDate", date); pg.fill("#aStart", start)
        pg.fill("#aRate", ""); pg.fill("#aPay", pay); pg.select_option("#aPayDay", "1"); pg.select_option("#aPayFrom", "")
        if pg.is_checked("#aLoanHide") != hide: pg.click("#aLoanHide")
        pg.click("#accSave"); settle()
    pg.select_option("#aKind", "kredit")
    ok(pg.is_checked("#aLoanHide"), "„Nach der Tilgung ausblenden“ ist bei neuen Krediten an")
    ok(pg.eval_on_selector("#aPayFrom option", "o=>o.textContent").startswith("kein Konto"), "Rate ohne Konto wählbar")
    pg.select_option("#aKind", "giro")
    loan("Ratenkauf Sofa", "600,00", "2026-01-10", "100")          # getilgt am 01.07.2026
    loan("Handy", "480,00", "2026-09-10", "40")                    # läuft noch
    loan("Alter Kredit", "200,00", "2026-01-10", "100", hide=False)  # getilgt, aber sichtbar
    rows = psql("select name||'|'||coalesce(loan_pay_from,'-')||'|'||coalesce(extra->>'loanHide','-') from fin.accounts order by name")
    ok("Ratenkauf Sofa|-|true" in rows and "Alter Kredit|-|-" in rows, "gespeichert ohne Konto: " + rows.replace("\n", ", "))
    giro = pg.evaluate("FIN.summary().accounts.filter(a=>a.name=='Girokonto')[0].now")
    ok(giro == 250000, "Girokonto unberührt: %d" % giro)
    pg.evaluate("SH.showView('uebersicht')"); pg.wait_for_timeout(200); t = pg.inner_text("#tiles")
    ok("Ratenkauf Sofa" not in t and "Handy" in t and "Alter Kredit" in t, "Übersicht ohne getilgten Kredit")
    pg.evaluate("SH.showView('konten')"); pg.wait_for_timeout(200)
    ok("Ratenkauf Sofa" not in pg.inner_text("#accPick"), "Konten-Auswahl ohne getilgten Kredit")
    pg.evaluate("SH.showView('auftraege')"); pg.wait_for_timeout(200); o = pg.inner_text("#ordBody")
    ok("Ratenkauf Sofa" not in o and "Handy" in o, "Daueraufträge ohne getilgten Kredit")
    pg.evaluate("SH.showView('kredite')"); pg.wait_for_timeout(200)
    k = pg.inner_text("#loanPick"); ok("Ratenkauf Sofa" not in k and "Handy" in k, "Kredite ohne getilgten Kredit: " + k.replace("\n", " "))
    ok(pg.inner_text("#nmOrd") == "2", "Daueraufträge-Zähler: " + pg.inner_text("#nmOrd"))
    ok(pg.inner_text("#nmLoan") == "2", "Zähler im Menü: " + pg.inner_text("#nmLoan"))
    pg.evaluate("SH.showView('dashboard')"); pg.wait_for_timeout(300)
    ok("Ratenkauf Sofa" not in pg.inner_text("section[data-view=dashboard]"), "Dashboard ohne getilgten Kredit")
    pg.evaluate("SH.showView('einstellungen','konten')"); pg.wait_for_timeout(200); s = pg.inner_text("#accList")
    ok("Ratenkauf Sofa" in s and "getilgt am 01.07.2026" in s and "ausgeblendet" in s, "Einstellungen zeigen ihn als getilgt")
    # Wieder einblenden
    pg.locator("#accList li", has_text="Ratenkauf Sofa").locator("[data-eacc]").click()
    ok(pg.is_checked("#aLoanHide"), "Bearbeiten: Häkchen gesetzt"); pg.click("#aLoanHide"); pg.click("#accSave"); settle()
    pg.evaluate("SH.showView('kredite')"); pg.wait_for_timeout(200)
    ok("Ratenkauf Sofa" in pg.inner_text("#loanPick"), "Häkchen weg → wieder sichtbar")
    # Alle getilgt
    pg.evaluate("var D=SH._D();D.accounts.forEach(a=>{if(a.kind==='kredit'&&a.name!=='Handy')a.loanHide=true;if(a.name==='Handy'){a.loanHide=true;a.start.amount=-4000;a.start.date='2026-01-10'}});SH.changed('fin')"); settle()
    pg.reload(); pg.wait_for_selector("#app:not([hidden])"); pg.evaluate("SH.showView('kredite')"); pg.wait_for_timeout(300)
    ok(pg.is_visible("#loanNone") and pg.is_hidden("#loanGrid"), "keine Kreditansicht mehr")
    ok("Alle 3 Kredite sind getilgt und ausgeblendet" in pg.inner_text("#loanNone"), "Hinweis, wenn alle getilgt sind: " + pg.inner_text("#loanNone"))
    pg.screenshot(path="shots/98_kredite_getilgt.png")
    pg.evaluate("SH.showView('einstellungen','konten')"); pg.select_option("#aKind", "kredit"); pg.locator("label.loanhide .hlp").hover(); pg.wait_for_timeout(150)
    pg.locator("label.loanhide").scroll_into_view_if_needed(); pg.locator("label.loanhide .hlp").hover(); pg.wait_for_timeout(150)
    ok("verschwindet" in pg.inner_text("#tipBox"), "Hilfe zum Ausblenden")
    pg.screenshot(path="shots/99_kredit_einfach.png")
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("Einfache Kredite ok:", n, "Prüfungen")
