"""Baut „Meine Finanzen“ aus den Quellen von Mein Finanzkonto (legacy/finanz)
und Mein Depot (legacy/depot) plus der neuen Hülle (src/).

Die Originale bleiben unverändert. Alle Anpassungen stehen hier als geprüfte
Ersetzungen: Passt eine Stelle nicht mehr, bricht der Build mit Meldung ab.

Ergebnis:
  out/index.html            für den Server (Logo eingebettet)
  out/preview.html          Vorschau ohne Server (Demo-Modus, Daten nur im Speicher)
"""
import base64
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
FIN = os.path.join(HERE, "legacy", "finanz")
DEP = os.path.join(HERE, "legacy", "depot")
SRC = os.path.join(HERE, "src")
LOGO = os.path.join(HERE, "assets")


def rd(*p):
    return open(os.path.join(*p), encoding="utf-8").read()


def rep(s, old, new, count=1, where=""):
    n = s.count(old)
    if n != count:
        sys.exit(f"Build-Fehler ({where}): erwartet {count}x, gefunden {n}x:\n  {old[:160]}")
    return s.replace(old, new)


def rex(s, pat, new, count=1, where="", flags=0):
    out, n = re.subn(pat, new, s, flags=flags)
    if n != count:
        sys.exit(f"Build-Fehler ({where}): Muster {count}x erwartet, {n}x gefunden:\n  {pat[:160]}")
    return out


def cut(s, start, end, where="", keep_end=True):
    """Entfernt alles von start bis (ausschließlich) end."""
    i = s.find(start)
    j = s.find(end, i + 1) if i >= 0 else -1
    if i < 0 or j < 0:
        sys.exit(f"Build-Fehler ({where}): Abschnitt nicht gefunden: {start[:60]} … {end[:60]}")
    return s[:i] + (s[j:] if keep_end else s[j + len(end):])


def after(s, marker, where=""):
    i = s.find(marker)
    if i < 0:
        sys.exit(f"Build-Fehler ({where}): {marker} fehlt")
    return s[i:]


def line_of(s, prefix, where=""):
    m = re.search(r"^" + re.escape(prefix) + r".*$", s, re.M)
    if not m:
        sys.exit(f"Build-Fehler ({where}): Zeile {prefix} fehlt")
    return m.group(0)


# =====================================================================
# Finanzen
# =====================================================================
f_ui1 = rd(FIN, "ui1.js")
f_core = rd(FIN, "core.js")
f_ui2 = rd(FIN, "ui2.js")
f_ui3 = rd(FIN, "ui3.js")
f_ui4 = rd(FIN, "ui4.js")

f_ui = line_of(f_ui1, "var ui={", "fin ui1")
f_helpers = after(f_ui1, "/* ---------- Hilfen ---------- */", "fin ui1")

# ui2: Hinweis auf Sicherung entfällt (Daten liegen auf dem Server); Depotwert im Vermögen
f_ui2 = rex(f_ui2, r'\n  var lb=D\.settings\.lastBackup;\n  if\(D\.accounts\.length&&!D\.demo[^\n]*', "", where="fin ui2 backup")
f_ui2 = rep(f_ui2, '$("netNote").textContent=D.accounts.length?',
            'var dv=SH.depotValue();$("netNote").textContent=(dv!=null?"Depotwert "+eur(dv)+", zusammen "+eur(net+dv)+". ":"")+(D.accounts.length?', where="fin ui2 net")
f_ui2 = rep(f_ui2, ' Die Prognose rechnet mit Daueraufträgen, Gebühren und Zinsen.":"Noch keine Konten.";',
            ' Die Prognose rechnet mit Daueraufträgen, Gebühren und Zinsen.":"Noch keine Konten.");', where="fin ui2 net2")
f_ui2 = rep(f_ui2, '$("welcome").hidden=!!(D.accounts.length||Object.keys(D.plan).length);',
            '$("welcome").hidden=!!(D.accounts.length||Object.keys(D.plan).length||D.pos.length);', where="fin welcome")

# ui4: Profil, PIN und Sicherung übernimmt die Hülle
f_ui4 = rep(f_ui4, '  $("setPName").value=P.name;$("setAutoLock").value=String(D.settings.autoLock||0);$("setCompact").checked=!!D.settings.compact;\n', "", where="fin settings1")
f_ui4 = rex(f_ui4, r"  Array\.prototype\.forEach\.call\(document\.querySelectorAll\('input\[name=\"scheme\"\]'\)[^\n]*\n", "", where="fin settings2")
f_ui4 = rex(f_ui4, r'  var sc=\$\("bkScope"\)[^\n]*\n', "", where="fin settings3")
f_ui4 = rex(f_ui4, r'  \$\("bkLast"\)[^\n]*\n  \$\("bkMeta"\)[^\n]*\n', "", where="fin settings4")
f_ui4 = cut(f_ui4, "/* ---------- Profil ---------- */", "/* ---------- Excel-Import ---------- */", "fin profil")
f_ui4 = cut(f_ui4, "/* ---------- Sicherung ---------- */", "/* ---------- Beispieldaten ---------- */", "fin sicherung")
f_ui4 = rep(f_ui4, "function clearDemo(){var s=D.settings;D=newData();D.settings=s;touch()}",
            'function clearDemo(){var n=newData();["plan","accounts","orders","tx","skips"].forEach(function(k){D[k]=n[k]});D.demo=false;touch()}', where="fin clearDemo")
f_ui4 = f_ui4[:f_ui4.index("/* ---------- Version & Start ---------- */")]

fin_js = ("var FIN=(function(SH){\n\"use strict\";\n" + f_core + "\n" + rd(SRC, "fin_pre.js").replace("/*UI*/", f_ui) + "\n" + f_helpers + "\n"
          + f_ui2 + "\n" + f_ui3 + "\n" + f_ui4 + "\n" + rd(SRC, "fin_post.js") + "\n})(SH);\n")

# =====================================================================
# Depot
# =====================================================================
d_base, d_calc, d_calc2 = rd(DEP, "base.js"), rd(DEP, "calc.js"), rd(DEP, "calc2.js")
d_ui1, d_ui2, d_ui3, d_ui4 = rd(DEP, "ui1.js"), rd(DEP, "ui2.js"), rd(DEP, "ui3.js"), rd(DEP, "ui4.js")
d_ui = line_of(d_ui1, "var ui={", "dep ui1")
d_helpers = after(d_ui1, "/* ---------- Hilfen ---------- */", "dep ui1")

# Beispieldepot-Kennzeichen getrennt vom Finanz-Beispiel
DEMO_RE = r"\bD\.demo\b"
d_calc = re.sub(r"\bd\.demo=!!o\.demo", "d.demoDepot=!!o.demoDepot", d_calc)
d_calc = re.sub(r",qtime:0,demo:false}", ",qtime:0,demoDepot:false}", d_calc)
d_calc = re.sub(DEMO_RE, "D.demoDepot", d_calc)
d_calc2 = re.sub(DEMO_RE, "D.demoDepot", d_calc2)

# gleiche Element-IDs wie im Finanzteil bekommen den Vorsatz dp
DP_IDS = ["clearDemo", "demoBar", "loadDemo", "planMsg", "txCancel", "txDel", "txForm", "txFormTitle", "txMsg", "txSave", "welcome"]


def dp(s, where):
    s = s.replace('$("alerts")', '$("dpAlerts")').replace('"#txForm ', '"#dpTxForm ')
    for i in DP_IDS:
        s = s.replace('"' + i + '"', '"dp' + i[0].upper() + i[1:] + '"')
    return re.sub(DEMO_RE, "D.demoDepot", s)


d_ui2, d_ui3, d_ui4 = dp(d_ui2, "ui2"), dp(d_ui3, "ui3"), dp(d_ui4, "ui4")

# Kurse kommen vom eigenen Server
d_ui2 = rex(d_ui2, r"function apiBase\(\)\{[^\n]*\}", 'function apiBase(){return "api/market/"}', where="dep apiBase")
d_ui2 = rep(d_ui2, "if(!r.ok)throw new Error(j&&j.error||\"HTTP \"+r.status);return j", "if(!r.ok){if(r.status===401)SH.sessionLost();throw new Error(j&&(j.error||j.detail)||\"HTTP \"+r.status)}return j", where="dep getJSON")
d_ui2 = rex(d_ui2, r'\n  var lb=D\.settings\.lastBackup;if\(D\.pos\.length[^\n]*', "", where="dep backup hint")
d_ui2 = rep(d_ui2, '"<b>Kurs-Server nicht erreichbar.</b> "', '"<b>Kurse gerade nicht abrufbar.</b> "', where="dep qerr")
d_ui2 = rep(d_ui2, '  if(document.activeElement!==$("sApi"))$("sApi").value=D.settings.api||"api/";\n', "", where="dep sApi")
d_ui2 = rep(d_ui2, '  $("setPName").value=P.name;$("setAutoLock").value=String(D.settings.autoLock||0);$("setCompact").checked=!!D.settings.compact;\n', "", where="dep set1")
d_ui2 = rex(d_ui2, r"  Array\.prototype\.forEach\.call\(document\.querySelectorAll\('input\[name=\"scheme\"\]'\)[^\n]*\n", "", where="dep set2")
d_ui2 = rex(d_ui2, r'  \$\("bkLast"\)[^\n]*\n  \$\("bkMeta"\)[^\n]*\n', "", where="dep set3")
d_ui2 = rex(d_ui2, r'\$\("sApi"\)\.addEventListener[^\n]*\n', "", where="dep sApi2")
d_ui2 = rep(d_ui2, 'setMsg("apiMsg","Verbinde mit "+apiBase()+" …");', 'setMsg("apiMsg","Prüfe die Kursquellen …");', where="dep apitest1")
d_ui2 = rep(d_ui2, 'setMsg("apiMsg","Verbunden mit Proxy "+(j.version||"")+(j.demo?" (Demo-Modus)":"")+". "', 'setMsg("apiMsg","Server erreichbar. "', where="dep apitest2")
d_ui2 = rep(d_ui2, '.catch(function(e){setMsg("apiMsg","Keine Verbindung zu "+apiBase()+": "+(e&&e.message||e)+". Läuft der Proxy, und stimmt die Adresse?",true)});',
            '.catch(function(e){setMsg("apiMsg","Keine Kurse: "+(e&&e.message||e),true)});', where="dep apitest3")
d_ui2 = cut(d_ui2, '$("setPName").addEventListener("change"', "/* ---------- Beispieldepot ---------- */", "dep profil+sicherung")
d_ui2 = rep(d_ui2, "function clearDemo(){var s=D.settings;D=newData();D.settings=s;HIST={};qErr=null}",
            'function clearDemo(){var n=newData();["pos","watch","alerts","plans","events"].forEach(function(k){D[k]=n[k]});D.quotes={};D.qtime=0;D.demoDepot=false;HIST={};qErr=null}', where="dep clearDemo")
show_line = line_of(d_ui2, "var _show=showView;showView=function(v,a){_show(v,a);", "dep show")
assert show_line.endswith("};"), show_line
d_ui2 = d_ui2.replace(show_line, "VIEWHOOKS.push(function(v,a){" + show_line[len("var _show=showView;showView=function(v,a){_show(v,a);"):-2] + "});")
d_ui2 = d_ui2[:d_ui2.index("/* ---------- Start ---------- */")]

# Positionen sortierbar
d_ui2 = rep(d_ui2, '$("posBody").innerHTML=s.rows.map(function(r,i){', 'renderSortHead();$("posBody").innerHTML=sortRows(s.rows).map(function(r,i){', where="dep sort")
d_ui2 = rep(d_ui2, '\'><td><b class="pn">\'+esc(p.name)', '\'><td class="pnc">\'+markBtn(p)+\'<b class="pn">\'+esc(p.name)', where="dep mark")
d_ui2 = rep(d_ui2, '(closed?" · verkauft":"")+\'</span></td><td class="r mono">\'+(closed?"–":fmtQty(r.shares))', '(closed?" · verkauft":"")+\'</span>\'+catChip(p)+\'</td><td class="r mono">\'+(closed?"–":fmtQty(r.shares))', where="dep catchip")
d_ui2 = rep(d_ui2, '  $("sumRows").textContent=act.length?', '  decorateGroups(s);\n  $("sumRows").textContent=act.length?', where="dep groups")
d_ui2 = rep(d_ui2, 'var p=curPos();if(!p)return;var n=$("eName").value.trim()', 'var p=curPos();if(!p)return;var cv=$("eCat").value.trim().slice(0,30);if(cv)p.cat=cv;else delete p.cat;var n=$("eName").value.trim()', where="dep ecat save")
d_ui2 = d_ui2.replace("/* Depotverlauf */", rd(SRC, "dep_sort.js") + rd(SRC, "dep_cat.js") + "\n/* Depotverlauf */", 1)

# Alarme: mehrere Wertpapiere, neue Bedingung „± %“
d_ui3 = cut(d_ui3, '$("alForm").addEventListener("submit"', '$("alList").addEventListener("click"', "dep alarm submit")
d_ui3 = cut(d_ui3, "/* ---------- Alarme ---------- */", "function renderAlertList(){", "dep alarm sel")
d_ui3 = d_ui3.replace("function renderAlertList(){", rd(SRC, "dep_alarm.js") + "\nfunction renderAlertList(){", 1)
d_ui3 = rep(d_ui3, 'daily=a.type==="dayDown"||a.type==="dayUp";', 'daily=/^day/.test(a.type);', where="dep daily")
d_ui3 = rep(d_ui3, 'function alertValTxt(a){return a.type==="dayDown"||a.type==="dayUp"?NFP.format', 'function alertValTxt(a){return /^day/.test(a.type)?(a.type==="dayMove"?"± ":"")+NFP.format', where="dep altxt")
d_calc2 = rep(d_calc2, 'var ALTYPE={above:"steigt auf",below:"fällt auf",dayDown:"fällt heute um",dayUp:"steigt heute um"};', 'var ALTYPE={above:"steigt auf",below:"fällt auf",dayDown:"fällt heute um",dayUp:"steigt heute um",dayMove:"bewegt sich heute um"};', where="calc altype")
d_calc2 = rep(d_calc2, '  if(a.type==="dayUp")return ch>=Math.abs(v);', '  if(a.type==="dayUp")return ch>=Math.abs(v);\n  if(a.type==="dayMove")return Math.abs(ch)>=Math.abs(v);', where="calc daymove")
d_ui3 = rep(d_ui3, 'depOpts($("eDepot"),false);$("eDepot").value=p.depot||defaultDepot(D);', 'depOpts($("eDepot"),false);$("eDepot").value=p.depot||defaultDepot(D);\n  if(document.activeElement!==$("eCat"))$("eCat").value=p.cat||"";$("catPosList").innerHTML=catList().map(function(k){return \'<option value="\'+esc(k)+\'">\'}).join("");', where="dep ecat fill")
d_ui3 = rep(d_ui3, ':ui.alloc==="cur"?(r.cur==="GBp"?"GBP":r.cur||"EUR"):PKIND', ':ui.alloc==="cur"?(r.cur==="GBp"?"GBP":r.cur||"EUR"):ui.alloc==="cat"?(r.p.cat||"Ohne Kategorie"):PKIND', where="dep alloc cat")

# Mail-Alarme laufen über den Server (Konto des Nutzers)
d_ui3 = cut(d_ui3, "/* ---------- E-Mail-Alarme: Abgleich mit dem Webspace ---------- */", "/* ---------- Sparpläne ---------- */", "dep mail")
d_ui3 = d_ui3.replace("/* ---------- Sparpläne ---------- */", rd(SRC, "dep_mail.js") + "\n/* ---------- Sparpläne ---------- */", 1)
d_ui3 = rex(d_ui3, r'  var st=D\.settings\.alertKey\?[^\n]*\n', '  var mu=SH.user(),st=mu.alert_mail?"E-Mail-Alarme sind an und gehen an "+(mu.alert_email||mu.email)+". Der Server prüft die Kurse alle 15 Minuten, auch wenn die Seite zu ist.":"E-Mail-Alarme sind aus. Ohne sie meldet sich die Seite nur, solange sie offen ist.";\n', where="dep alstate")
# Depots: Verrechnungskonto wählbar
d_ui3 = rep(d_ui3, '<small>\'+n+" Positionen"+(i===0?" · Standard":"")+"</small></span>"',
            '<small>\'+n+" Positionen"+(i===0?" · Standard":"")+"</small>"+SH.cashPicker(x)+"</span>"', where="dep cash")
d_ui4 = rep(d_ui4, '(function(){var prev=showView;showView=function(v,a){prev(v,a);if(D&&v==="zeitung")renderZeitung(false)}})();',
            'VIEWHOOKS.push(function(v){if(D&&v==="zeitung")renderZeitung(false)});', where="dep zeitung")

for name, s in (("ui2", d_ui2), ("ui3", d_ui3), ("ui4", d_ui4)):
    for bad in ('"auswertung"', "showGate", "writeRoot", "PIN", "R.profiles", "alertKey"):
        if bad in s:
            sys.exit(f"Build-Fehler: {bad} noch in depot {name}")

dep_js = ("var DEP=(function(SH){\n\"use strict\";\n" + d_base + "\n" + d_calc + "\n" + d_calc2 + "\n"
          + rd(SRC, "dep_pre.js").replace("/*UI*/", d_ui) + "\n" + d_helpers + "\n" + d_ui2 + "\n" + d_ui3 + "\n" + d_ui4 + "\n"
          + rd(SRC, "dep_post.js") + "\n})(SH);\n")

# =====================================================================
# Seite zusammensetzen
# =====================================================================
f_body, d_body = rd(FIN, "body.html"), rd(DEP, "body.html")


def views(body, names, where):
    out = []
    for n in names:
        m = re.search(r'(  <!-- [^\n]* -->\n)?  <section class="view" data-view="' + n + r'">.*?\n  </section>\n', body, re.S)
        if not m:
            sys.exit(f"Build-Fehler: Ansicht {n} fehlt ({where})")
        out.append(m.group(0))
    return "\n".join(out)


def section(body, sec, where):
    m = re.search(r'    <details class="card sect" data-sec="' + sec + r'".*?\n    </details>\n', body, re.S)
    if not m:
        sys.exit(f"Build-Fehler: Abschnitt {sec} fehlt ({where})")
    return m.group(0)


def nav(body, where):
    m = re.search(r'<nav class="nav" id="nav">\n(.*?)    </nav>', body, re.S)
    links = [l for l in m.group(1).split("\n") if l.strip() and 'data-view="einstellungen"' not in l]
    return "\n".join(links)


fin_views = views(f_body, ["uebersicht", "konten", "auftraege", "kredite", "plan", "auswertung"], "fin")
fin_sets = section(f_body, "setacc", "fin") + "\n" + section(f_body, "setimport", "fin")
fin_sets = rep(fin_sets, '<p class="hintline">Die Importdatei enthält deine Zahlen unverschlüsselt. Lösche sie nach dem Import oder bewahre sie sicher auf.</p>',
               '<p class="hintline">Die Datei selbst bleibt auf deinem Rechner. Übernommen werden nur die Planwerte, sie liegen danach in deinem Konto auf dem Server.</p>', where="imp hint")
fin_nav = nav(f_body, "fin")

d_html = d_body
for i in DP_IDS:
    d_html = d_html.replace('id="' + i + '"', 'id="dp' + i[0].upper() + i[1:] + '"').replace('for="' + i + '"', 'for="dp' + i[0].upper() + i[1:] + '"')
d_html = rep(d_html, 'data-sec="welcome"', 'data-sec="dpwelcome"', where="dp welcome")
d_html = rep(d_html, '<section class="view" data-view="auswertung">', '<section class="view" data-view="dauswertung">', where="dp ausw")
d_html = rep(d_html, '<a href="#auswertung" data-view="auswertung">', '<a href="#dauswertung" data-view="dauswertung">', where="dp ausw nav")
d_html = rep(d_html, '<div class="fc"><span class="lbl">Kurs-Server</span><p>Die Kurse kommen über ein kleines Python-Skript auf deinem Server. Hier prüfst du die Verbindung.</p><button class="btn" type="button" data-go="einstellungen#setapi">Verbindung prüfen</button></div>',
             '<div class="fc"><span class="lbl">Verrechnungskonto</span><p>Verknüpfe das Depot mit einem Konto. Käufe, Verkäufe und Dividenden werden dort automatisch gebucht.</p><button class="btn" type="button" data-go="einstellungen#setdep">Depot verknüpfen</button></div>', where="dp welcome text")
d_html = rep(d_html, '<thead><tr><th>Wertpapier</th><th class="r">Stück</th><th class="r">Kurs</th><th class="r">Heute</th><th class="r">Wert</th><th class="r">Gewinn/Verlust</th><th class="r">Anteil</th></tr></thead>',
  '<thead><tr id="posHead">' + '<th><button class="sortbtn mksort" type="button" data-sort="mark" title="Nach Markierung sortieren" aria-label="Nach Markierung sortieren"><b class="mkdot on" style="--mk:var(--muted)"></b><i aria-hidden="true"></i></button>' + '<button class="sortbtn" type="button" data-sort="name" title="Sortieren nach Wertpapier">Wertpapier<i aria-hidden="true"></i></button></th>' + "".join('<th%s><button class="sortbtn" type="button" data-sort="%s" title="Sortieren nach %s">%s<i aria-hidden="true"></i></button></th>' % (c, k, t, t)
  for c, k, t in [(' class="r"', "shares", "Stück"), (' class="r"', "price", "Kurs"), (' class="r"', "day", "Heute"),
                  (' class="r"', "value", "Wert"), (' class="r"', "gain", "Gewinn/Verlust"), (' class="r"', "share", "Anteil")]) + '</tr></thead>', where="dp sorthead")
d_html = rep(d_html, '<div class="field span2"><label for="alSym">Wertpapier</label><select id="alSym"></select></div>',
  '<div class="field span2"><span class="flabel" id="alSymLbl">Wertpapiere <small class="hint" id="alCount"></small></span>'
  '<div class="alpick" id="alSyms" role="group" aria-labelledby="alSymLbl"></div>'
  '<div class="alpickbar"><span class="hint">Auswählen:</span><button type="button" class="catopt" id="alAll">alle im Bestand</button><button type="button" class="catopt" id="alWatch">+ Watchlist</button>'
  '<span id="alCatWrap" hidden><span class="hint">Kategorie:</span> <span id="alCats"></span></span><button type="button" class="catopt" id="alNone">keine</button></div></div>', where="al pick")
d_html = rep(d_html, '<option value="dayDown">heute fällt um mindestens (%)</option><option value="dayUp">heute steigt um mindestens (%)</option>',
  '<option value="dayMove">sich heute um mindestens ± bewegt (%)</option><option value="dayDown">heute fällt um mindestens (%)</option><option value="dayUp">heute steigt um mindestens (%)</option>', where="al types")
d_html = rep(d_html, '<button class="btn primary" type="submit">Alarm anlegen</button>', '<button class="btn primary" type="submit" id="alGo">Alarm anlegen</button><button class="btn danger" type="button" id="alDelAll">Alle Alarme löschen</button>', where="al go")
d_html = rep(d_html, '<div class="field"><label for="eDepot">Depot</label><select id="eDepot"></select></div>',
  '<div class="field"><label for="eDepot">Depot</label><select id="eDepot"></select></div><div class="field"><label for="eCat">Kategorie</label><input type="text" id="eCat" maxlength="30" list="catPosList" placeholder="z. B. Dividende, Wachstum"><datalist id="catPosList"></datalist></div>', where="pedit cat")
d_html = rep(d_html, '<label><input type="radio" name="alm" value="kind"><span>Art</span></label>', '<label><input type="radio" name="alm" value="kind"><span>Art</span></label>\n          <label><input type="radio" name="alm" value="cat"><span>Kategorie</span></label>', where="alloc cat")
d_html = rep(d_html, '<span class="smeta" id="sumRows"></span></summary>\n        <div class="tablewrap"><table class="postab">', '<span class="smeta" id="sumRows"></span></summary>\n        <div class="postools"><label for="posGroup">Gruppieren</label><select id="posGroup"><option value="">nicht gruppieren</option><option value="cat">nach Kategorie</option><option value="mark">nach Markierung</option></select><span class="hint">Kategorie: im Namen auf „+ Kategorie“ tippen</span></div><div class="tablewrap"><table class="postab">', where="pos tools")
dep_views = views(d_html, ["depot", "position", "zeitung", "watchlist", "alarme", "neu", "dauswertung"], "dep")
dep_nav = nav(d_html, "dep")
dep_setdep = section(d_html, "setdep", "dep")

top = rd(SRC, "shell_top.html").replace("%%NAV_FIN%%", fin_nav).replace("%%NAV_DEP%%", dep_nav)
settings = rd(SRC, "shell_settings.html").replace("%%FIN_SETTINGS%%", fin_sets).replace("%%DEP_SETDEP%%", dep_setdep)
body = top + "\n" + fin_views + "\n" + dep_views + "\n" + settings

css = rd(DEP, "css_a.css")
css = rep(css, "family=JetBrains+Mono:wght@400;600&", "family=JetBrains+Mono:wght@400;600&family=UnifrakturMaguntia&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&", where="css fonts")
css = rep(css, "<title>Mein Zeitkonto</title>", "<title>Meine Finanzen</title>", where="css title")
css += rd(DEP, "css_b.css") + rd(DEP, "css_c.css") + rd(DEP, "css_d.css") + rd(SRC, "extra.css") + "</style>\n\n"

js = rd(SRC, "shell.js") + "\n" + fin_js + "\n" + dep_js + "\nSH.boot();\n"
page = css + body + "\n<script>\n" + js + "</script>\n"
os.makedirs("out", exist_ok=True)
open("out/app.js", "w", encoding="utf-8").write(js)

b64 = lambda f: "data:image/jpeg;base64," + base64.b64encode(open(f, "rb").read()).decode()
head, full = b64(os.path.join(LOGO, "logo_head.jpg")), b64(os.path.join(LOGO, "logo_full.jpg"))
page = page.replace("%%LOGO_HEAD%%", head).replace("%%LOGO_FULL%%", full)
assert "%%" not in page, re.findall(r"%%\w+%%", page)
i = page.index("<!-- Anmeldung -->")
doc = ('<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
       '<meta name="robots" content="noindex">\n' f'<link rel="icon" href="{head}">\n' + page[:i] + "</head>\n<body>\n" + page[i:] + "\n</body>\n</html>\n")
os.makedirs("out", exist_ok=True)
open("out/index.html", "w", encoding="utf-8").write(doc)
open("out/preview.html", "w", encoding="utf-8").write(doc.replace("<script>\n", "<script>\nwindow.MF_PREVIEW=true;\n", 1))
ids = re.findall(r'\bid="([^"]+)"', body)
dups = sorted({x for x in ids if ids.count(x) > 1})
if dups:
    sys.exit("Build-Fehler: doppelte IDs " + ", ".join(dups))
print("ok", len(doc) // 1024, "KB")
