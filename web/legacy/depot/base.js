/* ===================== Grundfunktionen ===================== */
var MON=["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
var MONs=["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
var WDs=["So","Mo","Di","Mi","Do","Fr","Sa"];
var KINDS={giro:"Girokonto",haushalt:"Haushaltskonto",spar:"Sparkonto",kredit:"Kredit",karte:"Kreditkarte",sonst:"Sonstiges"};
var INTV={m:{n:1,label:"monatlich"},q:{n:3,label:"vierteljährlich"},h:{n:6,label:"halbjährlich"},j:{n:12,label:"jährlich"}};
var COLORS=["#985A1C","#1D5F8A","#3F6B3A","#7A3E6E","#B42318","#8A5A06","#2F6F73","#55565B"];
var pad=function(n){return String(n).padStart(2,"0")};
var keyOf=function(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())};
var parseKey=function(k){var p=k.split("-").map(Number);return new Date(p[0],p[1]-1,p[2])};
var isKey=function(k){return typeof k==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(k)};
var TODAY_OVERRIDE=null;
var todayKey=function(){return TODAY_OVERRIDE||keyOf(new Date())};
var lastDay=function(y,m){return new Date(y,m+1,0).getDate()};
var mk=function(y,m,d){if(d<1)return keyOf(new Date(y,m,d));var yy=y+Math.floor(m/12),mm=((m%12)+12)%12;return yy+"-"+pad(mm+1)+"-"+pad(Math.min(d,lastDay(yy,mm)))};
var addDays=function(k,n){var d=parseKey(k);d.setDate(d.getDate()+n);return keyOf(d)};
var addYears=function(k,n){var p=k.split("-").map(Number);return mk(p[0]+n,p[1]-1,p[2])};
var dmy=function(k){return k?k.slice(8,10)+"."+k.slice(5,7)+"."+k.slice(0,4):"–"};
var dm=function(k){return k.slice(8,10)+"."+k.slice(5,7)+"."};
function newId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function now(){return Date.now()}

/* ---------- Geld ---------- */
var NF=new Intl.NumberFormat("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2});
function eur(c,signed){
  if(c==null||isNaN(c))return "–";
  var s=NF.format(Math.abs(c)/100)+" €";
  if(signed){if(Math.round(c)===0)return "±"+s;return (c<0?"−":"+")+s}
  return (c<0&&Math.round(c)!==0?"−":"")+s;
}
function eur0(c){return (c<0?"−":"")+new Intl.NumberFormat("de-DE",{maximumFractionDigits:0}).format(Math.abs(c)/100)+" €"}
function num(c){return NF.format(c/100)}
function parseEur(str){
  if(str==null)return null;
  var s=String(str).replace(/[€\s ]/g,"").replace("−","-");
  if(!s)return null;
  var neg=false; if(s[0]==="-"){neg=true;s=s.slice(1)}else if(s[0]==="+")s=s.slice(1);
  if(s.indexOf(",")>=0)s=s.replace(/\./g,"").replace(",",".");
  else if((s.match(/\./g)||[]).length>1)s=s.replace(/\./g,"");
  else if(/^\d{1,3}\.\d{3}$/.test(s))s=s.replace(".","");
  if(!/^\d+(\.\d+)?$/.test(s))return null;
  var v=Math.round(parseFloat(s)*100); return neg?-v:v;
}
function parseRate(str){if(str==null)return null;var s=String(str).trim().replace("%","").replace(",",".");if(!s)return null;var v=parseFloat(s);return isFinite(v)&&v>=0&&v<100?v:null}
function fmtRate(r){return r==null?"":String(r).replace(".",",")}

