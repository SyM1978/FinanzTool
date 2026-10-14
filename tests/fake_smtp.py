# Mini-SMTP-Server für Tests: schreibt jede Mail nach /tmp/mf_mails/
import socketserver, os, time
os.makedirs("/tmp/mf_mails", exist_ok=True)
class H(socketserver.StreamRequestHandler):
    def w(self, s): self.wfile.write((s + "\r\n").encode())
    def handle(self):
        self.w("220 fake ESMTP"); data = None
        while True:
            line = self.rfile.readline()
            if not line: return
            cmd = line.decode(errors="replace").strip()
            u = cmd.upper()
            if data is not None:
                if cmd == ".":
                    open("/tmp/mf_mails/%f.eml" % time.time(), "w").write("\n".join(data)); data = None; self.w("250 OK")
                else: data.append(cmd)
                continue
            if u.startswith("EHLO") or u.startswith("HELO"): self.w("250 fake")
            elif u.startswith("DATA"): data = []; self.w("354 go")
            elif u.startswith("QUIT"): self.w("221 bye"); return
            else: self.w("250 OK")
class S(socketserver.ThreadingTCPServer): allow_reuse_address = True
S(("127.0.0.1", 8825), H).serve_forever()
