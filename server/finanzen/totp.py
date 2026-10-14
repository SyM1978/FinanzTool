"""Zwei-Faktor mit Authenticator-App (TOTP nach RFC 6238: SHA-1, 6 Ziffern, 30 Sekunden)."""
import base64
import hashlib
import hmac
import io
import secrets
import struct
import time
from typing import Optional
from urllib.parse import quote

STEP = 30


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret: str, step: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    h = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000:06d}"


def now_code(secret: str) -> str:
    return _code(secret, int(time.time()) // STEP)


def verify(secret: str, code: str, last_step: int = 0) -> Optional[int]:
    """Gibt den passenden Zeitschritt zurück (±1 Schritt Toleranz) oder None.
    Bereits benutzte Schritte (<= last_step) gelten nicht noch einmal."""
    code = "".join(ch for ch in str(code) if ch.isdigit())
    if len(code) != 6 or not secret:
        return None
    now = int(time.time()) // STEP
    for st in (now - 1, now, now + 1):
        if st > last_step and hmac.compare_digest(_code(secret, st), code):
            return st
    return None


def uri(secret: str, email: str, issuer: str = "Meine Finanzen") -> str:
    return f"otpauth://totp/{quote(issuer)}:{quote(email)}?secret={secret}&issuer={quote(issuer)}&digits=6&period=30"


def qr_svg(text: str) -> str:
    import qrcode
    import qrcode.image.svg
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    b = io.BytesIO()
    img.save(b)
    svg = b.getvalue().decode()
    return svg[svg.index("<svg"):]


def recovery_codes(n: int = 10):
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    out = []
    for _ in range(n):
        c = "".join(secrets.choice(alphabet) for _ in range(10))
        out.append(c[:5] + "-" + c[5:])
    return out


def norm_recovery(code: str) -> str:
    c = "".join(ch for ch in str(code).lower() if ch.isalnum())
    return c[:5] + "-" + c[5:] if len(c) == 10 else ""


def hash_recovery(code: str) -> str:
    return hashlib.sha256(norm_recovery(code).encode()).hexdigest()
