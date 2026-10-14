/* ---------- Kurse holen ---------- */
var lastFetch=0,fetching=false,qErr=null,HIST={};
function apiBase(){var b=(D.settings.api||"api/").trim();if(b&&b[b.length-1]!=="/"&&!/\.php$/i.test(b))b+="/";return b}
function apiUrl(base,path){if(/\.php$/i.test(base.replace(/\/$/,"")))return base.replace(/\/$/,"")+"?ep="+path.replace("?","&");return base+path}
function getJSON(path){
  var base=apiBase();
  return getJSONFrom(base,path).catch(function(e){
    /* Webspace ohne mod_rewrite: einmal direkt index.php probieren und merken */
    if(/\.php$/i.test(base.replace(/\/$/,""))||!e||!e.retry)throw e;
    var alt=base+"index.php";
    return getJSONFrom(alt,path).then(function(j){D.settings.api=alt;persist();return j},function(){throw e});
  });
}
function getJSONFrom(base,path){
  var ctl=window.AbortController?new AbortController():null,t=setTimeout(function(){if(ctl)ctl.abort()},20000);
  return fetch(apiUrl(base,path),{cache:"no-store",signal:ctl?ctl.signal:undefined}).then(function(r){clearTimeout(t);return r.json().catch(function(){var er=new Error("Antwort ist kein JSON (HTTP "+r.status+")");er.retry=true;throw er}).then(function(j){if(!r.ok)throw new Error(j&&j.error||"HTTP "+r.status);return j})});
}
function fetchQuotes(syms){
  if(!syms.length)return Promise.resolve({quotes:{},errors:{}});
  if(D.demo){var o={};syms.forEach(function(s){o[s]=demoQuote(s)});return Promise.resolve({quotes:o,errors:{}})}
  return getJSON("quotes?s="+encodeURIComponent(syms.join(",")));
}
function refreshQuotes(){
  if(!D||fetching)return;
  var syms=wantedSyms();
  if(!syms.length){renderAll();return}
  fetching=true;lastFetch=Date.now();$("qRefresh").disabled=true;$("qStat").textContent="Kurse werden geholt …";
  var errs={};
  fetchQuotes(syms.concat(fxSyms(D))).then(function(j){
    Object.keys(j.quotes||{}).forEach(function(s){D.quotes[s]=j.quotes[s]});Object.assign(errs,j.errors||{});
    var more=fxSyms(D).filter(function(s){return !j.quotes[s]});
    return more.length?fetchQuotes(more).then(function(k){Object.keys(k.quotes||{}).forEach(function(s){D.quotes[s]=k.quotes[s]});Object.assign(errs,k.errors||{})}):null;
  }).then(function(){
    qErr=Object.keys(errs).length?{partial:errs}:null;D.qtime=Date.now();persist();
  }).catch(function(e){qErr={msg:String(e&&e.message||e)}}).then(function(){fetching=false;$("qRefresh").disabled=false;afterQuotes();renderAll();if(curView==="depot"){loadDepotChart();loadDepotNews()}});
}
function getHistory(sym,r){
  var k=sym+"|"+r;if(HIST[k])return Promise.resolve(HIST[k]);
  if(D.demo){HIST[k]=demoSeries(sym,{"1mo":31,"6mo":183,"1y":366,"5y":1830}[r]||366);return Promise.resolve(HIST[k])}
  return getJSON("history?s="+encodeURIComponent(sym)+"&r="+r).then(function(j){HIST[k]=j.points||[];return HIST[k]});
}
$("qRefresh").addEventListener("click",refreshQuotes);
document.addEventListener("visibilitychange",function(){if(!document.hidden&&D){var rf=(+D.settings.refresh||0)*60000;if(rf&&Date.now()-lastFetch>rf)refreshQuotes();else renderAll()}});

/* ---------- Rendering ---------- */
function symLabel(p){var m=/^OV:[A-Z_]+:([A-Z0-9]{12})$/.exec(p.sym||"");return m?(p.isin||m[1]):p.sym}
function gvCls(v){return v>0.004?"pos":v<-0.004?"neg":""}
function posColor(i){return COLORS[i%COLORS.length]}
function renderAll(){
  if(!D)return;
  var t=new Date();
  $("dateLine").textContent=["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"][t.getDay()]+", "+t.getDate()+". "+MON[t.getMonth()]+" "+t.getFullYear();
  $("profName").textContent=P.name;$("demoBar").hidden=!D.demo;
  var s=depotStats(V());
  $("nmVal").textContent=D.pos.length?money0(s.value):"";$("nmPos").textContent=D.pos.length||"";
  renderStatus(s);renderDepot(s);renderPosition();renderYear();renderSettings();renderExtras(s);
}
function renderStatus(s){
  var st=$("qStat"),al=[];
  if(D.demo)st.textContent="Spielkurse (Beispieldepot)";
  else if(D.qtime){var d=new Date(D.qtime);st.textContent="Kurse von "+pad(d.getHours())+":"+pad(d.getMinutes())+(keyOf(d)!==todayKey()?" am "+dmy(keyOf(d)):"")+", meist verzögert"}
  else st.textContent=D.pos.length?"Noch keine Kurse geholt":"";
  if(qErr&&qErr.msg)al.push("<b>Kurs-Server nicht erreichbar.</b> "+esc(qErr.msg)+(D.qtime?" Angezeigt werden die letzten bekannten Kurse.":"")+' <button class="linkbtn" type="button" data-go="einstellungen#setapi">Verbindung prüfen</button>');
  if(qErr&&qErr.partial)al.push("<b>Für "+Object.keys(qErr.partial).map(esc).join(", ")+" kam kein Kurs.</b> Prüfe das Kürzel unter Positionen › Position bearbeiten.");
  if(s&&s.missing&&!(qErr&&qErr.msg)&&D.qtime)al.push("<b>"+s.missing+" Position(en) ohne Kurs.</b> Bewertet wird dort mit dem Einstand.");
  var lb=D.settings.lastBackup;if(D.pos.length&&!D.demo&&(!lb||(parseKey(todayKey())-parseKey(lb))/864e5>30))al.push("<b>Sicherung:</b> "+(lb?"zuletzt am "+dmy(lb)+".":"noch keine erstellt.")+' <button class="linkbtn" type="button" data-go="einstellungen#setbackup">Jetzt sichern</button>');
  $("alerts").innerHTML=al.map(function(x){return '<div class="banner"><span>'+x+"</span></div>"}).join("");
}
function renderDepot(s){
  var has=D.pos.length>0;$("welcome").hidden=has;
  $("dVal").textContent=money(s.value);
  $("dDay").textContent=money(s.day,true);$("dDay").className="eur "+gvCls(s.day);$("dDayPct").textContent=pct(s.dayPct,true);
  $("dUnreal").textContent=money(s.unreal,true);$("dUnreal").className="eur "+gvCls(s.unreal);$("dUnrealPct").textContent=pct(s.unrealPct,true)+" auf den Einstand";
  $("dCost").textContent=money(s.cost);
  $("dTotal").textContent=money(s.total,true);$("dTotal").className="eur "+gvCls(s.total);$("dTotalSub").textContent="inkl. Dividenden "+money(s.divs)+" und Verkäufen "+money(s.realized,true);
  $("sumVal").innerHTML=has?"<b>"+esc(money(s.value))+'</b> · <span class="'+gvCls(s.day)+'">'+esc(pct(s.dayPct,true))+"</span>":"";
  var act=s.rows.filter(function(r){return r.shares>0});
  $("posBody").innerHTML=s.rows.map(function(r,i){
    var p=r.p,closed=r.shares<=0;
    return '<tr data-pid="'+esc(p.id)+'" tabindex="0"'+(closed?' class="off"':"")+'><td><b class="pn">'+esc(p.name)+'</b><span class="dnote">'+esc(symLabel(p))+(closed?" · verkauft":"")+'</span></td><td class="r mono">'+(closed?"–":fmtQty(r.shares))+'</td><td class="r mono">'+(r.price!=null?fmtPx(r.price,r.cur):"–")+'</td><td class="r mono '+gvCls(r.dayPct||0)+'">'+(closed?"":pct(r.dayPct,true))+'</td><td class="r mono">'+(closed?"–":money(r.value))+'</td><td class="r mono '+gvCls(closed?r.total:r.unreal)+'">'+(closed?money(r.total,true):money(r.unreal,true)+'<span class="dnote">'+pct(r.unrealPct,true)+"</span>")+'</td><td class="r mono">'+(closed||!s.value?"–":pct(r.value/s.value))+"</td></tr>";
  }).join("")||'<tr><td colspan="7" class="empty">Noch keine Positionen.</td></tr>';
  $("sumRows").textContent=act.length?act.length+" im Bestand":"";
  renderAlloc(s);
}
$("posBody").addEventListener("click",function(e){var tr=e.target.closest("tr[data-pid]");if(tr){ui.pos=tr.getAttribute("data-pid");resetTx();renderPosition();showView("position")}});
$("posBody").addEventListener("keydown",function(e){if(e.key!=="Enter")return;var tr=e.target.closest("tr[data-pid]");if(tr){ui.pos=tr.getAttribute("data-pid");resetTx();renderPosition();showView("position")}});

/* Depotverlauf */
var dChartReq=0;
function loadDepotChart(){
  if(!D)return;var syms=V().pos.map(function(p){return p.sym}).filter(function(s,i,a){return a.indexOf(s)===i}),r=ui.dRange,req=++dChartReq;
  if(!syms.length){$("dChart").innerHTML='<p class="empty">Noch keine Positionen.</p>';$("dChartMeta").textContent="";return}
  var from=addDays(todayKey(),-{"1mo":31,"6mo":183,"1y":366,"5y":1830}[r]),hist={};
  Promise.all(syms.map(function(s){return getHistory(s,r).then(function(h){hist[s]=h}).catch(function(){hist[s]=[]})})).then(function(){
    if(req!==dChartReq||!D)return;
    var ser=depotSeries(V(),hist,from);
    if(ser.length<2){$("dChart").innerHTML='<p class="empty">'+(qErr&&qErr.msg?"Ohne Kurs-Server gibt es keinen Verlauf.":"Für diesen Zeitraum gibt es noch keinen Verlauf.")+"</p>";$("dChartMeta").textContent="";return}
    var a=ser[0].d,b=ser[ser.length-1].d,span=Math.max(1,(parseKey(b)-parseKey(a))/864e5);
    var x=function(d){return (parseKey(d)-parseKey(a))/864e5/span};
    var pts=ser.map(function(q){return {x:x(q.d),v:Math.round(q.v*100)}});
    var xl=ticksFor(a,b,x);
    var draw=function(bench){$("dChart").innerHTML=lineChart(pts,{xl:xl,label:"Depotverlauf",zero:false,cost:ser.map(function(q){return {x:x(q.d),v:Math.round(q.c*100)}}),bench:bench})};
    draw(null);
    var bs=D.settings.benchmark;$("benchLbl").textContent=BENCH[bs]||"Vergleich";
    if(bs)getHistory(bs,"max").then(function(hb){if(req!==dChartReq||!hb||hb.length<2)return;var sim=benchSim(V(),hb);if(!sim)return;draw(ser.map(function(q){return {x:x(q.d),v:Math.round(sim.unitsAt(q.d)*closeOn(hb,q.d)*100)}}))}).catch(function(){});
    var d0=ser[0],d1=ser[ser.length-1];$("dChartMeta").innerHTML="seit "+dmy(d0.d)+': <b class="'+gvCls((d1.v-d1.c)-(d0.v-d0.c))+'">'+esc(money((d1.v-d1.c)-(d0.v-d0.c),true))+"</b>";
  });
}
function ticksFor(a,b,x){
  var out=[],da=parseKey(a),db=parseKey(b),months=(db.getFullYear()-da.getFullYear())*12+db.getMonth()-da.getMonth(),step=months<=2?0:months<=8?1:months<=14?2:12;
  if(!step){for(var d=a;d<=b;d=addDays(d,7))out.push({x:x(d),t:dm(d)});return out}
  for(var i=1;i<=months;i+=step){var k=mk(da.getFullYear(),da.getMonth()+i,1),p=parseKey(k);if(k>b)break;out.push({x:x(k),t:step===12?String(p.getFullYear()):MONs[p.getMonth()]+(p.getMonth()===0?" "+String(p.getFullYear()).slice(2):"")})}
  if(step===12&&out.length<2){out=[];for(var j=1;j<=months;j+=3){var k2=mk(da.getFullYear(),da.getMonth()+j,1);if(k2>b)break;out.push({x:x(k2),t:MONs[parseKey(k2).getMonth()]})}}
  return out;
}
$("dRange").addEventListener("change",function(e){ui.dRange=e.target.value;$("dChart").innerHTML='<p class="empty">Verlauf wird geladen …</p>';loadDepotChart()});

/* ---------- News ---------- */
var NEWS={};
function newsQuery(p){return String(p.name||"").replace(/\b(SE|AG|NV|N\.V\.|Inc\.?|Corp\.?|Corporation|plc|Holding|Group|KGaA|& Co\.?|S\.A\.|Namens-Aktien|Vz\.?)(?=\s|$)/gi," ").replace(/[^0-9A-Za-zÄÖÜäöüß&\- ]/g," ").replace(/\s+/g," ").trim()}
function isFund(p){return /^OV:FUND:/.test(p.sym)||/\b(ETF|UCITS|Fonds|Index)\b/i.test(p.name||"")}
function getNews(p){
  var q=newsQuery(p);if(q.length<2)return Promise.resolve([]);
  var c=NEWS[q];if(c&&Date.now()-c.t<15*60000)return Promise.resolve(c.items);
  return getJSON("news?q="+encodeURIComponent(q)).then(function(j){NEWS[q]={t:Date.now(),items:j.items||[]};return NEWS[q].items});
}
function relTime(ts){var s=Math.max(0,Date.now()/1000-ts);if(s<3600)return "vor "+Math.max(1,Math.round(s/60))+" Min.";if(s<86400)return "vor "+Math.round(s/3600)+" Std.";if(s<86400*2)return "gestern";if(s<86400*7)return "vor "+Math.round(s/86400)+" Tagen";return dmy(keyOf(new Date(ts*1000)))}
function newsLi(it,tag){var u=/^https?:\/\//i.test(it.link)?it.link:"#";return '<li><span class="what"><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(it.title)+'</a><small>'+(tag?'<span class="ntag">'+esc(tag)+"</span>":"")+esc(it.source||"")+(it.source?" · ":"")+relTime(it.date)+"</small></span></li>"}
function newsEmpty(msg){return '<li><span class="what" style="color:var(--muted)">'+msg+"</span></li>"}
var dNewsReq=0,pNewsReq=0;
function loadDepotNews(){
  if(!D)return;var req=++dNewsReq,s=depotStats(V()),ps=s.rows.filter(function(r){return r.shares>0&&!isFund(r.p)}).slice(0,8).map(function(r){return r.p});
  if(D.demo){$("dNews").innerHTML=newsEmpty("Im Beispieldepot gibt es keine News. Mit deinem Kurs-Server erscheinen hier Schlagzeilen zu deinen Aktien.");$("dNewsMeta").textContent="";return}
  if(!ps.length){$("dNews").innerHTML=newsEmpty(D.pos.length?"Nur ETFs im Depot, dazu gibt es keine Firmen-News.":"Noch keine Aktien im Depot.");$("dNewsMeta").textContent="";return}
  $("dNews").innerHTML=newsEmpty("News werden geladen …");
  var all=[],fail=0;
  Promise.all(ps.map(function(p){return getNews(p).then(function(items){items.forEach(function(it){all.push({it:it,tag:p.name})})}).catch(function(){fail++})})).then(function(){
    if(req!==dNewsReq||!D)return;
    var seen={};all=all.filter(function(x){var k=x.it.title.toLowerCase();if(seen[k])return false;seen[k]=1;return true}).sort(function(a,b){return b.it.date-a.it.date}).slice(0,15);
    $("dNews").innerHTML=all.length?all.map(function(x){return newsLi(x.it,x.tag)}).join(""):newsEmpty(fail===ps.length?"News konnten nicht geladen werden. Läuft der Kurs-Server in Version 1.2 oder neuer?":"In den letzten 14 Tagen keine Schlagzeilen gefunden.");
    $("dNewsMeta").textContent=all.length?all.length+" Schlagzeilen":"";
  });
}
function loadPosNews(p){
  var req=++pNewsReq;
  if(D.demo){$("pNews").innerHTML=newsEmpty("Im Beispieldepot gibt es keine News.");$("pNewsMeta").textContent="";return}
  if(isFund(p)){$("pNews").innerHTML=newsEmpty("Zu ETFs und Fonds gibt es keine Firmen-News.");$("pNewsMeta").textContent="";return}
  getNews(p).then(function(items){if(req!==pNewsReq)return;$("pNews").innerHTML=items.length?items.map(function(it){return newsLi(it)}).join(""):newsEmpty("In den letzten 14 Tagen keine Schlagzeilen zu „"+esc(newsQuery(p))+"“.");$("pNewsMeta").textContent=items.length?items.length+" Schlagzeilen":""})
  .catch(function(e){if(req===pNewsReq){$("pNews").innerHTML=newsEmpty("News konnten nicht geladen werden: "+esc(e&&e.message||e));$("pNewsMeta").textContent=""}});
}

/* ---------- Position ---------- */
function curPos(){var p=ui.pos&&D.pos.filter(function(x){return x.id===ui.pos})[0];if(!p){var s=depotStats(V());p=s.rows.length?s.rows[0].p:null;ui.pos=p?p.id:null}return p}
function renderPosition(){
  var p=curPos(),s=depotStats(V());
  $("posNone").hidden=!!p;$("posGrid").hidden=!p;$("posPick").hidden=!p;if(!p)return;
  $("posPick").innerHTML=s.rows.map(function(r,i){return '<button type="button" data-pp="'+esc(r.p.id)+'" aria-pressed="'+(r.p.id===p.id)+'"><i class="cdot" style="--c:'+posColor(i)+'"></i>'+esc(r.p.name)+"</button>"}).join("");
  var r=posStats(D,p),q=r.quote;
  $("pTitle").textContent=p.name;$("pMeta").innerHTML=esc(symLabel(p))+(p.isin&&symLabel(p)!==p.isin?" · "+esc(p.isin):"");
  $("pPrice").textContent=r.price!=null?fmtPx(r.price,r.cur):"kein Kurs";$("pPrice").className="big eur";
  $("pPriceSub").innerHTML=q?'<span class="'+gvCls(r.dayPct||0)+'">'+esc(pct(r.dayPct,true))+"</span> heute"+(r.cur&&r.cur!=="EUR"&&r.priceEUR!=null?" · "+esc(money(r.priceEUR))+" je Stück":"")+(q.time?" · Stand "+new Date(q.time*1000).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}):""):"Noch kein Kurs. Prüfe das Kürzel oder den Kurs-Server.";
  $("pShares").textContent=fmtQty(r.shares)+" Stück";$("pAvg").textContent=r.shares>0?"Ø-Einstand "+money(r.avg):"keine Stücke im Bestand";
  $("pValue").textContent=money(r.value);$("pDay").textContent="heute "+money(r.day,true);
  $("pUnreal").textContent=money(r.unreal,true);$("pUnreal").className="eur "+gvCls(r.unreal);$("pUnrealPct").textContent=pct(r.unrealPct,true)+" · Einstand "+money(r.cost);
  $("pReal").textContent=money(r.divs+r.realized,true);$("pReal").className="eur "+gvCls(r.divs+r.realized);$("pRealSub").textContent="Dividenden "+money(r.divs)+" · Verkäufe "+money(r.realized,true);
  var tx=sortTx(p.tx).reverse();
  $("pTxBody").innerHTML=tx.map(function(t){
    var amt=t.type==="div"?(+t.amount):t.type==="buy"?-(t.qty*t.price+(+t.fee||0)):(t.qty*t.price-(+t.fee||0));
    return '<tr data-tx="'+esc(t.id)+'" tabindex="0"><td>'+dmy(t.date)+'</td><td><span class="tag '+(t.type==="buy"?"ok":t.type==="sell"?"edit":"fee")+'">'+TXT[t.type]+'</span></td><td class="r mono">'+(t.type==="div"?"–":fmtQty(t.qty))+'</td><td class="r mono">'+(t.type==="div"?"–":money(t.price))+'</td><td class="r mono">'+(t.type==="div"?"–":money(t.fee||0))+'</td><td class="r mono '+gvCls(amt)+'">'+money(amt,true)+"</td></tr>";
  }).join("")||'<tr><td colspan="6" class="empty">Noch keine Buchungen.</td></tr>';
  $("pTxMeta").textContent=p.tx.length+" Buchungen";
  if(document.activeElement!==$("eName")){$("eName").value=p.name;$("eSym").value=p.sym;$("eIsin").value=p.isin||"";fillPosEdit(p)}
  renderFig(p,r);
  loadPosChart(p,r);
  if(curView==="position")loadPosNews(p);
}
var pChartReq=0;
function loadPosChart(p,r){
  var req=++pChartReq,rg=ui.range;
  getHistory(p.sym,rg).then(function(h){
    if(req!==pChartReq)return;
    if(!h||h.length<2){$("pChart").innerHTML='<p class="empty">Kein Kursverlauf verfügbar.</p>';$("pChartMeta").textContent="";return}
    var a=h[0][0],b=h[h.length-1][0],span=Math.max(1,(parseKey(b)-parseKey(a))/864e5),x=function(d){return (parseKey(d)-parseKey(a))/864e5/span};
    var fx=r.fx||1,isEur=!r.cur||r.cur==="EUR";
    var pts=h.map(function(q){return {x:x(q[0]),v:Math.round(q[1]*100)}});
    var lines=[];if(r.shares>0&&isEur)lines.push({v:Math.round(r.avg*100),t:"Ø-Einstand "+money(r.avg)});
    else if(r.shares>0&&r.fx)lines.push({v:Math.round(r.avg/fx*100),t:"Ø-Einstand"});
    var marks=p.tx.filter(function(t){return t.type!=="div"&&t.date>=a}).map(function(t){return {x:x(t.date),v:Math.round((isEur?+t.price:(+t.price)/(fx||1))*100),buy:t.type==="buy"}});
    $("pChart").innerHTML=lineChart(pts,{xl:ticksFor(a,b,x),lines:lines,marks:marks,label:"Kursverlauf "+p.name,zero:false,unit:isEur?"":(CURSYM[r.cur]||r.cur)});
    var ch=h[h.length-1][1]/h[0][1]-1;$("pChartMeta").innerHTML='<b class="'+gvCls(ch)+'">'+esc(pct(ch,true))+"</b> im Zeitraum";
  }).catch(function(e){if(req===pChartReq){$("pChart").innerHTML='<p class="empty">Verlauf nicht verfügbar: '+esc(e&&e.message||e)+"</p>";$("pChartMeta").textContent=""}});
}
$("posPick").addEventListener("click",function(e){var b=e.target.closest("[data-pp]");if(!b)return;ui.pos=b.getAttribute("data-pp");resetTx();renderPosition()});
$("pRange").addEventListener("change",function(e){ui.range=e.target.value;renderPosition()});

/* Buchung erfassen / bearbeiten */
function txType(){var r=document.querySelector('input[name="txt"]:checked');return r?r.value:"buy"}
function setTxType(v){Array.prototype.forEach.call(document.querySelectorAll('input[name="txt"]'),function(r){r.checked=r.value===v});Array.prototype.forEach.call(document.querySelectorAll("#txForm .tq"),function(el){el.hidden=v==="div"});document.querySelector("#txForm .td").hidden=v!=="div";$("tHint").textContent=v==="div"?"Betrag laut Abrechnung. Für die Steuerschätzung am besten brutto, also vor Abzug der Steuer.":"Werte wie auf deiner Abrechnung, in Euro."}
$("txType").addEventListener("change",function(){setTxType(txType())});
function resetTx(){ui.editTx=null;$("txFormTitle").textContent="Buchung hinzufügen";$("txSave").textContent="Hinzufügen";$("txDel").hidden=true;$("txCancel").hidden=true;["tQty","tPrice","tFee","tAmt"].forEach(function(id){$(id).value=""});$("tDate").value=todayKey();setTxType("buy");setMsg("txMsg","")}
function fmtIn(v){return v?String(v).replace(".",","):""}
$("pTxBody").addEventListener("click",function(e){
  var tr=e.target.closest("tr[data-tx]"),p=curPos();if(!tr||!p)return;var t=p.tx.filter(function(x){return x.id===tr.getAttribute("data-tx")})[0];if(!t)return;
  ui.editTx=t.id;$("txFormTitle").textContent=TXT[t.type]+" vom "+dmy(t.date)+" bearbeiten";$("txSave").textContent="Speichern";$("txDel").hidden=false;$("txCancel").hidden=false;
  setTxType(t.type);$("tDate").value=t.date;$("tQty").value=fmtIn(t.qty);$("tPrice").value=fmtIn(t.price);$("tFee").value=fmtIn(t.fee);$("tAmt").value=fmtIn(t.amount);
  document.querySelector('details[data-sec="ptxform"]').open=true;$("tDate").focus();
});
$("txForm").addEventListener("submit",function(e){
  e.preventDefault();var p=curPos();if(!p)return;
  var ty=txType(),d=$("tDate").value,q=parseDec($("tQty").value),px=parseDec($("tPrice").value),fee=$("tFee").value.trim()?parseDec($("tFee").value):0,am=parseDec($("tAmt").value);
  if(!isKey(d)){setMsg("txMsg","Bitte ein Datum wählen.",true);return}
  if(d>todayKey()){setMsg("txMsg","Das Datum liegt in der Zukunft.",true);return}
  if(ty==="div"){if(am==null||am<=0){setMsg("txMsg","Bitte den Netto-Betrag eingeben, z. B. 32,40.",true);$("tAmt").focus();return}}
  else{
    if(q==null||q<=0){setMsg("txMsg","Bitte die Stückzahl eingeben.",true);$("tQty").focus();return}
    if(px==null||px<=0){setMsg("txMsg","Bitte den Kurs je Stück eingeben.",true);$("tPrice").focus();return}
    if(fee==null||fee<0){setMsg("txMsg","Gebühren bitte als Betrag, z. B. 4,90.",true);return}
    if(ty==="sell"){var test={tx:p.tx.filter(function(x){return x.id!==ui.editTx})},have=walk(test,d).shares;if(q>have+1e-9){setMsg("txMsg","Am "+dmy(d)+" waren nur "+fmtQty(have)+" Stück im Bestand.",true);return}}
  }
  var t=ui.editTx?p.tx.filter(function(x){return x.id===ui.editTx})[0]:null,isNew=!t;
  if(!t){t={id:newId()};p.tx.push(t)}
  Object.assign(t,{type:ty,date:d,qty:ty==="div"?0:q,price:ty==="div"?0:px,fee:ty==="div"?0:(fee||0),amount:ty==="div"?am:0,u:now()});p.u=now();
  save();var m=(isNew?"Hinzugefügt: ":"Gespeichert: ")+TXT[ty]+" am "+dmy(d)+".";resetTx();renderAll();setMsg("txMsg",m);
  if(isNew&&ty==="buy"&&!D.quotes[p.sym])refreshQuotes();
});
$("txDel").addEventListener("click",function(){var b=this;armed(b,"Wirklich löschen?",function(){var p=curPos();p.tx=p.tx.filter(function(x){return x.id!==ui.editTx});p.u=now();save();resetTx();renderAll();setMsg("txMsg","Buchung gelöscht.")})});
$("txCancel").addEventListener("click",resetTx);
$("eSave").addEventListener("click",function(){
  var p=curPos();if(!p)return;var n=$("eName").value.trim(),s=$("eSym").value.trim().toUpperCase();
  if(!n||!/^[A-Z0-9.\-=^:]{1,40}$/.test(s)){setMsg("eMsg","Name und ein gültiges Kürzel eintragen, z. B. SAP.DE.",true);return}
  var ch=s!==p.sym;p.name=n.slice(0,60);p.sym=s;p.isin=$("eIsin").value.trim().toUpperCase().slice(0,12);p.kind=$("eKind").value;p.sector=$("eSector").value;p.country=$("eCountry").value.trim().slice(0,30);p.depot=$("eDepot").value;p.u=now();save();if(ch){HIST={};refreshQuotes()}renderAll();setMsg("eMsg","Gespeichert.");
});
$("eDel").addEventListener("click",function(){var b=this,p=curPos();if(!p)return;armed(b,"„"+p.name+"“ mit allen Buchungen löschen?",function(){D.pos=D.pos.filter(function(x){return x!==p});ui.pos=null;save();renderAll();showView("depot");loadDepotChart()})});

/* ---------- Kauf erfassen ---------- */
var sResults=[];
$("sForm").addEventListener("submit",function(e){
  e.preventDefault();var q=$("sQ").value.trim();if(q.length<2){setMsg("sMsg","Mindestens 2 Zeichen eingeben.",true);return}
  setMsg("sMsg","Suche läuft …");$("sRes").innerHTML="";
  var pr=D.demo?Promise.resolve({results:demoSearch(q)}):getJSON("search?q="+encodeURIComponent(q));
  pr.then(function(j){sResults=j.results||[];var warn=j.warning;
    $("sRes").innerHTML=sResults.map(function(r,i){return '<li><span class="what"><b>'+esc(r.name)+"</b><small>"+esc(r.symbol)+" · "+esc(r.exchange||"")+(r.type==="ETF"?" · ETF":"")+'</small></span><span class="acts"><button class="btn" type="button" data-sw="'+i+'">Beobachten</button><button class="btn" type="button" data-sr="'+i+'">Übernehmen</button></span></li>'}).join("");
    setMsg("sMsg",sResults.length?sResults.length+" Treffer.":warn?"Die Kursquelle antwortet nicht: "+warn:"Nichts gefunden. Probiere den Firmennamen ohne Zusatz (z. B. „Allianz“), die ISIN oder trag das Kürzel selbst ein, z. B. ALV.DE.",!sResults.length);
  }).catch(function(err){
    if(EMBED)setMsg("sMsg","In dieser Vorschau gibt es keinen Kurs-Server, deshalb findet die Suche nichts. Auf deinem Server mit laufendem Proxy klappt sie. Zum Ausprobieren hier: Beispieldepot laden, dann findest du z. B. SAP, Allianz oder Apple.",true);
    else setMsg("sMsg","Der Kurs-Server antwortet nicht ("+(err&&err.message||err)+"). Prüfe unter Einstellungen › Kurs-Server die Verbindung. Name und Kürzel kannst du auch selbst eintragen, z. B. SAP.DE.",true);
  });
});
$("sRes").addEventListener("click",function(e){
  var b=e.target.closest("[data-sr]");if(!b)return;var r=sResults[+b.getAttribute("data-sr")];if(!r)return;
  $("nName").value=r.name;$("nSym").value=r.symbol;var q=$("sQ").value.trim().toUpperCase();$("nIsin").value=r.isin||(/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(q)?q:"");
  setMsg("nMsg","Kurs wird geholt …");
  fetchQuotes([r.symbol]).then(function(j){var qq=j.quotes&&j.quotes[r.symbol];if(!qq){setMsg("nMsg","Kein aktueller Kurs gefunden. Trag den Kaufkurs von der Abrechnung ein.");return}
    D.quotes[r.symbol]=qq;var fx=fxRate(D,qq.currency);
    setMsg("nMsg","Aktueller Kurs: "+fmtPx(qq.price,qq.currency)+(fx!=null&&qq.currency!=="EUR"?" (ca. "+money(qq.price*fx)+")":"")+". Trag den Kaufkurs von deiner Abrechnung ein.");
  }).catch(function(){setMsg("nMsg","")});
  $("nQty").focus();
});
$("nForm").addEventListener("submit",function(e){
  e.preventDefault();
  var n=$("nName").value.trim(),s=$("nSym").value.trim().toUpperCase(),d=$("nDate").value,q=parseDec($("nQty").value),px=parseDec($("nPrice").value),fee=$("nFee").value.trim()?parseDec($("nFee").value):0;
  if(!/^[A-Z0-9.\-=^:]{1,40}$/.test(s)){setMsg("nMsg","Bitte ein Kürzel eintragen oder ein Suchergebnis übernehmen.",true);$("nSym").focus();return}
  if(!isKey(d)||d>todayKey()){setMsg("nMsg","Bitte ein Kaufdatum bis heute wählen.",true);return}
  if(q==null||q<=0){setMsg("nMsg","Bitte die Stückzahl eingeben.",true);$("nQty").focus();return}
  if(px==null||px<=0){setMsg("nMsg","Bitte den Kurs je Stück in Euro eingeben.",true);$("nPrice").focus();return}
  if(fee==null||fee<0){setMsg("nMsg","Gebühren bitte als Betrag, z. B. 4,90.",true);return}
  if(D.demo)clearDemo();
  var p=D.pos.filter(function(x){return x.sym===s})[0],isNew=!p;
  if(!p){p={id:newId(),name:(n||s).slice(0,60),sym:s,isin:$("nIsin").value.trim().toUpperCase().slice(0,12),depot:$("nDepot").value||defaultDepot(D),tx:[],u:now()};D.pos.push(p)}
  p.tx.push({id:newId(),type:"buy",date:d,qty:q,price:px,fee:fee||0,amount:0,u:now()});p.u=now();
  save();["nName","nSym","nIsin","nQty","nPrice","nFee","sQ"].forEach(function(id){$(id).value=""});$("sRes").innerHTML="";setMsg("sMsg","");
  setMsg("nMsg",(isNew?"Neue Position „":"Kauf ergänzt bei „")+p.name+"“: "+fmtQty(q)+" Stück zu "+money(px)+".");
  ui.pos=p.id;HIST={};refreshQuotes();
});

/* ---------- Auswertung ---------- */
function renderYear(){
  var y=ui.repY,st=yearStats(V(),y),al=+D.settings.allowance||1000,TX=taxYears(V().pos,al)[y]||{base:0,allowanceUsed:0,tax:0,aktGains:0,sonstGains:0,divTaxable:0,divRaw:0,carryA:0,carryS:0,carryStartA:0,carryStartS:0},used=TX.allowanceUsed+(TX.taxable||0);
  $("yLbl").textContent=String(y);$("yMeta").textContent=String(y);
  $("yKpis").innerHTML=[["Dividenden",money(st.divs),"lead"],["Realisierte Gewinne",money(st.realized,true),""],["Käufe",money(st.buys),""],["Verkäufe",money(st.sells),""]].map(function(k){return '<div class="vt '+k[2]+'"><span class="lbl">'+k[0]+"</span><b>"+esc(k[1])+"</b></div>"}).join("");
  var pc=Math.min(100,Math.round(used/al*100));$("aFill").style.width=pc+"%";$("aBar").setAttribute("aria-valuenow",pc);
  $("aPct").textContent="Sparer-Pauschbetrag: "+pc+" % genutzt";$("aTxt").textContent=money(TX.allowanceUsed)+" von "+money0(al)+(TX.tax>0?" · geschätzte Steuer "+money(TX.tax):"");
  var tr=function(l,v,c){return "<tr><td>"+l+'</td><td class="r mono '+(c||"")+'">'+v+"</td></tr>"};
  $("taxBody").innerHTML=tr("Gewinne/Verluste aus Aktien (FIFO)",money(TX.aktGains,true),gvCls(TX.aktGains))+tr("Gewinne/Verluste aus Fonds, nach Teilfreistellung",money(TX.sonstGains,true),gvCls(TX.sonstGains))+tr("Dividenden und Ausschüttungen, steuerpflichtiger Teil",money(TX.divTaxable))+(TX.carryStartA||TX.carryStartS?tr("Verlustvortrag aus dem Vorjahr (Aktien / sonstige)",money(TX.carryStartA)+" / "+money(TX.carryStartS)):"")+tr("Steuerpflichtig vor Pauschbetrag",money(TX.base))+tr("davon durch Sparer-Pauschbetrag frei",money(TX.allowanceUsed))+tr("<b>Geschätzte Steuer (26,375 %)</b>","<b>"+money(TX.tax)+"</b>")+(TX.carryA||TX.carryS?tr("Verlustvortrag ins nächste Jahr (Aktien / sonstige)",money(TX.carryA)+" / "+money(TX.carryS)):"");
  $("yBody").innerHTML=st.rows.map(function(x){var t=x.t,a=t.type==="div"?+t.amount:t.type==="buy"?-(t.qty*t.price+(+t.fee||0)):(t.qty*t.price-(+t.fee||0));return "<tr><td>"+dmy(t.date)+"</td><td>"+esc(x.p.name)+'</td><td><span class="tag '+(t.type==="buy"?"ok":t.type==="sell"?"edit":"fee")+'">'+TXT[t.type]+'</span></td><td class="r mono">'+(t.type==="div"?"–":fmtQty(t.qty))+'</td><td class="r mono '+gvCls(a)+'">'+money(a,true)+"</td></tr>"}).join("")||'<tr><td colspan="5" class="empty">Keine Buchungen in '+y+".</td></tr>";
}
$("yPrev").addEventListener("click",function(){ui.repY--;renderYear()});
$("yNext").addEventListener("click",function(){ui.repY++;renderYear()});
function csvCell(v){v=String(v==null?"":v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function csv(rows){return "﻿"+rows.map(function(r){return r.map(csvCell).join(";")}).join("\r\n")}
var N2=new Intl.NumberFormat("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false});
$("xPos").addEventListener("click",function(){
  var s=depotStats(V()),rows=[["Wertpapier","Kürzel","ISIN","Stück","Kurs","Währung","Wert EUR","Einstand EUR","Kursgewinn EUR","Dividenden EUR","Realisiert EUR"]];
  s.rows.forEach(function(r){rows.push([r.p.name,r.p.sym,r.p.isin||"",String(r.shares).replace(".",","),r.price!=null?String(r.price).replace(".",","):"",r.cur||"",N2.format(r.value),N2.format(r.cost),N2.format(r.unreal),N2.format(r.divs),N2.format(r.realized)])});
  var ok=download("Depot_"+todayKey()+".csv",csv(rows),"text/csv;charset=utf-8");setMsg("xMsg",ok?"CSV erstellt.":"Downloads gehen nur, wenn die Seite auf deinem Webserver liegt.",!ok);
});
$("xTx").addEventListener("click",function(){
  var rows=[["Datum","Wertpapier","Kürzel","Art","Stück","Kurs EUR","Gebühren EUR","Betrag EUR"]],all=[];
  D.pos.forEach(function(p){p.tx.forEach(function(t){all.push([t.date,p.name,p.sym,TXT[t.type],t.type==="div"?"":String(t.qty).replace(".",","),t.type==="div"?"":N2.format(t.price),t.type==="div"?"":N2.format(t.fee||0),N2.format(t.type==="div"?+t.amount:t.type==="buy"?-(t.qty*t.price+(+t.fee||0)):(t.qty*t.price-(+t.fee||0)))])})});
  all.sort(function(a,b){return a[0]<b[0]?-1:1});all.forEach(function(r){r[0]=dmy(r[0]);rows.push(r)});
  var ok=download("Depot_Buchungen_"+todayKey()+".csv",csv(rows),"text/csv;charset=utf-8");setMsg("xMsg",ok?all.length+" Buchungen exportiert.":"Downloads gehen nur, wenn die Seite auf deinem Webserver liegt.",!ok);
});

/* ---------- Einstellungen ---------- */
function renderSettings(){
  if(document.activeElement!==$("sApi"))$("sApi").value=D.settings.api||"api/";
  $("sRefresh").value=String(D.settings.refresh||0);$("sAllow").value=String(D.settings.allowance||1000);
  $("setPName").value=P.name;$("setAutoLock").value=String(D.settings.autoLock||0);$("setCompact").checked=!!D.settings.compact;
  Array.prototype.forEach.call(document.querySelectorAll('input[name="scheme"]'),function(r){r.checked=r.value===(D.settings.scheme||"smooth")});
  $("bkLast").textContent=D.settings.lastBackup?"Letzte Sicherung: "+dmy(D.settings.lastBackup)+".":"Noch keine Sicherung erstellt.";
  $("bkMeta").textContent=D.settings.lastBackup?"zuletzt "+dmy(D.settings.lastBackup):"";
  $("apiMeta").textContent=D.demo?"Spielkurse":qErr&&qErr.msg?"nicht erreichbar":D.qtime?"verbunden":"";
}
$("sApi").addEventListener("change",function(){D.settings.api=this.value.trim()||"api/";persist();HIST={};setMsg("apiMsg","Gespeichert. Prüfe jetzt die Verbindung.")});
$("sRefresh").addEventListener("change",function(){D.settings.refresh=+this.value;persist();setMsg("apiMsg","Gespeichert.")});
$("sAllow").addEventListener("change",function(){D.settings.allowance=+this.value;persist();renderYear();setMsg("apiMsg","Gespeichert.")});
$("apiTest").addEventListener("click",function(){
  setMsg("apiMsg","Verbinde mit "+apiBase()+" …");
  getJSON("ping").then(function(j){var ts=j.sources&&j.sources.indexOf("onvista")>=0?"OV:STOCK:DE0007164600":"SAP.DE";return getJSON("quotes?s="+encodeURIComponent(ts)).then(function(q){var s=q.quotes&&q.quotes[ts];renderSettings();setMsg("apiMsg","Verbunden mit Proxy "+(j.version||"")+(j.demo?" (Demo-Modus)":"")+". "+(s?"Testkurs SAP: "+fmtPx(s.price,s.currency)+".":"Aber die Kursquelle liefert gerade keinen Kurs: "+(q.errors&&q.errors[ts]||"unbekannter Fehler")),!s)})}).catch(function(e){setMsg("apiMsg","Keine Verbindung zu "+apiBase()+": "+(e&&e.message||e)+". Läuft der Proxy, und stimmt die Adresse?",true)});
});
$("setPName").addEventListener("change",function(){var v=this.value.trim().slice(0,24);if(!v||R.profiles.some(function(p){return p!==P&&p.name.toLowerCase()===v.toLowerCase()})){this.value=P.name;setMsg("profMsg","Name leer oder schon vergeben.",true);return}P.name=v;writeRoot();renderAll();setMsg("profMsg","Profilname gespeichert.")});
$("setAutoLock").addEventListener("change",function(){D.settings.autoLock=+this.value;persist();setMsg("profMsg","Gespeichert.")});
$("savePin").addEventListener("click",function(){
  var o=$("setPinOld").value,n=$("setPinNew").value;
  if(o!==PIN){setMsg("profMsg","Die bisherige PIN stimmt nicht.",true);return}
  if(n.length<4){setMsg("profMsg","Die neue PIN braucht mindestens 4 Zeichen.",true);return}
  var salt=b64(rnd(16));deriveKey(n,salt,ITER).then(function(k){P.salt=salt;P.it=ITER;KEY=k;PIN=n;return persist()}).then(function(){$("setPinOld").value="";$("setPinNew").value="";setMsg("profMsg","PIN geändert. Ältere Sicherungen brauchen weiter die alte PIN.")});
});

/* ---------- Sicherung ---------- */
function backupText(){
  var salt=b64(rnd(16)),data=JSON.parse(JSON.stringify({settings:D.settings,pos:D.pos,watch:D.watch,alerts:D.alerts,plans:D.plans,events:D.events}));
  return deriveKey(PIN,salt,ITER).then(function(k){return seal(k,data)}).then(function(s){D.settings.lastBackup=todayKey();persist();renderAll();return JSON.stringify({type:"depot-backup",v:1,profile:P.name,date:todayKey(),salt:salt,it:ITER,iv:s.iv,ct:s.ct})});
}
$("bkDownload").addEventListener("click",function(){backupText().then(function(t){var ok=download("Depot_"+P.name.replace(/\W+/g,"_")+"_"+todayKey()+".json",t,"application/json");if(!ok)$("bkTxt").value=t;setMsg("bkMsg",ok?"Sicherung heruntergeladen.":"Download nicht möglich, die Sicherung steht im Textfeld.")})});
$("bkCopy").addEventListener("click",function(){backupText().then(function(t){$("bkTxt").value=t;$("bkTxt").select();try{navigator.clipboard.writeText(t).catch(function(){})}catch(e){}setMsg("bkMsg","Sicherung steht im Textfeld.")})});
$("bkFile").addEventListener("change",function(){var f=this.files&&this.files[0];if(f)f.text().then(function(t){$("bkTxt").value=t;setMsg("bkMsg","Datei geladen. Jetzt „Zusammenführen“ oder „Profil ersetzen“.")})});
function readBackup(){
  var raw=$("bkTxt").value.trim();if(!raw)return Promise.reject("Bitte zuerst eine Sicherung einfügen oder eine Datei wählen.");
  var o;try{o=JSON.parse(raw)}catch(e){return Promise.reject("Das ist keine gültige Sicherung.")}
  if(!o||o.type!=="depot-backup")return Promise.reject("Das ist keine Sicherung von Mein Depot.");
  return deriveKey($("bkPin").value||PIN,o.salt,o.it||ITER).then(function(k){return unseal(k,o.iv,o.ct)}).then(function(d){return {meta:o,data:d}}).catch(function(){return Promise.reject("Entschlüsseln nicht möglich. Stimmt die PIN der Sicherung?")});
}
$("bkMerge").addEventListener("click",function(){readBackup().then(function(b){if(D.demo)clearDemo();var n=mergeInto(D,b.data);save();renderAll();setMsg("bkMsg",n.added||n.updated?"Zusammengeführt: "+n.added+" neu, "+n.updated+" aktualisiert.":"Nichts Neues, alles schon vorhanden.")}).catch(function(m){setMsg("bkMsg",String(m),true)})});
$("bkReplace").addEventListener("click",function(){var btn=this;readBackup().then(function(b){armed(btn,"Alle Daten dieses Profils ersetzen?",function(){D=normalizeData(b.data);save();applyLook();applySect();renderAll();refreshQuotes();setMsg("bkMsg","Sicherung vom "+dmy(b.meta.date)+" eingespielt.")});if(btn.classList.contains("armed"))setMsg("bkMsg","Zum Bestätigen noch einmal klicken.")}).catch(function(m){setMsg("bkMsg",String(m),true)})});
$("deleteProfile").addEventListener("click",function(){var b=this;armed(b,"Profil „"+P.name+"“ endgültig löschen?",function(){R.profiles=R.profiles.filter(function(p){return p!==P});writeRoot();P=null;D=null;KEY=null;PIN=null;showGate()})});

/* ---------- Beispieldepot ---------- */
function clearDemo(){var s=D.settings;D=newData();D.settings=s;HIST={};qErr=null}
$("loadDemo").addEventListener("click",function(){seedDemo(D);HIST={};save();refreshQuotes();loadDepotChart()});
$("clearDemo").addEventListener("click",function(){clearDemo();save();ui.pos=null;renderAll();loadDepotChart()});

/* Ansicht gewechselt: Diagramme nachladen */
var _show=showView;showView=function(v,a){_show(v,a);if(!D)return;if(v==="depot"){loadDepotChart();loadDepotNews()}if(v==="position")renderPosition();if(v==="neu"&&!$("nDate").value)$("nDate").value=todayKey()};
function resetForms(){resetTx();$("nDate").value=todayKey()}

/* ---------- Start ---------- */
Array.prototype.forEach.call(document.querySelectorAll(".appver"),function(el){el.textContent=APP_VERSION});
Array.prototype.forEach.call(document.querySelectorAll(".appverlong"),function(el){el.textContent=APP_VERSION+" vom "+dmy(APP_DATE)});
R=loadRoot();
showGate();
