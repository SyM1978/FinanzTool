"""Anmeldung: Konto anlegen, Login, Logout, Passwort ändern, Konto löschen.

Sitzung = zufälliges Token im Cookie (HttpOnly, Secure, SameSite=Strict).
In der Datenbank steht nur der SHA-256 des Tokens."""
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
from pydantic import BaseModel

from . import db
from .config import settings

COOKIE = "fin_session"
router = APIRouter(prefix="/api/auth")
ph = PasswordHasher()                 # argon2id mit sicheren Standardwerten
_DUMMY = ph.hash("ungueltig-" + secrets.token_hex(8))
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ---------- Bremse gegen Passwort-Raten ----------
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


def client_ip(req: Request) -> str:
    # hinter nginx: X-Real-IP wird dort gesetzt (siehe deploy/nginx.conf)
    return req.headers.get("x-real-ip") or (req.client.host if req.client else "?")


def _hash_token(tok: str) -> bytes:
    return hashlib.sha256(tok.encode()).digest()


def _set_cookie(resp: Response, tok: str) -> None:
    resp.set_cookie(COOKIE, tok, max_age=settings.session_days * 86400, httponly=True,
                    secure=settings.cookie_secure, samesite="strict", path="/")


def _new_session(resp: Response, user_id, req: Request) -> None:
    tok = secrets.token_urlsafe(32)
    with db.tx() as c:
        c.execute("SELECT fin.auth_session_create(%s, %s, %s, %s)",
                  (_hash_token(tok), user_id, settings.session_days, req.headers.get("user-agent", "")[:200]))
    _set_cookie(resp, tok)


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


# ---------- Endpunkte ----------
class RegisterIn(BaseModel):
    email: str
    name: str
    password: str
    invite: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class PasswordIn(BaseModel):
    old: str
    new: str


class ProfileIn(BaseModel):
    name: Optional[str] = None
    alert_mail: Optional[bool] = None
    alert_email: Optional[str] = None


class DeleteIn(BaseModel):
    password: str


def _check_password(pw: str) -> None:
    if len(pw) < settings.min_password:
        raise HTTPException(400, f"Das Passwort braucht mindestens {settings.min_password} Zeichen.")
    if len(pw) > 200:
        raise HTTPException(400, "Das Passwort ist zu lang.")


def _reg_state() -> dict:
    with db.tx() as c:
        n = c.execute("SELECT fin.auth_user_count() AS n").fetchone()["n"]
    mode = settings.registration
    if n == 0:
        return {"open": True, "first": True, "invite": bool(settings.invite_code)}
    if mode == "open":
        return {"open": True, "first": False, "invite": False}
    if mode == "invite" and settings.invite_code:
        return {"open": True, "first": False, "invite": True}
    return {"open": False, "first": False, "invite": False}


@router.get("/me")
def me(req: Request):
    u = optional_user(req)
    if not u:
        return {"user": None, "registration": _reg_state()}
    with db.tx(u.id) as c:
        r = c.execute("SELECT alert_mail, alert_email::text AS alert_email, alert_last, alert_error, created_at FROM fin.users WHERE id = %s", (u.id,)).fetchone()
    return {"user": {**u.model_dump(), "alert_mail": r["alert_mail"], "alert_email": r["alert_email"] or "",
                     "alert_last": r["alert_last"].isoformat() if r["alert_last"] else None, "alert_error": r["alert_error"] or "",
                     "mail_ready": settings.mail_ready}}


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
    _check_password(body.password)
    h = ph.hash(body.password)
    try:
        with db.tx() as c:
            uid = c.execute("SELECT fin.auth_register(%s, %s, %s) AS id", (email, name, h)).fetchone()["id"]
    except Exception as e:  # doppelte E-Mail
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            raise HTTPException(409, "Zu dieser E-Mail gibt es schon ein Konto.")
        raise
    _new_session(resp, uid, req)
    return {"ok": True}


@router.post("/login")
def login(body: LoginIn, req: Request, resp: Response):
    email = body.email.strip().lower()[:200]
    ip = client_ip(req)
    wait = max(fail_by_email.blocked(email), fail_by_ip.blocked(ip))
    if wait:
        raise HTTPException(429, f"Zu viele Fehlversuche. Bitte in {int(wait // 60) + 1} Minuten noch einmal.")
    with db.tx() as c:
        row = c.execute("SELECT * FROM fin.auth_lookup(%s)", (email,)).fetchone()
    ok = False
    try:
        ok = ph.verify(row["pw_hash"] if row else _DUMMY, body.password[:200]) and row is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        ok = False
    if not ok:
        fail_by_email.add(email)
        fail_by_ip.add(ip)
        raise HTTPException(401, "E-Mail oder Passwort falsch.")
    fail_by_email.reset(email)
    if ph.check_needs_rehash(row["pw_hash"]):
        with db.tx(row["id"]) as c:
            c.execute("UPDATE fin.users SET pw_hash = %s WHERE id = %s", (ph.hash(body.password), row["id"]))
    _new_session(resp, row["id"], req)
    return {"ok": True}


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


@router.post("/password")
def change_password(body: PasswordIn, req: Request, resp: Response, u: User = Depends(current_user)):
    with db.tx(u.id) as c:
        h = c.execute("SELECT pw_hash FROM fin.users WHERE id = %s", (u.id,)).fetchone()["pw_hash"]
    try:
        ph.verify(h, body.old[:200])
    except Exception:
        raise HTTPException(400, "Das bisherige Passwort stimmt nicht.")
    _check_password(body.new)
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


@router.post("/delete")
def delete_account(body: DeleteIn, resp: Response, u: User = Depends(current_user)):
    with db.tx(u.id) as c:
        h = c.execute("SELECT pw_hash FROM fin.users WHERE id = %s", (u.id,)).fetchone()["pw_hash"]
        try:
            ph.verify(h, body.password[:200])
        except Exception:
            raise HTTPException(400, "Passwort falsch. Das Konto bleibt bestehen.")
        c.execute("DELETE FROM fin.users WHERE id = %s", (u.id,))      # löscht per CASCADE alle Daten
    resp.delete_cookie(COOKIE, path="/")
    return {"ok": True}
