/* ===================== Finanzen: Schnittstelle ===================== */
if(EMBED){$("repPrint").hidden=true}
function start(){
  var t=new Date();ui.accY=t.getFullYear();ui.accM=t.getMonth();ui.rep={mode:"month",y:t.getFullYear(),m:t.getMonth()};ui.planY=t.getFullYear();
  ui.acc=null;ui.loan=null;ui.editTx=null;ui.editOrd=null;ui.editAcc=null;ui.occ=null;touch();resetForms();
}
return {
  normalize:normalizeData,newData:newData,
  setD:function(d){D=d;CACHE={ver:-1,res:null};touch()},
  start:start,
  render:function(){if(D)renderAll()},
  touch:function(){touch()},
  checkDay:function(){if(D&&CACHE.today&&CACHE.today!==todayKey())renderAll()},
  merge:function(src){if(D.demo)clearDemo();var n=mergeInto(D,src);touch();return n},
  importPlan:function(J,ch){return importPlan(D,J,ch)},
  accounts:function(){return D?D.accounts.filter(function(a){return !isLoan(a)}):[]},
  eur:eur
};
