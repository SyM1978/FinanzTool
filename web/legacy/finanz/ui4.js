/* ---------- Auswertung ---------- */
function repRange(){var r=ui.rep;if(r.mode==="year")return {from:r.y+"-01-01",to:r.y+"-12-31",label:"Jahr "+r.y,y:String(r.y),m:null};return {from:mk(r.y,r.m,1),to:mk(r.y,r.m,31),label:MON[r.m]+" "+r.y,y:String(r.y),m:r.m}}
function buildReport(){
  var g=repRange(),p=D.plan[g.y],rows=[],seen={},tk=todayKey(),res=compute(D);
  var pv=function(it){return g.m==null?it.m.reduce(function(a,b){return a+b},0):it.m[g.m]};
  if(p)p.groups.forEach(function(gr){gr.items.forEach(function(it){
    var pl=pv(it),is=istOf(D,g.y,it.name,g.m);seen[it.name.toLowerCase()]=1;
    if(!pl&&!is)return;
    var inc=gr.kind==="einnahme",has=hasIst(D,g.y,it.name);
    rows.push({name:it.name,area:gr.name,kind:gr.kind,plan:pl,ist:has?is:null,diff:has?(inc?is-pl:pl-is):null});
  })});
  /* Ist-Kategorien ohne Plan */
  var idx=istIndex(D)[g.y]||{},names={};
  D.orders.forEach(function(o){if(o.cat)names[o.cat.toLowerCase()]=o.cat});D.tx.forEach(function(t){if(t.cat)names[t.cat.toLowerCase()]=t.cat});
  Object.keys(idx).forEach(function(c){if(seen[c])return;var v=g.m==null?idx[c].reduce(function(a,b){return a+b},0):idx[c][g.m];if(v)rows.push({name:names[c]||c,area:"nicht im Plan",kind:"x",plan:0,ist:v,diff:-v})});
  var acc=D.accounts.map(function(a){var r=res.acc[a.id],s=balAt(r,addDays(g.from,-1)),e=balAt(r,g.to),i=0,o=0;r.ev.forEach(function(x){if(x.d<g.from||x.d>g.to||x.k==="start")return;if(x.a>0)i+=x.a;else o+=x.a});return {a:a,s:s,i:i,o:o,e:e}});
  var t=planTotals(D,g.y),pick=function(arr){return g.m==null?arr.reduce(function(a,b){return a+b},0):arr[g.m]};
  var ii=0,io=0;rows.forEach(function(r){if(r.ist==null)return;if(r.kind==="einnahme")ii+=r.ist;else io+=r.ist});
  return {g:g,rows:rows,acc:acc,inc:pick(t.inc),out:pick(t.out),res:pick(t.res),ii:ii,io:io,future:g.to>tk,hasPlan:!!p};
}
function renderReport(){
  var r=ui.rep;if(!r.y){var t=t0();r.y=t.getFullYear();r.m=t.getMonth()}
  var b=buildReport(),g=b.g;
  $("repLabel").textContent=g.label;$("phTitle").textContent="Finanzauswertung "+g.label;$("phSub").textContent=P.name+" · erstellt am "+dmy(todayKey());
  $("repMeta").textContent=g.label+(b.future?" · enthält Prognose":"");
  $("repKpis").innerHTML=[["Plan Einnahmen",eur(b.inc),""],["Plan Ausgaben",eur(b.out),""],["Plan Überschuss",eur(b.res,true),"lead"],["Ist Einnahmen",eur(b.ii),""],["Ist Ausgaben",eur(b.io),""],["Ist Überschuss",eur(b.ii-b.io,true),""]].map(function(k){return '<div class="vt '+k[2]+'"><span class="lbl">'+k[0]+"</span><b>"+esc(k[1])+"</b></div>"}).join("");
  $("repBody").innerHTML=b.rows.map(function(x){return "<tr><td>"+esc(x.name)+"</td><td>"+esc(x.area)+'</td><td class="r eur">'+eur(x.plan)+'</td><td class="r eur">'+(x.ist==null?"–":eur(x.ist))+'</td><td class="r eur '+(x.diff==null?"":amtCls(x.diff))+'">'+(x.diff==null?"–":eur(x.diff,true))+"</td></tr>"}).join("")||'<tr><td colspan="5" class="empty">'+(b.hasPlan?"Keine Werte in diesem Zeitraum.":"Für "+g.y+" gibt es keinen Finanzplan.")+"</td></tr>";
  var sp=0,si=0;b.rows.forEach(function(x){if(x.kind==="einnahme")return;sp+=x.plan;si+=x.ist||0});
  $("repFoot").innerHTML=b.rows.length?'<tr><td colspan="2">Ausgaben gesamt</td><td class="r eur">'+eur(sp)+'</td><td class="r eur">'+eur(si)+'</td><td class="r eur '+amtCls(sp-si)+'">'+eur(sp-si,true)+"</td></tr>":"";
  $("repAccBody").innerHTML=b.acc.map(function(x){return '<tr><td><i class="cdot" style="--c:'+esc(x.a.color)+'"></i> '+esc(x.a.name)+'</td><td class="r eur">'+eur(x.s)+'</td><td class="r eur pos">'+eur(x.i)+'</td><td class="r eur neg">'+eur(x.o)+'</td><td class="r eur">'+eur(x.e)+"</td></tr>"}).join("")||'<tr><td colspan="5" class="empty">Keine Konten.</td></tr>';
}
$("repMode").addEventListener("change",function(e){ui.rep.mode=e.target.value;renderReport()});
$("repPrev").addEventListener("click",function(){var r=ui.rep;if(r.mode==="year")r.y--;else{r.m--;if(r.m<0){r.m=11;r.y--}}renderReport()});
$("repNext").addEventListener("click",function(){var r=ui.rep;if(r.mode==="year")r.y++;else{r.m++;if(r.m>11){r.m=0;r.y++}}renderReport()});
function csvCell(v){v=String(v==null?"":v);return /[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function csv(rows){return "﻿"+rows.map(function(r){return r.map(csvCell).join(";")}).join("\r\n")}
$("repCsv").addEventListener("click",function(){
  var b=buildReport(),rows=[["Finanzauswertung",b.g.label],[],["Kategorie","Bereich","Plan","Ist","Abweichung"]];
  b.rows.forEach(function(x){rows.push([x.name,x.area,num(x.plan),x.ist==null?"":num(x.ist),x.diff==null?"":num(x.diff)])});
  rows.push([],["Konto","Anfang","Eingänge","Ausgänge","Ende"]);b.acc.forEach(function(x){rows.push([x.a.name,num(x.s),num(x.i),num(x.o),num(x.e)])});
  var ok=download("Finanzauswertung_"+b.g.label.replace(/\s+/g,"_")+".csv",csv(rows),"text/csv;charset=utf-8");
  setMsg("repMsg",ok?"CSV erstellt.":"Downloads gehen nur, wenn die Seite auf deinem Webserver liegt.",!ok);
});
$("repTxCsv").addEventListener("click",function(){
  var res=compute(D),tk=todayKey(),rows=[["Datum","Konto","Buchung","Kategorie","Art","Betrag","Stand"]],all=[];
  D.accounts.forEach(function(a){res.acc[a.id].ev.forEach(function(e){if(e.d>tk||e.k==="start"||!e.a)return;all.push([e.d,a.name,e.t,e.cat||"",{tx:"Einzelbuchung",ord:"Dauerauftrag",fee:"Gebühr",int:"Zinsen",corr:"Korrektur"}[e.k]||"",num(e.a),num(e.bal)])})});
  all.sort(function(x,y){return x[0]<y[0]?-1:x[0]>y[0]?1:0});all.forEach(function(r){r[0]=dmy(r[0]);rows.push(r)});
  var ok=download("Buchungen_bis_"+tk+".csv",csv(rows),"text/csv;charset=utf-8");setMsg("repMsg",ok?(all.length+" Buchungen exportiert."):"Downloads gehen nur, wenn die Seite auf deinem Webserver liegt.",!ok);
});
$("repPrint").addEventListener("click",function(){var root=document.documentElement;root.setAttribute("data-print","");$("report").open=true;setTimeout(function(){try{window.print()}catch(e){}root.removeAttribute("data-print")},50)});

/* ---------- Einstellungen: Konten ---------- */
function renderSettings(){
  $("accList").innerHTML=D.accounts.map(function(a){
    var f=forecast(D,a),x=[KINDS[a.kind],"Stand "+eur(f.now)];
    if(a.fee&&a.fee.amount)x.push("Gebühr "+eur(a.fee.amount));if(a.goal&&a.goal.amount)x.push("Ziel "+eur0(a.goal.amount));
    return '<li><span class="what"><i class="cdot" style="--c:'+esc(a.color)+'"></i> <b>'+esc(a.name)+"</b><small>"+x.join(" · ")+'</small></span><button class="btn" type="button" data-eacc="'+esc(a.id)+'">Bearbeiten</button></li>';
  }).join("")||'<li><span class="n" style="color:var(--muted)">Noch keine Konten.</span></li>';
  $("setAccMeta").textContent=D.accounts.length?D.accounts.length+" Konten":"";
  $("setPName").value=P.name;$("setAutoLock").value=String(D.settings.autoLock||0);$("setCompact").checked=!!D.settings.compact;
  Array.prototype.forEach.call(document.querySelectorAll('input[name="scheme"]'),function(r){r.checked=r.value===(D.settings.scheme||"smooth")});
  var sc=$("bkScope"),keep=sc.value;sc.innerHTML='<option value="">Alle Daten</option>'+D.accounts.map(function(a){return '<option value="'+esc(a.id)+'">Nur Konto „'+esc(a.name)+"“</option>"}).join("");sc.value=keep&&accById(D,keep)?keep:"";
  $("bkLast").textContent=D.settings.lastBackup?"Letzte Sicherung: "+dmy(D.settings.lastBackup)+".":"Noch keine Sicherung erstellt.";
  $("bkMeta").textContent=D.settings.lastBackup?"zuletzt "+dmy(D.settings.lastBackup):"";
  var pf=$("aPayFrom").value;accOpts($("aPayFrom"),true,function(x){return !isLoan(x)});$("aPayFrom").value=pf;
}
$("accList").addEventListener("click",function(e){var b=e.target.closest("[data-eacc]");if(b)editAcc(b.getAttribute("data-eacc"))});
function colorPick(c){$("aColors").innerHTML=COLORS.map(function(x,i){return '<label><input type="radio" name="acol" value="'+x+'"'+(x===c?" checked":"")+'><span style="--c:'+x+'" title="Farbe '+(i+1)+'"></span></label>'}).join("")}
function accKindUI(){var k=$("aKind").value,l=k==="kredit";$("aLoan").hidden=!l;$("aExtra").hidden=l;$("aStartLbl").textContent=l?"Restschuld (€)":"Startwert (€)";$("aStartDateLbl").textContent=l?"Restschuld zu Beginn des":"Stand zu Beginn des"}
$("aKind").addEventListener("change",accKindUI);
function resetAccForm(){
  ui.editAcc=null;$("accFormTitle").textContent="Neues Konto";$("accSave").textContent="Konto anlegen";$("accDel").hidden=true;$("accCancel").hidden=true;
  ["aName","aStart","aRate","aPay","aOrig","aFee","aInt","aGoal","aGoalDate","aMin"].forEach(function(id){$(id).value=""});
  $("aKind").value="giro";$("aStartDate").value=todayKey();$("aFeeInt").value="m";$("aFeeDay").value="31";$("aPayDay").value="1";
  var used=D?D.accounts.map(function(a){return a.color}):[];colorPick(COLORS.filter(function(c){return used.indexOf(c)<0})[0]||COLORS[0]);
  if(D){accOpts($("aPayFrom"),true,function(x){return !isLoan(x)});var g=D.accounts.filter(function(a){return a.kind==="giro"})[0];$("aPayFrom").value=g?g.id:""}
  accKindUI();
}
function editAcc(id){
  var a=accById(D,id);if(!a)return;ui.editAcc=id;
  $("accFormTitle").textContent="Konto bearbeiten: "+a.name;$("accSave").textContent="Speichern";$("accDel").hidden=false;$("accCancel").hidden=false;
  $("aName").value=a.name;$("aKind").value=a.kind;$("aStartDate").value=a.start.date;$("aStart").value=fieldEur(isLoan(a)?-a.start.amount:a.start.amount);colorPick(a.color);
  var L=a.loan||{},o=loanOrder(a);$("aRate").value=fmtRate(L.rate||"");$("aPay").value=o?num(o.amount):"";$("aPayDay").value=String(o?o.day:L.day||1);$("aPayFrom").value=o?(o.from||""):(L.payFrom||"");$("aOrig").value=fieldEur(L.orig||0);
  $("aFee").value=a.fee?fieldEur(a.fee.amount):"";$("aFeeInt").value=a.fee?a.fee.interval||"m":"m";$("aFeeDay").value=String(a.fee?a.fee.day||31:31);
  $("aInt").value=fmtRate(a.interest||"");$("aGoal").value=a.goal?fieldEur(a.goal.amount):"";$("aGoalDate").value=a.goal&&a.goal.date||"";$("aMin").value=fieldEur(+a.min||0);
  accKindUI();var sec=$("konten");sec.open=true;try{$("accForm").scrollIntoView({block:"start"})}catch(e){}$("aName").focus();
}
$("accForm").addEventListener("submit",function(e){
  e.preventDefault();
  var name=$("aName").value.trim(),kind=$("aKind").value,sd=$("aStartDate").value,sv=$("aStart").value.trim()===""?0:parseEur($("aStart").value);
  if(!name){setMsg("accMsg","Bitte einen Namen eingeben.",true);$("aName").focus();return}
  if(D.accounts.some(function(a){return a.name.toLowerCase()===name.toLowerCase()&&a.id!==ui.editAcc})){setMsg("accMsg","Ein Konto mit diesem Namen gibt es schon.",true);return}
  if(!isKey(sd)){setMsg("accMsg","Bitte das Datum für den Startwert wählen.",true);return}
  if(sv==null){setMsg("accMsg","Startwert bitte als Betrag, z. B. 1.250,00.",true);$("aStart").focus();return}
  var opt=function(id){var v=$(id).value.trim();if(!v)return 0;return parseEur(v)};
  var a=ui.editAcc?accById(D,ui.editAcc):null,isNew=!a;
  if(!a){a={id:newId()};D.accounts.push(a)}
  var col=document.querySelector('input[name="acol"]:checked');
  Object.assign(a,{name:name.slice(0,30),kind:kind,color:col?col.value:COLORS[0],start:{date:sd,amount:kind==="kredit"?-Math.abs(sv):sv},u:now()});
  if(kind==="kredit"){
    var rate=parseRate($("aRate").value),pay=opt("aPay"),day=+$("aPayDay").value,pf=$("aPayFrom").value,orig=opt("aOrig");
    if(rate==null&&$("aRate").value.trim()){setMsg("accMsg","Sollzins bitte als Zahl, z. B. 3,85.",true);return}
    if(pay==null||orig==null){setMsg("accMsg","Bitte die Beträge prüfen.",true);return}
    var L=a.loan||(a.loan={});L.rate=rate||0;L.day=day;L.payFrom=pf;L.orig=Math.abs(orig||0);
    var o=loanOrder(a);
    if(pay>0){
      if(!o){o={id:newId(),name:"Rate "+a.name,interval:"m",shift:"next",cat:a.name,end:""};D.orders.push(o);L.order=o.id}
      var first=mk(parseKey(sd).getFullYear(),parseKey(sd).getMonth(),day);if(first<sd)first=mk(parseKey(sd).getFullYear(),parseKey(sd).getMonth()+1,day);
      Object.assign(o,{amount:Math.abs(pay),from:pf,to:a.id,day:day,start:o.start&&o.start<=first?o.start:first,u:now()});
    } else if(o){deleteOrder(o.id)}
    a.fee=null;a.interest=null;a.goal=null;a.min=0;
  } else {
    var fee=opt("aFee"),ir=parseRate($("aInt").value),goal=opt("aGoal"),mn=opt("aMin");
    if(fee==null||goal==null||mn==null){setMsg("accMsg","Bitte die Beträge prüfen, z. B. 4,95.",true);return}
    a.fee=fee?{amount:Math.abs(fee),interval:$("aFeeInt").value,day:+$("aFeeDay").value}:null;
    a.interest=ir||null;a.goal=goal?{amount:Math.abs(goal),date:$("aGoalDate").value||""}:null;a.min=mn||0;
    if(a.loan)a.loan=null;
  }
  save();resetAccForm();renderAll();setMsg("accMsg",(isNew?"Konto „":"Gespeichert: „")+a.name+"“"+(isNew?" angelegt.":"."));
  if(isNew&&!isLoan(a))ui.acc=a.id;
});
$("accDel").addEventListener("click",function(){var b=this,a=accById(D,ui.editAcc);if(!a)return;armed(b,"„"+a.name+"“ mit allen Buchungen löschen?",function(){
  var id=a.id;D.orders.filter(function(o){return o.from===id||o.to===id}).forEach(function(o){deleteOrder(o.id)});
  var trs={};D.tx.forEach(function(t){if(t.acc===id&&t.tr)trs[t.tr]=1});
  D.tx=D.tx.filter(function(t){return t.acc!==id});D.tx.forEach(function(t){if(t.tr&&trs[t.tr])delete t.tr});
  D.accounts=D.accounts.filter(function(x){return x.id!==id});
  save();resetAccForm();renderAll();setMsg("accMsg","Konto „"+a.name+"“ gelöscht.");
})});
$("accCancel").addEventListener("click",function(){resetAccForm();setMsg("accMsg","")});

/* ---------- Profil ---------- */
$("setPName").addEventListener("change",function(){var v=this.value.trim().slice(0,24);if(!v||R.profiles.some(function(p){return p!==P&&p.name.toLowerCase()===v.toLowerCase()})){this.value=P.name;setMsg("profMsg","Name leer oder schon vergeben.",true);return}P.name=v;writeRoot();renderHead();setMsg("profMsg","Profilname gespeichert.")});
$("setAutoLock").addEventListener("change",function(){D.settings.autoLock=+this.value;persist();setMsg("profMsg","Gespeichert.")});
$("savePin").addEventListener("click",function(){
  var o=$("setPinOld").value,n=$("setPinNew").value;
  if(o!==PIN){setMsg("profMsg","Die bisherige PIN stimmt nicht.",true);return}
  if(n.length<4){setMsg("profMsg","Die neue PIN braucht mindestens 4 Zeichen.",true);return}
  var salt=b64(rnd(16));
  deriveKey(n,salt,ITER).then(function(k){P.salt=salt;P.it=ITER;KEY=k;PIN=n;return persist()}).then(function(){$("setPinOld").value="";$("setPinNew").value="";setMsg("profMsg","PIN geändert. Ältere Sicherungen brauchen weiter die alte PIN.")});
});

/* ---------- Excel-Import ---------- */
var impJ=null;
$("impFile").addEventListener("change",function(){
  var f=this.files&&this.files[0];if(!f)return;
  f.text().then(function(txt){
    var J=JSON.parse(txt);if(!J||J.type!=="finanzkonto-plan")throw 0;impJ=J;
    $("impYears").textContent=Object.keys(J.plan||{}).join(" und ");
    var S=J.suggest||{accounts:[],orders:[]};
    $("impAcc").innerHTML=S.accounts.map(function(a){var ex=D.accounts.some(function(x){return x.name.toLowerCase()===a.name.toLowerCase()});return '<label><input type="checkbox" data-ia="'+esc(a.key)+'"'+(a.on?" checked":"")+"><span>"+esc(a.name)+" <small>"+KINDS[a.kind]+(ex?" · schon vorhanden":"")+(a.payment?" · Rate "+eur(a.payment):"")+"</small></span></label>"}).join("");
    var nm={};S.accounts.forEach(function(a){nm[a.key]=a.name});
    $("impOrd").innerHTML=S.orders.map(function(o,i){return '<label><input type="checkbox" data-io="'+i+'"'+(o.on?" checked":"")+"><span>"+esc(o.name)+" <small>"+eur(o.amount)+" "+INTV[o.interval].label+(o.interval!=="m"?" ("+MONs[(o.month||1)-1]+")":"")+" · "+esc(o.frm?nm[o.frm]:"Extern")+" → "+esc(o.to?nm[o.to]:"Extern")+"</small></span></label>"}).join("");
    $("impBox").hidden=false;setMsg("impMsg","");
  }).catch(function(){impJ=null;$("impBox").hidden=true;setMsg("impMsg","Das ist keine Importdatei für das Finanzkonto.",true)});
});
$("impCancel").addEventListener("click",function(){impJ=null;$("impBox").hidden=true;$("impFile").value=""});
$("impGo").addEventListener("click",function(){
  if(!impJ)return;
  if(D.demo)clearDemo();
  var ch={plan:$("impPlan").checked,acc:{},ord:{}};
  Array.prototype.forEach.call(document.querySelectorAll("[data-ia]"),function(c){ch.acc[c.getAttribute("data-ia")]=c.checked});
  Array.prototype.forEach.call(document.querySelectorAll("[data-io]"),function(c){ch.ord[+c.getAttribute("data-io")]=c.checked});
  var m=importPlan(D,impJ,ch);
  save();impJ=null;$("impBox").hidden=true;$("impFile").value="";ui.planY=t0().getFullYear();resetForms();renderAll();
  setMsg("impMsg","Übernommen: "+m.years+" Planjahre, "+m.acc+" Konten, "+m.ord+" Daueraufträge. Trag jetzt bei jedem Konto den aktuellen Stand ein, bei Krediten Restschuld und Sollzins.");
});

/* ---------- Sicherung ---------- */
function backupText(){
  var scope=$("bkScope").value,data=scopeData(D,scope),salt=b64(rnd(16));
  if(!scope)data.settings=D.settings;
  return deriveKey(PIN,salt,ITER).then(function(k){return seal(k,data)}).then(function(s){
    D.settings.lastBackup=todayKey();persist();renderSettings();renderAlerts();
    return JSON.stringify({type:"finanzkonto-backup",v:1,scope:scope?"konto":"alles",profile:P.name,date:todayKey(),salt:salt,it:ITER,iv:s.iv,ct:s.ct});
  });
}
$("bkDownload").addEventListener("click",function(){var sc=$("bkScope").value,a=sc&&accById(D,sc);backupText().then(function(t){var ok=download("Finanzkonto_"+(a?a.name.replace(/\W+/g,"_"):P.name.replace(/\W+/g,"_"))+"_"+todayKey()+".json",t,"application/json");if(!ok)$("bkTxt").value=t;setMsg("bkMsg",ok?"Sicherung heruntergeladen.":"Download nicht möglich, die Sicherung steht im Textfeld.")})});
$("bkCopy").addEventListener("click",function(){backupText().then(function(t){$("bkTxt").value=t;$("bkTxt").select();try{navigator.clipboard.writeText(t).catch(function(){})}catch(e){}setMsg("bkMsg","Sicherung steht im Textfeld"+(navigator.clipboard?" und ist kopiert.":"."))})});
$("bkFile").addEventListener("change",function(){var f=this.files&&this.files[0];if(f)f.text().then(function(t){$("bkTxt").value=t;setMsg("bkMsg","Datei geladen. Jetzt „Zusammenführen“ oder „Profil ersetzen“.")})});
function readBackup(){
  var raw=$("bkTxt").value.trim();if(!raw)return Promise.reject("Bitte zuerst eine Sicherung einfügen oder eine Datei wählen.");
  var o;try{o=JSON.parse(raw)}catch(e){return Promise.reject("Das ist keine gültige Sicherung.")}
  if(o&&o.type==="finanzkonto-backup"){var pin=$("bkPin").value||PIN;return deriveKey(pin,o.salt,o.it||ITER).then(function(k){return unseal(k,o.iv,o.ct)}).then(function(d){return {meta:o,data:d}}).catch(function(){return Promise.reject("Entschlüsseln nicht möglich. Stimmt die PIN der Sicherung?")})}
  return Promise.reject("Das ist keine Sicherung des Finanzkontos.");
}
$("bkMerge").addEventListener("click",function(){readBackup().then(function(b){if(D.demo)clearDemo();var n=mergeInto(D,b.data);save();renderAll();setMsg("bkMsg",n.added||n.updated?"Zusammengeführt: "+n.added+" neu, "+n.updated+" aktualisiert.":"Nichts Neues, alles schon vorhanden.")}).catch(function(m){setMsg("bkMsg",String(m),true)})});
$("bkReplace").addEventListener("click",function(){var btn=this;readBackup().then(function(b){
  if(b.meta.scope==="konto"){setMsg("bkMsg","Das ist die Sicherung eines einzelnen Kontos. Bitte „Zusammenführen“ verwenden.",true);return}
  armed(btn,"Alle Daten dieses Profils ersetzen?",function(){D=normalizeData(b.data);save();applyLook();applySect();resetForms();renderAll();setMsg("bkMsg","Sicherung vom "+dmy(b.meta.date)+" eingespielt.")});
  if(btn.classList.contains("armed"))setMsg("bkMsg","Zum Bestätigen noch einmal klicken.");
}).catch(function(m){setMsg("bkMsg",String(m),true)})});
$("deleteProfile").addEventListener("click",function(){var b=this;armed(b,"Profil „"+P.name+"“ endgültig löschen?",function(){R.profiles=R.profiles.filter(function(p){return p!==P});writeRoot();P=null;D=null;KEY=null;PIN=null;showGate()})});

/* ---------- Beispieldaten ---------- */
function clearDemo(){var s=D.settings;D=newData();D.settings=s;touch()}
$("loadDemo").addEventListener("click",function(){seedDemo(D);save();ui.acc=null;ui.loan=null;ui.planY=t0().getFullYear();resetForms();renderAll()});
$("clearDemo").addEventListener("click",function(){clearDemo();save();ui.acc=null;ui.loan=null;resetForms();renderAll()});

function resetForms(){dayOpts($("oDay"));dayOpts($("aFeeDay"));dayOpts($("aPayDay"));if(D){resetTxForm();resetOrdForm();resetAccForm()}$("rcDate").value=todayKey()}

/* ---------- Version & Start ---------- */
if(EMBED){$("repPrint").hidden=true}
Array.prototype.forEach.call(document.querySelectorAll(".appver"),function(el){el.textContent=APP_VERSION});
Array.prototype.forEach.call(document.querySelectorAll(".appverlong"),function(el){el.textContent=APP_VERSION+" vom "+dmy(APP_DATE)});
document.addEventListener("visibilitychange",function(){if(!document.hidden&&D)renderAll()});
R=loadRoot();
showGate();
