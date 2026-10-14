/* ===================== Aktienzeitung: nur Meldungen von heute ===================== */
var WDl=["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
var ztReq=0;
function isToday(ts){return keyOf(new Date(ts*1000))===todayKey()}
function hhmmTs(ts){var d=new Date(ts*1000);return pad(d.getHours())+":"+pad(d.getMinutes())+" Uhr"}
function ztStocks(){
  var out=[],seen={},Vv=V();
  depotStats(Vv).rows.forEach(function(r){if(r.shares>0&&!isFund(r.p)&&!seen[r.p.sym]){seen[r.p.sym]=1;out.push({p:r.p,own:true})}});
  if($("ztWatch").checked)(D.watch||[]).forEach(function(w){if(!seen[w.sym]&&!isFund(w)){seen[w.sym]=1;out.push({p:w,own:false})}});
  return out;
}
function ztQuote(sym){var q=D.quotes[sym];if(!q)return "";var ch=q.prev?q.price/q.prev-1:null;return '<span class="pp-q">'+esc(fmtPx(q.price,q.currency))+(ch!=null?' <span class="'+gvCls(ch)+'">'+esc(pct(ch,true))+"</span>":"")+"</span>"}
function ztArticle(it,top){var u=/^https?:\/\//i.test(it.link)?it.link:"#";return '<div class="pp-item'+(top?" first":"")+'"><h4><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(it.title)+'</a></h4><span class="pp-by">'+esc(it.source||"Unbekannte Quelle")+", "+hhmmTs(it.date)+"</span></div>"}
function renderZeitung(force){
  if(!D)return;
  var t=new Date(),start=new Date(t.getFullYear(),0,0),no=Math.floor((t-start)/864e5);
  $("ztDate").textContent=WDl[t.getDay()]+", "+t.getDate()+". "+MON[t.getMonth()]+" "+t.getFullYear();
  $("ztNo").textContent="Nr. "+no+" · Jahrgang "+t.getFullYear();
  $("ztEarL").textContent="Ausgabe für "+P.name;
  $("ztEarR").textContent=D.qtime?"Kurse von "+pad(new Date(D.qtime).getHours())+":"+pad(new Date(D.qtime).getMinutes())+" Uhr":"";
  var list=ztStocks(),req=++ztReq;
  $("ztTicker").innerHTML=list.map(function(x){var q=D.quotes[x.p.sym],ch=q&&q.prev?q.price/q.prev-1:null;return "<span><b>"+esc(newsQuery(x.p)||x.p.name)+"</b>"+(q?esc(fmtPx(q.price,q.currency))+(ch!=null?' <span class="'+gvCls(ch)+'">'+esc(pct(ch,true))+"</span>":""):"–")+"</span>"}).join("")||'<span class="pp-empty">Noch keine Aktien im Depot.</span>';
  $("ztLead").innerHTML="";
  if(D.demo){$("ztCols").innerHTML='<p class="pp-empty">Im Beispieldepot erscheint keine Zeitung. Mit deinem Kurs-Server stehen hier die Meldungen des Tages zu jeder Aktie.</p>';$("ztStat").textContent="";$("nmNews").textContent="";return}
  if(!list.length){$("ztCols").innerHTML='<p class="pp-empty">Sobald Aktien im Depot oder auf der Watchlist sind, erscheint hier ihre Tageszeitung. ETFs haben keine Firmen-News.</p>';$("ztStat").textContent="";$("nmNews").textContent="";return}
  if(force){list.forEach(function(x){delete NEWS[newsQuery(x.p)]})}
  $("ztCols").innerHTML=list.map(function(x){return '<section class="pp-sec'+(x.own?"":" dim")+'"><header><h3>'+esc(x.p.name)+"</h3>"+ztQuote(x.p.sym)+'</header><p class="pp-empty">Die Redaktion sucht …</p></section>'}).join("");
  $("ztStat").textContent="Meldungen werden gesammelt …";
  var res=[],fail=0;
  Promise.all(list.map(function(x,i){return getNews(x.p).then(function(items){res[i]=items.filter(function(it){return isToday(it.date)}).sort(function(a,b){return b.date-a.date})}).catch(function(){res[i]=null;fail++})})).then(function(){
    if(req!==ztReq||!D)return;
    /* Aufmacher: die jüngste Meldung des Tages über alle Aktien */
    var lead=null,leadIdx=-1;
    res.forEach(function(r,i){if(r&&r.length&&(!lead||r[0].date>lead.date)){lead=r[0];leadIdx=i}});
    var seen={},total=0;
    $("ztCols").innerHTML=list.map(function(x,i){
      var r=res[i],body;
      if(r===null)body='<p class="pp-empty">Meldungen konnten nicht geladen werden.</p>';
      else{
        r=r.filter(function(it){var k=it.title.toLowerCase();if(seen[k])return false;seen[k]=1;return true});
        if(i===leadIdx)r=r.filter(function(it){return it!==lead});
        total+=r.length;
        body=r.length?r.slice(0,6).map(function(it,j){return ztArticle(it,j===0)}).join(""):(i===leadIdx?'<p class="pp-empty">Siehe Aufmacher.</p>':'<p class="pp-empty">Heute keine Meldungen.</p>');
      }
      return '<section class="pp-sec'+(x.own?"":" dim")+'"><header><h3>'+esc(x.p.name)+(x.own?"":" <small>(Watchlist)</small>")+"</h3>"+ztQuote(x.p.sym)+"</header>"+body+"</section>";
    }).join("");
    if(lead){total++;var u=/^https?:\/\//i.test(lead.link)?lead.link:"#";$("ztLead").innerHTML='<span class="pp-kicker">Aufmacher · '+esc(list[leadIdx].p.name)+'</span><h2><a href="'+esc(u)+'" target="_blank" rel="noopener noreferrer">'+esc(lead.title)+'</a></h2><span class="pp-by">'+esc(lead.source||"")+", "+hhmmTs(lead.date)+"</span>"}
    $("ztStat").textContent=fail===list.length?"Keine Verbindung zum Kurs-Server, die Zeitung bleibt heute leer.":total?total+(total===1?" Meldung":" Meldungen")+" von heute zu "+list.length+(list.length===1?" Aktie":" Aktien")+".":"Heute noch keine Meldungen zu deinen Aktien.";
    $("nmNews").textContent=total||"";
  });
}
$("ztReload").addEventListener("click",function(){renderZeitung(true)});
$("ztWatch").addEventListener("change",function(){renderZeitung(false)});
(function(){var prev=showView;showView=function(v,a){prev(v,a);if(D&&v==="zeitung")renderZeitung(false)}})();
