"""Local HTTP API + the Waypoint page (core/web). Binds to 127.0.0.1 only — this thing moves
your phone, nothing off this machine should be able to reach it.

Run it bare (any OS) with `python core/backend/server.py` and open the printed URL, or let the
Mac app (mac-version/app.py) wrap it in a native window.
"""
import os
import socket
import sys
import threading

if __name__ == "__main__":   # run as a script: make `backend` importable
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.destinations import city_info
from backend.geocode import GeocodeError, search as geocode_search
from backend.license import License
from backend.places import load_places
from backend.routes import RouteError, route_files, summary, warm_legs
from backend.session import Session
from backend.tiles import load_key, tile_url

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


class PlaceReq(BaseModel):
    key: str | None = None
    lat: float | None = None
    lon: float | None = None
    label: str | None = None


class KeyReq(BaseModel):
    key: str = ""


class PlayReq(BaseModel):
    route: str
    engine: str = "spoof"
    mph: float | None = None


# reachable without an access key: the page itself, checking/entering a key, and stop (nobody
# should ever be stuck holding a fake location)
OPEN_API = ("/api/license", "/api/stop")


def create_app(session: Session, license: License | None = None) -> FastAPI:
    app = FastAPI(title="vida-360", docs_url=None, redoc_url=None)
    app.mount("/static", StaticFiles(directory=os.path.join(WEB, "static")), name="static")
    route_cache = {}   # path -> (mtime, summary)
    tile_key = load_key()

    @app.middleware("http")
    async def same_origin_only(request: Request, call_next):
        # DNS rebinding: a page on evil.com can point evil.com at 127.0.0.1, and then its requests
        # look same-origin. They still carry Host: evil.com though, so only answer our own names.
        host = (request.headers.get("host") or "").rsplit(":", 1)[0]
        if host not in ("127.0.0.1", "localhost"):
            return JSONResponse({"detail": "unknown host"}, status_code=403)
        # A random web page could otherwise POST to localhost and move the phone.
        origin = request.headers.get("origin")
        if request.method != "GET" and origin and origin != f"http://{request.headers.get('host')}":
            return JSONResponse({"detail": "cross-origin request refused"}, status_code=403)
        # The key gate lives here, not in the page: hiding a card in JS is undone with the inspector,
        # and curl from the same Mac never sees the page at all.
        path = request.url.path
        if license and not license.ok() and path.startswith("/api/") and path not in OPEN_API:
            return JSONResponse({"detail": "access key needed"}, status_code=402)
        return await call_next(request)

    @app.get("/")
    def index():
        return FileResponse(os.path.join(WEB, "index.html"), headers={"Cache-Control": "no-store"})

    @app.get("/tiles/{z}/{x}/{name}")
    def tile(z: int, x: int, name: str):
        url = tile_url(z, x, name, tile_key)
        if not url:
            raise HTTPException(404, "not a tile")
        return RedirectResponse(url, status_code=302, headers={"Cache-Control": "max-age=21600"})

    @app.get("/api/license")
    def license_status(wait: int = 0):
        if not license:
            return {"required": False, "state": "ok"}
        return license.status(wait=min(wait, 10))

    @app.post("/api/license")
    def license_activate(req: KeyReq):
        if not license:
            return {"required": False, "state": "ok"}
        return license.activate(req.key[:64])

    @app.get("/api/status")
    def status():
        # waypoint_build only exists in the compiled release app, anything else is running from the repo
        return {**session.status(), "dev_build": "waypoint_build" not in sys.modules}

    @app.get("/api/logs")
    def logs(since: int = 0):
        return session.logs_since(since)

    @app.get("/api/places")
    def places():
        return [{"id": k, **p} for k, p in load_places().items()]

    @app.get("/api/cities")
    def cities():
        return city_info()

    @app.get("/api/routes")
    def routes():
        out = []
        for path in route_files():
            mtime = os.path.getmtime(path)
            cached = route_cache.get(path)
            # an estimate until warm_legs has rendered it, so look again until it's exact
            if not cached or cached[0] != mtime or not cached[1]["exact"]:
                try:
                    cached = route_cache[path] = (mtime, summary(path))
                except (ValueError, OSError) as e:
                    session.log(f"skipping {os.path.basename(path)}: {e}", "warn")
                    continue
            out.append(cached[1])
        return out

    @app.get("/api/geocode")
    def geocode(q: str = ""):
        try:
            return geocode_search(q)
        except GeocodeError as e:
            raise HTTPException(502, str(e))

    @app.post("/api/place")
    def place(req: PlaceReq):
        if req.key:
            p = load_places().get(req.key)
            if not p:
                raise HTTPException(404, f"no place called '{req.key}'")
            session.set_location(p["lat"], p["lon"], p["name"])
        elif req.lat is not None and req.lon is not None:
            if not (-90 <= req.lat <= 90 and -180 <= req.lon <= 180):
                raise HTTPException(400, "coordinate out of range")
            session.set_location(req.lat, req.lon, req.label or f"{req.lat:.4f}, {req.lon:.4f}")
        else:
            raise HTTPException(400, "give a place key or lat + lon")
        return {"ok": True}

    @app.post("/api/play")
    def play(req: PlayReq):
        if req.mph is not None and not (1 <= req.mph <= 200):
            raise HTTPException(400, "mph should be between 1 and 200")
        try:
            session.play(req.route, req.engine, req.mph)
        except RouteError as e:
            raise HTTPException(400, str(e))
        return {"ok": True}

    @app.post("/api/stop")
    def stop():
        session.stop()
        return {"ok": True}

    return app


def warm_route_legs(session: Session):
    """Time every route the way it really plays, on a thread (see routes.LEGS_DIR): ~12 s the first
    time, nothing once they're on disk. /api/routes sends estimates until then."""
    def go():
        n = warm_legs(log=lambda line: session.log(line, "warn"))
        if n:
            session.log(f"timed {n} route{'s' if n != 1 else ''} the way they play", "dim")
    threading.Thread(target=go, daemon=True, name="warm-legs").start()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("VIDA_PORT") or free_port())
    session = Session()
    lic = License.from_config()
    if lic:
        lic.start()
    warm_route_legs(session)
    print(f"vida-360 → http://127.0.0.1:{port}")
    try:
        uvicorn.run(create_app(session, lic), host="127.0.0.1", port=port, log_level="warning")
    finally:
        session.shutdown()
