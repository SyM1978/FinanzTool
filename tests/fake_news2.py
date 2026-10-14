from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import time
from email.utils import formatdate
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        q=parse_qs(urlparse(self.path).query).get("q",[""])[0]
        name=q.split('"')[1] if '"' in q else q
        items="".join("<item><title>%s meldet Quartalszahlen Nr. %d &amp; mehr - Testquelle %d</title><link>https://news.example.org/%s/%d</link><pubDate>%s</pubDate><source url='https://q%d.example'>Testquelle %d</source></item>"%(name,i,i,name.replace(' ','-'),i,formatdate(time.time()-i*7200),i,i) for i in range(1,4))+"<item><title>%s gestern: alte Meldung - Altquelle</title><link>https://news.example.org/old</link><pubDate>%s</pubDate><source url='https://old.example'>Altquelle</source></item>"%(name,formatdate(time.time()-30*3600))
        b=("<?xml version='1.0' encoding='UTF-8'?><rss version='2.0'><channel><title>t</title>%s</channel></rss>"%items).encode()
        self.send_response(200);self.send_header("Content-Type","application/rss+xml");self.end_headers();self.wfile.write(b)
ThreadingHTTPServer(("127.0.0.1",8784),H).serve_forever()
