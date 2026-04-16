import asyncio
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Card
from services.deck_engine import generate_deck

router = APIRouter(prefix="/deck", tags=["deck"])


class DeckRequest(BaseModel):
    prompt: str
    commander_name: str


@router.post("/build")
async def build_deck(req: DeckRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Card))
    cards = result.scalars().all()

    if not cards:
        raise HTTPException(status_code=400, detail="Your collection is empty. Import cards first.")

    collection = [
        {
            "id": c.id,
            "name": c.name,
            "quantity": c.quantity,
            "mana_cost": c.mana_cost,
            "cmc": c.cmc,
            "type_line": c.type_line,
            "oracle_text": c.oracle_text,
            "colors": c.colors,
            "color_identity": c.color_identity,
            "keywords": c.keywords,
            "power": c.power,
            "toughness": c.toughness,
            "image_uri": c.image_uri,
            "legalities": c.legalities,
        }
        for c in cards
    ]

    try:
        # Run the synchronous Ollama call in a thread so we don't block the event loop
        deck = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: generate_deck(
                prompt=req.prompt,
                commander_name=req.commander_name,
                collection=collection,
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deck generation failed: {e}")

    return deck


@router.get("/commanders")
async def list_commanders(db: AsyncSession = Depends(get_db)):
    """Return all legendary creatures in the collection that can be commanders."""
    result = await db.execute(select(Card))
    cards = result.scalars().all()
    commanders = [
        {"id": c.id, "name": c.name, "color_identity": c.color_identity, "image_uri": c.image_uri}
        for c in cards
        if c.type_line
        and "legendary" in c.type_line.lower()
        and "creature" in c.type_line.lower()
        and (c.legalities or {}).get("commander") == "legal"
    ]
    return commanders
