"""Anmeldung: Konto anlegen, E-Mail bestätigen, Login (optional mit Zwei-Faktor),
Passwort vergessen/zurücksetzen, Passwort ändern, Abmelden, Konto löschen.

Sitzung = zufälliges Token im Cookie (HttpOnly, Secure, SameSite=Strict).
In der Datenbank steht nur der SHA-256 des Tokens, ebenso bei Mail-Links."""
import hashlib
import hmac
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import db, totp
from .config import settings
from .mail import mail_duplicate, mail_reset, mail_verify

COOKIE = "fin_session"
router = APIRouter(prefix="/api/auth")
ph = PasswordHasher()                 # argon2id mit sicheren Standardwerten
_DUMMY = ph.hash("ungueltig-" + secrets.token_hex(8))
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
VERIFY_MIN, RESET_MIN = 48 * 60, 60


# ---------- Bremse gegen Raten und Mail-Flut ----------
class _Limiter:
    def __init__(self, n: int, window: float) -> None:
        self.n, self.window = n, window
        self.hits: dict = defaultdict(deque)
        self.lock = threading.Lock()

    def blocked(self, key: str) -> float:
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            return (q[0] + self.window - now) if len(q) >= self.n else 0.0

    def add(self, key: str) -> None:
        with self.lock:
            self.hits[key].append(time.monotonic())

    def reset(self, key: str) -> None:
        with self.lock:
            self.hits.pop(key, None)


fail_by_email = _Limiter(8, 15 * 60)
fail_by_ip = _Limiter(30, 15 * 60)
register_by_ip = _Limiter(10, 60 * 60)
mail_by_ip = _Limiter(8, 60 * 60)
mail_by_email = _Limiter(5, 60 * 60)


def client_ip(req: Request) -> str:
    # hinter nginx/Traefik: X-Real-IP setzt der Proxy
    return req.headers.get("x-real-ip") or (req.client.host if req.client else "?")


def _hash_token(tok: str) -> bytes:
    return hashlib.sha256(tok.encode()).digest()


def _new_session(resp: Response, user_id, req: Request, remember: bool = True) -> None:
    tok = secrets.token_urlsafe(32)
    days = settings.session_days if remember else 1
    with db.tx() as c:
        c.execute("SELECT fin.auth_session_create(%s, %s, %s, %s)",
                  (_hash_token(tok), user_id, days, req.headers.get("user-agent", "")[:200]))
    # ohne „angemeldet bleiben“: Sitzungs-Cookie, endet mit dem Schließen des Browsers
    resp.set_cookie(COOKIE, tok, max_age=days * 86400 if remember else None, httponly=True,
                    secure=settings.cookie_secure, samesite="strict", path="/")


def _base_url(req: Request) -> str:
    return (settings.app_url or str(req.base_url)).rstrip("/")


def _need(status: int, need: str, detail: str) -> JSONResponse:
    return JSONResponse({"detail": detail, "need": need}, status_code=status)


class User(BaseModel):
    id: str
    name: str
    email: str
    is_admin: bool


def current_user(req: Request) -> User:
    tok = req.cookies.get(COOKIE)
    if not tok or len(tok) > 100:
        raise HTTPException(401, "Bitte anmelden.")
    with db.tx() as c:
        row = c.execute("SELECT * FROM fin.auth_session_user(%s)", (_hash_token(tok),)).fetchone()
    if not row:
        raise HTTPException(401, "Sitzung abgelaufen. Bitte neu anmelden.")
    return User(id=str(row["user_id"]), name=row["name"], email=row["email"], is_admin=row["is_admin"])


def optional_user(req: Request) -> Optional[User]:
    try:
        return current_user(req)
    except HTTPException:
        return None


# ---------- Eingaben ----------
class RegisterIn(BaseModel):
    email: str
    name: str
    password: str
    invite: str = ""


class LoginIn(BaseModel):
    email: str
    password: str
    code: str = ""
    remember: bool = True


class EmailIn(BaseModel):
    email: str


class TokenIn(BaseModel):
    token: str


class ResetIn(BaseModel):
    token: str
    password: str
    code: str = ""


class PasswordIn(BaseModel):
    old: str
    new: str


class ProfileIn(BaseModel):
    name: Optional[str] = None
    alert_mail: Optional[bool] = None
    alert_email: Optional[str] = None


class DeleteIn(BaseModel):
    password: str
    code: str = ""


class PwCodeIn(BaseModel):
    password: str = ""
    code: str = ""


def _check_password(pw: str, email: str = "") -> None:
    if len(pw) < settings.min_password:
        raise HTTPException(400, f"Das Passwort braucht mindestens {settings.min_password} Zeichen.")
    if len(pw) > 200:
        raise HTTPException(400, "Das Passwort ist zu lang.")
    low = pw.lower()
    if len(set(low)) < 4 or (email and email.split("@")[0].lower() in low and len(email.split("@")[0]) > 3):
        raise HTTPException(400, "Das Passwort ist zu leicht zu erraten. Bitte ein anderes wählen.")


def _pw_ok(pw_hash: Optional[str], pw: str) -> bool:
    try:
        return bool(ph.verify(pw_hash or _DUMMY, pw[:200])) and pw_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _second_factor(row: dict, code: str) -> bool:
    """Prüft TOTP-Code oder Notfall-Code und verbraucht ihn."""
    code = (code or "").strip()
    if not code:
        return False
    step = totp.verify(row["totp_secret"] or "", code, row["totp_last_step"] or 0)
    with db.tx() as c:
        if step is not None:
            return c.execute("SELECT fin.auth_totp_used(%s, %s, NULL) AS ok", (row["id"], step)).fetchone()["ok"]
        if totp.norm_recovery(code):
            return c.execute("SELECT fin.auth_totp_used(%s, 0, %s) AS ok", (row["id"], totp.hash_recovery(code))).fetchone()["ok"]
    return False


# ---------- Mails ----------
def _mail_link(req: Request, uid, email: str, name: str, kind: str) -> None:
    tok = secrets.token_urlsafe(32)
    with db.tx() as c:
        c.execute("SELECT fin.auth_token_create(%s, %s, %s, %s)", (uid, kind, _hash_token(tok), VERIFY_MIN if kind == "verify" else RESET_MIN))
    link = f"{_base_url(req)}/#{kind}={tok}"
    if kind == "verify":
        mail_verify(email, name, link)
    else:
        mail_reset(email, name, link)


def _mail_limit(req: Request, email: str) -> None:
    ip = client_ip(req)
    if mail_by_ip.blocked(ip) or mail_by_email.blocked(email):
        raise HTTPException(429, "Zu viele Anfragen. Bitte etwas später noch einmal.")
    mail_by_ip.add(ip)
    mail_by_email.add(email)


# ---------- Zustand ----------
def _reg_state() -> dict:
    with db.tx() as c:
        n = c.execute("SELECT fin.auth_user_count() AS n").fetchone()["n"]
    mode = settings.registration
    base = {"verify": settings.must_verify, "reset": settings.mail_ready, "min": settings.min_password}
    if n == 0:
        return {**base, "open": True, "first": True, "invite": bool(settings.invite_code)}
    if mode == "open":
        return {**base, "open": True, "first": False, "invite": False}
    if mode == "invite" and settings.invite_code:
        return {**base, "open": True, "first": False, "invite": True}
    return {**base, "open": False, "first": False, "invite": False}


@router.get("/me")
def me(req: Request):
    u = optional_user(req)
    if not u:
        return {"user": None, "registration": _reg_state()}
    with db.tx(u.id) as c:
        r = c.execute("SELECT alert_mail, alert_email::text AS alert_email, alert_last, alert_error, created_at, totp_enabled, "
                      "cardinality(recovery_codes) AS rc FROM fin.users WHERE id = %s", (u.id,)).fetchone()
    return {"user": {**u.model_dump(), "alert_mail": r["alert_mail"], "alert_email": r["alert_email"] or "",
                     "alert_last": r["alert_last"].isoformat() if r["alert_last"] else None, "alert_error": r["alert_error"] or "",
                     "mail_ready": settings.mail_ready, "totp": r["totp_enabled"], "recovery_left": r["rc"]}}


# ---------- Registrieren & bestätigen ----------
@router.post("/register")
def register(body: RegisterIn, req: Request, resp: Response):
    ip = client_ip(req)
    if register_by_ip.blocked(ip):
        raise HTTPException(429, "Zu viele Versuche. Bitte später noch einmal.")
    register_by_ip.add(ip)
    st = _reg_state()
    if not st["open"]:
        raise HTTPException(403, "Neue Konten sind auf diesem Server nicht freigeschaltet.")
    if st["invite"] and not hmac.compare_digest(body.invite.strip().encode(), settings.invite_code.encode()):
        raise HTTPException(403, "Einladungscode falsch.")
    email = body.email.strip().lower()
    name = body.name.strip()[:40]
    if not EMAIL_RE.match(email) or len(email) > 200:
        raise HTTPException(400, "Bitte eine gültige E-Mail-Adresse eingeben.")
    if not name:
        raise HTTPException(400, "Bitte einen Namen eingeben.")
    _check_password(body.password, email)
    verify = settings.must_verify and not st["first"]      # das erste Konto (Verwalter) kommt immer direkt rein
    try:
        with db.tx() as c:
            uid = c.execute("SELECT fin.auth_register(%s, %s, %s) AS id", (email, name, ph.hash(body.password))).fetchone()["id"]
    except Exception as e:
        if "unique" not in str(e).lower() and "duplicate" not in str(e).lower():
            raise
        if not verify:
            raise HTTPException(409, "Zu dieser E-Mail gibt es schon ein Konto. Melde dich an oder setze das Passwort zurück.")
        # Mit Mail-Bestätigung verraten wir nicht, ob es die Adresse schon gibt: der Inhaber bekommt einen Hinweis
        try:
            _mail_limit(req, email)
            mail_duplicate(email, f"{_base_url(req)}/#forgot")
        except Exception:
            pass
        return {"ok": True, "verify": True, "email": email}
    if not verify:
        with db.tx() as c:
            c.execute("SELECT fin.auth_mark_verified(%s)", (uid,))
        _new_session(resp, uid, req)
        return {"ok": True, "verify": False}
    try:
        _mail_link(req, uid, email, name, "verify")
    except Exception:
        return {"ok": True, "verify": True, "email": email, "mail_error": True}
    return {"ok": True, "verify": True, "email": email}


@router.post("/verify")
def verify_email(body: TokenIn, req: Request, resp: Response):
    tok = body.token.strip()
    if not tok or len(tok) > 100:
        raise HTTPException(400, "Der Link ist unvollständig.")
    with db.tx() as c:
        uid = c.execute("SELECT fin.auth_verify_email(%s) AS id", (_hash_token(tok),)).fetchone()["id"]
    if not uid:
        raise HTTPException(400, "Der Link ist abgelaufen oder wurde schon benutzt. Melde dich an – falls nötig, schicken wir einen neuen.")
    _new_session(resp, uid, req)
    return {"ok": True}


@router.post("/verify/resend")
def verify_resend(body: EmailIn, req: Request):
    email = body.email.strip().lower()[:200]
    _mail_limit(req, email)
    with db.tx() as c:
        row = c.execute("SELECT * FROM fin.auth_lookup2(%s)", (email,)).fetchone()
    if row and not row["email_verified"] and settings.mail_ready:
        try:
            _mail_link(req, row["id"], email, row["name"], "verify")
        except Exception:
            raise HTTPException(502, "Die Mail konnte gerade nicht verschickt werden. Bitte später noch einmal.")
    return {"ok": True}


# ---------- Login ----------
@router.post("/login")
def login(body: LoginIn, req: Request, resp: Response):
    email = body.email.strip().lower()[:200]
    ip = client_ip(req)
    wait = max(fail_by_email.blocked(email), fail_by_ip.blocked(ip))
    if wait:
        raise HTTPException(429, f"Zu viele Fehlversuche. Bitte in {int(wait // 60) + 1} Minuten noch einmal.")
    with db.tx() as c:
        row = c.execute("SELECT * FROM fin.auth_lookup2(%s)", (email,)).fetchone()
    if not _pw_ok(row["pw_hash"] if row else None, body.password):
        fail_by_email.add(email)
        fail_by_ip.add(ip)
        raise HTTPException(401, "E-Mail oder Passwort falsch.")
    if row["totp_enabled"]:
        if not body.code.strip():
            return _need(401, "totp", "Bitte den 6-stelligen Code aus deiner Authenticator-App eingeben.")
        if not _second_factor(row, body.code):
            fail_by_email.add(email)
            fail_by_ip.add(ip)
            return _need(401, "totp", "Der Code stimmt nicht oder wurde schon benutzt. Bitte den aktuellen Code eingeben.")
    if not row["email_verified"] and settings.must_verify:
        return _need(403, "verify", "Bitte bestätige zuerst deine E-Mail-Adresse. Den Link haben wir dir geschickt.")
    fail_by_email.reset(email)
    if ph.check_needs_rehash(row["pw_hash"]):
        with db.tx(row["id"]) as c:
            c.execute("UPDATE fin.users SET pw_hash = %s WHERE id = %s", (ph.hash(body.password), row["id"]))
    _new_session(resp, row["id"], req, body.remember)
    return {"ok": True}


# ---------- Passwort vergessen ----------
@router.post("/forgot")
def forgot(body: EmailIn, req: Request):
    email = body.email.strip().lower()[:200]
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Bitte eine gültige E-Mail-Adresse eingeben.")
    if not settings.mail_ready:
        raise HTTPException(503, "Auf diesem Server ist kein Mailversand eingerichtet. Wende dich an den Verwalter.")
    _mail_limit(req, email)
    with db.tx() as c:
        row = c.execute("SELECT * FROM fin.auth_lookup2(%s)", (email,)).fetchone()
    if row:
        try:
            _mail_link(req, row["id"], email, row["name"], "reset")
        except Exception:
            raise HTTPException(502, "Die Mail konnte gerade nicht verschickt werden. Bitte später noch einmal.")
    # immer dieselbe Antwort: verrät nicht, ob es ein Konto gibt
    return {"ok": True}


@router.post("/reset/check")
def reset_check(body: TokenIn):
    with db.tx() as c:
        row = c.execute("SELECT * FROM fin.auth_token_user(%s, 'reset')", (_hash_token(body.token.strip()),)).fetchone()
    if not row:
        raise HTTPException(400, "Der Link ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.")
    return {"ok": True, "email": row["email"], "totp": row["totp_enabled"]}


@router.post("/reset")
def reset(body: ResetIn, req: Request, resp: Response):
    th = _hash_token(body.token.strip())
    with db.tx() as c:
        row = c.execute("SELECT * FROM fin.auth_token_user(%s, 'reset')", (th,)).fetchone()
    if not row:
        raise HTTPException(400, "Der Link ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.")
    _check_password(body.password, row["email"])
    if row["totp_enabled"]:
        r = dict(row, id=row["user_id"])
        if not _second_factor(r, body.code):
            return _need(401, "totp", "Bitte den Code aus deiner Authenticator-App (oder einen Notfall-Code) eingeben.")
    with db.tx() as c:
        uid = c.execute("SELECT fin.auth_reset_password(%s, %s) AS id", (th, ph.hash(body.password))).fetchone()["id"]
    if not uid:
        raise HTTPException(400, "Der Link ist abgelaufen oder wurde schon benutzt.")
    fail_by_email.reset(row["email"])
    _new_session(resp, uid, req)
    return {"ok": True}


# ---------- Angemeldet ----------
@router.post("/logout")
def logout(req: Request, resp: Response):
    tok = req.cookies.get(COOKIE)
    u = optional_user(req)
    if tok and u:
        with db.tx(u.id) as c:
            c.execute("DELETE FROM fin.sessions WHERE token_hash = %s", (_hash_token(tok),))
    resp.delete_cookie(COOKIE, path="/", secure=settings.cookie_secure, httponly=True, samesite="strict")
    return {"ok": True}


@router.post("/logout-all")
def logout_all(resp: Response, u: User = Depends(current_user)):
    with db.tx(u.id) as c:
        c.execute("DELETE FROM fin.sessions WHERE user_id = %s", (u.id,))
    resp.delete_cookie(COOKIE, path="/")
    return {"ok": True}


def _my_row(u: User) -> dict:
    with db.tx(u.id) as c:
        return c.execute("SELECT id, pw_hash, totp_enabled, totp_secret, totp_last_step, recovery_codes FROM fin.users WHERE id = %s", (u.id,)).fetchone()


@router.post("/password")
def change_password(body: PasswordIn, req: Request, resp: Response, u: User = Depends(current_user)):
    if not _pw_ok(_my_row(u)["pw_hash"], body.old):
        raise HTTPException(400, "Das bisherige Passwort stimmt nicht.")
    _check_password(body.new, u.email)
    with db.tx(u.id) as c:
        c.execute("UPDATE fin.users SET pw_hash = %s WHERE id = %s", (ph.hash(body.new), u.id))
        c.execute("DELETE FROM fin.sessions WHERE user_id = %s", (u.id,))   # alle Geräte abmelden
    _new_session(resp, u.id, req)                                        # dieses bleibt angemeldet
    return {"ok": True}


@router.post("/profile")
def profile(body: ProfileIn, u: User = Depends(current_user)):
    sets, args = [], []
    if body.name is not None:
        n = body.name.strip()[:40]
        if not n:
            raise HTTPException(400, "Der Name darf nicht leer sein.")
        sets.append("name = %s"); args.append(n)
    if body.alert_email is not None:
        m = body.alert_email.strip().lower()
        if m and not EMAIL_RE.match(m):
            raise HTTPException(400, "Bitte eine gültige E-Mail-Adresse eingeben.")
        sets.append("alert_email = %s"); args.append(m or None)
    if body.alert_mail is not None:
        sets.append("alert_mail = %s"); args.append(body.alert_mail)
    if sets:
        with db.tx(u.id) as c:
            c.execute(f"UPDATE fin.users SET {', '.join(sets)} WHERE id = %s", (*args, u.id))
    return {"ok": True}


# ---------- Zwei-Faktor ----------
@router.post("/totp/setup")
def totp_setup(body: PwCodeIn, u: User = Depends(current_user)):
    row = _my_row(u)
    if row["totp_enabled"]:
        raise HTTPException(400, "Zwei-Faktor ist bereits eingeschaltet.")
    if not _pw_ok(row["pw_hash"], body.password):
        raise HTTPException(400, "Bitte zur Sicherheit dein Passwort eingeben.")
    sec = totp.new_secret()
    with db.tx(u.id) as c:
        c.execute("UPDATE fin.users SET totp_secret = %s, totp_last_step = 0 WHERE id = %s", (sec, u.id))
    uri = totp.uri(sec, u.email)
    return {"ok": True, "secret": sec, "uri": uri, "svg": totp.qr_svg(uri)}


@router.post("/totp/enable")
def totp_enable(body: PwCodeIn, u: User = Depends(current_user)):
    row = _my_row(u)
    if row["totp_enabled"] or not row["totp_secret"]:
        raise HTTPException(400, "Bitte zuerst „Einrichten“ wählen.")
    step = totp.verify(row["totp_secret"], body.code, 0)
    if step is None:
        raise HTTPException(400, "Der Code stimmt nicht. Prüfe, ob die Uhrzeit am Handy stimmt, und nimm den aktuellen Code.")
    codes = totp.recovery_codes()
    with db.tx(u.id) as c:
        c.execute("UPDATE fin.users SET totp_enabled = true, totp_last_step = %s, recovery_codes = %s WHERE id = %s",
                  (step, [totp.hash_recovery(x) for x in codes], u.id))
    return {"ok": True, "recovery": codes}


@router.post("/totp/disable")
def totp_disable(body: PwCodeIn, u: User = Depends(current_user)):
    row = _my_row(u)
    if not row["totp_enabled"]:
        return {"ok": True}
    if not _pw_ok(row["pw_hash"], body.password):
        raise HTTPException(400, "Das Passwort stimmt nicht.")
    if not _second_factor(row, body.code):
        raise HTTPException(400, "Der Code stimmt nicht.")
    with db.tx(u.id) as c:
        c.execute("UPDATE fin.users SET totp_enabled = false, totp_secret = NULL, totp_last_step = 0, recovery_codes = '{}' WHERE id = %s", (u.id,))
    return {"ok": True}


@router.post("/totp/recovery")
def totp_recovery(body: PwCodeIn, u: User = Depends(current_user)):
    row = _my_row(u)
    if not row["totp_enabled"]:
        raise HTTPException(400, "Zwei-Faktor ist nicht eingeschaltet.")
    if not _pw_ok(row["pw_hash"], body.password):
        raise HTTPException(400, "Das Passwort stimmt nicht.")
    codes = totp.recovery_codes()
    with db.tx(u.id) as c:
        c.execute("UPDATE fin.users SET recovery_codes = %s WHERE id = %s", ([totp.hash_recovery(x) for x in codes], u.id))
    return {"ok": True, "recovery": codes}


# ---------- Konto löschen ----------
@router.post("/delete")
def delete_account(body: DeleteIn, resp: Response, u: User = Depends(current_user)):
    row = _my_row(u)
    if not _pw_ok(row["pw_hash"], body.password):
        raise HTTPException(400, "Passwort falsch. Das Konto bleibt bestehen.")
    if row["totp_enabled"] and not _second_factor(row, body.code):
        return _need(400, "totp", "Bitte zusätzlich den Code aus deiner Authenticator-App eingeben.")
    with db.tx(u.id) as c:
        c.execute("DELETE FROM fin.users WHERE id = %s", (u.id,))      # löscht per CASCADE alle Daten
    resp.delete_cookie(COOKIE, path="/")
    return {"ok": True}
