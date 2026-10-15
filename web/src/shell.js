/* =====================================================================
   Meine Finanzen – Hülle: Anmeldung, Abgleich mit dem Server, Navigation,
   gemeinsame Einstellungen, Verrechnungskonto, Umzug alter Sicherungen.
   Die Teile Finanzen (FIN) und Depot (DEP) hängen sich hier an.
   ===================================================================== */
var SH=(function(){
"use strict";
var VERSION="1.6.0",VDATE="2026-10-15";
var PREVIEW=!!window.MF_PREVIEW||location.protocol==="file:"||(function(){try{return window.self!==window.top}catch(e){return true}})();
var $=function(id){return document.getElementById(id)};
var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};
var P={name:"",email:"",id:""},USER={},D=null,REG=null,started=false;
var FINm=null,DEPm=null;   /* werden nach dem Laden der Module gesetzt */

var VIEWS={dashboard:"Dashboard",uebersicht:"Übersicht",konten:"Konten & Buchungen",auftraege:"Daueraufträge",kredite:"Kredite",plan:"Finanzplan",auswertung:"Auswertung Finanzen",
  depot:"Depot",zeitung:"Aktienzeitung",position:"Position",watchlist:"Watchlist",alarme:"Kursalarme",neu:"Erfassen & Import",dauswertung:"Auswertung Depot",einstellungen:"Einstellungen"};
var OWNER={dashboard:"dash",uebersicht:"fin",konten:"fin",auftraege:"fin",kredite:"fin",plan:"fin",auswertung:"fin",depot:"dep",zeitung:"dep",position:"dep",watchlist:"dep",alarme:"dep",neu:"dep",dauswertung:"dep",einstellungen:"both"};
var curView="uebersicht",stale={fin:false,dep:false};

/* ---------- Server ---------- */
function api(method,path,body){
  if(PREVIEW)return Promise.reject(new Error("In der Vorschau gibt es keinen Server."));
  var h={"X-Requested-With":"finanzen"};if(body!==undefined)h["Content-Type"]="application/json";
  return fetch(path,{method:method,headers:h,body:body!==undefined?JSON.stringify(body):undefined,credentials:"same-origin",cache:"no-store"}).then(function(r){
    return r.json().catch(function(){return {}}).then(function(j){
      if(!r.ok){var e=new Error(typeof j.detail==="string"?j.detail:("Server antwortet mit HTTP "+r.status));e.status=r.status;e.data=j;if(r.status===401&&path.indexOf("/api/auth/")!==0)sessionLost();throw e}
      return j;
    });
  },function(){var e=new Error("Keine Verbindung zum Server.");e.status=0;throw e});
}

/* ---------- Daten: Server-Form <-> Seiten-Form ---------- */
var COLLS=["accounts","orders","tx","skips","plan","depots","pos","sectx","plans","watch","alerts","events"];
function fromServer(j,old){
  var st=Object.assign({},j.settings||{});
  var o={settings:st,plan:j.plan||{},accounts:j.accounts||[],orders:j.orders||[],tx:j.tx||[],skips:j.skips||[],
    watch:j.watch||[],alerts:j.alerts||[],plans:j.plans||[],events:j.events||[],demo:!!st._demo,demoDepot:!!st._demoDepot};
  delete st._demo;delete st._demoDepot;
  st.depots=(j.depots||[]).map(function(x){var c=Object.assign({},x);delete c.sort;return c});
  var by={};(j.sectx||[]).forEach(function(t){var c=Object.assign({},t),p=c.pos;delete c.pos;(by[p]=by[p]||[]).push(c)});
  o.pos=(j.pos||[]).map(function(p){return Object.assign({},p,{tx:by[p.id]||[]})});
  if(old){o.quotes=old.quotes;o.qtime=old.qtime}
  /* Konten, die andere mit mir teilen: gehören dem Besitzer, werden hier nur eingeblendet */
  var seen={};o.orders.forEach(function(x){seen[x.id]=1});
  (j.shared||[]).forEach(function(sh){
    o.accounts.push(sh.account);
    (sh.tx||[]).forEach(function(t){o.tx.push(t)});
    (sh.orders||[]).forEach(function(x){if(!seen[x.id]){seen[x.id]=1;o.orders.push(x)}});
    (sh.skips||[]).forEach(function(k){o.skips.push(k)});
  });
  SHARES=j.shares||SHARES||[];
  return o;
}
var SHARES=[];
function shareMap(D){var m={};D.accounts.forEach(function(a){if(a.shared)m[a.id]=a.shared});return m}
function normalizeAll(o){
  var f=FINm.normalize(o),d=DEPm.normalize(o);
  var s=Object.assign({},d.settings,f.settings);s.depots=d.settings.depots;f.settings=s;
  ["pos","watch","alerts","plans","events","quotes","qtime","demoDepot"].forEach(function(k){f[k]=d[k]});
  return f;
}
function settingsOf(D){var s=Object.assign({},D.settings);delete s.depots;s._demo=!!D.demo;s._demoDepot=!!D.demoDepot;return s}
/* flache Sicht: je Sammlung {id: JSON} – Grundlage für den Abgleich */
function flat(D){
  var F={sh:{}},put=function(c,id,o){F[c][id]=JSON.stringify(o)},SM=shareMap(D),osh={};
  var sput=function(sid,c,id,o){var b=F.sh[sid]||(F.sh[sid]={tx:{},orders:{},skips:{}});b[c][id]=JSON.stringify(o)};
  COLLS.forEach(function(c){F[c]={}});
  var ai=0;D.accounts.forEach(function(a){if(!a.shared)put("accounts",a.id,Object.assign({},a,{sort:ai++}))});
  /* was ein geteiltes Konto betrifft, geht an den Besitzer */
  D.orders.forEach(function(x){var sa=SM[x.from]||SM[x.to];if(sa){osh[x.id]=sa.id;sput(sa.id,"orders",x.id,x)}else put("orders",x.id,x)});
  D.tx.forEach(function(x){var sa=SM[x.acc];if(sa)sput(sa.id,"tx",x.id,x);else put("tx",x.id,x)});
  (D.skips||[]).forEach(function(s){var k=s.order+"|"+s.occ,o={order:s.order,occ:s.occ};if(osh[s.order])sput(osh[s.order],"skips",k,o);else put("skips",k,o)});
  Object.keys(D.plan||{}).forEach(function(y){put("plan",y,{id:y,groups:(D.plan[y]&&D.plan[y].groups)||[]})});
  (D.settings.depots||[]).forEach(function(x,i){put("depots",x.id,Object.assign({},x,{sort:i}))});
  D.pos.forEach(function(p){var c=Object.assign({},p);delete c.tx;put("pos",p.id,c);(p.tx||[]).forEach(function(t){put("sectx",t.id,Object.assign({},t,{pos:p.id}))})});
  ["watch","alerts","plans","events"].forEach(function(k){(D[k]||[]).forEach(function(x){put(k,x.id,x)})});
  F.settings=JSON.stringify(settingsOf(D));
  return F;
}
function toExport(D){
  var F=flat(D),o={type:"meine-finanzen-export",v:1,date:keyOfD(new Date()),settings:JSON.parse(F.settings)};
  COLLS.forEach(function(c){o[c]=Object.keys(F[c]).map(function(id){return JSON.parse(F[c][id])})});
  var plan={};o.plan.forEach(function(p){plan[p.id]={groups:p.groups}});o.plan=plan;
  o.skips=o.skips.map(function(s){return {order:s.order,occ:s.occ}});
  return o;
}
function keyOfD(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")}

/* ---------- Abgleich ---------- */
var SYNC={rev:0,snap:null,timer:null,inflight:false,again:false,fail:0,reload:false,lost:false,lastErr:""};
function cdiff(a,b,c,up,del){
  var n=0;a=a||{};b=b||{};
  Object.keys(a).forEach(function(id){if(a[id]!==b[id]){(up[c]=up[c]||[]).push(JSON.parse(a[id]));n++}});
  Object.keys(b).forEach(function(id){if(!(id in a)){(del[c]=del[c]||[]).push(id);n++}});
  return n;
}
function diff(){
  var cur=flat(D),up={},del={},n=0,sc=cur.settings!==SYNC.snap.settings,sh={},ro=[],SM=shareMap(D),perm={};
  COLLS.forEach(function(c){n+=cdiff(cur[c],SYNC.snap[c],c,up,del)});
  Object.keys(SM).forEach(function(k){perm[SM[k].id]=SM[k]});
  var ids={};Object.keys(cur.sh).concat(Object.keys(SYNC.snap.sh||{})).forEach(function(x){ids[x]=1});
  Object.keys(ids).forEach(function(sid){
    var a=cur.sh[sid]||{},b=(SYNC.snap.sh||{})[sid]||{},u={},d={},k=0;
    ["tx","orders","skips"].forEach(function(c){k+=cdiff(a[c],b[c],c,u,d)});
    if(!k)return;
    if(!perm[sid]||perm[sid].perm!=="write"){ro.push(sid);return}   /* nur Lesezugriff: nicht senden */
    sh[sid]={upsert:u,delete:d};n+=k;
  });
  return {cur:cur,up:up,del:del,n:n,sc:sc,sh:sh,ro:ro};
}
function pending(){if(!D||!SYNC.snap)return false;if(SYNC.inflight||SYNC.timer)return true;var d=diff();return d.n>0||d.sc}
function changed(mod,light){
  if(!D)return;
  if(mod)stale[mod==="fin"?"dep":"fin"]=true;
  renderDashSoon();
  if(reconcileCash()){FINm.touch();if(OWNER[curView]!=="dep")FINm.render();else stale.fin=true}
  if(PREVIEW){setSync("preview");return}
  schedule(light?1500:600);
}
function schedule(ms){clearTimeout(SYNC.timer);SYNC.timer=setTimeout(function(){SYNC.timer=null;pushNow()},ms);if(!SYNC.fail)setSync("pending")}
function pushNow(){
  if(!D||!SYNC.snap||SYNC.lost||PREVIEW)return;
  if(SYNC.inflight){SYNC.again=true;return}
  clearTimeout(SYNC.timer);SYNC.timer=null;
  var d=diff();
  if(d.ro.length){
    /* Änderung an einem nur lesbar geteilten Konto: verwerfen und Serverstand neu laden */
    var nm=D.accounts.filter(function(a){return a.shared&&d.ro.indexOf(a.shared.id)>=0}).map(function(a){return "„"+a.name+"“"}).join(", ");
    showSyncBar("<b>Nicht gespeichert:</b> "+esc(nm||"Dieses Konto")+" ist für dich nur zum Ansehen freigegeben. Die Änderung wurde zurückgenommen.",false);
    SYNC.reload=true;
    if(!d.n&&!d.sc){maybeReload();return}
  }
  if(!d.n&&!d.sc){setSync("ok");maybeReload();return}
  SYNC.inflight=true;setSync("saving");
  var body={base_rev:SYNC.rev,upsert:d.up,delete:d.del};if(d.sc)body.settings=JSON.parse(d.cur.settings);
  if(Object.keys(d.sh).length)body.shared=d.sh;
  api("POST","/api/sync",body).then(function(j){
    SYNC.snap=d.cur;SYNC.rev=j.rev;SYNC.fail=0;SYNC.lastErr="";if(j.reload)SYNC.reload=true;
    if(j.srev!=null){if(Object.keys(d.sh).length)SYNC.srev=j.srev;else if(j.srev!==SYNC.srev)SYNC.reload=true}
    var rj=(j.rejected||[]).filter(function(x){return x.coll==="shared"});
    if(rj.length){SYNC.reload=true;showSyncBar("<b>Nicht gespeichert:</b> Die Freigabe für ein geteiltes Konto hat sich geändert (nur noch lesen oder zurückgenommen). Die Daten werden neu geladen.",false)}
    else if(j.rejected&&j.rejected.length){showSyncBar(j.rejected.length+(j.rejected.length===1?" Eintrag wurde":" Einträge wurden")+" vom Server abgelehnt (ungültige Werte) und nicht gespeichert.",false)}else if(!d.ro.length)hideSyncBar();
  },function(e){
    SYNC.fail++;SYNC.lastErr=e.message;
  }).then(function(){
    SYNC.inflight=false;
    if(SYNC.lost)return;
    if(SYNC.fail){setSync("error");showSyncBar("<b>Nicht gespeichert.</b> "+esc(SYNC.lastErr)+" Deine Änderungen bleiben in diesem Fenster und werden automatisch nachgeholt.",true);clearTimeout(SYNC.timer);SYNC.timer=setTimeout(function(){SYNC.timer=null;pushNow()},Math.min(60000,2000*Math.pow(2,SYNC.fail)))}
    else if(SYNC.again||pending()){SYNC.again=false;schedule(250)}
    else{setSync("ok");maybeReload()}
  });
}
function maybeReload(){if(SYNC.reload&&!pending()){SYNC.reload=false;loadData(false)}}
function pollRev(){
  if(!D||PREVIEW||SYNC.lost||document.hidden)return;
  api("GET","/api/rev").then(function(j){if(j.rev!==SYNC.rev||(j.srev!=null&&j.srev!==SYNC.srev)){SYNC.reload=true;maybeReload()}}).catch(function(){});
}
function setSync(st){
  var t={ok:"gespeichert",pending:"Änderung …",saving:"speichert …",error:"nicht gespeichert",preview:"Vorschau, nur im Speicher",loading:"lädt …"}[st]||st;
  $("syncTxt").textContent=t;$("syncState").setAttribute("data-st",st);$("syncDot").setAttribute("data-st",st);$("syncDot").title=t;
}
function showSyncBar(html,retry){$("syncBarTxt").innerHTML=html;$("syncRetry").hidden=!retry;$("syncBar").hidden=false}
function hideSyncBar(){$("syncBar").hidden=true}
$("syncRetry").addEventListener("click",function(){SYNC.fail=0;pushNow()});
window.addEventListener("beforeunload",function(e){if(!PREVIEW&&pending()){pushNow();e.preventDefault();e.returnValue="";return ""}});
document.addEventListener("visibilitychange",function(){if(!D)return;if(document.hidden){if(SYNC.timer)pushNow()}else{pollRev();renderAll()}});

/* ---------- Verrechnungskonto: Depot-Buchungen landen automatisch im Konto ---------- */
var NFQ=new Intl.NumberFormat("de-DE",{maximumFractionDigits:6});
function reconcileCash(){
  if(!D)return false;
  var accs={},deps={},want={},changedAny=false;
  D.accounts.forEach(function(a){accs[a.id]=a});
  (D.settings.depots||[]).forEach(function(d){deps[d.id]=d});
  var def=(D.settings.depots||[])[0];
  D.pos.forEach(function(p){
    var dep=deps[p.depot]||def,cash=dep&&dep.cash_acc&&accs[dep.cash_acc]?dep.cash_acc:"";
    (p.tx||[]).forEach(function(t){
      var acc=cash,expl=false;
      if(t.type==="div"){var r=divTarget(p,t,dep,accs);if(r.explicit){acc=r.acc;expl=true}}
      if(!acc)return;
      if(!expl&&dep.cash_from&&t.date<dep.cash_from)return;
      var q=+t.qty||0,px=+t.price||0,fee=+t.fee||0,amt=t.type==="buy"?-Math.round((q*px+fee)*100):t.type==="sell"?Math.round((q*px-fee)*100):Math.round((+t.amount||0)*100);
      if(!amt)return;
      want["sx_"+t.id]={id:"sx_"+t.id,acc:acc,date:t.date,amount:amt,text:DEPm.txLabel(t)+" "+p.name+(t.type!=="div"?" ("+NFQ.format(q)+" Stk.)":""),cat:t.type==="div"?"Dividenden":"Wertpapiere",sec_tx:t.id};
    });
  });
  var seen={};
  D.tx=D.tx.filter(function(t){
    if(!t.sec_tx)return true;
    var w=want[t.id];if(!w){changedAny=true;return false}
    seen[t.id]=1;
    if(["acc","date","amount","text","cat"].some(function(k){return t[k]!==w[k]})){Object.assign(t,w,{u:Date.now()});changedAny=true}
    return true;
  });
  Object.keys(want).forEach(function(id){if(!seen[id]){D.tx.push(Object.assign({},want[id],{u:Date.now()}));changedAny=true}});
  return changedAny;
}
/* Referenzkonto für Dividenden: Buchung → Position → Verrechnungskonto des Depots.
   "-" heißt ausdrücklich: nicht auf ein Konto buchen. */
function divTarget(p,t,dep,accs){
  var v=t&&t.acc;if(v==="-")return {acc:"",explicit:true,src:"tx"};if(v&&accs[v])return {acc:v,explicit:true,src:"tx"};
  v=p&&p.divAcc;if(v==="-")return {acc:"",explicit:true,src:"pos"};if(v&&accs[v])return {acc:v,explicit:true,src:"pos"};
  return {acc:dep&&dep.cash_acc&&accs[dep.cash_acc]?dep.cash_acc:"",explicit:false,src:"dep"};
}
function accMap(){var m={};FINm.accounts().forEach(function(a){m[a.id]=a});return m}
function depOf(p){var ds=D.settings.depots||[];return ds.filter(function(d){return d.id===p.depot})[0]||ds[0]}
function accName(id,m){return id&&m[id]?m[id].name:""}
/* Auswahlliste füllen. level "pos": Standard = Verrechnungskonto des Depots; level "tx": Standard = Einstellung der Position */
function divAccOptions(sel,p,level,val){
  if(!sel||!D)return;var m=accMap(),dep=depOf(p),def;
  if(level==="tx"){var r=divTarget(p,null,dep,m);def=r.acc?"wie Position (→ "+accName(r.acc,m)+")":"wie Position (keine Gutschrift)"}
  else{var c=dep&&dep.cash_acc&&m[dep.cash_acc];def=c?"wie Depot (→ "+c.name+")":"wie Depot (kein Verrechnungskonto)"}
  var h='<option value="">'+esc(def)+'</option><option value="-">nicht auf ein Konto buchen</option>';
  FINm.accounts().forEach(function(a){h+='<option value="'+esc(a.id)+'">→ '+esc(a.name)+"</option>"});
  sel.innerHTML=h;sel.value=val&&(val==="-"||m[val])?val:"";
}
function divAccLabel(p,t){
  if(!D)return "";var m=accMap(),r=divTarget(p,t,depOf(p),m);
  if(!r.acc)return r.explicit?"keine Gutschrift":"";
  var dep=depOf(p);if(!r.explicit&&dep&&dep.cash_from&&t&&t.date<dep.cash_from)return "";
  return "→ "+accName(r.acc,m);
}
function cashPicker(dep){
  var accs=FINm.accounts(),h='<span class="cashpick"><select data-depacc="'+esc(dep.id)+'" aria-label="Verrechnungskonto für '+esc(dep.name)+'"><option value="">ohne Verrechnungskonto</option>';
  accs.forEach(function(a){h+='<option value="'+esc(a.id)+'"'+(a.id===dep.cash_acc?" selected":"")+">→ "+esc(a.name)+"</option>"});
  h+="</select>";
  if(dep.cash_acc)h+='<label class="cashfrom">ab <input type="date" data-depfrom="'+esc(dep.id)+'" value="'+esc(dep.cash_from||"")+'"></label>';
  return h+"</span>";
}
document.addEventListener("change",function(e){
  var s=e.target.closest&&e.target.closest("[data-depacc],[data-depfrom]");if(!s||!D)return;
  var id=s.getAttribute("data-depacc")||s.getAttribute("data-depfrom"),d=(D.settings.depots||[]).filter(function(x){return x.id===id})[0];if(!d)return;
  if(s.hasAttribute("data-depacc")){d.cash_acc=s.value||undefined;if(!s.value){delete d.cash_acc;delete d.cash_from}else if(!d.cash_from)d.cash_from=keyOfD(new Date())}
  else d.cash_from=s.value||undefined;
  changed("dep");DEPm.render();FINm.render();
  var a=d.cash_acc&&FINm.accounts().filter(function(x){return x.id===d.cash_acc})[0];
  setMsg("depMsg",a?"Käufe, Verkäufe und Dividenden aus „"+d.name+"“"+(d.cash_from?" ab "+d.cash_from.split("-").reverse().join("."):"")+" werden auf „"+a.name+"“ gebucht.":"„"+d.name+"“ bucht nicht mehr auf ein Konto. Bisherige automatische Buchungen sind entfernt.");
});

/* ---------- Hilfe-Infos: [?]-Knöpfe mit data-tip (Maus, Tastatur und Touch) ---------- */
var TIP={el:null,for:null,pinned:false,t:0};
function tipBox(){if(!TIP.el){TIP.el=document.createElement("div");TIP.el.className="tipbox";TIP.el.id="tipBox";TIP.el.setAttribute("role","tooltip");TIP.el.hidden=true;document.body.appendChild(TIP.el)}return TIP.el}
function tipShow(b,pin){
  clearTimeout(TIP.t);var el=tipBox();
  if(TIP.for&&TIP.for!==b)TIP.for.removeAttribute("aria-describedby");
  TIP.for=b;TIP.pinned=!!pin;el.textContent=b.getAttribute("data-tip");el.hidden=false;b.setAttribute("aria-describedby","tipBox");b.setAttribute("aria-expanded","true");
  var r=b.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=window.innerHeight,w=Math.min(340,vw-24);
  el.style.maxWidth=w+"px";el.style.left="0px";el.style.top="0px";
  var bw=el.offsetWidth,bh=el.offsetHeight,x=Math.max(12,Math.min(r.left+r.width/2-bw/2,vw-bw-12)),below=r.bottom+10+bh<=vh-8||r.top-10-bh<8,y=below?r.bottom+10:r.top-10-bh;
  el.style.left=Math.round(x)+"px";el.style.top=Math.round(y)+"px";el.setAttribute("data-pos",below?"below":"above");
  el.style.setProperty("--ax",Math.round(r.left+r.width/2-x)+"px");
}
function tipHide(force){if(TIP.pinned&&!force)return;clearTimeout(TIP.t);if(TIP.el)TIP.el.hidden=true;if(TIP.for){TIP.for.removeAttribute("aria-describedby");TIP.for.setAttribute("aria-expanded","false")}TIP.for=null;TIP.pinned=false}
document.addEventListener("mouseover",function(e){var b=e.target.closest&&e.target.closest(".hlp[data-tip]");if(b&&!TIP.pinned)tipShow(b)});
document.addEventListener("mouseout",function(e){var b=e.target.closest&&e.target.closest(".hlp[data-tip]");if(b&&!TIP.pinned&&!(e.relatedTarget&&b.contains(e.relatedTarget)))TIP.t=setTimeout(function(){tipHide()},120)});
document.addEventListener("focusin",function(e){var b=e.target.closest&&e.target.closest(".hlp[data-tip]");if(b&&!TIP.pinned)tipShow(b)});
document.addEventListener("focusout",function(e){var b=e.target.closest&&e.target.closest(".hlp[data-tip]");if(b)tipHide(true)});
document.addEventListener("click",function(e){
  var b=e.target.closest&&e.target.closest(".hlp[data-tip]");
  if(b){e.preventDefault();if(TIP.for===b&&TIP.pinned)tipHide(true);else tipShow(b,true);return}
  if(TIP.pinned&&!(e.target.closest&&e.target.closest(".tipbox")))tipHide(true);
},true);
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&TIP.for)tipHide(true)});
window.addEventListener("scroll",function(){if(TIP.for)tipHide(true)},true);
window.addEventListener("resize",function(){if(TIP.for)tipHide(true)});

/* ---------- Navigation ---------- */
function setDrawer(open){$("side").classList.toggle("open",open);$("backdrop").hidden=!open;$("menuBtn").setAttribute("aria-expanded",open?"true":"false")}
function showView(v,anchor){
  if(!VIEWS[v])v="dashboard";curView=v;
  var own=OWNER[v];
  if((own==="fin"||own==="both")&&stale.fin){stale.fin=false;FINm.render()}
  if((own==="dep"||own==="both")&&stale.dep){stale.dep=false;DEPm.render()}
  Array.prototype.forEach.call(document.querySelectorAll(".view"),function(el){el.hidden=el.getAttribute("data-view")!==v});
  Array.prototype.forEach.call(document.querySelectorAll("#nav a"),function(a){if(a.getAttribute("data-view")===v)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  $("viewTitle").textContent=VIEWS[v];document.title=VIEWS[v]+" · Meine Finanzen";setDrawer(false);
  try{if(location.hash!=="#"+v)history.replaceState(null,"","#"+v)}catch(e){}
  if(v==="einstellungen")renderShellSettings();
  if(v==="dashboard")renderDash();
  DEPm.onView(v,anchor);
  var el=anchor&&$(anchor);
  if(el){if(el.tagName==="DETAILS")el.open=true;setTimeout(function(){try{el.scrollIntoView({block:"start"})}catch(e){}},0)}
  else try{window.scrollTo(0,0)}catch(e){}
}
$("nav").addEventListener("click",function(e){var a=e.target.closest("a[data-view]");if(!a)return;e.preventDefault();showView(a.getAttribute("data-view"))});
document.addEventListener("click",function(e){var b=e.target.closest("[data-go]");if(!b||!D)return;e.preventDefault();var g=b.getAttribute("data-go").split("#");showView(g[0],g[1])});
$("menuBtn").addEventListener("click",function(){setDrawer(!$("side").classList.contains("open"))});
$("backdrop").addEventListener("click",function(){setDrawer(false)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&$("side").classList.contains("open"))setDrawer(false)});
window.addEventListener("hashchange",function(){
  if(/^#(verify|reset)=|^#forgot$/.test(location.hash)&&!$("gate").hidden){handleAuthHash(REG);return}
  var v=location.hash.slice(1);if(D&&VIEWS[v]&&v!==curView)showView(v);
});

/* ---------- Abschnitte, Darstellung, Meldungen ---------- */
var applyingSect=false;
function applySect(){
  applyingSect=true;var c=(D&&D.settings.collapsed)||{};
  Array.prototype.forEach.call(document.querySelectorAll("details.sect"),function(el){var v=c[el.getAttribute("data-sec")];el.open=v==null?el.getAttribute("data-default")!=="closed":!v});
  setTimeout(function(){applyingSect=false},0);
}
Array.prototype.forEach.call(document.querySelectorAll("details.sect"),function(el){
  el.addEventListener("toggle",function(){if(!D||applyingSect)return;D.settings.collapsed[el.getAttribute("data-sec")]=!el.open;changed(null,true)});
});
function applyLook(){
  var root=document.documentElement;
  if(D){root.setAttribute("data-scheme",D.settings.scheme||"smooth");if(D.settings.compact)root.setAttribute("data-compact","");else root.removeAttribute("data-compact")}
  else{root.removeAttribute("data-scheme");root.removeAttribute("data-compact")}
}
$("schemes").addEventListener("change",function(e){D.settings.scheme=e.target.value;changed(null);applyLook();setMsg("lookMsg","Farbschema gespeichert.")});
$("setCompact").addEventListener("change",function(){D.settings.compact=this.checked;changed(null);applyLook();setMsg("lookMsg",this.checked?"Kompakte Ansicht aktiv.":"Normale Ansicht aktiv.")});
function setMsg(id,t,bad){var e=$(id);if(!e)return;e.textContent=t;e.className="msg"+(bad?" bad":"")+(e.classList.contains("noprint")?" noprint":"")}
function armed(btn,label,cb){
  if(!btn.classList.contains("armed")){var old=btn.textContent;btn.classList.add("armed");btn.textContent=label;btn._t=setTimeout(function(){btn.classList.remove("armed");btn.textContent=old},4000);btn._old=old;return}
  clearTimeout(btn._t);btn.classList.remove("armed");btn.textContent=btn._old;cb();
}
var EMBED=(function(){try{return window.self!==window.top}catch(e){return true}})();
function download(name,text,type){
  if(EMBED)return false;
  try{var blob=new Blob([text],{type:type||"text/plain"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(url);a.remove()},1000);return true}catch(e){return false}
}
function renderAll(){if(!D)return;FINm.render();DEPm.render();stale.fin=stale.dep=false;renderHead();if(curView==="einstellungen")renderShellSettings();renderDash()}
var dashT=null;
function renderDash(){
  try{var F=window.FIN&&FIN.summary&&D?FIN.summary():null;if(F){var v=0;F.accounts.forEach(function(a){v+=a.now});var dv=DEPm.value();$("nmDash").textContent=new Intl.NumberFormat("de-DE",{maximumFractionDigits:0}).format((v+(dv||0))/100)+" €"}}catch(e){}
  if(curView==="dashboard"&&window.DASH)DASH.render();
}
function renderDashSoon(){clearTimeout(dashT);dashT=setTimeout(renderDash,250)}
function renderHead(){
  $("profName").textContent=P.name;
  $("previewBar").hidden=!PREVIEW;
}

/* ---------- Anmeldung, Registrierung, Passwort vergessen, Zwei-Faktor ---------- */
var GATE={mode:"login",email:"",pw:"",remember:true,reset:null,resend:""};
var EMAIL_OK=function(m){return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)};
function gateMode(m){
  GATE.mode=m;
  ["gLogin","gTotp","gReg","gForgot","gReset","gInfo"].forEach(function(id){$(id).hidden=id!=={login:"gLogin",totp:"gTotp",reg:"gReg",forgot:"gForgot",reset:"gReset",info:"gInfo"}[m]});
  var tabs=(m==="login"||m==="reg")&&REG&&REG.open&&!REG.first;
  $("gTabs").hidden=!tabs;
  $("gTabLogin").setAttribute("aria-selected",m==="login"?"true":"false");$("gTabReg").setAttribute("aria-selected",m==="reg"?"true":"false");
  $("gForgotLnk").hidden=!(REG&&REG.reset);
  ["gErr","gTotpErr","gRErr","gFErr","gNErr"].forEach(function(id){$(id).textContent=""});
  var f={login:$("gEmail").value?"gPw":"gEmail",totp:"gCode",reg:"gRName",forgot:"gFEmail",reset:"gNPw"}[m];
  if(f)setTimeout(function(){try{$(f).focus()}catch(e){}},0);
}
function showGate(reg,note,mode){
  REG=reg||REG||{open:false};$("boot").hidden=true;$("app").hidden=true;$("gate").hidden=false;applyLook();document.title="Anmelden · Meine Finanzen";
  $("gNote").hidden=!note;$("gNoteTxt").innerHTML=note||"";
  $("gSub").textContent=REG.first?"Willkommen! Lege das erste Konto an. Es wird Verwalter dieser Seite.":"Konten, Finanzplan und Depot an einem Ort.";
  $("gRInvWrap").hidden=!REG.invite;$("gRVerifyHint").hidden=!(REG.verify&&!REG.first);
  if(REG.min)$("gRPwHint").textContent="Mindestens "+REG.min+" Zeichen. Ein kurzer Satz ist leichter zu merken als Sonderzeichen.";
  gateMode(mode||(REG.first?"reg":"login"));
}
function gateInfo(icon,html,resendEmail){
  $("gInfoIcon").textContent=icon;$("gInfoTxt").innerHTML=html;$("gInfoMsg").textContent="";
  GATE.resend=resendEmail||"";$("gResend").hidden=!resendEmail;gateMode("info");
}
document.addEventListener("click",function(e){var b=e.target.closest("[data-gm]");if(!b||$("gate").hidden)return;e.preventDefault();var m=b.getAttribute("data-gm");if(m==="forgot")$("gFEmail").value=$("gEmail").value;gateMode(m)});
/* Passwort anzeigen */
document.addEventListener("click",function(e){var b=e.target.closest("[data-eye]");if(!b)return;var i=$(b.getAttribute("data-eye")),show=i.type==="password";i.type=show?"text":"password";b.classList.toggle("on",show);b.setAttribute("aria-label",show?"Passwort verbergen":"Passwort anzeigen");b.title=b.getAttribute("aria-label")});
/* Passwortstärke (grobe Schätzung, nur als Hilfe) */
function pwScore(p){
  if(!p)return 0;var s=0,cls=0;
  [/[a-z]/,/[A-Z]/,/[0-9]/,/[^A-Za-z0-9]/].forEach(function(r){if(r.test(p))cls++});
  if(p.length>=10)s++;if(p.length>=14)s++;if(p.length>=20)s++;if(cls>=3)s++;
  if(/^(.)\1+$/.test(p)||/^(123|abc|qwe|pass|geheim|hallo)/i.test(p))s=Math.min(s,1);
  return Math.max(1,Math.min(4,s));
}
function meter(inp,box){
  var upd=function(){var v=$(inp).value,sc=v?pwScore(v):0,t=["","schwach","geht so","gut","sehr gut"][sc];
    $(box).setAttribute("data-s",sc);$(box).title=t?"Stärke: "+t:"";
    Array.prototype.forEach.call($(box).children,function(el,i){el.className=i<sc?"on":""})};
  $(inp).addEventListener("input",upd);upd();
}
meter("gRPw","gRMeter");meter("gNPw","gNMeter");
function minPw(){return (REG&&REG.min)||10}
function checkNewPw(p1,p2){
  if(p1.length<minPw())return "Das Passwort braucht mindestens "+minPw()+" Zeichen.";
  if(p1!==p2)return "Die beiden Passwörter stimmen nicht überein.";
  return "";
}
function busy(btn,on){$(btn).disabled=on;$(btn).classList.toggle("busy",on)}

/* Anmelden (mit optionalem zweiten Schritt) */
function doLogin(code){
  var errId=code!=null?"gTotpErr":"gErr";
  busy(code!=null?"gTotpGo":"gGo",true);$("gUnverified").hidden=true;
  return api("POST","/api/auth/login",{email:GATE.email,password:GATE.pw,code:code||"",remember:GATE.remember}).then(function(){
    GATE.pw="";$("gPw").value="";$("gCode").value="";return afterLogin();
  }).catch(function(err){
    var need=err.data&&err.data.need;
    if(need==="totp"&&code==null){gateMode("totp");return}
    if(need==="verify"){$("gUnverified").hidden=false;GATE.resend=GATE.email}
    $(errId).textContent=err.message;
    if(code!=null){$("gCode").select()}else $("gPw").select();
  }).then(function(){busy("gGo",false);busy("gTotpGo",false)});
}
$("gLogin").addEventListener("submit",function(e){
  e.preventDefault();GATE.email=$("gEmail").value.trim();GATE.pw=$("gPw").value;GATE.remember=$("gRemember").checked;
  if(!GATE.email||!GATE.pw){$("gErr").textContent="Bitte E-Mail und Passwort eingeben.";return}
  doLogin(null);
});
$("gTotp").addEventListener("submit",function(e){
  e.preventDefault();var c=$("gCode").value.trim();
  if(!c){$("gTotpErr").textContent="Bitte den Code eingeben.";return}
  doLogin(c);
});
$("gCode").addEventListener("input",function(){var v=this.value.replace(/\s/g,"");if(/^\d{6}$/.test(v))$("gTotp").requestSubmit?$("gTotp").requestSubmit():doLogin(v)});

/* Registrieren */
$("gReg").addEventListener("submit",function(e){
  e.preventDefault();var n=$("gRName").value.trim(),em=$("gREmail").value.trim(),p1=$("gRPw").value,p2=$("gRPw2").value,err=$("gRErr");
  if(!n){err.textContent="Bitte deinen Namen eingeben.";$("gRName").focus();return}
  if(!EMAIL_OK(em)){err.textContent="Bitte eine gültige E-Mail-Adresse eingeben.";$("gREmail").focus();return}
  var bad=checkNewPw(p1,p2);if(bad){err.textContent=bad;return}
  if(REG.invite&&!$("gRInv").value.trim()){err.textContent="Bitte den Einladungscode eingeben.";$("gRInv").focus();return}
  busy("gRGo",true);err.textContent="";
  api("POST","/api/auth/register",{email:em,name:n,password:p1,invite:$("gRInv").value.trim()}).then(function(j){
    $("gRPw").value=$("gRPw2").value="";$("gRPw").dispatchEvent(new Event("input"));
    if(j.verify){
      $("gEmail").value=em;
      gateInfo("✉","<b>Fast geschafft!</b><br>Wir haben dir eine Mail an <b>"+esc(j.email||em)+"</b> geschickt. Klick auf den Link darin, um dein Konto zu bestätigen. Danach bist du direkt angemeldet."+(j.mail_error?"<br><br><span class=\"neg\">Die Mail konnte gerade nicht verschickt werden. Versuch es gleich noch einmal mit „Link erneut senden“.</span>":"")+"<br><br><small>Nichts angekommen? Schau auch im Spam-Ordner nach.</small>",em);
      return;
    }
    return afterLogin();
  }).catch(function(x){err.textContent=x.message}).then(function(){busy("gRGo",false)});
});
function resend(email,msgId){
  return api("POST","/api/auth/verify/resend",{email:email}).then(function(){setMsg(msgId,"Neuer Link ist unterwegs. Er gilt 48 Stunden.")}).catch(function(x){setMsg(msgId,x.message,true)});
}
$("gResend").addEventListener("click",function(){resend(GATE.resend,"gInfoMsg")});
$("gResend2").addEventListener("click",function(){resend(GATE.resend||$("gEmail").value.trim(),"gErr")});

/* Passwort vergessen */
$("gForgot").addEventListener("submit",function(e){
  e.preventDefault();var em=$("gFEmail").value.trim();
  if(!EMAIL_OK(em)){$("gFErr").textContent="Bitte eine gültige E-Mail-Adresse eingeben.";return}
  busy("gFGo",true);
  api("POST","/api/auth/forgot",{email:em}).then(function(){
    gateInfo("✉","<b>Schau in dein Postfach.</b><br>Wenn es zu <b>"+esc(em)+"</b> ein Konto gibt, ist ein Link zum Zurücksetzen unterwegs. Er gilt 60 Minuten.<br><br><small>Nichts angekommen? Spam-Ordner prüfen oder in ein paar Minuten noch einmal anfordern.</small>");
  }).catch(function(x){$("gFErr").textContent=x.message}).then(function(){busy("gFGo",false)});
});

/* Neues Passwort aus dem Mail-Link */
$("gReset").addEventListener("submit",function(e){
  e.preventDefault();var p1=$("gNPw").value,p2=$("gNPw2").value,bad=checkNewPw(p1,p2);
  if(bad){$("gNErr").textContent=bad;return}
  if(!$("gNCodeWrap").hidden&&!$("gNCode").value.trim()){$("gNErr").textContent="Bitte den Code aus der Authenticator-App eingeben.";$("gNCode").focus();return}
  busy("gNGo",true);
  api("POST","/api/auth/reset",{token:GATE.reset,password:p1,code:$("gNCode").value.trim()}).then(function(){
    GATE.reset=null;$("gNPw").value=$("gNPw2").value=$("gNCode").value="";return afterLogin();
  }).catch(function(x){if(x.data&&x.data.need==="totp")$("gNCodeWrap").hidden=false;$("gNErr").textContent=x.message}).then(function(){busy("gNGo",false)});
});

/* Links aus Mails: #verify=…, #reset=…, #forgot */
function handleAuthHash(reg){
  var h=location.hash.slice(1),m=/^(verify|reset)=([A-Za-z0-9_\-]{20,100})$/.exec(h),rg=/^register=(.+)$/.exec(h);
  if(rg){try{history.replaceState(null,"",location.pathname+location.search)}catch(e){}
    var em=decodeURIComponent(rg[1]);showGate(Object.assign({},reg,{invite:false}),"<b>Du wurdest eingeladen.</b> Lege mit <b>"+esc(em)+"</b> ein Konto an, dann siehst du das geteilte Konto.","reg");$("gREmail").value=em;return true}
  if(!m&&h!=="forgot")return false;
  try{history.replaceState(null,"",location.pathname+location.search)}catch(e){}
  if(h==="forgot"){showGate(reg,null,"forgot");return true}
  if(m[1]==="verify"){
    showGate(reg,null,"info");gateInfo("⏳","E-Mail-Adresse wird bestätigt …");$("gInfoBack").hidden=true;
    api("POST","/api/auth/verify",{token:m[2]}).then(function(){$("gInfoBack").hidden=false;return afterLogin()}).catch(function(x){
      $("gInfoBack").hidden=false;gateInfo("⚠","<b>Bestätigung nicht möglich.</b><br>"+esc(x.message));
    });
    return true;
  }
  showGate(reg,null,"info");gateInfo("⏳","Link wird geprüft …");
  api("POST","/api/auth/reset/check",{token:m[2]}).then(function(j){
    GATE.reset=m[2];$("gResetMail").textContent=j.email;$("gNCodeWrap").hidden=!j.totp;gateMode("reset");
  }).catch(function(x){gateInfo("⚠","<b>Link ungültig.</b><br>"+esc(x.message)+'<br><br><button class="btn" type="button" data-gm="forgot">Neuen Link anfordern</button>')});
  return true;
}
function setUser(u){USER=u;P.name=u.name;P.email=u.email;P.id=u.id}
function refreshMe(){return api("GET","/api/auth/me").then(function(j){if(j.user)setUser(j.user);return j.user})}
function afterLogin(){
  return refreshMe().then(function(u){
    if(!u)throw new Error("Anmeldung fehlgeschlagen.");
    if(SYNC.lost&&D&&SYNC.userId===u.id){SYNC.lost=false;$("gate").hidden=true;$("app").hidden=false;pushNow();return}
    if(SYNC.lost){location.reload();return}
    return loadData(true);
  });
}
function sessionLost(){
  if(SYNC.lost||!D)return;SYNC.lost=true;
  showGate(Object.assign({},REG||{},{open:false,first:false,invite:false}),"<b>Sitzung abgelaufen.</b> Bitte neu anmelden. Nicht gespeicherte Änderungen bleiben erhalten.","login");
  $("gEmail").value=P.email;
}
function logout(all){
  var go=function(){api("POST",all?"/api/auth/logout-all":"/api/auth/logout",{}).catch(function(){}).then(function(){location.hash="";location.reload()})};
  if(pending()){pushNow();setTimeout(go,1200)}else go();
}
$("lockBtn").addEventListener("click",function(){if(PREVIEW)return;logout(false)});

/* ---------- Laden ---------- */
function loadData(first){
  setSync("loading");
  return api("GET","/api/data").then(function(j){applyServer(j,first)}).catch(function(e){
    if(e.status===401)return;
    if(window.console)console.error("Laden fehlgeschlagen:",e&&e.stack||e);
    if(!started){$("bootMsg").textContent="Daten konnten nicht geladen werden: "+e.message;$("boot").hidden=false;$("gate").hidden=true;return}
    setSync("error");showSyncBar("<b>Neu laden nicht möglich.</b> "+esc(e.message),false);
  });
}
function applyServer(j,first){
  var o=fromServer(j,D),snap=flat(o);   /* Stand des Servers, vor dem Normalisieren */
  D=normalizeAll(o);SYNC.rev=j.rev;SYNC.srev=j.srev;SYNC.userId=P.id;
  FINm.setD(D);DEPm.setD(D);
  SYNC.snap=snap;
  /* Normalisieren kann Kleinigkeiten ergänzen (z. B. erstes Depot): einmal nachschieben */
  if(!PREVIEW&&pending())schedule(800);else setSync(PREVIEW?"preview":"ok");
  if(!started||first){
    started=true;FINm.start();DEPm.start();
    $("boot").hidden=true;$("gate").hidden=true;$("app").hidden=false;
    applyLook();applySect();renderAll();
    var hv=location.hash.slice(1);showView(VIEWS[hv]?hv:"dashboard");
    DEPm.refresh();checkLocalOld();
  } else {applyLook();renderAll()}
}

/* ---------- Gemeinsame Einstellungen ---------- */
function renderShellSettings(){
  if(document.activeElement!==$("uName"))$("uName").value=P.name;$("uEmail").value=P.email||"";
  $("userMeta").textContent=PREVIEW?"Vorschau":(USER.is_admin?"Verwalter · ":"")+(P.email||"");
  $("setCompact").checked=!!D.settings.compact;
  Array.prototype.forEach.call(document.querySelectorAll('input[name="scheme"]'),function(r){r.checked=r.value===(D.settings.scheme||"smooth")});
  var n=D.accounts.length+" Konten, "+D.tx.length+" Buchungen, "+D.pos.length+" Positionen";$("dataMeta").textContent=n;
  renderTfa();renderShares();
}
$("uName").addEventListener("change",function(){var v=this.value.trim();if(!v){this.value=P.name;return}api("POST","/api/auth/profile",{name:v}).then(function(){P.name=v;USER.name=v;renderAll();setMsg("userMsg","Name gespeichert.")}).catch(function(e){setMsg("userMsg",e.message,true)})});
$("uPwSave").addEventListener("click",function(){
  var o=$("uPwOld").value,n=$("uPwNew").value,n2=$("uPwNew2").value;
  if(!o){setMsg("userMsg","Bitte das bisherige Passwort eingeben.",true);return}
  if(n.length<10){setMsg("userMsg","Das neue Passwort braucht mindestens 10 Zeichen.",true);return}
  if(n!==n2){setMsg("userMsg","Die neuen Passwörter stimmen nicht überein.",true);return}
  api("POST","/api/auth/password",{old:o,new:n}).then(function(){$("uPwOld").value=$("uPwNew").value=$("uPwNew2").value="";setMsg("userMsg","Passwort geändert. Andere Geräte sind abgemeldet.")}).catch(function(e){setMsg("userMsg",e.message,true)});
});
$("uLogoutAll").addEventListener("click",function(){var b=this;armed(b,"Wirklich überall abmelden?",function(){logout(true)})});
$("uLogout").addEventListener("click",function(){logout(false)});
$("delAcc").addEventListener("click",function(){var b=this,pw=$("delPw").value;if(!pw){setMsg("delMsg","Bitte zur Bestätigung dein Passwort eingeben.",true);return}
  if(USER.totp&&!$("delCode").value.trim()){setMsg("delMsg","Bitte zusätzlich den Code aus der Authenticator-App eingeben.",true);return}
  armed(b,"Endgültig löschen? Das geht nicht rückgängig.",function(){api("POST","/api/auth/delete",{password:pw,code:$("delCode").value.trim()}).then(function(){D=null;location.hash="";location.reload()}).catch(function(e){setMsg("delMsg",e.message,true)})})});


/* ---------- Zwei-Faktor einrichten ---------- */
var TFA={setup:false,codes:null};
function renderTfa(){
  var on=!!USER.totp;
  $("tfaState").textContent=on?"an":"aus";$("tfaState").className="tfastate"+(on?" on":"");
  $("tfaIntro").hidden=on;$("tfaStart").hidden=on||TFA.setup||!!TFA.codes;$("tfaSetupBox").hidden=!TFA.setup;
  $("tfaCodesBox").hidden=!TFA.codes;$("tfaOn").hidden=!on||!!TFA.codes;
  $("delCodeWrap").hidden=!on;
  if(on&&!TFA.codes&&USER.recovery_left!=null)$("tfaState").textContent="an · "+USER.recovery_left+" Notfall-Codes übrig";
}
$("tfaSetup").addEventListener("click",function(){
  var pw=$("tfaPw").value;if(!pw){setMsg("tfaMsg","Bitte zur Sicherheit dein Passwort eingeben.",true);$("tfaPw").focus();return}
  api("POST","/api/auth/totp/setup",{password:pw}).then(function(j){
    $("tfaPw").value="";TFA.setup=true;$("tfaQr").innerHTML=j.svg;$("tfaKey").textContent=j.secret.replace(/(.{4})/g,"$1 ").trim();
    setMsg("tfaMsg","");renderTfa();setTimeout(function(){$("tfaCode").focus()},0);
  }).catch(function(e){setMsg("tfaMsg",e.message,true)});
});
$("tfaCancel").addEventListener("click",function(){TFA.setup=false;$("tfaQr").innerHTML="";renderTfa();setMsg("tfaMsg","")});
$("tfaEnable").addEventListener("click",function(){
  var c=$("tfaCode").value.replace(/\s/g,"");if(!/^\d{6}$/.test(c)){setMsg("tfaMsg","Bitte den 6-stelligen Code aus der App eingeben.",true);return}
  api("POST","/api/auth/totp/enable",{code:c}).then(function(j){
    TFA.setup=false;TFA.codes=j.recovery;$("tfaCode").value="";$("tfaQr").innerHTML="";showCodes();
    return refreshMe();
  }).then(function(){renderTfa();setMsg("tfaMsg","Zwei-Faktor ist eingeschaltet. Ab jetzt fragt die Anmeldung nach dem Code.")}).catch(function(e){setMsg("tfaMsg",e.message,true)});
});
function showCodes(){$("tfaCodes").innerHTML=TFA.codes.map(function(c){return "<li><code>"+esc(c)+"</code></li>"}).join("")}
function codesText(){return "Meine Finanzen – Notfall-Codes für "+P.email+"\nErstellt am "+new Date().toLocaleDateString("de-DE")+". Jeder Code funktioniert genau einmal.\n\n"+TFA.codes.join("\n")+"\n"}
$("tfaCodesDl").addEventListener("click",function(){if(!download("Meine_Finanzen_Notfall-Codes.txt",codesText(),"text/plain"))setMsg("tfaMsg","Download hier nicht möglich. Bitte die Codes abschreiben oder kopieren.",true)});
$("tfaCodesCopy").addEventListener("click",function(){try{navigator.clipboard.writeText(codesText()).then(function(){setMsg("tfaMsg","Kopiert.")},function(){setMsg("tfaMsg","Kopieren nicht möglich.",true)})}catch(e){setMsg("tfaMsg","Kopieren nicht möglich.",true)}});
$("tfaCodesDone").addEventListener("click",function(){TFA.codes=null;$("tfaCodes").innerHTML="";renderTfa();setMsg("tfaMsg","")});
$("tfaNewCodes").addEventListener("click",function(){
  var pw=$("tfaOffPw").value;if(!pw){setMsg("tfaMsg","Bitte dein Passwort eingeben.",true);$("tfaOffPw").focus();return}
  api("POST","/api/auth/totp/recovery",{password:pw}).then(function(j){$("tfaOffPw").value="";TFA.codes=j.recovery;showCodes();return refreshMe()}).then(function(){renderTfa();setMsg("tfaMsg","Neue Notfall-Codes erstellt. Die alten gelten nicht mehr.")}).catch(function(e){setMsg("tfaMsg",e.message,true)});
});
$("tfaOff").addEventListener("click",function(){
  var b=this,pw=$("tfaOffPw").value,c=$("tfaOffCode").value.trim();
  if(!pw||!c){setMsg("tfaMsg","Zum Ausschalten bitte Passwort und Code eingeben.",true);return}
  armed(b,"Wirklich ausschalten?",function(){
    api("POST","/api/auth/totp/disable",{password:pw,code:c}).then(function(){$("tfaOffPw").value=$("tfaOffCode").value="";return refreshMe()}).then(function(){renderTfa();setMsg("tfaMsg","Zwei-Faktor ist ausgeschaltet.")}).catch(function(e){setMsg("tfaMsg",e.message,true)});
  });
});


/* ---------- Konten teilen ---------- */
var PERM={write:"ansehen und buchen",read:"nur ansehen"};
function sharedBadge(accId){
  var n=(SHARES||[]).filter(function(x){return x.dir==="out"&&x.account===accId});
  return n.length?' <span class="kind shared">geteilt mit '+esc(n.map(function(x){return x.name||x.email}).join(", "))+"</span>":"";
}
function renderShares(){
  if(!D)return;
  var own=FINm.own(),sel=$("shAcc"),keep=sel.value;
  sel.innerHTML=own.map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+"</option>"}).join("")||'<option value="">Erst ein Konto anlegen</option>';
  if(keep&&sel.getAttribute("data-touched")&&own.some(function(a){return a.id===keep}))sel.value=keep;
  else{var h=own.filter(function(a){return a.kind==="haushalt"})[0];if(h)sel.value=h.id}
  var out=SHARES.filter(function(x){return x.dir==="out"}),inn=SHARES.filter(function(x){return x.dir==="in"});
  $("shOutWrap").hidden=!out.length;$("shInWrap").hidden=!inn.length;
  $("shOut").innerHTML=out.map(function(x){
    return '<li><span class="what"><b>'+esc(x.account_name)+"</b> → "+esc(x.name||x.email)+"<small>"+esc(x.email)+(x.pending?" · Einladung offen, noch nicht registriert":"")+'</small></span><span class="acts">'+
      '<select data-shperm="'+esc(x.id)+'" aria-label="Recht für '+esc(x.email)+'"><option value="write"'+(x.perm==="write"?" selected":"")+'>ansehen und buchen</option><option value="read"'+(x.perm==="read"?" selected":"")+'>nur ansehen</option></select>'+
      '<button class="btn" type="button" data-shdel="'+esc(x.id)+'">Zurücknehmen</button></span></li>';
  }).join("");
  $("shIn").innerHTML=inn.map(function(x){
    return '<li><span class="what"><b>'+esc(x.account_name)+"</b> von "+esc(x.owner)+"<small>"+esc(x.owner_email)+" · "+PERM[x.perm]+'</small></span><span class="acts"><button class="btn" type="button" data-shleave="'+esc(x.id)+'">Verlassen</button></span></li>';
  }).join("");
  $("shareMeta").textContent=(out.length?out.length+" geteilt":"")+(out.length&&inn.length?" · ":"")+(inn.length?inn.length+" für dich":"");
}
function reloadShares(msg){return api("GET","/api/shares").then(function(j){SHARES=j.shares||[];renderShares();FINm.render();if(msg)setMsg("shMsg",msg)})}
$("shAcc").addEventListener("change",function(){this.setAttribute("data-touched","1")});
$("shGo").addEventListener("click",function(){
  var acc=$("shAcc").value,em=$("shMail").value.trim(),pm=$("shPerm").value;
  if(!acc){setMsg("shMsg","Bitte zuerst ein Konto anlegen.",true);return}
  if(!EMAIL_OK(em)){setMsg("shMsg","Bitte eine gültige E-Mail-Adresse eingeben.",true);$("shMail").focus();return}
  if(pending())pushNow();   /* neues Konto zuerst speichern */
  var go=function(){return api("POST","/api/shares",{account:acc,email:em,perm:pm})};
  (SYNC.inflight||SYNC.timer?new Promise(function(r){setTimeout(r,1500)}).then(go):go()).then(function(j){
    $("shMail").value="";
    var an=(FINm.own().filter(function(a){return a.id===acc})[0]||{}).name||"Konto";
    var t=j.updated?"Recht für "+em+" geändert.":j.registered?"„"+an+"“ ist für "+em+" freigegeben"+(j.mail?" und eine Mail ist unterwegs.":". Die Mail konnte nicht verschickt werden, die Freigabe gilt trotzdem."):
      "Einladung an "+em+(j.mail?" verschickt.":" angelegt (Mail nicht verschickt).")+" Sobald sich die Person mit dieser Adresse registriert, sieht sie „"+an+"“.";
    return reloadShares(t);
  }).catch(function(e){setMsg("shMsg",e.message,true)});
});
$("shOut").addEventListener("change",function(e){var s=e.target.closest("[data-shperm]");if(!s)return;
  api("POST","/api/shares/"+s.getAttribute("data-shperm")+"/perm",{perm:s.value}).then(function(){return reloadShares("Gespeichert: "+PERM[s.value]+".")}).catch(function(x){setMsg("shMsg",x.message,true)})});
$("shOut").addEventListener("click",function(e){var b=e.target.closest("[data-shdel]");if(!b)return;
  armed(b,"Wirklich zurücknehmen?",function(){api("DELETE","/api/shares/"+b.getAttribute("data-shdel")).then(function(){return reloadShares("Freigabe zurückgenommen.")}).catch(function(x){setMsg("shMsg",x.message,true)})})});
$("shIn").addEventListener("click",function(e){var b=e.target.closest("[data-shleave]");if(!b)return;
  armed(b,"Verlassen? Du siehst das Konto dann nicht mehr.",function(){
    if(pending())pushNow();
    api("DELETE","/api/shares/"+b.getAttribute("data-shleave")).then(function(){setMsg("shMsg","Freigabe verlassen.");return loadData(false)}).catch(function(x){setMsg("shMsg",x.message,true)})})});

/* Export */
$("xAll").addEventListener("click",function(){
  var t=JSON.stringify(toExport(D),null,1),ok=download("Meine_Finanzen_"+P.name.replace(/\W+/g,"_")+"_"+keyOfD(new Date())+".json",t,"application/json");
  if(!ok){$("mgTxt").value=t}
  setMsg("mgMsg",ok?"Export heruntergeladen. Die Datei ist unverschlüsselt, bewahre sie sicher auf.":"Download hier nicht möglich, der Export steht im Textfeld.");
});

/* Umzug: alte verschlüsselte Sicherungen (AES-GCM, PBKDF2) und eigener Export */
var TE=new TextEncoder(),TDc=new TextDecoder();
function unb64(s){var r=atob(s),b=new Uint8Array(r.length);for(var i=0;i<r.length;i++)b[i]=r.charCodeAt(i);return b}
function decryptOld(o,pin){
  if(!(window.crypto&&crypto.subtle))return Promise.reject("Entschlüsseln geht nur über https://.");
  return crypto.subtle.importKey("raw",TE.encode(pin),"PBKDF2",false,["deriveKey"]).then(function(base){
    return crypto.subtle.deriveKey({name:"PBKDF2",salt:unb64(o.salt),iterations:o.it||250000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]);
  }).then(function(k){return crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(o.iv)},k,unb64(o.ct))}).then(function(pt){return JSON.parse(TDc.decode(pt))})
  .catch(function(){return Promise.reject("Entschlüsseln nicht möglich. Stimmt die PIN der Sicherung?")});
}
function readMigration(){
  var raw=$("mgTxt").value.trim();if(!raw)return Promise.reject("Bitte zuerst eine Datei wählen oder den Inhalt einfügen.");
  var o;try{o=JSON.parse(raw)}catch(e){return Promise.reject("Das ist keine gültige Sicherung.")}
  if(o&&o.type==="meine-finanzen-export")return Promise.resolve({kind:"export",data:o});
  if(o&&(o.type==="finanzkonto-backup"||o.type==="depot-backup")){
    var pin=$("mgPin").value;if(!pin)return Promise.reject("Bitte die PIN der Sicherung eingeben.");
    return decryptOld(o,pin).then(function(d){return {kind:o.type==="depot-backup"?"depot":"finanz",data:d,meta:o}});
  }
  return Promise.reject("Unbekanntes Format. Erwartet: Sicherung aus Mein Finanzkonto, Mein Depot oder ein Export von Meine Finanzen.");
}
function mergeResult(n,what){return n.added||n.updated?what+": "+n.added+" neu, "+n.updated+" aktualisiert. Wird jetzt gespeichert.":what+": nichts Neues, alles schon vorhanden."}
$("mgFile").addEventListener("change",function(){var f=this.files&&this.files[0];if(f)f.text().then(function(t){$("mgTxt").value=t;var o=null;try{o=JSON.parse(t)}catch(e){}
  setMsg("mgMsg",o&&o.type==="meine-finanzen-export"?"Export geladen. „Hinzufügen“ ergänzt, „Alles ersetzen“ stellt genau diesen Stand her.":o&&/backup$/.test(o.type||"")?"Sicherung geladen ("+(o.type==="depot-backup"?"Mein Depot":"Mein Finanzkonto")+", Profil „"+(o.profile||"?")+"“ vom "+(o.date||"?").split("-").reverse().join(".")+"). PIN eingeben und „Hinzufügen“.":"Datei geladen.")})});
$("mgGo").addEventListener("click",function(){
  readMigration().then(function(r){
    var n;
    if(r.kind==="finanz"){n=FINm.merge(r.data);if(r.data.settings&&r.data.settings.scheme&&D.accounts.length===n.added)D.settings.scheme=r.data.settings.scheme}
    else if(r.kind==="depot"){n=DEPm.merge(r.data);var s=r.data.settings||{};["benchmark","allowance","refresh"].forEach(function(k){if(s[k]!=null)D.settings[k]=s[k]})}
    else{var x=normalizeAll(fromServer(r.data));var a=FINm.merge(x),b=DEPm.merge(x);n={added:a.added+b.added,updated:a.updated+b.updated}}
    changed("both");renderAll();DEPm.refresh();
    setMsg("mgMsg",mergeResult(n,r.kind==="depot"?"Depot übernommen":r.kind==="finanz"?"Finanzkonto übernommen":"Export übernommen"));
    $("mgPin").value="";
  }).catch(function(m){setMsg("mgMsg",String(m&&m.message||m),true)});
});
$("mgReplace").addEventListener("click",function(){var b=this;readMigration().then(function(r){
  if(r.kind!=="export"){setMsg("mgMsg","Ersetzen geht nur mit einem Export von Meine Finanzen. Alte Sicherungen bitte „Hinzufügen“.",true);return}
  armed(b,"Alle Daten durch den Export ersetzen?",function(){
    var keep=D;D=normalizeAll(fromServer(r.data,keep));FINm.setD(D);DEPm.setD(D);FINm.start();DEPm.start();changed("both");applyLook();applySect();renderAll();DEPm.refresh();
    setMsg("mgMsg","Stand vom "+String(r.data.date||"").split("-").reverse().join(".")+" eingespielt. Wird jetzt gespeichert.");
  });
  if(b.classList.contains("armed"))setMsg("mgMsg","Zum Bestätigen noch einmal klicken.");
}).catch(function(m){setMsg("mgMsg",String(m&&m.message||m),true)})});
/* Liegen alte Profile im Browser (gleiche Adresse wie die alten Apps)? */
function checkLocalOld(){
  var found=[];
  [["finanzkonto.v1","finanzkonto-backup","Mein Finanzkonto"],["depot.v1","depot-backup","Mein Depot"]].forEach(function(k){
    try{var o=JSON.parse(localStorage.getItem(k[0])||"null");(o&&o.profiles||[]).forEach(function(p){if(p&&p.salt&&p.ct)found.push({type:k[1],app:k[2],p:p})})}catch(e){}
  });
  $("mgLocal").hidden=!found.length;if(!found.length)return;
  $("mgLocalTxt").textContent="Hier liegen noch Profile der bisherigen Apps. Antippen, PIN oben eintragen und „Hinzufügen“.";
  $("mgLocalList").innerHTML=found.map(function(f,i){return '<label><input type="radio" name="mgl" data-mgl="'+i+'"><span>'+esc(f.app)+" · Profil „"+esc(f.p.name)+"“</span></label>"}).join("");
  $("mgLocalList").onchange=function(e){var i=e.target.getAttribute("data-mgl");if(i==null)return;var f=found[+i];
    $("mgTxt").value=JSON.stringify({type:f.type,v:1,scope:"alles",profile:f.p.name,date:keyOfD(new Date()),salt:f.p.salt,it:f.p.it||250000,iv:f.p.iv,ct:f.p.ct});$("mgPin").focus()};
}

/* ---------- Start ---------- */
function boot(){
  FINm=window.FIN;DEPm=window.DEP;
  Array.prototype.forEach.call(document.querySelectorAll(".appver"),function(el){el.textContent=VERSION});
  Array.prototype.forEach.call(document.querySelectorAll(".appverlong"),function(el){el.textContent=VERSION+" vom "+VDATE.split("-").reverse().join(".")});
  setInterval(function(){if(!D)return;FINm.checkDay();DEPm.tick()},20000);
  setInterval(pollRev,60000);
  if(PREVIEW){setUser({id:"preview",name:"Vorschau",email:"vorschau@example.de",alert_mail:false,alert_email:"",mail_ready:false});applyServer({rev:0,settings:{}},true);return}
  api("GET","/api/auth/me").then(function(j){
    if(j.user&&!/^#(verify|reset)=/.test(location.hash)){setUser(j.user);return loadData(true)}
    var reg=j.registration||{open:false,reset:false};
    if(handleAuthHash(reg))return;
    showGate(reg);
  }).catch(function(e){$("bootMsg").textContent="Server nicht erreichbar: "+e.message+" Bitte später neu laden."});
}

return {VERSION:VERSION,VDATE:VDATE,$:$,esc:esc,P:P,VIEWS:VIEWS,api:api,boot:boot,changed:changed,showView:showView,setDrawer:setDrawer,applyLook:applyLook,applySect:applySect,
  setMsg:setMsg,armed:armed,download:download,sessionLost:sessionLost,refreshMe:refreshMe,user:function(){return USER},cashPicker:cashPicker,divAccOptions:divAccOptions,divAccLabel:divAccLabel,
  depotValue:function(){return DEPm?DEPm.value():null},sharedBadge:sharedBadge,preview:PREVIEW,_D:function(){return D},_export:function(){return toExport(D)},_sync:SYNC,_pending:pending,_push:pushNow};
})();
