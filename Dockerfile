# TRACEFUSE — one image, one process: FastAPI serves the API and the built web UI.
# Layout inside the image mirrors the repo (/app/backend, /app/frontend/dist) so the default
# TRACEFUSE_FRONTEND_DIST resolves without configuration.

# ---- stage 1: build the web UI ------------------------------------------------------------------
FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- stage 2: runtime ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TRACEFUSE_DB_PATH=/data/tracefuse.sqlite3
WORKDIR /app

# Editable install keeps BACKEND_ROOT (bundled case data, OFAC list, migrations) next to the code.
COPY backend/pyproject.toml backend/
COPY backend/tracefuse backend/tracefuse
COPY backend/data backend/data
RUN pip install -e backend

COPY --from=ui /ui/dist frontend/dist

RUN useradd --system --uid 10001 --home /app tracefuse \
    && mkdir -p /data && chown -R tracefuse /data
USER tracefuse
VOLUME /data

# Platforms inject PORT; default 8000. Exactly ONE worker: job state is in-process and SQLite is single-writer.
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import os,urllib.request as u; u.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"8000\")}/api/health', timeout=4)"
CMD ["sh", "-c", "exec uvicorn tracefuse.api.app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
