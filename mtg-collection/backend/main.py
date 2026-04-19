from dotenv import load_dotenv
load_dotenv()

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from database import init_db

logger = logging.getLogger(__name__)

from routes.collection import router as collection_router
from routes.deckbuilder import router as deck_router

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


app.include_router(collection_router)
app.include_router(deck_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    # Entry point used for standalone packaged backend executable.
    # Pass app directly instead of module string for PyInstaller compatibility
    uvicorn.run(app, host="127.0.0.1", port=8000)
