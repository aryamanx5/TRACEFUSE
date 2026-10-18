"""Single-process mode: the API also serves the built web UI, its assets and media on the same port."""

from __future__ import annotations

from pathlib import Path

import httpx

from tracefuse.api.app import create_app
from tracefuse.config import Settings
from tracefuse.services import Services
from tracefuse.storage.db import Database


async def _client(settings: Settings):
    svc = Services.create(settings, db=Database(settings.tracefuse_db_path))
    app = create_app(settings, svc)
    ctx = app.router.lifespan_context(app)
    await ctx.__aenter__()
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t"), ctx


def _dist(root: Path) -> Path:
    d = root / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "media").mkdir()
    (d / "index.html").write_text("<!doctype html><div id=root></div>")
    (d / "assets" / "index-abc123.js").write_text("console.log(1)")
    (d / "media" / "clip.mp4").write_bytes(bytes(range(256)) * 4)
    (root / "secret.txt").write_text("outside dist")
    return d


async def test_ui_api_and_media_share_one_port(settings: Settings, tmp_path: Path) -> None:
    s = settings.model_copy(update={"tracefuse_frontend_dist": _dist(tmp_path)})
    c, ctx = await _client(s)
    try:
        r = await c.get("/")
        assert r.status_code == 200 and "id=root" in r.text and r.headers["cache-control"] == "no-cache"
        # client-side routes (landing, Investigation Room) resolve to the app shell
        for path in ("/app", "/app/investigations/inv_x", "/anything/else"):
            assert (await c.get(path)).text == r.text
        a = await c.get("/assets/index-abc123.js")
        assert a.status_code == 200 and "immutable" in a.headers["cache-control"]
        # the hero video can be range-requested
        m = await c.get("/media/clip.mp4", headers={"Range": "bytes=0-99"})
        assert m.status_code == 206 and len(m.content) == 100
        # the API keeps answering, and unknown API paths are JSON 404s, not the HTML shell
        assert (await c.get("/api/ready")).status_code == 200
        nf = await c.get("/api/definitely-not-a-route")
        assert nf.status_code == 404 and nf.headers["content-type"].startswith("application/json")
        # no escaping the dist directory
        t = await c.get("/..%2Fsecret.txt")
        assert "outside dist" not in t.text
    finally:
        await c.aclose()
        await ctx.__aexit__(None, None, None)


async def test_missing_build_explains_itself(settings: Settings, tmp_path: Path) -> None:
    s = settings.model_copy(update={"tracefuse_frontend_dist": tmp_path / "nope"})
    c, ctx = await _client(s)
    try:
        r = await c.get("/")
        assert r.status_code == 503 and "run.sh" in r.text
        assert (await c.get("/api/ready")).status_code == 200
    finally:
        await c.aclose()
        await ctx.__aexit__(None, None, None)
