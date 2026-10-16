/* ---------- Kontoauszug lesen: CSV der Bank oder kopierter Text (Online-Banking, PDF) ---------- */
var STMT=(function(){
"use strict";
var MONTHS={jan:1,januar:1,feb:2,februar:2,"mär":3,mar:3,"märz":3,maerz:3,apr:4,april:4,mai:5,jun:6,juni:6,jul:7,juli:7,aug:8,august:8,sep:9,sept:9,september:9,okt:10,oktober:10,nov:11,november:11,dez:12,dezember:12};
var pad=function(n){return String(n).padStart(2,"0")};
function iso(y,m,d){if(!(y>1990&&y<2100&&m>=1&&m<=12&&d>=1&&d<=31))return null;var dt=new Date(y,m-1,d);if(dt.getMonth()!==m-1)return null;return y+"-"+pad(m)+"-"+pad(d)}
/* Betrag in Cent: "1.234,56", "-45,90", "45,90-", "1234.56", "+12,00 €", "45,90 S" */
function amount(s){
  if(s==null)return null;s=String(s).replace(/ /g," ").trim();if(!s)return null;
  var neg=/^[-−–]|[-−–]$|\bS$|\bSoll$/i.test(s)||/^\(.*\)$/.test(s);
  s=s.replace(/EUR|€|\bS$|\bH$|Soll|Haben|[()+\-−–\s]/gi,"");
  if(!/^\d[\d.,']*$/.test(s))return null;
  var c=s.lastIndexOf(","),d=s.lastIndexOf("."),v;
  if(c>d)v=s.replace(/[.']/g,"").replace(",",".");          // 1.234,56
  else if(d>c&&s.length-d===3)v=s.replace(/[,']/g,"");     // 1,234.56
  else if(d>c)v=s.replace(/[.,']/g,"");                     // 1.234 (Tausender)
  else v=s.replace(/'/g,"");
  var n=Math.round(parseFloat(v)*100);if(!isFinite(n))return null;return neg?-n:n;
}
function dateOf(s,ctx){
  s=String(s||"").trim();var m;
  if((m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)))return iso(+m[1],+m[2],+m[3]);
  if((m=/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/.exec(s))){var y=+m[3];if(y<100)y+=2000;return iso(y,+m[2],+m[1])}
  if((m=/^(\d{1,2})\.(\d{1,2})\.(?!\d)/.exec(s)))return guessYear(+m[2],+m[1],ctx);
  if((m=/^(\d{1,2})\.?\s+([A-Za-zäÄ]{3,9})\.?\s*(\d{4})?/.exec(s))){var mo=MONTHS[m[2].toLowerCase()];if(mo)return m[3]?iso(+m[3],mo,+m[1]):guessYear(mo,+m[1],ctx)}
  return null;
}
function guessYear(mo,d,ctx){
  var t=ctx&&ctx.today?ctx.today:new Date().toISOString().slice(0,10),y=ctx&&ctx.year?ctx.year:+t.slice(0,4),k=iso(y,mo,d);
  if(k&&!(ctx&&ctx.year)&&k>addD(t,10))k=iso(y-1,mo,d);
  return k;
}
function addD(k,n){var p=k.split("-").map(Number),d=new Date(p[0],p[1]-1,p[2]+n);return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
var SALDO=/(alter|neuer|end|anfangs)?\s*(kontostand|saldo)|kontostand\s+am|^\s*summe\b|übertrag/i;
var POSWORDS=/gutschrift|gehalt|lohn|bezüge|rente|eingang|erstattung|zinsgutschrift|habenzins|überweisung von|dividende|kindergeld|rückzahlung|einzahlung/i;

/* ---------- CSV ---------- */
function splitCsv(line,sep){
  var out=[],cur="",q=false;
  for(var i=0;i<line.length;i++){var ch=line[i];
    if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}
    else if(ch==='"')q=true;else if(ch===sep){out.push(cur);cur=""}else cur+=ch}
  out.push(cur);return out.map(function(x){return x.trim()});
}
function findCol(h,res,not){for(var r=0;r<res.length;r++)for(var i=0;i<h.length;i++){if(res[r].test(h[i])&&!(not&&not.test(h[i])))return i}return -1}
function parseCsv(lines,ctx){
  var best=null;
  [";","\t",","].forEach(function(sep){
    for(var i=0;i<Math.min(lines.length,40);i++){
      var h=splitCsv(lines[i],sep).map(function(x){return x.toLowerCase().replace(/\s+/g," ")});if(h.length<3)continue;
      var cd=findCol(h,[/^buchungstag$/,/^buchungsdatum$/,/^buchung$/,/^datum$/,/buchungs?tag|buchungsdatum/,/^(booking )?date$/,/datum/],/valuta|wertstellung/);
      var ca=findCol(h,[/^betrag( \(€\)| \(eur\)| in eur)?$/,/^umsatz( in eur)?$/,/^amount/,/betrag|umsatz/],/saldo|währung|waehrung|ursprung|fremd/);
      var cs=findCol(h,[/^soll$/,/^soll \(eur\)$/,/^ausgang/]),chb=findCol(h,[/^haben$/,/^haben \(eur\)$/,/^eingang/]);
      if(cd<0||(ca<0&&cs<0&&chb<0))continue;
      if(!best||i<best.row)best={sep:sep,row:i,h:h,cd:cd,ca:ca,cs:cs,ch:chb};
      break;
    }
  });
  if(!best)return null;
  var pre=[];
  for(var j=0;j<best.row;j++){if(SALDO.test(lines[j])){var am=amountsIn(lines[j].replace(/[";]/g," ")),dm=/(\d{1,2}\.\d{1,2}\.\d{2,4})/.exec(lines[j]);if(am.length)pre.push({date:dm?dateOf(dm[1],ctx):null,amount:am[am.length-1].v,text:clean(lines[j].replace(/["]/g,"").replace(/;/g," "))})}}
  var h=best.h,sh=findCol(h,[/^soll\/haben$/,/^s\/h$/,/^soll-haben/]);
  var cn=[findCol(h,[/beg(ue|ü)nstigter\/zahlungspflichtiger/,/zahlungsempf(ä|ae)nger\*?in/,/^zahlungsempf/,/^empf(ä|ae)nger/,/auftraggeber\/empf/,/^name/,/gegenkonto|payee|counterparty/])];
  var cp=findCol(h,[/zahlungspflichtige\*?r/]);
  var cv=findCol(h,[/^verwendungszweck/,/verwendungszweck|purpose|beschreibung|description/]),cb=findCol(h,[/^buchungstext$/,/^umsatzart$|^umsatztyp$|^vorgang|^transaktionstyp/]);
  var cst=findCol(h,[/^status$/]),rows=[];
  for(var i=best.row+1;i<lines.length;i++){
    var f=splitCsv(lines[i],best.sep);if(f.length<2)continue;
    var d=dateOf(f[best.cd],ctx);if(!d)continue;
    var a=best.ca>=0?amount(f[best.ca]):null;
    if(a==null&&(best.cs>=0||best.ch>=0)){var so=best.cs>=0?amount(f[best.cs]):0,ha=best.ch>=0?amount(f[best.ch]):0;if(so==null&&ha==null)continue;a=(ha?Math.abs(ha):0)-(so?Math.abs(so):0)}
    if(a==null)continue;
    if(sh>=0&&/^s/i.test(f[sh]||""))a=-Math.abs(a);else if(sh>=0&&/^h/i.test(f[sh]||""))a=Math.abs(a);
    var name=cn[0]>=0?f[cn[0]]:"";
    if(cp>=0&&f[cp]&&a>0&&!/^$/.test(f[cp]))name=f[cp];
    var parts=[name,cv>=0?f[cv]:"",cb>=0&&!name&&!(cv>=0&&f[cv])?f[cb]:""].filter(function(x){return x&&x.trim()});
    var text=clean(parts.join(" · "))||(cb>=0?f[cb]:"")||"Buchung";
    rows.push({date:d,amount:a,text:text,type:cb>=0?f[cb]:"",pending:cst>=0&&/vorgemerkt|pending/i.test(f[cst]||""),signSure:true});
  }
  return {format:"csv",rows:rows,balances:pre};
}

/* ---------- freier Text ---------- */
var AMT_RE=/(?:^|\s)([+\-−–]?\s?(?:\d{1,3}(?:[.'  ]\d{3})+|\d+),\d{2}(?:\s?[+\-−–])?)(?:\s?(?:€|EUR))?(?:\s?(S|H|Soll|Haben))?(?=\s|$)/g;
function amountsIn(line){
  var out=[],m;AMT_RE.lastIndex=0;
  while((m=AMT_RE.exec(line))){var raw=m[1].replace(/[  ](?=\d{3})/g,"."),v=amount(raw+(m[2]?" "+m[2][0].toUpperCase():""));if(v!=null)out.push({v:v,raw:m[0],idx:m.index,signed:/[+\-−–]/.test(m[1])||!!m[2]})}
  return out;
}
var DATE_START=/^\s*(\d{1,2}\.\d{1,2}\.(?:\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\.?\s+(?:Jan|Feb|Mär|Mar|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez)[a-zä]*\.?(?:\s+\d{4})?)/i;
function clean(s){return String(s).replace(/\s+/g," ").replace(/\s*·\s*(·\s*)+/g," · ").replace(/^[\s·,;:-]+|[\s·,;:-]+$/g,"").slice(0,200)}
function parseText(lines,ctx){
  var rows=[],balances=[],cur=null;
  function flush(){
    if(!cur)return;var b=cur;cur=null;
    var all=b.lines.join(" \n ");
    if(SALDO.test(b.lines[0])||(b.lines.length===1&&SALDO.test(all))){var am=amountsIn(b.lines[0]);if(am.length)balances.push({date:b.date,amount:am[am.length-1].v,text:clean(b.lines[0])});return}
    var pick=null,pickLine=-1;
    for(var i=0;i<b.lines.length&&!pick;i++){var am=amountsIn(b.lines[i]);if(am.length){pick=am.length>1&&i===0?am[am.length-2]:am[am.length-1];pickLine=i;if(am.length>1&&i===0&&!am[am.length-2].signed&&am[am.length-1].signed)pick=am[am.length-1]}}
    if(!pick)return;
    var text=b.lines.map(function(l,i){var t=l;if(i===0)t=t.replace(DATE_START,"").replace(DATE_START,"");if(i===pickLine){var am=amountsIn(t);am.forEach(function(x){t=t.replace(x.raw," ")})}return t.replace(/\b(EUR|€)\b/g,"")}).join(" · ");
    text=clean(text);var v=pick.v,sure=pick.signed;
    if(!sure)v=POSWORDS.test(text)?Math.abs(v):-Math.abs(v);
    rows.push({date:b.date,amount:v,text:text||"Buchung",type:"",signSure:sure});
  }
  lines.forEach(function(l){
    var t=l.replace(/ /g," ").trim();if(!t)return;
    var m=DATE_START.exec(t);
    if(m){var d=dateOf(m[1],ctx);if(d){flush();cur={date:d,lines:[t]};return}}
    if(SALDO.test(t)){flush();var am=amountsIn(t),dm=/(\d{1,2}\.\d{1,2}\.\d{2,4})/.exec(t);if(am.length)balances.push({date:dm?dateOf(dm[1],ctx):null,amount:am[am.length-1].v,text:clean(t)});return}
    if(cur){if(cur.lines.length<6)cur.lines.push(t)}
  });
  flush();
  return {format:"text",rows:rows,balances:balances};
}
function decode(buf){
  try{return new TextDecoder("utf-8",{fatal:true}).decode(buf).replace(/^﻿/,"")}catch(e){return new TextDecoder("windows-1252").decode(buf)}
}
function parse(text,ctx){
  ctx=ctx||{};text=String(text||"").replace(/\r\n?/g,"\n");
  var lines=text.split("\n");
  if(!ctx.year){var yh=/(?:kontoauszug|auszug|zeitraum|vom|bis|per)\D{0,40}(?:\d{1,2}\.\d{1,2}\.)?(20\d{2})/i.exec(text);if(yh)ctx.year=+yh[1]}
  var r=parseCsv(lines,ctx);
  if(!r||!r.rows.length)r=parseText(lines,ctx);
  r.rows.sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:0});
  return r;
}
return {parse:parse,amount:amount,dateOf:dateOf,decode:decode};
})();
if(typeof module!=="undefined"&&module.exports)module.exports=STMT;
