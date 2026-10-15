"""Kredit-Maske: Effektivzins, Gesamtbetrag-Erkennung, Vorschau, Hilfe-Infos."""
import subprocess
from playwright.sync_api import sync_playwright
psql = lambda q: subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","finanzen","-tAq","-c",q],capture_output=True,text=True).stdout.strip()
psql("TRUNCATE fin.users, fin.market_cache CASCADE")
errs, n = [], 0
def ok(c, m):
    global n
    assert c, m; n += 1; print("ok:", m)
eur = lambda s: float(s.replace("−","-").replace(".","").replace("€","").replace(",",".").strip())
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 900}, bypass_csp=True); pg = ctx.new_page()
    pg.route("**/fonts.g*/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text else None)
    settle = lambda: (pg.wait_for_timeout(150), pg.wait_for_function("!SH._pending()", timeout=15000))
    pg.goto("http://127.0.0.1:8800/"); pg.wait_for_selector("#gReg:not([hidden])")
    pg.fill("#gRName","M"); pg.fill("#gREmail","kredit@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("SH.showView('einstellungen','konten')")
    pg.fill("#aName","Girokonto"); pg.fill("#aStartDate","2026-01-01"); pg.fill("#aStart","2.500,00"); pg.click("#accSave"); settle()
    # Kredit so eintragen, wie es Markus getan hat
    pg.fill("#aName","Autokredit"); pg.select_option("#aKind","kredit")
    ok(pg.is_visible("#aLoan") and pg.input_value("#aRateType") == "eff", "Kreditfelder, Standard effektiver Jahreszins")
    ok(pg.locator("#accForm .hlp").count() >= 7, "Hilfe-Knöpfe an allen Kreditfeldern: %d" % pg.locator("#accForm .hlp").count())
    pg.fill("#aStartDate","2024-02-29"); pg.fill("#aStart","71.807,28"); pg.fill("#aRate","5,24"); pg.fill("#aPay","748"); pg.select_option("#aPayDay","29")
    ok("5,118" in pg.inner_text("#aRateConv"), "Umrechnung: " + pg.inner_text("#aRateConv"))
    w = pg.inner_text("#aLoanCheck"); print(w)
    ok("96 Monatsraten" in w and "Gesamtbetrag" in w, "Gesamtbetrag erkannt")
    ok("32 Raten bezahlt" in w and "64 offen" in w, "bezahlte/offene Raten")
    # Hover-Info
    pg.hover("#aLoan label[for=aRate] .hlp"); pg.wait_for_selector("#tipBox:not([hidden])")
    ok("Sollzins" in pg.inner_text("#tipBox") and "Effektiver" in pg.inner_text("#tipBox"), "Hover-Info zum Zinssatz")
    pg.screenshot(path="tests/shots/95_kredit_hilfe.png", clip={"x":250,"y":0,"width":1030,"height":900}, full_page=False) if False else None
    pg.locator("#aLoan label[for=aRate] .hlp").scroll_into_view_if_needed(); pg.hover("#aLoan label[for=aRate] .hlp"); pg.wait_for_timeout(200)
    pg.screenshot(path="tests/shots/95_kredit_hilfe.png")
    pg.mouse.move(5, 5); pg.wait_for_timeout(300); ok(pg.is_hidden("#tipBox"), "Hover-Info verschwindet")
    pg.click("#aLoan label[for=aPay] .hlp"); ok(pg.is_visible("#tipBox") and "Dauerauftrag" in pg.inner_text("#tipBox"), "Klick (Touch) öffnet Info")
    pg.keyboard.press("Escape"); ok(pg.is_hidden("#tipBox"), "Escape schließt Info")
    # Übernehmen
    pg.click("#aLoanFix"); rest = eur(pg.input_value("#aStart"))
    ok(abs(rest - 41814.28) < 30, f"Restschuld ausgerechnet: {rest} (Bank: 41.814,28)")
    ok(pg.input_value("#aStartDate") == "2026-09-30", "Datum nach der letzten Rate: " + pg.input_value("#aStartDate"))
    pv = pg.inner_text("#aLoanCheck"); print(pv)
    ok("Gesamtbetrag" not in pv and "restschuld heute" in pv.lower(), "Warnung weg, Vorschau da")
    pg.screenshot(path="tests/shots/96_kredit_vorschau.png", full_page=True)
    # Exakte Bank-Restschuld eintragen und speichern
    pg.fill("#aStart", "41.814,28"); pg.fill("#aStartDate", "2026-10-15"); pg.click("#accSave"); settle()
    row = psql("select loan_rate||'|'||(extra->>'loanEff')||'|'||start_amount from fin.accounts where name='Autokredit'")
    ok(row.startswith("5.1") and "|5.24|" in row and row.endswith("-4181428"), "gespeichert: " + row)
    pg.evaluate("SH.showView('kredite')"); pg.wait_for_timeout(300)
    meta = pg.inner_text("#loanMeta"); ok("effektiv" in meta and "5,24" in meta, "Kredite zeigt Effektivzins: " + meta)
    end = pg.inner_text("#lnEnd"); ok(end.endswith(".2032") or end.endswith(".2031"), "Ende: " + end)
    # Bearbeiten zeigt wieder 5,24 effektiv
    pg.evaluate("SH.showView('einstellungen','konten')"); pg.locator("#accList [data-eacc]").nth(1).click()
    ok(pg.input_value("#aRate") == "5,24" and pg.input_value("#aRateType") == "eff", "Bearbeiten: 5,24 effektiv")
    pg.select_option("#aRateType","nom"); pg.click("#accSave"); settle()
    ok(psql("select loan_rate::float::text||coalesce(extra->>'loanEff','-') from fin.accounts where name='Autokredit'") == "5.24-", "auf Sollzins umgestellt")
    # Handy
    pg.set_viewport_size({"width": 390, "height": 844}); pg.locator("#accList [data-eacc]").nth(1).click(); pg.wait_for_timeout(200)
    ok(pg.evaluate("document.documentElement.scrollWidth<=390"), "Handy: kein seitliches Scrollen")
    pg.locator("#aLoan label[for=aRate] .hlp").click(); pg.wait_for_timeout(100)
    bx = pg.eval_on_selector("#tipBox", "e=>{var r=e.getBoundingClientRect();return [r.left,r.right]}")
    ok(bx[0] >= 0 and bx[1] <= 390, "Info passt aufs Handy: " + str(bx))
    pg.screenshot(path="tests/shots/97_kredit_mobil.png")
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("Kredit ok:", n, "Prüfungen")
