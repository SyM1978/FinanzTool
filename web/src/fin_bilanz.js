/* ---------- Ein- & Ausgaben: Übersicht wie die Excel-Tabelle, mit Info-Karte je Posten und Ändern per Klick ---------- */
var BZ={y:null,m:null,mode:"month",ist:true,fill:false,pin:null,edit:null};
function bzInit(){var t=parseKey(todayKey());if(BZ.y==null){BZ.y=t.getFullYear();BZ.m=t.getMonth()}}
function bzSum(a,from,to){var s=0;for(var i=from;i<=to;i++)s+=+a[i]||0;return s}
/* Bis zu welchem Monat gibt es schon Ist-Werte? (-1 = keiner, 11 = ganzes Jahr) */
function bzIstUntil(y){var t=parseKey(todayKey()),cy=t.getFullYear();return y<cy?11:y>cy?-1:t.getMonth()}
/* Dauerauftrag und Konto zu einem Posten: manuell verknüpft (it.acc) oder über Name/Kategorie gefunden */
function bzLink(it){
  var n=String(it.name||"").trim().toLowerCase(),o=null;
  D.orders.forEach(function(x){if(o)return;if(String(x.cat||"").toLowerCase()===n||String(x.name||"").toLowerCase()===n)o=x});
  var acc=null,auto=null;
  if(o){var to=accById(D,o.to),fr=accById(D,o.from);auto=to&&fr?to:to&&isLoan(to)?to:null}
  if(!auto)D.accounts.forEach(function(a){if(!auto&&a.name.toLowerCase()===n)auto=a});
  if(it.acc==="-")acc=null;else if(it.acc&&accById(D,it.acc))acc=accById(D,it.acc);else acc=auto;
  return {order:o,acc:acc,auto:auto,manual:!!it.acc};
}
function bzVals(it,y){
  var iu=bzIstUntil(y),m=BZ.m,month=BZ.mode==="month";
  var plan=month?(+it.m[m]||0):bzSum(it.m,0,11);
  var hasI=hasIst(D,y,it.name);
  var ist=null,planTo=null;
  if(month){if(m<=iu)ist=hasI?istOf(D,y,it.name,m):0}
  else if(iu>=0){ist=0;for(var i=0;i<=iu;i++)ist+=hasI?istOf(D,y,it.name,i):0;planTo=bzSum(it.m,0,iu)}
  return {plan:plan,ist:ist,cmp:month?plan:planTo,hasI:hasI};
}
/* Differenz: im laufenden Monat ist „noch nicht gebucht“ kein Fehler, sondern offen */
function bzDiffCell(diff,kind,running){
  if(diff==null)return '<td class="r mono">–</td>';
  if(Math.abs(diff)<1)return '<td class="r mono">±0,00</td>';
  var openish=running&&((kind==="einnahme"&&diff<0)||(kind!=="einnahme"&&diff>0));
  if(openish)return '<td class="r mono bzopen" title="Im laufenden Monat noch nicht gebucht">offen '+esc(num(Math.abs(diff)))+"</td>";
  return '<td class="r mono '+(diff>0?"pos":"neg")+'" title="'+(diff>0?"besser als geplant":"schlechter als geplant")+'">'+esc(eur(diff,true)).replace(" €","")+"</td>";
}
function bzRender(){
  if(!$("bzBody"))return;bzInit();
  var y=String(BZ.y),p=D.plan[y],month=BZ.mode==="month",m=BZ.m;
  $("bzLabel").textContent=month?MON[m]+" "+y:"Jahr "+y;
  Array.prototype.forEach.call(document.querySelectorAll('#bzMode input'),function(r){r.checked=r.value===BZ.mode});
  $("bzIst").checked=BZ.ist;$("bzFill").checked=BZ.fill;$("bzFillWrap").hidden=!month;
  $("bzEmpty").hidden=!!p;$("bzWrap").hidden=!p;$("bzKpis").hidden=!p;
  if(!p){$("bzMeta").textContent="";$("bzEmptyY").textContent=y;return}
  var showIst=BZ.ist&&bzIstUntil(+y)>=(month?m:0),running=month&&bzIstUntil(+y)===m;
  var T={einnahme:{p:0,i:0},fix:{p:0,i:0},variabel:{p:0,i:0}},rows=[],incPlan=0;
  p.groups.forEach(function(g){if(g.kind==="einnahme")g.items.forEach(function(it){incPlan+=bzVals(it,y).plan})});
  var cols=showIst?5:3;
  ["einnahme","fix","variabel"].forEach(function(kind){
    var gs=p.groups.map(function(g,gi){return {g:g,gi:gi}}).filter(function(x){return x.g.kind===kind});
    if(!gs.length)return;
    var secRows=[],sp=0,si=0;
    gs.forEach(function(x){
      var gp=0,gi2=0,items=[];
      x.g.items.forEach(function(it,ii){
        var v=bzVals(it,y),L=bzLink(it);gp+=v.plan;gi2+=v.ist||0;
        var diff=v.ist==null?null:(kind==="einnahme"?v.ist-v.cmp:v.cmp-v.ist);
        var share=incPlan?Math.abs(v.plan)/incPlan*100:0;
        var dot=L.acc?'<i class="cdot" style="--c:'+esc(L.acc.color)+'" title="'+esc(L.acc.name)+'"></i>':L.order?'<i class="bzord" title="Dauerauftrag">↻</i>':"";
        items.push('<tr class="bzi" data-g="'+x.gi+'" data-i="'+ii+'" tabindex="0"><td><span class="bzname">'+dot+esc(it.name)+'</span></td>'+
          '<td class="r"><button type="button" class="bzval" data-edit="'+x.gi+'|'+ii+'" title="'+(month?"Klicken zum Ändern":"Ändern in der Monatsansicht")+'">'+esc(num(v.plan))+"</button></td>"+
          (showIst?'<td class="r mono">'+(v.ist==null?"–":esc(num(v.ist)))+"</td>"+bzDiffCell(diff,kind,running)+"":"")+
          '<td class="bzsh"><span class="bzbar"><i style="width:'+Math.min(100,share).toFixed(1)+'%"></i></span><span class="mono">'+(incPlan?share.toFixed(1).replace(".",",")+" %":"–")+"</span></td></tr>");
      });
      sp+=gp;si+=gi2;
      secRows.push('<tr class="bzg"><td>'+esc(x.g.name)+'</td><td class="r mono">'+esc(num(gp))+"</td>"+(showIst?'<td class="r mono">'+esc(num(gi2))+"</td><td></td>":"")+'<td class="bzsh"><span class="mono">'+(incPlan&&kind!=="einnahme"?(gp/incPlan*100).toFixed(1).replace(".",",")+" %":"")+"</span></td></tr>");
      secRows=secRows.concat(items);
    });
    T[kind].p=sp;T[kind].i=si;
    rows.push('<tbody class="bzsec k-'+kind+'"><tr class="bzh"><th>'+KLABEL[kind]+'</th><th class="r">'+esc(eur(sp))+"</th>"+(showIst?'<th class="r">'+esc(eur(si))+"</th><th></th>":"")+'<th class="bzsh">'+(incPlan&&kind!=="einnahme"?(sp/incPlan*100).toFixed(1).replace(".",",")+" %":"")+"</th></tr>"+secRows.join("")+"</tbody>");
  });
  $("bzHead").innerHTML='<tr><th>Posten</th><th class="r">Plan</th>'+(showIst?'<th class="r">Ist'+(month?(bzIstUntil(+y)===m?" bisher":""):" bis heute")+'</th><th class="r" title="'+(month?"Ist gegenüber Plan":"Ist gegenüber Plan bis heute")+'">Differenz</th>':"")+'<th class="bzsh">Anteil an den Einnahmen</th></tr>';
  var tb=$("bzTable");Array.prototype.forEach.call(tb.querySelectorAll("tbody.bzsec"),function(x){x.remove()});
  $("bzBody").insertAdjacentHTML("beforebegin",rows.join(""));
  /* Ergebnis unten wie in der Excel */
  var out={p:T.fix.p+T.variabel.p,i:T.fix.i+T.variabel.i},res={p:T.einnahme.p-out.p,i:T.einnahme.i-out.i};
  var line=function(l,a,b,cls){return '<tr class="'+(cls||"")+'"><td>'+l+'</td><td class="r mono">'+esc(eur(a))+"</td>"+(showIst?'<td class="r mono">'+esc(eur(b))+"</td><td></td>":"")+'<td class="bzsh"></td></tr>'};
  $("bzFoot").innerHTML=line("Einnahmen",T.einnahme.p,T.einnahme.i)+line("− Fixe Ausgaben",-T.fix.p,-T.fix.i)+line("− Variable Ausgaben",-T.variabel.p,-T.variabel.i)+
    '<tr class="bzres"><td>= '+(month?"Monatlicher":"Jährlicher")+' Überschuss</td><td class="r mono '+amtCls(res.p)+'">'+esc(eur(res.p,true))+"</td>"+(showIst?'<td class="r mono '+(running?"bzopen":amtCls(res.i))+'"'+(running?' title="Stand bisher, der Monat läuft noch"':"")+">"+esc(eur(res.i,true))+"</td><td></td>":"")+'<td class="bzsh"><span class="mono">'+(T.einnahme.p?"Sparquote "+(res.p/T.einnahme.p*100).toFixed(1).replace(".",",")+" %":"")+"</span></td></tr>";
  var k=function(l,v,s,c){return '<div class="fc"><span class="lbl">'+l+'</span><b class="eur '+(c||"")+'">'+esc(eur(v))+"</b><small>"+s+"</small></div>"};
  var istS=function(v){return showIst?(running?"Ist bisher ":"Ist ")+esc(eur(v)):(month?"Plan "+MON[m]:"Plan "+y)};
  $("bzKpis").innerHTML=k("Einnahmen",T.einnahme.p,istS(T.einnahme.i),"pos")+k("Fixe Ausgaben",T.fix.p,istS(T.fix.i))+k("Variable Ausgaben",T.variabel.p,istS(T.variabel.i))+
    k("Überschuss",res.p,(T.einnahme.p?"Sparquote "+(res.p/T.einnahme.p*100).toFixed(1).replace(".",",")+" %":"")+(showIst?" · Ist "+esc(eur(res.i,true)):""),amtCls(res.p));
  $("bzMeta").innerHTML="Überschuss <b>"+esc(eur(res.p,true))+"</b>";
  if(BZ.pin)bzShowCard(BZ.pin.g,BZ.pin.i,null,true);
}
/* ---------- Info-Karte ---------- */
function bzCard(gi,ii){
  var y=String(BZ.y),p=D.plan[y],g=p&&p.groups[gi],it=g&&g.items[ii];if(!it)return "";
  var L=bzLink(it),v=bzVals(it,y),month=BZ.mode==="month",h=[];
  h.push('<div class="bzc-h"><b>'+esc(it.name)+'</b><span>'+esc(g.name)+" · "+KLABEL[g.kind]+"</span></div>");
  var iu=bzIstUntil(+y),yp=bzSum(it.m,0,11),yi=0;if(iu>=0)for(var i=0;i<=iu;i++)yi+=istOf(D,y,it.name,i);
  h.push('<div class="bzc-g"><span>Plan '+(month?MON[BZ.m]:y)+'</span><b>'+esc(eur(v.plan))+"</b><span>Ist "+(month?MON[BZ.m]:"bis heute")+"</span><b>"+(v.ist==null?"–":esc(eur(v.ist)))+"</b>"+
    (month?"<span>Plan "+y+"</span><b>"+esc(eur(yp))+"</b><span>Ist "+y+" bis heute</span><b>"+esc(eur(yi))+"</b>":"")+"</div>");
  if(L.acc){
    var a=L.acc,f=forecast(D,a);
    h.push('<div class="bzc-s"><span class="lbl"><i class="cdot" style="--c:'+esc(a.color)+'"></i> '+esc(a.name)+(L.manual?"":" (automatisch erkannt)")+"</span>");
    if(isLoan(a)){h.push('<div class="bzc-big neg">'+esc(eur(Math.max(0,-f.now)))+"</div><small>Restschuld heute"+(f.paid?" · getilgt am "+dmy(f.paid):"")+" · Zinsen bis Ende "+esc(eur(f.intLeft||0))+"</small>")}
    else{
      h.push('<div class="bzc-big '+amtCls(f.now)+'">'+esc(eur(f.now))+"</div><small>Stand heute · Monatsende "+esc(eur(f.month))+"</small>");
      if(a.goal&&a.goal.amount>0){var pc=Math.max(0,Math.min(100,f.now/a.goal.amount*100));h.push('<div class="bzc-goal"><span class="bzbar"><i style="width:'+pc.toFixed(1)+'%"></i></span><small>Sparziel '+esc(eur(a.goal.amount))+" · "+Math.round(pc)+" %"+(f.goalReached?" erreicht":f.goalDate?" · erreicht am "+dmy(f.goalDate):"")+"</small></div>")}
    }
    h.push("</div>");
  }
  if(L.order){
    var o=L.order,nx=nextOcc(o);
    h.push('<div class="bzc-s"><span class="lbl">Dauerauftrag „'+esc(o.name)+"“</span><small>"+esc(eur(o.amount))+" "+INTV[o.interval].label+" · "+esc(accName(o.from))+" → "+esc(accName(o.to))+(nx?" · nächste Ausführung "+dmy(nx):"")+"</small>"+
      (month&&g.kind!=="einnahme"&&INTV[o.interval].n===1&&+it.m[BZ.m]&&+it.m[BZ.m]!==o.amount?'<button type="button" class="btn bzc-btn" data-bzorder="'+gi+"|"+ii+'">Dauerauftrag auf '+esc(eur(+it.m[BZ.m]))+" ändern</button>":"")+"</div>");
  }
  var last=D.tx.filter(function(t){return t.cat&&t.cat.toLowerCase()===it.name.toLowerCase()&&t.date<=todayKey()}).sort(function(a,b){return a.date<b.date?1:-1}).slice(0,3);
  if(last.length)h.push('<div class="bzc-s"><span class="lbl">Letzte Buchungen</span>'+last.map(function(t){return '<div class="bzc-l"><span>'+dm(t.date)+" "+esc(t.text||"")+'</span><b class="mono '+amtCls(t.amount)+'">'+esc(eur(t.amount,true))+"</b></div>"}).join("")+"</div>");
  if(!L.acc&&!L.order&&!last.length)h.push('<p class="bzc-hint">Noch keine Buchungen in der Kategorie „'+esc(it.name)+"“. Buchungen und Daueraufträge mit dieser Kategorie zählen als Ist.</p>");
  if(BZ.pin){
    var opts='<option value="">automatisch'+(L.auto?" ("+esc(L.auto.name)+")":"")+'</option><option value="-">kein Konto</option>'+D.accounts.filter(function(a){return !a.shared}).map(function(a){return '<option value="'+esc(a.id)+'"'+(it.acc===a.id?" selected":"")+">"+esc(a.name)+"</option>"}).join("");
    h.push('<div class="bzc-s bzc-link"><label>Konto zu diesem Posten<select data-bzacc="'+gi+"|"+ii+'">'+opts.replace('value="-"','value="-"'+(it.acc==="-"?" selected":""))+'</select></label><div class="bzc-act">'+(L.acc?'<button type="button" class="btn" data-bzgo="'+esc(L.acc.id)+'">'+(isLoan(L.acc)?"Zum Kredit":"Zum Konto")+"</button>":"")+'<button type="button" class="btn ghost" data-go="plan">Im Finanzplan</button></div></div>');
  } else h.push('<p class="bzc-hint">Klick auf die Zeile hält die Karte fest, Klick auf den Betrag ändert ihn.</p>');
  return h.join("");
}
function bzShowCard(gi,ii,row,pinned){
  var c=$("bzCard");c.innerHTML=bzCard(gi,ii);if(!c.innerHTML){bzHide(true);return}
  c.hidden=false;c.classList.toggle("pinned",!!pinned);
  row=row||document.querySelector('#bzTable tr.bzi[data-g="'+gi+'"][data-i="'+ii+'"]');
  Array.prototype.forEach.call(document.querySelectorAll("#bzTable tr.bzi.on"),function(r){r.classList.remove("on")});if(row)row.classList.add("on");
  if(window.matchMedia("(max-width:720px)").matches||!row){c.classList.add("sheet");c.style.left=c.style.top="";return}
  c.classList.remove("sheet");
  var rr=row.getBoundingClientRect(),cw=c.offsetWidth,ch=c.offsetHeight,vw=document.documentElement.clientWidth,vh=window.innerHeight;
  var x=Math.min(vw-cw-12,Math.max(12,rr.left+Math.min(260,rr.width*0.35))),yy=rr.bottom+6;if(yy+ch>vh-8)yy=Math.max(8,rr.top-ch-6);
  c.style.left=Math.round(x)+"px";c.style.top=Math.round(yy)+"px";
}
function bzHide(force){if(BZ.pin&&!force)return;BZ.pin=null;var c=$("bzCard");if(c)c.hidden=true;Array.prototype.forEach.call(document.querySelectorAll("#bzTable tr.bzi.on"),function(r){r.classList.remove("on")})}
/* ---------- Ändern per Klick ---------- */
function bzStartEdit(gi,ii,btn){
  if(BZ.mode!=="month"){setMsg("bzMsg","Beträge änderst du in der Monatsansicht.");return}
  var it=D.plan[String(BZ.y)].groups[gi].items[ii],m=BZ.m,inp=document.createElement("input");
  inp.type="text";inp.className="bzin amtin";inp.inputMode="decimal";inp.value=it.m[m]?num(it.m[m]):"";inp.setAttribute("aria-label","Plan "+it.name+" "+MON[m]);
  btn.replaceWith(inp);inp.focus();inp.select();bzHide(true);
  var done=false,finish=function(save){
    if(done)return;done=true;
    if(save){
      var c=inp.value.trim()===""?0:parseEur(inp.value);
      if(c==null){setMsg("bzMsg","Bitte einen Betrag wie 49,90 eingeben.",true);bzRender();return}
      c=Math.abs(c);var to=BZ.fill?11:m,old=+it.m[m]||0;for(var i=m;i<=to;i++)it.m[i]=c;
      if(c!==old||BZ.fill){planChanged();setMsg("bzMsg","„"+it.name+"“: "+eur(c)+(BZ.fill&&m<11?" ab "+MON[m]+" bis Dezember":" im "+MON[m])+" gespeichert.")}
    }
    bzRender();
    var nb=document.querySelector('#bzTable [data-edit="'+gi+"|"+ii+'"]');if(nb)nb.focus();
  };
  inp.addEventListener("keydown",function(e){if(e.key==="Enter"){e.preventDefault();finish(true)}else if(e.key==="Escape"){e.preventDefault();finish(false)}else if(e.key==="Tab"){finish(true)}});
  inp.addEventListener("blur",function(){finish(true)});
}
$("bzTable").addEventListener("click",function(e){
  var b=e.target.closest("[data-edit]");if(b){e.stopPropagation();var q=b.getAttribute("data-edit").split("|");bzStartEdit(+q[0],+q[1],b);return}
  var r=e.target.closest("tr.bzi");if(!r||e.target.closest("input"))return;
  var gi=+r.getAttribute("data-g"),ii=+r.getAttribute("data-i");
  if(BZ.pin&&BZ.pin.g===gi&&BZ.pin.i===ii){bzHide(true);return}
  BZ.pin={g:gi,i:ii};bzShowCard(gi,ii,r,true);
});
$("bzTable").addEventListener("keydown",function(e){var r=e.target.closest&&e.target.closest("tr.bzi");if(r&&e.target===r&&(e.key==="Enter"||e.key===" ")){e.preventDefault();r.click()}});
$("bzTable").addEventListener("mouseover",function(e){if(BZ.pin||window.matchMedia("(hover:none)").matches)return;var r=e.target.closest("tr.bzi");if(!r)return;bzShowCard(+r.getAttribute("data-g"),+r.getAttribute("data-i"),r,false)});
$("bzTable").addEventListener("mouseleave",function(){bzHide(false)});
$("bzTable").addEventListener("focusin",function(e){if(BZ.pin)return;var r=e.target.closest&&e.target.closest("tr.bzi");if(r&&e.target===r)bzShowCard(+r.getAttribute("data-g"),+r.getAttribute("data-i"),r,false)});
document.addEventListener("click",function(e){if(BZ.pin&&!e.target.closest("#bzCard")&&!e.target.closest("#bzTable"))bzHide(true)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&!$("bzCard").hidden)bzHide(true)});
window.addEventListener("scroll",function(){if(!$("bzCard").hidden&&!BZ.pin)bzHide(false)},true);
$("bzCard").addEventListener("change",function(e){
  var s=e.target.closest("[data-bzacc]");if(!s)return;var q=s.getAttribute("data-bzacc").split("|"),it=D.plan[String(BZ.y)].groups[+q[0]].items[+q[1]];
  if(s.value)it.acc=s.value;else delete it.acc;planChanged();bzShowCard(+q[0],+q[1],null,true);
});
$("bzCard").addEventListener("click",function(e){
  var g=e.target.closest("[data-bzgo]");if(g){var a=accById(D,g.getAttribute("data-bzgo"));bzHide(true);if(a&&isLoan(a)){ui.loan=a.id;showView("kredite")}else if(a){ui.acc=a.id;showView("konten")}renderAll();return}
  var o=e.target.closest("[data-bzorder]");if(o){var q=o.getAttribute("data-bzorder").split("|"),it=D.plan[String(BZ.y)].groups[+q[0]].items[+q[1]],L=bzLink(it);if(L.order){L.order.amount=+it.m[BZ.m];L.order.u=now();save();renderAll();setMsg("bzMsg","Dauerauftrag „"+L.order.name+"“ auf "+eur(L.order.amount)+" geändert.")}return}
  if(e.target.closest("[data-go]"))bzHide(true);
});
/* ---------- Bedienleiste ---------- */
$("bzPrev").addEventListener("click",function(){if(BZ.mode==="month"){BZ.m--;if(BZ.m<0){BZ.m=11;BZ.y--}}else BZ.y--;bzHide(true);bzRender()});
$("bzNext").addEventListener("click",function(){if(BZ.mode==="month"){BZ.m++;if(BZ.m>11){BZ.m=0;BZ.y++}}else BZ.y++;bzHide(true);bzRender()});
$("bzToday").addEventListener("click",function(){BZ.y=null;bzInit();bzHide(true);bzRender()});
$("bzMode").addEventListener("change",function(e){BZ.mode=e.target.value==="year"?"year":"month";bzHide(true);bzRender()});
$("bzIst").addEventListener("change",function(){BZ.ist=this.checked;bzRender()});
$("bzFill").addEventListener("change",function(){BZ.fill=this.checked});
