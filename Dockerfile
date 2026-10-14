# ---------- 1. Seite bauen (eine HTML-Datei aus den Quellen) ----------
FROM python:3.12-slim AS web
WORKDIR /src
COPY web/ web/
RUN python web/build.py

# ---------- 2. Server ----------
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    WEB_DIR=/app/web TZ=Europe/Berlin
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --no-create-home finanzen
WORKDIR /app/server
COPY server/requirements.txt .
RUN pip install -r requirements.txt
COPY server/ /app/server/
COPY --from=web /src/web/out/index.html /app/web/index.html
USER finanzen
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)" || exit 1
CMD ["uvicorn", "finanzen.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers", "--forwarded-allow-ips", "*"]
