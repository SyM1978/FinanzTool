"""Kontoauszug einlesen: Text einfügen, CSV-Datei, Abgleich mit Buchungen und Daueraufträgen."""
import subprocess, os
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
psql = lambda q: subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","finanzen","-tAq","-c",q],capture_output=True,text=True).stdout.strip()
psql("TRUNCATE fin.users, fin.market_cache CASCADE")
errs, n = [], 0
def ok(c, m):
    global n
    assert c, m; n += 1; print("ok:", m)
PASTE = """Kontoauszug 10/2026 vom 01.10.2026 bis 15.10.2026
Kontostand am 30.09.2026, Auszug Nr. 9 1.104,12
01.10. 01.10. Lastschrift
Stadtwerke Geilenkirchen
Abschlag 10/2026 89,00-
02.10. 02.10. Dauerauftrag Miete Oktober 850,00-
02.10. 02.10. Gutschrift
Kindergeld Familienkasse 255,00+
05.10. 05.10. Kartenzahlung REWE 45,90-
07.10. 07.10. Kartenzahlung Bäckerei Moll 6,40
Kontostand am 15.10.2026 um 20:12 Uhr 367,82
"""
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 900}, bypass_csp=True); pg = ctx.new_page()
    pg.route("**/fonts.g*/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
    settle = lambda: (pg.wait_for_timeout(150), pg.wait_for_function("!SH._pending()", timeout=15000))
    pg.goto("http://127.0.0.1:8800/"); pg.wait_for_selector("#gReg:not([hidden])")
    pg.fill("#gRName","M"); pg.fill("#gREmail","auszug@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("SH.showView('einstellungen','konten')")
    pg.fill("#aName","Girokonto"); pg.fill("#aStartDate","2026-09-30"); pg.fill("#aStart","1.104,12"); pg.click("#accSave"); settle()
    # Dauerauftrag Miete und eine schon erfasste Buchung
    pg.evaluate("""var D=SH._D(),g=D.accounts[0].id;D.orders.push({id:'o-miete',name:'Miete',amount:85000,from:g,to:'',interval:'m',day:1,start:'2026-10-01',end:'',shift:'next',cat:'Wohnen',u:Date.now()});
      D.tx.push({id:'t-rewe',acc:g,date:'2026-10-05',amount:-4590,text:'REWE',cat:'Lebensmittel',u:Date.now()});SH.changed('fin')"""); settle()
    pg.reload(); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("SH.showView('konten')"); pg.wait_for_timeout(200)
    ok(pg.is_visible("#kauszug") and pg.input_value("#kaAcc") != "", "Karte „Kontoauszug einlesen“ im Konto")
    pg.fill("#kaText", PASTE); pg.click("#kaRead"); pg.wait_for_timeout(200)
    rows = pg.eval_on_selector_all("#kaBody tr", "e=>e.map(r=>r.className+' | '+r.innerText.replace(/\\s+/g,' '))")
    for r in rows: print("   ", r)
    ok(len(rows) == 5, "5 Umsätze erkannt")
    ok("ka-ord" in rows[1] and "Miete" in rows[1], "Miete passt zum Dauerauftrag")
    ok("ka-new" in rows[0] and "ka-new" in rows[2], "Stadtwerke und Kindergeld neu")
    ok("ka-dup" in rows[3] and "off" in rows[3] and pg.locator('#kaBody tr[data-kai="3"] [data-kayes]').count() == 0, "REWE schon gebucht, keine Frage")
    ok(pg.is_visible("#kaQ") and "posten 1 von 4" in pg.inner_text("#kaQ").lower() and "übernehmen?" in pg.inner_text("#kaQ"), "Frage zum ersten Posten: " + pg.inner_text("#kaQ").replace("\n", " "))
    ok(pg.is_disabled("#kaImport") and "Noch 4 Posten offen" in pg.inner_text("#kaImport"), "Übernehmen erst nach allen Antworten")
    ok(pg.locator("#kaBody [data-kasign]").count() == 1, "± nur bei unklarem Vorzeichen")
    ok(pg.input_value('#kaBody [data-kacat="1"]') == "Wohnen", "Kategorie vom Dauerauftrag")
    s = pg.inner_text("#kaSum"); ok("ohne" in s.lower() or "Vorzeichen" in s, "Hinweis auf fehlendes Vorzeichen")
    bal = pg.inner_text("#kaBal"); print("   ", bal.replace("\n", " "))
    ok("367,82" in bal and "Differenz" in bal, "Kontostand laut Auszug mit Differenz")
    pg.fill('#kaBody [data-kacat="4"]', "Lebensmittel"); pg.dispatch_event('#kaBody [data-kacat="4"]', "change")
    pg.click("#kaYes"); ok("posten 2 von 4" in pg.inner_text("#kaQ").lower() and "Dauerauftrag" in pg.inner_text("#kaQ"), "weiter zu Posten 2 (Dauerauftrag)")
    pg.click("#kaYes"); pg.click("#kaNo")
    ok("posten 4 von 4" in pg.inner_text("#kaQ").lower() and "Vorzeichen unsicher" in pg.inner_text("#kaQ"), "Posten 4 mit Hinweis aufs Vorzeichen")
    pg.screenshot(path="shots/100_kontoauszug.png", full_page=True)
    pg.keyboard.press("j") if False else pg.click("#kaYes")
    ok("Alle 4 Posten geprüft" in pg.inner_text("#kaQ") and "3 übernehmen, 1 nicht" in pg.inner_text("#kaQ"), "Zusammenfassung: " + pg.inner_text("#kaQ").replace("\n", " "))
    ok(pg.get_attribute('#kaBody [data-kano="2"]', "aria-pressed") == "true", "Kindergeld steht auf Nein")
    pg.click('#kaBody [data-kayes="2"]'); ok("4 übernehmen" in pg.inner_text("#kaImport"), "Entscheidung in der Liste änderbar")
    pg.click("#kaImport"); settle()
    ok("4 Buchungen" not in pg.inner_text("#kaMsg") and "3 Buchungen" in pg.inner_text("#kaMsg") and "1 Dauerauftragsausführung" in pg.inner_text("#kaMsg"), pg.inner_text("#kaMsg"))
    ok("stimmt" in pg.inner_text("#kaBal"), "danach stimmt der Kontostand: " + pg.inner_text("#kaBal").replace("\n", " "))
    ok(psql("select count(*) from fin.bookings") == "5", "Buchungen in der DB (inkl. Miete-Bestätigung)")
    ok(psql("select order_id||'/'||occ||'/'||amount from fin.bookings where order_id is not null") == "o-miete/2026-10-01/-85000", "Dauerauftrag-Ausführung bestätigt")
    ok(psql("select cat from fin.bookings where text like '%Bäckerei%'") == "Lebensmittel", "Kategorie übernommen")
    # Zweites Mal: alles schon gebucht
    pg.fill("#kaText", PASTE); pg.click("#kaRead"); pg.wait_for_timeout(200)
    ok(pg.locator("#kaBody tr.ka-dup").count() == 5 and pg.is_disabled("#kaImport") and pg.is_hidden("#kaQ"), "doppeltes Einlesen erkennt alles als gebucht, keine Fragen")
    # Bankabgleich: Konto sichtbar und wählbar
    pg.evaluate("SH.showView('einstellungen','konten')"); pg.fill("#aName","Haushaltskonto"); pg.select_option("#aKind","haushalt"); pg.fill("#aStartDate","2026-10-01"); pg.fill("#aStart","300"); pg.click("#accSave"); settle()
    pg.evaluate("SH.showView('konten')"); pg.wait_for_timeout(200)
    pg.evaluate("document.querySelector('details[data-sec=recon]').open=true")
    names = pg.eval_on_selector_all("#rcAcc option", "e=>e.map(x=>x.textContent)")
    ok(names == ["Girokonto", "Haushaltskonto"] and pg.inner_text("#reconMeta") in ("Girokonto",), "Bankabgleich zeigt das Konto: " + pg.inner_text("#reconMeta"))
    pg.fill("#rcDate", "2026-10-10"); pg.fill("#rcAmt", "310,00"); pg.select_option("#rcAcc", label="Haushaltskonto"); pg.wait_for_timeout(150)
    ok("Haushaltskonto" in pg.inner_text("#accPick [aria-pressed=true]") and pg.inner_text("#reconMeta") == "Haushaltskonto", "Kontowahl im Bankabgleich wechselt das Konto")
    pg.click("#rcCheck"); ok("Differenz +10,00" in pg.inner_text("#rcMsg"), pg.inner_text("#rcMsg"))
    pg.locator("#accPick button", has_text="Girokonto").click(); pg.wait_for_timeout(150)
    ok(pg.is_hidden("#rcFix") and pg.inner_text("#rcMsg") == "", "Kontowechsel verwirft alten Abgleich (keine Korrektur ins falsche Konto)")
    pg.select_option("#rcAcc", label="Haushaltskonto"); pg.click("#rcCheck"); pg.click("#rcFix"); settle()
    ok(psql("select a.name from fin.bookings b join fin.accounts a on a.id=b.acc and a.user_id=b.user_id where b.corr") == "Haushaltskonto", "Korrektur landet im gewählten Konto")
    pg.evaluate("SH.showView('konten')")
    # CSV-Datei (Windows-1252)
    pg.click("#kaClear"); pg.set_input_files("#kaFile", os.path.join(HERE, "stmt", "ing_win.csv")); pg.wait_for_timeout(300)
    t = pg.eval_on_selector_all("#kaBody .katext", "e=>e.map(x=>x.value).join('|')"); ok("Stadtwerke" in t and "Geld zurück" in t, "CSV mit Umlauten (Windows-1252) gelesen")
    # nichts erkannt
    pg.click("#kaClear"); pg.fill("#kaText", "Hallo Welt"); pg.click("#kaRead"); ok("Keine Umsätze erkannt" in pg.inner_text("#kaMsg"), "Hinweis bei nicht lesbarem Text")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.fill("#kaText", PASTE); pg.click("#kaRead"); pg.wait_for_timeout(200)
    pg.locator("#kauszug").scroll_into_view_if_needed(); pg.screenshot(path="shots/101_kontoauszug_mobil.png")
    ok(pg.evaluate("document.documentElement.scrollWidth<=390"), "Handy: kein seitliches Scrollen")
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("Kontoauszug ok:", n, "Prüfungen")
