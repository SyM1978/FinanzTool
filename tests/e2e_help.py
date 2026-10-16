"""Hilfesystem: Hilfe-Seite, Suche, Hilfe zur aktuellen Seite, Checkliste, Tastenkürzel."""
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
    ok(pg.is_hidden("#helpFab"), "kein Hilfe-Knopf auf der Anmeldeseite")
    pg.fill("#gRName","M"); pg.fill("#gREmail","hilfe@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    ok(pg.is_visible("#helpFab"), "Hilfe-Knopf unten rechts")
    ok(pg.locator('#nav a[data-view="hilfe"]').count() == 1, "Hilfe im Menü")
    # Hilfe zur aktuellen Seite
    pg.evaluate("SH.showView('konten')"); pg.click("#helpFab"); pg.wait_for_selector("#helpPanel:not([hidden])")
    t = pg.inner_text("#hpBody"); ok("Konten & Buchungen" in t and "Kontoauszug einlesen" in t and "Bankabgleich" in t, "Seitenleiste mit Hilfe zu Konten & Buchungen")
    ok(pg.locator("#hpBody details.hpitem[open]").count() == 1, "erster Artikel aufgeklappt")
    pg.screenshot(path="tests/shots/120_hilfe_seite.png")
    # Seitenwechsel aktualisiert die Liste
    pg.evaluate("SH.showView('kredite')"); pg.wait_for_timeout(100)
    ok("Kredit anlegen" in pg.inner_text("#hpBody"), "Liste passt sich der Seite an")
    # Suche in der Seitenleiste
    pg.fill("#hpSearch", "dividende konto"); pg.wait_for_timeout(100)
    ok(pg.inner_text("#hpBody .hpres b >> nth=0") == "Dividenden eintragen", "Suche findet Dividenden zuerst: " + pg.inner_text("#hpBody")[:120].replace("\n", " | "))
    pg.click('#hpBody .hpres[data-help="dividenden"]'); ok("Referenzkonto" in pg.inner_text("#hpBody") or "Gutschrift auf Konto" in pg.inner_text("#hpBody"), "Artikel in der Seitenleiste")
    pg.click('#hpBody a[data-help="verrechnungskonto"]'); ok("Verrechnungskonto" in pg.inner_text("#hpBody h3"), "Querverweis")
    pg.click("#hpBack"); ok("Dividenden eintragen" in pg.inner_text("#hpBody h3"), "zurück")
    pg.keyboard.press("Escape"); ok(pg.is_hidden("#helpPanel"), "Escape schließt")
    pg.keyboard.press("F1"); ok(pg.is_visible("#helpPanel"), "F1 öffnet"); pg.keyboard.press("F1"); ok(pg.is_hidden("#helpPanel"), "F1 schließt")
    pg.keyboard.press("Shift+ß") if False else pg.keyboard.type("?"); ok(pg.is_visible("#helpPanel"), "? öffnet"); pg.keyboard.press("Escape"); ok(pg.is_hidden("#helpPanel"), "wieder zu")
    # ? in Eingabefeld öffnet die Hilfe nicht
    pg.evaluate("SH.showView('einstellungen','konten')"); pg.focus("#aName"); pg.keyboard.type("?"); ok(pg.is_hidden("#helpPanel"), "? beim Tippen ignoriert")
    # Hilfe-Seite
    pg.click('#nav a[data-view="hilfe"]'); pg.wait_for_timeout(150)
    ok(pg.is_hidden("#helpFab") and "Wie können wir helfen" in pg.inner_text("#hArt"), "Hilfe-Startseite")
    ck = pg.inner_text("#hArt .hcheck"); ok("0 von 6" in ck, "Checkliste: " + ck.split("\n")[0])
    pg.click('#hToc a[data-help="kredit"]'); ok("Häufiger Fehler" in pg.inner_text("#hArt") and pg.get_attribute('#hToc a[data-help="kredit"]', "aria-current") == "true", "Artikel öffnen, im Inhaltsverzeichnis markiert")
    pg.fill("#hSearch", "sollzins"); pg.wait_for_timeout(100)
    res = pg.inner_text("#hToc"); ok("treffer" in res.lower() and "Kredit anlegen" in res, "Suche auf der Hilfeseite")
    pg.press("#hSearch", "Enter"); ok(pg.locator("#hArt mark").count() >= 1, "Suchwort im Artikel markiert")
    pg.fill("#hSearch", "xyzabc"); pg.wait_for_timeout(100); ok("nichts gefunden" in pg.inner_text("#hToc").lower(), "kein Treffer")
    pg.fill("#hSearch", "")
    # Sprung zur Funktion aus der Checkliste, Haken setzt sich
    pg.click('#hToc a[data-help=""]'); pg.locator('#hArt .hcheck [data-go="einstellungen#konten"]').click(); pg.wait_for_timeout(200)
    ok(pg.evaluate("location.hash") == "#einstellungen", "„Los“ führt zur Funktion")
    pg.fill("#aName","Girokonto"); pg.fill("#aStartDate","2026-10-01"); pg.fill("#aStart","1.000"); pg.click("#accSave"); settle()
    pg.evaluate("SH.showView('hilfe')"); pg.wait_for_timeout(150); ok("1 von 6" in pg.inner_text("#hArt .hcheck"), "Haken nach erledigtem Schritt")
    pg.screenshot(path="tests/shots/121_hilfe_start.png", full_page=True)
    pg.click('#hArt .hcard a[data-help="kontoauszug"]'); pg.screenshot(path="tests/shots/122_hilfe_artikel.png", full_page=True)
    # Neuladen auf #hilfe
    pg.evaluate("location.hash='#hilfe'"); pg.reload(); pg.wait_for_selector("#app:not([hidden])"); pg.wait_for_timeout(300)
    ok(pg.is_visible('section[data-view="hilfe"]') and "Wie können wir helfen" in pg.inner_text("#hArt"), "direkter Aufruf #hilfe")
    # alle Querverweise zeigen auf vorhandene Artikel
    bad = pg.evaluate("""(function(){var ids={};HELP_ART.forEach(a=>ids[a.id]=1);var bad=[];HELP_ART.forEach(a=>{(a.b.match(/data-help="([^"]*)"/g)||[]).forEach(m=>{var id=m.slice(11,-1);if(id&&!ids[id])bad.push(a.id+'→'+id)})});return bad})()""")
    ok(not bad, "alle Querverweise gültig " + str(bad))
    gos = pg.evaluate("""(function(){var bad=[];HELP_ART.forEach(a=>{(a.b.match(/data-go="([^"]*)"/g)||[]).forEach(m=>{var g=m.slice(9,-1).split('#');if(!SH.VIEWS[g[0]]||(g[1]&&!document.getElementById(g[1])))bad.push(a.id+'→'+g.join('#'))})});return bad})()""")
    ok(not gos, "alle Sprünge zu Funktionen gültig " + str(gos))
    views = pg.evaluate("Object.keys(SH.VIEWS).filter(v=>v!=='hilfe'&&!HELP_ART.some(a=>a.v.indexOf(v)>=0))")
    ok(not views, "jede Seite hat Hilfe " + str(views))
    # Handy
    pg.set_viewport_size({"width": 390, "height": 844}); pg.evaluate("SH.showView('depot')"); pg.click("#helpFab"); pg.wait_for_timeout(150)
    bx = pg.eval_on_selector("#helpPanel", "e=>e.getBoundingClientRect().width"); ok(bx <= 390, "Seitenleiste am Handy volle Breite")
    pg.screenshot(path="tests/shots/123_hilfe_mobil.png"); pg.keyboard.press("Escape")
    pg.evaluate("SH.showView('hilfe')"); ok(pg.evaluate("document.documentElement.scrollWidth<=390"), "Handy: kein seitliches Scrollen")
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("Hilfe ok:", n, "Prüfungen")
