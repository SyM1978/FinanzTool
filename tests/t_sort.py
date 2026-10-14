import subprocess
from playwright.sync_api import sync_playwright
errs=[]
psql = lambda q: subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","finanzen","-tAq","-c",q],capture_output=True,text=True).stdout.strip()
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":900},bypass_csp=True); pg=ctx.new_page()
    pg.route("**/fonts.g*/**", lambda r: r.abort())
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: errs.append(m.text) if m.type=="error" and "ERR_FAILED" not in m.text else None)
    settle=lambda: pg.wait_for_function("!SH._pending()", timeout=15000)
    pg.goto("http://127.0.0.1:8800/"); pg.wait_for_selector("#gReg:not([hidden])")
    pg.fill("#gRName","M"); pg.fill("#gREmail","s@x.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo"); pg.wait_for_selector("#app:not([hidden])")
    pg.evaluate("SH.showView('depot')"); pg.click("#dpLoadDemo"); pg.wait_for_timeout(700); settle()
    names=lambda: pg.eval_on_selector_all("#posBody tr .pn","e=>e.map(x=>x.textContent)")
    print("Standard (Wert ↓):", names())
    pg.click("[data-sort=name]"); print("Name ↑:", names())
    pg.click("[data-sort=name]"); print("Name ↓:", names())
    pg.click("[data-sort=day]"); print("Heute ↓:", names())
    pg.click("[data-sort=gain]"); print("Gewinn % ↓:", names())
    # markieren
    pg.click("#posBody tr:nth-child(3) [data-mk]"); pg.wait_for_selector(".mkpop"); pg.screenshot(path="shots/50_mark_pop.png", clip={"x":250,"y":560,"width":1030,"height":420})
    pg.click(".mkpop [data-mkset=rot]"); settle()
    pg.click("#posBody tr:nth-child(1) [data-mk]"); pg.click(".mkpop [data-mkset=gruen]"); settle()
    print("Ansicht:", pg.evaluate("location.hash"))
    pg.click("[data-sort=mark]"); print("Markierung ↑:", names())
    print("DB:", psql("select name||'='||(extra->>'mark') from fin.positions where extra ? 'mark' order by name"))
    pg.reload(); pg.wait_for_selector("#app:not([hidden])"); pg.evaluate("SH.showView('depot')"); pg.wait_for_timeout(300)
    print("nach Neuladen:", names(), pg.evaluate("SH._D().settings.posSort"))
    pg.screenshot(path="shots/51_sortiert.png", clip={"x":250,"y":560,"width":1030,"height":420})
    print("Fehler:", errs)
