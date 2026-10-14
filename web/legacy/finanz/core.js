/* ===================== Rechenkern (ohne DOM, in node testbar) ===================== */
var MON=["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
var MONs=["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
var WDs=["So","Mo","Di","Mi","Do","Fr","Sa"];
var KINDS={giro:"Girokonto",haushalt:"Haushaltskonto",spar:"Sparkonto",kredit:"Kredit",karte:"Kreditkarte",sonst:"Sonstiges"};
var INTV={m:{n:1,label:"monatlich"},q:{n:3,label:"vierteljährlich"},h:{n:6,label:"halbjährlich"},j:{n:12,label:"jährlich"}};
var COLORS=["#985A1C","#1D5F8A","#3F6B3A","#7A3E6E","#B42318","#8A5A06","#2F6F73","#55565B"];
var pad=function(n){return String(n).padStart(2,"0")};
var keyOf=function(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())};
var parseKey=function(k){var p=k.split("-").map(Number);return new Date(p[0],p[1]-1,p[2])};
var isKey=function(k){return typeof k==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(k)};
var TODAY_OVERRIDE=null;
var todayKey=function(){return TODAY_OVERRIDE||keyOf(new Date())};
var lastDay=function(y,m){return new Date(y,m+1,0).getDate()};
var mk=function(y,m,d){if(d<1)return keyOf(new Date(y,m,d));var yy=y+Math.floor(m/12),mm=((m%12)+12)%12;return yy+"-"+pad(mm+1)+"-"+pad(Math.min(d,lastDay(yy,mm)))};
var addDays=function(k,n){var d=parseKey(k);d.setDate(d.getDate()+n);return keyOf(d)};
var addYears=function(k,n){var p=k.split("-").map(Number);return mk(p[0]+n,p[1]-1,p[2])};
var dmy=function(k){return k?k.slice(8,10)+"."+k.slice(5,7)+"."+k.slice(0,4):"–"};
var dm=function(k){return k.slice(8,10)+"."+k.slice(5,7)+"."};
function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function now(){return Date.now()}

/* ---------- Geld ---------- */
var NF=new Intl.NumberFormat("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2});
function eur(c,signed){
  if(c==null||isNaN(c))return "–";
  var s=NF.format(Math.abs(c)/100)+" €";
  if(signed){if(Math.round(c)===0)return "±"+s;return (c<0?"−":"+")+s}
  return (c<0&&Math.round(c)!==0?"−":"")+s;
}
function eur0(c){return (c<0?"−":"")+new Intl.NumberFormat("de-DE",{maximumFractionDigits:0}).format(Math.abs(c)/100)+" €"}
function num(c){return NF.format(c/100)}
function parseEur(str){
  if(str==null)return null;
  var s=String(str).replace(/[€\s ]/g,"").replace("−","-");
  if(!s)return null;
  var neg=false; if(s[0]==="-"){neg=true;s=s.slice(1)}else if(s[0]==="+")s=s.slice(1);
  if(s.indexOf(",")>=0)s=s.replace(/\./g,"").replace(",",".");
  else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,"");
  else if(/^\d{1,3}\.\d{3}$/.test(s))s=s.replace(".","");
  if(!/^\d+(\.\d+)?$/.test(s))return null;
  var v=Math.round(parseFloat(s)*100); return neg?-v:v;
}
function parseRate(str){if(str==null)return null;var s=String(str).trim().replace("%","").replace(",",".");if(!s)return null;var v=parseFloat(s);return isFinite(v)&&v>=0&&v<100?v:null}
function fmtRate(r){return r==null?"":String(r).replace(".",",")}

/* ---------- Bankarbeitstage (TARGET2 + 24./31.12.) ---------- */
function easter(y){var a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;return new Date(y,mo-1,da)}
var bankHolCache={};
function bankHolidays(y){
  if(bankHolCache[y])return bankHolCache[y];
  var e=easter(y),add=function(n){var d=new Date(e);d.setDate(d.getDate()+n);return keyOf(d)},m={};
  m[y+"-01-01"]=1;m[add(-2)]=1;m[add(1)]=1;m[y+"-05-01"]=1;m[y+"-12-24"]=1;m[y+"-12-25"]=1;m[y+"-12-26"]=1;m[y+"-12-31"]=1;
  return bankHolCache[y]=m;
}
function isBankday(k){var d=parseKey(k).getDay();return d!==0&&d!==6&&!bankHolidays(+k.slice(0,4))[k]}
function shiftDate(k,mode){
  if(mode==="none")return k;
  var step=mode==="prev"?-1:1,g=0;
  while(!isBankday(k)&&g++<10)k=addDays(k,step);
  return k;
}

/* ---------- Daten ---------- */
function newData(){return {settings:{scheme:"smooth",compact:false,collapsed:{},autoLock:15,lastBackup:null},plan:{},accounts:[],orders:[],tx:[],skips:[],demo:false}}
function normalizeData(o){
  var d=newData(); if(!o||typeof o!=="object")return d;
  d.settings=Object.assign(d.settings,o.settings||{});
  if(!d.settings.collapsed||typeof d.settings.collapsed!=="object")d.settings.collapsed={};
  if(["smooth","nordsee","salbei","pflaume"].indexOf(d.settings.scheme)<0)d.settings.scheme="smooth";
  d.plan=(o.plan&&typeof o.plan==="object")?o.plan:{};
  ["accounts","orders","tx","skips"].forEach(function(k){d[k]=Array.isArray(o[k])?o[k].filter(function(x){return x&&typeof x==="object"}):[]});
  d.accounts.forEach(function(a){if(!a.start||!isKey(a.start.date))a.start={date:todayKey(),amount:0};a.start.amount=Math.round(+a.start.amount||0);if(!a.color)a.color=COLORS[0];if(!KINDS[a.kind])a.kind="sonst"});
  d.orders=d.orders.filter(function(x){return x.id&&isKey(x.start)&&INTV[x.interval]&&+x.amount>0});
  d.tx=d.tx.filter(function(x){return x.id&&x.acc&&isKey(x.date)&&isFinite(+x.amount)});
  d.demo=!!o.demo;
  return d;
}

/* ---------- Termine eines Dauerauftrags ---------- */
/* liefert nominelle Termine (occ, Schlüssel) und Ausführungsdatum (Wochenende/Feiertag verschoben) */
function occurrences(o,toKey){
  var out=[],st=parseKey(o.start),y=st.getFullYear(),m=st.getMonth(),step=INTV[o.interval].n,day=+o.day||1,end=o.end&&isKey(o.end)?o.end:null;
  var occ=mk(y,m,day); if(occ<o.start){m+=step;occ=mk(y,m,day)}
  var g=0;
  while(occ<=toKey&&(!end||occ<=end)&&g++<1200){out.push({occ:occ,d:shiftDate(occ,o.shift||"next")});m+=step;occ=mk(y,m,day)}
  return out;
}

/* ---------- Gesamtrechnung ---------- */
var CACHE={ver:-1,res:null}, DATAVER=0;
function touch(){DATAVER++}
function accById(D,id){for(var i=0;i<D.accounts.length;i++)if(D.accounts[i].id===id)return D.accounts[i];return null}
function isLoan(a){return a&&a.kind==="kredit"}
function compute(D,opt){
  opt=opt||{};
  if(!opt.nocache&&CACHE.ver===DATAVER&&CACHE.res&&CACHE.today===todayKey())return CACHE.res;
  var tk=todayKey(),H=addYears(tk,10),HL=addYears(tk,60);
  var ev={},ids={};
  D.accounts.forEach(function(a){ev[a.id]=[];ids[a.id]=a});
  var skip={};(D.skips||[]).forEach(function(s){skip[s.order+"|"+s.occ]=1});
  var over={};D.tx.forEach(function(t){if(t.order&&t.occ)over[t.order+"|"+t.occ+"|"+t.acc]=1});
  var orders=D.orders.slice();
  /* Kontoführungsgebühr als interner Dauerauftrag */
  D.accounts.forEach(function(a){
    if(a.fee&&a.fee.amount>0){var fd=parseKey(a.start.date);orders.push({id:"fee:"+a.id,name:"Kontoführungsgebühr",amount:a.fee.amount,from:a.id,to:"",interval:a.fee.interval||"m",day:a.fee.day||1,start:keyOf(new Date(fd.getFullYear(),fd.getMonth(),1)),shift:"next",cat:"Kontoführung",fee:true})}
  });
  var ordById={};orders.forEach(function(o){ordById[o.id]=o});
  orders.forEach(function(o){
    var fr=ids[o.from]?o.from:"",to=ids[o.to]?o.to:"";
    if(!fr&&!to)return;
    var hz=(isLoan(ids[fr])||isLoan(ids[to]))?HL:H;
    occurrences(o,hz).forEach(function(x){
      var sk=!!skip[o.id+"|"+x.occ];
      var base={d:x.d,occ:x.occ,k:o.fee?"fee":"ord",t:o.name,cat:o.cat||"",oid:o.id,skip:sk};
      if(fr&&!over[o.id+"|"+x.occ+"|"+fr])ev[fr].push(Object.assign({},base,{a:sk?0:-o.amount,other:to}));
      if(to&&!over[o.id+"|"+x.occ+"|"+to])ev[to].push(Object.assign({},base,{a:sk?0:o.amount,other:fr}));
    });
  });
  D.tx.forEach(function(t){
    if(!ev[t.acc])return;
    var o=t.order?ordById[t.order]:null;
    var other="";
    if(t.tr){D.tx.forEach(function(u){if(u.tr===t.tr&&u.id!==t.id)other=u.acc})}
    ev[t.acc].push({d:t.date,occ:t.occ||null,k:t.corr?"corr":"tx",t:t.text||(o?o.name:"Buchung"),cat:t.cat||(o?o.cat||"":""),oid:t.order||null,tid:t.id,tr:t.tr||null,a:Math.round(+t.amount),other:other,edited:!!t.order});
  });
  var cmp=function(a,b){if(a.d!==b.d)return a.d<b.d?-1:1;var pa=a.k==="int"?0:1,pb=b.k==="int"?0:1;if(pa!==pb)return pa-pb;return b.a-a.a};
  var res={acc:{},today:tk,H:H,cap:{}};
  /* 1. Kredite: Zinsen monatlich, Raten bis zur Tilgung, letzte Rate gekappt */
  D.accounts.filter(isLoan).forEach(function(a){
    var L=a.loan||{},rate=+L.rate||0,list=ev[a.id].slice(),sd=a.start.date;
    var day=+L.day||1,sp=parseKey(sd),iy=sp.getFullYear(),im=sp.getMonth(),ik=mk(iy,im,day);
    if(ik<sd){im++;ik=mk(iy,im,day)}
    if(rate>0){var g=0;while(ik<=HL&&g++<800){list.push({d:ik,k:"int",t:"Zinsen",cat:"Zinsen",a:0,rate:rate});im++;ik=mk(iy,im,day)}}
    list.sort(cmp);
    var bal=a.start.amount,out=[],paid=null,pre=[];
    list.forEach(function(e){
      if(e.d<sd){pre.push(e);return}
      if(paid&&e.d>paid){
        if(e.k==="int")return;
        if(e.k==="ord"&&e.a>0){res.cap[e.oid+"|"+e.occ]=0;return}
      }
      if(e.k==="int"){if(bal>=0)return;e.a=-Math.round(-bal*rate/100/12);if(!e.a)return}
      else if(e.k==="ord"&&e.a>0&&bal+e.a>0){var c=Math.max(0,-bal);res.cap[e.oid+"|"+e.occ]=c;e.a=c;e.capped=true}
      bal+=e.a;e.bal=bal;out.push(e);
      if(!paid&&bal>=0&&e.a>0){paid=e.d;e.payoff=true}
    });
    res.acc[a.id]=finish(a,pre,out);res.acc[a.id].paid=paid;
  });
  /* 2. übrige Konten: gekappte Kreditraten übernehmen, Guthabenzins am Monatsende */
  D.accounts.filter(function(a){return !isLoan(a)}).forEach(function(a){
    var list=ev[a.id].filter(function(e){
      if(e.k==="ord"&&e.a<0&&res.cap[e.oid+"|"+e.occ]!=null){var c=res.cap[e.oid+"|"+e.occ];if(!c)return false;e.a=-c;e.capped=true}
      return e.d<=H;
    });
    var ir=+a.interest||0,sd=a.start.date;
    if(ir>0){var sp=parseKey(sd),y=sp.getFullYear(),m=sp.getMonth(),k=mk(y,m,31);if(k<sd){m++;k=mk(y,m,31)}var g=0;while(k<=H&&g++<200){list.push({d:k,k:"int",t:"Guthabenzinsen",cat:"Zinsen",a:0,rate:ir,credit:true});m++;k=mk(y,m,31)}}
    list.sort(function(x,y){if(x.d!==y.d)return x.d<y.d?-1:1;var px=x.k==="int"?1:0,py=y.k==="int"?1:0;if(px!==py)return px-py;return y.a-x.a});
    var bal=a.start.amount,out=[],pre=[];
    list.forEach(function(e){
      if(e.d<sd){pre.push(e);return}
      if(e.k==="int"){if(bal<=0)return;e.a=Math.round(bal*e.rate/100/12);if(!e.a)return}
      bal+=e.a;e.bal=bal;out.push(e);
    });
    res.acc[a.id]=finish(a,pre,out);
  });
  if(!opt.nocache){CACHE={ver:DATAVER,res:res,today:tk}}
  return res;
}
/* Startwert = Stand zu Beginn des Stichtags. Frühere Buchungen stecken schon darin: Stand rückwärts rechnen */
function finish(a,pre,out){
  var b=a.start.amount;
  for(var i=pre.length-1;i>=0;i--){pre[i].bal=b;pre[i].pre=true;b-=pre[i].a}
  var all=pre.concat([{d:a.start.date,k:"start",t:"Startwert",a:0,bal:a.start.amount}],out);
  var tk=todayKey();all.forEach(function(e){e.fut=e.d>tk});
  return {ev:all,first:b};
}
function balAt(r,key){
  var ev=r.ev,lo=0,hi=ev.length-1,ans=-1;
  while(lo<=hi){var mid=(lo+hi)>>1;if(ev[mid].d<=key){ans=mid;lo=mid+1}else hi=mid-1}
  return ans<0?r.first:ev[ans].bal;
}
function forecast(D,a){
  var res=compute(D),r=res.acc[a.id],tk=todayKey(),t=parseKey(tk);
  var f={now:balAt(r,tk),month:balAt(r,mk(t.getFullYear(),t.getMonth(),31)),year:balAt(r,t.getFullYear()+"-12-31")};
  if(isLoan(a)){f.paid=r.paid;var ip=0,ifut=0,pay=0;r.ev.forEach(function(e){if(e.pre)return;if(e.k==="int"){if(e.d<=tk)ip-=e.a;else ifut-=e.a}if(e.d>tk&&e.a>0&&e.k!=="int")pay+=e.a});f.intPaid=ip;f.intLeft=ifut;f.payLeft=pay;return f}
  if(a.goal&&a.goal.amount>0){
    if(f.now>=a.goal.amount)f.goalReached=true;
    else for(var i=0;i<r.ev.length;i++){var e=r.ev[i];if(e.d>tk&&e.bal>=a.goal.amount){f.goalDate=e.d;break}}
  }
  var lim=+a.min||0,h=addDays(tk,90);
  for(var j=0;j<r.ev.length;j++){var x=r.ev[j];if(x.d>tk&&x.d<=h&&x.bal<lim){f.low={d:x.d,bal:x.bal};break}}
  return f;
}

/* ---------- Finanzplan ---------- */
var KLABEL={einnahme:"Einnahmen",fix:"Fixe Ausgaben",variabel:"Variable Ausgaben"};
function planTotals(D,y){
  var p=D.plan[y],z=function(){return [0,0,0,0,0,0,0,0,0,0,0,0]};
  var t={inc:z(),fix:z(),vari:z(),out:z(),res:z(),groups:[]};
  if(!p)return t;
  p.groups.forEach(function(g){
    var s=z();g.items.forEach(function(it){for(var i=0;i<12;i++)s[i]+=+it.m[i]||0});
    t.groups.push({g:g,sum:s});
    var tgt=g.kind==="einnahme"?t.inc:g.kind==="fix"?t.fix:t.vari;
    for(var i=0;i<12;i++)tgt[i]+=s[i];
  });
  for(var i=0;i<12;i++){t.out[i]=t.fix[i]+t.vari[i];t.res[i]=t.inc[i]-t.out[i]}
  return t;
}
/* Ist je Kategorie und Monat: jede Bewegung einmal zählen (Umbuchung nur auf der abgebenden Seite) */
function istIndex(D){
  var res=compute(D);if(res.ist)return res.ist;
  var idx={},tk=todayKey(),ord={};D.orders.forEach(function(o){ord[o.id]=o});
  D.accounts.forEach(function(a){
    (res.acc[a.id]?res.acc[a.id].ev:[]).forEach(function(e){
      if(e.k==="start"||e.k==="int"||e.d>tk||!e.cat||!e.a)return;
      if(e.oid&&ord[e.oid]){var o=ord[e.oid],prim=accById(D,o.from)?o.from:o.to;if(a.id!==prim)return}
      else if(e.tr&&e.a>0)return;
      var y=e.d.slice(0,4),m=+e.d.slice(5,7)-1,c=e.cat.toLowerCase();
      var row=(idx[y]=idx[y]||{})[c]=(idx[y][c]||[0,0,0,0,0,0,0,0,0,0,0,0]);row[m]+=Math.abs(e.a);
    });
  });
  res.ist=idx;return idx;
}
function istOf(D,y,cat,m){var r=(istIndex(D)[y]||{})[String(cat).toLowerCase()];if(!r)return 0;if(m==null)return r.reduce(function(a,b){return a+b},0);return r[m]}
function hasIst(D,y,cat){return !!(istIndex(D)[y]||{})[String(cat).toLowerCase()]}

/* ---------- Kredit-Simulation (Sondertilgung, neue Rate) ---------- */
function simulateLoan(D,accId,mod){
  var C=JSON.parse(JSON.stringify(D)),a=accById(C,accId);
  if(mod.amount>0){
    if(mod.yearly)C.orders.push({id:"sim-st",name:"Sondertilgung",amount:mod.amount,from:"",to:accId,interval:"j",day:+mod.date.slice(8,10),start:mod.date,shift:"none"});
    else C.tx.push({id:"sim-st",acc:accId,date:mod.date,amount:mod.amount,text:"Sondertilgung"});
  }
  if(mod.rate>0)C.orders.forEach(function(o){if(o.to===accId&&a.loan&&o.id===a.loan.order)o.amount=mod.rate});
  var r=compute(C,{nocache:true}).acc[accId],ip=0;r.ev.forEach(function(e){if(!e.pre&&e.k==="int"&&e.d>todayKey())ip-=e.a});
  return {paid:r.paid,intLeft:ip};
}
function monthsBetween(a,b){var x=parseKey(a),y=parseKey(b);return (y.getFullYear()-x.getFullYear())*12+y.getMonth()-x.getMonth()}

/* ---------- Zusammenführen (neuere Änderung gewinnt) ---------- */
function mergeInto(D,src){
  var n={added:0,updated:0};
  ["accounts","orders","tx"].forEach(function(k){
    (src[k]||[]).forEach(function(x){
      if(!x||!x.id)return;
      var i=-1;for(var j=0;j<D[k].length;j++)if(D[k][j].id===x.id){i=j;break}
      if(i<0){D[k].push(JSON.parse(JSON.stringify(x)));n.added++}
      else if((+x.u||0)>(+D[k][i].u||0)){D[k][i]=JSON.parse(JSON.stringify(x));n.updated++}
    });
  });
  (src.skips||[]).forEach(function(s){if(!D.skips.some(function(t){return t.order===s.order&&t.occ===s.occ})){D.skips.push(s);n.added++}});
  Object.keys(src.plan||{}).forEach(function(y){if(!D.plan[y]){D.plan[y]=JSON.parse(JSON.stringify(src.plan[y]));n.added++}});
  return n;
}
function scopeData(D,accId){
  if(!accId)return JSON.parse(JSON.stringify(D));
  var a=accById(D,accId);
  var ords=D.orders.filter(function(o){return o.from===accId||o.to===accId});
  var oids={};ords.forEach(function(o){oids[o.id]=1});
  return JSON.parse(JSON.stringify({accounts:[a],orders:ords,tx:D.tx.filter(function(t){return t.acc===accId}),skips:D.skips.filter(function(s){return oids[s.order]}),plan:{}}));
}

/* ---------- Excel-Import ---------- */
function importPlan(D,J,choice){
  var made={acc:0,ord:0,years:0},keyMap={};
  if(choice.plan){
    Object.keys(J.plan||{}).forEach(function(y){
      D.plan[y]={groups:(J.plan[y].groups||[]).map(function(g){return {id:newId(),name:g.name,kind:g.kind,items:g.items.map(function(it){return {id:newId(),name:it.name,m:it.m.slice(0,12).map(function(v){return Math.round(+v||0)})}})}})};made.years++;
    });
  }
  var tk=todayKey(),t=parseKey(tk),first=keyOf(new Date(t.getFullYear(),t.getMonth(),1));
  (J.suggest&&J.suggest.accounts||[]).forEach(function(s,i){
    if(!choice.acc[s.key])return;
    var ex=D.accounts.filter(function(a){return a.name.toLowerCase()===s.name.toLowerCase()})[0];
    if(ex){keyMap[s.key]=ex.id;return}
    var a={id:newId(),name:s.name,kind:s.kind,color:COLORS[i%COLORS.length],start:{date:tk,amount:0},fee:null,interest:null,goal:null,min:0,u:now()};
    if(s.kind==="kredit")a.loan={rate:0,day:1,payFrom:"",orig:0};
    D.accounts.push(a);keyMap[s.key]=a.id;made.acc++;
  });
  (J.suggest&&J.suggest.orders||[]).forEach(function(s,i){
    if(!choice.ord[i])return;
    var fr=s.frm?keyMap[s.frm]||"":"",to=s.to?keyMap[s.to]||"":"";
    if(!fr&&!to)return;
    var st=first;
    if(s.interval!=="m"){var mo=(s.month||1)-1,y=t.getFullYear(),step=INTV[s.interval].n;while(mk(y,mo,1)<first){mo+=step}st=mk(y,mo,1)}
    var o={id:newId(),name:s.name,amount:s.amount,from:fr,to:to,interval:s.interval,day:s.day||1,start:st,end:"",shift:s.shift||"next",cat:s.cat||s.name,u:now()};
    D.orders.push(o);made.ord++;
    var ta=accById(D,to);
    if(isLoan(ta)&&ta.loan&&!ta.loan.order){ta.loan.order=o.id;ta.loan.day=o.day;ta.loan.payFrom=fr}
  });
  return made;
}

/* ---------- Beispieldaten ---------- */
function seedDemo(D){
  var tk=todayKey(),t=parseKey(tk),y=t.getFullYear(),m=t.getMonth(),st=mk(y,m-1,1),sd=addDays(st,-1);
  var A=function(id,name,kind,color,amt,x){return Object.assign({id:id,name:name,kind:kind,color:color,start:{date:sd,amount:amt},fee:null,interest:null,goal:null,min:0,u:1},x||{})};
  D.accounts=[
    A("d-giro","Girokonto","giro",COLORS[0],184000,{fee:{amount:495,interval:"m",day:31},min:20000}),
    A("d-haus","Haushaltskonto","haushalt",COLORS[2],12000),
    A("d-url","Urlaubskonto","spar",COLORS[1],95000,{goal:{amount:300000,date:(y+1)+"-06-30"},interest:1.5}),
    A("d-auto","Autokredit","kredit",COLORS[4],-1480000,{loan:{rate:4.9,day:1,payFrom:"d-giro",orig:2400000,order:"o-auto"}})
  ];
  var O=function(id,name,amt,fr,to,day,cat,x){return Object.assign({id:id,name:name,amount:amt,from:fr,to:to,interval:"m",day:day,start:st,end:"",shift:"next",cat:cat||name,u:1},x||{})};
  D.orders=[
    O("o-geh","Gehalt",320000,"","d-giro",31,"Gehalt",{shift:"prev"}),
    O("o-miete","Miete",95000,"d-giro","",1,"Miete"),
    O("o-haus","Haushaltsgeld",45000,"d-giro","d-haus",1,"Haushalt"),
    O("o-url","Urlaubsparen",25000,"d-giro","d-url",2,"Urlaubsparen"),
    O("o-auto","Rate Autokredit",40000,"d-giro","d-auto",1,"Autokredit"),
    O("o-strom","Strom",8900,"d-giro","",15,"Strom"),
    O("o-hand","Handy",2999,"d-giro","",5,"Handy"),
    O("o-vers","Kfz-Versicherung",42000,"d-giro","",1,"Versicherungen",{interval:"j",start:mk(y,m+2,1)})
  ];
  var T=function(id,acc,d,amt,text,cat){return {id:id,acc:acc,date:d,amount:amt,text:text,cat:cat,u:1}};
  D.tx=[T("t1","d-haus",mk(y,m-1,4),-6230,"Wocheneinkauf","Lebensmittel"),T("t2","d-haus",mk(y,m-1,11),-7115,"Wocheneinkauf","Lebensmittel"),T("t3","d-haus",mk(y,m-1,18),-5890,"Wocheneinkauf","Lebensmittel"),T("t4","d-haus",mk(y,m-1,26),-8420,"Wocheneinkauf","Lebensmittel"),T("t5","d-giro",mk(y,m-1,20),-4999,"Tankstelle","Tanken"),T("t6","d-haus",mk(y,m,3),-6810,"Wocheneinkauf","Lebensmittel"),T("t7","d-giro",mk(y,m,6),-12000,"Geburtstagsgeschenk","Sonstiges")];
  D.skips=[];
  var r12=function(v){return [v,v,v,v,v,v,v,v,v,v,v,v]};
  var G=function(name,kind,items){return {id:newId(),name:name,kind:kind,items:items.map(function(it){return {id:newId(),name:it[0],m:typeof it[1]==="number"?r12(it[1]):it[1]}})}};
  D.plan={};D.plan[y]={groups:[
    G("Einkommen","einnahme",[["Gehalt",320000],["Sonstige Einnahmen",0]]),
    G("Wohnen","fix",[["Miete",95000],["Strom",8900],["Haushalt",45000]]),
    G("Versicherungen","fix",[["Versicherungen",[0,0,0,0,0,0,0,0,0,0,0,42000]]]),
    G("Mobilität","fix",[["Autokredit",40000],["Tanken",15000]]),
    G("Sparen","fix",[["Urlaubsparen",25000]]),
    G("Sonstige fixe Ausgaben","fix",[["Handy",2999],["Kontoführung",495]]),
    G("Lebensunterhalt","variabel",[["Lebensmittel",30000],["Sonstiges",10000]])
  ]};
  D.demo=true;
}

var CORE={eur:eur,parseEur:parseEur,occurrences:occurrences,compute:compute,balAt:balAt,forecast:forecast,planTotals:planTotals,istOf:istOf,simulateLoan:simulateLoan,mergeInto:mergeInto,scopeData:scopeData,importPlan:importPlan,seedDemo:seedDemo,newData:newData,normalizeData:normalizeData,touch:touch,shiftDate:shiftDate,isBankday:isBankday,setToday:function(k){TODAY_OVERRIDE=k;CACHE.ver=-1},accById:accById};
