/* ---------- Kontoauszug einlesen: Vorschau, Abgleich mit Buchungen und Daueraufträgen, Übernahme ---------- */
var KA={rows:[],bal:[],acc:null};
function kaAccs(){return shownAccs().filter(function(a){return !(a.shared&&a.shared.perm!=="write")})}
function kaFill(){
  var sel=$("kaAcc");if(!sel||!D)return;var keep=sel.value||KA.acc||ui.acc;
  sel.innerHTML=kaAccs().map(function(a){return '<option value="'+esc(a.id)+'">'+esc(a.name)+"</option>"}).join("");
  if(keep&&kaAccs().some(function(a){return a.id===keep}))sel.value=keep;
}
function dayDiff(a,b){return Math.round((parseKey(a)-parseKey(b))/864e5)}
var KA_STOP=/^(kartenzahlung|lastschrift|folgelastschrift|erstlastschrift|basislastschrift|überweisung|ueberweisung|gutschrift|gutschr|dauerauftrag|sepa|girocard|debitkarte|kreditkarte|visa|mastercard|umsatz|buchung|zahlung|einzug|entgelt|referenz|mandat|mandatsreferenz|kundenreferenz|glaeubiger|gläubiger|end-to-end|euro|online|onlinebanking|vom|datum|uhr|kasse|terminal|eref|mref|cred|svwz|abwa|iban|sagt|danke)$/;
function words(s){return String(s||"").toLowerCase().replace(/[^a-zäöüß0-9 ]/g," ").split(/\s+/).filter(function(w){return w.length>=4&&!KA_STOP.test(w)&&!/^\d+$/.test(w)})}
function kaGuessCat(text){
  var w=words(text);if(!w.length)return "";
  for(var i=D.tx.length-1;i>=0;i--){var t=D.tx[i];if(!t.cat||t.sec_tx)continue;var tw=words(t.text);if(tw.length&&tw.some(function(x){return w.indexOf(x)>=0}))return t.cat}
  return "";
}
function kaMatch(accId,rows){
  var a=accById(D,accId),r=compute(D).acc[accId],ev=r?r.ev:[],used={};
  rows.forEach(function(x,i){
    var prev=x.on;x.st="new";x.on=null;x.oid=null;x.occ=null;x.note="";x.cat=x.cat||"";
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
    if((x.st==="new"||x.st==="ord")&&typeof prev==="boolean"&&x.keep)x.on=prev;
  });
}
var KA_LBL={new:"neu",ord:"Dauerauftrag",dup:"schon gebucht",fee:"schon eingeplant",pending:"vorgemerkt",old:"zu alt"};
function kaAsk(x){return x.st==="new"||x.st==="ord"}
function kaOpen(){return KA.rows.filter(function(x){return kaAsk(x)&&x.on==null})}
function kaRender(){
  var out=$("kaOut");if(!KA.rows.length){out.hidden=true;$("kaQ").hidden=true;return}
  out.hidden=false;
  $("kaBody").innerHTML=KA.rows.map(function(x,i){
    var dec=kaAsk(x)?'<span class="kadec" role="group" aria-label="übernehmen?"><button type="button" class="btn" data-kayes="'+i+'" aria-pressed="'+(x.on===true)+'">Ja</button><button type="button" class="btn" data-kano="'+i+'" aria-pressed="'+(x.on===false)+'">Nein</button></span>':'<span class="kadec na">–</span>';
    return '<tr class="ka-'+x.st+(x.on===false?" off":"")+(x.on==null&&kaAsk(x)?" open":"")+(i===KA.cur?" cur":"")+'" data-kai="'+i+'"><td>'+dec+'</td><td class="mono">'+dmy(x.date)+'</td>'+
      '<td><input type="text" class="katext" data-katext="'+i+'" value="'+esc(x.text)+'" maxlength="200" aria-label="Text"><small class="kanote"><span class="tag '+(x.st==="new"?"ok":x.st==="ord"?"edit":"fee")+'">'+KA_LBL[x.st]+"</span>"+(x.note&&x.st!=="new"?" "+esc(x.note):"")+"</small></td>"+
      '<td><input type="text" class="kacat" data-kacat="'+i+'" value="'+esc(x.cat)+'" list="catList" maxlength="40" aria-label="Kategorie" placeholder="Kategorie"></td>'+
      '<td class="r"><span class="eur mono '+(x.amount<0?"neg":"pos")+'">'+eur(x.amount,true)+"</span>"+(x.signSure?"":'<button type="button" class="btn kasign" data-kasign="'+i+'" title="Vorzeichen umdrehen – im Text war nicht zu erkennen, ob Eingang oder Ausgang">±</button>')+"</td></tr>";
  }).join("");
  var yes=KA.rows.filter(function(x){return x.on===true}),sum=0,c={};yes.forEach(function(x){sum+=x.amount});KA.rows.forEach(function(x){c[x.st]=(c[x.st]||0)+1});
  var parts=[];if(c.new)parts.push(c.new+" neu");if(c.ord)parts.push(c.ord+(c.ord===1?" passt zu einem Dauerauftrag":" passen zu Daueraufträgen"));if(c.dup)parts.push(c.dup+" schon gebucht");if(c.fee)parts.push(c.fee+" schon eingeplant");if(c.pending)parts.push(c.pending+" vorgemerkt");if(c.old)parts.push(c.old+" vor dem Startwert");
  var unsure=KA.rows.filter(function(x){return !x.signSure&&kaAsk(x)}).length,open=kaOpen().length;
  $("kaSum").innerHTML="<b>"+KA.rows.length+" Umsätze erkannt</b>: "+esc(parts.join(", "))+"."+(c.dup||c.fee||c.pending||c.old?" Diese werden nicht übernommen.":"")+(unsure?' <span class="kawarn">'+(unsure===1?"Bei einem Umsatz":"Bei "+unsure+" Umsätzen")+" stand kein Vorzeichen dabei – bitte mit ± prüfen.</span>":"");
  $("kaImport").disabled=!!open||!yes.length;
  $("kaImport").textContent=open?"Noch "+open+" Posten offen":yes.length?yes.length+" übernehmen ("+eur(sum,true)+")":"nichts zu übernehmen";
  $("kaMeta").textContent=KA.rows.length+" erkannt"+(open?" · "+open+" offen":"");
  kaQuestion();kaBalance();
}
/* Frage für den nächsten offenen Posten */
function kaQuestion(){
  var q=$("kaQ"),open=kaOpen(),asked=KA.rows.filter(kaAsk);
  if(!asked.length){q.hidden=true;return}
  q.hidden=false;
  if(!open.length){
    var y=asked.filter(function(x){return x.on===true}).length;KA.cur=null;
    q.className="kaq done";q.innerHTML='<b>Alle '+asked.length+" Posten geprüft</b> – "+y+" übernehmen, "+(asked.length-y)+' nicht. Du kannst jede Entscheidung in der Liste noch ändern.';return;
  }
  var x=open[0],i=KA.rows.indexOf(x),pos=asked.indexOf(x)+1;KA.cur=i;
  q.className="kaq";
  q.innerHTML='<div class="kaqhead"><span class="lbl">Posten '+pos+" von "+asked.length+'</span><span class="kaqprog"><i style="width:'+Math.round((pos-1)/asked.length*100)+'%"></i></span></div>'+
    '<div class="kaqrow"><span class="mono">'+dmy(x.date)+'</span><b class="kaqtext">'+esc(x.text)+'</b><b class="eur mono '+(x.amount<0?"neg":"pos")+'">'+eur(x.amount,true)+"</b></div>"+
    '<p class="kaqnote">'+(x.st==="ord"?"Passt zum "+esc(x.note.replace(" – wird als ausgeführt bestätigt",""))+". Bei „Ja“ wird diese Ausführung als erledigt gebucht.":"Neue Buchung"+(x.cat?" in der Kategorie „"+esc(x.cat)+"“":"")+".")+(x.signSure?"":' <span class="kawarn">Vorzeichen unsicher – stimmt '+(x.amount<0?"Ausgabe":"Einnahme")+"?</span>")+"</p>"+
    '<p class="kaqq">Diesen Posten übernehmen?</p>'+
    '<div class="row"><button type="button" class="btn primary" id="kaYes">Ja, übernehmen</button><button type="button" class="btn" id="kaNo">Nein</button>'+
    (x.signSure?"":'<button type="button" class="btn" data-kasign="'+i+'">Vorzeichen umdrehen</button>')+
    '<button type="button" class="btn ghost" id="kaRestYes">Alle restlichen ('+open.length+') übernehmen</button></div>';
}
function kaDecide(i,v){var x=KA.rows[i];if(!x||!kaAsk(x))return;x.on=v;kaRender();var b=$("kaYes");if(b)try{b.focus({preventScroll:true})}catch(e){}}
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
  kaMatch(accId,KA.rows);kaRender();setMsg("kaMsg",(p.format==="csv"?"CSV-Datei":"Text")+" gelesen."+(kaOpen().length?" Bei jedem neuen Posten wirst du gefragt, ob er übernommen werden soll.":""));try{$("kaQ").scrollIntoView({block:"nearest"})}catch(e){}
}
$("kaRead").addEventListener("click",function(){kaRead($("kaText").value)});
$("kaClear").addEventListener("click",function(){$("kaText").value="";$("kaFile").value="";KA.rows=[];KA.cur=null;KA.bal=[];kaRender();$("kaMeta").textContent="";setMsg("kaMsg","")});
$("kaAcc").addEventListener("change",function(){if(KA.rows.length){KA.acc=$("kaAcc").value;KA.rows.forEach(function(x){x.cat="";x.on=null});kaMatch(KA.acc,KA.rows);kaRender()}});
$("kaFile").addEventListener("change",function(){
  var f=this.files&&this.files[0];if(!f)return;
  if(/\.pdf$/i.test(f.name)){setMsg("kaMsg","PDF-Dateien kann die Seite nicht direkt lesen. Öffne den Auszug, markiere die Umsätze (Strg+A), kopier sie (Strg+C) und füg sie oben ins Feld ein.",true);this.value="";return}
  if(f.size>5e6){setMsg("kaMsg","Die Datei ist zu groß (max. 5 MB).",true);return}
  var fr=new FileReader();fr.onload=function(){var t=STMT.decode(new Uint8Array(fr.result));$("kaText").value=t.slice(0,200000);kaRead(t)};fr.readAsArrayBuffer(f);
});
$("kaBody").addEventListener("change",function(e){
  var t=e.target,i;
  if((i=t.getAttribute("data-katext"))!=null)KA.rows[+i].text=t.value.trim().slice(0,200);
  else if((i=t.getAttribute("data-kacat"))!=null)KA.rows[+i].cat=t.value.trim().slice(0,40);
});
$("kaOut").addEventListener("click",function(e){
  var b=e.target.closest("button");if(!b)return;var i;
  if((i=b.getAttribute("data-kayes"))!=null)kaDecide(+i,true);
  else if((i=b.getAttribute("data-kano"))!=null)kaDecide(+i,false);
  else if((i=b.getAttribute("data-kasign"))!=null){var x=KA.rows[+i];x.amount=-x.amount;KA.rows.forEach(function(r){r.keep=true});x.keep=false;kaMatch(KA.acc,KA.rows);KA.rows.forEach(function(r){delete r.keep});kaRender()}
  else if(b.id==="kaYes"&&KA.cur!=null)kaDecide(KA.cur,true);
  else if(b.id==="kaNo"&&KA.cur!=null)kaDecide(KA.cur,false);
  else if(b.id==="kaRestYes"){kaOpen().forEach(function(x){x.on=true});kaRender()}
});
$("kaOut").addEventListener("keydown",function(e){
  if(KA.cur==null||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  if(e.key==="j"||e.key==="J"){e.preventDefault();kaDecide(KA.cur,true)}else if(e.key==="n"||e.key==="N"){e.preventDefault();kaDecide(KA.cur,false)}
});
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
    if(x.on!==true)return;
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
  $("kaOut").hidden=!KA.bal.length;$("kaQ").hidden=true;$("kaBody").innerHTML="";$("kaSum").innerHTML="";$("kaImport").disabled=true;$("kaImport").textContent="übernommen";kaBalance();
});

/* ---------- Bankabgleich: Konto sichtbar wählen ---------- */
function rcFill(){
  var sel=$("rcAcc");if(!sel||!D)return;var a=curAcc();
  sel.innerHTML=shownAccs().map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name)+"</option>"}).join("");
  if(a)sel.value=a.id;
  if(rcDiff&&a&&rcDiff.acc!==a.id){rcDiff=null;$("rcFix").hidden=true;setMsg("rcMsg","");$("reconMeta").textContent=""}
  if(!rcDiff)$("reconMeta").textContent=a?a.name:"";
}
$("rcAcc").addEventListener("change",function(){ui.acc=this.value;ui.occ=null;renderAccounts()});
