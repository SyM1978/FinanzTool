/* ===================== Depot: Anbindung an die Hülle ===================== */
var $=SH.$,esc=SH.esc,P=SH.P,D=null,VIEWS=SH.VIEWS,curView="",VIEWHOOKS=[];
var APP_VERSION=SH.VERSION,APP_DATE=SH.VDATE;
/*UI*/
function persist(){SH.changed("dep",true)}
function save(){touch();SH.changed("dep")}
function showView(v,a){SH.showView(v,a)}
function setDrawer(o){SH.setDrawer(o)}
function applyLook(){SH.applyLook()}
function applySect(){SH.applySect()}
var setMsg=SH.setMsg,armed=SH.armed;
