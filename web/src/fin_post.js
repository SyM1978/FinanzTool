/* ===================== Finanzen: Schnittstelle ===================== */
if(EMBED){$("repPrint").hidden=true}
function start(){
  var t=new Date();ui.accY=t.getFullYear();ui.accM=t.getMonth();ui.rep={mode:"month",y:t.getFullYear(),m:t.getMonth()};ui.planY=t.getFullYear();
  ui.acc=null;ui.loan=null;ui.editTx=null;ui.editOrd=null;ui.editAcc=null;ui.occ=null;touch();resetForms();
}
/* ---------- Zahlen für das Dashboard ---------- */
function summary(){
  var res=compute(D),tk=todayKey(),t=parseKey(tk),y=t.getFullYear(),m=t.getMonth(),out={accounts:[],tk:tk};
  D.accounts.forEach(function(a){
    if(loanGone(a))return;
    var f=forecast(D,a);
    out.accounts.push({id:a.id,name:a.name,kind:a.kind,kindLabel:KINDS[a.kind],color:a.color,loan:isLoan(a),now:f.now,month:f.month,year:f.year,
      paid:f.paid,orig:a.loan&&a.loan.orig||(isLoan(a)?-a.start.amount:0),goal:a.goal&&a.goal.amount>0?a.goal.amount:0,goalDate:f.goalDate,goalReached:!!f.goalReached,
      low:f.low||null,min:+a.min||0,rate:a.loan&&a.loan.rate||0});
  });
  /* Vermögensverlauf der Konten (inkl. Kredite): Monatsenden 12 zurück bis 12 voraus */
  var pts=[];
  for(var i=-12;i<=12;i++){
    var key=i===0?tk:mk(y,m+i,31),v=0;
    D.accounts.forEach(function(a){v+=balAt(res.acc[a.id],key)});
    pts.push({k:key,v:v,fut:i>0});
  }
  out.series=pts;
  /* Finanzplan dieses Monats, Plan gegen Ist */
  if(D.plan[y]){
    var pt=planTotals(D,y),ii=0,io=0;
    D.plan[y].groups.forEach(function(g){g.items.forEach(function(it){var v=istOf(D,y,it.name,m);if(g.kind==="einnahme")ii+=v;else io+=v})});
    out.plan={month:MON[m]+" "+y,inc:pt.inc[m],out:pt.out[m],res:pt.res[m],istInc:ii,istOut:io,yearRes:pt.res.reduce(function(a,b){return a+b},0)};
  }
  /* Demnächst: 14 Tage */
  var to=addDays(tk,14),list=[],ord={};D.orders.forEach(function(o){ord[o.id]=o});
  D.accounts.forEach(function(a){res.acc[a.id].ev.forEach(function(e){
    if(e.d<tk||e.d>to||e.k==="start"||e.pre||e.skip||!e.a)return;
    if(e.oid&&ord[e.oid]){var o=ord[e.oid],prim=accById(D,o.from)?o.from:o.to;if(a.id!==prim)return}
    else if(e.tr&&e.a>0)return;
    var tr=e.other&&accById(D,e.other);
    list.push({d:e.d,t:e.t,n:tr?a.name+" → "+accName(e.other):a.name,amt:tr?Math.abs(e.a):e.a,transfer:!!tr});
  })});
  out.soon=list;
  return out;
}
function chart(pts,o){return lineChart(pts,o)}
return {
  chart:chart,dm:dm,dmy:dmy,
  normalize:normalizeData,newData:newData,
  setD:function(d){D=d;CACHE={ver:-1,res:null};touch()},
  start:start,
  render:function(){if(D)renderAll()},
  touch:function(){touch()},
  checkDay:function(){if(D&&CACHE.today&&CACHE.today!==todayKey())renderAll()},
  merge:function(src){if(D.demo)clearDemo();var n=mergeInto(D,src);touch();return n},
  importPlan:function(J,ch){return importPlan(D,J,ch)},
  accounts:function(){return D?D.accounts.filter(function(a){return !isLoan(a)&&!a.shared}):[]},
  own:function(){return D?D.accounts.filter(function(a){return !a.shared}):[]},
  summary:summary,
  eur:eur
};
