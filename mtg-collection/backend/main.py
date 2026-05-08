import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load .env from (a) the directory next to the exe (PyInstaller frozen),
# (b) the current working directory, and (c) the source backend dir as a fallback.
# Each call only sets variables that aren't already defined.
_env_search_paths = []
if getattr(sys, "frozen", False):
    _env_search_paths.append(Path(sys.executable).parent / ".env")
    _env_search_paths.append(Path(getattr(sys, "_MEIPASS", "")) / ".env")
_env_search_paths.append(Path.cwd() / ".env")
_env_search_paths.append(Path(__file__).parent / ".env")
for _p in _env_search_paths:
    try:
        if _p and _p.is_file():
            load_dotenv(dotenv_path=_p, override=False)
    except Exception:
        pass
load_dotenv(override=False)

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from database import init_db

logger = logging.getLogger(__name__)

from routes.collection import router as collection_router
from routes.deckbuilder import router as deck_router
##from routes.archidekt import router as archidekt_router        unsure what this is for, but leaving it here for now in case we want to add it back in later

app = FastAPI(title="MTG Collection & Deck Builder", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    try:
        await init_db()
    except Exception:
        logger.exception("Database initialization failed")
        raise

    # Ensure the saved_decks directory exists so users can copy files into it
    # before saving their first deck through the app.
    try:
        from routes.deckbuilder import _saved_decks_dir
        _saved_decks_dir().mkdir(parents=True, exist_ok=True)
    except Exception:
        logger.warning("Could not pre-create saved_decks directory", exc_info=True)


app.include_router(collection_router)
app.include_router(deck_router)
##app.include_router(archidekt_router)   unsure what this is for, but leaving it here for now in case we want to add it back in later


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/llama")
async def health_llama():
    """Proxy-check whether llama-server is reachable on its local port."""
    import asyncio
    import urllib.request

    def _check() -> bool:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8081/health", timeout=2) as r:
                return r.status < 500
        except Exception:
            return False

    ok = await asyncio.get_event_loop().run_in_executor(None, _check)
    return {"status": "online" if ok else "offline"}


if __name__ == "__main__":
    # Entry point used for standalone packaged backend executable.
    # Pass app directly instead of module string for PyInstaller compatibility
    uvicorn.run(app, host="127.0.0.1", port=8000)
