"""Abgleich zwischen der Seite und den Tabellen.

GET  /api/data  liefert alle Daten des Nutzers im Format der Seite.
POST /api/sync  übernimmt Änderungen: {base_rev, settings?, upsert:{coll:[obj]}, delete:{coll:[id]}}
                in EINER Transaktion. Pro Datensatz gilt: neuere Änderung (Feld u) gewinnt.

Die Seite kennt verschachtelte Objekte (z. B. Konto.fee = {amount, interval, day});
hier werden sie auf Spalten verteilt. Unbekannte Felder landen in der Spalte extra
und kommen unverändert zurück."""
import datetime as dt
import json
import math
import re
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional, Tuple

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.types.json import Jsonb

from . import db
from .auth import User, current_user

router = APIRouter(prefix="/api")

ID_RE = re.compile(r"^[A-Za-z0-9_.:|\-]{1,80}$")
MAX_ITEMS = 50000


class Reject(Exception):
    pass


# ---------- Umwandler Seite -> Datenbank ----------
def s_text(maxlen: int = 200, required: bool = False):
    def f(v):
        if v is None or v == "":
            if required:
                raise Reject("leer")
            return None
        return str(v)[:maxlen]
    return f


def s_id(required: bool = False):
    def f(v):
        if v is None or v == "":
            if required:
                raise Reject("id fehlt")
            return None
        v = str(v)
        if not ID_RE.match(v):
            raise Reject("id ungültig")
        return v
    return f


def s_cents(required: bool = False, default=None):
    def f(v):
        if v is None or v == "":
            if required:
                raise Reject("Betrag fehlt")
            return default
        try:
            x = float(v)
        except (TypeError, ValueError):
            raise Reject("Betrag ungültig")
        if not math.isfinite(x) or abs(x) > 9e15:
            raise Reject("Betrag ungültig")
        return int(round(x))
    return f


def s_num(required: bool = False, lo: Optional[float] = None, default=None):
    def f(v):
        if v is None or v == "":
            if required:
                raise Reject("Zahl fehlt")
            return default
        try:
            x = float(v)
        except (TypeError, ValueError):
            raise Reject("Zahl ungültig")
        if not math.isfinite(x) or abs(x) > 1e13 or (lo is not None and x < lo):
            raise Reject("Zahl ungültig")
        return x
    return f


def s_int(lo: int, hi: int, required: bool = False, default=None):
    def f(v):
        if v is None or v == "":
            if required:
                raise Reject("Zahl fehlt")
            return default
        try:
            x = int(float(v))
        except (TypeError, ValueError):
            raise Reject("Zahl ungültig")
        if x < lo or x > hi:
            raise Reject("außerhalb")
        return x
    return f


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def s_date(required: bool = False):
    def f(v):
        if v is None or v == "":
            if required:
                raise Reject("Datum fehlt")
            return None
        if not isinstance(v, str) or not DATE_RE.match(v):
            raise Reject("Datum ungültig")
        try:
            return dt.date.fromisoformat(v)
        except ValueError:
            raise Reject("Datum ungültig")
    return f


def s_enum(values, default=None):
    def f(v):
        if v in values:
            return v
        if default is not None:
            return default
        raise Reject("Wert ungültig")
    return f


def s_bool(v):
    return bool(v)


def s_u(v):
    try:
        x = int(float(v or 0))
    except (TypeError, ValueError):
        return 0
    return max(0, min(x, 10**15))


# ---------- Umwandler Datenbank -> Seite ----------
def o_plain(v):
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    return v


# Feldliste: (Schlüssel in der Seite, Spalte, Umwandler, Ausgabe-Regel)
#   Schlüssel mit Punkt = verschachtelt (fee.amount)
#   Ausgabe-Regel: "keep" immer ausgeben, "skipnull" weglassen, wenn NULL, "true" nur wenn wahr
class Coll:
    def __init__(self, name: str, table: str, fields: List[Tuple[str, str, Callable, str]], has_u: bool = True,
                 nested_null: Tuple[str, ...] = (), parent: Optional[Tuple[str, str, str]] = None,
                 on_update_extra: str = "", sort_col: bool = False):
        self.name, self.table, self.fields, self.has_u = name, table, fields, has_u
        self.nested_null = nested_null       # verschachtelte Objekte, die als null ausgegeben werden, wenn leer
        self.parent = parent                 # (Spalte, Elterntabelle, Elternspalte) für das Aufräumen von Waisen
        self.on_update_extra = on_update_extra
        self.sort_col = sort_col
        self.known_top = {k.split(".")[0] for k, *_ in fields}
        if sort_col:
            self.known_top.add("sort")

    def to_row(self, obj: dict, idx: int) -> dict:
        if not isinstance(obj, dict):
            raise Reject("kein Objekt")
        row = {}
        for key, col, conv, _ in self.fields:
            if "." in key:
                a, b = key.split(".", 1)
                sub = obj.get(a)
                v = sub.get(b) if isinstance(sub, dict) else None
            else:
                v = obj.get(key)
            row[col] = conv(v)
        if self.sort_col:
            row["sort"] = idx
        extra = {k: v for k, v in obj.items() if k not in self.known_top}
        row["extra"] = Jsonb(extra)
        return row

    def to_obj(self, row: dict) -> dict:
        out: Dict[str, Any] = {}
        for key, col, _, rule in self.fields:
            v = o_plain(row[col])
            if rule == "skipnull" and v is None:
                continue
            if rule == "true" and not v:
                continue
            if "." in key:
                a, b = key.split(".", 1)
                out.setdefault(a, {})[b] = v
            else:
                out[key] = v
        for a in self.nested_null:
            sub = out.get(a)
            if not sub or all(x is None or x == "" for x in sub.values()):
                out[a] = None
            else:
                # leere Unterfelder wie in der Seite als "" bzw. weglassen
                out[a] = {k: ("" if v is None and k in ("date",) else v) for k, v in sub.items() if v is not None or k == "date"}
        ex = row.get("extra") or {}
        for k, v in ex.items():
            if k not in out:
                out[k] = v
        return out


KINDS = ("giro", "haushalt", "spar", "kredit", "karte", "sonst")
COLLS: Dict[str, Coll] = {}


def _reg(c: Coll):
    COLLS[c.name] = c


_reg(Coll("accounts", "accounts", [
    ("id", "id", s_id(True), "keep"), ("name", "name", s_text(60, True), "keep"),
    ("kind", "kind", s_enum(KINDS, "sonst"), "keep"), ("color", "color", s_text(20), "skipnull"),
    ("start.date", "start_date", s_date(True), "keep"), ("start.amount", "start_amount", s_cents(default=0), "keep"),
    ("fee.amount", "fee_amount", s_cents(), "skipnull"), ("fee.interval", "fee_interval", lambda v: v if v in ("m", "q", "j") else None, "skipnull"),
    ("fee.day", "fee_day", s_int(1, 31), "skipnull"),
    ("interest", "interest", s_num(lo=0), "keep"),
    ("goal.amount", "goal_amount", s_cents(), "skipnull"), ("goal.date", "goal_date", s_date(), "skipnull"),
    ("min", "min_amount", s_cents(default=0), "keep"),
    ("loan.rate", "loan_rate", s_num(lo=0), "skipnull"), ("loan.day", "loan_day", s_int(1, 31), "skipnull"),
    ("loan.payFrom", "loan_pay_from", s_text(80), "skipnull"), ("loan.orig", "loan_orig", s_cents(), "skipnull"),
    ("loan.order", "loan_order", s_text(80), "skipnull"),
    ("u", "u", s_u, "keep"),
], nested_null=("fee", "goal", "loan"), sort_col=True))

_reg(Coll("orders", "orders", [
    ("id", "id", s_id(True), "keep"), ("name", "name", s_text(80, True), "keep"),
    ("amount", "amount", s_cents(True), "keep"), ("from", "from_acc", s_text(80), "keep"), ("to", "to_acc", s_text(80), "keep"),
    ("interval", "interval", s_enum(("m", "q", "h", "j")), "keep"), ("day", "day", s_int(1, 31, default=1), "keep"),
    ("start", "start_date", s_date(True), "keep"), ("end", "end_date", s_date(), "keep"),
    ("shift", "shift", s_enum(("next", "prev", "none"), "next"), "keep"), ("cat", "cat", s_text(60), "keep"),
    ("u", "u", s_u, "keep"),
]))

_reg(Coll("tx", "bookings", [
    ("id", "id", s_id(True), "keep"), ("acc", "acc", s_text(80, True), "keep"), ("date", "date", s_date(True), "keep"),
    ("amount", "amount", s_cents(True), "keep"), ("text", "text", s_text(200), "keep"), ("cat", "cat", s_text(60), "keep"),
    ("order", "order_id", s_text(80), "skipnull"), ("occ", "occ", s_date(), "skipnull"), ("tr", "tr", s_text(80), "skipnull"),
    ("corr", "corr", s_bool, "true"), ("sec_tx", "sec_tx", s_text(80), "skipnull"),
    ("u", "u", s_u, "keep"),
], parent=("acc", "accounts", "id")))

_reg(Coll("depots", "depots", [
    ("id", "id", s_id(True), "keep"), ("name", "name", s_text(60, True), "keep"), ("cash_acc", "cash_acc", s_text(80), "skipnull"),
], has_u=False, sort_col=True))

_reg(Coll("pos", "positions", [
    ("id", "id", s_id(True), "keep"), ("name", "name", s_text(120, True), "keep"), ("sym", "sym", s_text(60, True), "keep"),
    ("isin", "isin", s_text(12), "keep"), ("kind", "kind", lambda v: v if v in ("aktie", "aktien-etf", "misch", "sonst") else None, "skipnull"),
    ("sector", "sector", s_text(60), "skipnull"), ("country", "country", s_text(60), "skipnull"),
    ("depot", "depot_id", s_text(80), "keep"), ("u", "u", s_u, "keep"),
]))

_reg(Coll("sectx", "sec_tx", [
    ("id", "id", s_id(True), "keep"), ("pos", "pos_id", s_text(80, True), "keep"),
    ("type", "type", s_enum(("buy", "sell", "div")), "keep"), ("date", "date", s_date(True), "keep"),
    ("qty", "qty", s_num(lo=0, default=0), "keep"), ("price", "price", s_num(lo=0, default=0), "keep"),
    ("fee", "fee", s_num(lo=0, default=0), "keep"), ("amount", "amount", s_num(default=0), "keep"),
    ("plan", "plan_id", s_text(80), "skipnull"), ("occ", "occ", s_date(), "skipnull"), ("u", "u", s_u, "keep"),
], parent=("pos_id", "positions", "id")))

_reg(Coll("plans", "savings_plans", [
    ("id", "id", s_id(True), "keep"), ("pos", "pos_id", s_text(80, True), "keep"),
    ("amount", "amount", s_num(True, lo=0.01), "keep"), ("fee", "fee", s_num(lo=0, default=0), "keep"),
    ("interval", "interval", s_enum(("m", "q"), "m"), "keep"), ("day", "day", s_int(1, 31, default=1), "keep"),
    ("start", "start_date", s_date(True), "keep"), ("end", "end_date", s_date(), "keep"),
    ("paused", "paused", s_bool, "keep"), ("u", "u", s_u, "keep"),
], parent=("pos_id", "positions", "id")))

_reg(Coll("watch", "watchlist", [
    ("id", "id", s_id(True), "keep"), ("sym", "sym", s_text(60, True), "keep"), ("name", "name", s_text(120, True), "keep"),
    ("isin", "isin", s_text(12), "keep"), ("note", "note", s_text(200), "keep"), ("u", "u", s_u, "keep"),
]))

_reg(Coll("alerts", "price_alerts", [
    ("id", "id", s_id(True), "keep"), ("sym", "sym", s_text(60, True), "keep"), ("name", "name", s_text(120, True), "keep"),
    ("type", "type", s_enum(("above", "below", "dayDown", "dayUp")), "keep"), ("value", "value", s_num(True, lo=1e-9), "keep"),
    ("hitAt", "hit_at", s_u, "keep"), ("hitDay", "hit_day", s_date(), "skipnull"), ("u", "u", s_u, "keep"),
], on_update_extra=", mail_armed = CASE WHEN t.type IS DISTINCT FROM EXCLUDED.type OR t.value IS DISTINCT FROM EXCLUDED.value OR t.sym IS DISTINCT FROM EXCLUDED.sym THEN true ELSE t.mail_armed END"))

_reg(Coll("events", "events", [
    ("id", "id", s_id(True), "keep"), ("date", "date", s_date(True), "keep"), ("title", "title", s_text(80, True), "keep"),
    ("pos", "pos_ref", s_text(80), "keep"), ("u", "u", s_u, "keep"),
]))

# Reihenfolge beim Schreiben: Eltern vor Kindern
ORDER = ["accounts", "orders", "tx", "depots", "pos", "sectx", "plans", "watch", "alerts", "events"]


def _out_text_empty(obj: dict, keys) -> dict:
    """Die Seite erwartet bei manchen Feldern "" statt null."""
    for k in keys:
        if k in obj and obj[k] is None:
            obj[k] = ""
    return obj


EMPTY_AS_STR = {"orders": ("from", "to", "end", "cat"), "tx": ("text", "cat"), "pos": ("isin", "depot"),
                "plans": ("end",), "watch": ("isin", "note"), "events": ("pos",)}


def _upsert(c, uid: str, coll: Coll, rows: List[dict], rejected: List[dict]) -> None:
    if not rows:
        return
    cols = ["user_id"] + list(rows[0].keys())
    ph = ", ".join(["%s"] * len(cols))
    upd = ", ".join(f"{k} = EXCLUDED.{k}" for k in cols if k not in ("user_id", "id"))
    where = f" WHERE EXCLUDED.u >= t.u" if coll.has_u else ""
    sql = (f"INSERT INTO fin.{coll.table} AS t ({', '.join(cols)}) VALUES ({ph}) "
           f"ON CONFLICT (user_id, id) DO UPDATE SET {upd}{coll.on_update_extra}{where}")
    args = [(uid, *r.values()) for r in rows]
    try:
        with c.transaction():                      # Sicherungspunkt
            c.cursor().executemany(sql, args)
    except psycopg.Error:
        # Ein fehlerhafter Datensatz soll nicht den ganzen Abgleich blockieren:
        # einzeln schreiben, Fehlschläge melden
        for a, r in zip(args, rows):
            try:
                with c.transaction():
                    c.execute(sql, a)
            except psycopg.Error as e:
                rejected.append({"coll": coll.name, "id": r.get("id"), "why": type(e).__name__})


def _write_plan_year(c, uid: str, year: int, data: Any) -> None:
    c.execute("DELETE FROM fin.plan_groups WHERE year = %s", (year,))
    groups = (data or {}).get("groups") if isinstance(data, dict) else None
    if not isinstance(groups, list):
        return
    gi, ii = [], []
    seen = set()
    for gs, g in enumerate(groups):
        if not isinstance(g, dict):
            continue
        gid = str(g.get("id") or f"g{year}_{gs}")[:80]
        if gid in seen:
            continue
        seen.add(gid)
        kind = g.get("kind") if g.get("kind") in ("einnahme", "fix", "variabel") else "variabel"
        gx = {k: v for k, v in g.items() if k not in ("id", "name", "kind", "items")}
        gi.append((uid, gid, year, str(g.get("name") or "Gruppe")[:80], kind, gs, Jsonb(gx)))
        for isort, it in enumerate(g.get("items") or []):
            if not isinstance(it, dict):
                continue
            iid = str(it.get("id") or f"{gid}_{isort}")[:80]
            if iid in seen:
                continue
            seen.add(iid)
            m = list(it.get("m") or [])[:12] + [0] * 12
            months = [int(round(float(x))) if isinstance(x, (int, float)) and math.isfinite(x) else 0 for x in m[:12]]
            ix = {k: v for k, v in it.items() if k not in ("id", "name", "m")}
            ii.append((uid, iid, gid, str(it.get("name") or "Posten")[:80], months, isort, Jsonb(ix)))
    # IDs müssen über alle Jahre eindeutig sein; gleiche IDs aus anderen Jahren vorher entfernen
    if gi:
        c.execute("DELETE FROM fin.plan_groups WHERE id = ANY(%s)", ([g[1] for g in gi],))
        c.cursor().executemany("INSERT INTO fin.plan_groups(user_id, id, year, name, kind, sort, extra) VALUES (%s,%s,%s,%s,%s,%s,%s)", gi)
    if ii:
        c.execute("DELETE FROM fin.plan_items WHERE id = ANY(%s)", ([i[1] for i in ii],))
        c.cursor().executemany("INSERT INTO fin.plan_items(user_id, id, group_id, name, months, sort, extra) VALUES (%s,%s,%s,%s,%s,%s,%s)", ii)


def load_all(c, uid: str) -> dict:
    out: Dict[str, Any] = {}
    u = c.execute("SELECT rev FROM fin.users WHERE id = %s", (uid,)).fetchone()
    out["rev"] = u["rev"] if u else 0
    st = c.execute("SELECT data FROM fin.user_settings WHERE user_id = %s", (uid,)).fetchone()
    out["settings"] = (st or {}).get("data") or {}
    for name in ORDER:
        coll = COLLS[name]
        order = "sort, id" if coll.sort_col else ("date, id" if name in ("tx", "sectx", "events") else "id")
        rows = c.execute(f"SELECT * FROM fin.{coll.table} ORDER BY {order}").fetchall()
        objs = [coll.to_obj(r) for r in rows]
        if name in EMPTY_AS_STR:
            objs = [_out_text_empty(o, EMPTY_AS_STR[name]) for o in objs]
        out[name] = objs
    out["skips"] = [{"order": r["order_id"], "occ": r["occ"].isoformat()} for r in
                    c.execute("SELECT order_id, occ FROM fin.order_skips ORDER BY order_id, occ").fetchall()]
    plan: Dict[str, Any] = {}
    groups = c.execute("SELECT * FROM fin.plan_groups ORDER BY year, sort").fetchall()
    items = c.execute("SELECT * FROM fin.plan_items ORDER BY sort").fetchall()
    by_g: Dict[str, list] = {}
    for it in items:
        o = {"id": it["id"], "name": it["name"], "m": [int(x) for x in it["months"]]}
        for k, v in (it["extra"] or {}).items():
            o.setdefault(k, v)
        by_g.setdefault(it["group_id"], []).append(o)
    for g in groups:
        o = {"id": g["id"], "name": g["name"], "kind": g["kind"], "items": by_g.get(g["id"], [])}
        for k, v in (g["extra"] or {}).items():
            o.setdefault(k, v)
        plan.setdefault(str(g["year"]), {"groups": []})["groups"].append(o)
    out["plan"] = plan
    return out


@router.get("/data")
def get_data(u: User = Depends(current_user)):
    with db.tx(u.id) as c:
        return load_all(c, u.id)


@router.get("/rev")
def get_rev(u: User = Depends(current_user)):
    """Kleiner Abruf für andere Geräte: hat sich seit dem Laden etwas geändert?"""
    with db.tx(u.id) as c:
        return {"rev": c.execute("SELECT rev FROM fin.users WHERE id = %s", (u.id,)).fetchone()["rev"]}


@router.post("/sync")
async def post_sync(req: Request, u: User = Depends(current_user)):
    raw = await req.body()
    from .config import settings as cfg
    if len(raw) > cfg.max_body:
        raise HTTPException(413, "Zu viele Daten auf einmal.")
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        raise HTTPException(400, "Ungültige Daten.")
    if not isinstance(body, dict):
        raise HTTPException(400, "Ungültige Daten.")
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(apply_sync, u.id, body)


def apply_sync(uid: str, body: dict) -> dict:
    ups = body.get("upsert") or {}
    dels = body.get("delete") or {}
    if not isinstance(ups, dict) or not isinstance(dels, dict):
        raise HTTPException(400, "Ungültige Daten.")
    total = sum(len(v) for v in ups.values() if isinstance(v, list)) + sum(len(v) for v in dels.values() if isinstance(v, list))
    if total > MAX_ITEMS:
        raise HTTPException(413, "Zu viele Änderungen auf einmal.")
    rejected: List[dict] = []
    prepared: Dict[str, List[dict]] = {}
    for name in ORDER:
        lst = ups.get(name) or []
        if not isinstance(lst, list):
            continue
        coll, rows, ids = COLLS[name], [], {}
        for i, obj in enumerate(lst):
            try:
                r = coll.to_row(obj, int(obj.get("sort", i)) if coll.sort_col and isinstance(obj, dict) and isinstance(obj.get("sort"), int) else i)
                ids[r["id"]] = r        # doppelte IDs: letzte gewinnt
            except Reject as e:
                rejected.append({"coll": name, "id": obj.get("id") if isinstance(obj, dict) else None, "why": str(e)})
        prepared[name] = list(ids.values())

    with db.tx(uid) as c:
        old = c.execute("SELECT rev FROM fin.users WHERE id = %s FOR UPDATE", (uid,)).fetchone()["rev"]
        base = body.get("base_rev")
        # Einstellungen (ganzes Objekt)
        if isinstance(body.get("settings"), dict):
            s = {k: v for k, v in body["settings"].items() if k not in ("depots",)}
            if len(json.dumps(s)) > 200000:
                raise HTTPException(413, "Einstellungen zu groß.")
            c.execute("INSERT INTO fin.user_settings(user_id, data) VALUES (%s, %s) "
                      "ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data", (uid, Jsonb(s)))
        # Löschen (Kinder zuerst)
        for name in reversed(ORDER):
            ids = [str(x) for x in (dels.get(name) or []) if isinstance(x, (str, int))]
            if ids:
                c.execute(f"DELETE FROM fin.{COLLS[name].table} WHERE id = ANY(%s)", (ids,))
        # Schreiben (Eltern zuerst)
        for name in ORDER:
            _upsert(c, uid, COLLS[name], prepared.get(name, []), rejected)
        # Übersprungene Ausführungen: id = "auftrag|YYYY-MM-DD"
        sk_del = [str(x) for x in (dels.get("skips") or [])]
        for sid in sk_del:
            o, _, occ = sid.rpartition("|")
            if o and DATE_RE.match(occ):
                c.execute("DELETE FROM fin.order_skips WHERE order_id = %s AND occ = %s", (o, occ))
        sk = []
        for x in ups.get("skips") or []:
            if isinstance(x, dict) and x.get("order") and isinstance(x.get("occ"), str) and DATE_RE.match(x["occ"]):
                sk.append((uid, str(x["order"])[:80], x["occ"]))
        if sk:
            c.cursor().executemany("INSERT INTO fin.order_skips(user_id, order_id, occ) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING", sk)
        # Finanzplan: ganze Jahre
        for y in dels.get("plan") or []:
            try:
                c.execute("DELETE FROM fin.plan_groups WHERE year = %s", (int(y),))
            except (TypeError, ValueError):
                pass
        for p in ups.get("plan") or []:
            if isinstance(p, dict):
                try:
                    year = int(p.get("id"))
                except (TypeError, ValueError):
                    continue
                if 1990 <= year <= 2200:
                    _write_plan_year(c, uid, year, p)
        # Waisen entfernen (z. B. Buchung eines Kontos, das ein anderes Gerät gelöscht hat)
        for name in ORDER:
            coll = COLLS[name]
            if coll.parent:
                col, ptab, pcol = coll.parent
                c.execute(f"DELETE FROM fin.{coll.table} t WHERE NOT EXISTS (SELECT 1 FROM fin.{ptab} p WHERE p.user_id = t.user_id AND p.{pcol} = t.{col})")
        c.execute("DELETE FROM fin.plan_items i WHERE NOT EXISTS (SELECT 1 FROM fin.plan_groups g WHERE g.user_id = i.user_id AND g.id = i.group_id)")
        new = c.execute("UPDATE fin.users SET rev = rev + 1 WHERE id = %s RETURNING rev", (uid,)).fetchone()["rev"]
    return {"ok": True, "rev": new, "reload": base is not None and base != old, "rejected": rejected[:50]}
