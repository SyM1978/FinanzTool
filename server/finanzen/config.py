"""Einstellungen aus Umgebungsvariablen (auf dem Server: /etc/finanzen/finanzen.env)."""
import os
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "ja", "on")


class Settings:
    def __init__(self) -> None:
        e = os.environ.get
        # Datenbank: Rolle finanzen_app, NIE den Superuser eintragen
        self.database_url = e("DATABASE_URL", "postgresql://finanzen_app@localhost/finanzen")
        self.pool_min = int(e("DB_POOL_MIN", "1"))
        self.pool_max = int(e("DB_POOL_MAX", "8"))

        # Anmeldung
        self.cookie_secure = _bool("COOKIE_SECURE", True)       # nur für Tests ohne HTTPS auf 0
        self.session_days = int(e("SESSION_DAYS", "30"))
        # invite = nur mit Einladungscode, open = jeder, closed = niemand (nur der erste Nutzer)
        self.registration = e("REGISTRATION", "invite").strip().lower()
        self.invite_code = e("INVITE_CODE", "")
        self.min_password = int(e("MIN_PASSWORD", "10"))

        # Webseite
        self.web_dir = Path(e("WEB_DIR", str(Path(__file__).resolve().parent.parent.parent / "web" / "out")))
        self.max_body = int(e("MAX_BODY_MB", "20")) * 1024 * 1024

        # Kursquellen (für Tests überschreibbar)
        self.ov_base = e("SRC_ONVISTA", "https://api.onvista.de/api/v1/")
        self.ecb_url = e("SRC_ECB", "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")
        self.y_chart = e("SRC_Y_CHART", "https://query1.finance.yahoo.com/v8/finance/chart/")
        self.y_search = e("SRC_Y_SEARCH", "https://query2.finance.yahoo.com/v1/finance/search")
        self.news_url = e("SRC_NEWS", "https://news.google.com/rss/search")
        self.http_proxy = e("OUTBOUND_PROXY", "") or None

        # E-Mail für Kursalarme
        self.smtp_host = e("SMTP_HOST", "")
        self.smtp_port = int(e("SMTP_PORT", "587"))
        self.smtp_user = e("SMTP_USER", "")
        self.smtp_password = e("SMTP_PASSWORD", "")
        self.smtp_tls = e("SMTP_TLS", "starttls").strip().lower()   # starttls | ssl | none
        self.mail_from = e("MAIL_FROM", "")
        self.app_url = e("APP_URL", "")                                 # Link in den Mails

    @property
    def mail_ready(self) -> bool:
        return bool(self.smtp_host and self.mail_from)


settings = Settings()
