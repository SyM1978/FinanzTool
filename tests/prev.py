from playwright.sync_api import sync_playwright
import os
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":390,"height":844})
    pg.route("**/fonts.g*/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
    pg.goto("file://"+os.path.abspath("../web/out/preview.html")); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("SH.showView('uebersicht')"); pg.click("#loadDemo"); pg.evaluate("SH.showView('depot')"); pg.click("#dpLoadDemo"); pg.wait_for_timeout(600)
    for v in ["dashboard","uebersicht","depot","zeitung","einstellungen","kredite"]:
        pg.evaluate(f"SH.showView('{v}')"); pg.wait_for_timeout(250)
    pg.evaluate("SH.showView('uebersicht')"); pg.screenshot(path="shots/40_mobil.png")
    pg.click("#menuBtn"); pg.wait_for_timeout(300); pg.screenshot(path="shots/41_mobil_menu.png")
    print(pg.inner_text("#syncTxt"), errs)
