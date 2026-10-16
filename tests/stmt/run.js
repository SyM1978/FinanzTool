const S=require("../../web/src/stmt_parse.js"),fs=require("fs");
for(const f of process.argv.slice(2)){const r=S.parse(S.decode(fs.readFileSync(f)),{today:"2026-10-16"});console.log("==",f,r.format);r.rows.forEach(x=>console.log(x.date,(x.amount/100).toFixed(2).padStart(9),x.signSure?" ":"?",x.text));r.balances.forEach(b=>console.log("SALDO",b.date,b.amount/100,b.text))}
