"""E-Mail-Versand über SMTP mit gestalteten Mails (HTML + Textfassung).

Alle Mails des Systems laufen über die Funktionen unten:
  mail_verify, mail_reset, mail_duplicate, mail_alerts, mail_test
Jede Mail hat eine schlichte Textfassung für Programme ohne HTML."""
import html
import smtplib
import socket
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from .config import settings

LOGO = Path(__file__).resolve().parent / "static" / "logo.png"
ACCENT, INK, MUTED, BG, LINE, SOFT = "#985A1C", "#161616", "#615E58", "#EEEEEB", "#DCDAD4", "#F6F5F2"
GOOD, BAD = "#157A3B", "#B42318"
FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
MONO = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace"


# ---------- Versand ----------
def send_mail(to: str, subject: str, text: str, html_body: Optional[str] = None) -> None:
    try:
        _send(to, subject, text, html_body)
    except socket.gaierror:
        raise RuntimeError(f"Mailserver „{settings.smtp_host}“ nicht gefunden. SMTP_HOST prüfen (nur der Servername, z. B. smtp.ionos.de, ohne https:// und ohne Port).")
    except smtplib.SMTPAuthenticationError:
        raise RuntimeError("Anmeldung am Mailserver abgelehnt. SMTP_USER und SMTP_PASSWORD prüfen.")
    except smtplib.SMTPException:
        raise
    except OSError as e:   # Zeitüberschreitung, Verbindung abgelehnt, TLS-Fehler
        raise RuntimeError(f"Mailserver {settings.smtp_host}:{settings.smtp_port} nicht erreichbar ({e}). Port und SMTP_TLS prüfen (587 = starttls, 465 = ssl).")


def _send(to: str, subject: str, text: str, html_body: Optional[str]) -> None:
    if not settings.mail_ready:
        raise RuntimeError("Mailversand nicht eingerichtet (SMTP_HOST und MAIL_FROM in der .env)")
    msg = EmailMessage()
    msg["From"] = formataddr(("Meine Finanzen", settings.mail_from))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=settings.mail_from.split("@")[-1])
    msg.set_content(text)
    if html_body:
        msg.add_alternative(html_body, subtype="html")
        if "cid:logo" in html_body and LOGO.is_file():
            # Logo als eingebettetes Bild (wird nicht als Anhang angezeigt)
            msg.get_payload()[1].add_related(LOGO.read_bytes(), "image", "png", cid="<logo>", filename="logo.png", disposition="inline")
    ctx = ssl.create_default_context()
    if settings.smtp_tls == "ssl":
        s = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ctx, timeout=20)
    else:
        s = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20)
        if settings.smtp_tls == "starttls":
            s.starttls(context=ctx)
    try:
        if settings.smtp_user:
            s.login(settings.smtp_user, settings.smtp_password)
        s.send_message(msg)
    finally:
        try:
            s.quit()
        except Exception:
            pass


# ---------- Gestaltung ----------
e = html.escape


def _button(label: str, url: str) -> str:
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px"><tr>'
            f'<td style="border-radius:10px;background:{ACCENT}">'
            f'<a href="{e(url)}" style="display:inline-block;padding:13px 26px;font-family:{FONT};font-size:15px;font-weight:600;'
            f'color:#ffffff;text-decoration:none;border-radius:10px">{e(label)}</a></td></tr></table>'
            f'<p style="margin:14px 0 0;font-size:12.5px;line-height:1.5;color:{MUTED}">Button funktioniert nicht? Diesen Link in den Browser kopieren:<br>'
            f'<a href="{e(url)}" style="color:{ACCENT};word-break:break-all">{e(url)}</a></p>')


def _layout(preheader: str, title: str, body: str, note: str = "") -> str:
    app = settings.app_url.rstrip("/")
    link = f'<a href="{e(app)}" style="color:{MUTED}">{e(app.split("://")[-1])}</a> · ' if app else ""
    return f"""<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>{e(title)}</title></head>
<body style="margin:0;padding:0;background:{BG};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{BG}">{e(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{BG}"><tr><td align="center" style="padding:28px 14px">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
  <tr><td style="padding:0 6px 16px">
   <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="vertical-align:middle"><img src="cid:logo" width="40" height="40" alt="" style="display:block;border-radius:10px;border:0"></td>
    <td style="vertical-align:middle;padding-left:12px;font-family:{FONT};font-size:17px;font-weight:700;color:{INK}">Meine Finanzen</td>
   </tr></table>
  </td></tr>
  <tr><td style="background:#ffffff;border:1px solid {LINE};border-radius:16px;padding:32px 30px;font-family:{FONT};color:{INK}">
   <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;color:{INK}">{e(title)}</h1>
   {body}
  </td></tr>
  {f'<tr><td style="padding:16px 8px 0;font-family:{FONT};font-size:12.5px;line-height:1.55;color:{MUTED}">{note}</td></tr>' if note else ""}
  <tr><td style="padding:18px 8px 0;font-family:{FONT};font-size:12px;line-height:1.5;color:{MUTED}">
   {link}Ein Werkzeug von <span style="white-space:nowrap"><b style="letter-spacing:.08em;color:{INK}">SMOOTH</b> <b style="letter-spacing:.08em;color:{ACCENT}">SOLUTIONS</b></span><br>
   Diese Mail wurde automatisch verschickt. Antworten erreichen niemanden.
  </td></tr>
 </table>
</td></tr></table>
</body></html>"""


def _p(txt: str) -> str:
    return f'<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:{INK}">{txt}</p>'


def _text(greeting: str, lines: Sequence[str], link: Optional[str] = None, foot: str = "") -> str:
    out = [greeting, ""] + [x for x in lines]
    if link:
        out += ["", link]
    if foot:
        out += ["", foot]
    out += ["", "-- ", "Meine Finanzen · Smooth Solutions", "Diese Mail wurde automatisch verschickt."]
    return "\n".join(out) + "\n"


# ---------- Die einzelnen Mails ----------
def mail_verify(to: str, name: str, link: str) -> None:
    title = "Bitte bestätige deine E-Mail-Adresse"
    body = (_p(f"Hallo {e(name)},") +
            _p("willkommen bei <b>Meine Finanzen</b>! Ein Klick noch, dann ist dein Konto bereit:") +
            _button("E-Mail-Adresse bestätigen", link))
    note = "Der Link gilt 48 Stunden. Wenn du dich nicht registriert hast, ignoriere diese Mail einfach – dann passiert nichts."
    send_mail(to, title, _text(f"Hallo {name},", ["willkommen bei Meine Finanzen! Bitte bestätige deine E-Mail-Adresse mit diesem Link:"], link, note),
              _layout("Ein Klick noch, dann ist dein Konto bereit.", title, body, note))


def mail_reset(to: str, name: str, link: str) -> None:
    title = "Neues Passwort festlegen"
    body = (_p(f"Hallo {e(name)},") +
            _p("für dein Konto wurde ein neues Passwort angefordert. Über den Button legst du es fest:") +
            _button("Neues Passwort festlegen", link) +
            f'<p style="margin:22px 0 0;padding:12px 14px;background:{SOFT};border-radius:10px;font-size:13.5px;line-height:1.5;color:{MUTED}">'
            "Danach sind alle anderen Geräte abgemeldet. Hast du Zwei-Faktor eingeschaltet, brauchst du zusätzlich den Code aus deiner App.</p>")
    note = "Der Link gilt 60 Minuten und funktioniert nur einmal. Warst du das nicht? Dann ignoriere diese Mail, dein Passwort bleibt unverändert."
    send_mail(to, "Passwort zurücksetzen", _text(f"Hallo {name},", ["für dein Konto bei Meine Finanzen wurde ein neues Passwort angefordert. Hier legst du es fest:"], link, note),
              _layout("Lege über den Link ein neues Passwort fest.", title, body, note))


def mail_duplicate(to: str, link: str) -> None:
    title = "Du hast schon ein Konto"
    body = (_p("Hallo,") +
            _p("gerade wollte jemand mit deiner E-Mail-Adresse ein neues Konto bei <b>Meine Finanzen</b> anlegen. Du hast aber bereits eines.") +
            _p("Passwort vergessen? Hier setzt du es zurück:") + _button("Passwort zurücksetzen", link))
    note = "Warst du das nicht? Dann musst du nichts tun – es wurde kein Konto angelegt und nichts geändert."
    send_mail(to, "Anmeldeversuch bei Meine Finanzen", _text("Hallo,", ["jemand wollte mit deiner E-Mail-Adresse ein neues Konto anlegen. Du hast bereits eines.", "Passwort vergessen? Hier setzt du es zurück:"], link, note),
              _layout("Jemand wollte mit deiner Adresse ein Konto anlegen.", title, body, note))


def _de(v: float, d: int = 2) -> str:
    return f"{v:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def mail_alerts(to: str, name: str, hits: List[dict], link: str = "") -> None:
    """hits: [{name, cond, price, currency, change}] – change in Prozent"""
    n = len(hits)
    subj = f"Kursalarm: {hits[0]['name']}" if n == 1 else f"{n} Kursalarme in deinem Depot"
    title = "Kursalarm ausgelöst" if n == 1 else f"{n} Kursalarme ausgelöst"
    rows = ""
    for i, h in enumerate(hits):
        ch = h.get("change") or 0
        col = GOOD if ch > 0 else BAD if ch < 0 else MUTED
        sign = "+" if ch > 0 else "−" if ch < 0 else "±"
        border = "" if i == 0 else f"border-top:1px solid {LINE};"
        rows += (f'<tr><td style="{border}padding:12px 0;vertical-align:top">'
                 f'<div style="font-size:15px;font-weight:600;color:{INK}">{e(h["name"])}</div>'
                 f'<div style="font-size:13px;color:{MUTED};margin-top:2px">{e(h["cond"])}</div></td>'
                 f'<td align="right" style="{border}padding:12px 0 12px 12px;vertical-align:top;white-space:nowrap;font-family:{MONO}">'
                 f'<div style="font-size:15px;font-weight:600;color:{INK}">{_de(h["price"])} {e(h.get("currency") or "")}</div>'
                 f'<div style="font-size:13px;font-weight:600;color:{col};margin-top:2px">{sign}{_de(abs(ch), 1)}&nbsp;% heute</div></td></tr>')
    body = (_p(f"Hallo {e(name)},") + _p("folgende Kursalarme haben gerade ausgelöst:") +
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px;font-family:{FONT}">{rows}</table>' +
            (_button("Im Depot ansehen", link) if link else ""))
    note = "Kurse meist verzögert, ohne Gewähr. Schwellen melden sich erst wieder, wenn der Kurs zwischendurch zurückgekommen ist; Tagesbewegungen höchstens einmal am Tag. Abschalten unter Einstellungen › E-Mail-Alarme."
    lines = []
    for h in hits:
        ch = h.get("change") or 0
        lines.append(f"• {h['name']}: {h['cond']}\n  Kurs jetzt {_de(h['price'])} {h.get('currency') or ''} ({'+' if ch >= 0 else ''}{_de(ch, 1)} % heute)")
    send_mail(to, subj, _text(f"Hallo {name},", ["folgende Kursalarme haben ausgelöst:", ""] + lines, link or None, note),
              _layout(" · ".join(h["name"] for h in hits)[:120], title, body, note))


def mail_test(to: str, name: str = "") -> None:
    title = "Der Mailversand funktioniert"
    body = (_p(f"Hallo {e(name)}," if name else "Hallo,") +
            _p("diese Test-Mail zeigt: Dein Server kann Mails verschicken. Bestätigungslinks, „Passwort vergessen“ und Kursalarme kommen damit an.") +
            f'<p style="margin:18px 0 0;padding:12px 14px;background:{SOFT};border-radius:10px;font-size:13.5px;line-height:1.5;color:{MUTED}">'
            "Landet diese Mail im Spam-Ordner? Markiere sie als „Kein Spam“ und füge den Absender zu deinen Kontakten hinzu.</p>")
    send_mail(to, "Test von Meine Finanzen", _text(f"Hallo {name}," if name else "Hallo,", ["diese Test-Mail zeigt: Der Mailversand vom Server funktioniert."]),
              _layout("Dein Server kann Mails verschicken.", title, body))
