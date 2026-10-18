"""FastAPI application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from .. import __version__
from ..config import Settings, get_settings
from ..intel.ofac import import_snapshot
from ..logging_setup import configure_logging
from ..pipeline.investigation import JobManager
from ..providers.errors import ProviderError
from ..services import Services
from ..storage.repositories import NotFoundError
from .routes import cases, investigations, system

log = logging.getLogger(__name__)


def ensure_ofac(services: Services) -> None:
    """Import the bundled official-OFAC snapshot when no dataset has been imported yet."""
    if services.ofac_repo.active_dataset() is not None:
        return
    snap = Path(services.settings.tracefuse_data_dir) / "ofac" / "ofac_snapshot.json.gz"
    if snap.exists():
        n = import_snapshot(services.ofac, snap)
        log.info("imported bundled OFAC snapshot (%s identifiers)", n)


UI_MISSING = """<!doctype html><meta charset="utf-8"><title>TRACEFUSE</title>
<body style="font:16px/1.5 system-ui,sans-serif;background:#0b0d0b;color:#f2f0e8;max-width:40rem;margin:15vh auto;padding:0 1rem">
<h1>The TRACEFUSE interface has not been built yet</h1>
<p>Run <code>./run.sh</code> from the repository root (or <code>cd frontend &amp;&amp; npm run build</code>) and reload this page.
The API is already running under <a href="/api/ready" style="color:#58d6c5">/api</a>.</p></body>"""


class _HashedAssets(StaticFiles):
    """Vite emits content-hashed file names under /assets, so they can be cached forever."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        resp = await super().get_response(path, scope)
        if resp.status_code == 200:
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp


def mount_frontend(app: FastAPI, dist: Path) -> None:
    """Serve the built web UI from the API process: one port for the landing page, the Investigation Room,
    media and /api. Client-side routes fall back to index.html; unknown /api paths stay JSON 404s."""
    dist = dist.resolve()
    index = dist / "index.html"
    if (dist / "assets").is_dir():
        app.mount("/assets", _HashedAssets(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path == "api" or path.startswith("api/"):
            return JSONResponse({"detail": f"not found: /{path}"}, status_code=404)
        if not index.is_file():
            return HTMLResponse(UI_MISSING, status_code=503)
        f = (dist / path).resolve()
        if path and f.is_file() and dist in f.parents:
            # FileResponse answers Range requests, so the hero video can stream as well as download
            return FileResponse(f, headers={"Cache-Control": "public, max-age=3600"})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        svc = services or Services.create(settings)
        ensure_ofac(svc)
        app.state.services = svc
        app.state.jobs = JobManager(svc)
        yield
        await app.state.jobs.shutdown()
        if services is None:
            await svc.aclose()

    app = FastAPI(title="TRACEFUSE API", version=__version__, lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_allow_origins, allow_methods=["*"],
                       allow_headers=["*"], expose_headers=["Content-Disposition"])

    @app.middleware("http")
    async def limit_body(request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > settings.max_request_body_bytes:
            return JSONResponse({"detail": "request body too large"}, status_code=413)
        return await call_next(request)

    @app.exception_handler(NotFoundError)
    async def _nf(_: Request, exc: NotFoundError):
        return JSONResponse({"detail": f"not found: {exc.args[0] if exc.args else ''}"}, status_code=404)

    @app.exception_handler(KeyError)
    async def _ke(_: Request, exc: KeyError):
        return JSONResponse({"detail": f"not found: {exc.args[0] if exc.args else ''}"}, status_code=404)

    @app.exception_handler(ValueError)
    async def _ve(_: Request, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(ProviderError)
    async def _pe(_: Request, exc: ProviderError):
        return JSONResponse({"detail": exc.to_dict()}, status_code=429 if exc.kind == "rate_limited" else 502)

    app.include_router(system.router)
    app.include_router(investigations.router)
    app.include_router(cases.router)

    mount_frontend(app, settings.tracefuse_frontend_dist)
    return app


app = create_app()  # uvicorn tracefuse.api.app:app
