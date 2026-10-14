# Nachbildung von onvista, EZB und einem blockierenden Yahoo (429)
import json, time, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
OV={"DE0007164600":("STOCK","SAP SE","716460",214.35,212.0,"EUR"),"DE0008404005":("STOCK","Allianz SE","840400",352.9,352.2,"EUR"),
    "IE00B4L5Y983":("FUND","iShares Core MSCI World UCITS ETF","A0RPWH",104.2,104.9,"EUR"),"US0378331005":("STOCK","Apple Inc.","865985",201.4,199.0,"EUR")}
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,body,ct="application/json",code=200):
        b=body.encode() if isinstance(body,str) else body;self.send_response(code);self.send_header("Content-Type",ct);self.end_headers();self.wfile.write(b)
    def do_GET(self):
        u=urlparse(self.path);q=parse_qs(u.query);p=u.path
        if p.startswith("/yahoo/"): return self.send("Too Many Requests","text/plain",429)
        if p=="/ecb.xml": return self.send("<?xml version='1.0'?><gesmes:Envelope><Cube><Cube time='2026-10-13'><Cube currency='USD' rate='1.0915'/><Cube currency='GBP' rate='0.8402'/></Cube></Cube></gesmes:Envelope>","text/xml")
        if p=="/ov/instruments/query":
            t=q.get("searchValue",[""])[0].lower()
            lst=[{"entityType":v[0],"isin":k,"name":v[1],"tinyName":v[1],"wkn":v[2],"displayType":"Aktie"} for k,v in OV.items() if t in v[1].lower() or t==k.lower() or t==v[2].lower()]
            lst.append({"entityType":"DERIVATIVE","isin":"DE000XX00001","name":"Turbo auf "+t,"wkn":"XX0001"})
            return self.send(json.dumps({"expires":0,"searchValue":t,"list":lst}))
        m=re.match(r"^/ov/(stocks|funds)/ISIN:([A-Z0-9]+)/snapshot$",p)
        if m:
            k=m.group(2)
            if k not in OV: return self.send(json.dumps({"error":"not found"}),code=404)
            v=OV[k];return self.send(json.dumps({"instrument":{"name":v[1],"isin":k},"quote":{"last":v[3],"previousLast":v[4],"isoCurrency":v[5],"datetimeLast":"2026-10-13T15:20:00.000+02:00","market":{"name":"Tradegate","idNotation":4711,"codeExchange":"GAT"}}}))
        m=re.match(r"^/ov/instruments/([A-Z]+)/ISIN:([A-Z0-9]+)/eod_history$",p)
        if m and q.get("idNotation")==["4711"]:
            v=OV[m.group(2)];n=250;now=int(time.time())
            return self.send(json.dumps({"datetimeLast":[now-86400*(n-i) for i in range(n)],"last":[round(v[3]*(0.8+0.2*i/n),2) for i in range(n)]}))
        self.send(json.dumps({"error":"?"}),code=404)
ThreadingHTTPServer(("127.0.0.1",8782),H).serve_forever()
