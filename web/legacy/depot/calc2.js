/* ===================== Erweiterungen 2.0 (ohne DOM) ===================== */
var PKIND={
  "aktie":{label:"Aktie",tf:0,topf:"aktie"},
  "aktien-etf":{label:"Aktien-ETF / Aktienfonds",tf:0.3,topf:"sonst"},
  "misch":{label:"Mischfonds",tf:0.15,topf:"sonst"},
  "sonst":{label:"Anleihe, Renten-ETF, Sonstiges",tf:0,topf:"sonst"}
};
var SECTORS=["Informationstechnologie","Gesundheitswesen","Finanzen","Industrie","Nicht-Basiskonsumgüter","Basiskonsumgüter","Energie","Grundstoffe","Kommunikation","Versorger","Immobilien"];
var COUNTRY={DE:"Deutschland",US:"USA",FR:"Frankreich",NL:"Niederlande",CH:"Schweiz",GB:"Großbritannien",DK:"Dänemark",SE:"Schweden",FI:"Finnland",IT:"Italien",ES:"Spanien",AT:"Österreich",BE:"Belgien",NO:"Norwegen",JP:"Japan",CN:"China",CA:"Kanada",AU:"Australien",TW:"Taiwan",KR:"Südkorea",KY:"Kaimaninseln",BM:"Bermuda",JE:"Jersey",IL:"Israel",IN:"Indien",BR:"Brasilien"};
var TAXRATE=0.25*1.055; /* Abgeltungsteuer 25 % + Solidaritätszuschlag 5,5 % */
var BENCH={"OV:FUND:IE00B4L5Y983":"iShares Core MSCI World","OV:FUND:DE0005933931":"iShares Core DAX","OV:FUND:IE00BK5BQT80":"Vanguard FTSE All-World"};

function isFundSym(p){return /^OV:FUND:/.test(p.sym||"")||/\b(ETF|UCITS|Fonds|Index)\b/i.test(p.name||"")}
function posKind(p){return PKIND[p.kind]?p.kind:(isFundSym(p)?"aktien-etf":"aktie")}
function posCountry(p){if(p.country)return p.country;if(posKind(p)!=="aktie")return "Weltweit (Fonds)";var cc=String(p.isin||"").slice(0,2).toUpperCase();return COUNTRY[cc]||cc||"unbekannt"}
function posSector(p){return p.sector||(posKind(p)!=="aktie"?"Breit gestreut (Fonds)":"nicht zugeordnet")}
function posDepot(D,p){var d=(D.settings.depots||[]).filter(function(x){return x.id===p.depot})[0];return d?d.name:((D.settings.depots||[])[0]||{name:"Depot"}).name}
function viewOf(D,depotId){return {pos:depotId?D.pos.filter(function(p){return (p.depot||defaultDepot(D))===depotId}):D.pos,quotes:D.quotes,settings:D.settings}}
function defaultDepot(D){var d=(D.settings.depots||[])[0];return d?d.id:""}

/* ---------- FIFO (wie die Bank) ---------- */
function fifo(p){
  var lots=[],ev=[];
  sortTx(p.tx).forEach(function(t){
    if(t.type==="buy"){lots.push({q:+t.qty,c:(+t.qty)*(+t.price)+(+t.fee||0)})}
    else if(t.type==="sell"){
      var q=+t.qty,proceeds=q*(+t.price)-(+t.fee||0),cost=0;
      while(q>1e-12&&lots.length){var l=lots[0],take=Math.min(q,l.q),part=l.c*take/l.q;cost+=part;l.c-=part;l.q-=take;q-=take;if(l.q<1e-12)lots.shift()}
      ev.push({date:t.date,gain:proceeds-cost,proceeds:proceeds,cost:cost});
    }
  });
  return ev;
}

/* ---------- Steuerschätzung je Jahr mit Verlusttöpfen ---------- */
function taxYears(pos,allowance){
  var Y={},yr=function(y){return Y[y]=Y[y]||{akt:0,sonst:0,div:0,divRaw:0,sells:0}};
  pos.forEach(function(p){
    var k=PKIND[posKind(p)];
    fifo(p).forEach(function(e){var o=yr(e.date.slice(0,4));o.sells+=e.gain;if(k.topf==="aktie")o.akt+=e.gain;else o.sonst+=e.gain*(1-k.tf)});
    p.tx.forEach(function(t){if(t.type!=="div")return;var o=yr(t.date.slice(0,4));o.div+=(+t.amount||0)*(1-k.tf);o.divRaw+=+t.amount||0});
  });
  var ys=Object.keys(Y).sort(),out={},carryA=0,carryS=0;
  if(!ys.length)return out;
  for(var y=+ys[0];y<=Math.max(+ys[ys.length-1],+todayKey().slice(0,4));y++){
    var o=Y[y]||{akt:0,sonst:0,div:0,divRaw:0,sells:0},startA=carryA,startS=carryS;
    var akt=o.akt,son=o.sonst+o.div;
    if(akt>0){var u=Math.min(akt,carryA);akt-=u;carryA-=u}            /* alter Aktienverlust nur gegen Aktiengewinne */
    if(son<0){if(akt>0){var u2=Math.min(akt,-son);akt-=u2;son+=u2}carryS+=-son;son=0}  /* sonstige Verluste gegen alles */
    if(akt<0){carryA+=-akt;akt=0}
    var base=akt+son,u3=Math.min(base,carryS);carryS-=u3;base-=u3;
    var used=Math.min(base,allowance||0),taxable=base-used;
    out[y]={aktGains:o.akt,sonstGains:o.sonst,divTaxable:o.div,divRaw:o.divRaw,sells:o.sells,carryStartA:startA,carryStartS:startS,carryA:carryA,carryS:carryS,base:base,allowanceUsed:used,taxable:taxable,tax:taxable*TAXRATE};
  }
  return out;
}

/* ---------- Rendite pro Jahr (XIRR) ---------- */
function xirr(flows){
  if(flows.length<2)return null;
  var pos=flows.some(function(f){return f.a>0}),neg=flows.some(function(f){return f.a<0});if(!pos||!neg)return null;
  var t0=parseKey(flows[0].d),T=flows.map(function(f){return (parseKey(f.d)-t0)/864e5/365});
  if(T[T.length-1]<1/365)return null;
  var npv=function(r){var s=0;for(var i=0;i<flows.length;i++)s+=flows[i].a/Math.pow(1+r,T[i]);return s};
  var lo=-0.9999,hi=10,flo=npv(lo),fhi=npv(hi);if(flo*fhi>0)return null;
  for(var k=0;k<200;k++){var mid=(lo+hi)/2,fm=npv(mid);if(Math.abs(fm)<1e-7)return mid;if(flo*fm<0){hi=mid}else{lo=mid;flo=fm}}
  return (lo+hi)/2;
}
function cashFlows(pos){
  var f=[];
  pos.forEach(function(p){p.tx.forEach(function(t){
    if(t.type==="buy")f.push({d:t.date,a:-((+t.qty)*(+t.price)+(+t.fee||0))});
    else if(t.type==="sell")f.push({d:t.date,a:(+t.qty)*(+t.price)-(+t.fee||0)});
    else if(t.type==="div")f.push({d:t.date,a:+t.amount||0});
  })});
  return f.sort(function(a,b){return a.d<b.d?-1:a.d>b.d?1:0});
}
function perfStats(V,valueNow){
  var f=cashFlows(V.pos),inv=0,back=0;f.forEach(function(x){if(x.a<0)inv-=x.a;else back+=x.a});
  var fl=f.concat([{d:todayKey(),a:valueNow}]);
  return {xirr:valueNow>0||back>0?xirr(fl):null,invested:inv,returned:back,gain:valueNow+back-inv,first:f.length?f[0].d:null};
}
/* Vergleich: Jeder Kauf und Verkauf zum gleichen Datum im Vergleichs-ETF */
function closeOn(h,d){var lo=0,hi=h.length-1,ans=-1;while(lo<=hi){var m=(lo+hi)>>1;if(h[m][0]<=d){ans=m;lo=m+1}else hi=m-1}return ans>=0?h[ans][1]:(h.length?h[0][1]:null)}
function benchSim(V,h){
  if(!h||h.length<2)return null;
  var ev=[];V.pos.forEach(function(p){p.tx.forEach(function(t){if(t.type==="buy")ev.push({d:t.date,a:(+t.qty)*(+t.price)+(+t.fee||0)});else if(t.type==="sell")ev.push({d:t.date,a:-((+t.qty)*(+t.price)-(+t.fee||0))})})});
  ev.sort(function(a,b){return a.d<b.d?-1:1});
  var units=0,steps=[];
  ev.forEach(function(e){var c=closeOn(h,e.d);if(!c)return;units=Math.max(0,units+e.a/c);steps.push({d:e.d,u:units})});
  var last=h[h.length-1][1];
  var unitsAt=function(d){var u=0;for(var i=0;i<steps.length&&steps[i].d<=d;i++)u=steps[i].u;return u};
  var flows=ev.map(function(e){return {d:e.d,a:-e.a}}).concat([{d:todayKey(),a:units*last}]);
  return {value:units*last,units:units,unitsAt:unitsAt,xirr:xirr(flows)};
}

/* ---------- Dividenden: Prognose aus den letzten 12 Monaten ---------- */
function divForecast(V){
  var tk=todayKey(),from=addDays(tk,-365),y=+tk.slice(0,4),out=[];
  V.pos.forEach(function(p){
    var now=walk(p).shares;if(now<=0)return;
    p.tx.forEach(function(t){
      if(t.type!=="div"||t.date<=from||t.date>tk)return;
      var sh=walk(p,t.date).shares||now,per=(+t.amount||0)/sh,m=+t.date.slice(5,7)-1,dd=+t.date.slice(8,10);
      var target=mk(y,m,dd);if(target<=tk)target=mk(y+1,m,dd);
      out.push({p:p,date:target,amount:per*now,basis:t.date});
    });
  });
  return out.sort(function(a,b){return a.date<b.date?-1:1});
}
function divByMonth(V,year){var m=[0,0,0,0,0,0,0,0,0,0,0,0];V.pos.forEach(function(p){p.tx.forEach(function(t){if(t.type==="div"&&t.date.slice(0,4)===String(year))m[+t.date.slice(5,7)-1]+=+t.amount||0})});return m}

/* ---------- Sparpläne ---------- */
function planDue(pl,until){
  var out=[];if(!pl||!isKey(pl.start))return out;
  var st=parseKey(pl.start),y=st.getFullYear(),m=st.getMonth(),step=pl.interval==="q"?3:1,day=+pl.day||1,g=0;
  var occ=mk(y,m,day);if(occ<pl.start){m+=step;occ=mk(y,m,day)}
  while(occ<=until&&(!pl.end||occ<=pl.end)&&g++<600){
    var d=occ,wd=parseKey(d).getDay();if(wd===6)d=addDays(d,2);else if(wd===0)d=addDays(d,1);
    if(d<=until)out.push({occ:occ,d:d});
    m+=step;occ=mk(y,m,day);
  }
  return out;
}
/* bucht fällige Ausführungen; getClose(sym,datum) liefert Kurs in EUR oder null */
function applyPlans(D,getClose){
  var n=0,tk=todayKey();
  (D.plans||[]).forEach(function(pl){
    if(pl.paused)return;var p=D.pos.filter(function(x){return x.id===pl.pos})[0];if(!p)return;
    planDue(pl,tk).forEach(function(o){
      if(p.tx.some(function(t){return t.plan===pl.id&&t.occ===o.occ}))return;
      var px=getClose(p.sym,o.d);if(!px||px<=0)return;
      var amt=Math.max(0,(+pl.amount||0)-(+pl.fee||0));
      p.tx.push({id:newId(),type:"buy",date:o.d,qty:Math.round(amt/px*1e6)/1e6,price:px,fee:+pl.fee||0,amount:0,plan:pl.id,occ:o.occ,u:now()});p.u=now();n++;
    });
  });
  return n;
}

/* ---------- Alarme ---------- */
var ALTYPE={above:"steigt auf",below:"fällt auf",dayDown:"fällt heute um",dayUp:"steigt heute um"};
function alertHit(a,q){
  if(!q||q.price==null)return false;var v=+a.value;
  if(a.type==="above")return q.price>=v;
  if(a.type==="below")return q.price<=v;
  if(!q.prev)return false;var ch=(q.price/q.prev-1)*100;
  if(a.type==="dayDown")return ch<=-Math.abs(v);
  if(a.type==="dayUp")return ch>=Math.abs(v);
  return false;
}

/* ---------- CSV-Import ---------- */
function csvParse(text){
  text=String(text||"").replace(/^﻿/,"");
  var first=text.split(/\r?\n/)[0]||"",cnt=function(c){return first.split(c).length-1};
  var sep=[";","\t",",","|"].sort(function(a,b){return cnt(b)-cnt(a)})[0];
  var rows=[],row=[],cell="",q=false;
  for(var i=0;i<text.length;i++){
    var ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++}else q=false}else cell+=ch;continue}
    if(ch==='"'){q=true;continue}
    if(ch===sep){row.push(cell);cell="";continue}
    if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);cell="";if(row.some(function(c){return c.trim()!==""}))rows.push(row);row=[];continue}
    cell+=ch;
  }
  row.push(cell);if(row.some(function(c){return c.trim()!==""}))rows.push(row);
  return {sep:sep,rows:rows};
}
var CSVF={date:["datum","date","buchungstag","handelstag","ausführungsdatum","valuta","zeit"],isin:["isin"],name:["name","wertpapier","bezeichnung","titel","description","instrument","produkt"],type:["typ","type","art","transaktion","vorgang","transaction"],qty:["stück","stueck","anzahl","menge","shares","quantity","nominale","stk"],price:["kurs","preis","price","ausführungskurs","kurs in eur"],fee:["gebühr","gebühren","fee","fees","provision","entgelt","kosten"],amount:["betrag","amount","wert","gesamt","total","summe"]};
function csvGuess(header){
  var map={};header.forEach(function(h,i){var l=String(h).toLowerCase().trim();Object.keys(CSVF).forEach(function(f){if(map[f]!=null)return;if(CSVF[f].some(function(k){return l===k||l.indexOf(k)===0}))map[f]=i})});
  return map;
}
function csvDate(s){
  s=String(s||"").trim();var m;
  if((m=/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s))){var y=+m[3];if(y<100)y+=2000;return y+"-"+pad(+m[2])+"-"+pad(+m[1])}
  if((m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s)))return m[1]+"-"+m[2]+"-"+m[3];
  if((m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s)))return m[3]+"-"+pad(+m[1])+"-"+pad(+m[2]);
  return null;
}
function csvType(s,qty,amount){
  var l=String(s||"").toLowerCase();
  if(/divid|ertrag|ausschütt|distribution|zins/.test(l))return "div";
  if(/verkauf|sell|veräußer/.test(l))return "sell";
  if(/kauf|buy|sparplan|savings/.test(l))return "buy";
  if(qty!=null&&qty<0)return "sell";
  if(qty!=null&&qty>0)return "buy";
  return null;
}
function csvRows(parsed,map,hasHeader){
  var rows=parsed.rows.slice(hasHeader?1:0),out=[];
  rows.forEach(function(r,i){
    var g=function(f){return map[f]!=null&&map[f]>=0?r[map[f]]:undefined};
    var d=csvDate(g("date")),isin=String(g("isin")||"").trim().toUpperCase(),qty=parseDec(g("qty")),price=parseDec(g("price")),fee=parseDec(g("fee")),amt=parseDec(g("amount"));
    var type=csvType(g("type"),qty,amt);
    var row={line:i+(hasHeader?2:1),date:d,isin:isin,name:String(g("name")||"").trim(),type:type,qty:qty!=null?Math.abs(qty):null,price:price!=null?Math.abs(price):null,fee:fee!=null?Math.abs(fee):0,amount:amt!=null?Math.abs(amt):null};
    if(row.type!=="div"&&row.price==null&&row.qty&&row.amount)row.price=Math.max(0,(row.amount-(row.type==="buy"?row.fee:-row.fee)))/row.qty;
    var err=[];
    if(!d)err.push("Datum");if(!/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin))err.push("ISIN");if(!type)err.push("Art");
    if(type&&type!=="div"&&!(row.qty>0&&row.price>0))err.push("Stück/Kurs");
    if(type==="div"&&!(row.amount>0))err.push("Betrag");
    row.err=err;out.push(row);
  });
  return out;
}
CORE.fifo=fifo;CORE.taxYears=taxYears;CORE.xirr=xirr;CORE.perfStats=perfStats;CORE.benchSim=benchSim;CORE.divForecast=divForecast;CORE.planDue=planDue;CORE.applyPlans=applyPlans;CORE.alertHit=alertHit;CORE.csvParse=csvParse;CORE.csvGuess=csvGuess;CORE.csvRows=csvRows;CORE.posKind=posKind;CORE.posCountry=posCountry;
