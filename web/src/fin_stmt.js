/* ---------- Kontoauszug einlesen: Vorschau, Abgleich mit Buchungen und Daueraufträgen, Übernahme ---------- */
var KA={rows:[],bal:[],acc:null};
function kaAccs(){return shownAccs().filter(function(a){return !(a.shared&&a.shared.perm!=="write")})}
function kaFill(){
  var sel=$("kaAcc");if(!sel||!D)return;var keep=sel.value||KA.acc||ui.acc;
  sel.innerHTML=kaAccs().map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+"</option>"}).join("");
  if(keep&&kaAccs().some(function(a){return a.id===keep}))sel.value=keep;
}
function dayDiff(a,b){return Math.round((parseKey(a)-parseKey(b))/864e5)}
function words(s){return String(s||"").toLowerCase().replace(/[^a-zäöüß0-9 ]/g," ").split(/\s+/).filter(function(w){return w.length>=4})}
function kaGuessCat(text){
  var w=words(text);if(!w.length)return "";
  for(var i=D.tx.length-1;i>=0;i--){var t=D.tx[i];if(!t.cat||t.sec_tx)continue;var tw=words(t.text);if(tw.length&&tw.some(function(x){return w.indexOf(x)>=0}))return t.cat}
  return "";
}
function kaMatch(accId,rows){
  var a=accById(D,accId),r=compute(D).acc[accId],ev=r?r.ev:[],used={};
  rows.forEach(function(x,i){
    x.st="new";x.on=true;x.oid=null;x.occ=null;x.note="";x.cat=x.cat||"";
    if(x.pending){x.st="pending";x.on=false;x.note="vorgemerkt, noch nicht gebucht";return}
    if(a&&x.date<a.start.date){x.st="old";x.on=false;x.note="vor dem Startwert des Kontos ("+dmy(a.start.date)+")";return}
    var best=null,bs=99;
    ev.forEach(function(e,j){
      if(used[j]||e.k==="start"||e.pre)return;var dd=Math.abs(dayDiff(e.d,x.date));
      if((e.k==="tx"||e.k==="corr")&&e.a===x.amount&&dd<=4&&dd<bs){best={j:j,e:e,t:"dup"};bs=dd}
    });
    if(!best){bs=99;
      ev.forEach(function(e,j){
        if(used[j]||e.k!=="ord")return;var dd=Math.abs(dayDiff(e.d,x.date));if(dd>7)return;
        var o=findOrder(e.oid),same=e.a===x.amount,close=o&&(e.a<0)===(x.amount<0)&&Math.abs(e.a-x.amount)<=Math.abs(e.a)*0.25&&words(o.name+" "+(o.cat||"")).some(function(w){return x.text.toLowerCase().indexOf(w)>=0});
        if((same||close)&&dd+(same?0:3)<bs){best={j:j,e:e,t:"ord",o:o};bs=dd+(same?0:3)}
      });
    }
    if(!best){ev.forEach(function(e,j){if(!best&&!used[j]&&(e.k==="fee"||e.k==="int")&&e.a===x.amount&&Math.abs(dayDiff(e.d,x.date))<=7)best={j:j,e:e,t:e.k}})}
    if(best){used[best.j]=1;
      if(best.t==="dup"){x.st="dup";x.on=false;x.note="am "+dmy(best.e.d)+(best.e.t?": "+best.e.t:"")}
      else if(best.t==="ord"){x.st="ord";x.oid=best.o.id;x.occ=best.e.occ;x.note="„"+best.o.name+"“ fällig "+dmy(best.e.d)+(best.e.a!==x.amount?", geplant "+eur(Math.abs(best.e.a)):"")+" – wird als ausgeführt bestätigt";if(!x.cat)x.cat=best.o.cat||""}
      else{x.st="fee";x.on=false;x.note=best.t==="fee"?"Kontoführungsgebühr ist schon eingeplant":"Zinsen sind schon eingeplant"}
    }
    if(!x.cat)x.cat=kaGuessCat(x.text);
  });
}
var KA_LBL={new:"neu",ord:"Dauerauftrag",dup:"schon gebucht",fee:"schon eingeplant",pending:"vorgemerkt",old:"zu alt"};
function kaRender(){
  var out=$("kaOut");if(!KA.rows.length){out.hidden=true;return}
  out.hidden=false;
  $("kaBody").innerHTML=KA.rows.map(function(x,i){
    return '<tr class="ka-'+x.st+(x.on?"":" off")+'"><td><input type="checkbox" data-kaon="'+i+'"'+(x.on?" checked":"")+' aria-label="übernehmen"></td><td class="mono">'+dmy(x.date)+'</td>'+
      '<td><input type="text" class="katext" data-katext="'+i+'" value="'+esc(x.text)+'" maxlength="200" aria-label="Text"><small class="kanote"><span class="tag '+(x.st==="new"?"ok":x.st==="ord"?"edit":"fee")+'">'+KA_LBL[x.st]+"</span>"+(x.note&&x.st!=="new"?" "+esc(x.note):"")+"</small></td>"+
      '<td><input type="text" class="kacat" data-kacat="'+i+'" value="'+esc(x.cat)+'" list="catList" maxlength="40" aria-label="Kategorie" placeholder="Kategorie"></td>'+
      '<td class="r"><span class="eur mono '+(x.amount<0?"neg":"pos")+'">'+eur(x.amount,true)+"</span>"+(x.signSure?"":'<button type="button" class="btn kasign" data-kasign="'+i+'" title="Vorzeichen umdrehen – im Text war nicht zu erkennen, ob Eingang oder Ausgang">±</button>')+"</td></tr>";
  }).join("");
  var n=KA.rows.filter(function(x){return x.on}).length,sum=0,c={};KA.rows.forEach(function(x){c[x.st]=(c[x.st]||0)+1;if(x.on)sum+=x.amount});
  var parts=[];if(c.new)parts.push(c.new+" neu");if(c.ord)parts.push(c.ord+(c.ord===1?" passt zu einem Dauerauftrag":" passen zu Daueraufträgen"));if(c.dup)parts.push(c.dup+" schon gebucht");if(c.fee)parts.push(c.fee+" schon eingeplant");if(c.pending)parts.push(c.pending+" vorgemerkt");if(c.old)parts.push(c.old+" vor dem Startwert");
  var unsure=KA.rows.filter(function(x){return !x.signSure}).length;
  $("kaSum").innerHTML="<b>"+KA.rows.length+" Umsätze erkannt</b>: "+esc(parts.join(", "))+"."+(unsure?' <span class="kawarn">'+(unsure===1?"Bei einem Umsatz":"Bei "+unsure+" Umsätzen")+" stand kein Vorzeichen dabei – bitte mit ± prüfen.</span>":"");
  $("kaImport").disabled=!n;$("kaImport").textContent=n?n+" übernehmen ("+eur(sum,true)+")":"nichts ausgewählt";
  $("kaMeta").textContent=KA.rows.length+" erkannt";
  kaBalance();
}
function kaBalance(){
  var el=$("kaBal"),b=KA.bal.filter(function(x){return x.date}).sort(function(a,c){return a.date<c.date?-1:1}).pop();
  if(!b||!KA.acc){el.innerHTML="";return}
  var r=compute(D).acc[KA.acc],app=r?balAt(r,b.date):null,diff=app==null?null:b.amount-app;
  el.innerHTML='<div class="fc"><span class="lbl">Kontostand laut Auszug, '+dmy(b.date)+'</span><b class="eur">'+eur(b.amount)+"</b><small>in der App: "+(app==null?"–":eur(app))+(diff===0?' · <span class="pos">stimmt</span>':diff!=null?' · Differenz <span class="'+(diff<0?"neg":"pos")+'">'+eur(diff,true)+"</span>":"")+"</small>"+
    (diff?'<button type="button" class="btn" id="kaRecon">Im Bankabgleich prüfen</button>':"")+"</div>";
}
function kaRead(text){
  var accId=$("kaAcc").value;if(!accId){setMsg("kaMsg","Bitte zuerst ein Konto anlegen.",true);return}
  if(!String(text||"").trim()){setMsg("kaMsg","Bitte erst den Kontoauszug einfügen oder eine Datei wählen.",true);return}
  var p=STMT.parse(text,{today:todayKey()});
  KA.acc=accId;KA.rows=p.rows.slice(0,1000);KA.bal=p.balances||[];
  if(!KA.rows.length){kaRender();setMsg("kaMsg","Keine Umsätze erkannt. Jede Buchung braucht ein Datum (z. B. 05.10.2026) und einen Betrag (z. B. -45,90). Am besten die Umsatzliste komplett markieren und einfügen, oder die CSV-Datei der Bank nehmen.",true);return}
  kaMatch(accId,KA.rows);kaRender();setMsg("kaMsg",(p.format==="csv"?"CSV-Datei":"Text")+" gelesen. Prüf die Liste und klick dann auf „übernehmen“.");
}
$("kaRead").addEventListener("click",function(){kaRead($("kaText").value)});
$("kaClear").addEventListener("click",function(){$("kaText").value="";$("kaFile").value="";KA.rows=[];KA.bal=[];kaRender();$("kaMeta").textContent="";setMsg("kaMsg","")});
$("kaAcc").addEventListener("change",function(){if(KA.rows.length){KA.acc=$("kaAcc").value;KA.rows.forEach(function(x){x.cat=""});kaMatch(KA.acc,KA.rows);kaRender()}});
$("kaFile").addEventListener("change",function(){
  var f=this.files&&this.files[0];if(!f)return;
  if(/\.pdf$/i.test(f.name)){setMsg("kaMsg","PDF-Dateien kann die Seite nicht direkt lesen. Öffne den Auszug, markiere die Umsätze (Strg+A), kopier sie (Strg+C) und füg sie oben ins Feld ein.",true);this.value="";return}
  if(f.size>5e6){setMsg("kaMsg","Die Datei ist zu groß (max. 5 MB).",true);return}
  var fr=new FileReader();fr.onload=function(){var t=STMT.decode(new Uint8Array(fr.result));$("kaText").value=t.slice(0,200000);kaRead(t)};fr.readAsArrayBuffer(f);
});
$("kaBody").addEventListener("change",function(e){
  var t=e.target,i;
  if((i=t.getAttribute("data-kaon"))!=null){KA.rows[+i].on=t.checked;kaRender()}
  else if((i=t.getAttribute("data-katext"))!=null)KA.rows[+i].text=t.value.trim().slice(0,200);
  else if((i=t.getAttribute("data-kacat"))!=null)KA.rows[+i].cat=t.value.trim().slice(0,40);
});
$("kaBody").addEventListener("click",function(e){var b=e.target.closest("[data-kasign]");if(!b)return;var x=KA.rows[+b.getAttribute("data-kasign")];x.amount=-x.amount;x.signSure=false;kaMatch(KA.acc,KA.rows);kaRender()});
$("kaAll").addEventListener("change",function(){var on=this.checked;KA.rows.forEach(function(x){if(x.st==="new"||x.st==="ord")x.on=on});kaRender()});
document.addEventListener("click",function(e){
  if(!e.target.closest||!e.target.closest("#kaRecon"))return;
  var b=KA.bal.filter(function(x){return x.date}).sort(function(a,c){return a.date<c.date?-1:1}).pop();if(!b)return;
  ui.acc=KA.acc;renderAll();$("rcDate").value=b.date;$("rcAmt").value=num(b.amount);
  var rc=document.querySelector('details[data-sec="recon"]');if(rc){rc.open=true;try{rc.scrollIntoView({block:"start"})}catch(x){}}
  $("rcCheck").click();
});
$("kaImport").addEventListener("click",function(){
  var acc=accById(D,KA.acc);if(!acc)return;var nNew=0,nOrd=0;
  KA.rows.forEach(function(x){
    if(!x.on)return;
    if(x.st==="ord"){
      var o=findOrder(x.oid);if(!o)return;var amt=Math.abs(x.amount),both=accById(D,o.from)&&accById(D,o.to),tr=both?newId():undefined;
      clearOcc(o,x.occ);
      if(accById(D,o.from))D.tx.push({id:newId(),acc:o.from,date:x.date,amount:-amt,text:o.name,cat:x.cat||o.cat||"",order:o.id,occ:x.occ,tr:tr,u:now()});
      if(accById(D,o.to))D.tx.push({id:newId(),acc:o.to,date:x.date,amount:amt,text:o.name,cat:x.cat||o.cat||"",order:o.id,occ:x.occ,tr:tr,u:now()});
      nOrd++;
    } else {D.tx.push({id:newId(),acc:acc.id,date:x.date,amount:x.amount,text:x.text||"Buchung",cat:x.cat||"",u:now()});nNew++}
  });
  if(!nNew&&!nOrd)return;
  save();ui.acc=acc.id;
  var keepBal=KA.bal;KA.rows=[];KA.bal=keepBal;$("kaText").value="";$("kaFile").value="";
  renderAll();
  setMsg("kaMsg","Übernommen in „"+acc.name+"“: "+(nNew?nNew+" Buchung"+(nNew>1?"en":""):"")+(nNew&&nOrd?" und ":"")+(nOrd?nOrd+" Dauerauftrag"+(nOrd>1?"sausführungen":"sausführung")+" bestätigt":"")+".");
  $("kaOut").hidden=!KA.bal.length;$("kaBody").innerHTML="";$("kaSum").innerHTML="";$("kaImport").disabled=true;$("kaImport").textContent="übernommen";kaBalance();
});
