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
  value:function(){if(!D||!D.pos.length)return null;var s=depotStats(viewOf(D,""));return Math.round(s.value*100)},
  defaultDepot:function(){return defaultDepot(D)},
  txLabel:function(t){return TXT[t.type]||t.type},
  fmtQty:fmtQty
};
