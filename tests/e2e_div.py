"""Dividenden: Referenzkonto je Position und je Buchung, Vorrang vor dem Verrechnungskonto."""
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
    pg.fill("#gRName","M"); pg.fill("#gREmail","div@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("SH.showView('uebersicht')"); pg.click("#loadDemo"); settle()
    pg.evaluate("SH.showView('depot')"); pg.click("#dpLoadDemo"); pg.wait_for_timeout(700); settle()
    accs = pg.evaluate("SH._D().accounts.map(a=>[a.id,a.name])"); A = {n: i for i, n in accs}
    giro = next(i for i, n in accs if "Giro" in n); url = next(i for i, n in accs if "Urlaub" in n); hh = next(i for i, n in accs if "Haushalt" in n)
    book = lambda acc: psql(f"select coalesce(sum(amount),0)||'/'||count(*) from fin.bookings where sec_tx is not null and acc='{acc}'")
    # Position öffnen
    pg.locator("#posBody tr[data-pid]").first.locator(".pn").click(); pg.wait_for_timeout(300)
    pid = pg.evaluate("SH._D().pos.filter(p=>p.tx.length)[0] && document.querySelector('#posBody') && location.hash")
    pg.evaluate("document.querySelector('[data-sec=pedit]').open=true")
    opts = pg.eval_on_selector_all("#eDivAcc option", "e=>e.map(x=>x.textContent)")
    ok(opts[0].startswith("wie Depot") and "nicht auf ein Konto buchen" in opts and any("Urlaub" in o for o in opts), "Auswahl im Bearbeiten-Formular: " + str(opts[:3]))
    pg.select_option("#eDivAcc", url); pg.click("#eSave"); settle()
    ok(url in psql("select string_agg(extra->>'divAcc', ',') from fin.positions"), "Referenzkonto der Position gespeichert")
    # Dividende eintragen → landet auf dem Urlaubskonto
    pg.click("#dpTxType input[value=div]", force=True) if pg.locator("#dpTxType").count() else pg.click("#txType input[value=div]", force=True)
    ok(pg.is_visible("#tDivAcc"), "Kontoauswahl bei Dividende sichtbar")
    o2 = pg.eval_on_selector_all("#tDivAcc option", "e=>e.map(x=>x.textContent)")
    ok("Urlaub" in o2[0] and o2[0].startswith("wie Position"), "Standard zeigt Konto der Position: " + o2[0])
    base = book(url); bs, bc = map(int, base.split("/"))
    ok(bc >= 1, "vorhandene Dividenden der Position gehen aufs Urlaubskonto: " + base)
    U1 = f"{bs+5000}/{bc+1}"
    pg.fill("#tAmt", "50,00"); pg.click("#dpTxSave"); settle()
    ok(book(url) == U1, "Dividende auf Urlaubskonto gebucht: " + book(url))
    ok("→ Urlaub" in pg.inner_text("#pTxBody"), "Liste zeigt Zielkonto")
    # Zweite Dividende direkt aufs Haushaltskonto
    pg.click("#txType input[value=div]", force=True); pg.select_option("#tDivAcc", hh); pg.fill("#tAmt", "12,34"); pg.click("#dpTxSave"); settle()
    ok(book(hh) == "1234/1" and book(url) == U1, "Buchung mit eigenem Konto überschreibt Position")
    ok(hh in psql("select string_agg(extra->>'acc', ',') from fin.sec_tx where type='div'"), "Konto der Buchung gespeichert")
    pg.screenshot(path="shots/90_dividende_konto.png", full_page=True)
    # Bearbeiten: „nicht buchen“
    pg.locator("#pTxBody tr", has_text="12,34").first.click(); pg.wait_for_timeout(200)
    ok(pg.input_value("#tDivAcc") == hh, "beim Bearbeiten ist das Konto vorausgewählt")
    pg.select_option("#tDivAcc", "-"); pg.click("#dpTxSave"); settle()
    ok(book(hh) == "0/0", "„nicht auf ein Konto buchen“ entfernt die Buchung")
    ok("keine Gutschrift" in pg.inner_text("#pTxBody"), "Liste zeigt „keine Gutschrift“")
    # Position zurück auf Standard, Depot bucht auf Giro
    pg.evaluate(f"var D=SH._D();(D.settings.depots||[]).forEach(d=>{{d.cash_acc='{giro}';d.cash_from='2000-01-01'}});SH.changed('dep')"); settle()
    before = psql(f"select count(*) from fin.bookings where sec_tx is not null and acc='{giro}'")
    ok(book(url) == U1, "Referenzkonto der Position hat Vorrang vor dem Verrechnungskonto")
    pg.evaluate("document.querySelector('[data-sec=pedit]').open=true"); pg.select_option("#eDivAcc", ""); pg.click("#eSave"); settle()
    ok(book(url) == "0/0" and int(psql(f"select count(*) from fin.bookings where sec_tx is not null and acc='{giro}'")) == int(before) + bc + 1, "ohne Referenzkonto zurück aufs Verrechnungskonto")
    pg.reload(); pg.wait_for_selector("#app:not([hidden])"); pg.wait_for_timeout(500)
    ok(book(url) == "0/0", "nach Neuladen stabil")
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("Dividenden ok:", n, "Prüfungen")
