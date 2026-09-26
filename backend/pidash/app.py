"""One process serves the API (docs/API.md) and the built frontend."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import __version__

STATIC_DIR = Path(
    os.environ.get("PIDASH_STATIC_DIR")
    or Path(__file__).resolve().parents[2] / "frontend" / "dist"
)

app = FastAPI(title="pidash", version=__version__, docs_url=None, redoc_url=None)


@app.get("/api/info")
def info():
    # ponytail: scaffold stub; the backend task implements the full contract in docs/API.md
    return {"api_version": 1, "app_version": __version__}


# Mounted last so /api/* routes win. Nothing is served at / until `npm run build` has run.
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
