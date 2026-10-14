/* ===================== Version 2.0: Depots, Watchlist, Alarme, Sparpläne, Import, Auswertung ===================== */
function V(){return viewOf(D,ui.depot)}
function wantedSyms(){
  var s={};
  D.pos.forEach(function(p){if(walk(p).shares>0||(D.plans||[]).some(function(pl){return pl.pos===p.id&&!pl.paused}))s[p.sym]=1});
  (D.watch||[]).forEach(function(w){s[w.sym]=1});(D.alerts||[]).forEach(function(a){s[a.sym]=1});
  return Object.keys(s);
}
function depName(id){var d=(D.settings.depots||[]).filter(function(x){return x.id===id})[0];return d?d.name:""}
function depOpts(sel,withAll){var h=withAll?'<option value="">Alle Depots</option>':"";(D.settings.depots||[]).forEach(function(d){h+='<option value="'+esc(d.id)+'">'+esc(d.name)+"</option>"});var k=sel.value;sel.innerHTML=h;if(k&&sel.querySelector('option[value="'+k+'"]'))sel.value=k}
function symName(sym){var p=D.pos.filter(function(x){return x.sym===sym})[0]||(D.watch||[]).filter(function(x){return x.sym===sym})[0];return p?p.name:(D.quotes[sym]&&D.quotes[sym].name)||sym}
function eurPrice(sym){var q=D.quotes[sym];if(!q)return null;var fx=fxRate(D,q.currency);return fx!=null?q.price*fx:null}

/* ---------- nach jedem Kursabruf: Sparpläne buchen, Alarme prüfen ---------- */
function afterQuotes(){checkAlerts();runPlans()}
var plansRunning=false;
function runPlans(){
  if(plansRunning||!D||!(D.plans||[]).length)return;
  var tk=todayKey(),need={};
  D.plans.forEach(function(pl){
    if(pl.paused)return;var p=D.pos.filter(function(x){return x.id===pl.pos})[0];if(!p)return;
    planDue(pl,tk).forEach(function(o){if(!p.tx.some(function(t){return t.plan===pl.id&&t.occ===o.occ})){if(!need[p.sym]||o.d<need[p.sym])need[p.sym]=o.d}});
  });
  var syms=Object.keys(need);if(!syms.length)return;
  plansRunning=true;var hist={};
  Promise.all(syms.map(function(s){var days=(parseKey(tk)-parseKey(need[s]))/864e5,r=days<=28?"1mo":days<=180?"6mo":days<=360?"1y":"5y";return getHistory(s,r).then(function(h){hist[s]=h}).catch(function(){hist[s]=[]})})).then(function(){
    plansRunning=false;if(!D)return;
    var n=applyPlans(D,function(sym,d){var h=hist[sym]||[];if(!h.length||h[0][0]>d)return null;var c=closeOn(h,d),q=D.quotes[sym],fx=q?fxRate(D,q.currency):1;return c!=null&&fx!=null?c*fx:null});
    if(n){save();renderAll();toast(n===1?"1 Sparplan-Rate gebucht.":n+" Sparplan-Raten gebucht.")}
  });
}
function toast(t){var a=$("alerts"),d=document.createElement("div");d.className="banner";d.innerHTML="<span><b>"+esc(t)+"</b></span>";a.appendChild(d);setTimeout(function(){d.remove()},6000)}

/* ---------- Kursalarme in der offenen Seite ---------- */
function checkAlerts(){
  var tk=todayKey(),fired=[];
  (D.alerts||[]).forEach(function(a){
    var q=D.quotes[a.sym],hit=alertHit(a,q),daily=a.type==="dayDown"||a.type==="dayUp";
    if(hit&&(daily?a.hitDay!==tk:!a.hitAt)){a.hitAt=Date.now();a.hitDay=tk;fired.push(a)}
    else if(!hit&&!daily&&a.hitAt&&a.rearm!==false){a.hitAt=0}
  });
  if(!fired.length)return;
  persist();
  fired.forEach(function(a){
    var txt=a.name+" "+ALTYPE[a.type]+" "+alertValTxt(a);
    toast("Kursalarm: "+txt);
    try{if(window.Notification&&Notification.permission==="granted")new Notification("Kursalarm: "+a.name,{body:txt+" · Kurs "+fmtPx(D.quotes[a.sym].price,D.quotes[a.sym].currency)})}catch(e){}
  });
}
function alertValTxt(a){return a.type==="dayDown"||a.type==="dayUp"?NFP.format(Math.abs(+a.value))+" %":NF4.format(+a.value)+" "+(CURSYM[(D.quotes[a.sym]||{}).currency]||"€")}

/* ---------- Gesamtrendern der neuen Teile ---------- */
function renderExtras(s){
  $("nmWatch").textContent=(D.watch||[]).length||"";$("nmAlarm").textContent=(D.alerts||[]).length||"";
  renderDepSel();renderTermine();renderWatch();renderAlertList();renderPlans();renderPerf(s);renderDivs();renderDepots();renderMail();
  ["nDepot","csvDepot","eDepot"].forEach(function(id){depOpts($(id),false)});
  if(!$("nDepot").value)$("nDepot").value=ui.depot||defaultDepot(D);
  fillAlertSel();fillPlanSel();fillEvSel();
  $("sBench").value=D.settings.benchmark||"OV:FUND:IE00B4L5Y983";
}
function renderDepSel(){
  var deps=D.settings.depots||[],el=$("depSel");el.hidden=deps.length<2;
  if(ui.depot&&!deps.some(function(d){return d.id===ui.depot}))ui.depot="";
  el.innerHTML=['<button type="button" data-dep="" aria-pressed="'+(!ui.depot)+'">Alle</button>'].concat(deps.map(function(d){return '<button type="button" data-dep="'+esc(d.id)+'" aria-pressed="'+(ui.depot===d.id)+'">'+esc(d.name)+"</button>"})).join("");
}
$("depSel").addEventListener("click",function(e){var b=e.target.closest("[data-dep]");if(!b)return;ui.depot=b.getAttribute("data-dep");HIST=HIST;renderAll();loadDepotChart();loadDepotNews()});

/* ---------- Aufteilung ---------- */
function renderAlloc(s){
  var act=s.rows.filter(function(r){return r.shares>0}),tot=act.reduce(function(a,r){return a+r.value},0),groups=[];
  if(ui.alloc==="pos")groups=act.map(function(r){return {k:r.p.name,v:r.value,c:posColor(s.rows.indexOf(r))}});
  else{
    var m={};act.forEach(function(r){var k=ui.alloc==="sector"?posSector(r.p):ui.alloc==="country"?posCountry(r.p):ui.alloc==="cur"?(r.cur==="GBp"?"GBP":r.cur||"EUR"):PKIND[posKind(r.p)].label;m[k]=(m[k]||0)+r.value});
    groups=Object.keys(m).map(function(k,i){return {k:k,v:m[k]}}).sort(function(a,b){return b.v-a.v});groups.forEach(function(g,i){g.c=posColor(i)});
  }
  $("allocBar").innerHTML=groups.map(function(g){return '<i style="flex-grow:'+Math.max(0.0001,g.v)+';--c:'+g.c+'" title="'+esc(g.k)+'"></i>'}).join("");
  $("allocList").innerHTML=groups.slice(0,10).map(function(g){return '<li><span class="what"><i class="cdot" style="--c:'+g.c+'"></i> '+esc(g.k)+'</span><span class="mono">'+(tot?pct(g.v/tot):"–")+"</span></li>"}).join("")+(groups.length>10?'<li><span class="what" style="color:var(--muted)">und '+(groups.length-10)+" weitere</span></li>":"")+(ui.alloc==="sector"&&groups.some(function(g){return g.k==="nicht zugeordnet"})?'<li><span class="what" style="color:var(--muted)">Branche ordnest du unter Positionen › Position bearbeiten zu.</span></li>':"");
  $("sumAlloc").textContent=groups.length?groups.length+(ui.alloc==="pos"?" Werte":" Gruppen"):"";
}
$("allocMode").addEventListener("change",function(e){ui.alloc=e.target.value;renderAlloc(depotStats(V()))});

/* ---------- Position: Bearbeiten-Felder und Kennzahlen ---------- */
function fillPosEdit(p){
  $("eKind").innerHTML=Object.keys(PKIND).map(function(k){return '<option value="'+k+'">'+PKIND[k].label+"</option>"}).join("");$("eKind").value=posKind(p);
  $("eSector").innerHTML='<option value="">nicht zugeordnet</option>'+SECTORS.map(function(x){return '<option>'+esc(x)+"</option>"}).join("")+'<option>Breit gestreut (Fonds)</option>';$("eSector").value=p.sector||(posKind(p)!=="aktie"?"Breit gestreut (Fonds)":"");
  $("eCountry").value=p.country||"";$("eCountry").placeholder=posCountry({isin:p.isin,name:p.name,sym:p.sym,kind:p.kind});
  $("countryList").innerHTML=Object.keys(COUNTRY).map(function(k){return '<option value="'+esc(COUNTRY[k])+'">'}).join("");
  depOpts($("eDepot"),false);$("eDepot").value=p.depot||defaultDepot(D);
}
var figReq=0;
function renderFig(p,r){
  var req=++figReq,el=$("pFig");
  getHistory(p.sym,"1y").then(function(h){
    if(req!==figReq)return;if(!h||h.length<5){el.innerHTML='<p class="empty">Noch kein Kursverlauf für Kennzahlen.</p>';return}
    var cl=h.map(function(x){return x[1]}),hi=Math.max.apply(null,cl),lo=Math.min.apply(null,cl),last=r.price!=null?r.price:cl[cl.length-1],cur=r.cur||"EUR";
    var box=function(l,v,sub){return '<div class="fc"><span class="lbl">'+l+"</span><b>"+v+"</b><small>"+(sub||"")+"</small></div>"};
    var html=box("52-Wochen-Hoch",esc(fmtPx(hi,cur)),'<span class="'+gvCls(last/hi-1)+'">'+esc(pct(last/hi-1,true))+"</span> Abstand")+box("52-Wochen-Tief",esc(fmtPx(lo,cur)),'<span class="'+gvCls(last/lo-1)+'">'+esc(pct(last/lo-1,true))+"</span> darüber")+box("1 Jahr",'<span class="'+gvCls(last/cl[0]-1)+'">'+esc(pct(last/cl[0]-1,true))+"</span>","seit "+dmy(h[0][0]));
    el.innerHTML=html+'<div class="fc" id="athBox"><span class="lbl">Allzeithoch</span><b>…</b><small></small></div>';
    $("pFigMeta").textContent="";
    getHistory(p.sym,"max").then(function(hm){if(req!==figReq||!hm||!hm.length)return;var ath=hm.reduce(function(a,x){return x[1]>a[1]?x:a},hm[0]);var b=$("athBox");if(b)b.innerHTML='<span class="lbl">Höchster Schlusskurs</span><b>'+esc(fmtPx(Math.max(ath[1],hi),cur))+"</b><small>"+(ath[1]>=hi?"am "+dmy(ath[0])+" · ":"")+'<span class="'+gvCls(last/Math.max(ath[1],hi)-1)+'">'+esc(pct(last/Math.max(ath[1],hi)-1,true))+"</span></small>"}).catch(function(){var b=$("athBox");if(b)b.remove()});
  }).catch(function(){if(req===figReq)el.innerHTML='<p class="empty">Kennzahlen nicht verfügbar.</p>'});
}

/* ---------- Termine ---------- */
function fillEvSel(){var s=$("evPos"),k=s.value;s.innerHTML='<option value="">allgemein</option>'+D.pos.filter(function(p){return walk(p).shares>0}).map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+"</option>"}).join("")+(D.watch||[]).map(function(w){return '<option value="w:'+esc(w.id)+'">'+esc(w.name)+" (Watchlist)</option>"}).join("");s.value=k}
function renderTermine(){
  var tk=todayKey(),to=addDays(tk,60),list=[],Vv=V();
  (D.events||[]).forEach(function(e){if(e.date>=addDays(tk,-3)&&e.date<=to){var nm=e.pos?(e.pos.indexOf("w:")===0?((D.watch||[]).filter(function(w){return "w:"+w.id===e.pos})[0]||{}).name:(D.pos.filter(function(p){return p.id===e.pos})[0]||{}).name):"";list.push({d:e.date,t:e.title,n:nm||"",k:"own",id:e.id})}});
  divForecast(Vv).forEach(function(f){if(f.date<=to)list.push({d:f.date,t:"Dividende erwartet, ca. "+money(f.amount),n:f.p.name,k:"div"})});
  (D.plans||[]).forEach(function(pl){if(pl.paused)return;var p=D.pos.filter(function(x){return x.id===pl.pos})[0];if(!p||Vv.pos.indexOf(p)<0)return;planDue(pl,to).forEach(function(o){if(o.d>tk)list.push({d:o.d,t:"Sparplan-Rate "+money(pl.amount),n:p.name,k:"plan"})})});
  list.sort(function(a,b){return a.d<b.d?-1:a.d>b.d?1:0});
  $("evList").innerHTML=list.slice(0,20).map(function(x){return '<li><span class="when">'+WDs[parseKey(x.d).getDay()]+" "+dm(x.d)+'</span><span class="what">'+esc(x.t)+(x.n?"<small>"+esc(x.n)+"</small>":"")+'</span><span class="acts"><span class="state'+(x.k==="own"?" on":"")+'">'+(x.k==="own"?"eigener Termin":x.k==="div"?"Prognose":"Sparplan")+"</span>"+(x.k==="own"?'<button class="fdrm" type="button" data-evdel="'+esc(x.id)+'" aria-label="Termin löschen">Löschen</button>':"")+"</span></li>"}).join("")||'<li><span class="what" style="color:var(--muted)">In den nächsten 60 Tagen steht nichts an.</span></li>';
}
$("evForm").addEventListener("submit",function(e){
  e.preventDefault();var d=$("evDate").value,t=$("evTitle").value.trim();
  if(!isKey(d)||!t){setMsg("evMsg","Bitte Datum und Bezeichnung eintragen.",true);return}
  D.events=D.events||[];D.events.push({id:newId(),date:d,title:t.slice(0,60),pos:$("evPos").value,u:now()});
  $("evTitle").value="";save();renderTermine();setMsg("evMsg","Termin am "+dmy(d)+" eingetragen.");
});
$("evList").addEventListener("click",function(e){var b=e.target.closest("[data-evdel]");if(!b)return;D.events=D.events.filter(function(x){return x.id!==b.getAttribute("data-evdel")});save();renderTermine()});

/* ---------- Watchlist ---------- */
function addWatch(r){
  D.watch=D.watch||[];
  if(D.watch.some(function(w){return w.sym===r.symbol})){return false}
  D.watch.push({id:newId(),sym:r.symbol,name:r.name,isin:r.isin||"",note:"",u:now()});save();fetchQuotes([r.symbol]).then(function(j){Object.keys(j.quotes||{}).forEach(function(s){D.quotes[s]=j.quotes[s]});persist();renderAll()}).catch(function(){});return true;
}
function renderWatch(){
  var w=D.watch||[];
  $("wlBody").innerHTML=w.map(function(x){
    var q=D.quotes[x.sym],ch=q&&q.prev?q.price/q.prev-1:null,own=D.pos.some(function(p){return p.sym===x.sym&&walk(p).shares>0});
    return '<tr data-wid="'+esc(x.id)+'"><td><b class="pn">'+esc(x.name)+'</b><span class="dnote">'+esc(symLabel(x))+(own?" · im Depot":"")+'</span></td><td class="r mono">'+(q?esc(fmtPx(q.price,q.currency)):"–")+'</td><td class="r mono '+gvCls(ch||0)+'">'+(ch!=null?esc(pct(ch,true)):"–")+'</td><td><input type="text" class="wnote" value="'+esc(x.note||"")+'" maxlength="80" placeholder="Notiz, z. B. Kaufen unter 180" aria-label="Notiz"></td><td class="r"><span class="acts" style="justify-content:flex-end"><button class="btn" type="button" data-wa="alarm">Alarm</button><button class="btn" type="button" data-wa="buy">Kaufen</button><button class="btn ghost" type="button" data-wa="del">Entfernen</button></span></td></tr>';
  }).join("")||'<tr><td colspan="5" class="empty">Noch nichts auf der Watchlist. Unten suchen und „Beobachten“ wählen.</td></tr>';
  $("wlMeta").textContent=w.length?w.length+" Werte":"";
}
$("wlBody").addEventListener("change",function(e){var i=e.target.closest(".wnote");if(!i)return;var id=e.target.closest("tr").getAttribute("data-wid"),w=D.watch.filter(function(x){return x.id===id})[0];if(w){w.note=i.value.trim().slice(0,80);w.u=now();persist()}});
$("wlBody").addEventListener("click",function(e){
  var b=e.target.closest("[data-wa]");if(!b)return;var id=b.closest("tr").getAttribute("data-wid"),w=D.watch.filter(function(x){return x.id===id})[0];if(!w)return;
  var a=b.getAttribute("data-wa");
  if(a==="del"){D.watch=D.watch.filter(function(x){return x!==w});save();renderAll();return}
  if(a==="alarm"){showView("alarme");$("alSym").value=w.sym;$("alType").value="below";alTypeUI();var q=D.quotes[w.sym];if(q)$("alVal").value=NF4.format(q.price*0.95).replace(/\./g,"");$("alVal").focus();return}
  if(a==="buy"){showView("neu");$("nName").value=w.name;$("nSym").value=w.sym;$("nIsin").value=w.isin||"";$("nQty").focus()}
});
var wResults=[];
function doSearch(q){return D.demo?Promise.resolve({results:demoSearch(q)}):getJSON("search?q="+encodeURIComponent(q))}
$("wForm").addEventListener("submit",function(e){
  e.preventDefault();var q=$("wQ").value.trim();if(q.length<2){setMsg("wMsg","Mindestens 2 Zeichen eingeben.",true);return}
  setMsg("wMsg","Suche läuft …");
  doSearch(q).then(function(j){wResults=j.results||[];$("wRes").innerHTML=wResults.map(function(r,i){return '<li><span class="what"><b>'+esc(r.name)+"</b><small>"+esc(r.exchange||r.symbol)+'</small></span><button class="btn" type="button" data-wr="'+i+'">Beobachten</button></li>'}).join("");setMsg("wMsg",wResults.length?wResults.length+" Treffer.":"Nichts gefunden.",!wResults.length)})
  .catch(function(err){setMsg("wMsg",EMBED?"In der Vorschau gibt es keinen Kurs-Server.":"Suche nicht möglich: "+(err&&err.message||err),true)});
});
$("wRes").addEventListener("click",function(e){var b=e.target.closest("[data-wr]");if(!b)return;var r=wResults[+b.getAttribute("data-wr")];if(!r)return;setMsg("wMsg",addWatch(r)?"„"+r.name+"“ steht jetzt auf der Watchlist.":"Steht schon auf der Watchlist.");renderWatch()});
$("sRes").addEventListener("click",function(e){var b=e.target.closest("[data-sw]");if(!b)return;var r=sResults[+b.getAttribute("data-sw")];if(!r)return;setMsg("sMsg",addWatch(r)?"„"+r.name+"“ steht jetzt auf der Watchlist.":"Steht schon auf der Watchlist.")});

/* ---------- Alarme ---------- */
function fillAlertSel(){
  var s=$("alSym"),k=s.value,seen={},h="";
  D.pos.forEach(function(p){if(seen[p.sym])return;seen[p.sym]=1;h+='<option value="'+esc(p.sym)+'">'+esc(p.name)+(walk(p).shares>0?"":" (verkauft)")+"</option>"});
  (D.watch||[]).forEach(function(w){if(seen[w.sym])return;seen[w.sym]=1;h+='<option value="'+esc(w.sym)+'">'+esc(w.name)+" (Watchlist)</option>"});
  s.innerHTML=h||'<option value="">Erst eine Position oder einen Watchlist-Wert anlegen</option>';if(k&&seen[k])s.value=k;alTypeUI();
}
function alTypeUI(){
  var t=$("alType").value,pc=t==="dayDown"||t==="dayUp",q=D.quotes[$("alSym").value];
  $("alValLbl").textContent=pc?"Prozent":"Kurs ("+(q?(CURSYM[q.currency]||q.currency):"€")+")";
  $("alHint").textContent=q?"Aktueller Kurs: "+fmtPx(q.price,q.currency)+(q.prev?", heute "+pct(q.price/q.prev-1,true):"")+".":"";
}
$("alType").addEventListener("change",alTypeUI);$("alSym").addEventListener("change",alTypeUI);
function renderAlertList(){
  var a=D.alerts||[];
  $("alList").innerHTML=a.map(function(x){
    var q=D.quotes[x.sym],hit=alertHit(x,q),dist="";
    if(q&&(x.type==="above"||x.type==="below"))dist=" · noch "+pct(+x.value/q.price-1,true);
    return '<li><span class="what"><b>'+esc(x.name)+"</b> "+esc(ALTYPE[x.type])+" "+esc(alertValTxt(x))+"<small>"+(q?"Kurs "+esc(fmtPx(q.price,q.currency))+dist:"noch kein Kurs")+(x.hitAt?" · ausgelöst "+esc(relTime(x.hitAt/1000)):"")+'</small></span><span class="acts"><span class="state'+(hit?" hit":" on")+'">'+(hit?"erreicht":"wartet")+'</span><button class="fdrm" type="button" data-aldel="'+esc(x.id)+'">Löschen</button></span></li>';
  }).join("")||'<li><span class="what" style="color:var(--muted)">Noch keine Alarme.</span></li>';
  $("alMeta").textContent=a.length?a.length+" Alarme":"";
  var st=D.settings.alertKey?(D.settings.alertSync?"E-Mail-Alarme aktiv für "+(D.settings.alertEmail||"?")+", zuletzt übertragen "+relTime(D.settings.alertSync/1000)+".":"E-Mail-Alarme eingerichtet, aber noch nicht übertragen."):"E-Mail-Alarme sind aus. Ohne sie meldet sich die Seite nur, solange sie offen ist.";
  $("alMailState").innerHTML=esc(st)+' <button class="linkbtn" type="button" data-go="einstellungen#setmail">E-Mail-Alarme einrichten</button>';
}
$("alForm").addEventListener("submit",function(e){
  e.preventDefault();var sym=$("alSym").value,t=$("alType").value,v=parseDec($("alVal").value);
  if(!sym){setMsg("alMsg","Bitte zuerst ein Wertpapier anlegen.",true);return}
  if(v==null||v<=0){setMsg("alMsg","Bitte einen Wert größer 0 eingeben.",true);$("alVal").focus();return}
  D.alerts=D.alerts||[];D.alerts.push({id:newId(),sym:sym,name:symName(sym),type:t,value:v,hitAt:0,u:now()});
  $("alVal").value="";save();checkAlerts();renderAll();setMsg("alMsg","Alarm angelegt.");syncAlerts(true);
});
$("alList").addEventListener("click",function(e){var b=e.target.closest("[data-aldel]");if(!b)return;D.alerts=D.alerts.filter(function(x){return x.id!==b.getAttribute("data-aldel")});save();renderAll();syncAlerts(true)});
$("alNotify").addEventListener("click",function(){
  if(!window.Notification){setMsg("alMsg","Dieser Browser kann keine Benachrichtigungen.",true);return}
  try{Notification.requestPermission().then(function(r){setMsg("alMsg",r==="granted"?"Benachrichtigungen sind an, solange die Seite offen ist.":"Benachrichtigungen wurden nicht erlaubt.",r!=="granted")})}catch(err){setMsg("alMsg","Benachrichtigungen werden hier nicht unterstützt.",true)}
});

/* ---------- E-Mail-Alarme: Abgleich mit dem Webspace ---------- */
function postJSON(path,body){
  var base=apiBase();
  return fetch(apiUrl(base,path),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"}).then(function(r){return r.json().catch(function(){throw new Error("Antwort ist kein JSON (HTTP "+r.status+")")}).then(function(j){if(!r.ok)throw new Error(j&&j.error||"HTTP "+r.status);return j})});
}
function syncAlerts(quiet){
  if(!D.settings.alertKey||D.demo)return Promise.resolve(null);
  var body={key:D.settings.alertKey,email:D.settings.alertEmail||"",alerts:(D.alerts||[]).map(function(a){return {id:a.id,sym:a.sym,name:a.name,type:a.type,value:a.value}})};
  return postJSON("alerts",body).then(function(j){D.settings.alertSync=Date.now();persist();if(!quiet)setMsg("mMsg","Übertragen: "+j.count+" Alarme an "+j.email+".");renderAlertList();renderMail();return j})
  .catch(function(e){setMsg(quiet?"alMsg":"mMsg","E-Mail-Alarme konnten nicht übertragen werden: "+(e&&e.message||e),true)});
}
function renderMail(){
  if(document.activeElement!==$("mKey"))$("mKey").value=D.settings.alertKey||"";
  if(document.activeElement!==$("mMail"))$("mMail").value=D.settings.alertEmail||"";
  $("mailMeta").textContent=D.settings.alertKey?(D.settings.alertSync?"aktiv":"nicht übertragen"):"aus";
}
$("mSave").addEventListener("click",function(){
  var k=$("mKey").value,m=$("mMail").value.trim();
  if(k&&k.length<8){setMsg("mMsg","Das Passwort aus config.php hat mindestens 8 Zeichen.",true);return}
  if(k&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)){setMsg("mMsg","Bitte eine gültige E-Mail-Adresse eintragen.",true);return}
  D.settings.alertKey=k;D.settings.alertEmail=m;D.settings.alertSync=0;persist();
  if(!k){setMsg("mMsg","E-Mail-Alarme sind aus.");renderAll();return}
  setMsg("mMsg","Übertrage …");syncAlerts(false);
});
$("mTest").addEventListener("click",function(){
  if(!D.settings.alertKey){setMsg("mMsg","Erst Passwort und E-Mail speichern.",true);return}
  setMsg("mMsg","Sende Test-Mail …");
  getJSON("testmail?key="+encodeURIComponent(D.settings.alertKey)).then(function(j){setMsg("mMsg","Test-Mail an "+j.email+" verschickt. Schau auch im Spam-Ordner nach.")}).catch(function(e){setMsg("mMsg","Test-Mail fehlgeschlagen: "+(e&&e.message||e),true)});
});
$("mStatus").addEventListener("click",function(){
  if(!D.settings.alertKey){setMsg("mMsg","Erst Passwort und E-Mail speichern.",true);return}
  getJSON("alerts?key="+encodeURIComponent(D.settings.alertKey)).then(function(j){
    var t=j.count+" Alarme auf dem Server für "+(j.email||"?")+". ";
    t+=j.lastRun?"Cronjob zuletzt "+relTime(j.lastRun)+".":"Der Cronjob ist noch nie gelaufen. Richte ihn beim Hoster ein (siehe Anleitung).";
    if(j.lastMail)t+=" Letzte Alarm-Mail "+relTime(j.lastMail)+".";
    if(j.lastError)t+=" Fehler: "+j.lastError;
    setMsg("mMsg",t,!!j.lastError||!j.lastRun);
  }).catch(function(e){setMsg("mMsg","Status nicht abrufbar: "+(e&&e.message||e),true)});
});

/* ---------- Sparpläne ---------- */
function fillPlanSel(){
  var s=$("plPos"),k=s.value;s.innerHTML=D.pos.map(function(p){return '<option value="'+esc(p.id)+'">'+esc(p.name)+"</option>"}).join("")||'<option value="">Erst einen Kauf erfassen</option>';if(k)s.value=k;
  if(!$("plDay").options.length){var h="";for(var i=1;i<=28;i++)h+='<option value="'+i+'">'+i+".</option>";$("plDay").innerHTML=h}
  if(!$("plStart").value)$("plStart").value=mk(+todayKey().slice(0,4),+todayKey().slice(5,7),1);
}
function renderPlans(){
  var pl=D.plans||[],sum=0;
  $("planList").innerHTML=pl.map(function(x){
    var p=D.pos.filter(function(q){return q.id===x.pos})[0];if(!x.paused)sum+=(+x.amount||0)/(x.interval==="q"?3:1);
    var n=p?p.tx.filter(function(t){return t.plan===x.id}).length:0,nx=planDue(x,addDays(todayKey(),100)).filter(function(o){return o.d>todayKey()})[0];
    return '<li><span class="what"><b>'+esc(p?p.name:"Position gelöscht")+"</b> "+esc(money(x.amount))+" "+(x.interval==="q"?"vierteljährlich":"monatlich")+" am "+x.day+".<small>seit "+dmy(x.start)+(x.end?" bis "+dmy(x.end):"")+" · "+n+" Ausführungen gebucht"+(nx&&!x.paused?" · nächste "+dmy(nx.d):"")+'</small></span><span class="acts"><span class="state'+(x.paused?"":" on")+'">'+(x.paused?"pausiert":"aktiv")+'</span><button class="btn" type="button" data-plp="'+esc(x.id)+'">'+(x.paused?"Fortsetzen":"Pausieren")+'</button><button class="btn ghost" type="button" data-ple="'+esc(x.id)+'">Bearbeiten</button></span></li>';
  }).join("")||'<li><span class="what" style="color:var(--muted)">Noch keine Sparpläne.</span></li>';
  $("plMeta").textContent=pl.length?money(sum)+" pro Monat":"";
}
function resetPlanForm(){ui.editPlan=null;$("planFormTitle").textContent="Neuer Sparplan";$("planSave").textContent="Sparplan anlegen";$("planDel").hidden=true;$("planCancel").hidden=true;$("plAmt").value="";$("plFee").value="";$("plEnd").value="";$("plInt").value="m"}
$("planList").addEventListener("click",function(e){
  var b=e.target.closest("[data-plp],[data-ple]");if(!b)return;
  var id=b.getAttribute("data-plp")||b.getAttribute("data-ple"),x=D.plans.filter(function(q){return q.id===id})[0];if(!x)return;
  if(b.hasAttribute("data-plp")){x.paused=!x.paused;x.u=now();save();renderAll();if(!x.paused)runPlans();return}
  ui.editPlan=id;$("planFormTitle").textContent="Sparplan bearbeiten";$("planSave").textContent="Speichern";$("planDel").hidden=false;$("planCancel").hidden=false;
  $("plPos").value=x.pos;$("plAmt").value=fmtIn(x.amount);$("plFee").value=fmtIn(x.fee);$("plInt").value=x.interval||"m";$("plDay").value=String(x.day);$("plStart").value=x.start;$("plEnd").value=x.end||"";$("plAmt").focus();
});
$("planForm").addEventListener("submit",function(e){
  e.preventDefault();
  var pos=$("plPos").value,amt=parseDec($("plAmt").value),fee=$("plFee").value.trim()?parseDec($("plFee").value):0,st=$("plStart").value,en=$("plEnd").value;
  if(!pos){setMsg("planMsg","Erst einen Kauf erfassen, dann den Sparplan anlegen.",true);return}
  if(amt==null||amt<=0){setMsg("planMsg","Bitte die Rate in Euro eingeben.",true);$("plAmt").focus();return}
  if(fee==null||fee<0||fee>=amt){setMsg("planMsg","Die Gebühr muss kleiner als die Rate sein.",true);return}
  if(!isKey(st)){setMsg("planMsg","Bitte das Startdatum wählen.",true);return}
  if(en&&en<st){setMsg("planMsg","Das Ende liegt vor dem Start.",true);return}
  D.plans=D.plans||[];var x=ui.editPlan?D.plans.filter(function(q){return q.id===ui.editPlan})[0]:null,isNew=!x;
  if(!x){x={id:newId(),paused:false};D.plans.push(x)}
  Object.assign(x,{pos:pos,amount:amt,fee:fee||0,interval:$("plInt").value,day:+$("plDay").value,start:st,end:en||"",u:now()});
  save();resetPlanForm();renderAll();setMsg("planMsg",isNew?"Sparplan angelegt. Fällige Raten werden jetzt gebucht.":"Gespeichert.");runPlans();
});
$("planDel").addEventListener("click",function(){var b=this;armed(b,"Sparplan löschen? Gebuchte Käufe bleiben.",function(){D.plans=D.plans.filter(function(q){return q.id!==ui.editPlan});save();resetPlanForm();renderAll();setMsg("planMsg","Sparplan gelöscht.")})});
$("planCancel").addEventListener("click",function(){resetPlanForm();setMsg("planMsg","")});

/* ---------- Rendite und Vergleich ---------- */
var perfReq=0;
function renderPerf(s){
  var Vv=V(),ps=perfStats(Vv,s.value),req=++perfReq;
  var box=function(l,v,sub,c){return '<div class="fc"><span class="lbl">'+l+'</span><b class="eur '+(c||"")+'">'+v+"</b><small>"+(sub||"")+"</small></div>"};
  $("perfKpis").innerHTML=box("Rendite pro Jahr",ps.xirr!=null?esc(pct(ps.xirr,true)):"–","interner Zinsfuß (XIRR)",gvCls(ps.xirr||0))+box("Gewinn gesamt",esc(money(ps.gain,true)),"Wert + Rückflüsse − Einzahlungen",gvCls(ps.gain))+box("Eingezahlt",esc(money(ps.invested)),ps.first?"seit "+dmy(ps.first):"");
  $("perfMeta").innerHTML=ps.xirr!=null?"<b>"+esc(pct(ps.xirr,true))+"</b> p. a.":"";
  var bs=D.settings.benchmark,bn=BENCH[bs]||"Vergleichs-ETF";
  if(!Vv.pos.length){$("perfNote").textContent="";return}
  $("perfNote").textContent="Vergleich mit "+bn+" wird berechnet …";
  getHistory(bs,"max").then(function(h){
    if(req!==perfReq)return;var b=benchSim(Vv,h);if(!b){$("perfNote").textContent="Kein Vergleich möglich: Kursverlauf des "+bn+" fehlt.";return}
    var diff=s.value+ps.returned-(b.value);
    $("perfNote").innerHTML="Mit denselben Käufen und Verkäufen im <b>"+esc(bn)+"</b> hättest du heute <b>"+esc(money(b.value))+"</b>"+(b.xirr!=null?" (<b>"+esc(pct(b.xirr,true))+"</b> pro Jahr)":"")+". Dein Depot liegt mit Dividenden und Verkaufserlösen "+(diff>=0?'<b class="pos">'+esc(money(diff))+" darüber</b>":'<b class="neg">'+esc(money(-diff))+" darunter</b>")+".";
  }).catch(function(){if(req===perfReq)$("perfNote").textContent="Vergleich mit "+bn+" nicht möglich, der Kurs-Server liefert keinen Verlauf."});
}
$("sBench").addEventListener("change",function(){D.settings.benchmark=this.value;persist();renderAll();loadDepotChart();setMsg("apiMsg","Vergleich mit "+BENCH[this.value]+".")});

/* ---------- Dividenden ---------- */
function renderDivs(){
  var Vv=V(),fc=divForecast(Vv),tk=todayKey(),y=+tk.slice(0,4),m0=+tk.slice(5,7)-1,bars=[];
  for(var i=0;i<12;i++){var mm=(m0+i)%12,yy=y+Math.floor((m0+i)/12);bars.push({m:mm,y:yy,v:0})}
  fc.forEach(function(f){var fy=+f.date.slice(0,4),fm=+f.date.slice(5,7)-1,idx=(fy-y)*12+fm-m0;if(idx>=0&&idx<12)bars[idx].v+=f.amount});
  var mx=Math.max.apply(null,bars.map(function(b){return b.v}).concat([1])),tot=bars.reduce(function(a,b){return a+b.v},0);
  $("divBars").innerHTML=bars.map(function(b){return '<div class="db" title="'+MON[b.m]+" "+b.y+": "+esc(money(b.v))+'"><b>'+(b.v?Math.round(b.v):"")+'</b><i class="'+(b.v?"":"zero")+'" style="height:'+Math.max(2,Math.round(b.v/mx*110))+'px"></i><span>'+MONs[b.m]+"</span></div>"}).join("");
  var s=depotStats(Vv);
  $("divMeta").innerHTML=tot?"ca. <b>"+esc(money(tot))+"</b> in 12 Monaten"+(s.cost>0?" · "+esc(pct(tot/s.cost))+" auf Einstand":""):"";
  var rec=divByMonth(Vv,y).reduce(function(a,b){return a+b},0);
  $("divList").innerHTML=fc.slice(0,6).map(function(f){return '<li><span class="when">'+dm(f.date)+'</span><span class="what">'+esc(f.p.name)+"<small>wie am "+dmy(f.basis)+'</small></span><span class="eur">'+esc(money(f.amount))+"</span></li>"}).join("")+'<li><span class="what" style="color:var(--muted)">Erhalten '+y+": "+esc(money(rec))+"</span></li>";
}

/* ---------- Depots verwalten ---------- */
function renderDepots(){
  var d=D.settings.depots||[];
  $("depList").innerHTML=d.map(function(x,i){var n=D.pos.filter(function(p){return (p.depot||defaultDepot(D))===x.id}).length;return '<li><span class="what"><input type="text" value="'+esc(x.name)+'" maxlength="30" data-depn="'+esc(x.id)+'" aria-label="Name des Depots"><small>'+n+" Positionen"+(i===0?" · Standard":"")+"</small></span>"+(i>0?'<button class="fdrm" type="button" data-depdel="'+esc(x.id)+'">Löschen</button>':"")+"</li>"}).join("");
  $("depMeta").textContent=d.length+(d.length===1?" Depot":" Depots");
}
$("depAdd").addEventListener("click",function(){var n=$("depName").value.trim();if(!n){setMsg("depMsg","Bitte einen Namen eingeben.",true);return}D.settings.depots.push({id:newId(),name:n.slice(0,30)});$("depName").value="";persist();renderAll();setMsg("depMsg","Depot „"+n+"“ angelegt. Positionen ordnest du unter Position bearbeiten zu.")});
$("depList").addEventListener("change",function(e){var i=e.target.closest("[data-depn]");if(!i)return;var d=D.settings.depots.filter(function(x){return x.id===i.getAttribute("data-depn")})[0];var v=i.value.trim();if(d&&v){d.name=v.slice(0,30);persist();renderAll();setMsg("depMsg","Gespeichert.")}else i.value=d?d.name:""});
$("depList").addEventListener("click",function(e){var b=e.target.closest("[data-depdel]");if(!b)return;armed(b,"Löschen?",function(){var id=b.getAttribute("data-depdel"),def=defaultDepot(D);D.pos.forEach(function(p){if(p.depot===id)p.depot=def});D.settings.depots=D.settings.depots.filter(function(x){return x.id!==id});if(ui.depot===id)ui.depot="";save();renderAll();setMsg("depMsg","Depot gelöscht, Positionen ins Standard-Depot verschoben.")})});

/* ---------- CSV-Import ---------- */
var csvP=null,csvMapState=null;
var CSVLBL={date:"Datum",isin:"ISIN",name:"Name",type:"Art",qty:"Stück",price:"Kurs",fee:"Gebühr",amount:"Betrag"};
$("csvFile").addEventListener("change",function(){var f=this.files&&this.files[0];if(f)f.text().then(function(t){$("csvTxt").value=t;readCsv()})});
$("csvRead").addEventListener("click",readCsv);
function readCsv(){
  var t=$("csvTxt").value;if(!t.trim()){setMsg("csvMsg","Bitte eine Datei wählen oder den Inhalt einfügen.",true);return}
  csvP=csvParse(t);if(csvP.rows.length<1){setMsg("csvMsg","Keine Zeilen gefunden.",true);return}
  csvMapState=csvGuess(csvP.rows[0]);var hasHead=Object.keys(csvMapState).length>=2;$("csvHead").checked=hasHead;
  var head=csvP.rows[0];
  $("csvMap").innerHTML=Object.keys(CSVLBL).map(function(f){return '<div class="field"><label for="cm_'+f+'">'+CSVLBL[f]+'</label><select id="cm_'+f+'" data-cm="'+f+'"><option value="-1">– nicht vorhanden –</option>'+head.map(function(h,i){return '<option value="'+i+'">'+(hasHead?esc(h):"Spalte "+(i+1)+" ("+esc(String(h).slice(0,14))+")")+"</option>"}).join("")+"</select></div>"}).join("");
  Object.keys(CSVLBL).forEach(function(f){$("cm_"+f).value=String(csvMapState[f]!=null?csvMapState[f]:-1)});
  $("csvMapWrap").hidden=false;csvPreview();setMsg("csvMsg","Trennzeichen „"+(csvP.sep==="\t"?"Tab":csvP.sep)+"“, "+csvP.rows.length+" Zeilen. Prüfe die Zuordnung.");
}
$("csvMap").addEventListener("change",function(e){var s=e.target.closest("[data-cm]");if(!s)return;csvMapState[s.getAttribute("data-cm")]=+s.value;csvPreview()});
$("csvHead").addEventListener("change",csvPreview);
function csvPreview(){
  if(!csvP)return;var rows=csvRows(csvP,csvMapState,$("csvHead").checked),ok=rows.filter(function(r){return !r.err.length}).length;
  $("csvPrev").innerHTML=rows.slice(0,12).map(function(r){return "<tr><td>"+r.line+"</td><td>"+(r.date?dmy(r.date):"–")+"</td><td>"+esc(r.isin||"–")+"</td><td>"+(r.type?TXT[r.type]:"–")+'</td><td class="r mono">'+(r.qty!=null?fmtQty(r.qty):"–")+'</td><td class="r mono">'+(r.price!=null?money(r.price):"–")+'</td><td class="r mono">'+money(r.fee||0)+'</td><td class="r mono">'+(r.amount!=null?money(r.amount):"–")+"</td><td>"+(r.err.length?'<span class="state hit">fehlt: '+esc(r.err.join(", "))+"</span>":'<span class="state on">ok</span>')+"</td></tr>"}).join("");
  $("csvGo").textContent=ok+" Buchungen importieren";$("csvGo").disabled=!ok;
}
$("csvGo").addEventListener("click",function(){
  if(!csvP)return;var rows=csvRows(csvP,csvMapState,$("csvHead").checked).filter(function(r){return !r.err.length});if(!rows.length)return;
  if(D.demo)clearDemo();
  var dep=$("csvDepot").value||defaultDepot(D),isins={};rows.forEach(function(r){if(!D.pos.some(function(p){return p.isin===r.isin}))isins[r.isin]=r.name});
  var list=Object.keys(isins),res={};$("csvGo").disabled=true;setMsg("csvMsg","Suche "+list.length+" Wertpapiere …");
  var chain=Promise.resolve();
  list.forEach(function(isin){chain=chain.then(function(){return doSearch(isin).then(function(j){var hit=(j.results||[]).filter(function(x){return x.isin===isin})[0]||(j.results||[])[0];if(hit)res[isin]=hit}).catch(function(){})})});
  chain.then(function(){
    var added=0,dup=0,newPos=0;
    rows.forEach(function(r){
      var p=D.pos.filter(function(x){return x.isin===r.isin})[0];
      if(!p){var h=res[r.isin];p={id:newId(),name:(h&&h.name)||r.name||r.isin,sym:(h&&h.symbol)||"OV:STOCK:"+r.isin,isin:r.isin,depot:dep,tx:[],u:now()};D.pos.push(p);newPos++}
      var same=p.tx.some(function(t){return t.date===r.date&&t.type===r.type&&Math.abs((+t.qty||0)-(r.qty||0))<1e-6&&Math.abs((+t.price||0)-(r.price||0))<1e-6&&Math.abs((+t.amount||0)-(r.type==="div"?r.amount:0))<1e-6});
      if(same){dup++;return}
      p.tx.push({id:newId(),type:r.type,date:r.date,qty:r.type==="div"?0:r.qty,price:r.type==="div"?0:r.price,fee:r.type==="div"?0:(r.fee||0),amount:r.type==="div"?r.amount:0,u:now()});p.u=now();added++;
    });
    save();HIST={};$("csvGo").disabled=false;renderAll();refreshQuotes();
    setMsg("csvMsg",added+" Buchungen importiert"+(newPos?", "+newPos+(newPos===1?" neue Position":" neue Positionen"):"")+(dup?", "+dup+" schon vorhandene übersprungen":"")+".");
  });
});
