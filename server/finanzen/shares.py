"""Konten mit anderen Benutzern teilen.

Der Besitzer gibt ein Konto per E-Mail-Adresse frei, mit „read“ (nur ansehen) oder
„write“ (auch buchen und Daueraufträge pflegen). Hat die Adresse noch kein Konto,
wird die Freigabe beim Registrieren (nach Bestätigung der Adresse) zugeordnet."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from . import db
from .auth import EMAIL_RE, User, current_user, _base_url, _mail_limit
from .mail import mail_share
from .sync import share_rows

router = APIRouter(prefix="/api/shares")


class ShareIn(BaseModel):
    account: str
    email: str
    perm: str = "write"


class PermIn(BaseModel):
    perm: str


def _perm(p: str) -> str:
    if p not in ("read", "write"):
        raise HTTPException(400, "Recht muss „read“ oder „write“ sein.")
    return p


@router.get("")
def list_shares(u: User = Depends(current_user)):
    with db.tx(u.id) as c:
        return {"shares": share_rows(c)}


@router.post("")
def create_share(body: ShareIn, req: Request, u: User = Depends(current_user)):
    email = body.email.strip().lower()[:200]
    perm = _perm(body.perm)
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Bitte eine gültige E-Mail-Adresse eingeben.")
    if email == u.email.lower():
        raise HTTPException(400, "Das ist deine eigene Adresse.")
    _mail_limit(req, email)
    with db.tx(u.id) as c:
        acc = c.execute("SELECT id, name, kind FROM fin.accounts WHERE user_id = %s AND id = %s", (u.id, body.account)).fetchone()
        if not acc:
            raise HTTPException(404, "Konto nicht gefunden. Geteilte Konten anderer kannst du nicht weitergeben.")
        n = c.execute("SELECT count(*) AS n FROM fin.account_shares WHERE owner_id = %s", (u.id,)).fetchone()["n"]
        if n >= 50:
            raise HTTPException(400, "Zu viele Freigaben.")
        g = c.execute("SELECT * FROM fin.share_user_by_email(%s)", (email,)).fetchone()
        row = c.execute("""INSERT INTO fin.account_shares(owner_id, account_id, grantee_email, grantee_id, perm)
                           VALUES (%s, %s, %s, %s, %s)
                           ON CONFLICT (owner_id, account_id, grantee_email) DO UPDATE SET perm = EXCLUDED.perm
                           RETURNING id, (xmax = 0) AS created""",
                        (u.id, acc["id"], email, g["id"] if g else None, perm)).fetchone()
        c.execute("SELECT fin.share_touch(%s)", (u.id,))
    mail_ok = True
    if row["created"]:
        try:
            mail_share(email, u.name, u.email, acc["name"], perm, _base_url(req) + ("/" if g else "/#register=" + email), bool(g))
        except Exception:
            mail_ok = False
    return {"ok": True, "id": str(row["id"]), "registered": bool(g), "mail": mail_ok, "updated": not row["created"]}


@router.post("/{sid}/perm")
def change_perm(sid: str, body: PermIn, u: User = Depends(current_user)):
    perm = _perm(body.perm)
    with db.tx(u.id) as c:
        r = c.execute("UPDATE fin.account_shares SET perm = %s WHERE id::text = %s AND owner_id = %s RETURNING id", (perm, sid, u.id)).fetchone()
        if not r:
            raise HTTPException(404, "Freigabe nicht gefunden.")
        c.execute("SELECT fin.share_touch(%s)", (u.id,))
    return {"ok": True}


@router.delete("/{sid}")
def delete_share(sid: str, u: User = Depends(current_user)):
    """Besitzer nimmt die Freigabe zurück – oder Empfänger verlässt sie."""
    with db.tx(u.id) as c:
        r = c.execute("DELETE FROM fin.account_shares WHERE id::text = %s AND (owner_id = %s OR grantee_id = %s) RETURNING owner_id",
                      (sid, u.id, u.id)).fetchone()
        if not r:
            raise HTTPException(404, "Freigabe nicht gefunden.")
        if str(r["owner_id"]) == u.id:
            c.execute("SELECT fin.share_touch(%s)", (u.id,))
    return {"ok": True}
