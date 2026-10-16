/* ---------- Hilfesystem: Hilfe-Seite, Hilfe zur aktuellen Seite (Knopf unten rechts, F1, ?), Suche ---------- */
var HELP=(function(){
"use strict";
var $=SH.$,esc=SH.esc,byId={},state={view:null,panel:null,panelHist:[]};
HELP_ART.forEach(function(a){byId[a.id]=a});
SH.VIEWS.hilfe="Hilfe";
function norm(s){return String(s||"").toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss")}
function plain(h){return String(h).replace(/<[^>]+>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ")}
HELP_ART.forEach(function(a){a._t=norm(a.t);a._k=norm(a.k);a._b=norm(plain(a.b))});
function search(q){
  var w=norm(q).split(/\s+/).filter(function(x){return x.length>1});if(!w.length)return [];
  return HELP_ART.map(function(a){
    var s=0;for(var i=0;i<w.length;i++){var x=w[i],h=0;if(a._t.indexOf(x)>=0)h+=10;if(a._k.indexOf(x)>=0)h+=6;if(a._b.indexOf(x)>=0)h+=2;if(!h)return null;s+=h}
    return {a:a,s:s};
  }).filter(Boolean).sort(function(x,y){return y.s-x.s}).map(function(r){return r.a});
}
function snippet(a,q){
  var t=plain(a.b),n=norm(t),w=norm(q).split(/\s+/).filter(function(x){return x.length>1}),p=-1;
  for(var i=0;i<w.length&&p<0;i++)p=n.indexOf(w[i]);
  var s=Math.max(0,p-50),out=t.slice(s,s+150).trim();return (s>0?"… ":"")+esc(out)+(s+150<t.length?" …":"");
}
function mark(html,q){
  var w=String(q||"").split(/\s+/).filter(function(x){return x.length>2}).map(function(x){return x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")});if(!w.length)return html;
  var re=new RegExp("("+w.join("|")+")","gi");
  return html.replace(/(^|>)([^<]+)(?=<|$)/g,function(m,a,b){return a+b.replace(re,"<mark>$1</mark>")});
}
function grpName(g){for(var i=0;i<HELP_GROUPS.length;i++)if(HELP_GROUPS[i][0]===g)return HELP_GROUPS[i][1];return ""}
function forView(v){return HELP_ART.filter(function(a){return a.v.indexOf(v)>=0})}
/* Erste-Schritte-Checkliste aus den echten Daten */
function checklist(){
  var D=SH._D();if(!D)return "";var u=SH.user()||{},own=D.accounts.filter(function(a){return !a.shared});
  var items=[
    [own.length>0&&!D.demo,"Erstes eigenes Konto anlegen","Girokonto mit Kontostand von heute.","einstellungen#konten"],
    [D.orders.length>0&&!D.demo,"Daueraufträge eintragen","Gehalt, Miete, Versicherungen … – dann stimmt die Prognose.","auftraege"],
    [Object.keys(D.plan||{}).length>0&&!D.demo,"Finanzplan anlegen","Jahresplanung für Einnahmen und Ausgaben, oder Excel importieren.","plan"],
    [D.tx.some(function(t){return !t.order&&!t.sec_tx})&&!D.demo,"Buchungen erfassen oder Kontoauszug einlesen","Am schnellsten per Kontoauszug.","konten#kauszug"],
    [D.pos.length>0&&!D.demoDepot,"Depot: erstes Wertpapier erfassen","Mit ISIN von der Abrechnung.","neu"],
    [!!u.totp,"Zwei-Faktor-Anmeldung einschalten","Schützt deine Finanzdaten zusätzlich.","einstellungen"]
  ];
  var done=items.filter(function(x){return x[0]}).length;
  return '<div class="hcheck"><div class="hcprog"><span>'+done+" von "+items.length+' erledigt</span><i><b style="width:'+Math.round(done/items.length*100)+'%"></b></i></div><ul>'+items.map(function(x){
    return '<li class="'+(x[0]?"done":"")+'"><span class="hcbox" aria-hidden="true">'+(x[0]?"✓":"")+'</span><span class="hctxt"><b>'+x[1]+"</b><small>"+x[2]+"</small></span>"+(x[0]?'<span class="hcok">erledigt</span>':'<button type="button" class="btn" data-go="'+x[3]+'">Los</button>')+"</li>";
  }).join("")+"</ul></div>";
}
function body(a,q){
  var h=a.b;if(a.id==="checkliste")h=h.replace('<div id="helpChecklist"></div>',checklist());
  return mark(h,q);
}
function related(a){
  var r=HELP_ART.filter(function(x){return x!==a&&x.g===a.g}).slice(0,6);
  return r.length?'<div class="hrel"><span class="lbl">Mehr zu „'+esc(grpName(a.g))+'“</span>'+r.map(function(x){return '<a href="#" data-help="'+x.id+'">'+esc(x.t)+"</a>"}).join("")+"</div>":"";
}
/* ---------- Hilfe-Seite ---------- */
function renderToc(q){
  var res=q?search(q):null,h="";
  if(res){
    h='<div class="htocres"><span class="lbl">'+(res.length?res.length+" Treffer":"Nichts gefunden")+"</span>"+res.map(function(a){return '<a href="#" data-help="'+a.id+'"'+(state.view===a.id?' aria-current="true"':"")+"><b>"+esc(a.t)+"</b><small>"+snippet(a,q)+"</small></a>"}).join("")+"</div>";
    if(!res.length)h+='<p class="hintline">Versuch ein anderes Wort, z. B. „Konto“, „Rate“ oder „Import“.</p>';
  } else {
    h='<a href="#" data-help="" class="htochome"'+(!state.view?' aria-current="true"':"")+'>Startseite der Hilfe</a>';
    HELP_GROUPS.forEach(function(g){h+='<span class="lbl">'+esc(g[1])+"</span>"+HELP_ART.filter(function(a){return a.g===g[0]}).map(function(a){return '<a href="#" data-help="'+a.id+'"'+(state.view===a.id?' aria-current="true"':"")+">"+esc(a.t)+"</a>"}).join("")});
  }
  $("hToc").innerHTML=h;
}
function renderHome(){
  var h='<h2>Wie können wir helfen?</h2><p>Such oben nach einem Stichwort oder wähl ein Thema. Auf jeder Seite gibt es außerdem unten rechts den <span class="hfabmini">?</span>-Knopf mit der passenden Hilfe, und neben vielen Feldern ein kleines <b>?</b> mit einer Erklärung.</p>'+
    '<h3>Erste Schritte</h3>'+checklist()+'<div class="hcards">';
  HELP_GROUPS.forEach(function(g){var arts=HELP_ART.filter(function(a){return a.g===g[0]});h+='<div class="fc hcard"><span class="lbl">'+esc(g[1])+"</span>"+arts.slice(0,5).map(function(a){return '<a href="#" data-help="'+a.id+'">'+esc(a.t)+"</a>"}).join("")+(arts.length>5?'<small>und '+(arts.length-5)+" weitere</small>":"")+"</div>"});
  return h+"</div>";
}
function open(id,q){
  state.view=id&&byId[id]?id:null;var a=state.view&&byId[state.view];
  $("hArt").innerHTML=a?'<p class="hcrumb"><a href="#" data-help="">Hilfe</a> › '+esc(grpName(a.g))+"</p><h2>"+esc(a.t)+"</h2>"+body(a,q)+related(a):renderHome();
  renderToc($("hSearch").value.trim());
  try{if(window.matchMedia("(max-width:860px)").matches)$("hArt").scrollIntoView({block:"start"});else window.scrollTo(0,0)}catch(e){}
}
function showPage(id,q){
  closePanel();if(SH.curView()!=="hilfe")SH.showView("hilfe");open(id,q);
}
SH.onView(function(v){$("helpFab").hidden=v==="hilfe";if(v==="hilfe"){closePanel();open(state.view)}else if(!$("helpPanel").hidden&&state.panel&&!state.panel.art&&!$("hpSearch").value)renderPanel()});
$("hSearch").addEventListener("input",function(){var q=this.value.trim();renderToc(q);var r=q?search(q):[];if(r.length===1)open(r[0].id,q)});
$("hSearch").addEventListener("keydown",function(e){if(e.key==="Enter"){var r=search(this.value.trim());if(r.length)open(r[0].id,this.value.trim())}});
/* ---------- Hilfe zur aktuellen Seite (Seitenleiste) ---------- */
function panelList(v){
  var arts=forView(v),h='<p class="hpintro">Hilfe zu <b>'+esc(HELP_VIEW_TITLE[v]||"dieser Seite")+"</b></p>";
  if(!arts.length)arts=[byId.ueberblick];
  h+=arts.map(function(a,i){return '<details class="hpitem"'+(i===0?" open":"")+'><summary>'+esc(a.t)+'</summary><div class="hptext">'+body(a)+"</div></details>"}).join("");
  return h;
}
function renderPanel(){
  var p=state.panel,q=$("hpSearch").value.trim(),h;
  if(q){var r=search(q);h='<p class="hpintro">'+(r.length?r.length+" Treffer für „"+esc(q)+"“":"Nichts gefunden für „"+esc(q)+"“")+"</p>"+r.slice(0,12).map(function(a){return '<a href="#" class="hpres" data-help="'+a.id+'"><b>'+esc(a.t)+"</b><small>"+snippet(a,q)+"</small></a>"}).join("")}
  else if(p&&p.art){var a=byId[p.art];h=(state.panelHist.length?'<button type="button" class="linkbtn hpback" id="hpBack">‹ zurück</button>':"")+"<h3>"+esc(a.t)+'</h3><div class="hptext">'+body(a)+"</div>"+related(a)}
  else h=panelList(SH.curView());
  $("hpBody").innerHTML=h;$("hpBody").scrollTop=0;
}
function openPanel(art){
  if(SH.curView()==="hilfe"){open(art||state.view);return}
  if(art){if(state.panel&&state.panel.art&&state.panel.art!==art)state.panelHist.push(state.panel.art);else if(state.panel&&!state.panel.art)state.panelHist.push("");}
  else state.panelHist=[];
  state.panel={art:art||null};$("hpSearch").value="";
  $("helpPanel").hidden=false;$("helpFab").setAttribute("aria-expanded","true");document.body.classList.add("hpopen");renderPanel();
  try{$("hpClose").focus({preventScroll:true})}catch(e){}
}
function closePanel(){if($("helpPanel").hidden)return;$("helpPanel").hidden=true;state.panel=null;state.panelHist=[];$("helpFab").setAttribute("aria-expanded","false");document.body.classList.remove("hpopen")}
$("helpFab").addEventListener("click",function(){if(!$("helpPanel").hidden)closePanel();else openPanel()});
$("hpClose").addEventListener("click",function(){closePanel();try{$("helpFab").focus()}catch(e){}});
$("hpAll").addEventListener("click",function(){var a=state.panel&&state.panel.art;showPage(a||null)});
$("hpSearch").addEventListener("input",renderPanel);
$("hpBody").addEventListener("click",function(e){var b=e.target.closest("#hpBack");if(!b)return;var prev=state.panelHist.pop();state.panel={art:prev||null};renderPanel()});
/* Links auf Artikel überall in der App */
document.addEventListener("click",function(e){
  var l=e.target.closest&&e.target.closest("[data-help]");if(!l)return;e.preventDefault();
  var id=l.getAttribute("data-help");
  if(SH.curView()==="hilfe"&&!l.closest("#helpPanel"))open(id,l.closest("#hToc")?$("hSearch").value.trim():"");
  else if(!$("helpPanel").hidden||l.closest(".tipbox"))openPanel(id||null);
  else openPanel(id||null);
});
/* „Los“-Knöpfe und Sprünge zur Funktion schließen die Seitenleiste */
document.addEventListener("click",function(e){if(e.target.closest&&e.target.closest("#helpPanel [data-go]"))closePanel()},true);
document.addEventListener("keydown",function(e){
  var t=e.target,typing=/INPUT|TEXTAREA|SELECT/.test(t.tagName)||t.isContentEditable;
  if($("app").hidden)return;
  if(e.key==="F1"){e.preventDefault();if(!$("helpPanel").hidden)closePanel();else openPanel();return}
  if(e.key==="?"&&!typing&&!e.ctrlKey&&!e.metaKey){e.preventDefault();if(!$("helpPanel").hidden)closePanel();else openPanel();return}
  if(e.key==="Escape"&&!$("helpPanel").hidden){closePanel();try{$("helpFab").focus()}catch(x){}}
});
return {open:showPage,panel:openPanel,search:search,close:closePanel};
})();
