
/* ---------- Kategorien (frei benennbar) und Gruppierung der Positionen ---------- */
function catList(){var m={};D.pos.forEach(function(p){if(p.cat)m[p.cat]=1});return Object.keys(m).sort(function(a,b){return a.localeCompare(b,"de")})}
function catChip(p){return '<button type="button" class="catchip'+(p.cat?" on":"")+'" data-cat="'+esc(p.id)+'" title="'+(p.cat?"Kategorie ändern":"Kategorie zuweisen")+'">'+(p.cat?esc(p.cat):"+ Kategorie")+"</button>"}
function setCat(id,v){
  var p=D.pos.filter(function(x){return x.id===id})[0];if(!p)return;
  v=String(v||"").trim().slice(0,30);if(v)p.cat=v;else delete p.cat;p.u=now();closeCatPop();save();renderAll();
}
function closeCatPop(){var o=document.querySelector(".catpop");if(o)o.remove()}
$("posBody").addEventListener("click",function(e){
  var b=e.target.closest("[data-cat]");if(!b)return;
  e.stopPropagation();
  var id=b.getAttribute("data-cat"),open=document.querySelector('.catpop[data-for="'+id+'"]');closeCatPop();closeMarkPop();if(open)return;
  var p=D.pos.filter(function(x){return x.id===id})[0],pop=document.createElement("span");
  pop.className="catpop";pop.setAttribute("data-for",id);pop.setAttribute("role","dialog");pop.setAttribute("aria-label","Kategorie wählen");
  pop.innerHTML='<span class="catopts">'+catList().map(function(k){return '<button type="button" class="catopt'+(p&&p.cat===k?" on":"")+'" data-catset="'+esc(k)+'" data-catp="'+esc(id)+'">'+esc(k)+"</button>"}).join("")+"</span>"+
    '<span class="catnew"><input type="text" maxlength="30" placeholder="Neue Kategorie" aria-label="Neue Kategorie"><button type="button" class="btn" data-catnew="'+esc(id)+'">OK</button></span>'+
    (p&&p.cat?'<button type="button" class="linkbtn" data-catset="" data-catp="'+esc(id)+'">Kategorie entfernen</button>':"");
  placePop(pop,b);
  var inp=pop.querySelector("input");inp.addEventListener("keydown",function(ev){if(ev.key==="Enter"){ev.preventDefault();setCat(id,inp.value)}});
  (pop.querySelector(".catopt")||inp).focus();
},true);
document.addEventListener("click",function(e){
  var s=e.target.closest(".catpop [data-catset]");if(s){setCat(s.getAttribute("data-catp"),s.getAttribute("data-catset"));return}
  var ok=e.target.closest(".catpop [data-catnew]");if(ok){setCat(ok.getAttribute("data-catnew"),ok.parentNode.querySelector("input").value);return}
  if(!e.target.closest(".catpop,[data-cat]"))closeCatPop();
});
document.addEventListener("keydown",function(e){if(e.key==="Escape")closeCatPop()});

function posGroup(){var g=D.settings.posGroup;return g==="cat"||g==="mark"?g:""}
function groupKey(r){var g=posGroup();if(g==="cat")return r.p.cat||"";if(g==="mark"){var m=markOf(r.p);return m?m[0]:""}return ""}
function groupRank(k){
  if(!k)return [1,""];
  if(posGroup()==="mark"){for(var i=0;i<MARKS.length;i++)if(MARKS[i][0]===k)return [0,String(i)]}
  return [0,k.toLowerCase()];
}
function groupLabel(k){
  if(posGroup()==="cat")return k||"Ohne Kategorie";
  var m=MARKS.filter(function(x){return x[0]===k})[0];return m?m[2]:"Ohne Markierung";
}
function groupCmp(a,b){
  if(!posGroup())return 0;
  var x=groupRank(groupKey(a)),y=groupRank(groupKey(b));
  if(x[0]!==y[0])return x[0]-y[0];
  return x[1]<y[1]?-1:x[1]>y[1]?1:0;
}
/* Zwischenzeilen mit Summe je Gruppe */
function decorateGroups(s){
  if(!posGroup())return;
  var rows=sortRows(s.rows).filter(function(r){return r.shares>0}),sums={},byId={};
  rows.forEach(function(r){var k=groupKey(r),g=sums[k]||(sums[k]={n:0,v:0,u:0});g.n++;g.v+=r.value||0;g.u+=r.unreal||0;byId[r.p.id]=k});
  var last=null;
  Array.prototype.forEach.call(document.querySelectorAll("#posBody tr[data-pid]"),function(tr){
    var id=tr.getAttribute("data-pid");if(!(id in byId))return;
    var k=byId[id];if(k===last)return;last=k;
    var g=sums[k],h=document.createElement("tr");h.className="grp";
    var dot=posGroup()==="mark"&&k?'<i class="mkdot on" style="--mk:'+markOf({mark:k})[1]+'"></i>':"";
    h.innerHTML='<td colspan="4">'+dot+"<b>"+esc(groupLabel(k))+"</b> <small>"+g.n+(g.n===1?" Position":" Positionen")+'</small></td><td class="r mono">'+money(g.v)+'</td><td class="r mono '+gvCls(g.u)+'">'+money(g.u,true)+'</td><td class="r mono">'+(s.value?pct(g.v/s.value):"–")+"</td>";
    tr.parentNode.insertBefore(h,tr);
  });
}
$("posGroup").addEventListener("change",function(){D.settings.posGroup=this.value;persist();renderAll()});
