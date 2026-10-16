"""Depot: Entwicklung im Depotwert-Kasten (Zeiträume, Kennzahlen, Hover)."""
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
    pg.fill("#gRName","M"); pg.fill("#gREmail","dev@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("SH.showView('depot')"); pg.wait_for_timeout(200)
    ok("Noch keine Positionen" in pg.inner_text("#dChart"), "leeres Depot: Hinweis")
    pg.click("#dpLoadDemo"); pg.wait_for_timeout(800); settle()
    pg.wait_for_selector("#dChart svg", timeout=10000)
    ok(pg.locator('section[data-view=depot] details[data-sec=dchart]').count() == 0, "alter Verlaufs-Kasten unten ist weg")
    ok(pg.locator('details[data-sec=val] #dChart').count() == 1, "Diagramm im Depotwert-Kasten")
    k = pg.inner_text("#devKpis"); print("   ", k.replace("\n", " | "))
    ok(all(w in k.upper() for w in ["VERÄNDERUNG", "KURSENTWICKLUNG", "KÄUFE", "HÖCHSTSTAND"]), "Kennzahlen")
    for v in ["1w", "1mo", "6mo", "ytd", "1y", "5y", "max"]:
        pg.click(f'#dRange input[value="{v}"]', force=True); pg.wait_for_selector("#dChart svg", timeout=10000); pg.wait_for_timeout(150)
        meta = pg.inner_text("#dChartMeta"); ok(meta and pg.locator("#dChart polyline.act").count() == 1, f"Zeitraum {v}: {meta}")
    pg.click('#dRange input[value="1y"]', force=True); pg.wait_for_selector("#dChart svg"); pg.wait_for_timeout(300)
    pg.locator("#dChart").scroll_into_view_if_needed(); box = pg.locator("#dChart svg").bounding_box()
    pg.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + box["height"] * 0.5); pg.wait_for_timeout(150)
    tip = pg.inner_text("#devTip"); ok(pg.is_visible("#devTip") and "Depotwert" in tip and "Einstand" in tip and "Gewinn" in tip, "Hover-Info: " + tip.replace("\n", " "))
    ok(pg.locator("#dChart g.hov circle").count() == 1, "Markierung im Diagramm")
    pg.screenshot(path="shots/110_depot_entwicklung.png", clip={"x": 250, "y": 0, "width": 1030, "height": 900})
    pg.mouse.move(5, 5); pg.wait_for_timeout(150); ok(pg.is_hidden("#devTip"), "Hover-Info verschwindet")
    pg.locator('details[data-sec=val] .hlp').hover(); pg.wait_for_timeout(150); ok("Kursentwicklung" in pg.inner_text("#tipBox"), "Hilfe-Info zur Entwicklung")
    # Zeitraum bleibt beim Neuzeichnen
    pg.click('#dRange input[value="ytd"]', force=True); pg.wait_for_timeout(400); pg.evaluate("SH.showView('dashboard')"); pg.evaluate("SH.showView('depot')"); pg.wait_for_timeout(400)
    ok(pg.is_checked('#dRange input[value="ytd"]') and "Jahresbeginn" in pg.inner_text("#dChartMeta"), "gewählter Zeitraum bleibt")
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)
    ok(pg.evaluate("document.documentElement.scrollWidth<=390"), "Handy: kein seitliches Scrollen")
    pg.locator("#devKpis").scroll_into_view_if_needed(); pg.screenshot(path="shots/111_depot_entwicklung_mobil.png", full_page=False)
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("Depot-Entwicklung ok:", n, "Prüfungen")
