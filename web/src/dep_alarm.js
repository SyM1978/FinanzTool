/* ---------- Alarme: ein oder mehrere Wertpapiere auf einmal ---------- */
var AL_SEL={};
function alCandidates(){
  var seen={},out=[];
  D.pos.forEach(function(p){if(seen[p.sym])return;seen[p.sym]=1;var own=walk(p).shares>0;out.push({sym:p.sym,name:p.name,own:own,cat:p.cat||""})});
  (D.watch||[]).forEach(function(w){if(seen[w.sym])return;seen[w.sym]=1;out.push({sym:w.sym,name:w.name,watch:true,cat:""})});
  return out;
}
function alSelected(){return Object.keys(AL_SEL).filter(function(k){return AL_SEL[k]})}
function alPct(){return /^day/.test($("alType").value)}
function fillAlertSel(){
  var c=alCandidates(),has={};c.forEach(function(x){has[x.sym]=1});
  Object.keys(AL_SEL).forEach(function(k){if(!has[k])delete AL_SEL[k]});
  $("alSyms").innerHTML=c.length?c.map(function(x){
    var tag=x.watch?"Watchlist":!x.own?"verkauft":x.cat;
    return '<label class="alchip'+(AL_SEL[x.sym]?" on":"")+(x.own?"":" dim")+'"><input type="checkbox" data-alsym="'+esc(x.sym)+'"'+(AL_SEL[x.sym]?" checked":"")+"><span>"+esc(x.name)+(tag?" <small>"+esc(tag)+"</small>":"")+"</span></label>";
  }).join(""):'<p class="hint">Erst eine Position oder einen Watchlist-Wert anlegen.</p>';
  var cats=catList();
  $("alCatWrap").hidden=!cats.length;
  $("alCats").innerHTML=cats.map(function(k){return '<button type="button" class="catopt" data-alcat="'+esc(k)+'">'+esc(k)+"</button>"}).join("");
  $("alWatch").hidden=!(D.watch||[]).length;
  alTypeUI();
}
function alTypeUI(){
  var pc=alPct(),sel=alSelected(),q=sel.length===1?D.quotes[sel[0]]:null;
  $("alValLbl").textContent=pc?"Prozent":"Kurs ("+(q?(CURSYM[q.currency]||q.currency):"€")+")";
  $("alCount").textContent=sel.length?sel.length+" ausgewählt":"";
  $("alHint").textContent=!pc&&sel.length>1?"Eine feste Kursschwelle passt nur zu einem Wertpapier. Für mehrere auf einmal eine Prozent-Bedingung wählen.":q?"Aktueller Kurs: "+fmtPx(q.price,q.currency)+(q.prev?", heute "+pct(q.price/q.prev-1,true):"")+".":"";
  $("alGo").textContent=sel.length>1?sel.length+" Alarme anlegen":"Alarm anlegen";
}
function alPick(fn){alCandidates().forEach(function(x){AL_SEL[x.sym]=!!fn(x)});if(alSelected().length>1&&!alPct())$("alType").value="dayMove";fillAlertSel()}
$("alType").addEventListener("change",alTypeUI);
$("alSyms").addEventListener("change",function(e){
  var c=e.target.closest("[data-alsym]");if(!c)return;
  AL_SEL[c.getAttribute("data-alsym")]=c.checked;c.parentNode.classList.toggle("on",c.checked);
  if(alSelected().length>1&&!alPct())$("alType").value="dayMove";
  alTypeUI();
});
$("alAll").addEventListener("click",function(){alPick(function(x){return x.own})});
$("alWatch").addEventListener("click",function(){alPick(function(x){return x.watch||AL_SEL[x.sym]})});
$("alNone").addEventListener("click",function(){alPick(function(){return false})});
$("alCats").addEventListener("click",function(e){var b=e.target.closest("[data-alcat]");if(!b)return;var k=b.getAttribute("data-alcat");alPick(function(x){return x.own&&x.cat===k||AL_SEL[x.sym]})});
$("alForm").addEventListener("submit",function(e){
  e.preventDefault();
  var syms=alSelected(),t=$("alType").value,v=parseDec($("alVal").value);
  if(!syms.length){setMsg("alMsg","Bitte mindestens ein Wertpapier auswählen.",true);return}
  if(!/^day/.test(t)&&syms.length>1){setMsg("alMsg","Kursschwellen gehen nur für ein Wertpapier. Für mehrere bitte „± %“, „fällt um %“ oder „steigt um %“ wählen.",true);return}
  if(v==null||v<=0){setMsg("alMsg","Bitte einen Wert größer 0 eingeben.",true);$("alVal").focus();return}
  if(/^day/.test(t)&&v>=100){setMsg("alMsg","Bitte einen Prozentwert unter 100 eingeben.",true);return}
  D.alerts=D.alerts||[];var n=0,dup=0;
  syms.forEach(function(sym){
    if(D.alerts.some(function(a){return a.sym===sym&&a.type===t&&Math.abs(+a.value-v)<1e-9})){dup++;return}
    D.alerts.push({id:newId(),sym:sym,name:symName(sym),type:t,value:v,hitAt:0,u:now()});n++;
  });
  AL_SEL={};$("alVal").value="";save();checkAlerts();renderAll();
  setMsg("alMsg",(n?(n===1?"Alarm angelegt.":n+" Alarme angelegt."):"Nichts angelegt.")+(dup?" "+dup+(dup===1?" gab es schon.":" gab es schon."):""),!n);
});
$("alDelAll").addEventListener("click",function(){var b=this;if(!(D.alerts||[]).length)return;armed(b,"Alle "+D.alerts.length+" Alarme löschen?",function(){D.alerts=[];save();renderAll();setMsg("alMsg","Alle Alarme gelöscht.")})});
