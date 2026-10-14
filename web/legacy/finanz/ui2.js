/* ---------- Gesamt-Rendering ---------- */
function renderAll(){
  if(!D)return;
  renderHead();renderAlerts();renderOverview();renderAccounts();renderOrders();renderLoans();renderPlan();renderReport();renderSettings();updateCats();
  $("demoBar").hidden=!D.demo;
}
function renderHead(){
  var t=new Date();
  $("dateLine").textContent=["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"][t.getDay()]+", "+t.getDate()+". "+MON[t.getMonth()]+" "+t.getFullYear();
  $("profName").textContent=P.name;
  var res=compute(D),net=0;D.accounts.forEach(function(a){net+=balAt(res.acc[a.id],todayKey())});
  $("nmNet").textContent=D.accounts.length?eur0(net):"";
  $("nmAcc").textContent=D.accounts.length||"";
  $("nmOrd").textContent=D.orders.length||"";
  var nl=D.accounts.filter(isLoan).length;$("nmLoan").textContent=nl||"";
  $("nmPlan").textContent=D.plan[ui.planY]?ui.planY:"";
}
function renderAlerts(){
  var out=[],tk=todayKey();
  D.accounts.forEach(function(a){
    if(isLoan(a)){
      var L=a.loan||{},o=L.order&&D.orders.filter(function(x){return x.id===L.order})[0];
      if(a.start.amount<0&&o&&L.rate>0){var mi=Math.round(-a.start.amount*L.rate/100/12);if(o.amount<=mi)out.push(['<b>'+esc(a.name)+':</b> Die Rate von '+eur(o.amount)+" deckt nicht einmal die Zinsen ("+eur(mi)+" im Monat). So wird der Kredit nie getilgt.","kredite"])}
      return;
    }
    var f=forecast(D,a);
    if(f.low)out.push(['<b>'+esc(a.name)+':</b> Am '+dmy(f.low.d)+" fällt der Stand voraussichtlich auf "+eur(f.low.bal)+((+a.min||0)?" (Warngrenze "+eur(a.min)+")":"")+".","konten",a.id]);
  });
  var lb=D.settings.lastBackup;
  if(D.accounts.length&&!D.demo&&(!lb||(parseKey(tk)-parseKey(lb))/864e5>30))out.push(["<b>Sicherung:</b> "+(lb?"Die letzte Sicherung ist vom "+dmy(lb)+".":"Du hast noch keine Sicherung erstellt.")+" Löscht der Browser seine Daten, wäre alles weg.","einstellungen"]);
  $("alerts").innerHTML=out.map(function(x){return '<div class="banner"><span>'+x[0]+'</span><button class="btn" type="button" data-alert="'+x[1]+'"'+(x[2]?' data-acc="'+esc(x[2])+'"':"")+">Ansehen</button></div>"}).join("");
}
$("alerts").addEventListener("click",function(e){var b=e.target.closest("[data-alert]");if(!b)return;var v=b.getAttribute("data-alert");if(b.getAttribute("data-acc")){ui.acc=b.getAttribute("data-acc");renderAccounts()}showView(v,v==="einstellungen"?"bkTxt":null)});

/* ---------- Übersicht ---------- */
function renderOverview(){
  var res=compute(D),tk=todayKey(),t=parseKey(tk),eom=mk(t.getFullYear(),t.getMonth(),31),eoy=t.getFullYear()+"-12-31";
  $("welcome").hidden=!!(D.accounts.length||Object.keys(D.plan).length);
  var net=0,nm=0,ny=0,pos=0,neg=0;
  D.accounts.forEach(function(a){var r=res.acc[a.id],b=balAt(r,tk);net+=b;nm+=balAt(r,eom);ny+=balAt(r,eoy);if(b>=0)pos+=b;else neg+=b});
  $("netNow").textContent=eur(net);$("netNow").className="big eur "+amtCls(net);
  $("netMonth").textContent=eur(nm);$("netMonthSub").textContent=eur(nm-net,true)+" bis "+dm(eom);
  $("netYear").textContent=eur(ny);$("netYearSub").textContent=eur(ny-net,true)+" bis 31.12.";
  $("netNote").textContent=D.accounts.length?"Guthaben "+eur(pos)+" · Schulden "+eur(-neg)+". Die Prognose rechnet mit Daueraufträgen, Gebühren und Zinsen.":"Noch keine Konten.";
  $("sumNet").innerHTML=D.accounts.length?"<b>"+esc(eur(net))+"</b>":"";
  /* Finanzplan des Monats */
  var y=t.getFullYear(),m=t.getMonth(),pt=planTotals(D,y);
  if(D.plan[y]){
    $("pmIn").textContent=eur(pt.inc[m]);$("pmOut").textContent=eur(pt.out[m]);$("pmRes").textContent=eur(pt.res[m],true);$("pmRes").className="eur "+amtCls(pt.res[m]);
    var ii=0,io=0;D.plan[y].groups.forEach(function(g){g.items.forEach(function(it){var v=istOf(D,y,it.name,m);if(g.kind==="einnahme")ii+=v;else io+=v})});
    $("pmResSub").textContent="Ist bisher: "+eur(ii-io,true);
    $("pmNote").textContent="Bisher gebucht: Einnahmen "+eur(ii)+", Ausgaben "+eur(io)+" (nur Kategorien aus dem Plan).";
    $("sumMonth").innerHTML=MON[m]+" · <b>"+esc(eur(pt.res[m],true))+"</b>";
  } else {["pmIn","pmOut","pmRes"].forEach(function(id){$(id).textContent="–"});$("pmResSub").textContent="";$("pmNote").textContent="Für "+y+" gibt es noch keinen Finanzplan.";$("sumMonth").textContent=""}
  /* Kacheln */
  $("tiles").innerHTML=D.accounts.map(function(a){
    var f=forecast(D,a),sub="",bar="";
    if(isLoan(a)){sub=f.paid?"getilgt am "+dmy(f.paid):"Tilgungsende offen";var orig=(a.loan&&a.loan.orig)||-a.start.amount;if(orig>0){var pc=Math.max(0,Math.min(100,Math.round((orig+f.now)/orig*100)));bar='<div class="goalbar"><div class="fill" style="width:'+pc+'%"></div></div><small>'+pc+" % getilgt</small>"}}
    else{sub="Monatsende "+eur(f.month);if(a.goal&&a.goal.amount>0){var gp=Math.max(0,Math.min(100,Math.round(f.now/a.goal.amount*100)));bar='<div class="goalbar"><div class="fill" style="width:'+gp+'%"></div></div><small>'+gp+" % von "+eur0(a.goal.amount)+(f.goalReached?" · erreicht":f.goalDate?" · am "+dmy(f.goalDate):"")+"</small>"}}
    var low=f.low?'<small class="neg">Am '+dmy(f.low.d)+" unter "+eur(+a.min||0)+"</small>":"";
    return '<button class="acct" type="button" data-tile="'+esc(a.id)+'" style="--c:'+esc(a.color)+'"><span class="an"><span>'+esc(a.name)+'</span><span class="kind">'+KINDS[a.kind]+'</span></span><b class="'+amtCls(f.now)+'">'+eur(f.now)+"</b><small>"+sub+"</small>"+bar+low+"</button>";
  }).join("")||'<p class="empty">Noch keine Konten angelegt.</p>';
  $("sumTiles").textContent=D.accounts.length?D.accounts.length+" Konten":"";
  /* Demnächst */
  var to=addDays(tk,14),list=[],ord={};D.orders.forEach(function(o){ord[o.id]=o});
  D.accounts.forEach(function(a){res.acc[a.id].ev.forEach(function(e){
    if(e.d<tk||e.d>to||e.k==="start"||e.pre||e.skip)return;
    if(e.oid&&ord[e.oid]){var o=ord[e.oid],prim=accById(D,o.from)?o.from:o.to;if(a.id!==prim)return}
    else if(e.tr&&e.a>0)return;
    if(!e.a)return;
    list.push({e:e,a:a});
  })});
  list.sort(function(x,y){return x.e.d<y.e.d?-1:x.e.d>y.e.d?1:0});
  $("soonList").innerHTML=list.slice(0,14).map(function(x){
    var e=x.e,tr=e.other&&accById(D,e.other),amt=tr?eur(Math.abs(e.a)):eur(e.a,true);
    var path=tr?esc(x.a.name)+" → "+esc(accName(e.other)):esc(x.a.name);
    return '<li><span class="when">'+wdShort(e.d)+" "+dm(e.d)+'</span><span class="what">'+esc(e.t)+"<small>"+path+(e.cat?" · "+esc(e.cat):"")+'</small></span><span class="eur '+(tr?"":amtCls(e.a))+'">'+amt+"</span></li>";
  }).join("")||'<li><span class="n" style="color:var(--muted)">In den nächsten 14 Tagen steht nichts an.</span></li>';
}
$("tiles").addEventListener("click",function(e){var b=e.target.closest("[data-tile]");if(!b)return;var a=accById(D,b.getAttribute("data-tile"));if(isLoan(a)){ui.loan=a.id;renderLoans();showView("kredite")}else{ui.acc=a.id;renderAccounts();showView("konten")}});

/* ---------- Konten ---------- */
function curAcc(){var a=ui.acc&&accById(D,ui.acc);if(!a){a=D.accounts.filter(function(x){return !isLoan(x)})[0]||D.accounts[0]||null;ui.acc=a?a.id:null}return a}
function renderAccounts(){
  var a=curAcc();
  $("accNone").hidden=!!a;$("accGrid").hidden=!a;$("accPick").hidden=!a;
  if(!a)return;
  $("accPick").innerHTML=D.accounts.map(function(x){return '<button type="button" data-acc="'+esc(x.id)+'" aria-pressed="'+(x.id===a.id)+'"><i class="cdot" style="--c:'+esc(x.color)+'"></i>'+esc(x.name)+"</button>"}).join("");
  var res=compute(D),r=res.acc[a.id],f=forecast(D,a),tk=todayKey();
  $("accTitle").textContent=a.name;$("accKind").innerHTML='<span class="kind">'+KINDS[a.kind]+"</span>";
  $("accNowLbl").textContent=isLoan(a)?"Stand heute (Restschuld)":"Stand heute";
  $("accNow").textContent=eur(f.now);$("accNow").className="big eur "+amtCls(f.now);
  var hasGoal=!isLoan(a)&&a.goal&&a.goal.amount>0;
  $("accGoalBar").hidden=!hasGoal;$("accGoalMeta").hidden=!hasGoal;
  if(hasGoal){var gp=Math.max(0,Math.min(100,Math.round(f.now/a.goal.amount*100)));$("accGoalFill").style.width=gp+"%";$("accGoalBar").setAttribute("aria-valuenow",gp);$("accGoalPct").textContent=gp+" % von "+eur(a.goal.amount);
    var gt=f.goalReached?"Ziel erreicht":f.goalDate?"erreicht am "+dmy(f.goalDate):"mit den Daueraufträgen nicht erreicht";
    if(!f.goalReached&&a.goal.date){var need=a.goal.amount-f.now,mo=Math.max(1,monthsBetween(tk,a.goal.date));gt+=" · bis "+dmy(a.goal.date)+" nötig: "+eur(Math.ceil(need/mo))+"/Monat"}
    $("accGoalTxt").textContent=gt}
  $("accMonth").textContent=eur(f.month);$("accMonthSub").textContent=eur(f.month-f.now,true)+" bis Monatsende";
  if(isLoan(a)){$("accFc2Lbl").textContent="Getilgt am";$("accFc2").textContent=f.paid?dmy(f.paid):"offen";$("accFc2Sub").textContent="Details unter Kredite"}
  else if(hasGoal&&!f.goalReached){$("accFc2Lbl").textContent="Sparziel";$("accFc2").textContent=f.goalDate?dmy(f.goalDate):"–";$("accFc2Sub").textContent=eur(a.goal.amount)}
  else{$("accFc2Lbl").textContent="Jahresende";$("accFc2").textContent=eur(f.year);$("accFc2Sub").textContent=eur(f.year-f.now,true)+" bis 31.12."}
  var ch=['<span class="chip">Startwert '+eur(a.start.amount)+" zu Beginn des "+dmy(a.start.date)+"</span>"];
  if(a.fee&&a.fee.amount>0)ch.push('<span class="chip">Gebühr '+eur(a.fee.amount)+" "+INTV[a.fee.interval||"m"].label+"</span>");
  if(+a.interest>0)ch.push('<span class="chip">Guthabenzins '+fmtRate(a.interest)+" %</span>");
  if(f.low)ch.push('<span class="chip warn">Am '+dmy(f.low.d)+": "+eur(f.low.bal)+"</span>");
  $("accChips").innerHTML=ch.join("");
  /* Diagramm des Monats */
  var y=ui.accY,m=ui.accM,N=lastDay(y,m),pts=[],tIdx=null;
  for(var d=0;d<=N;d++){var k=d?mk(y,m,d):mk(y,m,0);var v=balAt(r,k);pts.push({x:d/N,v:v,fut:k>tk});if(k===tk)tIdx=d/N}
  var lines=[];if(+a.min)lines.push({v:+a.min,t:"Warngrenze "+eur0(+a.min),cls:"minln",tcls:"mintx",left:true});
  if(hasGoal){var mx=Math.max.apply(null,pts.map(function(p){return p.v}));if(a.goal.amount<=mx*2.5)lines.push({v:a.goal.amount,t:"Ziel "+eur0(a.goal.amount)})}
  var xl=[1,5,10,15,20,25,N].filter(function(x,i,arr){return arr.indexOf(x)===i&&(x===N||N-x>=3)}).map(function(x){return {x:x/N,t:x+"."}});
  $("accChart").innerHTML=lineChart(pts,{xl:xl,todayX:tIdx,lines:lines,label:"Verlauf "+a.name+" im "+MON[m]});
  $("accMonthLbl").textContent=MON[m]+" "+y;
  var mEnd=pts[pts.length-1].v,mStart=pts[0].v;$("accChartMeta").innerHTML=MON[m]+": <b>"+esc(eur(mEnd-mStart,true))+"</b>";
  /* Buchungsliste */
  var from=mk(y,m,1),to=mk(y,m,N);
  var rows=r.ev.filter(function(e){return e.d>=from&&e.d<=to}).slice().reverse();
  var ord={};D.orders.forEach(function(o){ord[o.id]=o});
  $("txBody").innerHTML=rows.map(function(e){
    var tag,cls=[];
    if(e.k==="start"){cls.push("startrow");return '<tr class="startrow"><td>'+wdShort(e.d)+" "+dm(e.d)+'</td><td colspan="2">Startwert (Stand zu Beginn des Tages)</td><td class="r"></td><td class="r eur">'+eur(e.bal)+"</td></tr>"}
    if(e.skip){tag='<span class="tag plan">ausgesetzt</span>';cls.push("skip")}
    else if(e.k==="fee")tag='<span class="tag fee">Gebühr</span>';
    else if(e.k==="int")tag='<span class="tag fee">Zinsen</span>';
    else if(e.k==="corr")tag='<span class="tag edit">Korrektur</span>';
    else if(e.k==="ord")tag='<span class="tag '+(e.fut?"plan":"ok")+'">'+(e.fut?"geplant":"Dauerauftrag")+"</span>"+(e.capped?' <span class="tag plan">letzte Rate</span>':"");
    else if(e.edited)tag='<span class="tag edit">geändert</span>';
    else tag='<span class="tag ok">Einzelbuchung</span>';
    if(e.fut)cls.push("fut");
    var sub=[];if(e.other)sub.push((e.a<0?"→ ":"← ")+esc(accName(e.other)));else if(e.oid&&ord[e.oid]&&!ord[e.oid].fee&&e.k!=="tx")sub.push(e.a<0?"→ Extern":"← Extern");if(e.cat)sub.push(esc(e.cat));
    var data=(e.k==="ord"||e.k==="fee"||e.edited)?' data-oid="'+esc(e.oid)+'" data-occ="'+esc(e.occ)+'"':e.tid?' data-tid="'+esc(e.tid)+'"':"";
    return "<tr"+data+' class="'+cls.join(" ")+'" tabindex="0"><td>'+wdShort(e.d)+" "+dm(e.d)+"</td><td>"+esc(e.t)+(sub.length?'<span class="t2">'+sub.join(" · ")+"</span>":"")+"</td><td>"+tag+'</td><td class="r eur amt '+amtCls(e.a)+'">'+(e.skip?eur(0):eur(e.a,true))+'</td><td class="r eur">'+eur(e.bal)+"</td></tr>";
  }).join("")||'<tr><td colspan="5" class="empty">Keine Buchungen in diesem Monat.</td></tr>';
  var nIn=0,nOut=0;rows.forEach(function(e){if(e.k==="start")return;if(e.a>0)nIn+=e.a;else nOut+=e.a});
  $("accTxMeta").innerHTML="+"+esc(num(nIn))+" / −"+esc(num(-nOut));
  accOpts($("txTo"),false,function(x){return x.id!==a.id});
  if(ui.occ)renderOcc();
}
$("accPick").addEventListener("click",function(e){var b=e.target.closest("[data-acc]");if(!b)return;ui.acc=b.getAttribute("data-acc");ui.occ=null;$("occBox").hidden=true;resetTxForm();renderAccounts()});
$("accPrev").addEventListener("click",function(){ui.accM--;if(ui.accM<0){ui.accM=11;ui.accY--}renderAccounts()});
$("accNext").addEventListener("click",function(){ui.accM++;if(ui.accM>11){ui.accM=0;ui.accY++}renderAccounts()});
function txRowAct(tr){
  if(!tr)return;
  if(tr.getAttribute("data-oid")){ui.occ={oid:tr.getAttribute("data-oid"),occ:tr.getAttribute("data-occ")};renderOcc();$("occBox").hidden=false;$("occAmt").focus();return}
  var tid=tr.getAttribute("data-tid");if(tid)editTx(tid);
}
$("txBody").addEventListener("click",function(e){txRowAct(e.target.closest("tr[data-oid],tr[data-tid]"))});
$("txBody").addEventListener("keydown",function(e){if(e.key!=="Enter"&&e.key!==" ")return;var tr=e.target.closest("tr[data-oid],tr[data-tid]");if(tr){e.preventDefault();txRowAct(tr)}});

/* Einzelne Ausführung eines Dauerauftrags ändern / aussetzen */
function findOrder(oid){
  if(oid.indexOf("fee:")===0){var a=accById(D,oid.slice(4));return a&&a.fee?{id:oid,name:"Kontoführungsgebühr",amount:a.fee.amount,from:a.id,to:"",shift:"next",cat:"Kontoführung",fee:true}:null}
  return D.orders.filter(function(o){return o.id===oid})[0]||null;
}
function renderOcc(){
  var x=ui.occ,o=x&&findOrder(x.oid);if(!o){$("occBox").hidden=true;ui.occ=null;return}
  var ovr=D.tx.filter(function(t){return t.order===o.id&&t.occ===x.occ}),sk=D.skips.some(function(s){return s.order===o.id&&s.occ===x.occ});
  $("occTitle").textContent=o.name+" · fällig "+dmy(x.occ);
  $("occDate").value=ovr.length?ovr[0].date:shiftDate(x.occ,o.shift||"next");
  $("occAmt").value=num(ovr.length?Math.abs(ovr[0].amount):o.amount);
  $("occSkip").textContent=sk?"Wieder ausführen":"Diesmal aussetzen";
  $("occHint").textContent=sk?"Diese Ausführung ist ausgesetzt.":ovr.length?"Diese Ausführung wurde angepasst.":"Gilt für "+(accById(D,o.from)&&accById(D,o.to)?"beide Konten der Umbuchung":"dieses Konto")+". Der Dauerauftrag selbst bleibt unverändert.";
}
function clearOcc(o,occ){D.tx=D.tx.filter(function(t){return !(t.order===o.id&&t.occ===occ)});D.skips=D.skips.filter(function(s){return !(s.order===o.id&&s.occ===occ)})}
$("occSave").addEventListener("click",function(){
  var x=ui.occ,o=x&&findOrder(x.oid);if(!o)return;
  var amt=parseEur($("occAmt").value),d=$("occDate").value;
  if(amt==null||amt<0||!isKey(d)){$("occHint").textContent="Bitte Datum und Betrag prüfen.";return}
  amt=Math.abs(amt);clearOcc(o,x.occ);
  var tr=newId(),both=accById(D,o.from)&&accById(D,o.to);
  if(accById(D,o.from))D.tx.push({id:newId(),acc:o.from,date:d,amount:-amt,text:o.name,cat:o.cat||"",order:o.id,occ:x.occ,tr:both?tr:undefined,u:now()});
  if(accById(D,o.to))D.tx.push({id:newId(),acc:o.to,date:d,amount:amt,text:o.name,cat:o.cat||"",order:o.id,occ:x.occ,tr:both?tr:undefined,u:now()});
  save();renderAll();$("occHint").textContent="Gespeichert: "+eur(amt)+" am "+dmy(d)+".";
});
$("occSkip").addEventListener("click",function(){
  var x=ui.occ,o=x&&findOrder(x.oid);if(!o)return;
  var sk=D.skips.some(function(s){return s.order===o.id&&s.occ===x.occ});
  clearOcc(o,x.occ);if(!sk)D.skips.push({order:o.id,occ:x.occ});
  save();renderAll();
});
$("occReset").addEventListener("click",function(){var x=ui.occ,o=x&&findOrder(x.oid);if(!o)return;clearOcc(o,x.occ);save();renderAll()});
$("occClose").addEventListener("click",function(){ui.occ=null;$("occBox").hidden=true});

/* Einzelbuchung erfassen / bearbeiten */
function txKind(){var r=document.querySelector('input[name="txk"]:checked');return r?r.value:"out"}
function setTxKind(v){Array.prototype.forEach.call(document.querySelectorAll('input[name="txk"]'),function(r){r.checked=r.value===v});$("txToWrap").hidden=v!=="tr"}
$("txKind").addEventListener("change",function(){setTxKind(txKind())});
function resetTxForm(){ui.editTx=null;$("txFormTitle").textContent="Neue Buchung";$("txSave").textContent="Buchen";$("txDel").hidden=true;$("txCancel").hidden=true;$("txDate").value=todayKey();$("txAmt").value="";$("txText").value="";$("txCat").value="";setTxKind("out")}
function editTx(tid){
  var t=D.tx.filter(function(x){return x.id===tid})[0];if(!t)return;
  var partner=t.tr?D.tx.filter(function(x){return x.tr===t.tr&&x.id!==t.id})[0]:null;
  if(partner&&t.amount>0){var s=t;t=partner;partner=s}
  ui.editTx=t.id;ui.acc=t.acc;
  $("txFormTitle").textContent="Buchung bearbeiten";$("txSave").textContent="Speichern";$("txDel").hidden=false;$("txCancel").hidden=false;
  setTxKind(partner?"tr":t.amount<0?"out":"in");
  $("txDate").value=t.date;$("txAmt").value=num(Math.abs(t.amount));$("txText").value=t.text||"";$("txCat").value=t.cat||"";
  renderAccounts();if(partner)$("txTo").value=partner.acc;
  var sec=document.querySelector('details[data-sec="newtx"]');sec.open=true;$("txAmt").focus();
}
function removeTx(id){var t=D.tx.filter(function(x){return x.id===id})[0];if(!t)return;D.tx=D.tx.filter(function(x){return x.id!==id&&!(t.tr&&x.tr===t.tr)})}
$("txForm").addEventListener("submit",function(e){
  e.preventDefault();
  var a=curAcc();if(!a)return;
  var k=txKind(),d=$("txDate").value,amt=parseEur($("txAmt").value),text=$("txText").value.trim(),cat=$("txCat").value.trim();
  if(!isKey(d)){setMsg("txMsg","Bitte ein Datum wählen.",true);return}
  if(amt==null||amt===0){setMsg("txMsg","Bitte einen Betrag eingeben, z. B. 49,90.",true);$("txAmt").focus();return}
  amt=Math.abs(amt);
  var to=$("txTo").value;if(k==="tr"&&(!to||to===a.id)){setMsg("txMsg","Bitte das Zielkonto wählen.",true);return}
  var keepId=ui.editTx;if(keepId)removeTx(keepId);
  if(k==="tr"){var tr=newId();D.tx.push({id:keepId||newId(),acc:a.id,date:d,amount:-amt,text:text||"Umbuchung",cat:cat,tr:tr,u:now()});D.tx.push({id:newId(),acc:to,date:d,amount:amt,text:text||"Umbuchung",cat:cat,tr:tr,u:now()})}
  else D.tx.push({id:keepId||newId(),acc:a.id,date:d,amount:k==="out"?-amt:amt,text:text||(k==="out"?"Ausgabe":"Einnahme"),cat:cat,u:now()});
  save();var msg=(keepId?"Gespeichert: ":"Gebucht: ")+eur(k==="out"||k==="tr"?-amt:amt,true)+" am "+dmy(d)+".";
  var dd=parseKey(d);ui.accY=dd.getFullYear();ui.accM=dd.getMonth();
  resetTxForm();renderAll();setMsg("txMsg",msg);
});
$("txDel").addEventListener("click",function(){var b=this;armed(b,"Wirklich löschen?",function(){removeTx(ui.editTx);save();resetTxForm();renderAll();setMsg("txMsg","Buchung gelöscht.")})});
$("txCancel").addEventListener("click",function(){resetTxForm();setMsg("txMsg","")});

/* Bankabgleich */
var rcDiff=null;
$("rcCheck").addEventListener("click",function(){
  var a=curAcc(),d=$("rcDate").value,b=parseEur($("rcAmt").value);
  if(!isKey(d)||b==null){setMsg("rcMsg","Bitte Datum und Bankstand eintragen.",true);return}
  var c=balAt(compute(D).acc[a.id],d);rcDiff={d:d,v:b-c};
  $("rcFix").hidden=rcDiff.v===0;
  setMsg("rcMsg",rcDiff.v===0?"Passt genau: "+eur(c)+" am "+dmy(d)+".":"Hier: "+eur(c)+", Bank: "+eur(b)+". Differenz "+eur(rcDiff.v,true)+".",rcDiff.v!==0);
  $("reconMeta").textContent=rcDiff.v===0?"stimmt":"Differenz "+eur(rcDiff.v,true);
});
$("rcFix").addEventListener("click",function(){
  var a=curAcc();if(!rcDiff||!rcDiff.v)return;
  D.tx.push({id:newId(),acc:a.id,date:rcDiff.d,amount:rcDiff.v,text:"Korrektur Bankabgleich",cat:"",corr:true,u:now()});
  save();renderAll();$("rcFix").hidden=true;setMsg("rcMsg","Korrektur von "+eur(rcDiff.v,true)+" gebucht.");$("reconMeta").textContent="stimmt";rcDiff=null;
});
