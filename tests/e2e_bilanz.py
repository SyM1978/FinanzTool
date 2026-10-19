"""Ein- & Ausgaben: Übersicht wie Excel, Info-Karte beim Überfahren, Ändern per Klick."""
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
    pg.fill("#gRName","M"); pg.fill("#gREmail","bilanz@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    pg.click('#nav a[data-view="bilanz"]'); pg.wait_for_timeout(150)
    ok(pg.is_visible("#bzEmpty"), "ohne Plan: Hinweis auf Finanzplan")
    pg.evaluate("SH.showView('uebersicht')"); pg.click("#loadDemo"); settle()
    pg.click('#nav a[data-view="bilanz"]'); pg.wait_for_timeout(200)
    heads = pg.eval_on_selector_all("#bzTable tr.bzh th:first-child", "e=>e.map(x=>x.textContent)")
    ok(heads == ["Einnahmen", "Fixe Ausgaben", "Variable Ausgaben"], "Abschnitte wie in Excel: " + str(heads))
    foot = pg.inner_text("#bzFoot"); print("   ", foot.replace("\n", " | ").replace("\t", " "))
    ok("Überschuss" in foot and "Sparquote" in foot, "Ergebnis unten mit Sparquote")
    ok(pg.locator("#bzKpis .fc").count() == 4, "Kennzahlen oben")
    # Hover: Urlaubsparen zeigt das Urlaubskonto
    row = pg.locator("#bzTable tr.bzi", has_text="Urlaubsparen"); row.scroll_into_view_if_needed(); pg.wait_for_timeout(100); row.hover(); pg.wait_for_selector("#bzCard:not([hidden])")
    card = pg.inner_text("#bzCard").lower(); print("   ", card.replace("\n", " | "))
    ok("urlaubskonto" in card and "stand heute" in card and "sparziel" in card and "dauerauftrag" in card, "Info-Karte: Kontostand, Sparziel, Dauerauftrag")
    pg.screenshot(path="shots/130_bilanz_hover.png")
    r2 = pg.locator("#bzTable tr.bzi", has_text="Autokredit"); r2.scroll_into_view_if_needed(); pg.wait_for_timeout(100); r2.hover(); pg.wait_for_timeout(100)
    ok("Restschuld" in pg.inner_text("#bzCard"), "Kredit: Restschuld")
    pg.mouse.move(5, 5); pg.wait_for_timeout(100); ok(pg.is_hidden("#bzCard"), "Karte verschwindet")
    # Festhalten per Klick, Konto verknüpfen
    pg.locator("#bzTable tr.bzi", has_text="Lebensmittel").locator("td").first.click(); pg.wait_for_timeout(100)
    ok(pg.is_visible("#bzCard.pinned") and pg.locator("#bzCard select[data-bzacc]").count() == 1, "festgehaltene Karte mit Kontowahl")
    pg.select_option("#bzCard select[data-bzacc]", label="Haushaltskonto"); settle()
    ok("Haushaltskonto" in pg.inner_text("#bzCard") and "haus" in psql("select coalesce(extra->>'acc','') from fin.plan_items where name='Lebensmittel'"), "Konto verknüpft und gespeichert")
    pg.keyboard.press("Escape"); ok(pg.is_hidden("#bzCard"), "Escape schließt")
    # Ändern per Klick
    pg.locator("#bzTable tr.bzi", has_text="Lebensmittel").locator(".bzval").click(); pg.wait_for_selector("#bzTable input.bzin")
    pg.fill("#bzTable input.bzin", "320"); pg.keyboard.press("Enter"); settle()
    ok("320,00" in pg.locator("#bzTable tr.bzi", has_text="Lebensmittel").locator(".bzval").inner_text() , "Betrag geändert")
    m = pg.evaluate("new Date().getMonth()")
    months = psql("select months::text from fin.plan_items where name='Lebensmittel'"); print("   ", months)
    vals = [int(x) for x in months.strip("{}[]").split(",")]
    ok(vals[m] == 32000 and (m == 11 or vals[m+1] == 30000), "nur dieser Monat geändert")
    pg.check("#bzFill"); pg.locator("#bzTable tr.bzi", has_text="Lebensmittel").locator(".bzval").click(); pg.fill("#bzTable input.bzin", "350"); pg.keyboard.press("Enter"); settle()
    vals = [int(x) for x in psql("select months::text from fin.plan_items where name='Lebensmittel'").strip("{}[]").split(",")]
    ok(all(v == 35000 for v in vals[m:]) and (m == 0 or vals[m-1] == 30000), "mit Folgemonaten bis Dezember")
    pg.locator("#bzTable tr.bzi", has_text="Lebensmittel").locator(".bzval").click(); pg.fill("#bzTable input.bzin", "999"); pg.keyboard.press("Escape"); pg.wait_for_timeout(100)
    ok("350,00" in pg.locator("#bzTable tr.bzi", has_text="Lebensmittel").locator(".bzval").inner_text(), "Escape bricht ab")
    # Dauerauftrag an Plan angleichen
    pg.uncheck("#bzFill"); pg.locator("#bzTable tr.bzi", has_text="Miete").locator(".bzval").click(); pg.fill("#bzTable input.bzin", "980"); pg.keyboard.press("Enter"); settle()
    pg.locator("#bzTable tr.bzi", has_text="Miete").locator("td").first.click(); pg.wait_for_timeout(100)
    ok(pg.locator("#bzCard [data-bzorder]").count() == 1, "Angebot: Dauerauftrag anpassen")
    pg.click("#bzCard [data-bzorder]"); settle()
    ok(psql("select amount from fin.orders where name='Miete'") == "98000", "Dauerauftrag Miete angepasst")
    pg.keyboard.press("Escape")
    # Jahr und ohne Ist
    pg.click('#bzMode input[value="year"]', force=True); pg.wait_for_timeout(150)
    ok(pg.inner_text("#bzLabel").startswith("Jahr") and "bis heute" in pg.inner_text("#bzHead").lower(), "Jahresansicht")
    pg.locator("#bzTable .bzval").first.click(); ok("Monatsansicht" in pg.inner_text("#bzMsg"), "Jahr: Hinweis statt Bearbeiten")
    pg.uncheck("#bzIst"); settle(); ok("differenz" not in pg.inner_text("#bzHead").lower() and "ist" not in pg.inner_text("#bzFoot").lower().replace("überschuss",""), "ohne Ist-Spalten")
    pg.reload(); pg.wait_for_selector("#app:not([hidden])"); pg.evaluate("SH.showView('bilanz')"); pg.wait_for_timeout(200)
    ok(not pg.is_checked("#bzIst") and "differenz" not in pg.inner_text("#bzHead").lower(), "Ist bleibt nach Neuladen ausgeblendet")
    r3 = pg.locator("#bzTable tr.bzi", has_text="Urlaubsparen"); r3.scroll_into_view_if_needed(); pg.wait_for_timeout(100); r3.hover(); pg.wait_for_timeout(150)
    ok("ist " not in pg.inner_text("#bzCard").lower(), "Info-Karte ohne Ist-Werte"); pg.mouse.move(5, 5)
    pg.check("#bzIst"); settle(); pg.click('#bzMode input[value="month"]', force=True)
    pg.click("#bzPrev"); pg.click("#bzNext"); pg.wait_for_timeout(100)
    pg.screenshot(path="shots/131_bilanz.png", full_page=True)
    # Finanzplan-Änderung erscheint sofort
    pg.evaluate("SH.showView('plan')"); pg.wait_for_timeout(100); pg.evaluate("SH.showView('bilanz')")
    # Handy
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(200)
    ok(pg.evaluate("document.documentElement.scrollWidth<=390"), "Handy: kein seitliches Scrollen")
    pg.locator("#bzTable tr.bzi", has_text="Urlaubsparen").locator("td").first.click(); pg.wait_for_timeout(150)
    ok(pg.is_visible("#bzCard.sheet"), "Handy: Karte als Blatt unten")
    pg.screenshot(path="shots/132_bilanz_mobil.png")
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("Ein- & Ausgaben ok:", n, "Prüfungen")
