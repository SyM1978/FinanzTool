"""Kategorien, Gruppierung und Kursalarme für mehrere Wertpapiere (± %)."""
import subprocess, re
from playwright.sync_api import sync_playwright
U = "http://127.0.0.1:8800/"
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
    pg.goto(U); pg.wait_for_selector("#gReg:not([hidden])")
    pg.fill("#gRName","M"); pg.fill("#gREmail","k@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("SH.showView('depot')"); pg.click("#dpLoadDemo"); pg.wait_for_timeout(700); settle()
    names = lambda: pg.eval_on_selector_all("#posBody tr[data-pid] .pn", "e=>e.map(x=>x.textContent)")
    # Kategorie per Klick zuweisen: neue anlegen, dann vorhandene wählen
    def assign(row, cat, new=True):
        pg.click(f"#posBody tr[data-pid]:nth-of-type({row}) [data-cat]") if False else pg.locator("#posBody tr[data-pid]").nth(row).locator("[data-cat]").click()
        pg.wait_for_selector(".catpop")
        if new:
            pg.fill(".catpop input", cat); pg.press(".catpop input", "Enter")
        else:
            pg.click(f'.catpop [data-catset="{cat}"]')
        settle()
    order = names()
    assign(0, "Dividende"); pg.locator("#posBody tr[data-pid]").nth(1).locator("[data-cat]").click(); pg.wait_for_selector(".catpop")
    pg.screenshot(path="shots/70_kategorie_pop.png", clip={"x":250,"y":560,"width":1030,"height":460})
    pg.click('.catpop [data-catset="Dividende"]'); settle()
    assign(2, "Wachstum")
    cats = psql("select name||'='||(extra->>'cat') from fin.positions where extra ? 'cat' order by name")
    ok(cats.count("Dividende") == 2 and "Wachstum" in cats, "Kategorien gespeichert: " + cats.replace("\n", ", "))
    # Gruppieren
    pg.select_option("#posGroup", "cat"); settle()
    heads = pg.eval_on_selector_all("#posBody tr.grp td:first-child b", "e=>e.map(x=>x.textContent)")
    ok(heads == ["Dividende", "Wachstum", "Ohne Kategorie"], "Gruppen in Reihenfolge: " + str(heads))
    ok("2 Positionen" in pg.inner_text("#posBody tr.grp"), "Gruppenkopf mit Anzahl und Summen")
    pg.screenshot(path="shots/71_gruppiert.png", clip={"x":250,"y":560,"width":1030,"height":620})
    # Sortierung innerhalb der Gruppen
    pg.click("[data-sort=name]"); g1 = names()
    ok(g1[:2] == sorted(g1[:2], key=str.lower), "innerhalb der Gruppe nach Name sortiert: " + str(g1))
    # Aufteilung nach Kategorie
    pg.click("#allocMode input[value=cat]", force=True); pg.wait_for_timeout(200)
    al = pg.inner_text("#allocList"); ok("Dividende" in al and "Ohne Kategorie" in al, "Aufteilung nach Kategorie")
    # Bearbeiten-Feld
    pg.locator("#posBody tr[data-pid]").first.locator(".pn").click(); pg.wait_for_timeout(300)
    pg.evaluate("document.querySelector('[data-sec=pedit]').open=true")
    ok(pg.input_value("#eCat") in ("Dividende", "Wachstum"), "Kategorie im Bearbeiten-Formular")
    pg.fill("#eCat", "Langfristig"); pg.click("#eSave"); settle()
    ok("Langfristig" in psql("select string_agg(extra->>'cat', ',') from fin.positions"), "Kategorie im Formular geändert")
    # Neuladen: Gruppierung bleibt
    pg.reload(); pg.wait_for_selector("#app:not([hidden])"); pg.evaluate("SH.showView('depot')"); pg.wait_for_timeout(300)
    ok(pg.input_value("#posGroup") == "cat" and pg.locator("#posBody tr.grp").count() == 4, "Gruppierung bleibt nach Neuladen")
    # Alarme für mehrere Wertpapiere
    pg.evaluate("SH.showView('alarme')"); pg.wait_for_timeout(200)
    ok(pg.locator("#alSyms .alchip").count() >= 5, "alle Wertpapiere als Auswahl")
    pg.click("#alAll"); ok(pg.input_value("#alType") == "dayMove", "bei mehreren automatisch ± %")
    cnt = pg.locator("#alSyms input:checked").count(); ok(cnt == 5 and "5 Alarme anlegen" == pg.inner_text("#alGo"), "alle im Bestand ausgewählt")
    pg.screenshot(path="shots/72_alarme_mehrere.png", full_page=True)
    pg.select_option("#alType", "above"); pg.fill("#alVal", "100"); pg.click("#alGo")
    ok("nur für ein Wertpapier" in pg.inner_text("#alMsg"), "Kursschwelle bei mehreren abgelehnt")
    pg.select_option("#alType", "dayMove"); pg.fill("#alVal", "3"); pg.click("#alGo"); settle()
    ok(psql("select count(*) from fin.price_alerts where type='dayMove' and value=3") == "5", "5 Alarme ± 3 % in der DB")
    ok("± 3,0 %" in pg.inner_text("#alList"), "Liste zeigt ± 3,0 %")
    pg.click("#alNone"); pg.click('#alCats [data-alcat="Wachstum"]'); ok(pg.locator("#alSyms input:checked").count() == 1, "Auswahl nach Kategorie")
    pg.fill("#alVal", "3"); pg.click("#alGo"); settle(); ok("gab es schon" in pg.inner_text("#alMsg"), "doppelte Alarme werden übersprungen")
    pg.click("#alDelAll"); pg.click("#alDelAll"); settle(); ok(psql("select count(*) from fin.price_alerts") == "0", "alle Alarme gelöscht")
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("Kategorien & Alarme ok:", n, "Prüfungen")
