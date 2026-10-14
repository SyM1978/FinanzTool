/* ===================== Depot-Rechenkern (ohne DOM) ===================== */
var NF4=new Intl.NumberFormat("de-DE",{minimumFractionDigits:2,maximumFractionDigits:4});
var NFQ=new Intl.NumberFormat("de-DE",{maximumFractionDigits:6});
var NFP=new Intl.NumberFormat("de-DE",{minimumFractionDigits:1,maximumFractionDigits:1});
function money(v,signed){return eur(Math.round((+v||0)*100),signed)}
function money0(v){return eur0(Math.round((+v||0)*100))}
function pct(v,signed){if(v==null||!isFinite(v))return "–";var s=NFP.format(Math.abs(v*100))+" %";if(signed){if(Math.abs(v)<0.0005)return "±"+s;return (v<0?"−":"+")+s}return (v<0?"−":"")+s}
function fmtQty(q){return NFQ.format(q)}
var CURSYM={EUR:"€",USD:"$",GBP:"£",GBp:"p",CHF:"CHF",JPY:"¥",DKK:"DKK",SEK:"SEK",NOK:"NOK",CAD:"CA$",AUD:"A$",HKD:"HK$"};
function fmtPx(v,cur){if(v==null||!isFinite(v))return "–";return NF4.format(v)+" "+(CURSYM[cur]||cur||"€")}
function parseDec(str){
  if(str==null)return null;
  var s=String(str).replace(/[€$\s ]/g,"").replace("−","-");if(!s)return null;
  var neg=false;if(s[0]==="-"){neg=true;s=s.slice(1)}
  if(s.indexOf(",")>=0)s=s.replace(/\./g,"").replace(",",".");
  else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,"");
  else if(/^\d{1,3}\.\d{3}$/.test(s))s=s.replace(".","");
  if(!/^\d+(\.\d+)?$/.test(s))return null;
  var v=parseFloat(s);return neg?-v:v;
}
var TXT={buy:"Kauf",sell:"Verkauf",div:"Dividende"};

function newData(){var dep=newId();return {settings:{scheme:"smooth",compact:false,collapsed:{},autoLock:15,lastBackup:null,api:"api/",refresh:5,allowance:1000,depots:[{id:dep,name:"Mein Depot"}],benchmark:"OV:FUND:IE00B4L5Y983",alertKey:"",alertEmail:"",alertSync:0},pos:[],watch:[],alerts:[],plans:[],events:[],quotes:{},qtime:0,demo:false}}
function normalizeData(o){
  var d=newData();if(!o||typeof o!=="object")return d;
  d.settings=Object.assign(d.settings,o.settings||{});
  if(!d.settings.collapsed||typeof d.settings.collapsed!=="object")d.settings.collapsed={};
  if(["smooth","nordsee","salbei","pflaume"].indexOf(d.settings.scheme)<0)d.settings.scheme="smooth";
  d.pos=Array.isArray(o.pos)?o.pos.filter(function(p){return p&&p.id&&p.sym}).map(function(p){p.tx=Array.isArray(p.tx)?p.tx.filter(function(t){return t&&t.id&&isKey(t.date)&&TXT[t.type]}):[];return p}):[];
  d.quotes=o.quotes&&typeof o.quotes==="object"?o.quotes:{};d.qtime=+o.qtime||0;d.demo=!!o.demo;
  ["watch","alerts","plans","events"].forEach(function(k){d[k]=Array.isArray(o[k])?o[k].filter(function(x){return x&&x.id}):[]});
  if(!Array.isArray(d.settings.depots)||!d.settings.depots.length)d.settings.depots=[{id:newId(),name:"Mein Depot"}];
  if(!d.settings.benchmark)d.settings.benchmark="OV:FUND:IE00B4L5Y983";
  return d;
}
function touch(){}

/* Bestand, Einstand (Durchschnittsmethode), realisierte Gewinne und Dividenden */
var ORD={buy:0,div:1,sell:2};
function sortTx(tx){return tx.slice().sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:ORD[a.type]-ORD[b.type]})}
function walk(p,until){
  var sh=0,cost=0,real=0,divs=0,fees=0,buys=0,sells=0,first=null,steps=[],ev=[];
  sortTx(p.tx).forEach(function(t){
    if(until&&t.date>until)return;
    var q=+t.qty||0,px=+t.price||0,fee=+t.fee||0;
    if(t.type==="buy"){sh+=q;cost+=q*px+fee;buys+=q*px+fee;fees+=fee;if(!first)first=t.date}
    else if(t.type==="sell"){var avg=sh>0?cost/sh:0,q2=Math.min(q,sh),g=q2*px-fee-avg*q2;real+=g;cost-=avg*q2;sh-=q2;sells+=q2*px-fee;fees+=fee;ev.push({date:t.date,type:"sell",gain:g,amount:q2*px-fee});if(sh<1e-9){sh=0;cost=0}}
    else if(t.type==="div"){divs+=+t.amount||0;ev.push({date:t.date,type:"div",gain:+t.amount||0,amount:+t.amount||0})}
    steps.push({date:t.date,sh:sh,cost:cost});
  });
  return {shares:sh,cost:cost,avg:sh>0?cost/sh:0,realized:real,divs:divs,fees:fees,buys:buys,sells:sells,first:first,steps:steps,ev:ev};
}
/* Umrechnung in Euro: Kurs × Faktor. GBp = Pence. */
function fxRate(D,cur){
  if(!cur||cur==="EUR")return 1;
  if(cur==="GBp"||cur==="GBX"){var g=D.quotes["GBPEUR=X"];return g?g.price/100:null}
  var q=D.quotes[cur.toUpperCase()+"EUR=X"];return q?q.price:null;
}
function fxSyms(D){var s={};D.pos.forEach(function(p){var q=D.quotes[p.sym],c=q&&q.currency;if(!c||c==="EUR")return;s[(c==="GBp"||c==="GBX"?"GBP":c.toUpperCase())+"EUR=X"]=1});return Object.keys(s)}
function posStats(D,p){
  var w=walk(p),q=D.quotes[p.sym]||null,fx=q?fxRate(D,q.currency):null;
  var r=Object.assign({},w,{quote:q,fx:fx,price:q?q.price:null,cur:q?q.currency:null});
  if(q&&fx!=null){
    r.priceEUR=q.price*fx;r.value=w.shares*r.priceEUR;
    r.day=q.prev?w.shares*(q.price-q.prev)*fx:0;r.dayPct=q.prev?q.price/q.prev-1:null;
  } else {r.priceEUR=null;r.value=w.cost;r.day=0;r.dayPct=null;r.noQuote=true}
  r.unreal=r.value-w.cost;r.unrealPct=w.cost>0?r.unreal/w.cost:null;
  r.total=r.unreal+w.realized+w.divs;
  return r;
}
function depotStats(D){
  var t={value:0,cost:0,day:0,unreal:0,realized:0,divs:0,rows:[],missing:0};
  D.pos.forEach(function(p){var s=posStats(D,p);s.p=p;t.rows.push(s);t.value+=s.value;t.cost+=s.cost;t.day+=s.day;t.unreal+=s.unreal;t.realized+=s.realized;t.divs+=s.divs;if(s.noQuote&&s.shares>0)t.missing++});
  t.total=t.unreal+t.realized+t.divs;t.unrealPct=t.cost>0?t.unreal/t.cost:null;var prev=t.value-t.day;t.dayPct=prev>0?t.day/prev:null;
  t.rows.sort(function(a,b){return (b.shares>0)-(a.shares>0)||b.value-a.value});
  return t;
}
function yearStats(D,y){
  var r={divs:0,realized:0,buys:0,sells:0,rows:[]};
  D.pos.forEach(function(p){
    walk(p).ev.forEach(function(e){if(e.date.slice(0,4)!==String(y))return;if(e.type==="div")r.divs+=e.amount;else{r.realized+=e.gain;r.sells+=e.amount}});
    p.tx.forEach(function(t){if(t.date.slice(0,4)!==String(y))return;if(t.type==="buy")r.buys+=(+t.qty)*(+t.price)+(+t.fee||0);r.rows.push({p:p,t:t})});
  });
  r.rows.sort(function(a,b){return a.t.date<b.t.date?1:-1});
  return r;
}
/* Depotverlauf aus Schlusskursen: Bestand je Tag × Kurs × heutiger Wechselkurs */
function depotSeries(D,hist,from){
  var dates={};Object.keys(hist).forEach(function(s){(hist[s]||[]).forEach(function(x){if(x[0]>=from)dates[x[0]]=1})});
  var ds=Object.keys(dates).sort(),out=[];
  var st=D.pos.map(function(p){var h=hist[p.sym]||[],q=D.quotes[p.sym];return {p:p,h:h,i:0,steps:walk(p).steps,j:0,fx:q?fxRate(D,q.currency):1}});
  ds.forEach(function(d){
    var v=0,c=0,ok=false;
    st.forEach(function(s){
      while(s.j<s.steps.length&&s.steps[s.j].date<=d)s.j++;
      var cur=s.j?s.steps[s.j-1]:null;if(!cur||cur.sh<=0)return;
      while(s.i<s.h.length&&s.h[s.i][0]<=d)s.i++;
      var px=s.i?s.h[s.i-1][1]:null;if(px==null)return;
      v+=cur.sh*px*(s.fx||1);c+=cur.cost;ok=true;
    });
    if(ok)out.push({d:d,v:v,c:c});
  });
  return out;
}
/* Zusammenführen: neuere Position gewinnt, Buchungen werden vereinigt */
function mergeInto(D,src){
  var n={added:0,updated:0};
  (src.pos||[]).forEach(function(x){
    var a=D.pos.filter(function(p){return p.id===x.id})[0];
    if(!a){D.pos.push(JSON.parse(JSON.stringify(x)));n.added++;return}
    if((+x.u||0)>(+a.u||0)){a.name=x.name;a.sym=x.sym;a.isin=x.isin;a.note=x.note;a.u=x.u;n.updated++}
    (x.tx||[]).forEach(function(t){var i=-1;a.tx.forEach(function(u,k){if(u.id===t.id)i=k});if(i<0){a.tx.push(JSON.parse(JSON.stringify(t)));n.added++}else if((+t.u||0)>(+a.tx[i].u||0)){a.tx[i]=JSON.parse(JSON.stringify(t));n.updated++}});
  });
  ["watch","alerts","plans","events"].forEach(function(k){D[k]=D[k]||[];(src[k]||[]).forEach(function(x){var i=-1;D[k].forEach(function(u,j){if(u.id===x.id)i=j});if(i<0){D[k].push(JSON.parse(JSON.stringify(x)));n.added++}else if((+x.u||0)>(+D[k][i].u||0)){D[k][i]=JSON.parse(JSON.stringify(x));n.updated++}})});
  return n;
}

/* ---------- Spielkurse für Beispieldaten und Vorschau (ohne Kurs-Server) ---------- */
var DEMO={"SAP.DE":["SAP SE",214,"EUR"],"ALV.DE":["Allianz SE",352,"EUR"],"SIE.DE":["Siemens AG",228,"EUR"],"MBG.DE":["Mercedes-Benz Group AG",58.4,"EUR"],"EUNL.DE":["iShares Core MSCI World UCITS ETF",104.2,"EUR"],"VWRL.AS":["Vanguard FTSE All-World UCITS ETF",128.6,"EUR"],"AAPL":["Apple Inc.",236,"USD"],"MSFT":["Microsoft Corporation",468,"USD"],"USDEUR=X":["USD/EUR",0.917,"EUR"],"GBPEUR=X":["GBP/EUR",1.19,"EUR"]};
function hashStr(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function rng(seed){var a=seed>>>0;return function(){a=(a+0x6D2B79F5)>>>0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}
function demoBase(s){if(DEMO[s])return DEMO[s];var r=rng(hashStr(s));return [s,Math.round((15+r()*285)*100)/100,"EUR"]}
function demoSeries(s,days){
  var b=demoBase(s),r=rng(hashStr(s+"series")),v=b[1]*0.72,out=[],d=addDays(todayKey(),-days),tk=todayKey(),g=0;
  while(d<=tk&&g++<4000){var wd=parseKey(d).getDay();if(wd&&wd<6){var u=Math.max(1e-9,r()),u2=r(),z=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*u2);v*=1+0.0006+0.013*z;out.push([d,v])}d=addDays(d,1)}
  var k=b[1]/out[out.length-1][1];return out.map(function(x){return [x[0],Math.round(x[1]*k*10000)/10000]});
}
function demoQuote(s){var b=demoBase(s),h=demoSeries(s,10);return {price:h[h.length-1][1],prev:h[h.length-2][1],currency:b[2],name:b[0],time:Math.floor(Date.now()/1000),exchange:"DEMO"}}
function demoSearch(q){q=q.toLowerCase();var r=Object.keys(DEMO).filter(function(k){return k.indexOf("=X")<0&&(k.toLowerCase().indexOf(q)>=0||DEMO[k][0].toLowerCase().indexOf(q)>=0)}).map(function(k){return {symbol:k,name:DEMO[k][0],exchange:"Beispiel",type:"EQUITY"}});return r}
function seedDemo(D){
  var tk=todayKey(),T=function(type,date,qty,price,fee,amount){return {id:newId(),type:type,date:date,qty:qty,price:price,fee:fee||0,amount:amount||0,u:1}};
  var ago=function(m,d){var t=parseKey(tk);return mk(t.getFullYear(),t.getMonth()-m,d||15)};
  var etf=[];for(var i=30;i>=1;i--)etf.push(T("buy",ago(i,2),Math.round(100/(demoSeries("EUNL.DE",i*31+5)[0][1])*10000)/10000,demoSeries("EUNL.DE",i*31+5)[0][1],0));
  D.pos=[
    {id:"d1",name:"SAP SE",sym:"SAP.DE",isin:"DE0007164600",u:1,tx:[T("buy",ago(26),20,118.4,4.9),T("buy",ago(14),10,171.2,4.9),T("div",ago(5,20),0,0,0,32.4)]},
    {id:"d2",name:"Allianz SE",sym:"ALV.DE",isin:"DE0008404005",u:1,tx:[T("buy",ago(20),12,231.5,4.9),T("div",ago(5,10),0,0,0,111.6)]},
    {id:"d3",name:"iShares Core MSCI World",sym:"EUNL.DE",isin:"IE00B4L5Y983",u:1,tx:etf},
    {id:"d4",name:"Apple Inc.",sym:"AAPL",isin:"US0378331005",u:1,tx:[T("buy",ago(18),8,172.3,4.9)]},
    {id:"d5",name:"Mercedes-Benz Group",sym:"MBG.DE",isin:"DE0007100000",u:1,tx:[T("buy",ago(28),40,66.1,4.9),T("sell",ago(8),15,61.8,4.9),T("div",ago(6,12),0,0,0,140)]}
  ];
  D.demo=true;
}
var CORE={walk:walk,posStats:posStats,depotStats:depotStats,yearStats:yearStats,depotSeries:depotSeries,parseDec:parseDec,fxRate:fxRate,mergeInto:mergeInto,newData:newData,seedDemo:seedDemo,demoQuote:demoQuote,demoSeries:demoSeries};
