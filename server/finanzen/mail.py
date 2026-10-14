"""E-Mail-Versand über SMTP (Kursalarme, Bestätigung, Passwort zurücksetzen)."""
import smtplib
import socket
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from .config import settings


def send_mail(to: str, subject: str, text: str) -> None:
    try:
        _send(to, subject, text)
    except socket.gaierror:
        raise RuntimeError(f"Mailserver „{settings.smtp_host}“ nicht gefunden. SMTP_HOST prüfen (nur der Servername, z. B. smtp.ionos.de, ohne https:// und ohne Port).")
    except smtplib.SMTPAuthenticationError:
        raise RuntimeError("Anmeldung am Mailserver abgelehnt. SMTP_USER und SMTP_PASSWORD prüfen.")
    except smtplib.SMTPException:
        raise
    except OSError as e:   # Zeitüberschreitung, Verbindung abgelehnt, TLS-Fehler
        raise RuntimeError(f"Mailserver {settings.smtp_host}:{settings.smtp_port} nicht erreichbar ({e}). Port und SMTP_TLS prüfen (587 = starttls, 465 = ssl).")


def _send(to: str, subject: str, text: str) -> None:
    if not settings.mail_ready:
        raise RuntimeError("Mailversand nicht eingerichtet (SMTP_HOST und MAIL_FROM in der .env)")
    msg = EmailMessage()
    msg["From"] = formataddr(("Meine Finanzen", settings.mail_from))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=settings.mail_from.split("@")[-1])
    msg.set_content(text)
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
