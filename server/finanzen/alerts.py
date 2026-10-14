"""Kursalarme per E-Mail.

Läuft als Dienst per systemd-Timer (alle 15 Minuten, siehe deploy/):
    python -m finanzen.alerts run
    python -m finanzen.alerts test name@example.de
    python -m finanzen.alerts loop        (für Container: prüft selbst alle 15 Minuten,
                                           werktags 8–22 Uhr in der Zeitzone TZ)

Pro Nutzer mit eingeschalteten Mail-Alarmen: Kurse holen, Bedingungen prüfen,
eine Sammel-Mail schicken. Schwellen (über/unter) melden sich erst wieder, wenn
der Kurs zwischendurch zurückgekommen ist; Tagesbewegungen höchstens einmal am Tag."""
import datetime as dt
import os
import sys

from fastapi import APIRouter, Depends, HTTPException

from . import db, market
from .auth import User, current_user
from .config import settings
from .mail import send_mail

router = APIRouter(prefix="/api/alerts")


def hit(a: dict, q: dict) -> bool:
    if not q or q.get("price") is None:
        return False
    v, p = float(a["value"]), float(q["price"])
    t = a["type"]
    if t == "above":
        return p >= v
    if t == "below":
        return p <= v
    if not q.get("prev"):
        return False
    ch = (p / float(q["prev"]) - 1) * 100
    if t == "dayDown":
        return ch <= -abs(v)
    if t == "dayUp":
        return ch >= abs(v)
    return False


def de(v: float, d: int = 2) -> str:
    return f"{v:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def run(verbose: bool = False) -> dict:
    with db.tx() as c:
        users = c.execute("SELECT * FROM fin.alert_users()").fetchall()
    today = dt.date.today()
    total = {"users": len(users), "sent": 0, "errors": 0}
    for us in users:
        uid = str(us["user_id"])
        with db.tx(uid) as c:
            alerts = c.execute("SELECT * FROM fin.price_alerts").fetchall()
        if not alerts:
            continue
        q = market.quotes(list({a["sym"] for a in alerts}))["quotes"]
        hits, updates = [], []
        for a in alerts:
            daily = a["type"] in ("dayDown", "dayUp")
            h = hit(a, q.get(a["sym"]))
            if h and ((daily and a["mail_day"] != today) or (not daily and a["mail_armed"])):
                hits.append((a, q[a["sym"]]))
                updates.append((False, today, a["id"]))
            elif not h and not daily and not a["mail_armed"]:
                updates.append((True, a["mail_day"], a["id"]))     # wieder scharf
        err = None
        if hits:
            lines = []
            for a, qq in hits:
                ch = (qq["price"] / qq["prev"] - 1) * 100 if qq.get("prev") else 0
                cond = {"above": "steigt auf " + de(float(a["value"])), "below": "fällt auf " + de(float(a["value"])),
                        "dayDown": f"fällt heute um {de(float(a['value']), 1)} %", "dayUp": f"steigt heute um {de(float(a['value']), 1)} %"}[a["type"]]
                lines.append(f"• {a['name']}: {cond}\n  Kurs jetzt {de(qq['price'])} {qq.get('currency') or ''} ({'+' if ch >= 0 else ''}{de(ch, 1)} % heute)")
            subj = f"Kursalarm: {hits[0][0]['name']}" if len(hits) == 1 else f"{len(hits)} Kursalarme in deinem Depot"
            link = f"\n\n{settings.app_url.rstrip('/')}/#alarme" if settings.app_url else ""
            try:
                send_mail(us["email"], subj, f"Hallo {us['name']},\n\nfolgende Kursalarme haben ausgelöst:\n\n" + "\n\n".join(lines)
                          + f"{link}\n\nKurse meist verzögert, ohne Gewähr.\n-- \nMeine Finanzen · Smooth Solutions\n")
                total["sent"] += len(hits)
            except Exception as e:  # beim nächsten Lauf erneut versuchen
                err = str(e)[:200]
                total["errors"] += 1
                hit_ids = {a["id"] for a, _ in hits}
                updates = [u for u in updates if u[2] not in hit_ids]
        with db.tx(uid) as c:
            if updates:
                c.cursor().executemany("UPDATE fin.price_alerts SET mail_armed = %s, mail_day = %s, mail_sent_at = CASE WHEN %s THEN mail_sent_at ELSE now() END WHERE id = %s",
                                       [(u[0], u[1], u[0], u[2]) for u in updates])
            c.execute("UPDATE fin.users SET alert_last = now(), alert_error = %s WHERE id = %s", (err, uid))
        if verbose:
            print(f"{us['email']}: {len(alerts)} Alarme, {len(hits)} ausgelöst" + (f", Fehler: {err}" if err else ""))
    return total


@router.post("/testmail")
def ep_testmail(u: User = Depends(current_user)):
    with db.tx(u.id) as c:
        r = c.execute("SELECT coalesce(alert_email, email)::text AS m FROM fin.users WHERE id = %s", (u.id,)).fetchone()
    try:
        send_mail(r["m"], "Test von Meine Finanzen", f"Hallo {u.name},\n\ndiese Test-Mail zeigt: Kursalarme per E-Mail funktionieren.\n\n-- \nMeine Finanzen · Smooth Solutions\n")
    except Exception as e:
        raise HTTPException(502, "Mail nicht verschickt: " + str(e)[:200])
    return {"ok": True, "email": r["m"]}


@router.get("/status")
def ep_status(u: User = Depends(current_user)):
    with db.tx(u.id) as c:
        r = c.execute("SELECT alert_mail, coalesce(alert_email, email)::text AS m, alert_last, alert_error FROM fin.users WHERE id = %s", (u.id,)).fetchone()
        fired = {x["id"]: int(x["mail_sent_at"].timestamp()) for x in
                 c.execute("SELECT id, mail_sent_at FROM fin.price_alerts WHERE mail_sent_at IS NOT NULL").fetchall()}
    return {"enabled": r["alert_mail"], "email": r["m"], "lastRun": r["alert_last"].isoformat() if r["alert_last"] else None,
            "lastError": r["alert_error"] or "", "fired": fired, "mailReady": settings.mail_ready}


def main(argv) -> int:
    if len(argv) >= 2 and argv[1] == "run":
        r = run(verbose="-v" in argv)
        print(f"{r['users']} Nutzer geprüft, {r['sent']} Alarme verschickt, {r['errors']} Fehler")
        return 0
    if len(argv) >= 2 and argv[1] == "loop":
        import time
        every = int(os.environ.get("ALERT_INTERVAL_MIN", "15")) * 60
        print("Alarm-Dienst läuft, Abstand", every // 60, "Minuten", flush=True)
        while True:
            now = dt.datetime.now()
            if now.weekday() < 5 and 8 <= now.hour < 22:
                try:
                    r = run()
                    if r["users"] or r["errors"]:
                        print(f"{now:%d.%m. %H:%M}: {r['users']} Nutzer, {r['sent']} Alarme, {r['errors']} Fehler", flush=True)
                except Exception as e:  # Dienst soll weiterlaufen
                    print("Fehler:", e, flush=True)
            time.sleep(every - time.time() % every)
    if len(argv) >= 3 and argv[1] == "test":
        send_mail(argv[2], "Test von Meine Finanzen", "Hallo,\n\nder Mailversand vom Server funktioniert.\n\n-- \nMeine Finanzen\n")
        print("verschickt an", argv[2])
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
