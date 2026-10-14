/* ===================== Depot: Schnittstelle ===================== */
function start(){ui.pos=null;ui.editTx=null;ui.sel=null;ui.repY=new Date().getFullYear();ui.depot="";HIST={};qErr=null;lastFetch=0;resetForms()}
return {
  normalize:normalizeData,newData:newData,
  setD:function(d){D=d},
  start:start,
  render:function(){if(D)renderAll()},
  onView:function(v,a){curView=v;VIEWHOOKS.forEach(function(f){f(v,a)})},
  refresh:function(){refreshQuotes()},
  tick:function(){if(!D)return;var rf=(+D.settings.refresh||0)*60000;if(rf&&!document.hidden&&Date.now()-lastFetch>rf)refreshQuotes()},
  merge:function(src){if(D.demoDepot)clearDemo();var n=mergeInto(D,src);
    ((src.settings&&src.settings.depots)||[]).forEach(function(x){if(x&&x.id&&!D.settings.depots.some(function(y){return y.id===x.id})){D.settings.depots.push({id:x.id,name:String(x.name||"Depot").slice(0,30)});n.added++}});
    return n},
  summary:function(){
    if(!D)return null;var s=depotStats(viewOf(D,"")),act=s.rows.filter(function(r){return r.shares>0});
    var tk=todayKey(),to=addDays(tk,14),soon=[];
    divForecast(viewOf(D,"")).forEach(function(f){if(f.date>=tk&&f.date<=to)soon.push({d:f.date,t:"Dividende erwartet",n:f.p.name,amt:Math.round(f.amount*100)})});
    (D.plans||[]).forEach(function(pl){if(pl.paused)return;var p=D.pos.filter(function(x){return x.id===pl.pos})[0];if(!p)return;planDue(pl,to).forEach(function(o){if(o.d>tk)soon.push({d:o.d,t:"Sparplan-Rate",n:p.name,amt:-Math.round(pl.amount*100)})})});
    (D.events||[]).forEach(function(e){if(e.date>=tk&&e.date<=to)soon.push({d:e.date,t:e.title,n:"Termin",amt:null})});
    var movers=act.filter(function(r){return r.dayPct!=null}).sort(function(a,b){return b.dayPct-a.dayPct});
    var fc=divForecast(viewOf(D,"")).reduce(function(a,f){return a+f.amount},0);
    var hits=(D.alerts||[]).filter(function(a){return alertHit(a,D.quotes[a.sym])});
    return {n:act.length,value:s.value,day:s.day,dayPct:s.dayPct,unreal:s.unreal,unrealPct:s.unrealPct,cost:s.cost,total:s.total,divs:s.divs,
      top:movers.slice(0,3).map(function(r){return {id:r.p.id,name:r.p.name,pct:r.dayPct}}),flop:movers.slice(-3).reverse().filter(function(r){return r.dayPct<0}).map(function(r){return {id:r.p.id,name:r.p.name,pct:r.dayPct}}),
      divYear:fc,soon:soon,alertsHit:hits.map(function(a){return a.name+" "+ALTYPE[a.type]+" "+alertValTxt(a)}),qtime:D.qtime,demo:!!D.demoDepot};
  },
  openPos:function(id){ui.pos=id;resetTx();renderPosition()},
  value:function(){if(!D||!D.pos.length)return null;var s=depotStats(viewOf(D,""));return Math.round(s.value*100)},
  defaultDepot:function(){return defaultDepot(D)},
  txLabel:function(t){return TXT[t.type]||t.type},
  fmtQty:fmtQty
};
