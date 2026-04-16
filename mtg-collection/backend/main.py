from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
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
    await init_db()


app.include_router(collection_router)
app.include_router(deck_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
