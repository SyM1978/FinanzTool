/* ---------- Kredit-Maske: Effektiv-/Sollzins, Plausibilitätsprüfung, Vorschau ---------- */
/* Effektiver Jahreszins → monatlicher Sollzins p. a. (Zinseszins bei monatlicher Zahlung) */
function effToNom(e){return 1200*(Math.pow(1+e/100,1/12)-1)}
function nomToEff(n){return 100*(Math.pow(1+n/1200,12)-1)}
function fmtPct(v,dig){return new Intl.NumberFormat("de-DE",{minimumFractionDigits:2,maximumFractionDigits:dig||2}).format(v)}
function loanRateIn(){
  var v=parseRate($("aRate").value),eff=$("aRateType").value==="eff";
  if(v==null||v<=0)return {nom:0,eff:null,raw:v};
  return eff?{nom:Math.round(effToNom(v)*10000)/10000,eff:v,raw:v}:{nom:v,eff:null,raw:v};
}
/* Fälligkeiten wie im Rechenkern: Tag `day`, erster Termin am oder nach dem Startdatum */
function dueAfter(sd,day,i){var p=parseKey(sd),k=mk(p.getFullYear(),p.getMonth(),day),off=k<sd?1:0;return mk(p.getFullYear(),p.getMonth()+off+i,day)}
/* Verlauf ab Startwert: Zinsen, dann Rate am selben Tag (wie der Rechenkern) */
function loanPreview(start,sd,nom,pay,day){
  var tk=todayKey(),b=start,today=start,intAll=0,n=0,last=null,left=0;
  for(var i=0;i<720&&b>0;i++){
    var d=dueAfter(sd,day,i),z=Math.round(b*nom/100/12);
    if(pay>0&&z>=pay&&i===0)return {stuck:true,z:z};
    b+=z;intAll+=z;var r=Math.min(pay,b);b-=r;n++;last=d;
    if(d<=tk)today=b;else left++;
    if(!pay)break;
  }
  return {stuck:false,today:today,end:b<=0?last:null,left:left,intAll:intAll,first:dueAfter(sd,day,0)};
}
/* Sieht der Betrag wie „Gesamtbetrag“ = n Raten × Rate aus? */
function looksTotal(amount,pay){
  if(!(amount>0&&pay>0))return 0;var n=amount/pay,k=Math.round(n);
  return k>=12&&k<=600&&Math.abs(amount-k*pay)<=pay*0.02?k:0;
}
/* Restschuld heute, wenn `total` der Gesamtbetrag aus n Raten ist und die erste Rate am ersten Termin ab `sd` fällig war */
function restFromTotal(total,pay,n,sd,day,nom){
  var tk=todayKey(),paid=0;
  while(paid<n&&dueAfter(sd,day,paid)<=tk)paid++;
  var k=n-paid;if(k<=0)return {rest:0,paid:paid,date:tk};
  var lastPay=total-(n-1)*pay,i=nom/1200,pv=0;
  for(var j=1;j<=k;j++){var amt=j===k?lastPay:pay;pv+=i>0?amt/Math.pow(1+i,j):amt}
  var dd=paid>0?addDays(dueAfter(sd,day,paid-1),1):sd;
  return {rest:Math.round(pv),paid:paid,left:k,date:dd};
}
var loanFix=null;
function loanCheck(){
  var box=$("aLoanCheck");if(!box)return;
  if($("aKind").value!=="kredit"){box.innerHTML="";return}
  var R=loanRateIn(),sv=parseEur($("aStart").value)||0,start=Math.abs(sv),sd=$("aStartDate").value,pay=Math.abs(parseEur($("aPay").value)||0),day=+$("aPayDay").value||1,orig=Math.abs(parseEur($("aOrig").value)||0);
  $("aRateConv").textContent=R.raw>0?(R.eff!=null?"entspricht "+fmtPct(R.nom,3)+" % Sollzins":"entspricht ca. "+fmtPct(nomToEff(R.nom))+" % effektiv"):"";
  var h=[],warn=[];loanFix=null;
  var k=looksTotal(start,pay);
  if(k&&R.nom>0&&isKey(sd)){
    var f=restFromTotal(start,pay,k,sd,day,R.nom);
    loanFix={rest:f.rest,date:f.date};
    warn.push('<div class="lnwarn"><b>'+eur(start)+" sind genau "+k+" Monatsraten à "+eur(pay)+".</b> Das ist vermutlich der <b>Gesamtbetrag</b> aus dem Vertrag – darin sind alle künftigen Zinsen schon enthalten. "+
      "Eingetragen werden muss die <b>Restschuld</b>, sonst rechnet die App Zinsen auf Zinsen."+
      (f.rest>0?'<span class="lnfix">Falls die erste Rate am '+dmy(dueAfter(sd,day,0))+" fällig war, sind "+f.paid+" Raten bezahlt und noch "+f.left+" offen. Restschuld ab "+dmy(f.date)+": <b>ca. "+eur(f.rest)+'</b> <button type="button" class="btn" id="aLoanFix">Übernehmen</button></span>':"")+
      '<small>Genauer ist immer der Wert aus deinem Kontoauszug oder Online-Banking.</small></div>');
  }
  var ko=looksTotal(orig,pay);
  if(ko&&!k)warn.push('<div class="lnwarn"><b>Ursprünglicher Betrag = '+ko+" × Rate.</b> Das ist vermutlich der Gesamtbetrag inklusive Zinsen. Gemeint ist der ausgezahlte <b>Nettodarlehensbetrag</b>, sonst stimmt die Anzeige „% getilgt“ nicht.</div>");
  if(start>0&&isKey(sd)&&(pay>0||R.nom>0)){
    var p=loanPreview(start,sd,R.nom,pay,day);
    if(p.stuck)warn.push('<div class="lnwarn"><b>Die Rate deckt nicht einmal die Zinsen</b> (ca. '+eur(p.z)+" im Monat). Bitte Restschuld, Zins und Rate prüfen.</div>");
    else{
      h.push('<div class="fc"><span class="lbl">Restschuld heute</span><b class="eur">'+eur(Math.max(0,p.today))+"</b><small>so rechnet die App, Stand "+dmy(todayKey())+"</small></div>");
      h.push('<div class="fc"><span class="lbl">Letzte Rate</span><b>'+(p.end?dmy(p.end):"–")+"</b><small>"+(p.end?"noch "+p.left+" Raten":pay?"nicht absehbar":"keine Rate eingetragen")+"</small></div>");
      h.push('<div class="fc"><span class="lbl">Zinsen ab Startwert</span><b class="eur">'+eur(p.intAll)+"</b><small>erste Rate danach am "+dmy(p.first)+"</small></div>");
    }
    if(sd<addDays(todayKey(),-400)&&!k)h.push('<p class="hintline span3">Tipp: Je älter das Datum, desto eher weicht die Rechnung durch Rundungen der Bank ab. Trag zwischendurch die aktuelle Restschuld aus dem Kontoauszug ein.</p>');
  }
  box.innerHTML=warn.join("")+(h.length?'<div class="lnprev">'+h.join("")+"</div>":"");
}
document.addEventListener("click",function(e){
  if(!e.target.closest||!e.target.closest("#aLoanFix")||!loanFix)return;
  $("aStart").value=num(loanFix.rest);$("aStartDate").value=loanFix.date;loanCheck();
  setMsg("accMsg","Restschuld übernommen. Bitte mit dem Kontoauszug vergleichen und dann speichern.");
});
["aStart","aStartDate","aRate","aRateType","aPay","aPayDay","aOrig","aKind"].forEach(function(id){var el=$(id);if(!el)return;el.addEventListener("input",loanCheck);el.addEventListener("change",loanCheck)});
