/* ---------- Daueraufträge ---------- */
function nextOcc(o){
  var tk=todayKey(),sk={};D.skips.forEach(function(s){if(s.order===o.id)sk[s.occ]=1});
  var res=compute(D),cap=res.cap;
  var list=occurrences(o,addYears(tk,2));
  for(var i=0;i<list.length;i++){var x=list[i];if(x.d>=tk&&!sk[x.occ]&&cap[o.id+"|"+x.occ]!==0)return x.d}
  return null;
}
function renderOrders(){
  var f=ui.ordFilter;if(f&&!accById(D,f))f=ui.ordFilter="";
  $("ordFilter").innerHTML='<div class="accpick">'+['<button type="button" data-of="" aria-pressed="'+(!f)+'">Alle</button>'].concat(D.accounts.map(function(a){return '<button type="button" data-of="'+esc(a.id)+'" aria-pressed="'+(f===a.id)+'"><i class="cdot" style="--c:'+esc(a.color)+'"></i>'+esc(a.name)+"</button>"})).join("")+"</div>";
  var list=D.orders.filter(function(o){return !f||o.from===f||o.to===f}).slice().sort(function(a,b){return (a.from===""?0:1)-(b.from===""?0:1)||b.amount/INTV[b.interval].n-a.amount/INTV[a.interval].n});
  var sIn=0,sOut=0,sTr=0;
  $("ordBody").innerHTML=list.map(function(o){
    var fa=accById(D,o.from),ta=accById(D,o.to),pm=o.amount/INTV[o.interval].n,sign;
    if(f){sign=o.to===f?1:-1}else sign=!fa?1:!ta?-1:0;
    if(sign>0)sIn+=pm;else if(sign<0)sOut+=pm;else sTr+=pm;
    var nx=nextOcc(o),ended=o.end&&o.end<todayKey();
    var rh=INTV[o.interval].label+", "+dayLabel(o.day)+(o.interval!=="m"?" ("+MONs[parseKey(o.start).getMonth()]+")":"");
    return '<tr data-ord="'+esc(o.id)+'" tabindex="0"'+(ended?' class="off"':"")+"><td>"+esc(o.name)+(o.cat&&o.cat!==o.name?'<span class="dnote">'+esc(o.cat)+"</span>":"")+"</td><td>"+esc(fa?fa.name:"Extern")+" → "+esc(ta?ta.name:"Extern")+"</td><td>"+rh+(o.end?'<span class="dnote">bis '+dmy(o.end)+"</span>":"")+'</td><td class="mono">'+(nx?dmy(nx):ended?"beendet":"–")+'</td><td class="r eur '+(sign>0?"pos":sign<0?"neg":"")+'">'+eur(o.amount)+'</td><td class="r eur">'+eur(Math.round(pm))+"</td></tr>";
  }).join("")||'<tr><td colspan="6" class="empty">Noch keine Daueraufträge.</td></tr>';
  var fees=0;D.accounts.forEach(function(a){if(a.fee&&a.fee.amount>0&&(!f||f===a.id))fees+=a.fee.amount/INTV[a.fee.interval||"m"].n});
  $("ordFoot").innerHTML=list.length?'<tr><td colspan="5">Eingänge pro Monat</td><td class="r eur pos">'+eur(Math.round(sIn))+'</td></tr><tr><td colspan="5">Ausgänge pro Monat'+(fees?" (plus Gebühren "+eur(Math.round(fees))+")":"")+'</td><td class="r eur neg">'+eur(-Math.round(sOut))+"</td></tr>"+(f?"":'<tr><td colspan="5">Umbuchungen pro Monat</td><td class="r eur">'+eur(Math.round(sTr))+"</td></tr>")+'<tr><td colspan="5">Bleibt pro Monat</td><td class="r eur '+amtCls(sIn-sOut-fees)+'">'+eur(Math.round(sIn-sOut-fees),true)+"</td></tr>":"";
  $("ordMeta").textContent=D.orders.length?D.orders.length+" Aufträge":"";
  var keepF=$("oFrom").value,keepT=$("oTo").value;accOpts($("oFrom"),true);accOpts($("oTo"),true);$("oFrom").value=keepF||"";$("oTo").value=keepT||"";
}
$("ordFilter").addEventListener("click",function(e){var b=e.target.closest("[data-of]");if(!b)return;ui.ordFilter=b.getAttribute("data-of");renderOrders()});
function resetOrdForm(){
  ui.editOrd=null;$("ordFormTitle").textContent="Neuer Dauerauftrag";$("ordSave").textContent="Dauerauftrag anlegen";$("ordDel").hidden=true;$("ordCancel").hidden=true;
  $("oName").value="";$("oAmt").value="";$("oInt").value="m";$("oDay").value="1";$("oShift").value="next";$("oCat").value="";$("oEnd").value="";
  var t=parseKey(todayKey());$("oStart").value=mk(t.getFullYear(),t.getMonth()+1,1);
  var g=D&&D.accounts.filter(function(a){return a.kind==="giro"})[0];if(D){accOpts($("oFrom"),true);accOpts($("oTo"),true)}$("oFrom").value=g?g.id:"";$("oTo").value="";
}
function editOrd(id){
  var o=D.orders.filter(function(x){return x.id===id})[0];if(!o)return;
  ui.editOrd=id;$("ordFormTitle").textContent="Dauerauftrag bearbeiten";$("ordSave").textContent="Speichern";$("ordDel").hidden=false;$("ordCancel").hidden=false;
  $("oName").value=o.name;$("oAmt").value=num(o.amount);$("oFrom").value=accById(D,o.from)?o.from:"";$("oTo").value=accById(D,o.to)?o.to:"";$("oInt").value=o.interval;$("oDay").value=String(Math.min(31,+o.day||1));$("oStart").value=o.start;$("oEnd").value=o.end||"";$("oShift").value=o.shift||"next";$("oCat").value=o.cat||"";
  var sec=document.querySelector('details[data-sec="ordform"]');sec.open=true;try{sec.scrollIntoView({block:"start"})}catch(e){}$("oName").focus();
}
$("ordBody").addEventListener("click",function(e){var tr=e.target.closest("tr[data-ord]");if(tr)editOrd(tr.getAttribute("data-ord"))});
$("ordBody").addEventListener("keydown",function(e){if(e.key!=="Enter")return;var tr=e.target.closest("tr[data-ord]");if(tr)editOrd(tr.getAttribute("data-ord"))});
$("ordForm").addEventListener("submit",function(e){
  e.preventDefault();
  var name=$("oName").value.trim(),amt=parseEur($("oAmt").value),fr=$("oFrom").value,to=$("oTo").value,st=$("oStart").value,en=$("oEnd").value;
  if(!name){setMsg("ordMsg","Bitte eine Bezeichnung eingeben.",true);$("oName").focus();return}
  if(amt==null||amt<=0){setMsg("ordMsg","Bitte einen Betrag größer 0 eingeben.",true);$("oAmt").focus();return}
  if(!fr&&!to){setMsg("ordMsg","Mindestens eine Seite muss ein eigenes Konto sein.",true);return}
  if(fr&&fr===to){setMsg("ordMsg","Von- und Nach-Konto sind gleich.",true);return}
  if(!isKey(st)){setMsg("ordMsg","Bitte das Datum der ersten Ausführung wählen.",true);return}
  if(en&&en<st){setMsg("ordMsg","Das Ende liegt vor dem Start.",true);return}
  var o=ui.editOrd?D.orders.filter(function(x){return x.id===ui.editOrd})[0]:null,isNew=!o;
  if(!o){o={id:newId()};D.orders.push(o)}
  Object.assign(o,{name:name,amount:Math.abs(amt),from:fr,to:to,interval:$("oInt").value,day:+$("oDay").value,start:st,end:en||"",shift:$("oShift").value,cat:$("oCat").value.trim(),u:now()});
  var ta=accById(D,to);if(isLoan(ta)&&ta.loan&&(!ta.loan.order||!D.orders.some(function(x){return x.id===ta.loan.order}))){ta.loan.order=o.id;ta.loan.day=o.day;ta.loan.payFrom=fr;ta.u=now()}
  save();resetOrdForm();renderAll();setMsg("ordMsg",(isNew?"Angelegt: ":"Gespeichert: ")+name+".");
});
function deleteOrder(id){
  D.orders=D.orders.filter(function(o){return o.id!==id});D.tx=D.tx.filter(function(t){return t.order!==id});D.skips=D.skips.filter(function(s){return s.order!==id});
  D.accounts.forEach(function(a){if(a.loan&&a.loan.order===id)a.loan.order=null});
}
$("ordDel").addEventListener("click",function(){var b=this;armed(b,"Wirklich löschen?",function(){deleteOrder(ui.editOrd);save();resetOrdForm();renderAll();setMsg("ordMsg","Dauerauftrag gelöscht.")})});
$("ordCancel").addEventListener("click",function(){resetOrdForm();setMsg("ordMsg","")});

/* ---------- Kredite ---------- */
function curLoan(){var l=D.accounts.filter(isLoan),a=ui.loan&&accById(D,ui.loan);if(!a||!isLoan(a))a=l[0]||null;ui.loan=a?a.id:null;return a}
function loanOrder(a){var id=a.loan&&a.loan.order;return id?D.orders.filter(function(o){return o.id===id})[0]||null:null}
function ym(n,nom){var y=Math.floor(n/12),m=n%12,s=[];if(y)s.push(y+(y===1?" Jahr":nom?" Jahre":" Jahren"));if(m)s.push(m+(m===1?" Monat":nom?" Monate":" Monaten"));return s.join(" und ")||(nom?"0 Monate":"diesem Monat")}
function renderLoans(){
  var a=curLoan(),l=D.accounts.filter(isLoan);
  $("loanNone").hidden=!!a;$("loanGrid").hidden=!a;$("loanPick").hidden=l.length<2;
  if(!a)return;
  $("loanPick").innerHTML=l.map(function(x){return '<button type="button" data-loan="'+esc(x.id)+'" aria-pressed="'+(x.id===a.id)+'"><i class="cdot" style="--c:'+esc(x.color)+'"></i>'+esc(x.name)+"</button>"}).join("");
  var f=forecast(D,a),L=a.loan||{},o=loanOrder(a),tk=todayKey(),rest=-f.now,r=compute(D).acc[a.id];
  $("loanTitle").textContent=a.name;$("loanMeta").innerHTML=L.rate?"Sollzins <b>"+fmtRate(L.rate)+" %</b>":"";
  $("lnRest").textContent=eur(Math.max(0,rest));
  var orig=+L.orig||-a.start.amount,pc=orig>0?Math.max(0,Math.min(100,Math.round((orig-rest)/orig*100))):0;
  $("lnFill").style.width=pc+"%";$("lnBar").setAttribute("aria-valuenow",pc);$("lnPct").textContent=pc+" % getilgt";$("lnOrig").textContent=L.orig?"von "+eur(orig)+" ursprünglich":"seit "+dmy(a.start.date)+" ("+eur(-a.start.amount)+")";
  if(rest<=0){$("lnEnd").textContent="getilgt";$("lnEndSub").textContent=""}
  else if(f.paid){$("lnEnd").textContent=dmy(f.paid);$("lnEndSub").textContent="in "+ym(monthsBetween(tk,f.paid))}
  else{$("lnEnd").textContent="offen";$("lnEndSub").textContent=o?"Rate reicht nicht für die Tilgung":"keine Rate hinterlegt"}
  $("lnInt").textContent=eur(f.intLeft);$("lnIntSub").textContent="bisher seit Startwert: "+eur(f.intPaid);
  $("lnRate").textContent=o?eur(o.amount):"–";$("lnRateSub").textContent=o?INTV[o.interval].label+", am "+dayLabel(o.day)+" von "+accName(o.from):"Rate unter Einstellungen › Konten eintragen";
  var yEnd=t0().getFullYear()+"-12-31",ry=-balAt(r,yEnd);$("lnYear").textContent=eur(Math.max(0,ry));$("lnYearSub").textContent="Tilgung bis dahin: "+eur(Math.max(0,rest-Math.max(0,ry)));
  var ch=[];
  if(!L.rate)ch.push('<span class="chip warn">Kein Sollzins eingetragen, es wird zinsfrei gerechnet</span>');
  if(a.start.amount===0)ch.push('<span class="chip warn">Restschuld als Startwert fehlt</span>');
  if(o&&L.rate&&rest>0){var mi=Math.round(rest*L.rate/100/12);ch.push('<span class="chip">Davon Zinsen diesen Monat ca. '+eur(mi)+", Tilgung "+eur(Math.max(0,o.amount-mi))+"</span>")}
  $("lnChips").innerHTML=ch.join("");
  /* Diagramm: Restschuld bis zur Tilgung (max. 40 Jahre) */
  var st=a.start.date,end=f.paid||addYears(tk,40),n=Math.max(1,monthsBetween(st,end)),pts=[],sp=parseKey(st);
  for(var i=0;i<=n;i++){var k=i===n?end:mk(sp.getFullYear(),sp.getMonth()+i,i?31:sp.getDate());pts.push({x:i/n,v:Math.max(0,-balAt(r,k)),fut:k>tk})}
  var yrs=[],y0=sp.getFullYear(),y1=parseKey(end).getFullYear(),ys=Math.max(1,Math.ceil((y1-y0)/8));
  for(var yy=y0+1;yy<=y1;yy+=ys){var mi2=monthsBetween(st,yy+"-01-01");if(mi2>0&&mi2<n)yrs.push({x:mi2/n,t:String(yy)})}
  var tx=monthsBetween(st,tk)/n;
  $("lnChart").innerHTML=lineChart(pts,{xl:yrs,todayX:tx>0&&tx<1?tx:null,label:"Restschuld "+a.name});
  /* Tilgungsplan */
  var by={},order=[];
  r.ev.forEach(function(e){if(e.pre||e.k==="start")return;var key=ui.lp==="y"?e.d.slice(0,4):e.d.slice(0,7);if(!by[key]){by[key]={pay:0,int:0,rest:0};order.push(key)}var b=by[key];if(e.k==="int")b.int-=e.a;else if(e.a>0)b.pay+=e.a;b.rest=Math.max(0,-e.bal)});
  $("lpH").textContent=ui.lp==="y"?"Jahr":"Monat";
  var tp=0,ti=0;
  $("lpBody").innerHTML=order.map(function(key){var b=by[key];tp+=b.pay;ti+=b.int;var lbl=ui.lp==="y"?key:MONs[+key.slice(5,7)-1]+" "+key.slice(0,4);var fut=ui.lp==="y"?key>tk.slice(0,4):key>tk.slice(0,7);return "<tr"+(fut?' class="off"':"")+"><td>"+lbl+'</td><td class="r eur">'+eur(b.pay)+'</td><td class="r eur">'+eur(b.int)+'</td><td class="r eur">'+eur(b.pay-b.int)+'</td><td class="r eur">'+eur(b.rest)+"</td></tr>"}).join("")||'<tr><td colspan="5" class="empty">Noch keine Zahlungen geplant.</td></tr>';
  $("lpMeta").textContent=order.length?"Zahlungen "+eur(tp)+" · Zinsen "+eur(ti):"";
  if(!$("stDate").value)$("stDate").value=mk(t0().getFullYear(),t0().getMonth()+1,L.day||1);
  renderSim();
}
function t0(){return parseKey(todayKey())}
$("loanPick").addEventListener("click",function(e){var b=e.target.closest("[data-loan]");if(!b)return;ui.loan=b.getAttribute("data-loan");renderLoans()});
$("lpMode").addEventListener("change",function(e){ui.lp=e.target.value;renderLoans()});
var simCur=null;
function renderSim(){
  var a=curLoan();if(!a)return;
  var amt=parseEur($("stAmt").value)||0,d=$("stDate").value,rate=parseEur($("stRate").value)||0,yearly=$("stYearly").value==="1";
  simCur=null;$("stApply").hidden=true;
  if((amt<=0&&rate<=0)||(amt>0&&!isKey(d))){$("stOut").innerHTML='<p class="note">Betrag und Datum eingeben, oder eine neue Monatsrate. Dann siehst du, wann der Kredit getilgt wäre und wie viel Zinsen du sparst.</p>';return}
  if(rate>0&&!loanOrder(a)){$("stOut").innerHTML='<p class="note">Für eine neue Rate muss zuerst eine Rate hinterlegt sein.</p>';return}
  var f=forecast(D,a),s=simulateLoan(D,a.id,{amount:amt,date:d,yearly:yearly,rate:rate});
  var dm2=f.paid&&s.paid?monthsBetween(s.paid,f.paid):null;
  $("stOut").innerHTML='<div class="fc"><span class="lbl">Neues Ende</span><b>'+(s.paid?dmy(s.paid):"offen")+"</b><small>"+(dm2!=null?(dm2>0?ym(dm2,1)+" früher":dm2<0?ym(-dm2,1)+" später":"unverändert"):"")+'</small></div><div class="fc"><span class="lbl">Zinsen bis Ende</span><b class="eur">'+eur(s.intLeft)+'</b><small>statt '+eur(f.intLeft)+'</small></div><div class="fc"><span class="lbl">Ersparnis</span><b class="eur '+amtCls(f.intLeft-s.intLeft)+'">'+eur(f.intLeft-s.intLeft)+"</b><small>an Zinsen</small></div>";
  if(amt>0){simCur={a:a,amt:amt,d:d,yearly:yearly};$("stApply").hidden=false;var pf=a.loan&&a.loan.payFrom&&accById(D,a.loan.payFrom);$("stApply").textContent="Sondertilgung "+(yearly?"jährlich ":"")+"einplanen ("+(pf?"von "+pf.name:"extern")+")"}
}
["stAmt","stDate","stYearly","stRate"].forEach(function(id){$(id).addEventListener("input",renderSim);$(id).addEventListener("change",renderSim)});
$("stApply").addEventListener("click",function(){
  var s=simCur;if(!s)return;var fr=s.a.loan&&accById(D,s.a.loan.payFrom)?s.a.loan.payFrom:"";
  if(s.yearly)D.orders.push({id:newId(),name:"Sondertilgung "+s.a.name,amount:s.amt,from:fr,to:s.a.id,interval:"j",day:+s.d.slice(8,10),start:s.d,end:"",shift:"next",cat:"Sondertilgung",u:now()});
  else{var tr=newId();D.tx.push({id:newId(),acc:s.a.id,date:s.d,amount:s.amt,text:"Sondertilgung",cat:"Sondertilgung",tr:fr?tr:undefined,u:now()});if(fr)D.tx.push({id:newId(),acc:fr,date:s.d,amount:-s.amt,text:"Sondertilgung "+s.a.name,cat:"Sondertilgung",tr:tr,u:now()})}
  $("stAmt").value="";$("stRate").value="";save();renderAll();setMsg("stMsg","Eingeplant: "+eur(s.amt)+(s.yearly?" jährlich ab ":" am ")+dmy(s.d)+".");
});

/* ---------- Finanzplan ---------- */
function planCellInput(gi,ii,m,v){return '<input type="text" inputmode="decimal" data-g="'+gi+'" data-i="'+ii+'" data-m="'+m+'" value="'+(v?esc(num(v)):"")+'" placeholder="0" aria-label="Betrag">'}
function renderPlan(){
  var y=String(ui.planY),p=D.plan[y],tk=todayKey(),cy=tk.slice(0,4),cm=+tk.slice(5,7)-1,ist=ui.planMode==="ist";
  $("plYear").textContent=y;$("planTitle").textContent="Jahresplanung "+y;
  $("plEmpty").hidden=!!p;$("planWrap").hidden=!p;$("plAddRow").hidden=!p;
  var prevYears=Object.keys(D.plan).filter(function(k){return k<y}).sort();$("plCopy").hidden=!prevYears.length&&!Object.keys(D.plan).length;
  if(!p){$("planMeta").textContent="";return}
  var act=document.activeElement,keep=act&&act.closest&&act.closest("#planTable")?{g:act.getAttribute("data-g"),i:act.getAttribute("data-i"),m:act.getAttribute("data-m"),n:act.getAttribute("data-n"),s:act.selectionStart,e:act.selectionEnd}:null;
  var t=planTotals(D,y),h=[],sum=function(a){return a.reduce(function(x,z){return x+z},0)};
  h.push('<thead><tr><th>Posten</th>'+MONs.map(function(m,i){return "<th"+(y===cy&&i===cm?' style="color:var(--accent)"':"")+">"+m+"</th>"}).join("")+"<th>Gesamt</th></tr></thead><tbody>");
  var istCell=function(name,i){if(!ist)return "";var past=y<cy||(y===cy&&i<=cm);if(!past)return '<span class="istv">–</span>';var v=istOf(D,y,name,i);return '<span class="istv">'+(hasIst(D,y,name)?"Ist "+esc(num(v)):"–")+"</span>"};
  ["einnahme","fix","variabel"].forEach(function(kind){
    var tot=kind==="einnahme"?t.inc:kind==="fix"?t.fix:t.vari;
    h.push('<tr class="ksec"><td>'+KLABEL[kind]+"</td>"+tot.map(function(v){return '<td class="v">'+esc(num(v))+"</td>"}).join("")+'<td class="v">'+esc(num(sum(tot)))+"</td></tr>");
    p.groups.forEach(function(g,gi){
      if(g.kind!==kind)return;
      var gs=t.groups[gi].sum;
      h.push('<tr class="ghead"><td><div class="nm"><input class="gname" type="text" value="'+esc(g.name)+'" data-n="g" data-g="'+gi+'" aria-label="Gruppenname"><button class="ib" type="button" data-addi="'+gi+'" title="Posten hinzufügen" aria-label="Posten hinzufügen">+</button><button class="ib x" type="button" data-delg="'+gi+'" title="Gruppe löschen" aria-label="Gruppe löschen">✕</button></div></td>'+gs.map(function(v){return '<td class="v">'+esc(num(v))+"</td>"}).join("")+'<td class="v">'+esc(num(sum(gs)))+"</td></tr>");
      if(kind!=="einnahme")h.push('<tr class="pct"><td><div class="nm" style="padding-left:16px">% der Einnahmen</div></td>'+gs.map(function(v,i){return '<td class="v">'+(t.inc[i]?(v/t.inc[i]*100).toFixed(1).replace(".",",")+" %":"–")+"</td>"}).join("")+'<td class="v">'+(sum(t.inc)?(sum(gs)/sum(t.inc)*100).toFixed(1).replace(".",",")+" %":"–")+"</td></tr>");
      g.items.forEach(function(it,ii){
        var tot2=sum(it.m);
        h.push('<tr><td><div class="nm" style="padding-left:16px"><input type="text" value="'+esc(it.name)+'" data-n="i" data-g="'+gi+'" data-i="'+ii+'" aria-label="Name des Postens"><button class="ib x" type="button" data-deli="'+gi+'|'+ii+'" title="Posten löschen" aria-label="Posten löschen">✕</button></div></td>'+it.m.map(function(v,m){return '<td class="cell">'+planCellInput(gi,ii,m,v)+istCell(it.name,m)+"</td>"}).join("")+'<td class="v">'+esc(num(tot2))+(ist&&hasIst(D,y,it.name)?'<span class="istv">Ist '+esc(num(istOf(D,y,it.name)))+"</span>":"")+"</td></tr>");
      });
    });
  });
  h.push('<tr class="tot"><td><div class="nm">Gesamte Ausgaben</div></td>'+t.out.map(function(v){return '<td class="v">'+esc(num(v))+"</td>"}).join("")+'<td class="v">'+esc(num(sum(t.out)))+"</td></tr>");
  h.push('<tr class="tot res"><td><div class="nm">Monatlicher Überschuss</div></td>'+t.res.map(function(v){return '<td class="v '+amtCls(v)+'">'+esc(num(v))+"</td>"}).join("")+'<td class="v '+amtCls(sum(t.res))+'">'+esc(num(sum(t.res)))+"</td></tr></tbody>");
  $("planTable").innerHTML=h.join("");
  $("planMeta").innerHTML="Überschuss <b>"+esc(eur(sum(t.res),true))+"</b>";
  if(keep){var sel=keep.m!=null?'input[data-g="'+keep.g+'"][data-i="'+keep.i+'"][data-m="'+keep.m+'"]':keep.n==="g"?'input[data-n="g"][data-g="'+keep.g+'"]':'input[data-n="i"][data-g="'+keep.g+'"][data-i="'+keep.i+'"]';var el=$("planTable").querySelector(sel);if(el){el.focus();try{el.setSelectionRange(keep.s,keep.e)}catch(e){}}}
}
var planTimer=null;
function planChanged(){save();clearTimeout(planTimer);planTimer=setTimeout(function(){renderPlan();renderOverview();renderReport();updateCats();renderHead()},0)}
$("planTable").addEventListener("change",function(e){
  var inp=e.target,p=D.plan[String(ui.planY)];if(!p||inp.tagName!=="INPUT")return;
  var g=p.groups[+inp.getAttribute("data-g")];if(!g)return;
  if(inp.getAttribute("data-n")==="g"){var v=inp.value.trim();if(v)g.name=v.slice(0,40);else inp.value=g.name;planChanged();return}
  var it=g.items[+inp.getAttribute("data-i")];if(!it)return;
  if(inp.getAttribute("data-n")==="i"){var n=inp.value.trim();if(n)it.name=n.slice(0,40);else inp.value=it.name;planChanged();return}
  var m=+inp.getAttribute("data-m"),c=inp.value.trim()===""?0:parseEur(inp.value);
  if(c==null){setMsg("planMsg","Bitte einen Betrag wie 49,90 eingeben.",true);inp.value=it.m[m]?num(it.m[m]):"";return}
  c=Math.abs(c);
  if($("plFill").checked){for(var i=m;i<12;i++)it.m[i]=c}else it.m[m]=c;
  setMsg("planMsg","");planChanged();
});
$("planTable").addEventListener("keydown",function(e){if(e.key==="Enter"&&e.target.tagName==="INPUT"){e.preventDefault();e.target.blur();e.target.focus()}});
$("planTable").addEventListener("click",function(e){
  var p=D.plan[String(ui.planY)];if(!p)return;
  var b=e.target.closest("[data-addi]");
  if(b){var g=p.groups[+b.getAttribute("data-addi")];g.items.push({id:newId(),name:"Neuer Posten",m:[0,0,0,0,0,0,0,0,0,0,0,0]});save();renderPlan();var el=$("planTable").querySelector('input[data-n="i"][data-g="'+b.getAttribute("data-addi")+'"][data-i="'+(g.items.length-1)+'"]');if(el){el.focus();el.select()}return}
  b=e.target.closest("[data-deli]");
  if(b){var q=b.getAttribute("data-deli").split("|");if(!b.classList.contains("armed")){b.classList.add("armed");b.textContent="?";b.title="Nochmal klicken zum Löschen";setTimeout(function(){b.classList.remove("armed");b.textContent="✕"},3000);return}p.groups[+q[0]].items.splice(+q[1],1);planChanged();return}
  b=e.target.closest("[data-delg]");
  if(b){if(!b.classList.contains("armed")){b.classList.add("armed");b.textContent="?";b.title="Nochmal klicken: Gruppe mit allen Posten löschen";setTimeout(function(){b.classList.remove("armed");b.textContent="✕"},3000);return}p.groups.splice(+b.getAttribute("data-delg"),1);planChanged()}
});
$("plPrev").addEventListener("click",function(){ui.planY--;renderPlan();renderHead()});
$("plNext").addEventListener("click",function(){ui.planY++;renderPlan();renderHead()});
$("plMode").addEventListener("change",function(e){ui.planMode=e.target.value;renderPlan()});
function clonePlan(src){return {groups:src.groups.map(function(g){return {id:newId(),name:g.name,kind:g.kind,items:g.items.map(function(it){return {id:newId(),name:it.name,m:it.m.slice()}})}})}}
$("plCopy").addEventListener("click",function(){
  var ys=Object.keys(D.plan).filter(function(k){return k<String(ui.planY)}).sort(),src=ys.length?ys[ys.length-1]:Object.keys(D.plan).sort()[0];if(!src)return;
  D.plan[String(ui.planY)]=clonePlan(D.plan[src]);save();renderAll();setMsg("planMsg","Planung aus "+src+" übernommen. Passe die Beträge an.");
});
$("plBlank").addEventListener("click",function(){
  var z=function(){return [0,0,0,0,0,0,0,0,0,0,0,0]};
  D.plan[String(ui.planY)]={groups:[{id:newId(),name:"Einkommen",kind:"einnahme",items:[{id:newId(),name:"Nettogehalt",m:z()}]},{id:newId(),name:"Wohnen",kind:"fix",items:[{id:newId(),name:"Miete",m:z()}]},{id:newId(),name:"Lebensunterhalt",kind:"variabel",items:[{id:newId(),name:"Lebensmittel",m:z()}]}]};
  save();renderAll();
});
$("plAddGroup").addEventListener("click",function(){
  var p=D.plan[String(ui.planY)],n=$("plAddName").value.trim(),k=$("plAddKind").value;if(!p)return;
  if(!n){setMsg("planMsg","Bitte einen Namen für die Gruppe eingeben.",true);$("plAddName").focus();return}
  var idx=-1;p.groups.forEach(function(g,i){if(g.kind===k)idx=i});
  var g={id:newId(),name:n.slice(0,40),kind:k,items:[{id:newId(),name:"Neuer Posten",m:[0,0,0,0,0,0,0,0,0,0,0,0]}]};
  if(idx<0){var order={einnahme:0,fix:1,variabel:2};idx=-1;p.groups.forEach(function(x,i){if(order[x.kind]<order[k])idx=i})}
  p.groups.splice(idx+1,0,g);$("plAddName").value="";save();renderPlan();setMsg("planMsg","Gruppe „"+g.name+"“ angelegt.");
});
$("plDelYear").addEventListener("click",function(){var b=this;armed(b,"Jahr "+ui.planY+" wirklich löschen?",function(){delete D.plan[String(ui.planY)];save();renderAll();setMsg("planMsg","Planung "+ui.planY+" gelöscht.")})});

/* ---------- Kategorien ---------- */
function updateCats(){
  var s={};Object.keys(D.plan).forEach(function(y){D.plan[y].groups.forEach(function(g){g.items.forEach(function(it){s[it.name]=1})})});
  D.orders.forEach(function(o){if(o.cat)s[o.cat]=1});D.tx.forEach(function(t){if(t.cat)s[t.cat]=1});
  $("catList").innerHTML=Object.keys(s).sort(function(a,b){return a.localeCompare(b,"de")}).map(function(c){return '<option value="'+esc(c)+'">'}).join("");
}
