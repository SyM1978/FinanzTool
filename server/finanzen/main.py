"""Meine Finanzen – Server (FastAPI).

Start lokal:   uvicorn finanzen.main:app --port 8000
Auf dem VPS:   systemd-Dienst finanzen.service hinter nginx (siehe deploy/)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import VERSION, alerts, auth, db, market, sync
from .config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.pool()
    yield
    db.close()


app = FastAPI(title="Meine Finanzen", version=VERSION, lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; "
       "base-uri 'none'; form-action 'self'")


@app.middleware("http")
async def guard(request: Request, call_next):
    # Schutz gegen fremde Seiten (CSRF): schreibende API-Aufrufe nur mit eigenem Kopf
    if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("x-requested-with") != "finanzen":
            return JSONResponse({"detail": "Anfrage abgelehnt."}, status_code=403)
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > settings.max_body:
            return JSONResponse({"detail": "Zu viele Daten auf einmal."}, status_code=413)
    resp: Response = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    if request.url.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    else:
        resp.headers.setdefault("Content-Security-Policy", CSP)
    return resp


@app.exception_handler(RequestValidationError)
async def bad_request(request: Request, exc: RequestValidationError):
    return JSONResponse({"detail": "Ungültige Eingabe."}, status_code=400)


@app.exception_handler(StarletteHTTPException)
async def http_err(request: Request, exc: StarletteHTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))


app.include_router(auth.router)
app.include_router(sync.router)
app.include_router(market.router)
app.include_router(alerts.router)


@app.get("/api/health")
def health():
    with db.tx() as c:
        v = c.execute("SELECT value FROM fin.meta WHERE key = 'schema_version'").fetchone()
    return {"ok": True, "version": VERSION, "schema": v["value"] if v else None}


def _index():
    f = settings.web_dir / "index.html"
    if not f.is_file():
        return JSONResponse({"detail": "index.html fehlt in " + str(settings.web_dir)}, status_code=500)
    return FileResponse(f, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-cache"})


@app.get("/")
def index():
    return _index()


@app.get("/index.html")
def index2():
    return _index()
