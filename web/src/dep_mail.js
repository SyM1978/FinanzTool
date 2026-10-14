/* ---------- E-Mail-Alarme: der Server prüft und schickt die Mails ---------- */
function syncAlerts(){return Promise.resolve(null)}
function renderMail(){
  var u=SH.user();
  $("mOn").checked=!!u.alert_mail;
  if(document.activeElement!==$("mMail"))$("mMail").value=u.alert_email||"";
  $("mMail").placeholder=u.email||"du@beispiel.de";
  $("mailMeta").textContent=u.alert_mail?"an":"aus";
  $("mNoSmtp").hidden=u.mail_ready!==false;
}
$("mSave").addEventListener("click",function(){
  var m=$("mMail").value.trim();
  if(m&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)){setMsg("mMsg","Bitte eine gültige E-Mail-Adresse eintragen oder das Feld leer lassen.",true);return}
  SH.api("POST","/api/auth/profile",{alert_mail:$("mOn").checked,alert_email:m}).then(SH.refreshMe).then(function(){renderAll();setMsg("mMsg",$("mOn").checked?"E-Mail-Alarme sind an.":"E-Mail-Alarme sind aus.")}).catch(function(e){setMsg("mMsg",e.message,true)});
});
$("mTest").addEventListener("click",function(){
  setMsg("mMsg","Sende Test-Mail …");
  SH.api("POST","/api/alerts/testmail").then(function(j){setMsg("mMsg","Test-Mail an "+j.email+" verschickt. Schau auch im Spam-Ordner nach.")}).catch(function(e){setMsg("mMsg",e.message,true)});
});
$("mStatus").addEventListener("click",function(){
  SH.api("GET","/api/alerts/status").then(function(j){
    var t=(D.alerts||[]).length+" Alarme, E-Mail "+(j.enabled?"an ("+j.email+")":"aus")+". ";
    t+=j.lastRun?"Zuletzt geprüft "+relTime(Date.parse(j.lastRun)/1000)+".":"Der Alarm-Dienst hat noch nicht geprüft (Timer auf dem Server, siehe Anleitung).";
    var f=Object.keys(j.fired||{}).map(function(k){return j.fired[k]}).sort().pop();if(f)t+=" Letzte Alarm-Mail "+relTime(f)+".";
    if(j.lastError)t+=" Fehler: "+j.lastError;
    if(!j.mailReady)t+=" Auf dem Server ist noch kein Mailversand eingerichtet.";
    setMsg("mMsg",t,!!j.lastError||!j.mailReady);
  }).catch(function(e){setMsg("mMsg",e.message,true)});
});
