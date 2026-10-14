import sys, json, subprocess
from playwright.sync_api import sync_playwright
U = "http://127.0.0.1:8800/"
errs = []
psql = lambda q: subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","finanzen","-tAq","-c",q],capture_output=True,text=True).stdout.strip()
def page(ctx):
    pg = ctx.new_page()
    pg.route("**/fonts.googleapis.com/**", lambda r: r.abort()); pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    return pg
def settle(pg):
    pg.wait_for_function("!SH._pending()", timeout=15000)
VIEWS=["uebersicht","konten","auftraege","kredite","plan","auswertung","depot","zeitung","position","watchlist","alarme","neu","dauswertung","einstellungen"]
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, bypass_csp=True)
    pg = page(ctx)
    pg.goto(U); pg.wait_for_selector("#gReg:not([hidden])")
    pg.fill("#gRName", "Markus"); pg.fill("#gREmail", "markus@example.de"); pg.fill("#gRPw", "geheim12345"); pg.fill("#gRPw2", "geheim12345")
    pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])"); settle(pg)
    for v in VIEWS: pg.evaluate(f"SH.showView('{v}')"); pg.wait_for_timeout(100)
    assert not errs, errs
    print("leer ok, Depots in DB:", psql("select count(*) from fin.depots"))
    pg.evaluate("SH.showView('uebersicht')"); pg.click("#loadDemo"); settle(pg)
    pg.evaluate("SH.showView('depot')"); pg.click("#dpLoadDemo"); pg.wait_for_timeout(500); settle(pg)
    print("nach Demo:", psql("select (select count(*) from fin.accounts)||' Konten, '||(select count(*) from fin.bookings)||' Buchungen, '||(select count(*) from fin.positions)||' Pos, '||(select count(*) from fin.sec_tx)||' WP-Buchungen, '||(select count(*) from fin.plan_items)||' Planposten'"))
    for i, v in enumerate(VIEWS):
        pg.evaluate(f"SH.showView('{v}')"); pg.wait_for_timeout(350)
        pg.screenshot(path=f"shots/{i+2:02d}_{v}.png", full_page=True)
    assert not errs, errs
    # Verrechnungskonto verknüpfen
    pg.evaluate("SH.showView('einstellungen','setdep')")
    sel = pg.locator("select[data-depacc]").first
    acc = pg.evaluate("FIN.accounts()[0].id"); accname = pg.evaluate("FIN.accounts()[0].name")
    sel.select_option(acc); pg.wait_for_timeout(200)
    pg.fill("input[data-depfrom]", "2000-01-01"); pg.dispatch_event("input[data-depfrom]", "change"); settle(pg)
    nsx = psql("select count(*) from fin.bookings where sec_tx is not null"); nst = psql("select count(*) from fin.sec_tx")
    print("Verrechnungskonto", accname, "->", nsx, "automatische Buchungen für", nst, "WP-Buchungen;", pg.locator("#depMsg").inner_text())
    assert nsx == nst, (nsx, nst)
    pg.screenshot(path="shots/20_einstellungen_dep.png", full_page=True)
    # Reload: Daten kommen aus der DB
    before = pg.evaluate("JSON.stringify([SH._D().accounts.length,SH._D().tx.length,SH._D().pos.length,Object.keys(SH._D().plan)])")
    pg.reload(); pg.wait_for_selector("#app:not([hidden])"); settle(pg)
    after = pg.evaluate("JSON.stringify([SH._D().accounts.length,SH._D().tx.length,SH._D().pos.length,Object.keys(SH._D().plan)])")
    print("vor/nach Neuladen:", before, after); assert before == after
    assert pg.evaluate("SH._D().settings.depots[0].cash_acc") == acc
    # Zweites Gerät gleicher Nutzer: Änderung erscheint per Abruf
    pg2 = page(ctx); pg2.goto(U); pg2.wait_for_selector("#app:not([hidden])"); settle(pg2)
    pg2.evaluate("var D=SH._D();D.accounts[0].name='Giro geändert';D.accounts[0].u=Date.now();SH.changed('fin')"); settle(pg2)
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_function("SH._D().accounts[0].name==='Giro geändert'", timeout=8000)
    print("zweites Gerät ok")
    assert not errs, errs
    # Andere Person sieht nichts
    ctx2 = b.new_context(bypass_csp=True); pg3 = page(ctx2); pg3.goto(U); pg3.wait_for_selector("#gLogin:not([hidden])")
    pg3.click("#gTabReg"); pg3.fill("#gRName", "Petra"); pg3.fill("#gREmail", "petra@example.de"); pg3.fill("#gRPw", "geheim12345"); pg3.fill("#gRPw2", "geheim12345")
    pg3.click("#gRGo"); pg3.wait_for_selector("#app:not([hidden])"); settle(pg3)
    print("Petra sieht:", pg3.evaluate("[SH._D().accounts.length,SH._D().pos.length]")); assert pg3.evaluate("SH._D().accounts.length+SH._D().pos.length") == 0
    assert not errs, errs
    print("Smoke ok")
    b.close()
