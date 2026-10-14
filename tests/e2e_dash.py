"""Dashboard: leer, mit Beispieldaten, Klickziele, Handy-Ansicht."""
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
    settle = lambda: pg.wait_for_function("!SH._pending()", timeout=15000)
    pg.goto("http://127.0.0.1:8800/"); pg.wait_for_selector("#gReg:not([hidden])")
    pg.fill("#gRName","Markus"); pg.fill("#gREmail","dash@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    ok(pg.evaluate("location.hash") == "#dashboard" and pg.is_visible("section[data-view=dashboard]"), "Start auf dem Dashboard")
    ok("noch keine Positionen" in pg.inner_text("#dbKpis") and "Finanzplan anlegen" in pg.inner_text("#dbMonth"), "leeres Dashboard mit Hinweisen")
    pg.evaluate("SH.showView('uebersicht')"); pg.click("#loadDemo"); settle()
    pg.evaluate("SH.showView('depot')"); pg.click("#dpLoadDemo"); pg.wait_for_timeout(800); settle()
    pg.evaluate("SH.showView('dashboard')"); pg.wait_for_timeout(300)
    k = pg.inner_text("#dbKpis"); print(k.replace("\n", " | "))
    ok("NETTOVERMÖGEN" in k.upper() and "DEPOT" in k.upper() and "KREDITE" in k.upper(), "Kennzahlen")
    net = pg.evaluate("(function(){var F=FIN.summary(),c=0;F.accounts.forEach(function(a){c+=a.now});return c+DEP.value()})()")
    shown = pg.inner_text("#dbKpis .dbk:first-child b").replace("−","-").replace(".","").replace(" €","")
    ok(abs(int(shown) - round(net/100)) <= 1, f"Nettovermögen stimmt: {shown} €")
    ok(pg.locator("#dbChart svg").count() == 1, "Vermögensverlauf")
    ok("Sparquote" in pg.inner_text("#dbMonth"), "dieser Monat mit Plan und Sparquote")
    ok("Depot" in pg.inner_text("#dbSplitList") and "Kredite" in pg.inner_text("#dbSplitList"), "Aufteilung inkl. Depot und Kredite")
    ok("getilgt" in pg.inner_text("#dbGoals") and "Urlaubskonto" in pg.inner_text("#dbGoals"), "Kredite und Sparziele")
    ok(pg.locator("#dbSoon li").count() >= 1, "Demnächst")
    ok(pg.inner_text("#nmDash") != "", "Summe im Menü")
    pg.screenshot(path="shots/80_dashboard.png", full_page=True)
    pg.click("#dbKpis .dbk:nth-child(4)"); ok(pg.evaluate("location.hash") == "#kredite", "Klick auf Kredite öffnet Kredite")
    pg.evaluate("SH.showView('dashboard')"); pg.wait_for_timeout(200)
    if pg.locator("#dbDepot [data-pos]").count():
        pg.locator("#dbDepot [data-pos]").first.click(); ok(pg.evaluate("location.hash") == "#position", "Klick auf Gewinner öffnet Position")
    # Änderung im Depot aktualisiert das Dashboard
    pg.evaluate("SH.showView('dashboard')"); before = pg.inner_text("#dbKpis .dbk:nth-child(3) b")
    pg.evaluate("var D=SH._D();D.pos[0].tx.push({id:'x1',type:'buy',date:'2026-10-01',qty:10,price:100,fee:0,amount:0,u:Date.now()});SH.changed('dep')"); pg.wait_for_timeout(600)
    ok(pg.inner_text("#dbKpis .dbk:nth-child(3) b") != before, "Dashboard aktualisiert sich nach Änderung")
    m = b.new_context(viewport={"width": 390, "height": 844}, bypass_csp=True); mp = m.new_page(); mp.route("**/fonts.g*/**", lambda r: r.abort())
    mp.goto("http://127.0.0.1:8800/"); mp.wait_for_selector("#gLogin:not([hidden])"); mp.fill("#gEmail","dash@example.de"); mp.fill("#gPw","geheim12345"); mp.click("#gGo"); mp.wait_for_selector("#app:not([hidden])"); mp.wait_for_timeout(500)
    ok(mp.evaluate("document.documentElement.scrollWidth<=390"), "Handy: kein seitliches Scrollen")
    mp.screenshot(path="shots/81_dashboard_mobil.png", full_page=True)
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("Dashboard ok:", n, "Prüfungen")
