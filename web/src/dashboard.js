/* =====================================================================
   Dashboard: alle Finanzen auf einen Blick (Konten, Kredite, Plan, Depot)
   ===================================================================== */
var DASH=(function(){
"use strict";
var $=SH.$,esc=SH.esc;
var NF=new Intl.NumberFormat("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2}),NF0=new Intl.NumberFormat("de-DE",{maximumFractionDigits:0}),NFP=new Intl.NumberFormat("de-DE",{minimumFractionDigits:1,maximumFractionDigits:1});
function eur(c,signed){if(c==null||isNaN(c))return "–";var s=NF.format(Math.abs(c)/100)+" €";if(signed)return (Math.round(c)===0?"±":c<0?"−":"+")+s;return (c<0&&Math.round(c)!==0?"−":"")+s}
function eur0(c){return (c<0?"−":"")+NF0.format(Math.abs(c)/100)+" €"}
function pct(v,signed){if(v==null||!isFinite(v))return "–";var s=NFP.format(Math.abs(v*100))+" %";if(signed)return (Math.abs(v)<0.0005?"±":v<0?"−":"+")+s;return (v<0?"−":"")+s}
function cls(v){return v>0?"pos":v<0?"neg":""}
var MONs=["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"],WDs=["So","Mo","Di","Mi","Do","Fr","Sa"];
function dm(k){return k.slice(8,10)+"."+k.slice(5,7)+"."}
function dmy(k){return k?k.slice(8,10)+"."+k.slice(5,7)+"."+k.slice(0,4):"–"}
function wd(k){var p=k.split("-").map(Number);return WDs[new Date(p[0],p[1]-1,p[2]).getDay()]}
var COL={giro:"#1D5F8A",haushalt:"#3F6B3A",spar:"#985A1C",karte:"#7A3E6E",sonst:"#55565B",depot:"#2F6F73"};

function kpi(label,val,sub,go,c){return '<button type="button" class="dbk" data-go="'+go+'"><span class="lbl">'+label+'</span><b class="'+(c||"")+'">'+val+"</b><small>"+(sub||"")+"</small></button>"}

function render(){
  var D=SH._D();if(!D||!FIN||!DEP)return;
  var F=FIN.summary(),P=DEP.summary()||{value:0,n:0};
  var depot=P.n?Math.round(P.value*100):0,cash=0,debt=0,goals=[],loans=[];
  F.accounts.forEach(function(a){if(a.loan){debt+=Math.min(0,a.now);loans.push(a)}else{cash+=a.now;if(a.goal)goals.push(a)}});
  var net=cash+debt+depot;
  /* Kennzahlen */
  var monthNet=F.series[13]?F.series[13].v-F.series[12].v:0;
  $("dbKpis").innerHTML=
    kpi("Nettovermögen",eur0(net),"Konten + Depot − Kredite","uebersicht",cls(net))+
    kpi("Auf den Konten",eur0(cash),"Monatsende "+eur0(cash+F.accounts.reduce(function(s,a){return s+(a.loan?0:a.month-a.now)},0)),"konten")+
    kpi("Depot",P.n?eur0(depot):"–",P.n?'<span class="'+cls(P.day)+'">'+eur(Math.round((P.day||0)*100),true)+" heute ("+pct(P.dayPct,true)+")</span>":"noch keine Positionen","depot")+
    kpi("Kredite",debt?eur0(-debt):"keine",loans.length?loans.length+(loans.length===1?" Kredit":" Kredite")+" offen":"schuldenfrei","kredite",debt?"neg":"pos");
  $("dbStand").textContent="Stand "+dmy(F.tk)+(P.qtime?", Kurse "+new Date(P.qtime).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})+" Uhr":"");
  /* Verlauf */
  var s=F.series,n=s.length-1;
  var pts=s.map(function(p,i){return {x:i/n,v:p.v+depot,fut:p.fut}});
  var xl=s.map(function(p,i){return i%3===0?{x:i/n,t:MONs[+p.k.slice(5,7)-1]+" "+p.k.slice(2,4)}:null}).filter(Boolean);
  $("dbChart").innerHTML=F.accounts.length||depot?FIN.chart(pts,{xl:xl,todayX:12/n,label:"Vermögen im Zeitverlauf"}):'<p class="empty">Sobald Konten oder Depot angelegt sind, erscheint hier der Verlauf.</p>';
  var in12=s[n].v-s[12].v;
  $("dbChartMeta").innerHTML=F.accounts.length?"in 12 Monaten <b class=\""+cls(in12)+"\">"+esc(eur0(in12))+"</b>":"";
  /* Dieser Monat */
  var pl=F.plan;
  if(pl){
    var rate=pl.inc?pl.res/pl.inc:null,ist=pl.istInc-pl.istOut;
    $("dbMonthMeta").textContent=pl.month;
    $("dbMonth").innerHTML='<div class="kpis">'+
      '<div class="fc"><span class="lbl">Einnahmen</span><b>'+eur0(pl.inc)+'</b><small>gebucht '+eur0(pl.istInc)+'</small></div>'+
      '<div class="fc"><span class="lbl">Ausgaben</span><b>'+eur0(pl.out)+'</b><small>gebucht '+eur0(pl.istOut)+'</small></div>'+
      '<div class="fc"><span class="lbl">Überschuss</span><b class="'+cls(pl.res)+'">'+eur(pl.res,true)+'</b><small>Sparquote '+(rate!=null?pct(rate):"–")+'</small></div></div>'+
      '<div class="dbbar" title="Ausgaben im Verhältnis zu den Einnahmen (Plan)"><i style="width:'+Math.max(0,Math.min(100,pl.inc?pl.out/pl.inc*100:0)).toFixed(1)+'%"></i></div>'+
      '<p class="note">Plan '+esc(pl.month)+'. Bisher gebucht: '+eur(ist,true)+'. Im ganzen Jahr plant der Finanzplan '+eur0(pl.yearRes)+' Überschuss. <button type="button" class="linkbtn" data-go="plan">Zum Finanzplan</button></p>';
  } else {
    $("dbMonthMeta").textContent="";
    $("dbMonth").innerHTML='<p class="note">Für dieses Jahr gibt es noch keinen Finanzplan. <button type="button" class="linkbtn" data-go="plan">Finanzplan anlegen</button> oder unter Einstellungen die Excel-Datei importieren.</p>';
  }
  /* Aufteilung */
  var parts={};F.accounts.forEach(function(a){if(a.loan||a.now<=0)return;var k=a.kindLabel;parts[k]=parts[k]||{v:0,c:COL[a.kind]||COL.sonst};parts[k].v+=a.now});
  if(depot>0)parts.Depot={v:depot,c:COL.depot};
  var arr=Object.keys(parts).map(function(k){return {k:k,v:parts[k].v,c:parts[k].c}}).sort(function(a,b){return b.v-a.v}),tot=arr.reduce(function(a,b){return a+b.v},0);
  $("dbSplitBar").innerHTML=arr.map(function(g){return '<i style="flex-grow:'+Math.max(0.0001,g.v)+';--c:'+g.c+'" title="'+esc(g.k)+'"></i>'}).join("");
  $("dbSplitList").innerHTML=arr.map(function(g){return '<li><span class="what"><i class="cdot" style="--c:'+g.c+'"></i> '+esc(g.k)+'</span><span class="mono">'+eur0(g.v)+' · '+(tot?pct(g.v/tot):"–")+"</span></li>"}).join("")+
    (debt?'<li><span class="what"><i class="cdot" style="--c:var(--bad)"></i> Kredite</span><span class="mono neg">'+eur0(debt)+"</span></li>":"")||'<li><span class="what" style="color:var(--muted)">Noch kein Guthaben erfasst.</span></li>';
  $("dbSplitMeta").textContent=tot?"Guthaben "+eur0(tot):"";
  /* Depot */
  if(P.n){
    var mv=function(l){return l.map(function(r){return '<li><button type="button" class="linkrow" data-pos="'+esc(r.id)+'"><span class="what">'+esc(r.name)+'</span><span class="mono '+cls(r.pct)+'">'+pct(r.pct,true)+"</span></button></li>"}).join("")};
    $("dbDepotMeta").innerHTML=P.n+" Positionen"+(P.demo?" · Spielkurse":"");
    $("dbDepot").innerHTML='<div class="kpis">'+
      '<div class="fc"><span class="lbl">Wert</span><b>'+eur0(depot)+'</b><small class="'+cls(P.day)+'">'+eur(Math.round(P.day*100),true)+" heute</small></div>"+
      '<div class="fc"><span class="lbl">Kursgewinn</span><b class="'+cls(P.unreal)+'">'+eur0(Math.round(P.unreal*100))+'</b><small>'+pct(P.unrealPct,true)+' auf den Einstand</small></div>'+
      '<div class="fc"><span class="lbl">Dividenden</span><b>'+eur0(Math.round(P.divYear*100))+'</b><small>erwartet in 12 Monaten</small></div></div>'+
      (P.top.length?'<div class="dbmovers"><div><span class="lbl">Gewinner heute</span><ul class="lst">'+mv(P.top.filter(function(r){return r.pct>0}))+'</ul></div><div><span class="lbl">Verlierer heute</span><ul class="lst">'+mv(P.flop)+"</ul></div></div>":"")+
      (P.alertsHit.length?'<p class="note"><b>Kursalarm erreicht:</b> '+P.alertsHit.map(esc).join(" · ")+' <button type="button" class="linkbtn" data-go="alarme">Ansehen</button></p>':"");
  } else {
    $("dbDepotMeta").textContent="";
    $("dbDepot").innerHTML='<p class="note">Noch keine Wertpapiere. <button type="button" class="linkbtn" data-go="neu">Ersten Kauf erfassen</button></p>';
  }
  /* Kredite & Sparziele */
  var gh="";
  loans.forEach(function(a){var orig=a.orig>0?a.orig:-a.now,p=orig>0?Math.max(0,Math.min(100,Math.round((orig+a.now)/orig*100))):0;
    gh+='<button type="button" class="dbgoal" data-go="kredite"><span class="dbgh"><b>'+esc(a.name)+'</b><span class="mono neg">'+eur0(a.now)+'</span></span><div class="goalbar"><div class="fill" style="width:'+p+'%"></div></div><small>'+p+" % getilgt · "+(a.paid?"schuldenfrei am "+dmy(a.paid):"Tilgungsende offen")+"</small></button>"});
  goals.forEach(function(a){var p=Math.max(0,Math.min(100,Math.round(a.now/a.goal*100)));
    gh+='<button type="button" class="dbgoal" data-go="konten"><span class="dbgh"><b>'+esc(a.name)+'</b><span class="mono">'+eur0(a.now)+" / "+eur0(a.goal)+'</span></span><div class="goalbar"><div class="fill" style="width:'+p+'%"></div></div><small>'+p+" %"+(a.goalReached?" · erreicht":a.goalDate?" · erreicht voraussichtlich am "+dmy(a.goalDate):"")+"</small></button>"});
  var lows=F.accounts.filter(function(a){return a.low&&!a.loan});
  lows.forEach(function(a){gh+='<p class="note neg"><b>'+esc(a.name)+':</b> am '+dmy(a.low.d)+" voraussichtlich "+eur(a.low.bal)+(a.min?" (Warngrenze "+eur0(a.min)+")":"")+".</p>"});
  $("dbGoals").innerHTML=gh||'<p class="note">Keine Kredite und keine Sparziele. Ein Sparziel legst du beim Konto unter Einstellungen › Konten fest.</p>';
  $("dbGoalsMeta").textContent=(loans.length?loans.length+" Kredite":"")+(loans.length&&goals.length?" · ":"")+(goals.length?goals.length+" Ziele":"");
  /* Demnächst */
  var soon=F.soon.map(function(x){x.src="fin";return x}).concat((P.soon||[]).map(function(x){x.src="dep";return x})).sort(function(a,b){return a.d<b.d?-1:a.d>b.d?1:0});
  $("dbSoon").innerHTML=soon.slice(0,14).map(function(x){
    return '<li><span class="when">'+wd(x.d)+" "+dm(x.d)+'</span><span class="what">'+esc(x.t)+"<small>"+esc(x.n)+(x.src==="dep"?" · Depot":"")+'</small></span><span class="eur '+(x.transfer||x.amt==null?"":cls(x.amt))+'">'+(x.amt==null?"":x.transfer?eur(x.amt):eur(x.amt,true))+"</span></li>";
  }).join("")||'<li><span class="what" style="color:var(--muted)">In den nächsten 14 Tagen steht nichts an.</span></li>';
}
document.addEventListener("click",function(e){var b=e.target.closest("[data-pos]");if(!b||!b.closest("#dbDepot"))return;DEP.openPos(b.getAttribute("data-pos"));SH.showView("position")});
return {render:render};
})();
