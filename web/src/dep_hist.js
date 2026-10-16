/* Depotverlauf: Entwicklung im Depotwert-Kasten – Zeitraum, Kennzahlen, Diagramm mit Hover-Info */
var dChartReq=0,DH=null;
var DRANGE={"1w":{src:"1mo",days:7,lbl:"1 Woche"},"1mo":{src:"1mo",days:31,lbl:"1 Monat"},"6mo":{src:"6mo",days:183,lbl:"6 Monate"},
  "ytd":{src:"1y",lbl:"seit Jahresbeginn"},"1y":{src:"1y",days:366,lbl:"1 Jahr"},"5y":{src:"5y",days:1830,lbl:"5 Jahre"},"max":{src:"max",lbl:"seit dem ersten Kauf"}};
function firstBuy(Vv){var f=null;Vv.pos.forEach(function(p){(p.tx||[]).forEach(function(t){if(t.type==="buy"&&(!f||t.date<f))f=t.date})});return f}
function rangeFrom(r,Vv){
  var tk=todayKey(),R=DRANGE[r]||DRANGE["1y"];
  if(r==="ytd")return tk.slice(0,4)+"-01-01";
  if(r==="max"){var f=firstBuy(Vv);return f?addDays(f,-1):addDays(tk,-366)}
  return addDays(tk,-R.days);
}
function histSrc(r,Vv){
  var R=DRANGE[r]||DRANGE["1y"];
  if(r==="max"){var f=firstBuy(Vv),days=f?(parseKey(todayKey())-parseKey(f))/864e5:0;return days<=360?"1y":days<=1800?"5y":"max"}
  return R.src;
}
function getHist2(sym,src,from){
  if(D.demo){var days=Math.ceil((parseKey(todayKey())-parseKey(from))/864e5)+5,k=sym+"|demo"+days;if(!HIST[k])HIST[k]=demoSeries(sym,Math.max(days,40));return Promise.resolve(HIST[k])}
  return getHistory(sym,src);
}
function loadDepotChart(){
  if(!D)return;var Vv=V(),syms=Vv.pos.map(function(p){return p.sym}).filter(function(s,i,a){return a.indexOf(s)===i}),r=DRANGE[ui.dRange]?ui.dRange:"1y",req=++dChartReq;
  var segIn=document.querySelector('#dRange input[value="'+r+'"]');if(segIn)segIn.checked=true;
  if(!syms.length){$("dChart").innerHTML='<p class="empty">Noch keine Positionen.</p>';$("dChartMeta").textContent="";$("devKpis").innerHTML="";DH=null;return}
  var from=rangeFrom(r,Vv),src=histSrc(r,Vv),hist={};
  Promise.all(syms.map(function(s){return getHist2(s,src,from).then(function(h){hist[s]=h}).catch(function(){hist[s]=[]})})).then(function(){
    if(req!==dChartReq||!D)return;
    var ser=depotSeries(V(),hist,from).filter(function(q){return q.v>0||q.c>0});
    if(ser.length<2){$("dChart").innerHTML='<p class="empty">'+(qErr&&qErr.msg?"Ohne Kurs-Server gibt es keinen Verlauf.":"Für diesen Zeitraum gibt es noch keinen Verlauf.")+"</p>";$("dChartMeta").textContent="";$("devKpis").innerHTML="";DH=null;return}
    var a=ser[0].d,b=ser[ser.length-1].d,span=Math.max(1,(parseKey(b)-parseKey(a))/864e5);
    var x=function(d){return (parseKey(d)-parseKey(a))/864e5/span};
    var pts=ser.map(function(q){return {x:x(q.d),v:Math.round(q.v*100)}}),cost=ser.map(function(q){return {x:x(q.d),v:Math.round(q.c*100)}});
    var xl=ticksFor(a,b,x);
    DH={ser:ser,x:x,bench:null,r:r};
    var draw=function(bench){DH.bench=bench;$("dChart").innerHTML=lineChart(pts,{xl:xl,label:"Entwicklung des Depots, "+DRANGE[r].lbl,zero:false,cost:cost,bench:bench})};
    draw(null);devKpis(ser,r);
    var bs=D.settings.benchmark;$("benchLbl").textContent=BENCH[bs]||"Vergleich";$("benchLeg").hidden=!bs;
    if(bs)getHistory(bs,"max").then(function(hb){if(req!==dChartReq||!hb||hb.length<2)return;var sim=benchSim(V(),hb);if(!sim)return;var bv=ser.map(function(q){return {x:x(q.d),v:Math.round(sim.unitsAt(q.d)*closeOn(hb,q.d)*100)}});draw(bv);DH.benchV=bv}).catch(function(){});
  });
}
function devKpis(ser,r){
  var d0=ser[0],d1=ser[ser.length-1],chg=d1.v-d0.v,inv=d1.c-d0.c,perf=(d1.v-d1.c)-(d0.v-d0.c);
  var base=d0.v>0?d0.v+Math.max(0,inv)/2:Math.max(1,d1.c/2+d0.c/2),pp=base>0?perf/base:null;
  var hi=ser[0],lo=ser[0];ser.forEach(function(q){if(q.v>hi.v)hi=q;if(q.v<lo.v)lo=q});
  var k=function(l,v,s,cls){return '<div class="fc"><span class="lbl">'+l+'</span><b class="eur '+(cls||"")+'">'+v+"</b><small>"+s+"</small></div>"};
  $("devKpis").innerHTML=
    k("Veränderung",esc(money(chg,true)),"von "+esc(money(d0.v))+" auf "+esc(money(d1.v)),gvCls(chg))+
    k("Kursentwicklung",esc(money(perf,true)),(pp!=null?'<span class="'+gvCls(perf)+'"><strong>'+esc(pct(pp,true))+"</strong></span> · ":"")+"ohne Käufe und Verkäufe",gvCls(perf))+
    k("Käufe − Verkäufe",esc(money(inv,true)),"zum Einstand im Zeitraum","")+
    k("Höchststand",esc(money(hi.v)),"am "+dmy(hi.d)+" · Tief "+esc(money(lo.v))+" am "+dmy(lo.d),"");
  $("dChartMeta").innerHTML=esc(DRANGE[r].lbl)+': <b class="'+gvCls(perf)+'">'+esc(money(perf,true))+"</b>";
}
/* Hover-Info im Diagramm: Datum, Depotwert, Einstand, Gewinn */
function devHover(e){
  if(!DH)return;var svg=$("dChart").querySelector("svg");if(!svg)return;
  var rc=svg.getBoundingClientRect(),cx=e.clientX!=null?e.clientX:(e.touches&&e.touches[0]?e.touches[0].clientX:null);if(cx==null)return;
  var vx=(cx-rc.left)/rc.width*640,fx=(vx-70)/(640-70-18);if(fx<-0.03||fx>1.03){devHoverOff();return}
  var ser=DH.ser,best=0,bd=9;ser.forEach(function(q,i){var dd=Math.abs(DH.x(q.d)-fx);if(dd<bd){bd=dd;best=i}});
  var act=svg.querySelector("polyline.act");if(!act)return;var pp=act.getAttribute("points").split(" ")[best];if(!pp)return;var xy=pp.split(",").map(Number);
  var g=svg.querySelector("g.hov");if(!g){g=document.createElementNS("http://www.w3.org/2000/svg","g");g.setAttribute("class","hov");g.innerHTML='<line y1="18" y2="220"></line><circle r="5"></circle>';svg.appendChild(g)}
  var ln=g.querySelector("line"),ci=g.querySelector("circle");ln.setAttribute("x1",xy[0]);ln.setAttribute("x2",xy[0]);ci.setAttribute("cx",xy[0]);ci.setAttribute("cy",xy[1]);
  var q=ser[best],gv=q.v-q.c,tip=$("devTip"),bv=DH.benchV&&DH.benchV[best];
  tip.innerHTML="<b>"+dmy(q.d)+'</b><span>Depotwert <b class="mono">'+esc(money(q.v))+'</b></span><span>Einstand <b class="mono">'+esc(money(q.c))+'</b></span><span>Gewinn <b class="mono '+gvCls(gv)+'">'+esc(money(gv,true))+"</b>"+(q.c>0?" ("+esc(pct(gv/q.c,true))+")":"")+"</span>"+(bv?'<span>'+esc($("benchLbl").textContent)+' <b class="mono">'+esc(money(bv.v/100))+"</b></span>":"");
  tip.hidden=false;
  var box=$("dChart").getBoundingClientRect(),px=xy[0]/640*rc.width+rc.left-box.left,tw=tip.offsetWidth;
  tip.style.left=Math.max(0,Math.min(box.width-tw,px+(px>box.width/2?-tw-14:14)))+"px";tip.style.top="8px";
}
function devHoverOff(){var t=$("devTip");if(t)t.hidden=true;var g=$("dChart").querySelector("g.hov");if(g)g.remove()}
$("dChart").addEventListener("pointermove",devHover);
$("dChart").addEventListener("pointerdown",devHover);
$("dChart").addEventListener("pointerleave",devHoverOff);
