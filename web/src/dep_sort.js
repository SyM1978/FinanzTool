/* ---------- Positionen sortieren (Klick auf die Spaltenüberschrift, Einstellung wird gespeichert) ---------- */
var SORTKEYS={mark:function(r){var i=MARKS.map(function(m){return m[0]}).indexOf(r.p.mark);return i<0?99:i},name:function(r){return String(r.p.name||"").toLowerCase()},shares:function(r){return r.shares},price:function(r){return r.price==null?-Infinity:r.price},
  day:function(r){return r.dayPct==null?-Infinity:r.dayPct},value:function(r){return r.value||0},gain:function(r){return r.unrealPct==null?-Infinity:r.unrealPct},share:function(r){return r.value||0}};
function posSort(){var s=D.settings.posSort;return s&&SORTKEYS[s.k]?s:{k:"value",d:-1}}
function sortRows(rows){
  var s=posSort(),f=SORTKEYS[s.k];
  return rows.slice().sort(function(a,b){
    var ca=a.shares<=0,cb=b.shares<=0;if(ca!==cb)return ca?1:-1;      /* verkaufte Positionen immer unten */
    if(!ca){var g=groupCmp(a,b);if(g)return g}
    var x=f(a),y=f(b);
    if(x<y)return -s.d;if(x>y)return s.d;
    return String(a.p.name).localeCompare(String(b.p.name),"de");
  });
}
function renderSortHead(){
  var s=posSort();$("posGroup").value=posGroup();
  Array.prototype.forEach.call(document.querySelectorAll("#posHead [data-sort]"),function(b){
    var on=b.getAttribute("data-sort")===s.k;
    b.querySelector("i").textContent=on?(s.d>0?"▲":"▼"):"";
    b.classList.toggle("act",on);if(on)b.parentNode.setAttribute("aria-sort",s.d>0?"ascending":"descending");
  });
  Array.prototype.forEach.call(document.querySelectorAll("#posHead th"),function(th){if(!th.querySelector(".act"))th.setAttribute("aria-sort","none")
  });
}
$("posHead").addEventListener("click",function(e){
  var b=e.target.closest("[data-sort]");if(!b||!D)return;
  var k=b.getAttribute("data-sort"),s=posSort();
  D.settings.posSort=s.k===k?{k:k,d:-s.d}:{k:k,d:k==="name"||k==="mark"?1:-1};
  persist();renderAll();
});

/* ---------- Farbige Markierung einzelner Positionen ---------- */
var MARKS=[["rot","#D92D20","Rot"],["orange","#F79009","Orange"],["gelb","#EAAA08","Gelb"],["gruen","#16A34A","Grün"],["blau","#2E90FA","Blau"],["lila","#9E77ED","Lila"]];
function markOf(p){for(var i=0;i<MARKS.length;i++)if(MARKS[i][0]===p.mark)return MARKS[i];return null}
function markBtn(p){var m=markOf(p);return '<button class="mkdot'+(m?" on":"")+'" type="button" data-mk="'+esc(p.id)+'"'+(m?' style="--mk:'+m[1]+'"':"")+' title="'+(m?"Markierung: "+m[2]+" (ändern)":"Markieren")+'" aria-label="'+(m?"Markierung "+m[2]+" ändern":"Position farbig markieren")+'"></button>'}
function closeMarkPop(){var o=document.querySelector(".mkpop");if(o)o.remove()}
$("posBody").addEventListener("click",function(e){
  var b=e.target.closest("[data-mk]");if(!b)return;
  e.stopPropagation();
  var open=document.querySelector('.mkpop[data-for="'+b.getAttribute("data-mk")+'"]');closeMarkPop();if(typeof closeCatPop==="function")closeCatPop();if(open)return;
  var id=b.getAttribute("data-mk"),pop=document.createElement("span");pop.className="mkpop";pop.setAttribute("data-for",id);pop.setAttribute("role","group");pop.setAttribute("aria-label","Farbe wählen");
  pop.innerHTML=MARKS.map(function(m){return '<button type="button" class="mkc" data-mkset="'+m[0]+'" data-mkp="'+esc(id)+'" style="--mk:'+m[1]+'" title="'+m[2]+'" aria-label="'+m[2]+'"></button>'}).join("")+'<button type="button" class="mkc none" data-mkset="" data-mkp="'+esc(id)+'" title="Keine Markierung" aria-label="Markierung entfernen">×</button>';
  placePop(pop,b);var f=pop.querySelector("button");if(f)f.focus();
},true);
document.addEventListener("click",function(e){if(!e.target.closest(".mkpop,[data-mk]"))closeMarkPop()});
document.addEventListener("keydown",function(e){if(e.key==="Escape")closeMarkPop()});

/* Auswahlfenster frei über der Seite platzieren (nicht von der Tabelle abgeschnitten) */
function placePop(pop,anchor){
  if(!pop.parentNode)document.body.appendChild(pop);
  pop._anchor=anchor;
  var r=anchor.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight,vw=document.documentElement.clientWidth,vh=window.innerHeight;
  var left=Math.max(8,Math.min(r.left,vw-w-8)),top=r.bottom+6;
  if(top+h>vh-8&&r.top-h-6>8)top=r.top-h-6;
  pop.style.left=left+"px";pop.style.top=top+"px";
}
function markSet(id,v){var p=D.pos.filter(function(x){return x.id===id})[0];if(!p)return;if(v)p.mark=v;else delete p.mark;p.u=now();closeMarkPop();save();renderAll()}
document.addEventListener("click",function(e){var c=e.target.closest(".mkpop [data-mkset]");if(c)markSet(c.getAttribute("data-mkp"),c.getAttribute("data-mkset"))});
/* beim Scrollen mitwandern; ist der Auslöser nicht mehr da oder außer Sicht, schließen */
function followPops(){
  Array.prototype.forEach.call(document.querySelectorAll(".mkpop,.catpop"),function(pop){
    var a=pop._anchor;if(!a||!document.body.contains(a)){pop.remove();return}
    var r=a.getBoundingClientRect();if(r.bottom<0||r.top>window.innerHeight){pop.remove();return}
    placePop(pop,a);
  });
}
window.addEventListener("scroll",followPops,{passive:true,capture:true});
window.addEventListener("resize",followPops);
