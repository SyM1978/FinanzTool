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

# geteilte Konten kennzeichnen (Besitzer und Recht), nicht bearbeitbar
f_ui2 = rep(f_ui2, '\'</span><span class="kind">\'+KINDS[a.kind]+\'</span></span>', '\'</span><span class="kind">\'+(a.shared?"von "+esc(a.shared.owner):KINDS[a.kind])+\'</span></span>', where="fin tile shared")
f_ui2 = rep(f_ui2, '$("accKind").innerHTML=\'<span class="kind">\'+KINDS[a.kind]+"</span>";', '$("accKind").innerHTML=\'<span class="kind">\'+KINDS[a.kind]+"</span>"+(a.shared?\' <span class="kind shared">geteilt von \'+esc(a.shared.owner)+(a.shared.perm==="write"?"":" · nur lesen")+"</span>":SH.sharedBadge(a.id));var ro=!!(a.shared&&a.shared.perm!=="write");$("txSave").disabled=ro;$("txSave").title=ro?"Nur zum Ansehen freigegeben":"";', where="fin acckind shared")
f_ui4 = rep(f_ui4, '\'</small></span><button class="btn" type="button" data-eacc="\'+esc(a.id)+\'">Bearbeiten</button></li>\'', '\'</small></span>\'+(a.shared?\'<span class="kind shared">von \'+esc(a.shared.owner)+(a.shared.perm==="write"?"":" · lesen")+"</span>":\'<button class="btn" type="button" data-eacc="\'+esc(a.id)+\'">Bearbeiten</button>\')+\'</li>\'', where="fin acclist shared")

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


# Kredit-Maske: Effektiv-/Sollzins, Hilfe-Infos, Plausibilitätsprüfung
def hlp(t):
    return '<button type="button" class="hlp" aria-label="Hilfe" data-tip="' + t.replace('"', "&quot;") + '">?</button>'
H_REST = "Was du der Bank an diesem Tag noch schuldest. Steht im Kontoauszug oder Online-Banking des Kredits als „Restschuld“ oder „Saldo“.\n\nNicht den Gesamtbetrag aus dem Vertrag eintragen: Der enthält schon alle künftigen Zinsen."
H_DATE = "Der Tag, an dem die Restschuld galt. Am besten der Tag nach der letzten abgebuchten Rate.\n\nAb hier rechnet die App jeden Monat Zinsen und Rate selbst weiter."
H_RATE = "Im Vertrag stehen meist zwei Zinssätze:\n\n• Gebundener Sollzins: der reine Zins pro Jahr. Damit rechnet die Bank die monatlichen Zinsen.\n• Effektiver Jahreszins: etwas höher, weil er den Zinseszins der monatlichen Zahlung (und ggf. Gebühren) enthält.\n\nWähl aus, welchen du einträgst. Den effektiven rechnet die App in den Sollzins um."
H_PAY = "Der Betrag, der jeden Monat abgebucht wird. Darin stecken Zinsen und Tilgung.\n\nDie App legt dafür einen Dauerauftrag vom gewählten Konto an."
H_DAY = "Tag im Monat, an dem die Rate abgebucht wird. An diesem Tag werden auch die Zinsen berechnet.\n\nFällt er aufs Wochenende oder einen Feiertag, rückt die Buchung auf den nächsten Bankarbeitstag."
H_ORIG = "Der Nettodarlehensbetrag laut Vertrag, also was ausgezahlt wurde, ohne Zinsen.\n\nWird nur für die Anzeige „x % getilgt“ gebraucht. Leer lassen geht auch."
f_ui4 = rep(f_ui4, '$("aStartLbl").textContent=l?"Restschuld (€)":"Startwert (€)";$("aStartDateLbl").textContent=l?"Restschuld zu Beginn des":"Stand zu Beginn des"}',
  '$("aStartLbl").innerHTML=l?"Restschuld (€) "+' + repr(hlp(H_REST)) + ':"Startwert (€)";$("aStartDateLbl").innerHTML=l?"Restschuld am "+' + repr(hlp(H_DATE)) + ':"Stand zu Beginn des";loanCheck()}', where="loan kindui")
f_ui4 = rep(f_ui4, '$("aKind").value="giro";$("aStartDate").value=todayKey();', '$("aKind").value="giro";$("aRateType").value="eff";$("aStartDate").value=todayKey();', where="loan reset")
f_ui4 = rep(f_ui4, 'var L=a.loan||{},o=loanOrder(a);$("aRate").value=fmtRate(L.rate||"");',
  'var L=a.loan||{},o=loanOrder(a);$("aRateType").value=a.loanEff?"eff":"nom";$("aRate").value=fmtRate(a.loanEff||L.rate||"");', where="loan edit")
f_ui4 = rep(f_ui4, 'var rate=parseRate($("aRate").value),pay=opt("aPay")', 'var RI=loanRateIn(),rate=RI.raw==null?null:RI.nom,pay=opt("aPay")', where="loan save1")
f_ui4 = rep(f_ui4, 'setMsg("accMsg","Sollzins bitte als Zahl, z. B. 3,85.",true);return}', 'setMsg("accMsg","Zinssatz bitte als Zahl, z. B. 5,24.",true);return}if(RI.eff!=null)a.loanEff=RI.eff;else delete a.loanEff;', where="loan save2")
f_ui4 = rep(f_ui4, '    if(a.loan)a.loan=null;\n', '    if(a.loan)a.loan=null;delete a.loanEff;\n', where="loan save3")
f_ui3 = rep(f_ui3, '$("loanMeta").innerHTML=L.rate?"Sollzins <b>"+fmtRate(L.rate)+" %</b>":"";',
  '$("loanMeta").innerHTML=a.loanEff?"effektiv <b>"+fmtPct(a.loanEff)+" %</b> · Sollzins "+fmtPct(L.rate,3)+" %":L.rate?"Sollzins <b>"+fmtPct(L.rate,3)+" %</b>":"";', where="loan meta")
# Einfache Kredite: Rate ohne Konto, nach der Tilgung ausblenden
H_HIDE = "Ist der Kredit abbezahlt, verschwindet er aus Übersicht, Konten, Krediten, Daueraufträgen und Dashboard.\n\nUnter Einstellungen › Konten bleibt er sichtbar, dort kannst du ihn auch ganz löschen."
H_FROM = "Konto, von dem die Rate abgeht, meist das Girokonto. Dort erscheint sie als geplante Ausgabe in der Prognose.\n\n„kein Konto“: Die Rate wird nur beim Kredit abgezogen, kein anderes Konto ist betroffen. Gut für einfache Kredite, z. B. eine Ratenzahlung."
f_helpers = rep(f_helpers, 'var h=withExtern?\'<option value="">Extern</option>\':"";', 'var h=withExtern?\'<option value="">\'+(withExtern===2?"kein Konto (Rate nicht verbuchen)":"Extern")+"</option>":"";', where="accopts label")
f_ui4 = rep(f_ui4, 'var pf=$("aPayFrom").value;accOpts($("aPayFrom"),true,', 'var pf=$("aPayFrom").value;accOpts($("aPayFrom"),2,', where="payfrom opts1")
f_ui4 = rep(f_ui4, 'if(D){accOpts($("aPayFrom"),true,', 'if(D){accOpts($("aPayFrom"),2,', where="payfrom opts2")
f_ui4 = rep(f_ui4, '$("aKind").value="giro";$("aRateType").value="eff";', '$("aKind").value="giro";$("aRateType").value="eff";$("aLoanHide").checked=true;', where="hide reset")
f_ui4 = rep(f_ui4, '$("aRateType").value=a.loanEff?"eff":"nom";', '$("aRateType").value=a.loanEff?"eff":"nom";$("aLoanHide").checked=!!a.loanHide;', where="hide edit")
f_ui4 = rep(f_ui4, 'if(RI.eff!=null)a.loanEff=RI.eff;else delete a.loanEff;', 'if(RI.eff!=null)a.loanEff=RI.eff;else delete a.loanEff;if($("aLoanHide").checked)a.loanHide=true;else delete a.loanHide;', where="hide save")
f_ui4 = rep(f_ui4, 'if(a.loan)a.loan=null;delete a.loanEff;', 'if(a.loan)a.loan=null;delete a.loanEff;delete a.loanHide;', where="hide save2")
f_ui4 = rep(f_ui4, 'var f=forecast(D,a),x=[KINDS[a.kind],"Stand "+eur(f.now)];', 'var f=forecast(D,a),x=[KINDS[a.kind],"Stand "+eur(f.now)];if(loanGone(a))x=[KINDS[a.kind],"getilgt am "+dmy(f.paid),"ausgeblendet"];', where="hide setlist")
f_ui2 = rep(f_ui2, '$("nmAcc").textContent=D.accounts.length||"";', '$("nmAcc").textContent=shownAccs().length||"";', where="hide nmacc")
f_ui2 = rep(f_ui2, 'var nl=D.accounts.filter(isLoan).length;', 'var nl=loansShown().length;', where="hide nmloan")
f_ui2 = rep(f_ui2, '  D.accounts.forEach(function(a){\n    if(isLoan(a)){', '  D.accounts.forEach(function(a){\n    if(loanGone(a))return;\n    if(isLoan(a)){', where="hide alerts")
f_ui2 = rep(f_ui2, '$("tiles").innerHTML=D.accounts.map(', '$("tiles").innerHTML=shownAccs().map(', where="hide tiles")
f_ui2 = rep(f_ui2, '$("sumTiles").textContent=D.accounts.length?D.accounts.length+" Konten":"";', 'var shn=shownAccs().length;$("sumTiles").textContent=shn?shn+" Konten":"";', where="hide sumtiles")
f_ui2 = rep(f_ui2, '$("accPick").innerHTML=D.accounts.map(', '$("accPick").innerHTML=shownAccs().filter(function(x){return x.id===a.id||!loanGone(x)}).map(', where="hide accpick")
f_ui2 = rep(f_ui2, 'a=D.accounts.filter(function(x){return !isLoan(x)})[0]||D.accounts[0]||null;', 'a=D.accounts.filter(function(x){return !isLoan(x)})[0]||shownAccs()[0]||null;', where="hide curacc")
f_ui3 = rep(f_ui3, '.concat(D.accounts.map(function(a){return \'<button type="button" data-of=', '.concat(shownAccs().map(function(a){return \'<button type="button" data-of=', where="hide ordfilter")
f_ui3 = rep(f_ui3, 'var list=D.orders.filter(function(o){return !f||o.from===f||o.to===f})', 'var list=D.orders.filter(function(o){return (!f||o.from===f||o.to===f)&&!loanGone(accById(D,o.to))})', where="hide orders")
f_ui3 = rep(f_ui3, 'function curLoan(){var l=D.accounts.filter(isLoan),', 'function curLoan(){var l=loansShown(),', where="hide curloan")
f_ui3 = rep(f_ui3, 'var a=curLoan(),l=D.accounts.filter(isLoan);', 'var a=curLoan(),l=loansShown();', where="hide loans")
f_ui3 = rep(f_ui3, '$("loanNone").hidden=!!a;', '$("loanNone").hidden=!!a;if(!a){var gn=D.accounts.filter(loanGone).length;if(ui.loanNoneH==null)ui.loanNoneH=$("loanNone").innerHTML;$("loanNone").innerHTML=gn?(gn===1?"Dein Kredit ist getilgt und ausgeblendet. Du findest ihn":"Alle "+gn+" Kredite sind getilgt und ausgeblendet. Du findest sie")+\' weiter unter <button class="linkbtn" type="button" data-go="einstellungen#konten">Einstellungen › Konten</button>.\':ui.loanNoneH}', where="hide loannone")
f_ui2 = rep(f_ui2, '$("nmOrd").textContent=D.orders.length||"";', '$("nmOrd").textContent=shownOrders().length||"";', where="hide nmord")
f_ui3 = rep(f_ui3, '$("ordMeta").textContent=D.orders.length?D.orders.length+" Aufträge":"";', 'var sho=shownOrders().length;$("ordMeta").textContent=sho?sho+" Aufträge":"";', where="hide ordmeta")
# Kontoauszug einlesen
f_ui2 = rep(f_ui2, "function renderAccounts(){", "function renderAccounts(){\n  kaFill();rcFill();", where="ka fill")
f_ui2 = rep(f_ui2, 'var c=balAt(compute(D).acc[a.id],d);rcDiff={d:d,v:b-c};', 'var c=balAt(compute(D).acc[a.id],d);rcDiff={d:d,v:b-c,acc:a.id};', where="rc acc1")
f_ui2 = rep(f_ui2, '$("reconMeta").textContent=rcDiff.v===0?"stimmt":"Differenz "+eur(rcDiff.v,true);', '$("reconMeta").textContent=a.name+(rcDiff.v===0?" · stimmt":" · Differenz "+eur(rcDiff.v,true));', where="rc acc2")
f_ui2 = rep(f_ui2, 'var a=curAcc();if(!rcDiff||!rcDiff.v)return;', 'if(!rcDiff||!rcDiff.v)return;var a=accById(D,rcDiff.acc);if(!a)return;', where="rc acc3")
f_ui2 = rep(f_ui2, 'setMsg("rcMsg","Korrektur von "+eur(rcDiff.v,true)+" gebucht.");$("reconMeta").textContent="stimmt";', 'setMsg("rcMsg","Korrektur von "+eur(rcDiff.v,true)+" in „"+a.name+"“ gebucht.");$("reconMeta").textContent=a.name+" · stimmt";', where="rc acc4")
f_ui4 = f_ui4 + "\n" + rd(SRC, "fin_loan.js")
f_ui4 = f_ui4 + "\n" + rd(SRC, "fin_stmt.js")

fin_js = (rd(SRC, "stmt_parse.js").replace("if(typeof module!==\"undefined\"&&module.exports)module.exports=STMT;", "") + "\nvar FIN=(function(SH){\n\"use strict\";\n" + f_core + "\n" + rd(SRC, "fin_pre.js").replace("/*UI*/", f_ui) + "\n" + f_helpers + "\n"
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
# Depot-Entwicklung im Depotwert-Kasten
d_ui2 = cut(d_ui2, "var dChartReq=0;", "function ticksFor(a,b,x){", "dep hist")
d_ui2 = d_ui2.replace("function ticksFor(a,b,x){", rd(SRC, "dep_hist.js") + "\nfunction ticksFor(a,b,x){", 1)
d_ui2 = rep(d_ui2, '$("dChart").innerHTML=\'<p class="empty">Verlauf wird geladen …</p>\';loadDepotChart()', 'devHoverOff();$("dChart").innerHTML=\'<p class="empty">Verlauf wird geladen …</p>\';loadDepotChart()', where="dep hist range")

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

# Dividenden: optionales Referenzkonto je Position und je Buchung
d_ui2 = rep(d_ui2, 'document.querySelector("#dpTxForm .td").hidden=v!=="div";',
  'document.querySelector("#dpTxForm .td").hidden=v!=="div";document.querySelector("#dpTxForm .tdacc").hidden=v!=="div";if(v==="div"){var cp=curPos(),et=ui.editTx&&cp?cp.tx.filter(function(x){return x.id===ui.editTx})[0]:null,sv=$("tDivAcc").getAttribute("data-v");SH.divAccOptions($("tDivAcc"),cp,"tx",sv!=null?sv:(et&&et.acc)||"")}', where="div acc toggle")
d_ui2 = rep(d_ui2, '["tQty","tPrice","tFee","tAmt"].forEach(function(id){$(id).value=""});$("tDate").value=todayKey();setTxType("buy");',
  '["tQty","tPrice","tFee","tAmt"].forEach(function(id){$(id).value=""});$("tDivAcc").setAttribute("data-v","");$("tDate").value=todayKey();setTxType("buy");', where="div acc reset")
d_ui2 = rep(d_ui2, '  setTxType(t.type);$("tDate").value=t.date;',
  '  $("tDivAcc").setAttribute("data-v",t.acc||"");setTxType(t.type);$("tDate").value=t.date;', where="div acc edit")
d_ui2 = rep(d_ui2, '$("txType").addEventListener("change",function(){setTxType(txType())});',
  '$("txType").addEventListener("change",function(){setTxType(txType())});\n$("tDivAcc").addEventListener("change",function(){$("tDivAcc").setAttribute("data-v",$("tDivAcc").value)});', where="div acc change")
d_ui2 = rep(d_ui2, 'amount:ty==="div"?am:0,u:now()});',
  'amount:ty==="div"?am:0,u:now()});var da=ty==="div"?$("tDivAcc").value:"";if(da)t.acc=da;else delete t.acc;', where="div acc save")
d_ui2 = rep(d_ui2, 'tabindex="0"><td>\'+dmy(t.date)+\'</td><td><span class="tag \'+(t.type==="buy"?"ok":t.type==="sell"?"edit":"fee")+\'">\'+TXT[t.type]+\'</span></td>', 'tabindex="0"><td>\'+dmy(t.date)+\'</td><td><span class="tag \'+(t.type==="buy"?"ok":t.type==="sell"?"edit":"fee")+\'">\'+TXT[t.type]+\'</span>\'+(t.type==="div"&&SH.divAccLabel(p,t)?\'<small class="txacc">\'+esc(SH.divAccLabel(p,t))+"</small>":"")+\'</td>', where="div acc list")
d_ui2 = rep(d_ui2, 'var cv=$("eCat").value.trim().slice(0,30);if(cv)p.cat=cv;else delete p.cat;',
  'var cv=$("eCat").value.trim().slice(0,30);if(cv)p.cat=cv;else delete p.cat;var dv=$("eDivAcc").value;if(dv)p.divAcc=dv;else delete p.divAcc;', where="pedit divacc save")
d_ui3 = rep(d_ui3, 'if(document.activeElement!==$("eCat"))$("eCat").value=p.cat||"";',
  'if(document.activeElement!==$("eCat"))$("eCat").value=p.cat||"";if(document.activeElement!==$("eDivAcc"))SH.divAccOptions($("eDivAcc"),p,"pos",p.divAcc||"");if(txType()==="div"&&document.activeElement!==$("tDivAcc"))SH.divAccOptions($("tDivAcc"),p,"tx",$("tDivAcc").getAttribute("data-v")||"");', where="pedit divacc fill")

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
KA_CARD = ('<details class="card wide sect" data-sec="kauszug" id="kauszug"><summary><span>Kontoauszug einlesen</span><span class="smeta" id="kaMeta"></span></summary>'
  '<p class="note">Füg die Umsätze aus dem Online-Banking oder einem PDF-Auszug ein, oder lade die CSV-Datei deiner Bank. Du siehst vorher, was übernommen wird. ' + hlp("So geht’s:\n\n• Online-Banking: Umsatzliste markieren (Strg+A), kopieren (Strg+C) und hier einfügen (Strg+V).\n• PDF-Kontoauszug: PDF öffnen, Text markieren und kopieren, hier einfügen.\n• CSV-Export der Bank (Sparkasse, Volksbank, DKB, ING, comdirect …): Datei wählen.\n\nErkannt werden Datum, Text und Betrag. Was schon gebucht ist, wird nicht doppelt übernommen. Passende Daueraufträge werden bestätigt.") + '</p>'
  '<div class="txform"><div class="field"><label for="kaAcc">In Konto</label><select id="kaAcc"></select></div>'
  '<div class="field span2"><label for="kaFile">oder CSV-/Textdatei</label><input type="file" id="kaFile" accept=".csv,.txt,.tsv,text/csv,text/plain"></div></div>'
  '<textarea id="kaText" class="katarea" rows="7" spellcheck="false" placeholder="z. B.\n05.10.2026  REWE Markt Kartenzahlung  -45,90 €\n01.10.2026  Gehalt September  +2.500,00 €"></textarea>'
  '<div class="row"><button class="btn primary" type="button" id="kaRead">Auslesen</button><button class="btn ghost" type="button" id="kaClear">Leeren</button></div>'
  '<p class="msg" id="kaMsg" aria-live="polite"></p>'
  '<div id="kaOut" hidden><p class="kasum" id="kaSum"></p><div class="kaq" id="kaQ" hidden tabindex="-1" aria-live="polite"></div><div class="kabal" id="kaBal"></div>'
  '<div class="tablewrap"><table class="katab"><thead><tr><th>Übernehmen?</th><th>Datum</th><th>Text</th><th>Kategorie</th><th class="r">Betrag</th></tr></thead><tbody id="kaBody"></tbody></table></div>'
  '<div class="row"><button class="btn primary" type="button" id="kaImport">übernehmen</button></div></div></details>')
f_body = rep(f_body, '<p class="note">Trag den Stand aus dem Online-Banking ein. Die Differenz zeigt, ob hier etwas fehlt.</p>\n        <div class="txform">', '<p class="note">Trag den Kontostand aus dem Online-Banking für das gewählte Konto ein. Die Differenz zeigt, ob hier etwas fehlt.</p>\n        <div class="txform"><div class="field"><label for="rcAcc">Konto</label><select id="rcAcc"></select></div>', where="rc acc field")
f_body = rep(f_body, '<details class="card sect" data-sec="recon"', KA_CARD + '\n      <details class="card sect" data-sec="recon"', where="ka card")
f_body = rep(f_body, '<div class="field"><label for="aRate">Sollzins (% p. a.)</label><input type="text" id="aRate" class="amtin" inputmode="decimal" placeholder="z. B. 3,85"></div>',
  '<div class="field span2"><label for="aRate">Zinssatz (% p. a.) ' + hlp(H_RATE) + '</label><span class="ratein"><input type="text" id="aRate" class="amtin" inputmode="decimal" placeholder="z. B. 5,24"><select id="aRateType" aria-label="Art des Zinssatzes"><option value="eff">effektiver Jahreszins</option><option value="nom">Sollzins (gebunden)</option></select></span><small class="rateconv" id="aRateConv" aria-live="polite"></small></div>', where="loan rate")
f_body = rep(f_body, '<label for="aPay">Monatsrate (€)</label>', '<label for="aPay">Monatsrate (€) ' + hlp(H_PAY) + '</label>', where="loan pay")
f_body = rep(f_body, '<label for="aPayDay">Fällig am</label>', '<label for="aPayDay">Fällig am ' + hlp(H_DAY) + '</label>', where="loan day")
f_body = rep(f_body, '<label for="aPayFrom">Rate kommt von</label>', '<label for="aPayFrom">Rate kommt von ' + hlp(H_FROM) + '</label>', where="loan from")
f_body = rep(f_body, '<label for="aOrig">Ursprünglicher Betrag (optional)</label>', '<label for="aOrig">Ausgezahlter Betrag (optional) ' + hlp(H_ORIG) + '</label>', where="loan orig")
f_body = rex(f_body, r'<p class="hintline span2">Restschuld als Startwert eintragen \(positiv\)\.[^<]*</p>',
  '<div class="loancheck" id="aLoanCheck" aria-live="polite"></div>', where="loan hint")
f_body = rep(f_body, '<div class="loancheck" id="aLoanCheck" aria-live="polite"></div>', '<label class="check loanhide"><input type="checkbox" id="aLoanHide" checked> Nach der Tilgung ausblenden ' + hlp(H_HIDE) + '</label><div class="loancheck" id="aLoanCheck" aria-live="polite"></div>', where="loan hide")



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
DEV_HTML = ('<div class="dev"><div class="devhead"><span class="lbl">Entwicklung ' + hlp("Wie sich der Wert deines Depots im gewählten Zeitraum entwickelt hat, aus den Schlusskursen und deinem Bestand an jedem Tag.\n\n• Veränderung: Unterschied des Depotwerts zwischen Anfang und Ende.\n• Kursentwicklung: nur die Wertänderung durch Kurse – Käufe und Verkäufe sind herausgerechnet.\n• Käufe − Verkäufe: was du im Zeitraum netto investiert hast (zum Einstand).\n\nFahr mit der Maus über das Diagramm (am Handy: tippen) für den Wert an einem Tag. Dividenden sind nicht enthalten.") + '</span><small class="devmeta" id="dChartMeta"></small>'
  '<div class="seg" id="dRange" role="radiogroup" aria-label="Zeitraum">'
  + "".join('<label><input type="radio" name="drg" value="%s"%s><span>%s</span></label>' % (v, " checked" if v == "1y" else "", t) for v, t in [("1w","1 W"),("1mo","1 M"),("6mo","6 M"),("ytd","lfd. Jahr"),("1y","1 J"),("5y","5 J"),("max","Max")])
  + '</div></div><div class="forecast devkpis" id="devKpis"></div>'
  '<div class="devwrap"><div class="chartbox" id="dChart"><p class="empty">Verlauf wird geladen …</p></div><div class="devtip" id="devTip" hidden></div></div>'
  '<div class="legend"><span><i class="sw"></i>Depotwert</span><span><i class="sw goal"></i>Einstand</span><span id="benchLeg"><i class="sw bench"></i><span id="benchLbl">MSCI World</span></span></div></div>')
d_html = cut(d_html, '<details class="card wide sect" data-sec="dchart"', '</details>', "dchart weg", keep_end=False)
d_html = rep(d_html, '<details class="card sect" data-sec="val" open><summary><span>Depotwert</span><span class="smeta" id="sumVal"></span></summary>', '<details class="card wide sect" data-sec="val" open><summary><span>Depotwert</span><span class="smeta" id="sumVal"></span></summary>', where="val wide")
d_html = rep(d_html, '<div class="fc"><span class="lbl">Gesamt</span><b class="eur" id="dTotal">–</b><small id="dTotalSub"></small></div>\n        </div>', '<div class="fc"><span class="lbl">Gesamt</span><b class="eur" id="dTotal">–</b><small id="dTotalSub"></small></div>\n        </div>' + DEV_HTML, where="val dev")
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
d_html = rep(d_html, '<div class="field"><label for="eCat">Kategorie</label>',
  '<div class="field"><label for="eDivAcc">Dividenden auf Konto (optional)</label><select id="eDivAcc"></select></div><div class="field"><label for="eCat">Kategorie</label>', where="pedit divacc")
d_html = rep(d_html, '<div class="field td" hidden><label for="tAmt">Betrag (€)</label><input type="text" id="tAmt" class="amtin" inputmode="decimal" placeholder="brutto"></div>',
  '<div class="field td" hidden><label for="tAmt">Betrag (€)</label><input type="text" id="tAmt" class="amtin" inputmode="decimal" placeholder="brutto"></div>'
  '<div class="field tdacc" hidden><label for="tDivAcc">Gutschrift auf Konto (optional)</label><select id="tDivAcc"></select></div>', where="div acc field")
d_html = rep(d_html, '<label><input type="radio" name="alm" value="kind"><span>Art</span></label>', '<label><input type="radio" name="alm" value="kind"><span>Art</span></label>\n          <label><input type="radio" name="alm" value="cat"><span>Kategorie</span></label>', where="alloc cat")
d_html = rep(d_html, '<span class="smeta" id="sumRows"></span></summary>\n        <div class="tablewrap"><table class="postab">', '<span class="smeta" id="sumRows"></span></summary>\n        <div class="postools"><label for="posGroup">Gruppieren</label><select id="posGroup"><option value="">nicht gruppieren</option><option value="cat">nach Kategorie</option><option value="mark">nach Markierung</option></select><span class="hint">Kategorie: im Namen auf „+ Kategorie“ tippen</span></div><div class="tablewrap"><table class="postab">', where="pos tools")
dep_views = views(d_html, ["depot", "position", "zeitung", "watchlist", "alarme", "neu", "dauswertung"], "dep")
dep_nav = nav(d_html, "dep")
dep_setdep = section(d_html, "setdep", "dep")

top = rd(SRC, "shell_top.html").replace("%%NAV_FIN%%", fin_nav).replace("%%NAV_DEP%%", dep_nav)
settings = rd(SRC, "shell_settings.html").replace("%%FIN_SETTINGS%%", fin_sets).replace("%%DEP_SETDEP%%", dep_setdep)
body = top + "\n" + rd(SRC, "dashboard.html") + "\n" + fin_views + "\n" + dep_views + "\n" + settings

css = rd(DEP, "css_a.css")
css = rep(css, "family=JetBrains+Mono:wght@400;600&", "family=JetBrains+Mono:wght@400;600&family=UnifrakturMaguntia&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&", where="css fonts")
css = rep(css, "<title>Mein Zeitkonto</title>", "<title>Meine Finanzen</title>", where="css title")
css += rd(DEP, "css_b.css") + rd(DEP, "css_c.css") + rd(DEP, "css_d.css") + rd(SRC, "extra.css") + "</style>\n\n"

js = rd(SRC, "shell.js") + "\n" + fin_js + "\n" + dep_js + "\n" + rd(SRC, "dashboard.js") + "\nSH.boot();\n"
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
