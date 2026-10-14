"""Kurse, Verläufe, Suche und News – Python-Fassung des bisherigen PHP-Proxys.

Quellen: onvista (Aktien/ETFs per ISIN), EZB (Wechselkurse), Google News (RSS),
Yahoo nur noch für alte Kürzel. Keine offiziellen Schnittstellen, Kurse meist verzögert.
Zwischenspeicher: Tabelle fin.market_cache (keine Nutzerdaten)."""
import datetime as dt
import email.utils
import html
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Jsonb

from . import db
from .auth import User, current_user
from .config import settings

router = APIRouter(prefix="/api/market")

TTL_QUOTE, TTL_HISTORY, TTL_SEARCH, TTL_FX, TTL_NEWS = 120, 3600, 86400, 3600, 1800
MAX_SYMBOLS = 60
RANGES = {"1mo": ("1mo", "1d", "M1", 31), "6mo": ("6mo", "1d", "M6", 183), "1y": ("1y", "1d", "Y1", 366),
          "5y": ("5y", "1wk", "Y5", 1830), "max": ("max", "1mo", "MAX", 7300)}
SYM_RE = re.compile(r"^[A-Za-z0-9.\-=^:]{1,40}$")
OV_RE = re.compile(r"^OV:([A-Z_]+):([A-Z]{2}[A-Z0-9]{9}[0-9])$")
FX_RE = re.compile(r"^([A-Z]{3})EUR=X$")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"


class SourceError(Exception):
    pass


# ---------- Zwischenspeicher ----------
def cache_get(key: str, ttl: int):
    with db.tx() as c:
        r = c.execute("SELECT data FROM fin.market_cache WHERE key = %s AND fetched_at > now() - make_interval(secs => %s)",
                      (key, ttl)).fetchone()
    return r["data"] if r else None


def cache_put(key: str, val) -> None:
    with db.tx() as c:
        c.execute("INSERT INTO fin.market_cache(key, data, fetched_at) VALUES (%s, %s, now()) "
                  "ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()", (key, Jsonb(val)))
        if int(time.time()) % 50 == 0:
            c.execute("DELETE FROM fin.market_cache WHERE fetched_at < now() - interval '45 days'")


# ---------- Abruf ----------
_client: Optional[httpx.Client] = None


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=httpx.Timeout(12.0, connect=6.0), follow_redirects=True, proxy=settings.http_proxy,
                               headers={"User-Agent": UA, "Accept": "application/json, text/xml;q=0.9, */*;q=0.8",
                                        "Accept-Language": "de-DE,de;q=0.9"})
    return _client


def fetch(url: str) -> Tuple[int, str, str]:
    try:
        r = client().get(url)
        return r.status_code, r.text, ""
    except httpx.HTTPError as e:
        return 0, "", type(e).__name__


def fetch_all(urls: List[str]) -> Dict[str, Tuple[int, str, str]]:
    urls = list(dict.fromkeys(urls))
    if len(urls) == 1:
        return {urls[0]: fetch(urls[0])}
    with ThreadPoolExecutor(max_workers=min(8, len(urls))) as ex:
        return dict(zip(urls, ex.map(fetch, urls)))


def http_fail(code: int, cerr: str, src: str) -> str:
    if cerr:
        return f"{src} nicht erreichbar ({cerr})"
    if code == 0:
        return f"{src} nicht erreichbar (keine Verbindung vom Server aus)"
    if code == 429:
        return f"{src} blockiert gerade (HTTP 429, zu viele Anfragen von diesem Server)"
    return f"{src}: unerwartete Antwort (HTTP {code})"


def num(x) -> Optional[float]:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return round(v, 6) if v == v and abs(v) != float("inf") else None


def ts(x) -> int:
    if isinstance(x, (int, float)):
        return int(x)
    if isinstance(x, str) and x:
        try:
            return int(dt.datetime.fromisoformat(x.replace("Z", "+00:00")).timestamp())
        except ValueError:
            pass
        try:
            return int(email.utils.parsedate_to_datetime(x).timestamp())
        except (TypeError, ValueError):
            pass
    return int(time.time())


def ov_sym(s: str):
    m = OV_RE.match(s)
    return (m.group(1), m.group(2)) if m else None


def ov_snapshot_url(typ: str, isin: str) -> str:
    p = {"STOCK": "stocks", "FUND": "funds"}.get(typ)
    return f"{settings.ov_base}{p}/ISIN:{isin}/snapshot" if p else f"{settings.ov_base}instruments/{typ}/ISIN:{isin}/snapshot"


def chart_url(sym: str, rng: str, interval: str) -> str:
    return f"{settings.y_chart}{quote(sym, safe='')}?range={rng}&interval={interval}&includePrePost=false"


# ---------- onvista ----------
def ov_parse(sym: str, j: dict) -> dict:
    q = j.get("quote") if isinstance(j, dict) else None
    if not q:
        raise SourceError("onvista: kein Kurs")
    price = num(q.get("last"))
    if price is None:
        raise SourceError("onvista: kein Kurs")
    prev = num(q.get("previousLast"))
    if prev is None and num(q.get("performance")) is not None:
        prev = round(price - float(q["performance"]), 6)
    mk = q.get("market") or {}
    if mk.get("idNotation"):
        cache_put("ovn:" + sym, str(mk["idNotation"]))
    inst = j.get("instrument") or {}
    return {"price": price, "prev": prev, "currency": q.get("isoCurrency") or inst.get("isoCurrency") or "EUR",
            "name": inst.get("name") or sym, "time": ts(q.get("datetimeLast") or time.time()),
            "exchange": mk.get("name") or mk.get("codeExchange") or "onvista", "source": "onvista"}


def ov_history(sym: str, r: str) -> list:
    typ, isin = ov_sym(sym)
    notation = cache_get("ovn:" + sym, 86400 * 30)
    if not notation:
        quotes([sym])
        notation = cache_get("ovn:" + sym, 86400 * 30)
    if not notation:
        raise SourceError("onvista: Handelsplatz unbekannt")
    start = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=RANGES[r][3])).strftime("%Y-%m-%d")
    u = f"{settings.ov_base}instruments/{typ}/ISIN:{isin}/eod_history?idNotation={quote(str(notation))}&range={RANGES[r][2]}&startDate={start}"
    code, body, cerr = fetch(u)
    j = _json(body)
    if not isinstance(j, dict) or "datetimeLast" not in j:
        raise SourceError(http_fail(code, cerr, "onvista"))
    pts = []
    last = j.get("last") or []
    for i, t in enumerate(j["datetimeLast"]):
        v = num(last[i] if i < len(last) else None)
        if v is not None:
            pts.append([dt.datetime.fromtimestamp(ts(t)).strftime("%Y-%m-%d"), v])
    return pts


# ---------- EZB ----------
def ecb_rates() -> dict:
    c = cache_get("ecb", TTL_FX)
    if c:
        return c
    code, body, cerr = fetch(settings.ecb_url)
    m = re.findall(r"currency=['\"]([A-Z]{3})['\"]\s+rate=['\"]([0-9.]+)['\"]", body)
    if not m:
        raise SourceError(http_fail(code, cerr, "EZB"))
    d = re.search(r"time=['\"](\d{4}-\d{2}-\d{2})['\"]", body)
    r = {"_date": d.group(1) if d else dt.date.today().isoformat()}
    for cur, rate in m:
        r[cur] = float(rate)
    cache_put("ecb", r)
    return r


# ---------- Yahoo (nur alte Kürzel) ----------
def y_parse(sym: str, j: dict) -> dict:
    res = ((j or {}).get("chart") or {}).get("result") or [None]
    r = res[0]
    if not r:
        raise SourceError((((j or {}).get("chart") or {}).get("error") or {}).get("description") or "kein Kurs")
    m = r.get("meta") or {}
    price = num(m.get("regularMarketPrice"))
    if price is None:
        raise SourceError("kein Kurs")
    closes = [v for v in (((r.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []) if v is not None]
    prev = num(closes[-2]) if len(closes) >= 2 else num(m.get("previousClose") or m.get("chartPreviousClose"))
    return {"price": price, "prev": prev, "currency": m.get("currency"), "name": m.get("longName") or m.get("shortName") or sym,
            "time": int(m.get("regularMarketTime") or time.time()), "exchange": m.get("exchangeName"), "source": "Yahoo"}


def _json(body: str):
    try:
        return json.loads(body) if body else None
    except ValueError:
        return None


# ---------- Kurse ----------
def quotes(syms: List[str]) -> dict:
    out, err, need = {}, {}, {}
    for s in syms:
        c = cache_get("q:" + s, TTL_QUOTE)
        if c:
            out[s] = c
            continue
        m = FX_RE.match(s)
        if m:
            cur = m.group(1)
            try:
                r = ecb_rates()
                if not r.get(cur):
                    raise SourceError("EZB: kein Kurs für " + cur)
                v = round(1 / r[cur], 6)
                t = int(dt.datetime.fromisoformat(r["_date"] + "T16:00:00+01:00").timestamp())
                out[s] = q = {"price": v, "prev": v, "currency": "EUR", "name": cur + "/EUR", "time": t, "exchange": "EZB", "source": "EZB"}
                cache_put("q:" + s, q)
            except SourceError as e:
                err[s] = str(e)
            continue
        o = ov_sym(s)
        need[s] = ov_snapshot_url(*o) if o else chart_url(s, "5d", "1d")
    if need:
        res = fetch_all(list(need.values()))
        for s, u in need.items():
            code, body, cerr = res[u]
            is_ov = ov_sym(s) is not None
            try:
                j = _json(body)
                if cerr or not isinstance(j, dict) or (code >= 400 and code != 404):
                    raise SourceError(http_fail(code, cerr, "onvista" if is_ov else "Yahoo"))
                q = ov_parse(s, j) if is_ov else y_parse(s, j)
                cache_put("q:" + s, q)
                out[s] = q
            except SourceError as e:
                err[s] = str(e)[:140]
    return {"quotes": out, "errors": err, "delayed": True, "demo": False}


def history(sym: str, r: str) -> list:
    key = f"h:{sym}:{r}"
    c = cache_get(key, TTL_HISTORY)
    if c is not None:
        return c
    if ov_sym(sym):
        pts = ov_history(sym, r)
    elif FX_RE.match(sym):
        pts = []
    else:
        rng, interval = RANGES[r][0], RANGES[r][1]
        code, body, cerr = fetch(chart_url(sym, rng, interval))
        j = _json(body)
        res = (((j or {}).get("chart") or {}).get("result") or [None])[0] if isinstance(j, dict) else None
        if not res:
            raise SourceError(http_fail(code, cerr, "Yahoo"))
        off = int((res.get("meta") or {}).get("gmtoffset") or 0)
        cl = (((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [])
        pts = []
        for i, t in enumerate(res.get("timestamp") or []):
            v = num(cl[i] if i < len(cl) else None)
            if v is not None:
                pts.append([dt.datetime.fromtimestamp(t + off, dt.timezone.utc).strftime("%Y-%m-%d"), v])
    if pts:
        cache_put(key, pts)
    return pts


# ---------- Suche ----------
def search(q: str) -> dict:
    key = "s2:" + q.lower()
    c = cache_get(key, TTL_SEARCH)
    if c:
        return {"results": c, "warning": None}
    out, seen, warn = [], set(), None

    def add(sym, name, ex, typ, isin=""):
        if not sym or sym in seen:
            return
        seen.add(sym)
        out.append({"symbol": sym, "name": name or sym, "exchange": ex or "", "type": typ or "EQUITY", "isin": isin})

    u = f"{settings.ov_base}instruments/query?limit=12&searchValue={quote(q)}"
    code, body, cerr = fetch(u)
    j = _json(body)
    if isinstance(j, dict) and "list" in j:
        for x in j["list"] or []:
            t = x.get("entityType") or ""
            if t not in ("STOCK", "FUND") or not x.get("isin"):
                continue
            add(f"OV:{t}:{x['isin']}", x.get("name") or x.get("tinyName") or x["isin"],
                "ISIN " + x["isin"] + (" · WKN " + x["wkn"] if x.get("wkn") else ""), "ETF" if t == "FUND" else "EQUITY", x["isin"])
    else:
        warn = http_fail(code, cerr, "onvista")
    if not out:
        u = f"{settings.y_search}?q={quote(q)}&quotesCount=12&newsCount=0&listsCount=0"
        _, body2, _ = fetch(u)
        j = _json(body2)
        for x in (j.get("quotes") or []) if isinstance(j, dict) else []:
            if x.get("quoteType") in ("EQUITY", "ETF", "MUTUALFUND"):
                add(x.get("symbol"), x.get("shortname") or x.get("longname"), x.get("exchDisp") or x.get("exchange"), x["quoteType"])
        out.sort(key=lambda r: 0 if r["symbol"].endswith(".DE") else 1)
    if out:
        cache_put(key, out)
    return {"results": out, "warning": None if out else warn}


# ---------- News ----------
def _tag(x: str, t: str) -> str:
    m = re.search(r"<" + t + r"(?:\s[^>]*)?>(.*?)</" + t + ">", x, re.S)
    if not m:
        return ""
    v = m.group(1).strip()
    v = re.sub(r"^<!\[CDATA\[(.*)\]\]>$", r"\1", v, flags=re.S)
    v = re.sub(r"<[^>]+>", "", v)
    return html.unescape(v).strip()


def news(q: str) -> list:
    key = "n:" + q.lower()
    c = cache_get(key, TTL_NEWS)
    if c is not None:
        return c
    u = settings.news_url + "?q=" + quote(f'"{q}" Aktie when:14d') + "&hl=de&gl=DE&ceid=DE:de"
    code, body, cerr = fetch(u)
    if cerr or code >= 400 or "<rss" not in body:
        raise SourceError(http_fail(code, cerr, "Google News"))
    items = []
    for it in re.findall(r"<item>(.*?)</item>", body, re.S):
        title, src, link = _tag(it, "title"), _tag(it, "source"), _tag(it, "link")
        if src and title.endswith(" - " + src):
            title = title[: -len(" - " + src)]
        if not title or not re.match(r"^https?://", link):
            continue
        items.append({"title": title, "link": link, "source": src, "date": ts(_tag(it, "pubDate"))})
    items.sort(key=lambda i: -i["date"])
    items = items[:15]
    cache_put(key, items)
    return items


# ---------- Endpunkte (nur angemeldet) ----------
def _wrap(fn):
    try:
        return fn()
    except SourceError as e:
        raise HTTPException(502, "Kursquelle nicht erreichbar: " + str(e)[:160])


@router.get("/ping")
def ep_ping(u: User = Depends(current_user)):
    return {"ok": True, "demo": False, "sources": ["onvista", "EZB", "Yahoo", "Google News"]}


@router.get("/quotes")
def ep_quotes(s: str = "", u: User = Depends(current_user)):
    syms = list(dict.fromkeys(x.strip().upper() for x in s.split(",") if SYM_RE.match(x.strip())))
    if not syms:
        raise HTTPException(400, "keine gültigen Kürzel")
    return _wrap(lambda: quotes(syms[:MAX_SYMBOLS]))


@router.get("/history")
def ep_history(s: str = "", r: str = "1y", u: User = Depends(current_user)):
    s = s.strip().upper()
    if not SYM_RE.match(s) or r not in RANGES:
        raise HTTPException(400, "Kürzel oder Zeitraum ungültig")
    return _wrap(lambda: {"symbol": s, "range": r, "points": history(s, r)})


@router.get("/search")
def ep_search(q: str = "", u: User = Depends(current_user)):
    q = q.strip()[:40]
    if len(q) < 2:
        raise HTTPException(400, "Suchbegriff zu kurz")
    return _wrap(lambda: search(q))


@router.get("/news")
def ep_news(q: str = "", u: User = Depends(current_user)):
    q = q.strip()[:60]
    if len(q) < 2:
        raise HTTPException(400, "Suchbegriff zu kurz")
    return _wrap(lambda: {"query": q, "items": news(q)})
