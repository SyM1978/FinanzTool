"""Echter Ablauf ohne Beispieldaten: Konto, Kauf mit Kursen vom Server, Verrechnungskonto,
Zeitung, Alarm, Umzug einer alten verschlüsselten Sicherung, abgelaufene Sitzung."""
import subprocess, json
from playwright.sync_api import sync_playwright
U = "http://127.0.0.1:8800/"
errs = []
psql = lambda q: subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","finanzen","-tAq","-c",q],capture_output=True,text=True).stdout.strip()
psql("TRUNCATE fin.users, fin.market_cache CASCADE")
n = 0
def ok(c, m):
    global n
    assert c, m; n += 1; print("ok:", m)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 900}, bypass_csp=True)
    pg = ctx.new_page()
    pg.route("**/fonts.g*/**", lambda r: r.abort())
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text and "401" not in m.text else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    settle = lambda: pg.wait_for_function("!SH._pending()", timeout=15000)
    pg.goto(U); pg.wait_for_selector("#gReg:not([hidden])")
    pg.fill("#gRName","Markus"); pg.fill("#gREmail","m@example.de"); pg.fill("#gRPw","geheim12345"); pg.fill("#gRPw2","geheim12345"); pg.click("#gRGo")
    pg.wait_for_selector("#app:not([hidden])"); settle()
    # Konto anlegen über das Formular
    pg.evaluate("SH.showView('einstellungen','konten')")
    pg.fill("#aName","Girokonto"); pg.fill("#aStartDate","2026-01-01"); pg.fill("#aStart","2.500,00"); pg.click("#accSave"); settle()
    ok(psql("select name||':'||start_amount from fin.accounts") == "Girokonto:250000", "Konto in der DB")
    # Wertpapier suchen und kaufen
    pg.evaluate("SH.showView('neu')"); pg.fill("#sQ","sap"); pg.press("#sQ","Enter"); pg.wait_for_selector("#sRes [data-sr]")
    pg.click("#sRes [data-sr]"); pg.fill("#nDate","2026-03-02"); pg.fill("#nQty","10"); pg.fill("#nPrice","180,50"); pg.fill("#nFee","4,90")
    pg.click("#nForm button[type=submit]"); pg.wait_for_function("SH._D().quotes['OV:STOCK:DE0007164600']", timeout=10000); settle()
    ok(psql("select sym||':'||qty||':'||price from fin.positions p join fin.sec_tx t on t.pos_id=p.id") == "OV:STOCK:DE0007164600:10.00000000:180.500000", "Kauf in der DB")
    ok(pg.evaluate("SH._D().quotes['OV:STOCK:DE0007164600'].price") == 214.35, "Kurs vom Server (onvista nachgebaut)")
    ok(psql("select count(*) from fin.market_cache") != "0", "Kurs-Cache gefüllt")
    # Verrechnungskonto
    pg.evaluate("SH.showView('einstellungen','setdep')"); pg.select_option("select[data-depacc]", pg.evaluate("FIN.accounts()[0].id"))
    pg.fill("input[data-depfrom]","2026-01-01"); pg.dispatch_event("input[data-depfrom]","change"); settle()
    ok(psql("select amount||':'||cat from fin.bookings where sec_tx is not null") == "-180990:Wertpapiere", "Kauf als Buchung im Girokonto (−1.809,90 €)")
    pg.evaluate("SH.showView('uebersicht')"); pg.wait_for_timeout(200)
    ok("690,10 €" in pg.inner_text("#tiles"), "Girokonto-Stand berücksichtigt den Kauf: " + pg.inner_text("#tiles")[:60])
    # Dividende im Depot -> Gutschrift
    pg.evaluate("var D=SH._D();D.pos[0].tx.push({id:'div1',type:'div',date:'2026-05-20',qty:0,price:0,fee:0,amount:23.5,u:Date.now()});SH.changed('dep')"); settle()
    ok(psql("select amount from fin.bookings where id='sx_div1'") == "2350", "Dividende als Gutschrift")
    pg.evaluate("var D=SH._D();D.pos[0].tx=D.pos[0].tx.filter(function(t){return t.id!=='div1'});SH.changed('dep')"); settle()
    ok(psql("select count(*) from fin.bookings where id='sx_div1'") == "0", "gelöschte Dividende entfernt auch die Buchung")
    # Übersicht zeigt Depotwert
    pg.evaluate("SH.showView('uebersicht')"); pg.wait_for_timeout(200)
    ok("Depotwert 2.143,50 €" in pg.inner_text("#netNote"), "Depotwert im Vermögen: " + pg.inner_text("#netNote"))
    # Zeitung mit Meldungen von heute
    pg.evaluate("SH.showView('zeitung')"); pg.wait_for_function("document.getElementById('ztStat').textContent.indexOf('von heute')>=0", timeout=10000)
    ok("SAP meldet Quartalszahlen" in pg.inner_text("section[data-view=zeitung]"), "Aktienzeitung über den Server")
    pg.screenshot(path="shots/30_zeitung.png", full_page=True)
    # Kursalarm + Mail an
    pg.evaluate("SH.showView('alarme')"); pg.select_option("#alType","above"); pg.fill("#alVal","200"); pg.click("#alForm button[type=submit]"); settle()
    ok(psql("select type||':'||value from fin.price_alerts") == "above:200.000000", "Alarm in der DB")
    pg.evaluate("SH.showView('einstellungen','setmail')"); pg.check("#mOn"); pg.click("#mSave"); pg.wait_for_function("document.getElementById('mMsg').textContent.indexOf('an')>=0")
    ok(psql("select alert_mail from fin.users") == "t", "Mail-Alarme eingeschaltet")
    # Umzug: alte verschlüsselte Finanzkonto-Sicherung (wie die alte App sie erzeugt)
    bk = pg.evaluate("""(async function(){
      var data={plan:{},accounts:[{id:'alt1',name:'Urlaubskonto',kind:'spar',color:'#1D5F8A',start:{date:'2026-01-01',amount:120000},u:5}],orders:[],tx:[{id:'altt',acc:'alt1',date:'2026-02-01',amount:5000,text:'Einzahlung',cat:'',u:5}],skips:[],settings:{scheme:'salbei'}};
      var te=new TextEncoder(),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
      var base=await crypto.subtle.importKey('raw',te.encode('1234'),'PBKDF2',false,['deriveKey']);
      var k=await crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:250000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt']);
      var ct=await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},k,te.encode(JSON.stringify(data)));
      var b=function(u){u=new Uint8Array(u);var s='';for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s)};
      return JSON.stringify({type:'finanzkonto-backup',v:1,scope:'alles',profile:'Markus',date:'2026-10-01',salt:b(salt),it:250000,iv:b(iv),ct:b(ct)});})()""")
    pg.evaluate("SH.showView('einstellungen','setdata')"); pg.fill("#mgTxt", bk); pg.fill("#mgPin","falsch"); pg.click("#mgGo"); pg.wait_for_timeout(1500)
    ok("PIN" in pg.inner_text("#mgMsg"), "falsche PIN abgelehnt")
    pg.fill("#mgPin","1234"); pg.click("#mgGo"); pg.wait_for_function("document.getElementById('mgMsg').textContent.indexOf('übernommen')>=0", timeout=10000); settle()
    ok(psql("select string_agg(name,',' order by name) from fin.accounts") == "Girokonto,Urlaubskonto", "Umzug: Konto aus alter Sicherung in der DB")
    # Sitzung läuft ab: Änderung bleibt erhalten und wird nach erneuter Anmeldung gespeichert
    psql("DELETE FROM fin.sessions")
    pg.evaluate("var D=SH._D();D.accounts[0].name='Giro neu';D.accounts[0].u=Date.now();SH.changed('fin')")
    pg.wait_for_selector("#gLogin:not([hidden])", timeout=10000)
    ok(pg.input_value("#gEmail") == "m@example.de", "Anmeldemaske nach abgelaufener Sitzung")
    pg.fill("#gPw","geheim12345"); pg.click("#gGo"); pg.wait_for_selector("#app:not([hidden])"); settle()
    ok(psql("select count(*) from fin.accounts where name='Giro neu'") == "1", "Änderung nach erneuter Anmeldung gespeichert")
    # Export, dann alles ändern, dann „Alles ersetzen“ stellt den Stand wieder her
    before = psql("select (select string_agg(name,',' order by name) from fin.accounts)||'|'||(select count(*) from fin.bookings)||'|'||(select count(*) from fin.sec_tx)")
    ex = pg.evaluate("JSON.stringify(SH._export())")
    pg.evaluate("var D=SH._D();D.accounts.push({id:'neu9',name:'Zusatz',kind:'sonst',color:'#000',start:{date:'2026-01-01',amount:0},u:Date.now()});D.pos[0].tx=[];SH.changed('both')"); settle()
    ok(psql("select count(*) from fin.sec_tx") == "0", "Daten verändert")
    pg.evaluate("SH.showView('einstellungen','setdata')"); pg.fill("#mgTxt", ex); pg.click("#mgReplace"); pg.click("#mgReplace")
    pg.wait_for_function("document.getElementById('mgMsg').textContent.indexOf('eingespielt')>=0"); settle()
    after = psql("select (select string_agg(name,',' order by name) from fin.accounts)||'|'||(select count(*) from fin.bookings)||'|'||(select count(*) from fin.sec_tx)")
    ok(before == after, "Export wieder eingespielt: " + after)
    # Abmelden
    pg.evaluate("SH.showView('einstellungen')"); pg.click("#uLogout"); pg.wait_for_selector("#gLogin:not([hidden])", timeout=10000)
    ok(True, "Abmelden")
    ok(not errs, "keine JS-Fehler " + str(errs))
    b.close()
print("E2E ok:", n, "Prüfungen")
