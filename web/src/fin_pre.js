/* ===================== Finanzen: Anbindung an die Hülle ===================== */
var $=SH.$,esc=SH.esc,P=SH.P,D=null,VIEWS=SH.VIEWS;
var APP_VERSION=SH.VERSION,APP_DATE=SH.VDATE;
/*UI*/
function persist(){SH.changed("fin")}
function save(){touch();SH.changed("fin")}
function showView(v,a){SH.showView(v,a)}
function setDrawer(o){SH.setDrawer(o)}
function applyLook(){SH.applyLook()}
function applySect(){SH.applySect()}
var setMsg=SH.setMsg,armed=SH.armed;
