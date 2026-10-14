/* ===================== Oberfläche ===================== */
var APP_VERSION="2.1.0", APP_DATE="2026-10-13";
var ROOTKEY="depot.v1", ITER=250000;
var $=function(id){return document.getElementById(id)};
var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};
var R=null,P=null,D=null,KEY=null,PIN=null,storageOK=true;
var ui={pos:null,range:"1y",dRange:"1y",editTx:null,txType:"buy",repY:new Date().getFullYear(),sel:null,depot:"",alloc:"pos",editPlan:null};

/* ---------- Verschlüsselung (AES-GCM, Schlüssel per PBKDF2 aus der PIN) ---------- */
var TE=new TextEncoder(),TD=new TextDecoder();
function cryptoOK(){return !!(window.crypto&&crypto.subtle&&crypto.getRandomValues)}
function b64(buf){var b=new Uint8Array(buf),s="";for(var i=0;i<b.length;i++)s+=String.fromCharCode(b[i]);return btoa(s)}
function unb64(s){var r=atob(s),b=new Uint8Array(r.length);for(var i=0;i<r.length;i++)b[i]=r.charCodeAt(i);return b}
function rnd(n){var b=new Uint8Array(n);crypto.getRandomValues(b);return b}
function deriveKey(pin,salt,it){
  return crypto.subtle.importKey("raw",TE.encode(pin),"PBKDF2",false,["deriveKey"]).then(function(base){
    return crypto.subtle.deriveKey({name:"PBKDF2",salt:unb64(salt),iterations:it,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  });
}
function seal(key,obj){var iv=rnd(12);return crypto.subtle.encrypt({name:"AES-GCM",iv:iv},key,TE.encode(JSON.stringify(obj))).then(function(ct){return {iv:b64(iv),ct:b64(ct)}})}
function unseal(key,iv,ct){return crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(iv)},key,unb64(ct)).then(function(pt){return JSON.parse(TD.decode(pt))})}

/* ---------- Speicher ---------- */
function loadRoot(){
  var raw=null;try{raw=localStorage.getItem(ROOTKEY)}catch(e){storageOK=false}
  var r={v:1,profiles:[]};
  if(raw){try{var o=JSON.parse(raw);if(o&&Array.isArray(o.profiles))r.profiles=o.profiles.filter(function(p){return p&&p.id&&p.salt&&p.ct})}catch(e){}}
  return r;
}
function writeRoot(){try{localStorage.setItem(ROOTKEY,JSON.stringify(R));storageOK=true}catch(e){storageOK=false}var b=$("storeBar");if(b)b.hidden=storageOK}
var chain=Promise.resolve();
function persist(){
  if(!D||!KEY||!P)return chain;
  var snap=JSON.parse(JSON.stringify(D)),k=KEY,p=P;
  chain=chain.then(function(){return seal(k,snap)}).then(function(s){p.iv=s.iv;p.ct=s.ct;p.u=Date.now();writeRoot()}).catch(function(){storageOK=false});
  return chain;
}
function save(){touch();persist()}

/* ---------- Profilwahl ---------- */
var pinTarget=null,pinFails=0,pinBlockedUntil=0;
function gateView(w){$("gChoose").hidden=w!=="choose";$("gPin").hidden=w!=="pin";$("gNew").hidden=w!=="new";$("gNewWrap").hidden=w!=="choose"}
function showGate(){
  applyLook();
  $("app").hidden=true;$("gate").hidden=false;
  $("gCrypto").hidden=cryptoOK();
  document.title="Mein Depot";
  if(!cryptoOK()){gateView("none");$("gNewWrap").hidden=true;return}
  if(R.profiles.length===1){askPin(R.profiles[0]);return}
  if(!R.profiles.length){openNew();return}
  listProfiles();
}
function listProfiles(){
  $("gList").innerHTML=R.profiles.map(function(p){return '<button class="pbtn" type="button" data-pid="'+esc(p.id)+'"><span>'+esc(p.name)+'</span><span class="meta"><span class="lock" aria-hidden="true"></span>verschlüsselt</span></button>'}).join("");
  gateView("choose");
}
function openNew(){$("gName").value="";$("gNewPin").value="";$("gNewPin2").value="";$("gNewErr").textContent="";gateView("new");$("gNewCancel").hidden=!R.profiles.length;setTimeout(function(){$("gName").focus()},0)}
function askPin(p){pinTarget=p;$("gPinIn").value="";$("gErr").textContent="";$("gPinName").textContent=p.name;gateView("pin");$("gBack").textContent=R.profiles.length>1?"Anderes Profil":"Neues Profil anlegen";setTimeout(function(){$("gPinIn").focus()},0)}
$("gList").addEventListener("click",function(e){var b=e.target.closest("[data-pid]");if(!b)return;var p=R.profiles.filter(function(x){return x.id===b.getAttribute("data-pid")})[0];if(p)askPin(p)});
$("gBack").addEventListener("click",function(){pinTarget=null;if(R.profiles.length>1)listProfiles();else openNew()});
$("gNewBtn").addEventListener("click",openNew);
$("gNewCancel").addEventListener("click",function(){R.profiles.length===1?askPin(R.profiles[0]):listProfiles()});
$("gPin").addEventListener("submit",function(e){
  e.preventDefault();
  var p=pinTarget,pin=$("gPinIn").value;if(!p||!pin)return;
  if(Date.now()<pinBlockedUntil){$("gErr").textContent="Zu viele Fehlversuche. Bitte "+Math.ceil((pinBlockedUntil-Date.now())/1000)+" Sekunden warten.";return}
  $("gPinGo").disabled=true;$("gErr").textContent="";
  var key;
  deriveKey(pin,p.salt,p.it||ITER).then(function(k){key=k;return unseal(k,p.iv,p.ct)}).then(function(data){
    pinFails=0;$("gPinGo").disabled=false;enter(p,key,pin,normalizeData(data));
  }).catch(function(){
    $("gPinGo").disabled=false;pinFails++;$("gPinIn").value="";$("gPinIn").focus();
    if(pinFails>=5){pinBlockedUntil=Date.now()+30000;pinFails=0;$("gErr").textContent="Zu viele Fehlversuche. Bitte 30 Sekunden warten."}
    else $("gErr").textContent="PIN falsch. Noch einmal versuchen.";
  });
});
$("gNew").addEventListener("submit",function(e){
  e.preventDefault();
  var name=$("gName").value.trim(),p1=$("gNewPin").value,p2=$("gNewPin2").value,err=$("gNewErr");
  if(!name){err.textContent="Bitte einen Profilnamen eingeben.";$("gName").focus();return}
  if(R.profiles.some(function(p){return p.name.toLowerCase()===name.toLowerCase()})){err.textContent="Diesen Profilnamen gibt es hier schon.";return}
  if(p1.length<4){err.textContent="Die PIN braucht mindestens 4 Zeichen.";$("gNewPin").focus();return}
  if(p1!==p2){err.textContent="Die beiden Eingaben stimmen nicht überein.";$("gNewPin2").focus();return}
  var p={id:newId(),name:name,salt:b64(rnd(16)),it:ITER},data=newData();
  deriveKey(p1,p.salt,p.it).then(function(k){return seal(k,data).then(function(s){p.iv=s.iv;p.ct=s.ct;R.profiles.push(p);writeRoot();enter(p,k,p1,data)})}).catch(function(){err.textContent="Profil konnte nicht angelegt werden."});
});

var lastAct=Date.now(),timersOn=false;
function enter(p,key,pin,data){
  P=p;KEY=key;PIN=pin;D=data;touch();
  ui.pos=null;ui.editTx=null;ui.sel=null;ui.repY=new Date().getFullYear();
  $("gate").hidden=true;$("app").hidden=false;
  applyLook();applySect();resetForms();renderAll();
  var hv=location.hash.slice(1);showView(VIEWS[hv]?hv:"depot");refreshQuotes();
  lastAct=Date.now();
  if(!timersOn){timersOn=true;setInterval(function(){
    if(!D)return;var al=+D.settings.autoLock||0;
    if(al&&Date.now()-lastAct>al*60000){lock();return}
    var rf=(+D.settings.refresh||0)*60000;if(rf&&!document.hidden&&Date.now()-lastFetch>rf)refreshQuotes();
  },20000)}
}
["pointerdown","keydown","wheel","touchstart"].forEach(function(ev){document.addEventListener(ev,function(){lastAct=Date.now()},{passive:true})});
function lock(){setDrawer(false);persist();P=null;D=null;KEY=null;PIN=null;$("alerts").innerHTML="";showGate()}
$("lockBtn").addEventListener("click",lock);

/* ---------- Navigation ---------- */
var VIEWS={depot:"Depot",zeitung:"Aktienzeitung",position:"Position",watchlist:"Watchlist",alarme:"Kursalarme",neu:"Erfassen & Import",auswertung:"Auswertung & Export",einstellungen:"Einstellungen"};
var curView="depot";
function setDrawer(open){$("side").classList.toggle("open",open);$("backdrop").hidden=!open;$("menuBtn").setAttribute("aria-expanded",open?"true":"false")}
function showView(v,anchor){
  if(!VIEWS[v])v="depot";curView=v;
  Array.prototype.forEach.call(document.querySelectorAll(".view"),function(el){el.hidden=el.getAttribute("data-view")!==v});
  Array.prototype.forEach.call(document.querySelectorAll("#nav a"),function(a){if(a.getAttribute("data-view")===v)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")});
  $("viewTitle").textContent=VIEWS[v];document.title=VIEWS[v]+" · Mein Depot";setDrawer(false);
  try{if(location.hash!=="#"+v)history.replaceState(null,"","#"+v)}catch(e){}
  var el=anchor&&$(anchor);
  if(el){if(el.tagName==="DETAILS")el.open=true;setTimeout(function(){try{el.scrollIntoView({block:"start"})}catch(e){}},0)}
  else try{window.scrollTo(0,0)}catch(e){}
}
$("nav").addEventListener("click",function(e){var a=e.target.closest("a[data-view]");if(!a)return;e.preventDefault();showView(a.getAttribute("data-view"))});
document.addEventListener("click",function(e){var b=e.target.closest("[data-go]");if(!b||!D)return;var g=b.getAttribute("data-go").split("#");showView(g[0],g[1])});
$("menuBtn").addEventListener("click",function(){setDrawer(!$("side").classList.contains("open"))});
$("backdrop").addEventListener("click",function(){setDrawer(false)});
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&$("side").classList.contains("open"))setDrawer(false)});
window.addEventListener("hashchange",function(){var v=location.hash.slice(1);if(D&&VIEWS[v]&&v!==curView)showView(v)});

/* ---------- Einklappbare Abschnitte & Darstellung ---------- */
var applyingSect=false;
function applySect(){
  applyingSect=true;var c=(D&&D.settings.collapsed)||{};
  Array.prototype.forEach.call(document.querySelectorAll("details.sect"),function(el){var v=c[el.getAttribute("data-sec")];el.open=v==null?el.getAttribute("data-default")!=="closed":!v});
  setTimeout(function(){applyingSect=false},0);
}
Array.prototype.forEach.call(document.querySelectorAll("details.sect"),function(el){
  el.addEventListener("toggle",function(){if(!D||applyingSect)return;D.settings.collapsed[el.getAttribute("data-sec")]=!el.open;persist()});
});
function applyLook(){
  var root=document.documentElement;
  if(D){root.setAttribute("data-scheme",D.settings.scheme||"smooth");if(D.settings.compact)root.setAttribute("data-compact","");else root.removeAttribute("data-compact")}
  else{root.removeAttribute("data-scheme");root.removeAttribute("data-compact")}
}
$("schemes").addEventListener("change",function(e){D.settings.scheme=e.target.value;persist();applyLook();setMsg("lookMsg","Farbschema gespeichert.")});
$("setCompact").addEventListener("change",function(){D.settings.compact=this.checked;persist();applyLook();setMsg("lookMsg",this.checked?"Kompakte Ansicht aktiv.":"Normale Ansicht aktiv.")});
function setMsg(id,t,bad){var e=$(id);if(!e)return;e.textContent=t;e.className="msg"+(bad?" bad":"")+(e.classList.contains("noprint")?" noprint":"")}
/* Zweistufige Bestätigung statt Dialog */
function armed(btn,label,cb){
  if(!btn.classList.contains("armed")){var old=btn.textContent;btn.classList.add("armed");btn.textContent=label;btn._t=setTimeout(function(){btn.classList.remove("armed");btn.textContent=old},4000);btn._old=old;return}
  clearTimeout(btn._t);btn.classList.remove("armed");btn.textContent=btn._old;cb();
}

/* ---------- Hilfen ---------- */
function accName(id){var a=accById(D,id);return a?a.name:"Extern"}
function amtCls(c){return c>0?"pos":c<0?"neg":""}
function dayOpts(sel){var h="";for(var i=1;i<=30;i++)h+='<option value="'+i+'">'+i+".</option>";h+='<option value="31">Ultimo</option>';sel.innerHTML=h}
function dayLabel(d){return +d>=31?"Ultimo":d+"."}
function accOpts(sel,withExtern,filter){
  var h=withExtern?'<option value="">Extern</option>':"";
  D.accounts.forEach(function(a){if(!filter||filter(a))h+='<option value="'+esc(a.id)+'">'+esc(a.name)+"</option>"});
  sel.innerHTML=h;
}
function fieldEur(c){return c?num(c):""}
function wdShort(k){return WDs[parseKey(k).getDay()]}
/* In der Claude-Vorschau (eingebettet) sind Downloads und Drucken gesperrt, auf dem eigenen Webserver nicht */
var EMBED=(function(){try{return window.self!==window.top}catch(e){return true}})();
function download(name,text,type){
  if(EMBED)return false;
  try{
    var blob=new Blob([text],{type:type||"text/plain"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(url);a.remove()},1000);return true;
  }catch(e){return false}
}

/* ---------- Diagramm (Linie, Ist durchgezogen, Prognose gestrichelt) ---------- */
function niceStep(span){var st=[1,2,5,10,20,50,100,200,500,1000,2000,5000,10000,20000,50000,100000,200000,500000,1000000,2000000,5000000,10000000,20000000,50000000,100000000];for(var i=0;i<st.length;i++)if(span/st[i]<=5)return st[i];return 200000000}
function tickLbl(v,unit,step){var e=Math.abs(v)/100,u=unit||"€";var s=e>=10000&&!unit?new Intl.NumberFormat("de-DE",{maximumFractionDigits:1}).format(e/1000)+" T€":new Intl.NumberFormat("de-DE",{minimumFractionDigits:step&&step<100?2:0,maximumFractionDigits:step&&step<100?2:0}).format(e)+" "+u;return (v<0?"−":"")+s}
function lineChart(pts,o){
  /* pts: [{x:0..1, v:Cent, fut:bool}] */
  o=o||{};
  var vals=pts.map(function(p){return p.v}).concat((o.lines||[]).map(function(l){return l.v}),(o.cost||[]).map(function(p){return p.v}),(o.bench||[]).map(function(p){return p.v}),(o.marks||[]).map(function(p){return p.v}),o.zero===false?[]:[0]);
  var lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals),step=niceStep(Math.max(10,hi-lo));
  lo=Math.floor(lo/step)*step;hi=Math.ceil(hi/step)*step;if(hi===lo)hi=lo+step;
  var W=640,H=250,L=70,R2=18,T=18,B=30;
  var X=function(x){return (L+x*(W-L-R2)).toFixed(1)},Y=function(v){return (T+(1-(v-lo)/(hi-lo))*(H-T-B)).toFixed(1)};
  var out='<svg viewBox="0 0 '+W+" "+H+'" role="img" aria-label="'+esc(o.label||"Verlauf")+'">';
  for(var v=lo;v<=hi+0.5;v+=step)out+='<line x1="'+L+'" x2="'+(W-R2)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" class="'+(v===0?"zero":"grid")+'"/><text x="'+(L-8)+'" y="'+(+Y(v)+4)+'" text-anchor="end" class="tick">'+tickLbl(v,o.unit,step)+"</text>";
  (o.xl||[]).forEach(function(t){out+='<text x="'+X(t.x)+'" y="'+(H-8)+'" text-anchor="middle" class="tick">'+esc(t.t)+"</text>"});
  if(o.todayX!=null)out+='<line x1="'+X(o.todayX)+'" x2="'+X(o.todayX)+'" y1="'+T+'" y2="'+(H-B)+'" class="today"/><text x="'+(+X(o.todayX)+4)+'" y="'+(T+10)+'" class="todaytx">heute</text>';
  var act=pts.filter(function(p){return !p.fut}),fut=pts.filter(function(p){return p.fut});
  if(act.length&&fut.length)fut.unshift(act[act.length-1]);
  var y0=Y(Math.max(lo,Math.min(0,hi)));
  if(act.length>1){var ln=act.map(function(p){return X(p.x)+","+Y(p.v)}).join(" ");out+='<path class="area" d="M'+X(act[0].x)+","+y0+" L"+ln.replace(/ /g," L")+" L"+X(act[act.length-1].x)+","+y0+' Z"/><polyline class="act" points="'+ln+'"/>'}
  if(o.bench&&o.bench.length>1)out+='<polyline class="benchln" points="'+o.bench.map(function(p){return X(p.x)+","+Y(p.v)}).join(" ")+'"/>';
  if(o.cost&&o.cost.length>1)out+='<polyline class="costln" points="'+o.cost.map(function(p){return X(p.x)+","+Y(p.v)}).join(" ")+'"/>';
  (o.marks||[]).forEach(function(m){out+='<circle class="'+(m.buy?"mkbuy":"mksell")+'" r="4" cx="'+X(m.x)+'" cy="'+Y(m.v)+'"><title>'+(m.buy?"Kauf":"Verkauf")+'</title></circle>'});
  if(fut.length>1)out+='<polyline class="proj" points="'+fut.map(function(p){return X(p.x)+","+Y(p.v)}).join(" ")+'"/>';
  (o.lines||[]).forEach(function(l){var y=+Y(l.v),ty=y-6<T+12?y+15:y-6;out+='<line x1="'+L+'" x2="'+(W-R2)+'" y1="'+y+'" y2="'+y+'" class="'+(l.cls||"goalln")+'"/><text x="'+(l.left?L+6:W-R2)+'" y="'+ty+'" text-anchor="'+(l.left?"start":"end")+'" class="'+(l.tcls||"goaltx")+'">'+esc(l.t)+"</text>"});
  if(act.length){var la=act[act.length-1];out+='<circle class="dotend" r="5" cx="'+X(la.x)+'" cy="'+Y(la.v)+'"/>'}
  if(fut.length>1){var fe=fut[fut.length-1];out+='<circle class="dotproj" r="4.5" cx="'+X(fe.x)+'" cy="'+Y(fe.v)+'"/>'}
  return out+"</svg>";
}
